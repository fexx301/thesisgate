import { describe, expect, it } from "vitest";
import { calculateEconomics, syntheticInstrument, syntheticSnapshot } from "../../src/domain/economics";
import { toJson, toMarkdown } from "../../src/domain/export";
import type { Plan, ResearchResult } from "../../src/domain/contracts";
import { FORMULA_VERSION, PROMPT_VERSION, SCHEMA_VERSION } from "../../src/domain/contracts";

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    asset: "NVDA",
    category: "SPOT",
    side: "long",
    quoteCurrency: "USDT",
    thesis: "Planned deployment is not current revenue.",
    purchaseNotionalExcludingFee: "200",
    horizon: { originalText: "until tomorrow evening", endAtUTC: null, timezone: null },
    goal: { kind: "profit_usdt", amount: "10" },
    exitAssumptions: {
      depthMultiplier: "1",
      priceHaircut: "0",
      depthOrigin: "illustrative_preset",
      haircutOrigin: "illustrative_preset",
    },
    scenario: { bidPriceShift: "0.01", assumptionOrigin: "illustrative_preset" },
    invalidation: "Fails if source shows no plan",
    feeIn: "0.001",
    feeOut: "0.001",
    feeOrigin: "published_standard_assumption",
    ...overrides,
  };
}

function report(): ResearchResult {
  const p = plan();
  const instrument = syntheticInstrument();
  const snapshot = syntheticSnapshot();
  const economics = calculateEconomics({ plan: p, instrument, snapshot, planRevision: 1, scenarioRevision: 1 });
  return {
    reportId: "report_test1234",
    inputRevision: 1,
    reportRevision: 1,
    schemaVersion: SCHEMA_VERSION,
    formulaVersion: FORMULA_VERSION,
    promptVersion: PROMPT_VERSION,
    evidenceInputHash: "abcdef1234567890",
    economicsInputHash: "1234567890abcdef",
    modelId: null,
    confirmedPlan: p,
    instrument,
    snapshot,
    recomputeToken: null,
    sources: [
      {
        id: "src_test1234",
        originalUrl: null,
        finalApprovedUrl: null,
        title: "Pasted source text",
        publisher: "User supplied source",
        publicationDate: null,
        publicationDatePrecision: "unknown",
        eventDate: null,
        fetchedAt: "2026-09-09T00:00:00.000Z",
        cleanedText: "NVIDIA and AWS planned deployment.",
        textHash: "abc123def4567890",
        provenance: "user_pasted_unverified",
        truncated: false,
      },
    ],
    claims: [],
    evidence: {
      status: "unavailable",
      assessmentOrigin: "unavailable",
      verdict: "not_assessed",
      scope: "by the supplied evidence",
      mostConsequentialUnknown: "No assessment",
      summary: "No assessment",
    },
    economics,
    performance: {
      totalDurationMs: 10,
      marketDurationMs: 5,
      modelDurationMs: null,
      modelCalls: 0,
      modelRunStatus: "not_attempted",
      modelUsage: null,
      reusedEvidence: false,
    },
    partialErrors: [],
    generatedAt: "2026-09-09T00:00:00.000Z",
    limitations: ["Test limitation"],
  };
}

