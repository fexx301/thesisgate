import "server-only";
import { InvestigationSchema, type ClaimAssessment, type Investigation, type Plan, type SourceDocument } from "@/domain/contracts";
import { selectInvestigationClaim } from "@/domain/investigation";
import { EVIDENCE_VALIDATION_VERSION, referenceDay } from "@/domain/evidence-validation";
import { evidenceInputHash } from "@/domain/revisions";
import { lookupInvestigation } from "./investigation-sources";
import { assessClaims, ModelAdapterError } from "./model";
import type { RequestContext } from "./http";

export const INVESTIGATION_LOOKUP_DEADLINE_MS = 8_000;

export async function investigateClaim(plan: Plan, claims: ClaimAssessment[], originalSources: SourceDocument[], mode: "live" | "captured_real", asOf: Date, context: RequestContext) {
  const started = Date.now();
  const base: Investigation = {
    version: "investigation-v1", status: "disabled", claimId: null, claim: null, beforeStatus: null,
    reason: "Targeted investigation is disabled on this server.", explanation: "The existing source review and trade math are unchanged.",
    nextFact: null, lookups: [], assessment: null, modelId: null, promptVersion: null, inputHash: null, modelCalls: 0, modelUsage: null, modelDurationMs: 0, durationMs: 0, asOf: asOf.toISOString(),
  };
  let addedSources: SourceDocument[] = [];
  const finish = () => ({ investigation: InvestigationSchema.parse({ ...base, durationMs: Date.now() - started }), sources: addedSources });
  // Server-owned flag only: disabled means no selection, lookups or additional model calls.
  if (process.env.THESIS_INVESTIGATION_ENABLED !== "true") return finish();
  const target = selectInvestigationClaim(claims, plan.asset);
  if (!target) {
    Object.assign(base, { status: "no_eligible_claim", reason: "No unresolved material factual claim matches the available sources.", explanation: "Forecasts remain assumptions. No extra lookup or model call was made." });
    return finish();
  }
  Object.assign(base, { claimId: target.claim.claimId, claim: target.claim.exactText, beforeStatus: target.claim.status, reason: target.reason, nextFact: target.claim.missingEvidence ?? `A dated record directly addressing: ${target.claim.exactText}` });
  if (mode === "captured_real") {
    Object.assign(base, { status: "captured_only", explanation: "Historical replay uses only its frozen sources. Current records were not fetched into this past assessment." });
    return finish();
  }
  const signal = AbortSignal.timeout(INVESTIGATION_LOOKUP_DEADLINE_MS);
  const result = await lookupInvestigation(target.source, plan.asset, target.claim.exactText, asOf, signal);
  base.lookups = result.lookups;
  addedSources = result.sources;
  if (!addedSources.length) {
    const failed = result.lookups.some((item) => item.status === "failed");
    Object.assign(base, { status: failed ? "lookup_failed" : "no_relevant_evidence", explanation: failed ? "The targeted lookup failed. The original assessment is retained; failure is not contradictory evidence." : "No relevant evidence was found in the bounded lookup. No contradiction found does not mean the claim is supported." });
    return finish();
  }
  // Data-source limits cannot be overcome by an LLM interpretation.
  if ((target.source === "revenue" && /\b(?:deal|contract|customer|deployment|partnership|product|gpu|aws)\b/i.test(target.claim.exactText)) || (target.source === "filings" && !/\b(?:filed|filing date|submitted)\b/i.test(target.claim.exactText))) {
    Object.assign(base, { status: "insufficient", explanation: target.source === "revenue" ? "The SEC facts report consolidated revenue. They do not establish revenue from this particular deal, customer or deployment." : "Filing metadata establishes dates and document identity, not the contents of the filing.", nextFact: "A passage in the actual filing explicitly establishing this specific claim." });
    return finish();
  }
  // Repeating an already supplied packet has no incremental research value.
  if (addedSources.every((source) => originalSources.some((existing) => existing.textHash === source.textHash))) {
    Object.assign(base, { status: "no_relevant_evidence", explanation: "The lookup returned evidence already reviewed. No additional assessment call was needed." });
    base.lookups = base.lookups.map((lookup) => ({ ...lookup, sourceIds: lookup.sourceIds.flatMap((id) => {
      const found = addedSources.find((source) => source.id === id);
      const existing = originalSources.find((source) => source.textHash === found?.textHash);
      return existing ? [existing.id] : [];
    }) }));
    addedSources = [];
    return finish();
  }
  try {
    const citedIds = new Set(target.claim.citations.map((citation) => citation.sourceId));
    const packet = [...originalSources.filter((source) => citedIds.has(source.id)).slice(0, 3), ...addedSources];
    // A second provider call needs its own idempotent reservation, never the base brief's spend slot.
    const assessed = await assessClaims({ ...plan, thesis: target.claim.exactText }, packet, { ...context, requestId: `${context.requestId}:investigation-v1` }, asOf, { timeoutMs: 12_000 });
    const reference = referenceDay(asOf, plan.horizon.timezone);
    Object.assign(base, { modelId: assessed.modelId, promptVersion: assessed.promptVersion, modelDurationMs: assessed.performance.modelDurationMs, modelCalls: assessed.performance.modelCalls, modelUsage: assessed.performance.modelUsage });
    base.inputHash = await evidenceInputHash({ ...plan, thesis: target.claim.exactText }, packet, assessed.promptVersion, assessed.modelId, { referenceDay: reference.date, timezone: reference.timezone, validationVersion: EVIDENCE_VALIDATION_VERSION, investigationVersion: base.version });
    // Do not substitute a narrower, easier claim for the question under investigation.
    const canonical = (text: string) => text.toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ").trim();
    const answer = assessed.claims.find((claim) => canonical(claim.exactText) === canonical(target.claim.exactText));
    const newlyRetrievedIds = new Set(addedSources.filter((source) => !originalSources.some((existing) => existing.textHash === source.textHash)).map((source) => source.id));
    const usesNewEvidence = answer?.citations.some((citation) => newlyRetrievedIds.has(citation.sourceId));
    if (assessed.claims.length !== 1 || !answer || answer.distinction !== "factual" || (answer.status !== "insufficient" && !usesNewEvidence)) {
      Object.assign(base, { status: "insufficient", explanation: "The additional assessment did not resolve the exact factual claim. The original review is retained." });
    } else {
      Object.assign(base, { status: answer.status, assessment: answer.status === "insufficient" ? null : { ...answer, claimId: target.claim.claimId, exactText: target.claim.exactText, materiality: target.claim.materiality }, explanation: answer.explanation, nextFact: answer.missingEvidence ?? (answer.status === "supported" ? "A newer authoritative record that revises this fact would change the assessment." : "An authoritative record directly resolving the disagreement.") });
    }
  } catch (error) {
    const failure = error instanceof ModelAdapterError ? error : null;
    Object.assign(base, {
      status: "assessment_unavailable", explanation: "Evidence was retrieved, but the additional assessment could not complete. The original review and trade math remain available.",
      modelId: failure?.modelId ?? null, modelCalls: failure?.attempted ? 1 : 0, modelUsage: failure?.usage ?? null,
      modelDurationMs: failure?.durationMs ?? 0,
    });
  }
  return finish();
}
