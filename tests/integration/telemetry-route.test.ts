import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/telemetry/route";
import { resetRouteRateLimitsForTests } from "../../src/server/http";

beforeEach(() => {
  resetRouteRateLimitsForTests();
  vi.stubEnv("THESIS_TELEMETRY_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());

const event = { event: "session_started", sessionId: "test-session-012345", occurredAt: "2026-09-17T00:00:00.000Z" };
function request(body = JSON.stringify(event)) {
  return new Request("http://localhost/api/telemetry", { method: "POST", body });
}

describe("telemetry request boundaries", () => {
  it("accepts bounded events and rate limits before recording", async () => {
    for (let index = 0; index < 30; index += 1) expect((await POST(request())).status).toBe(204);
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: expect.stringContaining("Rate limit exceeded") });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("preserves JSON validation and body-size status conventions", async () => {
    expect((await POST(request("not-json"))).status).toBe(400);
    expect((await POST(request(" ".repeat(4_001)))).status).toBe(413);
  });

  it("preserves production origin rejection", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("THESIS_PUBLIC_ORIGINS", "https://app.example");
    expect((await POST(request())).status).toBe(403);
  });
});
