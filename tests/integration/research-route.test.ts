import { describe, expect, it } from "vitest";
import { POST } from "../../src/app/api/research/route";

const requestBody = {
  plan: {
    asset: "NVDA",
    category: "SPOT",
    side: "long",
    quoteCurrency: "USDT",
    thesis: "The announcement means rNVDA will rise 1% by tomorrow.",
    purchaseNotionalExcludingFee: "10000",
    horizon: { originalText: "tomorrow", endAtUTC: null, timezone: null },
    goal: { kind: "profit_usdt", amount: "100" },
    exitAssumptions: { depthMultiplier: "1", priceHaircut: "0", depthOrigin: "illustrative_preset", haircutOrigin: "illustrative_preset" },
    scenario: { bidPriceShift: "0.003", assumptionOrigin: "illustrative_preset" },
    invalidation: null,
    feeIn: "0.001",
    feeOut: "0.001",
    feeOrigin: "published_standard_assumption",
  },
  sourceText: "An issuer describes a planned deployment.",
  sourceUrl: null,
  marketMode: "captured_real",
  inputRevision: 7,
};

describe("research route", () => {
  it("rejects invalid JSON input", async () => {
    const response = await POST(new Request("http://localhost/api/research", { method: "POST", body: "not-json" }));
    expect(response.status).toBe(400);
  });

  it("returns economics while marking the unavailable model explicitly", async () => {
    const response = await POST(new Request("http://localhost/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    }));
    expect(response.status).toBe(200);
    const result = await response.json() as { evidence: { status: string }; economics: { computationStatus: string }; modelId: string | null };
    expect(result.evidence.status).toBe("unavailable");
    expect(result.economics.computationStatus).toBe("calculated");
    expect(result.modelId).toBeNull();
  });
});
