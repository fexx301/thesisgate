import { describe, expect, it } from "vitest";
import { parseIntent } from "../../src/domain/intent";
import type { Plan } from "../../src/domain/contracts";

const basePlan: Plan = {
  asset: "NVDA",
  category: "SPOT",
  side: "long",
  quoteCurrency: "USDT",
  thesis: "A source-backed thesis remains separate from the price scenario.",
  purchaseNotionalExcludingFee: "10000",
  horizon: { originalText: "tomorrow evening", endAtUTC: null, timezone: null },
  goal: { kind: "profit_usdt", amount: "100" },
  exitAssumptions: { depthMultiplier: "1", priceHaircut: "0", depthOrigin: "illustrative_preset", haircutOrigin: "illustrative_preset" },
  scenario: { bidPriceShift: "0.003", assumptionOrigin: "illustrative_preset" },
  invalidation: null,
  feeIn: "0.001",
  feeOut: "0.001",
  feeOrigin: "published_standard_assumption",
};

describe("deterministic follow-up intent", () => {
  it("changes only the requested amount", () => {
    const result = parseIntent("Halve the amount", basePlan);
    expect(result.plan.purchaseNotionalExcludingFee).toBe("5000");
    expect(result.plan.goal).toEqual(basePlan.goal);
    expect(result.changed).toEqual(["purchase notional halved"]);
  });

  it("binds budget and depth to distinct fields", () => {
    const amount = parseIntent("Halve the budget", basePlan);
    expect(amount.plan.purchaseNotionalExcludingFee).toBe("5000");
    expect(amount.plan.exitAssumptions.depthMultiplier).toBe("1");
    const depth = parseIntent("Halve the exit depth", basePlan);
    expect(depth.plan.exitAssumptions.depthMultiplier).toBe("0.5");
    expect(depth.plan.purchaseNotionalExcludingFee).toBe("10000");
  });

  it("asks which reference a bare percentage changes", () => {
    const result = parseIntent("It should rise 2%", basePlan);
    expect(result.clarification).toContain("captured bid prices");
    expect(result.plan).toEqual(basePlan);
  });

  it("sets a bid scenario for rise and fall direction", () => {
    const rise = parseIntent("Assume sell bids rise 1%", basePlan);
    expect(rise.plan.scenario?.bidPriceShift).toBe("0.01");
    expect(rise.changed).toContain("bid-price scenario set to 1%");
    const fall = parseIntent("Assume sell bids fall 1%", basePlan);
    expect(fall.plan.scenario?.bidPriceShift).toBe("-0.01");
    expect(fall.changed).toContain("bid-price scenario set to -1%");
  });

  it("applies at most one field-bound command", () => {
    const combined = parseIntent("Halve the amount and set target 2% return", basePlan);
    expect(combined.plan).toEqual(basePlan);
    expect(combined.changed).toEqual([]);
    expect(combined.clarification).toContain("USDT");
  });

  it("does not convert a percent goal or return into USDT", () => {
    for (const message of ["Target 2% profit", "target 2% return"]) {
      const result = parseIntent(message, basePlan);
      expect(result.plan).toEqual(basePlan);
      expect(result.changed).toEqual([]);
      expect(result.clarification).toContain("USDT");
    }
  });

  it("rejects a scenario shift without a direction word", () => {
    const result = parseIntent("Assume sell bids -1%", basePlan);
    expect(result.plan).toEqual(basePlan);
    expect(result.changed).toEqual([]);
  });
});
