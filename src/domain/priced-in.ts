import Decimal from "decimal.js";
import { MarketContextSchema, type Asset, type EconomicsResult, type MarketContext, type MarketSignals, type MarketSnapshot } from "./contracts";
import { normalizeBook } from "./economics";
import { classifySession, SESSION_CALENDAR_COVERAGE } from "./session";

// An underlying print older than this is context, not a tracking reference.
const FRESH_UNDERLYING_MS = 20 * 60_000;

export type UnderlyingQuote = {
  symbol: string;
  lastClose: string;
  lastCloseSessionDate: string;
  lastCloseAt: string;
  latestPrice: string | null;
  latestAt: string | null;
  source: "yahoo_finance_chart" | "captured_yahoo_finance_chart";
};

export function buildMarketContext(input: {
  asset: Asset;
  mode: "live" | "captured_real";
  observedAt: string;
  underlying: UnderlyingQuote | null;
  snapshot: MarketSnapshot | null;
  signals?: MarketSignals | null;
  warnings?: string[];
}): MarketContext {
  const warnings = [...(input.warnings ?? [])];
  const session = classifySession(new Date(input.observedAt));
  if (input.observedAt.slice(0, 10) > SESSION_CALENDAR_COVERAGE.to) {
    warnings.push(`The US market holiday calendar built into ThesisGate ends ${SESSION_CALENDAR_COVERAGE.to}; session and holiday labels after that date may be wrong.`);
  }
  let rToken: MarketContext["rToken"] = null;
  // Same normalized book as the calculator: zero-size levels are skipped and an invalid book yields no context.
  const book = input.snapshot ? normalizeBook(input.snapshot) : null;
  if (input.snapshot && book && !book.valid) {
    warnings.push("The order book failed validation, so no price context is derived from it.");
  } else if (input.snapshot && book) {
    const bestBid = new Decimal(book.bids.levels[0][0]);
    const bestAsk = new Decimal(book.asks.levels[0][0]);
    rToken = {
      bestBid: bestBid.toString(),
      bestAsk: bestAsk.toString(),
      mid: bestBid.plus(bestAsk).div(2).toString(),
      at: input.snapshot.exchangeTimestamp,
    };
  } else {
    warnings.push("No rToken order book was available, so the venue's move since the close is unknown.");
  }
  if (!input.underlying) warnings.push("The underlying stock quote was unavailable; the rToken is shown without a close reference.");

  let moveSinceClose: string | null = null;
  let basisVsLatest: string | null = null;
  if (rToken && input.underlying) {
    const mid = new Decimal(rToken.mid);
    moveSinceClose = mid.div(input.underlying.lastClose).minus(1).toString();
    if (input.underlying.latestPrice && input.underlying.latestAt) {
      const age = new Date(input.observedAt).getTime() - new Date(input.underlying.latestAt).getTime();
      if (age >= -60_000 && age <= FRESH_UNDERLYING_MS) {
        basisVsLatest = mid.div(input.underlying.latestPrice).minus(1).toString();
      }
    }
  }
  return MarketContextSchema.parse({
    asset: input.asset,
    mode: input.mode,
    observedAt: input.observedAt,
    session,
    underlying: input.underlying,
    rToken,
    moveSinceClose,
    basisVsLatest,
    signals: input.signals ?? null,
    warnings,
  });
}

export type PriceLevel = { level: string; vsClose: string | null };

export type PricedInView = {
  breakEven: PriceLevel | null;
  goal: PriceLevel | null;
  scenario: PriceLevel | null;
  // Share of the goal's required move-from-close that the 24/7 venue has already made.
  shareOfGoalAlreadyMoved: string | null;
};

function levelFrom(bestBid: Decimal, shift: string | null, close: Decimal | null): PriceLevel | null {
  if (shift === null) return null;
  const level = bestBid.mul(new Decimal(1).plus(shift));
  return { level: level.toString(), vsClose: close ? level.div(close).minus(1).toString() : null };
}

/**
 * Translates the order-book thresholds into top-of-book price levels and compares them with the
 * underlying's last close. The levels use the best bid moved by the whole-book shift, so they are an
 * indicator of where the market must trade, not an exact fill price.
 */
export function pricedInView(context: MarketContext | null, economics: EconomicsResult): PricedInView {
  if (!context?.rToken) return { breakEven: null, goal: null, scenario: null, shareOfGoalAlreadyMoved: null };
  const bestBid = new Decimal(context.rToken.bestBid);
  const close = context.underlying ? new Decimal(context.underlying.lastClose) : null;
  const goal = levelFrom(bestBid, economics.requiredGoalShift, close);
  let shareOfGoalAlreadyMoved: string | null = null;
  if (goal?.vsClose && context.moveSinceClose) {
    const required = new Decimal(goal.vsClose);
    const moved = new Decimal(context.moveSinceClose);
    if (required.gt(0) && moved.gt(0)) shareOfGoalAlreadyMoved = Decimal.min(moved.div(required), 1).toString();
  }
  return {
    breakEven: levelFrom(bestBid, economics.breakEvenShift, close),
    goal,
    scenario: levelFrom(bestBid, economics.scenarioBidPriceShift, close),
    shareOfGoalAlreadyMoved,
  };
}
