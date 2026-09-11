import "server-only";

import {
  ClaimAssessmentSchema,
  EvidenceResultSchema,
  ModelUsageSchema,
  PROMPT_VERSION,
  type ClaimAssessment,
  type EvidenceResult,
  type ModelUsage,
  type Plan,
  type SourceDocument,
} from "@/domain/contracts";
import { claimAssessmentPrompt } from "@/domain/claim-prompt";
import {
  acquireModelSlot,
  assertProductionBudgetControls,
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

  constructor(kind: ModelAdapterErrorKind, message: string, options?: { durationMs?: number; attempted?: boolean }) {
    super(message);
    this.name = "ModelAdapterError";
    this.kind = kind;
    this.durationMs = options?.durationMs ?? 0;
    this.attempted = options?.attempted ?? false;
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
  const promptTokens = nonNegativeInteger(usage.prompt_tokens);
  const completionTokens = nonNegativeInteger(usage.completion_tokens);
  const explicitTotal = nonNegativeInteger(usage.total_tokens);
  const totalTokens = explicitTotal ?? (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null);
  const costNumber = nonNegativeNumber(usage.cost ?? usage.cost_usd);
  const costUsd = costNumber === null ? null : costNumber.toString();
  if (promptTokens === null && completionTokens === null && totalTokens === null && costUsd === null) return null;
  return ModelUsageSchema.parse({ promptTokens, completionTokens, totalTokens, costUsd });
}

function modelError(error: unknown, durationMs: number, attempted: boolean) {
  if (error instanceof ModelAdapterError) {
    return new ModelAdapterError(error.kind, error.message, { durationMs, attempted: attempted || error.attempted });
  }
  if (error instanceof ModelQuotaError) {
    return new ModelAdapterError("model_budget", error.message, { durationMs, attempted });
  }
  return new ModelAdapterError("model_invalid_output", error instanceof Error ? error.message : "The model request failed.", { durationMs, attempted });
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
  if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Model endpoint did not return JSON");
  }
}

function extractContent(response: unknown, protocol: ModelConfig["protocol"]) {
  const root = record(response);
  if (protocol === "openai_responses") {
    return stringValue(root.output_text);
  }
  const choices = root.choices;
  if (!Array.isArray(choices) || !choices.length) throw new Error("Model response had no choices");
  const message = record(record(choices[0]).message);
  return stringValue(message.content);
}

async function callModel(config: ModelConfig, prompt: string, context: { requestId: string; visitorKey: string }) {
  const startedAt = Date.now();
  let providerStarted = false;
  let releaseSlot: (() => void) | null = null;
  let reservation: Awaited<ReturnType<typeof reserveModelBudget>> = null;
  let result: { parsed: unknown; response: unknown; usage: ModelUsage | null } | null = null;
  let failure: ModelAdapterError | null = null;
  try {
    releaseSlot = acquireModelSlot();
    reservation = await reserveModelBudget(context);
    providerStarted = true;
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
            max_output_tokens: 2200,
          }
        : {
            model: config.model,
            ...(reasoning ? { reasoning } : {}),
            temperature: 0.1,
            max_tokens: 2200,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: `You are a source-bounded claim assessor. Prompt version: ${PROMPT_VERSION}.` },
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
      const content = extractContent(parsed, config.protocol);
      try {
        result = { parsed: JSON.parse(content) as unknown, response: parsed, usage: usageFromResponse(parsed) };
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
    failure = modelError(error, Date.now() - startedAt, providerStarted);
  } finally {
    releaseSlot?.();
  }

  if (reservation) {
    try {
      await settleModelBudget({
        reservationId: reservation.reservationId,
        actualCostUsd: result?.usage?.costUsd === null || result?.usage?.costUsd === undefined
          ? reservation.reservedCostUsd ?? maxModelCallCostUsd()
          : Number(result.usage.costUsd),
      });
    } catch (error) {
      failure = modelError(error, Date.now() - startedAt, providerStarted);
    }
  }

  if (failure) throw failure;
  if (!result) {
    throw new ModelAdapterError("model_invalid_output", "The model request returned no result.", {
      durationMs: Date.now() - startedAt,
      attempted: providerStarted,
    });
  }
  return { ...result, durationMs: Date.now() - startedAt };
}

function validateCitations(claim: ModelClaim, sources: SourceDocument[]) {
  const citations = claim.citations.map((citation) => {
    const source = sources.find((candidate) => candidate.id === citation.sourceId);
    if (!source) throw new Error(`Unknown citation source ID: ${citation.sourceId}`);
    if (citation.excerpt.length > 360) throw new Error("Citation excerpt is too long");
    const startOffset = source.cleanedText.indexOf(citation.excerpt);
    if (startOffset < 0 || source.cleanedText.indexOf(citation.excerpt, startOffset + 1) >= 0) {
      throw new Error("Citation excerpt did not match exactly once in the canonical source text");
    }
    return {
      sourceId: source.id,
      excerpt: citation.excerpt,
      startOffset,
      endOffset: startOffset + citation.excerpt.length,
    };
  });
  if ((claim.status === "supported" || claim.status === "contradicted") && !citations.length) {
    throw new Error("Supported and contradicted claims require a validated citation");
  }
  return citations;
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

export async function assessClaims(plan: Plan, sources: SourceDocument[], context: { requestId: string; visitorKey: string } = { requestId: "local-request", visitorKey: "local-visitor" }) {
  const config = configuredModel();
  const result = await callModel(config, claimAssessmentPrompt(plan, sources), context);
  let parsed;
  try {
    parsed = parseModelClaims(result.parsed);
  } catch (error) {
    throw new ModelAdapterError("model_invalid_output", error instanceof Error ? error.message : "The model output did not match the required schema.", {
      durationMs: result.durationMs,
      attempted: true,
    });
  }

  let claims: ClaimAssessment[];
  try {
    claims = parsed.claims.map((claim, index) => ClaimAssessmentSchema.parse({
      ...claim,
      claimId: claim.claimId || `claim-${index + 1}`,
      citations: validateCitations(claim, sources),
    }));
  } catch (error) {
    throw new ModelAdapterError(
      "model_invalid_output",
      error instanceof Error ? error.message : "The model citations did not match the supplied sources.",
      { durationMs: result.durationMs, attempted: true },
    );
  }
  const evidence = EvidenceResultSchema.parse({
    status: "assessed",
    assessmentOrigin: "runtime_model",
    verdict: overallVerdict(claims),
    scope: "by the supplied evidence",
    mostConsequentialUnknown: parsed.mostConsequentialUnknown,
    summary: parsed.summary,
  });
  const responseRoot = record(result.response);
  const responseModel = typeof responseRoot.model === "string" ? responseRoot.model : config.model;
  return {
    evidence,
    claims,
    modelId: responseModel,
    performance: {
      modelDurationMs: result.durationMs,
      modelUsage: result.usage,
      modelCalls: 1,
    },
  };
}
