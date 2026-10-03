import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { calculateEconomics } from "../../src/domain/economics";
import { buildMarketContext, pricedInView, type UnderlyingQuote } from "../../src/domain/priced-in";
import type { Instrument, MarketSnapshot, Plan } from "../../src/domain/contracts";

const snapshot: MarketSnapshot = {
  id: "snapshot_test123", hash: "hash_test123", asset: "NVDA", symbol: "RNVDAUSDT",
  bids: [["101", "1000"], ["100.9", "1000"]], asks: [["101.2", "1000"], ["101.3", "1000"]],
  exchangeTimestamp: "2026-09-26T15:00:00.000Z", receivedAt: "2026-09-26T15:00:00.000Z",
  mode: "live", rawResponseReference: "test", validationWarnings: [],
};
const instrument: Instrument = {
  symbol: "RNVDAUSDT", asset: "NVDA", category: "SPOT", baseCoin: "rNVDA", quoteCoin: "USDT", symbolType: "stock", isReality: true,
  status: "online", quantityStep: "0.0001", priceTick: "0.01", minOrderQty: "0.0001", maxOrderQty: "0", minOrderNotional: "1", maxPositionQty: "0",
  rawMetadataTime: "2026-09-26T15:00:00.000Z",
};
const underlying: UnderlyingQuote = {
  symbol: "NVDA", lastClose: "100", lastCloseSessionDate: "2026-09-25", lastCloseAt: "2026-09-25T20:00:00.000Z",
  latestPrice: "100.5", latestAt: "2026-09-25T23:59:00.000Z", source: "yahoo_finance_chart",
};
const plan: Plan = {
  asset: "NVDA", category: "SPOT", side: "long", quoteCurrency: "USDT", thesis: "t", purchaseNotionalExcludingFee: "1000",
  horizon: { originalText: "Monday", endAtUTC: null, timezone: null }, goal: { kind: "profit_usdt", amount: "30" },
  exitAssumptions: { depthMultiplier: "1", priceHaircut: "0", depthOrigin: "user", haircutOrigin: "user" },
  scenario: null, invalidation: null, feeIn: "0.001", feeOut: "0.001", feeOrigin: "published_standard_assumption",
};

describe("priced-in context", () => {
  it("measures the rToken mid against the last regular close during a weekend", () => {
    const context = buildMarketContext({ asset: "NVDA", mode: "live", observedAt: snapshot.receivedAt, underlying, snapshot });
    expect(context.session.state).toBe("weekend");
    expect(context.rToken?.mid).toBe("101.1");
    expect(context.moveSinceClose).toBe("0.011");
    // The latest print is Friday evening, more than 20 minutes old, so no tracking basis is claimed.
    expect(context.basisVsLatest).toBeNull();
  });

  it("reports a tracking basis only against a fresh underlying print", () => {
    const context = buildMarketContext({ asset: "NVDA", mode: "live", observedAt: "2026-09-26T00:05:00.000Z", underlying, snapshot });
    expect(new Decimal(context.basisVsLatest ?? "0").toFixed(6)).toBe(new Decimal("101.1").div("100.5").minus(1).toFixed(6));
  });

  it("keeps missing inputs explicit instead of zero", () => {
    const context = buildMarketContext({ asset: "NVDA", mode: "live", observedAt: snapshot.receivedAt, underlying: null, snapshot: null });
    expect(context.moveSinceClose).toBeNull();
    expect(context.warnings.length).toBe(2);
  });

  it("translates thresholds into top-of-book levels versus the close and the share already moved", () => {
    const context = buildMarketContext({ asset: "NVDA", mode: "live", observedAt: snapshot.receivedAt, underlying, snapshot });
    const economics = calculateEconomics({ plan, instrument, snapshot, planRevision: 1, scenarioRevision: 1 });
    const view = pricedInView(context, economics);
    const expectedGoal = new Decimal("101").mul(new Decimal(1).plus(economics.requiredGoalShift ?? "0"));
    expect(view.goal?.level).toBe(expectedGoal.toString());
    expect(view.goal?.vsClose).toBe(expectedGoal.div(100).minus(1).toString());
    const share = new Decimal(view.shareOfGoalAlreadyMoved ?? "0");
    expect(share.gt(0) && share.lt(1)).toBe(true);
    expect(view.scenario).toBeNull();
  });
});

