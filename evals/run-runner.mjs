import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import {
  FORMULA_VERSION,
  PROMPT_VERSION,
} from "../src/domain/contracts.ts";
import { claimAssessmentPrompt } from "../src/domain/claim-prompt.ts";
import { calculateEconomics, syntheticInstrument, syntheticSnapshot } from "../src/domain/economics.ts";
import { parseIntent } from "../src/domain/intent.ts";
import {
  benchmarkManifest,
  benchmarkManifestHash,
  canonicalJson,
  cases,
  effectiveCaseInput,
  implementationHash,
  packetHash,
  sha256,
} from "./lib.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const modelTimeoutMs = 15_000;
const maxResponseBytes = 256_000;
const baselinePromptVersion = "general-research-v1";

function loadLocalEnv() {
  const envPath = path.resolve(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function relativeFixturePath(reference) {
  const normalized = reference.startsWith("fixtures/") ? reference : `fixtures/${reference}`;
  return normalized.endsWith(".json") ? normalized : `${normalized}.json`;
}

function readFixture(reference) {
  const relativePath = relativeFixturePath(reference);
  return JSON.parse(fs.readFileSync(path.resolve(projectRoot, relativePath), "utf8"));
}

function valueString(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.toString === "function") return String(value);
  throw new Error("Fixture value is not decimal-compatible");
}

function precisionStep(value) {
  return new Decimal(10).pow(-Number(valueString(value))).toString();
}

function capturedMarket(asset, reference) {
  const fixture = readFixture(reference);
  const instrumentResponse = fixture.requests.find((item) => item.name === `${asset.toLowerCase()}_spot_instrument`)?.response;
  const bookResponse = fixture.requests.find((item) => item.name === `${asset.toLowerCase()}_spot_book`)?.response;
  if (!instrumentResponse || !bookResponse) throw new Error(`Captured fixture has no ${asset} instrument/book pair`);
  const instrumentData = instrumentResponse.data?.[0];
  const bookData = bookResponse.data;
  const symbol = valueString(instrumentData.symbol);
  const bids = bookData.b.map((level) => [valueString(level[0]), valueString(level[1])]);
  const asks = bookData.a.map((level) => [valueString(level[0]), valueString(level[1])]);
  const exchangeTimestamp = new Date(Number(valueString(bookData.ts))).toISOString();
  const instrument = {
    symbol,
    asset,
    category: "SPOT",
    baseCoin: valueString(instrumentData.baseCoin),
    quoteCoin: "USDT",
    symbolType: valueString(instrumentData.symbolType),
    isReality: valueString(instrumentData.isReality) === "yes",
    status: valueString(instrumentData.status),
    quantityStep: precisionStep(instrumentData.quantityPrecision),
    priceTick: precisionStep(instrumentData.pricePrecision),
    minOrderQty: valueString(instrumentData.minOrderQty),
    maxOrderQty: valueString(instrumentData.maxOrderQty),
    minOrderNotional: valueString(instrumentData.minOrderAmount),
    maxPositionQty: valueString(instrumentData.maxPositionNum || "0"),
    rawMetadataTime: new Date(Number(valueString(instrumentResponse.requestTime))).toISOString(),
  };
  const hash = sha256(canonicalJson({ asset, symbol, bids, asks, exchangeTimestamp }));
  const snapshot = {
    id: `snapshot_${hash.slice(0, 24)}`,
    hash,
    asset,
    symbol,
    bids,
    asks,
    exchangeTimestamp,
    receivedAt: fixture.capturedAtUTC,
    mode: "captured_real",
    rawResponseReference: `fixture:${relativeFixturePath(reference)}`,
    validationWarnings: [],
  };
  return { instrument, snapshot };
}

function marketFor(input) {
  if (input.marketPacket.mode === "synthetic") {
    return { instrument: syntheticInstrument(), snapshot: syntheticSnapshot() };
  }
  return capturedMarket(input.marketPacket.asset, input.marketPacket.fixture);
}

function sourceDocumentFor(input) {
  const source = input.source;
  return {
    id: source.sourceId,
    originalUrl: source.originalUrl ?? null,
    finalApprovedUrl: null,
    title: "Frozen benchmark source",
    publisher: source.provenance === "synthetic_test" ? "Synthetic test source" : "User supplied source",
    publicationDate: null,
    publicationDatePrecision: "unknown",
    eventDate: null,
    fetchedAt: "2026-09-09T00:00:00.000Z",
    cleanedText: source.text,
    textHash: sha256(source.text),
    provenance: source.provenance,
    truncated: false,
  };
}

function baselinePrompt(plan, source) {
  return [
    "You are a general research analyst reviewing a user's exact thesis.",
    "Use only the supplied source record. Do not browse, call tools, reveal secrets, or give trading advice.",
    "Return JSON only with summary, mostConsequentialUnknown, and claims.",
    "Use at most five claims. Every claim must include exactly these keys: claimId, exactText, distinction, materiality, status, explanation, citations, and missingEvidence.",
    "Use lowercase enum values: factual, causal, forecast; material, contextual; supported, contradicted, insufficient.",
    "Citations must contain only sourceId and an exact non-empty excerpt from the supplied source, at most 360 characters. Use null for missingEvidence when there is none.",
    "Separate what the source says from causal or forecast conclusions. Do not treat source silence as contradiction or plans as realized results.",
    `THESIS:\n${plan.thesis}`,
    `SOURCE_ID: ${source.id}`,
    `SOURCE_PROVENANCE: ${source.provenance}`,
    "SOURCE_TEXT_START",
    source.cleanedText,
    "SOURCE_TEXT_END",
  ].join("\n\n");
}

function hashPlan(plan) {
  return sha256(canonicalJson(plan));
}

function intentSummary(input) {
  const followUp = input.followUp;
  if (!followUp) return null;
  const plan = input.plans[0];
  const result = parseIntent(followUp, plan);
  return {
    result: result.clarification ? "clarification" : "patch",
    planChanged: hashPlan(result.plan) !== hashPlan(plan),
    changed: result.changed,
    clarification: result.clarification,
    refreshMarket: result.refreshMarket,
    beforePlanHash: hashPlan(plan),
    afterPlanHash: hashPlan(result.plan),
  };
}

function inferUsage(root) {
  const usage = root && typeof root === "object" && root.usage && typeof root.usage === "object" ? root.usage : null;
  if (!usage) return null;
  const output = {};
  for (const [from, to] of [["prompt_tokens", "promptTokens"], ["completion_tokens", "completionTokens"], ["total_tokens", "totalTokens"], ["cost", "costUsd"]]) {
    if (typeof usage[from] === "number" && Number.isFinite(usage[from])) output[to] = usage[from];
  }
  return Object.keys(output).length ? output : null;
}

async function readLimitedText(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxResponseBytes) throw new Error("Model response exceeded the 256 KB body limit");
  return new TextDecoder().decode(bytes);
}

