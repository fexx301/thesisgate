import Decimal from "decimal.js";
import { PlanPatchSchema, PlanSchema, type Plan, type PlanPatch } from "./contracts";

export type PatchOutcome =
  | { ok: true; plan: Plan; changed: string[]; evidenceChanged: boolean }
  | { ok: false; message: string };

function fraction(percent: string) {
  return new Decimal(percent).div(100).toString();
}

function display(value: string) {
  return new Decimal(value).toString();
}

/**
 * Applies a conversational patch to a confirmed plan. Every field is re-validated through the plan
 * schema, so a model can never set protected fields (category, side, quote currency) or out-of-range
 * values. The returned change list is generated here, not taken from the model.
 */
export function applyPlanPatch(plan: Plan, rawPatch: unknown): PatchOutcome {
  const parsedPatch = PlanPatchSchema.safeParse(rawPatch);
  if (!parsedPatch.success) return { ok: false, message: parsedPatch.error.issues[0]?.message ?? "The requested change is not valid." };
  const patch: PlanPatch = parsedPatch.data;
  const next: Plan = structuredClone(plan);
  const changed: string[] = [];

  try {
    if (patch.asset && patch.asset !== plan.asset) {
      next.asset = patch.asset;
      changed.push(`asset set to r${patch.asset}`);
    }
    if (patch.thesis !== undefined && patch.thesis !== plan.thesis) {
      next.thesis = patch.thesis;
      changed.push("thesis updated");
    }
    if (patch.purchaseNotional !== undefined && !new Decimal(patch.purchaseNotional).eq(plan.purchaseNotionalExcludingFee || "0")) {
      next.purchaseNotionalExcludingFee = display(patch.purchaseNotional);
      changed.push(`amount set to ${display(patch.purchaseNotional)} USDT`);
    }
    if (patch.horizonText !== undefined && patch.horizonText !== plan.horizon.originalText) {
      next.horizon = { originalText: patch.horizonText, endAtUTC: null, timezone: null };
      changed.push(patch.horizonText ? `horizon set to "${patch.horizonText}"` : "horizon cleared");
    }
    if (patch.goal !== undefined) {
      const goal = patch.goal.kind === "none"
        ? null
        : patch.goal.kind === "break_even"
          ? { kind: "break_even" as const }
          : patch.goal.kind === "profit_usdt"
            ? { kind: "profit_usdt" as const, amount: display(patch.goal.amount) }
            : { kind: "net_return" as const, fractionOfEntryCash: fraction(patch.goal.percent) };
      if (JSON.stringify(goal) !== JSON.stringify(plan.goal)) {
        next.goal = goal;
        changed.push(patch.goal.kind === "none"
          ? "objective cleared"
          : patch.goal.kind === "break_even"
            ? "objective set to break even"
            : patch.goal.kind === "profit_usdt"
              ? `objective set to ${display(patch.goal.amount)} USDT net profit`
              : `objective set to ${display(patch.goal.percent)}% net return`);
      }
    }
    if (patch.scenarioBidShiftPercent !== undefined) {
      const scenario = patch.scenarioBidShiftPercent === null
        ? null
        : { bidPriceShift: fraction(patch.scenarioBidShiftPercent), assumptionOrigin: "user" as const };
      if (JSON.stringify(scenario?.bidPriceShift ?? null) !== JSON.stringify(plan.scenario?.bidPriceShift ?? null)) {
        next.scenario = scenario;
        changed.push(scenario ? `exit bids assumed ${new Decimal(patch.scenarioBidShiftPercent as string).gte(0) ? "+" : ""}${display(patch.scenarioBidShiftPercent as string)}%` : "scenario cleared (threshold only)");
      }
    }
    if (patch.invalidation !== undefined && patch.invalidation !== plan.invalidation) {
      next.invalidation = patch.invalidation?.trim() ? patch.invalidation : null;
      changed.push(next.invalidation ? "invalidation recorded" : "invalidation cleared");
    }
    if (patch.exitDepthPercent !== undefined) {
      next.exitAssumptions = { ...next.exitAssumptions, depthMultiplier: fraction(patch.exitDepthPercent), depthOrigin: "user" };
      changed.push(`exit depth set to ${display(patch.exitDepthPercent)}% of the book`);
    }
    if (patch.exitHaircutPercent !== undefined) {
      next.exitAssumptions = { ...next.exitAssumptions, priceHaircut: fraction(patch.exitHaircutPercent), haircutOrigin: "user" };
      changed.push(`exit haircut set to ${display(patch.exitHaircutPercent)}%`);
    }
    if (patch.feeInPercent !== undefined || patch.feeOutPercent !== undefined) {
      if (patch.feeInPercent !== undefined) next.feeIn = fraction(patch.feeInPercent);
      if (patch.feeOutPercent !== undefined) next.feeOut = fraction(patch.feeOutPercent);
      next.feeOrigin = "user_supplied";
      changed.push("fees updated");
    }
  } catch {
    return { ok: false, message: "The requested change contained a number that could not be read." };
  }

  const validated = PlanSchema.safeParse(next);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    return { ok: false, message: `That change would make the plan invalid (${issue?.path.join(".") || "plan"}: ${issue?.message ?? "invalid"}).` };
  }
  const evidenceChanged = validated.data.asset !== plan.asset
    || validated.data.thesis !== plan.thesis
    || JSON.stringify(validated.data.horizon) !== JSON.stringify(plan.horizon)
    || validated.data.invalidation !== plan.invalidation;
  return { ok: true, plan: validated.data, changed, evidenceChanged };
}
