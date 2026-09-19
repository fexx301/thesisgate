import "server-only";

import { z } from "zod";
import { newId, sha256 } from "./identifiers";

export class RequestValidationError extends Error {
  constructor(message: string, readonly status: 400 | 413 | 429 = 400) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export class RequestOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestOriginError";
  }
}

export type RequestContext = {
  requestId: string;
  visitorKey: string;
};

function configuredOrigins() {
  return (process.env.THESIS_PUBLIC_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        const url = new URL(value);
        const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
        if ((url.protocol !== "https:" && !localDevelopment) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
          return [];
        }
        return [url.origin];
      } catch {
        return [];
      }
    });
}

/**
 * Cost-bearing/public POST routes must be called from an explicitly configured
 * browser origin in production. Local and test runs stay usable without a
 * deployment-specific origin, while an unset production allowlist fails closed.
 */
export function assertAllowedOrigin(request: Request) {
  if (process.env.NODE_ENV !== "production") return;
  const origin = request.headers.get("origin");
  const allowed = configuredOrigins();
  if (!origin || !allowed.includes(origin)) {
    throw new RequestOriginError("This API accepts browser requests only from the configured application origin.");
  }
}

/**
 * Creates a non-reversible visitor bucket for quota accounting. The raw proxy
 * address is never returned, logged, or sent to the model provider.
 */
export function requestContext(request: Request): RequestContext {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  const secret = process.env.THESIS_VISITOR_HASH_SECRET?.trim() || "local-development-only";
  return {
    requestId: newId("req"),
    visitorKey: sha256(`${secret}:${address}`),
  };
}

export async function parseJsonRequest<T>(request: Request, schema: z.ZodType<T>, maxBytes: number) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) {
    void request.body?.cancel("request body too large").catch(() => {});
    throw new RequestValidationError("Request body is too large.", 413);
  }
  if (!request.body) throw new RequestValidationError("Request body must be valid JSON.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new RequestValidationError("Request body timed out.")), 5_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new RequestValidationError("Request body is too large.", 413);
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    // Never await cancellation: a disconnected body's cancel hook can itself stall.
    void reader.cancel("request intake stopped").catch(() => {});
    if (error instanceof RequestValidationError) throw error;
    throw new RequestValidationError("Request body could not be read.");
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new RequestValidationError("Request body must be valid JSON.");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new RequestValidationError(result.error.issues[0]?.message ?? "Request body is invalid.");
  return result.data;
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

// Generic per-visitor time-window limiter for all POST routes (defense in depth).
// Production multi-instance enforcement is the durable quota service; this prevents single-process abuse.
const ROUTE_WINDOW_MS = 60_000;
const ROUTE_MAX = 30;
const routeCalls = new Map<string, number[]>();
const ROUTE_BUCKET_MAX = 10_000;

export function checkRouteRateLimit(visitorKey: string, route: string) {
  const now = Date.now();
  // Map insertion order tracks last activity; remove only expired buckets.
  for (const [bucket, history] of routeCalls) {
    if (now - history[history.length - 1] < ROUTE_WINDOW_MS) break;
    routeCalls.delete(bucket);
  }
  const key = `${route}:${visitorKey}`;
  if (!routeCalls.has(key) && routeCalls.size >= ROUTE_BUCKET_MAX) {
    throw new RequestValidationError("Rate limit capacity is full. Retry shortly.", 429);
  }
  const calls = (routeCalls.get(key) ?? []).filter((t) => now - t < ROUTE_WINDOW_MS);
  if (calls.length >= ROUTE_MAX) {
    throw new RequestValidationError("Rate limit exceeded. Retry shortly; previous results and replay remain available.", 429);
  }
  calls.push(now);
  routeCalls.delete(key);
  routeCalls.set(key, calls);
}

export function resetRouteRateLimitsForTests() {
  routeCalls.clear();
}
