import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/research/route";
import { resetLocalRateLimitsForTests } from "../../src/server/quota";
import { resetRouteRateLimitsForTests } from "../../src/server/http";

beforeEach(() => {
  resetLocalRateLimitsForTests();
  resetRouteRateLimitsForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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

  it("reports a paid final-evidence failure as a partial result with usage", async () => {
    vi.stubEnv("THESIS_LLM_ENABLED", "true");
    vi.stubEnv("THESIS_LLM_API_KEY", "test-key");
    vi.stubEnv("THESIS_LLM_BASE_URL", "https://provider.example/responses");
    vi.stubEnv("THESIS_LLM_MODEL", "configured-model");
    vi.stubEnv("THESIS_LLM_PROTOCOL", "openai_responses");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      model: "reported-model", status: "completed", usage: { input_tokens: 12, output_tokens: 8, cost: 0.003 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ summary: "", mostConsequentialUnknown: null, claims: [] }) }] }],
    })));
    const response = await POST(new Request("http://localhost/api/research", { method: "POST", body: JSON.stringify(requestBody) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.evidence.status).toBe("unavailable");
    expect(result.economics.computationStatus).toBe("calculated");
    expect(result.modelId).toBe("reported-model");
    expect(result.performance).toMatchObject({ modelCalls: 1, modelRunStatus: "provider_failed", modelUsage: { costUsd: "0.003", promptTokens: 12, completionTokens: 8 } });
    expect(result.partialErrors).toContainEqual(expect.objectContaining({ kind: "model_invalid_output" }));
  });
});

describe("research with retrieved headlines", () => {
  it("assesses a captured official release selected by ID and adds the priced-in context", async () => {
    const { capturedHeadlines } = await import("../../src/server/feeds");
    const [headline] = capturedHeadlines("NVDA");
    const response = await POST(new Request("http://localhost/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, sourceText: null, headlineIds: [headline.id] }),
    }));
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.headlineIds).toEqual([headline.id]);
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0].provenance).toBe("captured_official_excerpt");
    expect(report.sources[0].publicationDate).toBe("2026-08-26");
    expect(report.promptVersion).toBe("claims-v5-multisource");
    expect(report.marketContext.session.state).toBe("post_market");
    expect(report.marketContext.underlying.lastClose).toBe("225.73");
    expect(report.partialErrors.some((error: { kind: string }) => error.kind === "source_missing")).toBe(false);
  });

  it("rejects headline text smuggled in place of an ID and reports an unknown ID as a partial", async () => {
    const smuggled = await POST(new Request("http://localhost/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, headlineIds: ["Nvidia confirms record revenue"] }),
    }));
    expect(smuggled.status).toBe(400);
    const unknown = await POST(new Request("http://localhost/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, headlineIds: ["hl_0000000000000000"] }),
    }));
    const report = await unknown.json();
    expect(report.headlineIds).toEqual([]);
    expect(report.partialErrors.some((error: { message: string }) => error.message.includes("no longer available"))).toBe(true);
  });
});
