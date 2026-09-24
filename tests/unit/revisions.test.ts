import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { economicsInputHash, evidenceInputHash, revisionReducer } from "../../src/domain/revisions";
import { missingEconomics, syntheticInstrument, syntheticSnapshot } from "../../src/domain/economics";
import { FORMULA_VERSION, PROMPT_VERSION, SCHEMA_VERSION, type Plan, type ResearchResult, type SourceDocument } from "../../src/domain/contracts";
import type { WorkbenchState } from "../../src/domain/revisions";

const plan: Plan = {
  asset: "NVDA",
  category: "SPOT",
  side: "long",
  quoteCurrency: "USDT",
  thesis: "A precise claim.",
  purchaseNotionalExcludingFee: "10000",
  horizon: { originalText: "tomorrow", endAtUTC: null, timezone: null },
  goal: { kind: "profit_usdt", amount: "100" },
  exitAssumptions: { depthMultiplier: "1", priceHaircut: "0", depthOrigin: "illustrative_preset", haircutOrigin: "illustrative_preset" },
  scenario: { bidPriceShift: "0.003", assumptionOrigin: "illustrative_preset" },
  invalidation: null,
  feeIn: "0.001",
  feeOut: "0.001",
  feeOrigin: "published_standard_assumption",
};

const source: SourceDocument = {
  id: "source_test1234", originalUrl: null, finalApprovedUrl: null,
  title: "Pasted source", publisher: "User supplied source",
  publicationDate: null, publicationDatePrecision: "unknown", eventDate: null,
  fetchedAt: "2026-09-09T00:00:00.000Z", cleanedText: "A precise source passage.",
  textHash: "source-hash", provenance: "user_pasted_unverified", truncated: false,
};

function partialReport(): ResearchResult {
  return {
    reportId: "report_test1234", inputRevision: 1, reportRevision: 1,
    schemaVersion: SCHEMA_VERSION, formulaVersion: FORMULA_VERSION, promptVersion: PROMPT_VERSION,
    evidenceInputHash: "evidence-hash", economicsInputHash: null, modelId: null,
    confirmedPlan: plan, instrument: null, snapshot: null, recomputeToken: null,
    sources: [source], headlineIds: [], marketContext: null, claims: [],
    evidence: {
      status: "unavailable", assessmentOrigin: "unavailable", verdict: "not_assessed",
      scope: "by the supplied evidence", mostConsequentialUnknown: "Evidence not assessed", summary: "Evidence unavailable",
    },
    economics: missingEconomics(plan, 1, 1, "Market unavailable"),
    performance: {
      totalDurationMs: 0, marketDurationMs: 0, modelDurationMs: null, modelCalls: 0,
      modelRunStatus: "not_attempted", modelUsage: null, reusedEvidence: false,
    },
    partialErrors: [{ kind: "market_unavailable", message: "Market unavailable", recovery: "Retry market data" }],
    generatedAt: "2026-09-09T00:00:00.000Z", limitations: [],
  };
}

const state: WorkbenchState = {
  plan,
  sourceText: "source",
  sourceUrl: "",
  selectedHeadlineIds: [],
  marketMode: "captured_real",
  reportMarketMode: null,
  planRevision: 1,
  thesisRevision: 1,
  scenarioRevision: 1,
  activeRequestId: 2,
  requestState: "submitting",
  report: null,
  errorMessage: null,
  changedMessage: null,
  followUpMessage: "",
};

