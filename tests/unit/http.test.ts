import { afterEach, describe, expect, it, vi } from "vitest";
import { assertAllowedOrigin, parseJsonRequest, RequestOriginError } from "../../src/server/http";
import { z } from "zod";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("production request origin boundary", () => {
  it("does not interfere with local and test requests", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => assertAllowedOrigin(new Request("http://localhost/api/research", { method: "POST" }))).not.toThrow();
  });

  it("fails closed when production has no exact origin allowlist", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertAllowedOrigin(new Request("https://demo.example/api/research", { method: "POST" }))).toThrow(RequestOriginError);
  });

  it("accepts only an explicitly configured exact origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("THESIS_PUBLIC_ORIGINS", "https://demo.example");
    expect(() => assertAllowedOrigin(new Request("https://demo.example/api/research", {
      method: "POST",
      headers: { origin: "https://demo.example" },
    }))).not.toThrow();
    expect(() => assertAllowedOrigin(new Request("https://demo.example/api/research", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }))).toThrow(RequestOriginError);
  });
});

describe("bounded JSON intake", () => {
  it("accepts split UTF-8 JSON exactly at the byte limit", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ label: "café" }));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    const request = new Request("http://localhost/api/test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(parseJsonRequest(request, z.object({ label: z.string() }), bytes.length)).resolves.toEqual({ label: "café" });
  });

  it("cancels over-limit intake without waiting for the cancel hook", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode("12345"));
    }, cancel });
    const request = new Request("http://localhost/api/test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(parseJsonRequest(request, z.unknown(), 4)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized declared bodies before reading", async () => {
    const request = new Request("http://localhost/api/test", { method: "POST", headers: { "content-length": "5" }, body: "null" });
    await expect(parseJsonRequest(request, z.unknown(), 4)).rejects.toMatchObject({ status: 413 });
  });

  it("bounds total wait and cancels an unfinished body", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const request = new Request("http://localhost/api/test", {
      method: "POST", body: new ReadableStream<Uint8Array>({ cancel }), duplex: "half",
    } as RequestInit);
    const result = expect(parseJsonRequest(request, z.unknown(), 100)).rejects.toMatchObject({ status: 400, message: "Request body timed out." });
    await vi.advanceTimersByTimeAsync(5_000);
    await result;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["not-json", "{}"])("keeps malformed JSON/schema at 400: %s", async (body) => {
    const request = new Request("http://localhost/api/test", { method: "POST", body });
    await expect(parseJsonRequest(request, z.object({ name: z.string() }), 100)).rejects.toMatchObject({ status: 400 });
  });
});
