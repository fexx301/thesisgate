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