describe("revision safety", () => {
  it("ignores a late response from an older request", () => {
    const next = revisionReducer(state, { type: "request-success", requestId: 1, report: partialReport(), requestedMarketMode: "captured_real" });
    expect(next).toBe(state);
    expect(revisionReducer(state, { type: "request-error", requestId: 1, message: "Old error" })).toBe(state);
  });

  it("keeps economics changes out of the evidence binding", async () => {
    const changed = { ...plan, purchaseNotionalExcludingFee: "5000" };
    const sources = [{ textHash: "source-hash", provenance: "user_pasted_unverified" as const, publicationDate: null, eventDate: null, publicationDatePrecision: "unknown" as const }];
    expect(await evidenceInputHash(plan, sources, "claims-v1", "model-a")).toBe(await evidenceInputHash(changed, sources, "claims-v1", "model-a"));
    expect(await evidenceInputHash(plan, [{ ...sources[0], eventDate: "2026-09-08" }], "claims-v1", "model-a")).not.toBe(await evidenceInputHash(plan, sources, "claims-v1", "model-a"));
    expect(await economicsInputHash(plan, syntheticInstrument(), syntheticSnapshot(), FORMULA_VERSION)).not.toBe(
      await economicsInputHash(changed, syntheticInstrument(), syntheticSnapshot(), FORMULA_VERSION),
    );
  });

  it("invalidates an in-flight response when a saved draft is restored", () => {
    const restoring = revisionReducer({ ...state, report: partialReport(), reportMarketMode: "live" }, {
      type: "restore-draft",
      plan,
      sourceText: "restored source",
      sourceUrl: "",
      marketMode: "captured_real",
      changedMessage: "Saved draft restored.",
    });
    expect(restoring.reportMarketMode).toBeNull();
    expect(restoring.planRevision).toBe(2);
    expect(restoring.thesisRevision).toBe(2);
    expect(restoring.scenarioRevision).toBe(2);
    expect(restoring.report).toBeNull();
    expect(restoring.requestState).toBe("idle");
    expect(restoring.activeRequestId).toBe(state.activeRequestId + 1);
    expect(revisionReducer(restoring, { type: "request-success", requestId: state.activeRequestId, report: partialReport(), requestedMarketMode: "captured_real" })).toBe(restoring);
    expect(revisionReducer(restoring, { type: "request-error", requestId: state.activeRequestId, message: "Late error" })).toBe(restoring);
  });

  it("marks a snapshotless partial report current for its requested market mode", () => {
    const report = partialReport();
    const withReport = revisionReducer(
      { ...state, marketMode: "live" },
      { type: "request-success", requestId: 2, report, requestedMarketMode: "live" },
    );
    expect(withReport.report).toBe(report);
    expect(withReport.report?.snapshot).toBeNull();
    expect(withReport.reportMarketMode).toBe(withReport.marketMode);
    expect(withReport.requestState).toBe("idle");
    const switched = revisionReducer(withReport, { type: "set-market-mode", marketMode: "captured_real" });
    expect(switched.reportMarketMode).toBe("live");
    expect(switched.reportMarketMode).not.toBe(switched.marketMode);
  });

  it("does not relabel an older-mode request when the selected mode changes during flight", () => {
    const switched = revisionReducer(state, { type: "set-market-mode", marketMode: "live" });
    const completed = revisionReducer(switched, { type: "request-success", requestId: 2, report: partialReport(), requestedMarketMode: "captured_real" });
    expect(completed.marketMode).toBe("live");
    expect(completed.reportMarketMode).toBe("captured_real");
    const newer = revisionReducer(completed, { type: "begin-request", requestId: 3, requestState: "refreshing" });
    expect(revisionReducer(newer, { type: "request-success", requestId: 2, report: partialReport(), requestedMarketMode: "captured_real" })).toBe(newer);
  });

  it("tracks scenario changes separately from evidence revisions", () => {
    const scenario = revisionReducer(state, { type: "set-plan", plan: { ...plan, purchaseNotionalExcludingFee: "5000" }, changedMessage: "Notional changed", evidenceChanged: false });
    expect(scenario).toMatchObject({ planRevision: 2, thesisRevision: 1, scenarioRevision: 2 });
    const thesis = revisionReducer(scenario, { type: "set-plan", plan: { ...scenario.plan, thesis: "Changed claim" }, changedMessage: "Thesis changed", evidenceChanged: true });
    expect(thesis).toMatchObject({ planRevision: 3, thesisRevision: 2, scenarioRevision: 2 });
  });
});

