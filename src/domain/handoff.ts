import Decimal from "decimal.js";
import type { EconomicsResult, Instrument, MarketSnapshot } from "./contracts";

export type AgentHubHandoff = {
  quantity: string;
  modeledQuantity: string;
  limitPrice: string;
  /** The most this order can spend before the entry fee: quantity x limit price. Never above the plan's notional. */
  maxSpend: string;
  maxSpendWithFee: string;
  budget: string;
  reducedToFitBudget: boolean;
  commands: { label: string; command: string }[];
  notes: string[];
};

/** The deepest ask price the displayed book needs to fill `quantity`; null when the book is too thin. */
export function sweepLimitPrice(asks: MarketSnapshot["asks"], quantity: string): string | null {
  let remaining = new Decimal(quantity);
  for (const [price, size] of asks) {
    if (new Decimal(size).lte(0)) continue;
    remaining = remaining.minus(size);
    if (remaining.lte(0)) return new Decimal(price).toString();
  }
  return null;
}

/**
 * Builds Bitget Agent Hub CLI (`bgc`) commands for the user to review and run themselves; ThesisGate never
 * sends them. The order is an IOC limit at the deepest ask the displayed book needed. A limit caps the price
 * of each unit, not the total, so the quantity is reduced when needed so that quantity x limit can never
 * exceed the plan's notional: if the book moves up, the order buys less rather than spending more.
 */
export function agentHubHandoff(economics: EconomicsResult, instrument: Instrument | null, snapshot: MarketSnapshot | null, feeIn = "0"): AgentHubHandoff | null {
  if (!instrument || !snapshot || !economics.quantity || !economics.requestedNotional) return null;
  if (!["calculated", "threshold_only"].includes(economics.computationStatus)) return null;
  const modeled = new Decimal(economics.quantity);
  if (modeled.lte(0)) return null;
  const limitPrice = sweepLimitPrice(snapshot.asks, modeled.toString());
  if (!limitPrice) return null;
  const limit = new Decimal(limitPrice);
  const budget = new Decimal(economics.requestedNotional);
  const step = new Decimal(instrument.quantityStep);
  const affordable = budget.div(limit).div(step).floor().mul(step);
  const quantity = Decimal.min(modeled, affordable);
  if (quantity.lt(instrument.minOrderQty) || quantity.mul(limit).lt(instrument.minOrderNotional)) return null;
  const maxSpend = quantity.mul(limit);
  const maxSpendWithFee = maxSpend.mul(new Decimal(1).plus(feeIn));
  const reduced = quantity.lt(modeled);
  const base = `--category SPOT --symbol ${instrument.symbol} --side buy --orderType limit --price ${limitPrice} --qty ${quantity.toString()} --timeInForce ioc`;
  return {
    quantity: quantity.toString(),
    modeledQuantity: modeled.toString(),
    limitPrice,
    maxSpend: maxSpend.toDecimalPlaces(2, Decimal.ROUND_UP).toString(),
    maxSpendWithFee: maxSpendWithFee.toDecimalPlaces(2, Decimal.ROUND_UP).toString(),
    budget: budget.toString(),
    reducedToFitBudget: reduced,
    commands: [
      { label: "1. Check the live price (read-only, no account needed)", command: `bgc --read-only market --action tickers --category SPOT --symbol ${instrument.symbol}` },
      { label: "2. Preview the order (dry run: nothing is sent)", command: `bgc order --action place ${base} --dry-run` },
      { label: "3. Only after you have reviewed it yourself: the same order without --dry-run", command: `bgc order --action place ${base}` },
    ],
    notes: [
      `Maximum this order can spend: ${maxSpend.toDecimalPlaces(2, Decimal.ROUND_UP).toString()} USDT, plus the entry fee (${maxSpendWithFee.toDecimalPlaces(2, Decimal.ROUND_UP).toString()} USDT in total). Your plan's amount is ${budget.toString()} USDT.`,
      reduced
        ? `Quantity ${quantity.toString()} ${instrument.baseCoin} is less than the ${modeled.toString()} the trade math modeled: a limit caps the price per unit, not the total, so the order is sized so it can never spend more than your amount even if the book moves up.`
        : `Quantity ${quantity.toString()} ${instrument.baseCoin} is the plan's size rounded down to the ${instrument.quantityStep} step.`,
      `The limit ${limitPrice} USDT is the deepest ask the ${snapshot.mode === "live" ? "live" : "captured"} book needed; IOC cancels anything the book can no longer fill at that price.`,
      "Prices move: re-check the book before running step 3. A Bitget Agentic account (quota-limited, no withdrawals) or --paper-trading keeps experiments contained.",
    ],
  };
}