async function callModel(prompt, promptVersion) {
  const endpoint = process.env.THESIS_LLM_BASE_URL?.trim();
  const apiKey = process.env.THESIS_LLM_API_KEY?.trim();
  const model = process.env.THESIS_LLM_MODEL?.trim();
  const reasoningEffort = process.env.THESIS_LLM_REASONING_EFFORT?.trim() || null;
  if (process.env.THESIS_LLM_ENABLED !== "true" || process.env.NODE_ENV === "production") throw new Error("The evaluation model is disabled or production mode is active");
  if (process.env.THESIS_LLM_PROTOCOL !== benchmarkManifest.inferenceConfig.protocol) throw new Error("Local protocol does not match the frozen benchmark configuration");
  if (model !== benchmarkManifest.inferenceConfig.modelAlias) throw new Error("Local model does not match the frozen benchmark configuration");
  if (reasoningEffort !== benchmarkManifest.inferenceConfig.reasoningEffort) throw new Error("Local reasoning effort does not match the frozen benchmark configuration");
  if (endpoint !== benchmarkManifest.paidRunControls.providerEndpointAllowlist[0]) throw new Error("Local model endpoint is not on the frozen provider allowlist");
  if (!endpoint || !apiKey || !model) throw new Error("Local model configuration is incomplete");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), modelTimeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: reasoningEffort },
        temperature: benchmarkManifest.inferenceConfig.temperature,
        max_tokens: benchmarkManifest.inferenceConfig.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `You are a source-bounded claim assessor. Prompt version: ${promptVersion}.` },
          { role: "user", content: prompt },
        ],
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await readLimitedText(response);
    let root;
    try {
      root = JSON.parse(text);
    } catch {
      throw new Error("Provider did not return JSON");
    }
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    const choice = Array.isArray(root.choices) ? root.choices[0] : null;
    const content = choice?.message?.content;
    if (typeof content !== "string") throw new Error("Provider returned no JSON message content");
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Provider message content was not strict JSON");
    }
    return {
      status: "completed",
      assessment: parsed,
      returnedModel: typeof root.model === "string" ? root.model : model,
      latencyMs: Math.max(0, Date.now() - started),
      usage: inferUsage(root),
      attempts: 1,
    };
  } catch (error) {
    const baseMessage = error?.name === "AbortError" ? "The claim-assessment request timed out." : error instanceof Error ? error.message : "The model request failed.";
    const causeCode = error && typeof error === "object" && "cause" in error && error.cause && typeof error.cause === "object" && "code" in error.cause && typeof error.cause.code === "string" ? ` (${error.cause.code})` : "";
    const message = `${baseMessage}${causeCode}`.slice(0, 500);
    return {
      status: "failed",
      assessment: null,
      returnedModel: model,
      latencyMs: Math.max(0, Date.now() - started),
      usage: null,
      attempts: 1,
      error: { code: error?.name === "AbortError" ? "model_timeout" : "model_request_failed", message },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function dryModelArtifact(modelVersion, promptVersion, promptHash, intent, errorCode = "dry_run") {
  return {
    status: "not_run",
    assessment: null,
    intent,
    modelVersion,
    promptVersion,
    promptHash,
    latencyMs: 0,
    attempts: 0,
    error: { code: errorCode, message: "No provider call was made; the benchmark runner is in dry-run mode." },
  };
}

function unavailableModelArtifact(modelVersion, promptVersion, promptHash, intent) {
  return {
    status: "unavailable",
    assessment: null,
    intent,
    modelVersion,
    promptVersion,
    promptHash,
    latencyMs: 0,
    attempts: 0,
    error: { code: "model_unconfigured", message: "Model unavailability is explicitly simulated by the frozen E11 call plan." },
  };
}

function validateModelAssessment(assessment, source) {
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) throw new Error("Model assessment root is invalid");
  if (Object.keys(assessment).sort().join(",") !== "claims,mostConsequentialUnknown,summary") throw new Error("Model assessment root keys are not exact");
  if (typeof assessment.summary !== "string" || !assessment.summary.trim()) throw new Error("Model summary is invalid");
  if (assessment.mostConsequentialUnknown !== null && typeof assessment.mostConsequentialUnknown !== "string") throw new Error("Model unknown field is invalid");
  if (!Array.isArray(assessment.claims) || assessment.claims.length > 5) throw new Error("Model claim list is invalid");
  for (const claim of assessment.claims) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) throw new Error("Model claim is invalid");
    if (Object.keys(claim).sort().join(",") !== "citations,claimId,distinction,exactText,explanation,materiality,missingEvidence,status") throw new Error("Model claim keys are not exact");
    if (typeof claim.claimId !== "string" || typeof claim.exactText !== "string" || typeof claim.explanation !== "string") throw new Error("Model claim text is invalid");
    if (!["factual", "causal", "forecast"].includes(claim.distinction)) throw new Error("Model distinction is invalid");
    if (!["material", "contextual"].includes(claim.materiality)) throw new Error("Model materiality is invalid");
    if (!["supported", "contradicted", "insufficient"].includes(claim.status)) throw new Error("Model status is invalid");
    if (claim.missingEvidence !== null && typeof claim.missingEvidence !== "string") throw new Error("Model missingEvidence is invalid");
    if (!Array.isArray(claim.citations) || claim.citations.length > 5) throw new Error("Model citations are invalid");
    for (const citation of claim.citations) {
      if (!citation || typeof citation !== "object" || Array.isArray(citation) || Object.keys(citation).sort().join(",") !== "excerpt,sourceId") throw new Error("Model citation keys are not exact");
      if (citation.sourceId !== source.id || typeof citation.excerpt !== "string" || citation.excerpt.length < 1 || citation.excerpt.length > 360) throw new Error("Model citation source is invalid");
      const first = source.cleanedText.indexOf(citation.excerpt);
      if (first < 0 || source.cleanedText.indexOf(citation.excerpt, first + 1) >= 0) throw new Error("Model citation does not match exactly once");
    }
    if (["supported", "contradicted"].includes(claim.status) && claim.citations.length === 0) throw new Error("Supported/contradicted claim has no citation");
  }
}