describe("deterministic export", () => {
  it("markdown includes origins, hashes, effective shift and invalidation", () => {
    const md = toMarkdown(report());
    expect(md).toContain("origin:");
    expect(md).toContain("Evidence input hash");
    expect(md).toContain("Economics input hash");
    expect(md).toContain("Snapshot hash");
    expect(md).toContain("Effective shift");
    expect(md).toContain("Effective stressed price shift");
    expect(md).toContain("Invalidation:");
    expect(md).toContain("Visible entry capacity");
    expect(md).toContain("Visible exit capacity");
    expect(md).toContain("What could change this assessment");
  });

  it("json export retains all validated audit data while stripping a real recompute token", () => {
    const original = report();
    original.recomputeToken = `v1.${"a".repeat(64)}.${"b".repeat(43)}`;
    const json = JSON.parse(toJson(original));
    expect("recomputeToken" in json).toBe(false);
    const { recomputeToken, ...expected } = original;
    expect(json).toEqual(expected);
    expect(toMarkdown(original)).not.toContain(recomputeToken);
    expect(original.recomputeToken).toBe(recomputeToken);
  });

  it("markdown preserves every calculator warning including out-of-band thresholds", () => {
    const original = report();
    original.confirmedPlan.goal = { kind: "profit_usdt", amount: "1000" };
    original.economics = calculateEconomics({ plan: original.confirmedPlan, instrument: original.instrument!, snapshot: original.snapshot!, planRevision: 1, scenarioRevision: 1 });
    const md = toMarkdown(original);
    expect(original.economics.warnings.some((warning) => warning.includes("outside the ±3% scenario band"))).toBe(true);
    for (const warning of original.economics.warnings) expect(md).toContain(`- ${warning}`);
  });

  it("markdown exposes quantities and unspent cash instead of implying the whole budget was deployed", () => {
    const original = report();
    original.confirmedPlan.purchaseNotionalExcludingFee = "200.5";
    original.economics = calculateEconomics({ plan: original.confirmedPlan, instrument: original.instrument!, snapshot: original.snapshot!, planRevision: 1, scenarioRevision: 1 });
    const md = toMarkdown(original);
    expect(md).toContain("Requested notional: 200.5 USDT");
    expect(md).toContain("Rounded quantity: 2 synthetic");
    expect(md).toContain("Spent notional: 200 USDT");
    expect(md).toContain("Unspent notional: 0.5 USDT");
    expect(md).toContain("Matched exit quantity: 2 synthetic");
    expect(md).toContain("Unmatched exit quantity: 0 synthetic");
  });

  it("markdown shows partial exit coverage and the actual instrument rules", () => {
    const original = report();
    const instrument = { ...syntheticInstrument(), symbol: "ACTUALUSDT", baseCoin: "actual", priceTick: "0.005", maxOrderQty: "20", maxPositionQty: "30" };
    const snapshot = { ...syntheticSnapshot(), symbol: instrument.symbol };
    original.instrument = instrument;
    original.snapshot = snapshot;
    original.confirmedPlan.exitAssumptions.depthMultiplier = "0.2";
    original.economics = calculateEconomics({ plan: original.confirmedPlan, instrument, snapshot, planRevision: 1, scenarioRevision: 1 });
    const md = toMarkdown(original);
    expect(md).toContain("Instrument symbol: ACTUALUSDT");
    expect(md).toContain("Base / quote: actual / USDT");
    expect(md).toContain("Venue status: online");
    expect(md).toContain("Quantity step: 0.01 actual");
    expect(md).toContain("Price tick: 0.005 USDT");
    expect(md).toContain("Minimum order quantity: 0.01 actual");
    expect(md).toContain("Maximum order quantity: 20 actual");
    expect(md).toContain("Minimum order notional: 10 USDT");
    expect(md).toContain("Maximum position quantity: 30 actual");
    expect(md).toContain("Matched exit quantity: 1 actual");
    expect(md).toContain("Unmatched exit quantity: 1 actual");
    expect(md).toContain("No whole-position PnL is shown.");
    expect(md).toContain("Selected scenario PnL: Not available");
  });

  it("rejects invalid result data rather than exporting an apparently valid audit artifact", () => {
    const invalid = report();
    invalid.economics.quantity = "NaN";
    expect(() => toJson(invalid)).toThrow();
    expect(() => toMarkdown(invalid)).toThrow();
  });

  it("markdown scenario table has effective-shift and status columns", () => {
    const md = toMarkdown(report());
    expect(md).toContain("| Scenario | Bid-price shift | Effective shift | Net PnL | Goal comparison | Status |");
  });
});