describe("calendar coverage", () => {
  it("warns when the observation is past the built-in holiday calendar", () => {
    const late = buildMarketContext({ asset: "NVDA", mode: "live", observedAt: "2028-03-01T15:00:00.000Z", underlying: null, snapshot: null });
    expect(late.warnings.some((warning) => warning.includes("calendar") && warning.includes("2027-12-31"))).toBe(true);
    const current = buildMarketContext({ asset: "NVDA", mode: "live", observedAt: "2026-09-24T15:00:00.000Z", underlying: null, snapshot: null });
    expect(current.warnings.some((warning) => warning.includes("calendar"))).toBe(false);
  });
});

describe("book normalization shared with the calculator", () => {
  it("skips zero-size levels exactly as the calculator does (the review's repro)", () => {
    const zeroTop: MarketSnapshot = { ...snapshot, bids: [["199", "0"], ["198", "100"]], asks: [["200", "0"], ["201", "100"]] };
    const context = buildMarketContext({ asset: "NVDA", mode: "live", observedAt: snapshot.receivedAt, underlying, snapshot: zeroTop });
    expect(context.rToken?.bestBid).toBe("198");
    expect(context.rToken?.bestAsk).toBe("201");
    const economics = calculateEconomics({ plan: { ...plan, purchaseNotionalExcludingFee: "1000" }, instrument, snapshot: zeroTop, planRevision: 1, scenarioRevision: 1 });
    expect(economics.entryVWAP).toBe("201");
  });

  it("derives no price context from a crossed book", () => {
    const crossed: MarketSnapshot = { ...snapshot, bids: [["202", "10"]], asks: [["201", "10"]] };
    const context = buildMarketContext({ asset: "NVDA", mode: "live", observedAt: snapshot.receivedAt, underlying, snapshot: crossed });
    expect(context.rToken).toBeNull();
    expect(context.moveSinceClose).toBeNull();
    expect(context.warnings.some((warning) => warning.includes("failed validation"))).toBe(true);
  });

  it("refuses to calculate when the book is for another asset", () => {
    const economics = calculateEconomics({ plan: { ...plan, asset: "TSLA" }, instrument, snapshot, planRevision: 1, scenarioRevision: 1 });
    expect(economics.computationStatus).toBe("invalid_instrument");
    expect(economics.warnings.join(" ")).toContain("plan is for rTSLA");
  });

  it("prices a short off the best ask (buy-back side), not the best bid", () => {
    const shortPlan: Plan = { ...plan, side: "short" };
    const context = buildMarketContext({ asset: "NVDA", mode: "live", observedAt: snapshot.receivedAt, underlying, snapshot });
    const economics = calculateEconomics({ plan: shortPlan, instrument, snapshot, planRevision: 1, scenarioRevision: 1 });
    expect(economics.computationStatus).not.toBe("invalid_book");
    const view = pricedInView(context, economics, "short");
    const bestAsk = new Decimal(context.rToken?.bestAsk ?? "0"); // 101.2
    const bestBid = new Decimal(context.rToken?.bestBid ?? "0"); // 101
    // Levels are the best ASK moved by the (negative) close-side shift — the short trades on the asks.
    expect(view.goal?.level).toBe(bestAsk.mul(new Decimal(1).plus(economics.requiredGoalShift ?? "0")).toString());
    expect(view.breakEven?.level).toBe(bestAsk.mul(new Decimal(1).plus(economics.breakEvenShift ?? "0")).toString());
    // A short's break-even needs the price to fall, so the shift is negative.
    expect(new Decimal(economics.breakEvenShift ?? "0").isNegative()).toBe(true);
    // The long view would have used the best bid instead — confirm the two bases differ.
    expect(bestAsk.eq(bestBid)).toBe(false);
  });
});
