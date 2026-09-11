import "server-only";

import { z } from "zod";
import { newId, sha256 } from "./identifiers";

export class RequestValidationError extends Error {
  constructor(message: string) {
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
  if (declaredLength > maxBytes) throw new RequestValidationError("Request body is too large.");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) throw new RequestValidationError("Request body is too large.");
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
