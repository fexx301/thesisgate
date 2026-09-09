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

  it("asks which reference a bare percentage changes", () => {
    const result = parseIntent("It should rise 2%", basePlan);
    expect(result.clarification).toContain("captured bid prices");
    expect(result.plan).toEqual(basePlan);
  });

  it("sets a bid scenario only when the reference is named", () => {
    const result = parseIntent("Assume sell bids rise 1%", basePlan);
    expect(result.plan.scenario?.bidPriceShift).toBe("0.01");
    expect(result.changed).toContain("bid-price scenario set to 1%");
  });
});