function calculatorOutput(input) {
  const { instrument, snapshot } = marketFor(input);
  const results = input.plans.map((plan) => ({
    purchaseNotionalExcludingFee: plan.purchaseNotionalExcludingFee,
    ...calculateEconomics({ plan, instrument, snapshot, planRevision: 0, scenarioRevision: 0 }),
  }));
  return {
    results,
    sourceProvenance: input.source.provenance,
    marketMode: input.marketPacket.mode,
    fixtureReference: input.marketPacket.fixture,
    fallbackUsed: false,
    intent: intentSummary(input),
  };
}

function artifactBase(input, item, runType, status, latencyMs, attempts) {
  const effectiveInputHash = sha256(canonicalJson(input));
  return {
    caseId: item.id,
    packetHash: packetHash(item),
    runType,
    status,
    recordedAt: new Date().toISOString(),
    latencyMs,
    attempts,
    effectiveInputHash,
    inputProjectionHash: sha256(canonicalJson({ source: input.source, plans: input.plans, followUp: input.followUp, sourceMode: input.sourceMode, marketPacket: input.marketPacket })),
    sourceHash: sha256(canonicalJson(input.source)),
    marketHash: sha256(canonicalJson(input.marketPacket)),
    inferenceConfigHash: sha256(canonicalJson(benchmarkManifest.inferenceConfig)),
    manifestHash: benchmarkManifestHash,
    implementationHash: implementationHash(),
    requestId: `eval_${item.id}_${runType}_${randomUUID().slice(0, 8)}`,
    transport: runType === "calculator" ? "local_pure_function" : "openrouter_chat",
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return sha256(fs.readFileSync(filePath));
}

function parseCaseAllowlist() {
  const value = process.env.THESISGATE_EVAL_CASES?.trim();
  if (!value) return cases;
  const ids = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  const selected = ids.map((id) => cases.find((item) => item.id === id));
  if (selected.some((item) => !item)) throw new Error("THESISGATE_EVAL_CASES contains an unknown case ID");
  return selected;
}

function parseNonNegativeInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error("Evaluation numeric limits must be non-negative integers");
  return Number(value);
}

