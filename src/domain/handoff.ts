import Decimal from "decimal.js";
import type { EconomicsResult, Instrument, MarketSnapshot } from "./contracts";

export type AgentHubHandoff = {
  side: "long" | "short";
  quantity: string;
  modeledQuantity: string;
  limitPrice: string;
  /** Long: the most this order can spend (quantity x limit). Short: the minimum proceeds it brings in. */
  maxSpend: string;
  maxSpendWithFee: string;
  budget: string;
  reducedToFitBudget: boolean;
  commands: { label: string; command: string }[];
  notes: string[];
};

/** The deepest price the displayed book side needs to fill `quantity`; null when the book is too thin. */
export function sweepLimitPrice(levels: MarketSnapshot["asks"], quantity: string): string | null {
  let remaining = new Decimal(quantity);
  for (const [price, size] of levels) {
    if (new Decimal(size).lte(0)) continue;
    remaining = remaining.minus(size);
    if (remaining.lte(0)) return new Decimal(price).toString();
  }
  return null;
}

const COMMON_TAIL = "Prices move: re-check the book before running step 3. A Bitget Agentic account (quota-limited, no withdrawals) or --paper-trading keeps experiments contained.";

function commandSteps(instrument: Instrument, base: string) {
  return [
    { label: "1. Check the live price (read-only, no account needed)", command: `bgc --read-only market --action tickers --category SPOT --symbol ${instrument.symbol}` },
    { label: "2. Preview the order (dry run: nothing is sent)", command: `bgc order --action place ${base} --dry-run` },
    { label: "3. Only after you have reviewed it yourself: the same order without --dry-run", command: `bgc order --action place ${base}` },
  ];
}

/**
 * Builds Bitget Agent Hub CLI (`bgc`) commands for the user to review and run themselves; ThesisGate never
 * sends them. A LONG opens with a buy IOC limit at the deepest ask the book needed, and the quantity is reduced
 * when needed so quantity x limit can never exceed the plan's notional (if the book moves up, it buys less).
 * A SHORT opens with a sell IOC limit at the deepest bid the book needed; selling cannot overspend, so the
 * modeled size is used and the figure shown is the minimum proceeds it brings in.
 */
export function agentHubHandoff(economics: EconomicsResult, instrument: Instrument | null, snapshot: MarketSnapshot | null, feeIn = "0", side: "long" | "short" = "long"): AgentHubHandoff | null {
  if (!instrument || !snapshot || !economics.quantity || !economics.requestedNotional) return null;
  if (!["calculated", "threshold_only"].includes(economics.computationStatus)) return null;
  const modeled = new Decimal(economics.quantity);
  if (modeled.lte(0)) return null;
  const budget = new Decimal(economics.requestedNotional);
  const step = new Decimal(instrument.quantityStep);
  const mode = snapshot.mode === "live" ? "live" : "captured";

  if (side === "short") {
    const limitPrice = sweepLimitPrice(snapshot.bids, modeled.toString());
    if (!limitPrice) return null;
    const limit = new Decimal(limitPrice);
    const quantity = modeled.div(step).floor().mul(step);
    if (quantity.lt(instrument.minOrderQty) || quantity.mul(limit).lt(instrument.minOrderNotional)) return null;
    const minProceeds = quantity.mul(limit);
    const minProceedsAfterFee = minProceeds.mul(new Decimal(1).minus(feeIn));
    const base = `--category SPOT --symbol ${instrument.symbol} --side sell --orderType limit --price ${limitPrice} --qty ${quantity.toString()} --timeInForce ioc`;
    return {
      side: "short",
      quantity: quantity.toString(),
      modeledQuantity: modeled.toString(),
      limitPrice,
      maxSpend: minProceeds.toDecimalPlaces(2, Decimal.ROUND_DOWN).toString(),
      maxSpendWithFee: minProceedsAfterFee.toDecimalPlaces(2, Decimal.ROUND_DOWN).toString(),
      budget: budget.toString(),
      reducedToFitBudget: false,
      commands: commandSteps(instrument, base),
      notes: [
        `This OPENS a short: it SELLS ${quantity.toString()} ${instrument.baseCoin} into the bids. Minimum proceeds at this limit: ${minProceeds.toDecimalPlaces(2, Decimal.ROUND_DOWN).toString()} USDT (${minProceedsAfterFee.toDecimalPlaces(2, Decimal.ROUND_DOWN).toString()} after the fee). Buying it back to close is a separate order you place later.`,
        `The limit ${limitPrice} USDT is the deepest bid the ${mode} book needed; IOC cancels anything it can no longer fill at or above that price, so you sell less rather than at a worse price.`,
        "A short also carries a borrow/funding cost while it is open; the trade math treats that as a labeled assumption, never an account rate.",
        COMMON_TAIL,
      ],
    };
  }

  const limitPrice = sweepLimitPrice(snapshot.asks, modeled.toString());
  if (!limitPrice) return null;
  const limit = new Decimal(limitPrice);
  const affordable = budget.div(limit).div(step).floor().mul(step);
  const quantity = Decimal.min(modeled, affordable);
  if (quantity.lt(instrument.minOrderQty) || quantity.mul(limit).lt(instrument.minOrderNotional)) return null;
  const maxSpend = quantity.mul(limit);
  const maxSpendWithFee = maxSpend.mul(new Decimal(1).plus(feeIn));
  const reduced = quantity.lt(modeled);
  const base = `--category SPOT --symbol ${instrument.symbol} --side buy --orderType limit --price ${limitPrice} --qty ${quantity.toString()} --timeInForce ioc`;
  return {
    side: "long",
    quantity: quantity.toString(),
    modeledQuantity: modeled.toString(),
    limitPrice,
    maxSpend: maxSpend.toDecimalPlaces(2, Decimal.ROUND_UP).toString(),
    maxSpendWithFee: maxSpendWithFee.toDecimalPlaces(2, Decimal.ROUND_UP).toString(),
    budget: budget.toString(),
    reducedToFitBudget: reduced,
    commands: commandSteps(instrument, base),
    notes: [
      `Maximum this order can spend: ${maxSpend.toDecimalPlaces(2, Decimal.ROUND_UP).toString()} USDT, plus the entry fee (${maxSpendWithFee.toDecimalPlaces(2, Decimal.ROUND_UP).toString()} USDT in total). Your plan's amount is ${budget.toString()} USDT.`,
      reduced
        ? `Quantity ${quantity.toString()} ${instrument.baseCoin} is less than the ${modeled.toString()} the trade math modeled: a limit caps the price per unit, not the total, so the order is sized so it can never spend more than your amount even if the book moves up.`
        : `Quantity ${quantity.toString()} ${instrument.baseCoin} is the plan's size rounded down to the ${instrument.quantityStep} step.`,
      `The limit ${limitPrice} USDT is the deepest ask the ${mode} book needed; IOC cancels anything the book can no longer fill at that price.`,
      COMMON_TAIL,
    ],
  };
}
