import Decimal from "decimal.js";
import type { Plan } from "./contracts";

export type IntentPatch = {
  plan: Plan;
  changed: string[];
  clarification: string | null;
  refreshMarket: boolean;
};

export function parseIntent(message: string, plan: Plan): IntentPatch {
  const normalized = message.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/^please\s+/, "");
  const unchanged: IntentPatch = { plan, changed: [], clarification: null, refreshMarket: false };

  // Accept one complete, field-bound command. Never partially apply ambiguous prose.
  if (/^(?:halve|half)\s+(?:the\s+)?(?:available\s+)?exit\s+(?:depth|liquidity)$/.test(normalized)
    || /^cut\s+(?:the\s+)?(?:available\s+)?exit\s+(?:depth|liquidity)\s+(?:in\s+half|by\s+half)$/.test(normalized)) {
    return {
      ...unchanged,
      plan: { ...plan, exitAssumptions: { ...plan.exitAssumptions, depthMultiplier: new Decimal(plan.exitAssumptions.depthMultiplier).div(2).toString(), depthOrigin: "user" } },
      changed: ["available exit depth halved"],
    };
  }
  if (/^(?:halve|half)\s+(?:the\s+)?(?:purchase\s+)?(?:amount|notional|budget)$/.test(normalized)
    || /^cut\s+(?:the\s+)?(?:purchase\s+)?(?:amount|notional|budget)\s+(?:in\s+half|by\s+half)$/.test(normalized)) {
    return {
      ...unchanged,
      plan: { ...plan, purchaseNotionalExcludingFee: new Decimal(plan.purchaseNotionalExcludingFee).div(2).toString() },
      changed: ["purchase notional halved"],
    };
  }

  const profit = normalized.match(/^(?:(?:i\s+)?want|target|(?:set\s+)?(?:profit(?:\s+goal)?|goal)(?:\s+(?:of|to))?)\s+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s+usdt(?:\s+(?:net\s+)?profit)?$/);
  if (profit) {
    const amount = new Decimal(profit[1].replaceAll(",", "")).toString();
    return { ...unchanged, plan: { ...plan, goal: { kind: "profit_usdt", amount } }, changed: [`profit goal set to ${amount} USDT`] };
  }
  if (/%/.test(normalized) && /\b(return|profit|goal|target)\b/.test(normalized)) {
    return { ...unchanged, clarification: "Specify a profit goal in USDT, or use the net-return objective control for a percentage of entry cash." };
  }

  const scenario = normalized.match(/^(?:assume\s+)?(?:sell\s+)?(?:bids?|exit\s+(?:bids?|prices?)|sell\s+prices?)\s+(rise|up|increase|higher|fall|down|decrease|lower)\s+(?:by\s+)?([+-]?\d+(?:\.\d+)?)\s*%$/);
  if (scenario) {
    let percent = new Decimal(scenario[2]);
    const falling = ["fall", "down", "decrease", "lower"].includes(scenario[1]);
    if (percent.isNegative()) {
      return { ...unchanged, clarification: "Use a positive percentage with rise or fall to make the scenario direction unambiguous." };
    }
    if (falling) percent = percent.negated();
    const shift = percent.div(100);
    if (shift.lte(-1)) return { ...unchanged, clarification: "The bid-price shift must be above -100%." };
    return {
      ...unchanged,
      plan: { ...plan, scenario: { bidPriceShift: shift.toString(), assumptionOrigin: "user" } },
      changed: [`bid-price scenario set to ${percent.toString()}%`],
    };
  }
  if (/%/.test(normalized)) {
    return { ...unchanged, clarification: "Should the percentage apply to captured bid prices, the entry VWAP, or another reference? State one change at a time." };
  }

  if (/^(?:(?:the\s+)?source\s+(?:describes|shows)\s+)?planned\s+deployment,?\s+not\s+current\s+revenue$/.test(normalized)
    || normalized === "not current revenue") {
    return { ...unchanged, plan: { ...plan, thesis: "The source describes planned deployment, not current realized revenue." }, changed: ["thesis changed to planned deployment versus current revenue"] };
  }
  if (/^(?:refresh\s+(?:the\s+)?(?:market|prices|snapshot|book)(?:\s+data)?|new\s+book)$/.test(normalized)) {
    return { ...unchanged, refreshMarket: true, changed: ["market refresh requested"] };
  }
  return { ...unchanged, clarification: "State one change: halve the amount, set a profit goal in USDT, assume sell bids rise or fall by a percentage, halve exit depth, update the deployment claim, or refresh market data." };
}
