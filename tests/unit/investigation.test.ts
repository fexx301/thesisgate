import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { investigateClaim } from "../../src/server/investigation";
import { lookupInvestigation } from "../../src/server/investigation-sources";
import { assessClaims, ModelAdapterError } from "../../src/server/model";
import { selectInvestigationClaim } from "../../src/domain/investigation";
import type { ClaimAssessment, Plan, SourceDocument } from "../../src/domain/contracts";

vi.mock("../../src/server/investigation-sources", () => ({ lookupInvestigation: vi.fn() }));
vi.mock("../../src/server/model", async (original) => ({ ...await original<typeof import("../../src/server/model")>(), assessClaims: vi.fn() }));
const claim: ClaimAssessment = { claimId: "c1", exactText: "Tesla reported earnings today", distinction: "factual", materiality: "material", status: "insufficient", explanation: "Not in the selected source", citations: [], missingEvidence: "A dated earnings record." };
const plan = { asset: "TSLA", thesis: claim.exactText, horizon: { timezone: null } } as Plan;
const source: SourceDocument = { id: "src_lookup", originalUrl: null, finalApprovedUrl: null, title: "Tesla earnings calendar", publisher: "Bitget market data", publicationDate: "2026-07-22", publicationDatePrecision: "day", eventDate: null, fetchedAt: "2026-10-03T12:00:00Z", cleanedText: "Most recent results: reported 2026-07-22.", textHash: "lookuphash123", provenance: "retrieved_platform_data", truncated: false };
const context = { requestId: "test", visitorKey: "test" };
const asOf = new Date("2026-10-03T12:00:00Z");
const run = (claims = [claim], mode: "live" | "captured_real" = "live") => investigateClaim(plan, claims, [], mode, asOf, context);
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("THESIS_INVESTIGATION_ENABLED", "true"); });
afterEach(() => vi.unstubAllEnvs());

