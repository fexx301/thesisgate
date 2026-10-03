import { describe, expect, it } from "vitest";
import { agentHubHandoff } from "../../src/domain/handoff";
import { calculateEconomics, syntheticInstrument, syntheticSnapshot } from "../../src/domain/economics";
import type { Plan } from "../../src/domain/contracts";

// Synthetic book: bids [[99,2],[98,3]], asks [[100,2],[101,3]].
const instrument = syntheticInstrument();
const snapshot = syntheticSnapshot();

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    asset: "NVDA", category: "SPOT", side: "long", quoteCurrency: "USDT", thesis: "t", purchaseNotionalExcludingFee: "198",
    horizon: { originalText: "", endAtUTC: null, timezone: null }, goal: null,
    exitAssumptions: { depthMultiplier: "1", priceHaircut: "0", depthOrigin: "illustrative_preset", haircutOrigin: "illustrative_preset" },
    scenario: null, invalidation: null, feeIn: "0", feeOut: "0", feeOrigin: "published_standard_assumption", ...overrides,
  };
}
const economicsFor = (p: Plan) => calculateEconomics({ plan: p, instrument, snapshot, planRevision: 1, scenarioRevision: 1 });

describe("Agent Hub handoff", () => {
  it("builds a buy-to-open order for a long at the deepest ask", () => {
    const handoff = agentHubHandoff(economicsFor(plan()), instrument, snapshot, "0", "long");
    expect(handoff?.side).toBe("long");
    expect(handoff?.limitPrice).toBe("100"); // deepest ask needed
    expect(handoff?.quantity).toBe("1.98"); // 198 USDT buys 1.98 @100
    expect(handoff?.commands[2].command).toContain("--side buy");
    expect(handoff?.commands[2].command).toContain("--price 100");
  });

  it("builds a sell-to-open order for a short at the deepest bid, with min-proceeds framing", () => {
    const handoff = agentHubHandoff(economicsFor(plan({ side: "short" })), instrument, snapshot, "0", "short");
    expect(handoff?.side).toBe("short");
    expect(handoff?.limitPrice).toBe("99"); // deepest bid needed for qty 2
    expect(handoff?.quantity).toBe("2");
    expect(handoff?.maxSpend).toBe("198"); // minimum proceeds = 2 * 99
    expect(handoff?.commands[2].command).toContain("--side sell");
    expect(handoff?.commands[2].command).toContain("--price 99");
    expect(handoff?.notes[0]).toContain("OPENS a short");
    expect(handoff?.reducedToFitBudget).toBe(false); // selling cannot overspend
  });
});
