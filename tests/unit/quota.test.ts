import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { checkLocalModelRateLimit, resetLocalRateLimitsForTests } from "../../src/server/quota";
import { checkRouteRateLimit, resetRouteRateLimitsForTests } from "../../src/server/http";

afterEach(() => vi.useRealTimers());

describe("local rate limits", () => {
  beforeEach(() => {
    resetLocalRateLimitsForTests();
    resetRouteRateLimitsForTests();
  });

  it("allows five model analyses per visitor per ten minutes, then denies", () => {
    for (let i = 0; i < 12; i += 1) {
      expect(() => checkLocalModelRateLimit("visitor-a")).not.toThrow();
    }
    expect(() => checkLocalModelRateLimit("visitor-a")).toThrow();
  });

  it("isolates visitors", () => {
    for (let i = 0; i < 12; i += 1) checkLocalModelRateLimit("visitor-a");
    expect(() => checkLocalModelRateLimit("visitor-b")).not.toThrow();
  });

  it("limits generic routes to thirty per minute", () => {
    for (let i = 0; i < 30; i += 1) {
      expect(() => checkRouteRateLimit("v", "research")).not.toThrow();
    }
    expect(() => checkRouteRateLimit("v", "research")).toThrow();
  });

  it("expires local windows without removing the independent daily ceiling", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T12:00:00Z"));
    for (let i = 0; i < 600; i += 1) checkLocalModelRateLimit(`visitor-${i}`);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(() => checkLocalModelRateLimit("new-visitor")).toThrow("daily model-analysis budget");
    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
    expect(() => checkLocalModelRateLimit("new-visitor")).not.toThrow();
  });

  it("reclaims expired route buckets without evicting active visitor limits", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 10_000; i += 1) checkRouteRateLimit(`v-${i}`, "telemetry");
    expect(() => checkRouteRateLimit("overflow", "telemetry")).toThrow("capacity");
    for (let i = 1; i < 30; i += 1) checkRouteRateLimit("v-0", "telemetry");
    expect(() => checkRouteRateLimit("v-0", "telemetry")).toThrow("Rate limit exceeded");
    vi.advanceTimersByTime(60_000);
    expect(() => checkRouteRateLimit("overflow", "telemetry")).not.toThrow();
  });
});

describe("quota endpoint transport", () => {
  it("allows plain HTTP only to hosts that are not reachable from the public internet", async () => {
    const { isPrivateServiceHost } = await import("../../src/server/quota");
    expect(isPrivateServiceHost("quota")).toBe(true);
    expect(isPrivateServiceHost("127.0.0.1")).toBe(true);
    expect(isPrivateServiceHost("localhost")).toBe(true);
    expect(isPrivateServiceHost("quota.example.com")).toBe(false);
    expect(isPrivateServiceHost("10.0.0.5")).toBe(false);
    expect(isPrivateServiceHost("203.0.113.9")).toBe(false);
  });
});

describe("model slot queue", () => {
  it("queues a burst instead of denying it, and denies only after the wait expires", async () => {
    const { acquireModelSlot, resetLocalRateLimitsForTests: reset } = await import("../../src/server/quota");
    reset();
    vi.stubEnv("THESIS_LLM_LOCAL_MAX_CONCURRENT", "2");
    try {
      const first = await acquireModelSlot(50);
      const second = await acquireModelSlot(50);
      const order: string[] = [];
      const third = acquireModelSlot(2_000).then((release) => { order.push("third"); return release; });
      const fourth = acquireModelSlot(2_000).then((release) => { order.push("fourth"); return release; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(order).toEqual([]);
      first();
      const releaseThird = await third;
      expect(order).toEqual(["third"]);
      second();
      const releaseFourth = await fourth;
      expect(order).toEqual(["third", "fourth"]);
      // Both slots are held again, so a short wait ends in a denial rather than hanging.
      await expect(acquireModelSlot(30)).rejects.toThrow("slots stayed busy");
      releaseThird();
      // A freed slot is usable immediately.
      const fifth = await acquireModelSlot(50);
      fifth();
      releaseFourth();
    } finally {
      vi.unstubAllEnvs();
      reset();
    }
  });
});
