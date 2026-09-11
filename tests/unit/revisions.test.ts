import { describe, expect, it } from "vitest";
import { economicsInputHash, evidenceInputHash, revisionReducer } from "../../src/domain/revisions";
import { syntheticInstrument, syntheticSnapshot } from "../../src/domain/economics";
import type { Plan } from "../../src/domain/contracts";
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

const state: WorkbenchState = {
  plan,
  sourceText: "source",
  sourceUrl: "",
  marketMode: "captured_real",
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
    const next = revisionReducer(state, { type: "request-success", requestId: 1, report: {} as never });
    expect(next).toBe(state);
  });

  it("keeps economics changes out of the evidence binding", () => {
    const changed = { ...plan, purchaseNotionalExcludingFee: "5000" };
    const sources = [{ textHash: "source-hash", provenance: "user_pasted_unverified" as const, publicationDate: null, eventDate: null, publicationDatePrecision: "unknown" as const }];
    expect(evidenceInputHash(plan, sources, "claims-v1", "model-a")).toBe(evidenceInputHash(changed, sources, "claims-v1", "model-a"));
    expect(evidenceInputHash(plan, [{ ...sources[0], eventDate: "2026-09-08" }], "claims-v1", "model-a")).not.toBe(evidenceInputHash(plan, sources, "claims-v1", "model-a"));
    expect(economicsInputHash(plan, syntheticInstrument(), syntheticSnapshot(), "economics-v1")).not.toBe(
      economicsInputHash(changed, syntheticInstrument(), syntheticSnapshot(), "economics-v1"),
    );
  });

  it("invalidates an in-flight response when a saved draft is restored", () => {
    const restoring = revisionReducer(state, {
      type: "restore-draft",
      plan,
      sourceText: "restored source",
      sourceUrl: "",
      marketMode: "captured_real",
      changedMessage: "Saved draft restored.",
    });
    expect(restoring.report).toBeNull();
    expect(restoring.requestState).toBe("idle");
    expect(restoring.activeRequestId).toBe(state.activeRequestId + 1);
    expect(revisionReducer(restoring, { type: "request-success", requestId: state.activeRequestId, report: {} as never })).toBe(restoring);
  });
});
