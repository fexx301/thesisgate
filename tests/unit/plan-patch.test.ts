import { describe, expect, it } from "vitest";
import { applyPlanPatch } from "../../src/domain/plan-patch";
import type { Plan } from "../../src/domain/contracts";

const plan: Plan = {
  asset: "NVDA", category: "SPOT", side: "long", quoteCurrency: "USDT", thesis: "Old thesis", purchaseNotionalExcludingFee: "1000",
  horizon: { originalText: "", endAtUTC: null, timezone: null }, goal: null,
  exitAssumptions: { depthMultiplier: "1", priceHaircut: "0", depthOrigin: "illustrative_preset", haircutOrigin: "illustrative_preset" },
  scenario: null, invalidation: null, feeIn: "0.001", feeOut: "0.001", feeOrigin: "published_standard_assumption",
};

describe("plan patch", () => {
  it("applies conversational fields with human percentages and reports what changed", () => {
    const outcome = applyPlanPatch(plan, {
      purchaseNotional: "3000",
      horizonText: "until Monday's open",
      goal: { kind: "net_return_percent", percent: "2" },
      scenarioBidShiftPercent: "-1.5",
      exitDepthPercent: "50",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.purchaseNotionalExcludingFee).toBe("3000");
    expect(outcome.plan.goal).toEqual({ kind: "net_return", fractionOfEntryCash: "0.02" });
    expect(outcome.plan.scenario).toEqual({ bidPriceShift: "-0.015", assumptionOrigin: "user" });
    expect(outcome.plan.exitAssumptions.depthMultiplier).toBe("0.5");
    expect(outcome.plan.exitAssumptions.depthOrigin).toBe("user");
    expect(outcome.changed).toContain("amount set to 3000 USDT");
    expect(outcome.evidenceChanged).toBe(true);
  });

  it("treats amount-only edits as economics changes that keep evidence", () => {
    const outcome = applyPlanPatch(plan, { purchaseNotional: "1500" });
    expect(outcome.ok && outcome.evidenceChanged).toBe(false);
  });

  it("rejects protected fields and unknown keys from the model", () => {
    expect(applyPlanPatch(plan, { side: "short" }).ok).toBe(false);
    expect(applyPlanPatch(plan, { category: "FUTURES" }).ok).toBe(false);
    expect(applyPlanPatch(plan, { asset: "AAPL" }).ok).toBe(false);
  });

  it("rejects values the plan schema would not accept", () => {
    expect(applyPlanPatch(plan, { exitDepthPercent: "150" }).ok).toBe(false);
    expect(applyPlanPatch(plan, { scenarioBidShiftPercent: "-100" }).ok).toBe(false);
    expect(applyPlanPatch(plan, { purchaseNotional: "0" }).ok).toBe(false);
  });

  it("clears a scenario for threshold-only and a goal with kind none", () => {
    const withBoth = applyPlanPatch(plan, { scenarioBidShiftPercent: "1", goal: { kind: "break_even" } });
    if (!withBoth.ok) throw new Error("expected ok");
    const cleared = applyPlanPatch(withBoth.plan, { scenarioBidShiftPercent: null, goal: { kind: "none" } });
    expect(cleared.ok && cleared.plan.scenario === null && cleared.plan.goal === null).toBe(true);
  });
});
