import { describe, expect, it } from "vitest";
import { ExitAssumptionsSchema, PlanSchema, type Plan } from "../../src/domain/contracts";

const basePlan: Plan = {
  asset: "NVDA",
  category: "SPOT",
  side: "long",
  quoteCurrency: "USDT",
  thesis: "The source supports a narrow factual claim.",
  purchaseNotionalExcludingFee: "100",
  horizon: { originalText: "tomorrow", endAtUTC: null, timezone: null },
  goal: { kind: "profit_usdt", amount: "10" },
  exitAssumptions: {
    depthMultiplier: "1",
    priceHaircut: "0",
    depthOrigin: "illustrative_preset",
    haircutOrigin: "illustrative_preset",
  },
  scenario: { bidPriceShift: "0", assumptionOrigin: "illustrative_preset" },
  invalidation: null,
  feeIn: "0.001",
  feeOut: "0.001",
  feeOrigin: "published_standard_assumption",
};

describe("contract boundary validation", () => {
  it("rejects zero purchase notional", () => {
    expect(PlanSchema.safeParse({ ...basePlan, purchaseNotionalExcludingFee: "0" }).success).toBe(false);
  });

  it("rejects negative absolute-profit goals", () => {
    expect(PlanSchema.safeParse({ ...basePlan, goal: { kind: "profit_usdt", amount: "-1" } }).success).toBe(false);
  });

  it("rejects negative net-return goals", () => {
    expect(PlanSchema.safeParse({ ...basePlan, goal: { kind: "net_return", fractionOfEntryCash: "-0.01" } }).success).toBe(false);
  });

  it("rejects a 100% exit haircut", () => {
    expect(ExitAssumptionsSchema.safeParse({ ...basePlan.exitAssumptions, priceHaircut: "1" }).success).toBe(false);
  });

  it("rejects a scenario at or below a total-loss boundary", () => {
    expect(PlanSchema.safeParse({ ...basePlan, scenario: { bidPriceShift: "-1", assumptionOrigin: "user" } }).success).toBe(false);
  });
});
