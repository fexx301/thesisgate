import { afterEach, describe, expect, it, vi } from "vitest";
import { assertAllowedOrigin, RequestOriginError } from "../../src/server/http";

afterEach(() => {
  vi.unstubAllEnvs();
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
