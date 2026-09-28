import Decimal from "decimal.js";
import type { EconomicsResult, Instrument, MarketSnapshot } from "./contracts";

export type AgentHubHandoff = {
  quantity: string;
  limitPrice: string;
  commands: { label: string; command: string }[];
  notes: string[];
};

/** The deepest ask price the displayed book needs to fill `quantity`; null when the book is too thin. */
export function sweepLimitPrice(asks: MarketSnapshot["asks"], quantity: string): string | null {
  let remaining = new Decimal(quantity);
  for (const [price, size] of asks) {
    remaining = remaining.minus(size);
    if (remaining.lte(0)) return new Decimal(price).toString();
  }
  return null;
}

/**
 * Builds Bitget Agent Hub CLI (`bgc`) commands for the user to review and run themselves.
 * ThesisGate never sends them. The order is an IOC limit at the deepest displayed ask, so it cannot
 * pay more than the book the economics used, and the first command is always a dry run.
 */
export function agentHubHandoff(economics: EconomicsResult, instrument: Instrument | null, snapshot: MarketSnapshot | null): AgentHubHandoff | null {
  if (!instrument || !snapshot || !economics.quantity) return null;
  if (!["calculated", "threshold_only"].includes(economics.computationStatus)) return null;
  const quantity = new Decimal(economics.quantity);
  if (quantity.lte(0)) return null;
  const limitPrice = sweepLimitPrice(snapshot.asks, quantity.toString());
  if (!limitPrice) return null;
  const base = `--category SPOT --symbol ${instrument.symbol} --side buy --orderType limit --price ${limitPrice} --qty ${quantity.toString()} --timeInForce ioc`;
  return {
    quantity: quantity.toString(),
    limitPrice,
    commands: [
      { label: "1. Check the live price (read-only, no account needed)", command: `bgc --read-only market --action tickers --category SPOT --symbol ${instrument.symbol}` },
      { label: "2. Preview the order (dry run: nothing is sent)", command: `bgc order --action place ${base} --dry-run` },
      { label: "3. Only after you have reviewed it yourself: the same order without --dry-run", command: `bgc order --action place ${base}` },
    ],
    notes: [
      `Quantity ${quantity.toString()} ${instrument.baseCoin} is the plan's size rounded down to the ${instrument.quantityStep} step; entry fee is additional.`,
      `The limit ${limitPrice} USDT is the deepest ask the ${snapshot.mode === "live" ? "live" : "captured"} book needed; IOC cancels anything the book can no longer fill at that price.`,
      "Prices move: re-check the book before running step 3. A Bitget Agentic account (quota-limited, no withdrawals) or --paper-trading keeps experiments contained.",
    ],
  };
}
