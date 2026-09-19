import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  QuotaConfigurationMismatchError,
  QuotaStore,
  type QuotaResponse,
  type ReserveInput,
  type SettleInput,
  MICRODOLLARS,
  usdToMicros,
  type QuotaLimits,
} from "./store.ts";

const BODY_MAX_BYTES = 32_768;
const MIN_USD = 1 / MICRODOLLARS;
const DEFAULT_DATABASE_PATH = "./quota-service/data/quota.sqlite";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8_787;

export type QuotaServiceConfig = {
  token: string;
  databasePath: string;
  host: string;
  port: number;
  limits: QuotaLimits;
};

export class QuotaServiceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaServiceConfigurationError";
  }
}

class QuotaRequestError extends Error {
  readonly status: 400 | 413;

  constructor(message: string, status: 400 | 413 = 400) {
    super(message);
    this.name = "QuotaRequestError";
    this.status = status;
  }
}

function envString(env: NodeJS.ProcessEnv, name: string, fallback?: string) {
  const value = env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new QuotaServiceConfigurationError(`${name} is required.`);
}

function positiveUsd(env: NodeJS.ProcessEnv, name: string) {
  const raw = envString(env, name);
  const value = Number(raw);
  try {
    return usdToMicros(value);
  } catch {
    throw new QuotaServiceConfigurationError(`${name} must be a positive USD amount.`);
  }
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback?: string) {
  const raw = envString(env, name, fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new QuotaServiceConfigurationError(`${name} must be a positive whole number.`);
  }
  return value;
}

export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): QuotaServiceConfig {
  const token = envString(env, "THESIS_QUOTA_SERVICE_TOKEN");
  if (token.length < 8) throw new QuotaServiceConfigurationError("THESIS_QUOTA_SERVICE_TOKEN must be at least 8 characters.");
  const maxCallCostMicros = positiveUsd(env, "THESIS_QUOTA_MAX_CALL_COST_USD");
  const dailyBudgetMicros = positiveUsd(env, "THESIS_QUOTA_DAILY_BUDGET_USD");
  const perVisitorBudgetMicros = positiveUsd(env, "THESIS_QUOTA_PER_VISITOR_BUDGET_USD");
  const providerHardLimitMicros = positiveUsd(env, "THESIS_QUOTA_PROVIDER_HARD_LIMIT_USD");
  const maxConcurrent = positiveInteger(env, "THESIS_QUOTA_MAX_CONCURRENT");
  const leaseSeconds = Number(envString(env, "THESIS_QUOTA_LEASE_SECONDS", "60"));
  if (leaseSeconds !== 60) throw new QuotaServiceConfigurationError("THESIS_QUOTA_LEASE_SECONDS must be exactly 60.");
  if (perVisitorBudgetMicros > dailyBudgetMicros) throw new QuotaServiceConfigurationError("Per-visitor budget cannot exceed the daily budget.");
  if (providerHardLimitMicros > dailyBudgetMicros) throw new QuotaServiceConfigurationError("Provider hard limit cannot exceed the daily budget.");
  if (maxCallCostMicros > providerHardLimitMicros) throw new QuotaServiceConfigurationError("Per-call cost cannot exceed the provider hard limit.");
  return {
    token,
    databasePath: envString(env, "THESIS_QUOTA_DATABASE_PATH", DEFAULT_DATABASE_PATH),
    host: envString(env, "THESIS_QUOTA_HOST", DEFAULT_HOST),
    port: positiveInteger(env, "THESIS_QUOTA_PORT", String(DEFAULT_PORT)),
    limits: {
      maxCallCostMicros,
      dailyBudgetMicros,
      perVisitorBudgetMicros,
      providerHardLimitMicros,
      maxConcurrent,
      leaseSeconds,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new QuotaRequestError(`Unknown quota request field: ${key}.`);
  }
  for (const key of expected) {
    if (!(key in value)) throw new QuotaRequestError(`Missing quota request field: ${key}.`);
  }
}

function requiredString(value: Record<string, unknown>, name: string, pattern?: RegExp) {
  const field = value[name];
  if (typeof field !== "string" || field.length < 8 || field.length > 256) {
    throw new QuotaRequestError(`${name} must be a bounded string.`);
  }
  if (pattern && !pattern.test(field)) throw new QuotaRequestError(`${name} has an invalid format.`);
  return field;
}

function requiredNumber(value: Record<string, unknown>, name: string, minimum: number) {
  const field = value[name];
  if (typeof field !== "number" || !Number.isFinite(field) || field < minimum || field > Number.MAX_SAFE_INTEGER / MICRODOLLARS) {
    throw new QuotaRequestError(`${name} must be a finite number.`);
  }
  return field;
}

function requiredInteger(value: Record<string, unknown>, name: string) {
  const field = requiredNumber(value, name, 1);
  if (!Number.isInteger(field)) throw new QuotaRequestError(`${name} must be a whole number.`);
  return field;
}

function parseRequest(body: unknown): ReserveInput | SettleInput {
  if (!isRecord(body) || typeof body.operation !== "string") throw new QuotaRequestError("Quota request must be an object with an operation.");
  if (body.operation === "reserve") {
    exactKeys(body, [
      "operation",
      "idempotencyKey",
      "requestId",
      "visitorKey",
      "reservationUsd",
      "dailyBudgetUsd",
      "perVisitorBudgetUsd",
      "providerHardLimitUsd",
      "maxConcurrent",
      "expiresInSeconds",
    ]);
    const idempotencyKey = requiredString(body, "idempotencyKey");
    const requestId = requiredString(body, "requestId");
    if (requestId !== idempotencyKey) throw new QuotaRequestError("requestId must equal idempotencyKey.");
    const visitorKey = requiredString(body, "visitorKey", /^[a-f0-9]{64}$/);
    const expiresInSeconds = requiredInteger(body, "expiresInSeconds");
    if (expiresInSeconds !== 60) throw new QuotaRequestError("expiresInSeconds must be exactly 60.");
    return {
      operation: "reserve",
      idempotencyKey,
      requestId,
      visitorKey,
      reservationUsd: requiredNumber(body, "reservationUsd", MIN_USD),
      dailyBudgetUsd: requiredNumber(body, "dailyBudgetUsd", MIN_USD),
      perVisitorBudgetUsd: requiredNumber(body, "perVisitorBudgetUsd", MIN_USD),
      providerHardLimitUsd: requiredNumber(body, "providerHardLimitUsd", MIN_USD),
      maxConcurrent: requiredInteger(body, "maxConcurrent"),
      expiresInSeconds,
    };
  }
  if (body.operation === "settle") {
    exactKeys(body, ["operation", "idempotencyKey", "reservationId", "actualCostUsd"]);
    const idempotencyKey = requiredString(body, "idempotencyKey");
    const reservationId = requiredString(body, "reservationId");
    if (idempotencyKey !== reservationId) throw new QuotaRequestError("settlement idempotencyKey must equal reservationId.");
    return {
      operation: "settle",
      idempotencyKey,
      reservationId,
      actualCostUsd: requiredNumber(body, "actualCostUsd", 0),
    };
  }
  throw new QuotaRequestError("Quota operation must be reserve or settle.");
}

async function readBody(request: IncomingMessage) {
  const declaredLength = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > BODY_MAX_BYTES) throw new QuotaRequestError("Quota request body is too large.", 413);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > BODY_MAX_BYTES) throw new QuotaRequestError("Quota request body is too large.", 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new QuotaRequestError("Quota request body must be valid JSON.");
  }
}

function writeJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function authorized(request: IncomingMessage, expectedToken: string) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function requestPath(request: IncomingMessage) {
  return new URL(request.url ?? "/", "http://quota.service");
}

async function routeRequest(request: IncomingMessage, response: ServerResponse, config: QuotaServiceConfig, store: QuotaStore) {
  const url = requestPath(request);
  if (request.method === "GET" && url.pathname === "/healthz") {
    writeJson(response, 200, { ok: true, service: "thesisgate-quota" });
    return;
  }
  if (!authorized(request, config.token)) {
    writeJson(response, 401, { error: "Quota service authorization required." });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/reconciliation") {
    const rawLimit = Number(url.searchParams.get("limit") ?? "100");
    const rows = store.reconciliation(Number.isFinite(rawLimit) ? rawLimit : 100);
    writeJson(response, 200, { reservations: rows });
    return;
  }
  if (request.method !== "POST" || url.pathname !== "/v1/reservations") {
    writeJson(response, 404, { error: "Quota service route not found." });
    return;
  }
  const parsed = parseRequest(await readBody(request));
  const result: QuotaResponse = parsed.operation === "reserve" ? store.reserve(parsed) : store.settle(parsed);
  writeJson(response, 200, result);
}

export function createQuotaServer(config: QuotaServiceConfig) {
  const store = new QuotaStore(config.databasePath, config.limits);
  const server = createServer((request, response) => {
    void routeRequest(request, response, config, store).catch((error: unknown) => {
      if (error instanceof QuotaRequestError) {
        writeJson(response, error.status, { error: error.message });
        return;
      }
      if (error instanceof QuotaConfigurationMismatchError) {
        writeJson(response, 503, { error: "Quota service configuration does not match the calling app." });
        return;
      }
      console.error("Quota service request failed", error instanceof Error ? error.message : "unknown error");
      writeJson(response, 503, { error: "Quota service temporarily unavailable." });
    });
  });
  return { server, store };
}

export async function startQuotaService(config = loadServiceConfig()) {
  const { server, store } = createQuotaServer(config);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolveListen());
  });
  console.log(`ThesisGate quota service listening on ${config.host}:${config.port}`);
  const shutdown = () => {
    server.close(() => store.close());
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { server, store };
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  void startQuotaService().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Quota service failed to start.");
    process.exitCode = 1;
  });
}
