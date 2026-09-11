import { describe, expect, it } from "vitest";
import { POST } from "../../src/app/api/recompute/route";
import { syntheticInstrument, syntheticSnapshot } from "../../src/domain/economics";
import { createRecomputeToken } from "../../src/server/recompute";

const plan = {
  asset: "NVDA" as const,
  category: "SPOT" as const,
  side: "long" as const,
  quoteCurrency: "USDT" as const,
  thesis: "A narrow source claim.",
  purchaseNotionalExcludingFee: "100",
  horizon: { originalText: "tomorrow", endAtUTC: null, timezone: null },
  goal: { kind: "break_even" as const },
  exitAssumptions: { depthMultiplier: "1", priceHaircut: "0", depthOrigin: "illustrative_preset" as const, haircutOrigin: "illustrative_preset" as const },
  scenario: { bidPriceShift: "0.01", assumptionOrigin: "user" as const },
  invalidation: null,
  feeIn: "0.001",
  feeOut: "0.001",
  feeOrigin: "published_standard_assumption" as const,
};

describe("economics recompute route", () => {
  it("reuses a validated market snapshot without invoking the model path", async () => {
    const instrument = syntheticInstrument();
    const snapshot = syntheticSnapshot();
    const response = await POST(new Request("http://localhost/api/recompute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plan,
        instrument,
        snapshot,
        recomputeToken: createRecomputeToken(instrument, snapshot),
        planRevision: 4,
        scenarioRevision: 4,
      }),
    }));
    expect(response.status).toBe(200);
    const result = await response.json() as { performance: { reusedEvidence: boolean; modelCalls: number }; economics: { computationStatus: string } };
    expect(result.performance.reusedEvidence).toBe(true);
    expect(result.performance.modelCalls).toBe(0);
    expect(result.economics.computationStatus).toBe("calculated");
  });

  it("rejects a browser-substituted snapshot", async () => {
    const instrument = syntheticInstrument();
    const snapshot = syntheticSnapshot();
    const tamperedSnapshot = { ...snapshot, bids: [["1", "1"]] };
    const response = await POST(new Request("http://localhost/api/recompute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plan,
        instrument,
        snapshot: tamperedSnapshot,
        recomputeToken: createRecomputeToken(instrument, snapshot),
        planRevision: 4,
        scenarioRevision: 4,
      }),
    }));
    expect(response.status).toBe(409);
  });
});