describe("bounded factual investigation", () => {
  it.each(["false", "", "TRUE"])("makes zero extra lookups and model calls when flag is %s", async (flag) => {
    vi.stubEnv("THESIS_INVESTIGATION_ENABLED", flag);
    expect((await run()).investigation.status).toBe("disabled");
    expect(lookupInvestigation).not.toHaveBeenCalled(); expect(assessClaims).not.toHaveBeenCalled();
  });
  it("prefers unresolved material factual claims, skipping forecasts, context, and settled date checks", () => {
    expect(selectInvestigationClaim([{ ...claim, distinction: "forecast" }, { ...claim, materiality: "contextual" }], "TSLA")).toBeNull();
    expect(selectInvestigationClaim([{ ...claim, exactText: "Tesla will report earnings today" }], "TSLA")).toBeNull();
    expect(selectInvestigationClaim([{ ...claim, status: "contradicted", claimId: "old" }, claim], "TSLA")?.claim.claimId).toBe("c1");
  });
  it("never mixes current sources into a historical replay", async () => {
    expect((await run([claim], "captured_real")).investigation.status).toBe("captured_only");
    expect(lookupInvestigation).not.toHaveBeenCalled(); expect(assessClaims).not.toHaveBeenCalled();
  });
  it.each(["failed", "empty"] as const)("preserves the original claim when lookup is %s", async (status) => {
    vi.mocked(lookupInvestigation).mockResolvedValue({ sources: [], lookups: [{ source: "Bitget earnings", status, detail: status, sourceIds: [] }] });
    const result = await run();
    expect(result.investigation.status).toBe(status === "failed" ? "lookup_failed" : "no_relevant_evidence");
    expect(result.investigation.assessment).toBeNull(); expect(assessClaims).not.toHaveBeenCalled();
    expect(claim.status).toBe("insufficient");
  });
  it.each(["supported", "contradicted", "insufficient"] as const)("records a cited %s result with one bounded assessment", async (status) => {
    vi.mocked(lookupInvestigation).mockResolvedValue({ sources: [source], lookups: [{ source: "Bitget earnings", status: "found", detail: "Retrieved", sourceIds: [source.id] }] });
    vi.mocked(assessClaims).mockResolvedValue({ claims: [{ ...claim, status, materiality: "contextual", citations: [{ sourceId: source.id, excerpt: source.cleanedText, startOffset: 0, endOffset: source.cleanedText.length }] }], evidence: {} as never, modelId: "test-model", promptVersion: "test", performance: { modelCalls: 1, modelDurationMs: 8, modelUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: "0.001" } } });
    const result = await run();
    expect(result.investigation).toMatchObject({ status, claim: claim.exactText, beforeStatus: "insufficient", modelCalls: 1 });
    expect(result.sources).toEqual([source]);
    expect(lookupInvestigation).toHaveBeenCalledExactlyOnceWith("earnings", "TSLA", claim.exactText, asOf, expect.any(AbortSignal));
    expect(assessClaims).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ thesis: claim.exactText }), [source], { ...context, requestId: "test:investigation-v1" }, asOf, { timeoutMs: 12000 });
    if (status === "insufficient") expect(result.investigation.assessment).toBeNull();
    else expect(result.investigation.assessment?.materiality).toBe("material");
    expect(result.investigation.inputHash).toMatch(/^evidence-v3:sha256:/);
    expect(result.investigation.modelDurationMs).toBe(8);
  });
  it("never converts consolidated revenue into proof of deal revenue", async () => {
    vi.mocked(lookupInvestigation).mockResolvedValue({ sources: [source], lookups: [{ source: "SEC revenue", status: "found", detail: "Retrieved", sourceIds: [source.id] }] });
    const result = await run([{ ...claim, exactText: "The AWS deal already generated revenue" }]);
    expect(result.investigation.status).toBe("insufficient");
    expect(result.investigation.explanation).toContain("consolidated revenue");
    expect(assessClaims).not.toHaveBeenCalled();
    expect(result.investigation.assessment).toBeNull();
  });

  it("retains an existing contradiction when new consolidated revenue cannot resolve it", async () => {
    vi.mocked(lookupInvestigation).mockResolvedValue({ sources: [source], lookups: [] });
    const original = { ...claim, status: "contradicted" as const, exactText: "The AWS deal generated revenue", citations: [{ sourceId: "src_original", excerpt: "no revenue", startOffset: 0, endOffset: 10 }] };
    const result = await run([original]);
    expect(result.investigation.status).toBe("insufficient");
    expect(result.investigation.assessment).toBeNull();
    expect(original.citations).toHaveLength(1);
  });

  it("remaps repeated evidence to the original source IDs without a second model call", async () => {
    vi.mocked(lookupInvestigation).mockResolvedValue({ sources: [source], lookups: [{ source: "Bitget earnings", status: "found", detail: "Retrieved", sourceIds: [source.id] }] });
    const original = { ...source, id: "src_original" };
    const result = await investigateClaim(plan, [claim], [original], "live", asOf, context);
    expect(result.sources).toEqual([]);
    expect(result.investigation.lookups[0].sourceIds).toEqual([original.id]);
    expect(assessClaims).not.toHaveBeenCalled();
  });
  it("retains attempted provider cost when the optional assessment fails", async () => {
    vi.mocked(lookupInvestigation).mockResolvedValue({ sources: [source], lookups: [] });
    vi.mocked(assessClaims).mockRejectedValue(new ModelAdapterError("model_timeout", "timeout", { attempted: true, durationMs: 12000, modelId: "test", usage: { costUsd: "0.01", promptTokens: null, completionTokens: null, totalTokens: null } }));
    const result = await run();
    expect(result.investigation).toMatchObject({ status: "assessment_unavailable", modelCalls: 1, modelUsage: { costUsd: "0.01" }, assessment: null });
  });
  it("does not accept an answer that quietly narrows the investigated claim", async () => {
    vi.mocked(lookupInvestigation).mockResolvedValue({ sources: [source], lookups: [] });
    vi.mocked(assessClaims).mockResolvedValue({ claims: [{ ...claim, exactText: "Tesla reported earnings", status: "supported" }], evidence: {} as never, modelId: "test", promptVersion: "test", performance: { modelCalls: 1, modelDurationMs: 8, modelUsage: null } });
    expect((await run()).investigation).toMatchObject({ status: "insufficient", assessment: null });
  });

  it("requires new-source citations, not another judgment of old evidence", async () => {
    vi.mocked(lookupInvestigation).mockResolvedValue({ sources: [source], lookups: [] });
    vi.mocked(assessClaims).mockResolvedValue({ claims: [{ ...claim, status: "supported", citations: [{ sourceId: "src_old", excerpt: "old evidence", startOffset: 0, endOffset: 12 }] }], evidence: {} as never, modelId: "test", promptVersion: "test", performance: { modelCalls: 1, modelDurationMs: 8, modelUsage: null } });
    expect((await run()).investigation).toMatchObject({ status: "insufficient", assessment: null });
  });

  it("rejects an exact headline answer followed by extra unresolved subclaims", async () => {
    vi.mocked(lookupInvestigation).mockResolvedValue({ sources: [source], lookups: [] });
    vi.mocked(assessClaims).mockResolvedValue({ claims: [{ ...claim, status: "supported", citations: [{ sourceId: source.id, excerpt: source.cleanedText, startOffset: 0, endOffset: source.cleanedText.length }] }, { ...claim, claimId: "c2", exactText: "The report was today", status: "insufficient" }], evidence: {} as never, modelId: "test", promptVersion: "test", performance: { modelCalls: 1, modelDurationMs: 8, modelUsage: null } });
    expect((await run()).investigation).toMatchObject({ status: "insufficient", assessment: null });
  });
});