async function main() {
  loadLocalEnv();
  const mode = process.env.THESISGATE_EVAL_MODE?.trim() || "dry_run";
  if (!['dry_run', 'paid'].includes(mode)) throw new Error("THESISGATE_EVAL_MODE must be dry_run or paid");
  if (mode === "paid" && process.env.THESISGATE_ALLOW_PAID_EVAL !== "1") throw new Error("Paid evaluation requires THESISGATE_ALLOW_PAID_EVAL=1");
  if (mode === "paid" && !process.env.THESISGATE_EVAL_CASES?.trim()) throw new Error("Paid evaluation requires an explicit THESISGATE_EVAL_CASES allowlist");
  if (mode === "paid" && !process.env.THESISGATE_EVAL_MAX_CALLS?.trim()) throw new Error("Paid evaluation requires an explicit THESISGATE_EVAL_MAX_CALLS cap");
  const selectedCases = parseCaseAllowlist();
  const plannedCalls = selectedCases.reduce((sum, item) => sum + benchmarkManifest.caseExecution[item.id].candidateCalls + benchmarkManifest.caseExecution[item.id].baselineCalls, 0);
  const maxCalls = parseNonNegativeInteger(process.env.THESISGATE_EVAL_MAX_CALLS, mode === "dry_run" ? 0 : plannedCalls);
  if (mode === "paid" && plannedCalls > maxCalls) throw new Error(`Planned provider calls (${plannedCalls}) exceed THESISGATE_EVAL_MAX_CALLS (${maxCalls})`);
  if (mode === "paid" && maxCalls === 0) throw new Error("Paid evaluation requires a positive call limit");

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const runRoot = path.resolve(projectRoot, "evals", "results", runId);
  for (const directory of [runRoot, path.join(runRoot, "candidate"), path.join(runRoot, "general-baseline"), path.join(runRoot, "calculator")]) fs.mkdirSync(directory, { recursive: true });
  const artifactDescriptors = [];
  let attemptedCalls = 0;
  const modelVersions = new Set();

  for (const item of selectedCases) {
    const input = effectiveCaseInput(item);
    const source = sourceDocumentFor(input);
    const plan = input.plans[0];
    const intent = intentSummary(input);
    const candidatePrompt = claimAssessmentPrompt(plan, [source]);
    const baselinePromptText = baselinePrompt(plan, source);
    const configuredModel = process.env.THESIS_LLM_MODEL?.trim() || benchmarkManifest.inferenceConfig.modelAlias;
    let candidateOutput;
    let baselineOutput;
    if (benchmarkManifest.caseExecution[item.id].candidateCalls === 0) {
      candidateOutput = unavailableModelArtifact(configuredModel, PROMPT_VERSION, sha256(candidatePrompt), intent);
      baselineOutput = unavailableModelArtifact(configuredModel, baselinePromptVersion, sha256(baselinePromptText), intent);
    } else if (mode === "dry_run") {
      candidateOutput = dryModelArtifact(configuredModel, PROMPT_VERSION, sha256(candidatePrompt), intent);
      baselineOutput = dryModelArtifact(configuredModel, baselinePromptVersion, sha256(baselinePromptText), intent);
    } else {
      const candidateCall = await callModel(candidatePrompt, PROMPT_VERSION);
      attemptedCalls += candidateCall.attempts;
      candidateOutput = { ...candidateCall, intent, promptHash: sha256(candidatePrompt), promptVersion: PROMPT_VERSION, modelVersion: candidateCall.returnedModel };
      if (candidateCall.status === "completed") {
        try {
          validateModelAssessment(candidateCall.assessment, source);
        } catch (error) {
          candidateOutput = { ...candidateOutput, status: "failed", assessment: null, error: { code: "model_invalid_output", message: error instanceof Error ? error.message : "Model assessment was invalid" } };
        }
      }
      const baselineCall = await callModel(baselinePromptText, baselinePromptVersion);
      attemptedCalls += baselineCall.attempts;
      baselineOutput = { ...baselineCall, intent, promptHash: sha256(baselinePromptText), promptVersion: baselinePromptVersion, modelVersion: baselineCall.returnedModel };
      if (baselineCall.status === "completed") {
        try {
          validateModelAssessment(baselineCall.assessment, source);
        } catch (error) {
          baselineOutput = { ...baselineOutput, status: "failed", assessment: null, error: { code: "model_invalid_output", message: error instanceof Error ? error.message : "Model assessment was invalid" } };
        }
      }
    }
    modelVersions.add(candidateOutput.modelVersion);
    modelVersions.add(baselineOutput.modelVersion);

    const candidateArtifact = {
      ...artifactBase(input, item, "candidate", candidateOutput.status, candidateOutput.latencyMs, candidateOutput.attempts),
      output: {
        status: candidateOutput.status,
        assessment: candidateOutput.assessment ?? null,
        intent,
      },
      modelVersion: candidateOutput.modelVersion,
      promptVersion: candidateOutput.promptVersion,
      promptHash: candidateOutput.promptHash,
      usage: candidateOutput.usage ?? null,
      error: candidateOutput.error ?? null,
    };
    const baselineArtifact = {
      ...artifactBase(input, item, "general_baseline", baselineOutput.status, baselineOutput.latencyMs, baselineOutput.attempts),
      output: {
        status: baselineOutput.status,
        assessment: baselineOutput.assessment ?? null,
        intent,
      },
      modelVersion: baselineOutput.modelVersion,
      promptVersion: baselineOutput.promptVersion,
      promptHash: baselineOutput.promptHash,
      usage: baselineOutput.usage ?? null,
      error: baselineOutput.error ?? null,
    };
    const started = Date.now();
    const calculatorArtifact = {
      ...artifactBase(input, item, "calculator", "completed", 0, 0),
      formulaVersion: FORMULA_VERSION,
      output: calculatorOutput(input),
      latencyMs: Math.max(0, Date.now() - started),
      error: null,
    };
    const files = [
      ["candidate", candidateArtifact],
      ["general-baseline", baselineArtifact],
      ["calculator", calculatorArtifact],
    ];
    const descriptors = {};
    for (const [directory, artifact] of files) {
      const relativePath = `${directory}/${item.id}.json`;
      const filePath = path.join(runRoot, relativePath);
      const digest = writeJson(filePath, artifact);
      descriptors[directory] = { path: relativePath, sha256: digest };
    }
    artifactDescriptors.push({ item, input, descriptors });
  }

  const runManifest = {
    runVersion: "eval-runner-v1",
    status: "unscored",
    mode,
    recordedAt: new Date().toISOString(),
    artifactRoot: path.relative(projectRoot, runRoot),
    benchmarkManifestHash,
    implementationHash: implementationHash(),
    selectedCases: selectedCases.map((item) => item.id),
    plannedProviderCalls: plannedCalls,
    attemptedProviderCalls: attemptedCalls,
    modelVersions: [...modelVersions].filter(Boolean).sort(),
    runtime: { node: process.version, calculator: "production calculateEconomics" },
    inferenceConfig: benchmarkManifest.inferenceConfig,
    paidRunControls: benchmarkManifest.paidRunControls,
    secretsIncluded: false,
  };
  writeJson(path.join(runRoot, "run-manifest.json"), runManifest);

  const reportCases = artifactDescriptors.map(({ item, descriptors }) => ({
    caseId: item.id,
    packetHash: packetHash(item),
    expectedOutcome: item.expectedOutcome,
    candidate: descriptors.candidate,
    generalBaseline: descriptors["general-baseline"],
    calculator: descriptors.calculator,
    observedOutcome: "UNSCORED — complete the manual rubric before using this report.",
    completeCorrect: false,
    numericChecksPass: false,
    noMaterialFabrication: false,
    scoring: {
      evidenceAssessmentCorrect: false,
      economicsInterpretationCorrect: false,
      failureBehaviorCorrect: false,
      noMaterialFabrication: false,
    },
    baselineOmissions: [],
    correctedOmissions: [],
    omissionsCorrected: 0,
    graderRationale: "UNSCORED — inspect candidate and baseline artifacts, then complete the rubric.",
    materialErrors: [],
    grader: "builder",
  }));
  const unscoredReport = {
    reportVersion: benchmarkManifest.manifestVersion,
    status: "unscored",
    recordedAt: runManifest.recordedAt,
    benchmarkManifestHash,
    rubricVersion: benchmarkManifest.rubricVersion,
    promptVersion: PROMPT_VERSION,
    modelVersion: runManifest.modelVersions[0] ?? benchmarkManifest.inferenceConfig.modelAlias,
    scoringMethod: "builder",
    artifactRoot: runManifest.artifactRoot,
    generalBaseline: {
      modelVersion: runManifest.modelVersions[0] ?? benchmarkManifest.inferenceConfig.modelAlias,
      promptVersion: baselinePromptVersion,
      inferenceConfigHash: sha256(canonicalJson(benchmarkManifest.inferenceConfig)),
      sameInputs: true,
      sameCallCount: true,
      sameTokenBudget: true,
      sameToolBudget: true,
    },
    calculatorVersion: FORMULA_VERSION,
    cases: reportCases,
  };
  const reportFile = path.join(runRoot, "report.unscored.json");
  writeJson(reportFile, unscoredReport);
  console.log(JSON.stringify({
    status: runManifest.status,
    mode,
    runRoot: runManifest.artifactRoot,
    selectedCases: runManifest.selectedCases,
    plannedProviderCalls: plannedCalls,
    attemptedProviderCalls: attemptedCalls,
    report: path.relative(projectRoot, reportFile),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Evaluation runner failed");
  process.exitCode = 2;
});
