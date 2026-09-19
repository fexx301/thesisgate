import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { calculateEconomics, syntheticInstrument, syntheticSnapshot } from "../../src/domain/economics";
import type { Plan } from "../../src/domain/contracts";
import { createCapturedMarket } from "../../src/server/bitget";

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    asset: "NVDA",
    category: "SPOT",
    side: "long",
    quoteCurrency: "USDT",
    thesis: "A source claim should be assessed independently from the price scenario.",
    purchaseNotionalExcludingFee: "200",
    horizon: { originalText: "until tomorrow evening", endAtUTC: null, timezone: null },
    goal: { kind: "break_even" },
    exitAssumptions: {
      depthMultiplier: "1",
      priceHaircut: "0",
      depthOrigin: "illustrative_preset",
      haircutOrigin: "illustrative_preset",
    },
    scenario: { bidPriceShift: "0.01", assumptionOrigin: "illustrative_preset" },
    invalidation: null,
    feeIn: "0.001",
    feeOut: "0.001",
    feeOrigin: "published_standard_assumption",
    ...overrides,
  };
}

describe("deterministic decimal economics", () => {
  it("matches the hand-calculated synthetic book", () => {
    const result = calculateEconomics({
      plan: plan(),
      instrument: syntheticInstrument(),
      snapshot: syntheticSnapshot(),
      planRevision: 1,
      scenarioRevision: 1,
    });

    expect(result.computationStatus).toBe("calculated");
    expect(result.quantity).toBe("2");
    expect(result.spentNotional).toBe("200");
    expect(result.entryCash).toBe("200.2");
    expect(result.modeledExitGross).toBe("198");
    expect(result.modeledExitNet).toBe("197.802");
    expect(result.frictionProxy).toBe("2.398");
    expect(result.netPnl).toBe("-0.41998");
    expect(result.netReturn).toBe("-0.0020978021978021978022");
  });

  it("reaches break-even when the returned threshold is substituted", () => {
    const result = calculateEconomics({
      plan: plan({ scenario: null }),
      instrument: syntheticInstrument(),
      snapshot: syntheticSnapshot(),
      planRevision: 1,
      scenarioRevision: 2,
    });
    const threshold = new Decimal(result.breakEvenShift ?? "0");
    const baseExit = new Decimal(result.modeledExitGross ?? "0");
    const entryCash = new Decimal(result.entryCash ?? "0");
    const exitNet = baseExit.mul(threshold.plus(1)).mul(new Decimal("0.999"));
    expect(exitNet.minus(entryCash).abs().lt("0.0000000001")).toBe(true);
  });

  it("returns a threshold-only result when the goal has no scenario", () => {
    const result = calculateEconomics({
      plan: plan({
        purchaseNotionalExcludingFee: "200",
        goal: { kind: "profit_usdt", amount: "100" },
        scenario: null,
      }),
      instrument: syntheticInstrument(),
      snapshot: syntheticSnapshot(),
      planRevision: 3,
      scenarioRevision: 3,
    });
    expect(result.computationStatus).toBe("threshold_only");
    expect(result.goalComparison).toBe("unavailable");
    expect(result.requiredGoalShift).not.toBeNull();
    expect(result.netPnl).toBeNull();
  });



  it("reports sufficient depth when rounded division leaves a division residue", () => {
    // 100 USDT at a single 3 USDT ask: 100/3 rounds down at Decimal's default precision,
    // so spend-back previously left a phantom 1e-18 residue and a false insufficient_depth.
    const result = calculateEconomics({
      plan: plan({ purchaseNotionalExcludingFee: "100", goal: { kind: "break_even" } }),
      instrument: syntheticInstrument(),
      snapshot: { ...syntheticSnapshot(), asks: [["3", "100"]], bids: [["2.99", "100"]] },
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.computationStatus).toBe("calculated");
    expect(result.quantity).toBe("33.33");
    expect(result.spentNotional).toBe("99.99");
  });

  it("still reports insufficient depth when the visible asks cannot fund the order", () => {
    const result = calculateEconomics({
      plan: plan({ purchaseNotionalExcludingFee: "350" }),
      instrument: syntheticInstrument(),
      snapshot: { ...syntheticSnapshot(), asks: [["3", "100"]], bids: [["2.99", "100"]] },
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.computationStatus).toBe("insufficient_depth");
    expect(result.visibleEntryCapacity).toBe("300");
  });

  it.each([
    { budget: "100", quantity: "1", spent: "100", unspent: "0" },
    { budget: "301", quantity: "3", spent: "301", unspent: "0" },
    { budget: "301.001", quantity: "3", spent: "301", unspent: "0.001" },
  ])("handles exact level boundaries for $budget USDT", ({ budget, quantity, spent, unspent }) => {
    const result = calculateEconomics({
      plan: plan({ purchaseNotionalExcludingFee: budget }),
      instrument: syntheticInstrument(),
      snapshot: { ...syntheticSnapshot(), asks: [["100", "1"], ["100.5", "2"], ["101", "1"]] },
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.computationStatus).toBe("calculated");
    expect(result.quantity).toBe(quantity);
    expect(result.spentNotional).toBe(spent);
    expect(result.unspentNotional).toBe(unspent);
    expect(result.visibleEntryCapacity).toBe("402");
  });

  it.each([
    { budget: "300", status: "calculated", unspent: "0" },
    { budget: "300.000000001", status: "insufficient_depth", unspent: "0.000000001" },
  ])("distinguishes full ask capacity from a real tiny shortfall at $budget USDT", ({ budget, status, unspent }) => {
    const result = calculateEconomics({
      plan: plan({ purchaseNotionalExcludingFee: budget }),
      instrument: syntheticInstrument(),
      snapshot: { ...syntheticSnapshot(), asks: [["3", "100"]], bids: [["2.99", "100"]] },
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.computationStatus).toBe(status);
    expect(new Decimal(result.unspentNotional!).eq(unspent)).toBe(true);
    expect(result.visibleEntryCapacity).toBe("300");
  });

  it("consumes an exact first level before a partial repeating-division level", () => {
    const result = calculateEconomics({
      plan: plan({ purchaseNotionalExcludingFee: "101" }),
      instrument: syntheticInstrument(),
      snapshot: { ...syntheticSnapshot(), asks: [["2.5", "10"], ["3", "100"]], bids: [["2.49", "100"]] },
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.computationStatus).toBe("calculated");
    expect(result.quantity).toBe("35.33");
    expect(result.spentNotional).toBe("100.99");
    expect(result.unspentNotional).toBe("0.01");
    expect(result.visibleEntryCapacity).toBe("325");
  });

  it("does not claim a whole-position result when exit depth is zero", () => {
    const result = calculateEconomics({
      plan: plan({ exitAssumptions: { ...plan().exitAssumptions, depthMultiplier: "0" } }),
      instrument: syntheticInstrument(),
      snapshot: syntheticSnapshot(),
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.computationStatus).toBe("insufficient_depth");
    expect(result.netPnl).toBeNull();
    expect(result.unmatchedExitQuantity).toBe("2");
  });

  it("keeps captured rNVDA math within the documented tolerance", () => {
    const market = createCapturedMarket("NVDA");
    const result = calculateEconomics({
      plan: plan({ asset: "NVDA", purchaseNotionalExcludingFee: "10000", scenario: { bidPriceShift: "0.003", assumptionOrigin: "user" } }),
      instrument: market.instrument,
      snapshot: market.snapshot,
      planRevision: 4,
      scenarioRevision: 4,
    });
    expect(result.computationStatus).toBe("calculated");
    expect(Number(result.frictionProxy)).toBeCloseTo(42.78, 1);
    expect(Number(result.netPnl)).toBeCloseTo(-12.88, 1);
    expect(Number(result.breakEvenShift) * 100).toBeCloseTo(0.4292, 3);
  });

  it("rejects a crossed book rather than fixing it", () => {
    const crossed = { ...syntheticSnapshot(), asks: [["98", "2"], ["101", "3"]] as [[string, string], [string, string]] };
    const result = calculateEconomics({
      plan: plan(),
      instrument: syntheticInstrument(),
      snapshot: crossed,
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.computationStatus).toBe("invalid_book");
    expect(result.netPnl).toBeNull();
  });

  it("rejects an unsorted book rather than silently sorting it", () => {
    const unsorted = { ...syntheticSnapshot(), asks: [[101, "2"], [100, "3"]] as unknown as [[string, string], [string, string]] };
    const result = calculateEconomics({
      plan: plan(),
      instrument: syntheticInstrument(),
      snapshot: unsorted,
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.computationStatus).toBe("invalid_book");
    expect(result.warnings.join(" ")).toContain("Ask levels are not sorted");
  });

  it("keeps an explicit flat scenario in the canonical result", () => {
    const result = calculateEconomics({
      plan: plan({ scenario: { bidPriceShift: "0", assumptionOrigin: "illustrative_preset" } }),
      instrument: syntheticInstrument(),
      snapshot: syntheticSnapshot(),
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.scenarioBidPriceShift).toBe("0");
    expect(result.netPnl).not.toBeNull();
  });

  it("marks scenario rows not_requested when no goal is set", () => {
    const result = calculateEconomics({
      plan: plan({ goal: null, scenario: { bidPriceShift: "0.01", assumptionOrigin: "user" } }),
      instrument: syntheticInstrument(),
      snapshot: syntheticSnapshot(),
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.goalComparison).toBe("not_requested");
    expect(result.scenarioTable.every((row) => row.goalComparison === "not_requested")).toBe(true);
    expect(result.scenarioTable.every((row) => row.status === "calculated")).toBe(true);
  });

  it("filters zero-quantity levels without invalidating the book", () => {
    const withZero = {
      ...syntheticSnapshot(),
      asks: [["100", "2"], ["101", "0"], ["101", "3"]] as unknown as [[string, string], [string, string], [string, string]],
    };
    const result = calculateEconomics({
      plan: plan(),
      instrument: syntheticInstrument(),
      snapshot: withZero,
      planRevision: 1,
      scenarioRevision: 1,
    });
    // Zero-qty filtering is informative, not fatal: calculation proceeds.
    expect(result.computationStatus).not.toBe("invalid_book");
    expect(result.warnings.join(" ")).toContain("zero-quantity");
  });

  it("labels out-of-range thresholds instead of claiming simulation", () => {
    const market = createCapturedMarket("NVDA");
    const result = calculateEconomics({
      plan: plan({
        asset: "NVDA",
        purchaseNotionalExcludingFee: "10000",
        goal: { kind: "profit_usdt", amount: "5000" },
        scenario: { bidPriceShift: "0.01", assumptionOrigin: "user" },
      }),
      instrument: market.instrument,
      snapshot: market.snapshot,
      planRevision: 1,
      scenarioRevision: 1,
    });
    expect(result.requiredGoalShift).not.toBeNull();
    expect(result.warnings.join(" ")).toContain("outside the ±3% scenario band");
  });

  it("reports exit capacity in USDT consistent with entry capacity", () => {
    const result = calculateEconomics({
      plan: plan(),
      instrument: syntheticInstrument(),
      snapshot: syntheticSnapshot(),
      planRevision: 1,
      scenarioRevision: 1,
    });
    // Synthetic bids: 99*2 + 98*3 = 492 USDT stressed at d=1,h=0.
    expect(result.visibleExitCapacity).toBe("492");
    expect(result.visibleEntryCapacity).toBe("503");
  });
});
