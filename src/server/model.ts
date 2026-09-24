import "server-only";

import {
  ClaimAssessmentSchema,
  EvidenceResultSchema,
  ModelUsageSchema,
  MULTI_SOURCE_PROMPT_VERSION,
  PROMPT_VERSION,
  type ClaimAssessment,
  type EvidenceResult,
  type ModelUsage,
  type Plan,
  type SourceDocument,
} from "@/domain/contracts";
import { claimAssessmentPrompt, multiSourceClaimPrompt } from "@/domain/claim-prompt";
import {
  acquireModelSlot,
  assertProductionBudgetControls,
  checkLocalModelRateLimit,
  maxModelCallCostUsd,
  ModelQuotaError,
  reserveModelBudget,
  settleModelBudget,
} from "./quota";

const MODEL_TIMEOUT_MS = 15_000;
const MODEL_RESPONSE_MAX_BYTES = 256_000;
type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
const REASONING_EFFORTS = new Set<ReasoningEffort>(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORTS.has(value as ReasoningEffort);
}

type ModelAdapterErrorKind = "model_unconfigured" | "model_timeout" | "model_invalid_output" | "model_budget";

export class ModelAdapterError extends Error {
  readonly kind: ModelAdapterErrorKind;
  readonly durationMs: number;
  readonly attempted: boolean;
  readonly usage: ModelUsage | null;
  readonly modelId: string | null;

  constructor(kind: ModelAdapterErrorKind, message: string, options?: { durationMs?: number; attempted?: boolean; usage?: ModelUsage | null; modelId?: string | null }) {
    super(message);
    this.name = "ModelAdapterError";
    this.kind = kind;
    this.durationMs = options?.durationMs ?? 0;
    this.attempted = options?.attempted ?? false;
    this.usage = options?.usage ?? null;
    this.modelId = options?.modelId ?? null;
  }
}

type ModelConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  protocol: "openai_chat" | "openai_responses";
  reasoningEffort: ReasoningEffort | null;
};

type ModelCitation = { sourceId: string; excerpt: string };
type ModelClaim = {
  claimId: string;
  exactText: string;
  distinction: "factual" | "causal" | "forecast";
  materiality: "material" | "contextual";
  status: "supported" | "contradicted" | "insufficient";
  explanation: string;
  citations: ModelCitation[];
  missingEvidence: string | null;
};

function configuredModel(): ModelConfig {
  if (process.env.THESIS_LLM_ENABLED !== "true") {
    throw new ModelAdapterError(
      "model_unconfigured",
      "Runtime claim assessment is disabled. Economics can still be calculated; the supplied source remains visible.",
    );
  }
  if (process.env.NODE_ENV === "production") {
    try {
      assertProductionBudgetControls();
    } catch (error) {
      throw new ModelAdapterError(
        "model_budget",
        error instanceof Error ? error.message : "Durable production model budget controls are not configured.",
      );
    }
  }
  const apiKey = process.env.THESIS_LLM_API_KEY?.trim();
  const baseUrl = process.env.THESIS_LLM_BASE_URL?.trim();
  const model = process.env.THESIS_LLM_MODEL?.trim();
  const protocol = process.env.THESIS_LLM_PROTOCOL?.trim();
  const reasoningEffortValue = process.env.THESIS_LLM_REASONING_EFFORT?.trim() || null;
  if (!apiKey || !baseUrl || !model || !protocol) {
    throw new ModelAdapterError(
      "model_unconfigured",
      "Runtime claim assessment is not configured. Economics can still be calculated; paste a source and configure the server model to assess claims.",
    );
  }
  if (protocol !== "openai_chat" && protocol !== "openai_responses") {
    throw new ModelAdapterError("model_unconfigured", "THESIS_LLM_PROTOCOL must be openai_chat or openai_responses.");
  }
  if (reasoningEffortValue && !isReasoningEffort(reasoningEffortValue)) {
    throw new ModelAdapterError(
      "model_unconfigured",
      "THESIS_LLM_REASONING_EFFORT must be none, minimal, low, medium, high, xhigh, or max.",
    );
  }
  const reasoningEffort = reasoningEffortValue as ReasoningEffort | null;
  try {
    const url = new URL(baseUrl);
    const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !localDevelopment) {
      throw new Error("Model endpoint must use HTTPS outside local development.");
    }
  } catch {
    throw new ModelAdapterError("model_unconfigured", "THESIS_LLM_BASE_URL is not a valid HTTPS model endpoint.");
  }
  return { apiKey, baseUrl, model, protocol, reasoningEffort };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  if (typeof value !== "string") throw new Error("Expected a string");
  return value;
}

function nonNegativeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function nonNegativeNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function usageFromResponse(response: unknown): ModelUsage | null {
  const root = record(response);
  const usageValue = root.usage;
  if (!usageValue || typeof usageValue !== "object" || Array.isArray(usageValue)) return null;
  const usage = usageValue as Record<string, unknown>;
  const promptTokens = nonNegativeInteger(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = nonNegativeInteger(usage.completion_tokens ?? usage.output_tokens);
  const explicitTotal = nonNegativeInteger(usage.total_tokens);
  const totalTokens = explicitTotal ?? (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null);
  const costNumber = nonNegativeNumber(usage.cost ?? usage.cost_usd);
  const costUsd = costNumber === null ? null : costNumber.toString();
  if (promptTokens === null && completionTokens === null && totalTokens === null && costUsd === null) return null;
  return ModelUsageSchema.parse({ promptTokens, completionTokens, totalTokens, costUsd });
}

function modelError(error: unknown, durationMs: number, attempted: boolean, usage: ModelUsage | null = null, modelId: string | null = null) {
  const options = { durationMs, attempted, usage, modelId };
  if (error instanceof ModelAdapterError) {
    return new ModelAdapterError(error.kind, error.message, { ...options, attempted: attempted || error.attempted, usage: usage ?? error.usage, modelId: modelId ?? error.modelId });
  }
  if (error instanceof ModelQuotaError) {
    return new ModelAdapterError("model_budget", error.message, options);
  }
  return new ModelAdapterError("model_invalid_output", error instanceof Error ? error.message : "The model request failed.", options);
}

function parseModelClaims(value: unknown) {
  const root = record(value);
  const claims = root.claims;
  if (!Array.isArray(claims) || claims.length > 5) throw new Error("Model returned an invalid claim list");
  const summary = stringValue(root.summary);
  const mostConsequentialUnknown = root.mostConsequentialUnknown === null
    ? null
    : stringValue(root.mostConsequentialUnknown);
  return {
    summary,
    mostConsequentialUnknown,
    claims: claims.map((claim) => {
      const item = record(claim);
      const citations = item.citations;
      if (!Array.isArray(citations) || citations.length > 5) throw new Error("Model returned invalid citations");
      return {
        claimId: stringValue(item.claimId),
        exactText: stringValue(item.exactText),
        distinction: stringValue(item.distinction) as ModelClaim["distinction"],
        materiality: stringValue(item.materiality) as ModelClaim["materiality"],
        status: stringValue(item.status) as ModelClaim["status"],
        explanation: stringValue(item.explanation),
        citations: citations.map((citation) => {
          const itemCitation = record(citation);
          return { sourceId: stringValue(itemCitation.sourceId), excerpt: stringValue(itemCitation.excerpt) };
        }),
        missingEvidence: item.missingEvidence === null ? null : stringValue(item.missingEvidence),
      } satisfies ModelClaim;
    }),
  };
}

async function readModelText(response: Response) {
  if (!response.body) throw new Error("Model endpoint did not expose a response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MODEL_RESPONSE_MAX_BYTES) {
        await reader.cancel("model response too large");
        throw new Error("Model response exceeded the 256 KB body limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Model endpoint did not return JSON");
  }
}

function extractContent(response: unknown, protocol: ModelConfig["protocol"]) {
  const root = record(response);
  if (protocol === "openai_responses") {
    if (root.status !== "completed") throw new Error("Model response did not complete successfully");
    if (!Array.isArray(root.output)) throw new Error("Model response had no output items");
    const text: string[] = [];
    for (const output of root.output) {
      const item = record(output);
      if (item.type !== "message") continue;
      if (item.status !== "completed" || item.role !== "assistant" || !Array.isArray(item.content)) {
        throw new Error("Model output message was incomplete or invalid");
      }
      for (const content of item.content) {
        const part = record(content);
        if (part.type === "refusal") throw new Error("Model declined the claim assessment");
        if (part.type === "output_text") text.push(stringValue(part.text));
      }
    }
    if (!text.length) throw new Error("Model response had no output text");
    return text.join("");
  }
  const choices = root.choices;
  if (!Array.isArray(choices) || !choices.length) throw new Error("Model response had no choices");
  const message = record(record(choices[0]).message);
  return stringValue(message.content);
}

async function callModel(config: ModelConfig, prompt: string, context: { requestId: string; visitorKey: string }, options: { system: string; maxTokens: number; kind?: "analysis" | "chat" }) {
  const startedAt = Date.now();
  let providerStarted = false;
  let releaseSlot: (() => void) | null = null;
  let reservation: Awaited<ReturnType<typeof reserveModelBudget>> = null;
  let result: { parsed: unknown; response: unknown; usage: ModelUsage | null } | null = null;
  let failure: ModelAdapterError | null = null;
  let usage: ModelUsage | null = null;
  let modelId: string | null = null;
  try {
    // Local 5/10min + daily guard runs before the durable production reservation.
    try {
      checkLocalModelRateLimit(context.visitorKey, options.kind ?? "analysis");
    } catch (error) {
      throw new ModelAdapterError("model_budget", error instanceof Error ? error.message : "Model budget denied.");
    }
    releaseSlot = acquireModelSlot();
    reservation = await reserveModelBudget(context);
    providerStarted = true;
    modelId = config.model;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
    try {
      const reasoning = config.reasoningEffort ? { effort: config.reasoningEffort } : undefined;
      const body = config.protocol === "openai_responses"
        ? {
            model: config.model,
            ...(reasoning ? { reasoning } : {}),
            input: prompt,
            temperature: 0.1,
            instructions: options.system,
            max_output_tokens: options.maxTokens,
          }
        : {
            model: config.model,
            ...(reasoning ? { reasoning } : {}),
            temperature: 0.1,
            max_tokens: options.maxTokens,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: options.system },
              { role: "user", content: prompt },
            ],
          };
      const response = await fetch(config.baseUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      const parsed = await readModelText(response);
      usage = usageFromResponse(parsed);
      const responseRoot = record(parsed);
      if (typeof responseRoot.model === "string") modelId = responseRoot.model;
      if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}`);
      const content = extractContent(parsed, config.protocol);
      try {
        result = { parsed: JSON.parse(content) as unknown, response: parsed, usage };
      } catch {
        throw new Error("Model content was not strict JSON");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ModelAdapterError("model_timeout", "The claim-assessment request timed out.");
      }
      if (error instanceof ModelAdapterError) throw error;
      throw new ModelAdapterError("model_invalid_output", error instanceof Error ? error.message : "The model request failed.");
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    failure = modelError(error, Date.now() - startedAt, providerStarted, usage, modelId);
  } finally {
    releaseSlot?.();
  }

  if (reservation) {
    try {
      await settleModelBudget({
        reservationId: reservation.reservationId,
        actualCostUsd: usage?.costUsd === null || usage?.costUsd === undefined
          ? reservation.reservedCostUsd ?? maxModelCallCostUsd()
          : Number(usage.costUsd),
      });
    } catch (error) {
      failure = modelError(error, Date.now() - startedAt, providerStarted, usage, modelId);
    }
  }

  if (failure) throw failure;
  if (!result) {
    throw new ModelAdapterError("model_invalid_output", "The model request returned no result.", {
      durationMs: Date.now() - startedAt,
      attempted: providerStarted,
    });
  }
  return { ...result, modelId, durationMs: Date.now() - startedAt };
}

const EQUIVALENT_CHARACTERS: Record<string, string> = { "\u2018": "'", "\u2019": "'", "\u201c": "\"", "\u201d": "\"", "\u2013": "-", "\u2014": "-", "\u00a0": " " };

/** Folds typographic quotes, dashes and whitespace runs, keeping a map back to original offsets. */
function foldForMatching(text: string) {
  let folded = "";
  const origin: number[] = [];
  let lastWasSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = EQUIVALENT_CHARACTERS[text[index]] ?? text[index];
    if (/\s/.test(character)) {
      if (lastWasSpace) continue;
      folded += " ";
      origin.push(index);
      lastWasSpace = true;
      continue;
    }
    folded += character;
    origin.push(index);
    lastWasSpace = false;
  }
  return { folded, origin };
}

/**
 * Locates a model quote in the canonical text. Exact matches win; otherwise typographic and whitespace
 * differences are tolerated and the citation records the exact source substring, never the model's text.
 */
export function locateExcerpt(excerpt: string, text: string): { startOffset: number; endOffset: number } | null {
  const exact = text.indexOf(excerpt);
  if (exact >= 0) return { startOffset: exact, endOffset: exact + excerpt.length };
  const needle = foldForMatching(excerpt.trim()).folded;
  if (needle.length < 12) return null;
  const haystack = foldForMatching(text);
  const found = haystack.folded.indexOf(needle);
  if (found < 0) return null;
  return { startOffset: haystack.origin[found], endOffset: haystack.origin[found + needle.length - 1] + 1 };
}

function validateCitations(claim: ModelClaim, sources: SourceDocument[]) {
  let unverified = 0;
  const citations = claim.citations.flatMap((citation) => {
    const source = sources.find((candidate) => candidate.id === citation.sourceId);
    // An invented source ID is fabrication, so the whole assessment is rejected.
    if (!source) throw new Error(`Unknown citation source ID: ${citation.sourceId}`);
    if (citation.excerpt.length > 360) throw new Error("Citation excerpt is too long");
    const located = locateExcerpt(citation.excerpt, source.cleanedText);
    if (!located) {
      unverified += 1;
      return [];
    }
    return [{
      sourceId: source.id,
      excerpt: source.cleanedText.slice(located.startOffset, located.endOffset).slice(0, 360),
      startOffset: located.startOffset,
      endOffset: Math.min(located.endOffset, located.startOffset + 360),
    }];
  });
  // A verdict that loses every verifiable quote is not trusted: it is downgraded, and the reason is shown.
  if ((claim.status === "supported" || claim.status === "contradicted") && !citations.length) {
    return {
      citations,
      status: "insufficient" as const,
      explanation: `${claim.explanation} (ThesisGate could not verify the quoted text in the source, so this claim is treated as unverified rather than ${claim.status}.)`.slice(0, 900),
      unverified,
    };
  }
  return { citations, status: claim.status, explanation: claim.explanation, unverified };
}

function overallVerdict(claims: ClaimAssessment[]): EvidenceResult["verdict"] {
  if (!claims.length) return "insufficient";
  const statuses = new Set(claims.map((claim) => claim.status));
  if (statuses.size > 1) return "mixed";
  return claims[0].status;
}

export function unavailableEvidence(summary: string): EvidenceResult {
  return EvidenceResultSchema.parse({
    status: "unavailable",
    assessmentOrigin: "unavailable",
    verdict: "not_assessed",
    scope: "by the supplied evidence",
    mostConsequentialUnknown: summary,
    summary,
  });
}

/**
 * One bounded JSON-mode call for the conversational layer. It shares the claim assessor's
 * configuration, rate limits, durable budget reservation, timeout and body cap.
 */
export async function callJsonModel(system: string, prompt: string, context: { requestId: string; visitorKey: string }, maxTokens = 900) {
  const config = configuredModel();
  const result = await callModel(config, prompt, context, { system, maxTokens, kind: "chat" });
  return { parsed: result.parsed, modelId: result.modelId ?? config.model, usage: result.usage, durationMs: result.durationMs };
}

export function claimPromptFor(plan: Plan, sources: SourceDocument[], asOf = new Date()) {
  const retrieved = sources.some((source) => source.provenance !== "user_pasted_unverified");
  return retrieved
    ? { prompt: multiSourceClaimPrompt(plan, sources, asOf), version: MULTI_SOURCE_PROMPT_VERSION }
    : { prompt: claimAssessmentPrompt(plan, sources), version: PROMPT_VERSION };
}

export async function assessClaims(plan: Plan, sources: SourceDocument[], context: { requestId: string; visitorKey: string } = { requestId: "local-request", visitorKey: "local-visitor" }, asOf = new Date()) {
  const config = configuredModel();
  const { prompt, version } = claimPromptFor(plan, sources, asOf);
  const result = await callModel(config, prompt, context, { system: `You are a source-bounded claim assessor. Prompt version: ${version}.`, maxTokens: 2200 });
  let parsed;
  try {
    parsed = parseModelClaims(result.parsed);
  } catch (error) {
    throw new ModelAdapterError("model_invalid_output", error instanceof Error ? error.message : "The model output did not match the required schema.", {
      durationMs: result.durationMs,
      attempted: true,
      usage: result.usage,
      modelId: result.modelId,
    });
  }

  let claims: ClaimAssessment[];
  try {
    claims = parsed.claims.map((claim, index) => {
      const validated = validateCitations(claim, sources);
      return ClaimAssessmentSchema.parse({
        ...claim,
        claimId: claim.claimId || `claim-${index + 1}`,
        status: validated.status,
        explanation: validated.explanation,
        citations: validated.citations,
      });
    });
  } catch (error) {
    throw new ModelAdapterError(
      "model_invalid_output",
      error instanceof Error ? error.message : "The model citations did not match the supplied sources.",
      { durationMs: result.durationMs, attempted: true, usage: result.usage, modelId: result.modelId },
    );
  }
  let evidence: EvidenceResult;
  try {
    evidence = EvidenceResultSchema.parse({
      status: "assessed",
      assessmentOrigin: "runtime_model",
      verdict: overallVerdict(claims),
      scope: "by the supplied evidence",
      mostConsequentialUnknown: parsed.mostConsequentialUnknown,
      summary: parsed.summary,
    });
  } catch (error) {
    throw modelError(error, result.durationMs, true, result.usage, result.modelId);
  }
  return {
    evidence,
    claims,
    promptVersion: version,
    modelId: result.modelId ?? config.model,
    performance: {
      modelDurationMs: result.durationMs,
      modelUsage: result.usage,
      modelCalls: 1,
    },
  };
}
