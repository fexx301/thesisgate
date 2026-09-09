import "server-only";

import {
  FORMULA_VERSION,
  PROMPT_VERSION,
  ResearchResultSchema,
  SCHEMA_VERSION,
  type PartialError,
  type ResearchRequest,
  type ResearchResult,
} from "@/domain/contracts";
import { calculateEconomics, missingEconomics } from "@/domain/economics";
import { economicsInputHash, evidenceInputHash } from "@/domain/revisions";
import { getMarket, MarketAdapterError } from "./bitget";
import { newId } from "./identifiers";
import { assessClaims, ModelAdapterError, unavailableEvidence } from "./model";
import { createPastedSourceDocument, sourceUrlStatus } from "./sources";

const BASE_LIMITATIONS = [
  "This is a conditional research brief, not a buy or sell instruction.",
  "The scenario uses one displayed order-book snapshot. It is not a firm quote, an execution promise, or a forecast.",
  "The model does not estimate how price, depth, or returns evolve over the holding horizon.",
  "A supplied source can support what an issuer stated without proving future revenue or price direction.",
];

function errorFor(kind: PartialError["kind"], message: string, recovery: string): PartialError {
  return { kind, message, recovery };
}

export async function runResearch(request: ResearchRequest): Promise<ResearchResult> {
  const generatedAt = new Date().toISOString();
  const source = request.sourceText
    ? createPastedSourceDocument({ text: request.sourceText, originalUrl: request.sourceUrl, fetchedAt: generatedAt })
    : null;
  const sources = source ? [source] : [];
  const partialErrors: PartialError[] = [];
  if (!source) {
    partialErrors.push(errorFor(
      "source_missing",
      "No usable source text was supplied, so the evidence assessment is not available.",
      "Paste the relevant source text. A URL alone is not fetched in this first slice.",
    ));
  }
  if (request.sourceUrl) {
    const urlStatus = sourceUrlStatus(request.sourceUrl);
    if (!urlStatus.valid || !urlStatus.approvedHost) {
      partialErrors.push(errorFor(
        "source_unavailable",
        `The supplied source URL is not eligible for retrieval: ${urlStatus.message}`,
        "Keep the URL as context if useful, but paste the relevant source text for this first slice.",
      ));
    }
  }
  if (request.sourceUrl && !source) {
    partialErrors.push(errorFor(
      "source_unavailable",
      "The source URL was retained as an unverified reference, but URL retrieval is disabled.",
      "Paste the source text to continue, then re-run the brief.",
    ));
  }
  if (!request.plan.thesis.trim()) {
    partialErrors.push(errorFor(
      "ambiguous_input",
      "The trade thesis is blank, so there is no exact claim to assess.",
      "State the factual or causal claim you want to stress-test.",
    ));
  }

  let instrument = null;
  let snapshot = null;
  let economics = missingEconomics(
    request.plan,
    request.inputRevision,
    request.inputRevision,
    "Market data is not available yet, so no threshold or whole-position result can be calculated.",
  );
  try {
    const market = await getMarket(request.plan.asset, request.marketMode);
    instrument = market.instrument;
    snapshot = market.snapshot;
    economics = calculateEconomics({
      plan: request.plan,
      instrument,
      snapshot,
      planRevision: request.inputRevision,
      scenarioRevision: request.inputRevision,
    });
    if (economics.computationStatus === "insufficient_depth") {
      partialErrors.push(errorFor(
        "insufficient_depth",
        "The requested position or stressed exit could not be filled by the displayed depth.",
        "Reduce the notional or exit-depth stress, then re-run with the limitation visible.",
      ));
    }
  } catch (error) {
    const kind = error instanceof MarketAdapterError ? error.kind : "market_unavailable";
    partialErrors.push(errorFor(
      kind,
      error instanceof Error ? error.message : "Market data was unavailable.",
      request.marketMode === "live"
        ? "Retry live market data or choose the captured example explicitly. No fixture fallback was used."
        : "Check the captured fixture before retrying.",
    ));
  }

  let evidence = unavailableEvidence(
    source
      ? "Runtime claim assessment is not available until the server model adapter is configured. The supplied source remains visible and economics is independent."
      : "Evidence cannot be assessed without usable source text and a thesis.",
  );
  let claims = [] as ResearchResult["claims"];
  let modelId: string | null = null;
  if (source && request.plan.thesis.trim()) {
    try {
      const result = await assessClaims(request.plan, sources);
      evidence = result.evidence;
      claims = result.claims;
      modelId = result.modelId;
    } catch (error) {
      const adapterError = error instanceof ModelAdapterError ? error : new ModelAdapterError("model_invalid_output", "The model adapter failed.");
      partialErrors.push(errorFor(
        adapterError.kind,
        adapterError.message,
        adapterError.kind === "model_unconfigured"
          ? "Configure the server-only model variables in .env.local, then retry."
          : "Review the provider response and retry explicitly. Automatic model retries are disabled.",
      ));
      evidence = unavailableEvidence(adapterError.message);
    }
  }

  const evidenceHash = evidenceInputHash(request.plan, sources, PROMPT_VERSION, modelId ?? "runtime-model-unavailable");
  const economicsHash = instrument && snapshot
    ? economicsInputHash(request.plan, instrument, snapshot, FORMULA_VERSION)
    : null;
  const limitations = [...BASE_LIMITATIONS];
  if (request.marketMode === "captured_real") {
    limitations.push("Captured market mode is historical replay data from the selection spike. It is not current market data.");
  }
  if (source?.provenance === "user_pasted_unverified") {
    limitations.push("Pasted source text is user-supplied and unverified, even when an official-looking URL is present.");
  }
  if (!modelId) {
    limitations.push("No runtime model assessment was recorded for this report.");
  }

  return ResearchResultSchema.parse({
    reportId: newId("report"),
    inputRevision: request.inputRevision,
    reportRevision: request.inputRevision,
    schemaVersion: SCHEMA_VERSION,
    formulaVersion: FORMULA_VERSION,
    promptVersion: PROMPT_VERSION,
    evidenceInputHash: evidenceHash,
    economicsInputHash: economicsHash,
    modelId,
    confirmedPlan: request.plan,
    instrument,
    snapshot,
    sources,
    claims,
    evidence,
    economics,
    partialErrors,
    generatedAt,
    limitations,
  });
}