describe("semantic input fingerprints", () => {
  it("uses versioned SHA-256 of the explicit evidence projection", async () => {
    const sources = [{ textHash: source.textHash, provenance: source.provenance, publicationDate: source.publicationDate, eventDate: source.eventDate, publicationDatePrecision: source.publicationDatePrecision }];
    const expected = createHash("sha256").update(JSON.stringify({
      asset: plan.asset, thesis: plan.thesis, sources, horizon: plan.horizon,
      invalidation: plan.invalidation, promptVersion: "claims-v1", modelVersion: "model-a",
    })).digest("hex");
    expect(await evidenceInputHash(plan, [source], "claims-v1", "model-a")).toBe(`evidence-v2:sha256:${expected}`);
    expect(await economicsInputHash(plan, syntheticInstrument(), syntheticSnapshot(), FORMULA_VERSION)).toMatch(/^economics-v2:sha256:[a-f0-9]{64}$/);
  });

  it("keeps evidence stable for full source objects, metadata changes and key order", async () => {
    const expected = await evidenceInputHash(plan, [source], "claims-v1", "model-a");
    const changedMetadata = { ...source, id: "source_new1234", title: "New title", fetchedAt: "2026-09-10T00:00:00.000Z" };
    expect(await evidenceInputHash(plan, [changedMetadata], "claims-v1", "model-a")).toBe(expected);
    expect(await evidenceInputHash(plan, [{ publicationDatePrecision: source.publicationDatePrecision, eventDate: source.eventDate, publicationDate: source.publicationDate, provenance: source.provenance, textHash: source.textHash }], "claims-v1", "model-a")).toBe(expected);
    expect(await evidenceInputHash(plan, [source], "claims-v2", "model-a")).not.toBe(expected);
    expect(await evidenceInputHash(plan, [source], "claims-v1", "model-b")).not.toBe(expected);
  });

  it.each([
    { textHash: "different-hash" },
    { provenance: "retrieved_official" as const },
    { publicationDate: "2026-09-08" },
    { eventDate: "2026-09-08" },
    { publicationDatePrecision: "day" as const },
  ])("changes evidence binding for source semantics %j", async (change) => {
    expect(await evidenceInputHash(plan, [{ ...source, ...change }], "claims-v1", "model-a"))
      .not.toBe(await evidenceInputHash(plan, [source], "claims-v1", "model-a"));
  });

  it("canonicalizes economics numeric inputs and excludes incidental metadata and origins", async () => {
    const instrument = syntheticInstrument();
    const snapshot = syntheticSnapshot();
    const equivalent: Plan = {
      ...plan, thesis: "Unrelated thesis", purchaseNotionalExcludingFee: "1e4", feeIn: ".0010", feeOut: "1e-3",
      feeOrigin: "user_supplied", goal: { kind: "profit_usdt", amount: "100.00" },
      exitAssumptions: { depthMultiplier: "1.0", priceHaircut: "-0", depthOrigin: "user", haircutOrigin: "user" },
      scenario: { bidPriceShift: "3e-3", assumptionOrigin: "user" },
    };
    expect(await economicsInputHash(equivalent, {
      ...instrument, quantityStep: ".010", priceTick: "1e-2", minOrderQty: "0.0100", maxOrderQty: "-0",
      minOrderNotional: "10.0", maxPositionQty: "0e3", rawMetadataTime: "2026-09-10T00:00:00.000Z",
    }, {
      ...snapshot, id: "snapshot_changed", hash: "different-hash", receivedAt: "2026-09-10T00:00:00.000Z",
      exchangeTimestamp: "2026-09-10T00:00:00.000Z", rawResponseReference: "different-reference", mode: "live",
      bids: [["99.0", "2.00"], ["98.00", "3e0"]], asks: [["1e2", "2"], ["101.0", "3.0"]],
    }, FORMULA_VERSION)).toBe(await economicsInputHash(plan, instrument, snapshot, FORMULA_VERSION));
  });

  it("binds actual order-book levels and venue rules rather than trusting snapshot hashes", async () => {
    const instrument = syntheticInstrument();
    const snapshot = syntheticSnapshot();
    const original = await economicsInputHash(plan, instrument, snapshot, FORMULA_VERSION);
    expect(await economicsInputHash(plan, instrument, { ...snapshot, asks: [["102", "5"]] }, FORMULA_VERSION)).not.toBe(original);
    expect(await economicsInputHash(plan, { ...instrument, quantityStep: "0.1" }, snapshot, FORMULA_VERSION)).not.toBe(original);
    expect(await economicsInputHash(plan, { ...instrument, symbol: "OTHERUSDT" }, snapshot, FORMULA_VERSION)).not.toBe(original);
    expect(await economicsInputHash(plan, instrument, snapshot, "economics-next")).not.toBe(original);
    expect(await economicsInputHash({ ...plan, scenario: null }, instrument, snapshot, FORMULA_VERSION)).not.toBe(original);
  });

  it("canonicalizes net-return goals without collapsing different goal kinds", async () => {
    const instrument = syntheticInstrument();
    const snapshot = syntheticSnapshot();
    const first = await economicsInputHash({ ...plan, goal: { kind: "net_return", fractionOfEntryCash: "0.10" } }, instrument, snapshot, FORMULA_VERSION);
    expect(await economicsInputHash({ ...plan, goal: { kind: "net_return", fractionOfEntryCash: "1e-1" } }, instrument, snapshot, FORMULA_VERSION)).toBe(first);
    expect(await economicsInputHash({ ...plan, goal: { kind: "profit_usdt", amount: "0.1" } }, instrument, snapshot, FORMULA_VERSION)).not.toBe(first);
  });
});
