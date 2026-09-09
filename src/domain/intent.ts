import Decimal from "decimal.js";
import type { Plan } from "./contracts";

export type IntentPatch = {
  plan: Plan;
  changed: string[];
  clarification: string | null;
  refreshMarket: boolean;
};

function amountFromMessage(message: string) {
  const match = message.match(/(?:want|target|profit(?:\s+of)?)\s+([0-9][0-9,]*(?:\.\d+)?)\s*(?:usdt)?/i);
  if (!match) return null;
  return match[1].replace(/,/g, "");
}

function shiftFromMessage(message: string) {
  const match = message.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? new Decimal(match[1]).div(100).toString() : null;
}

export function parseIntent(message: string, plan: Plan): IntentPatch {
  const normalized = message.trim().toLowerCase();
  let nextPlan = plan;
  const changed: string[] = [];
  let clarification: string | null = null;
  let refreshMarket = false;

  if (/halve|half|cut\s+(?:the\s+)?amount/.test(normalized)) {
    nextPlan = {
      ...nextPlan,
      purchaseNotionalExcludingFee: new Decimal(plan.purchaseNotionalExcludingFee).div(2).toString(),
    };
    changed.push("purchase notional halved");
  }

  const profitAmount = amountFromMessage(normalized);
  if (profitAmount && /profit|goal|target/.test(normalized)) {
    nextPlan = {
      ...nextPlan,
      goal: { kind: "profit_usdt", amount: profitAmount },
    };
    changed.push(`profit goal set to ${profitAmount} USDT`);
  }

  const shift = shiftFromMessage(normalized);
  if (shift && /(sell|bid|exit).*(rise|up|increase|higher)|(?:rise|up|increase|higher).*(sell|bid|exit)/.test(normalized)) {
    nextPlan = {
      ...nextPlan,
      scenario: { bidPriceShift: shift, assumptionOrigin: "user" },
    };
    changed.push(`bid-price scenario set to ${new Decimal(shift).mul(100).toString()}%`);
  } else if (shift && /(rise|up|increase|higher)/.test(normalized)) {
    clarification = "Should the percentage apply to captured bid prices, the entry VWAP, or another reference?";
  }

  if (/exit\s+depth|available\s+exit\s+depth/.test(normalized) && /halve|half|cut/.test(normalized)) {
    nextPlan = {
      ...nextPlan,
      exitAssumptions: {
        ...nextPlan.exitAssumptions,
        depthMultiplier: new Decimal(nextPlan.exitAssumptions.depthMultiplier).div(2).toString(),
        depthOrigin: "user",
      },
    };
    changed.push("available exit depth halved");
  }

  if (/planned\s+deployment.*not.*current\s+revenue|not\s+current\s+revenue/.test(normalized)) {
    nextPlan = {
      ...nextPlan,
      thesis: "The source describes planned deployment, not current realized revenue.",
    };
    changed.push("thesis changed to planned deployment versus current revenue");
  }

  if (/refresh\s+market|refresh\s+prices|new\s+book/.test(normalized)) {
    refreshMarket = true;
    changed.push("market refresh requested");
  }

  if (!changed.length && !clarification) {
    clarification = "I can halve the amount, set a USDT profit goal, change a bid-price scenario, halve exit depth, update the deployment claim, or refresh market data.";
  }

  return { plan: nextPlan, changed, clarification, refreshMarket };
}
