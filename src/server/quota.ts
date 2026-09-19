import "server-only";

import { z } from "zod";

const QUOTA_RESPONSE_MAX_BYTES = 8_192;
const QUOTA_TIMEOUT_MS = 3_000;

export class ModelQuotaError extends Error {
  readonly kind: "configuration" | "denied" | "transport" | "invalid_response";

  constructor(kind: ModelQuotaError["kind"], message: string) {
    super(message);
    this.name = "ModelQuotaError";
    this.kind = kind;
  }
}

type QuotaConfig = {
  endpoint: string;
  token: string;
  maxCallCostUsd: number;
  dailyBudgetUsd: number;
  perVisitorBudgetUsd: number;
  maxConcurrent: number;
  providerHardLimitUsd: number;
};

const QuotaResponseSchema = z
  .object({
    allowed: z.boolean(),
    reservationId: z.string().min(8).optional(),
    reason: z.string().max(240).optional(),
    remainingUsd: z.number().nonnegative().optional(),
    activeRequests: z.number().int().nonnegative().optional(),
  })
  .strict();

function positiveNumber(name: string) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ModelQuotaError("configuration", `${name} must be a positive number.`);
  }
  return value;
}

function positiveInteger(name: string) {
  const value = positiveNumber(name);
  if (!Number.isInteger(value)) {
    throw new ModelQuotaError("configuration", `${name} must be a whole number.`);
  }
  return value;
}

function endpointValue() {
  const raw = process.env.THESIS_LLM_QUOTA_URL?.trim();
  if (!raw) throw new ModelQuotaError("configuration", "THESIS_LLM_QUOTA_URL is required for production model calls.");
  try {
    const url = new URL(raw);
    const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if ((url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && localDevelopment)) || url.username || url.password) {
      throw new Error("unsafe quota endpoint");
    }
    return url.toString();
  } catch {
    throw new ModelQuotaError("configuration", "THESIS_LLM_QUOTA_URL must be an HTTPS URL without credentials.");
  }
}

function quotaConfig(): QuotaConfig {
  const token = process.env.THESIS_LLM_QUOTA_TOKEN?.trim();
  if (!token) throw new ModelQuotaError("configuration", "THESIS_LLM_QUOTA_TOKEN is required for production model calls.");
  const maxCallCostUsd = positiveNumber("THESIS_LLM_MAX_CALL_COST_USD");
  const dailyBudgetUsd = positiveNumber("THESIS_LLM_DAILY_BUDGET_USD");
  const perVisitorBudgetUsd = positiveNumber("THESIS_LLM_PER_VISITOR_BUDGET_USD");
  const maxConcurrent = positiveInteger("THESIS_LLM_MAX_CONCURRENT");
  const providerHardLimitUsd = positiveNumber("THESIS_LLM_PROVIDER_HARD_LIMIT_USD");
  if (perVisitorBudgetUsd > dailyBudgetUsd) {
    throw new ModelQuotaError("configuration", "THESIS_LLM_PER_VISITOR_BUDGET_USD cannot exceed the daily budget.");
  }
  if (providerHardLimitUsd > dailyBudgetUsd) {
    throw new ModelQuotaError("configuration", "THESIS_LLM_PROVIDER_HARD_LIMIT_USD cannot exceed the daily budget.");
  }
  if (maxCallCostUsd > providerHardLimitUsd) {
    throw new ModelQuotaError("configuration", "THESIS_LLM_MAX_CALL_COST_USD cannot exceed the provider hard limit.");
  }
  if (!process.env.THESIS_VISITOR_HASH_SECRET?.trim()) {
    throw new ModelQuotaError("configuration", "THESIS_VISITOR_HASH_SECRET is required for production model calls.");
  }
  return {
    endpoint: endpointValue(),
    token,
    maxCallCostUsd,
    dailyBudgetUsd,
    perVisitorBudgetUsd,
    maxConcurrent,
    providerHardLimitUsd,
  };
}

export function assertProductionBudgetControls() {
  if (process.env.NODE_ENV !== "production") return;
  quotaConfig();
}

export function maxModelCallCostUsd() {
  if (process.env.NODE_ENV !== "production") return 0;
  return quotaConfig().maxCallCostUsd;
}

function localDevelopmentConcurrency() {
  const raw = process.env.THESIS_LLM_LOCAL_MAX_CONCURRENT?.trim();
  if (!raw) return 2;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 20) return 2;
  return value;
}

let activeModelCalls = 0;

// Local time-window guard: 5 model analyses per visitor per 10 minutes + global daily ceiling.
// This is a single-process guard for development and a defense-in-depth check in production;
// production multi-instance enforcement remains the durable THESIS_LLM_QUOTA_URL service.
const VISITOR_WINDOW_MS = 10 * 60 * 1000;
const VISITOR_MAX = 5;
const GLOBAL_DAILY_MAX = 200;
const visitorCalls = new Map<string, number[]>();
let globalDayKey = "";
let globalDayCount = 0;

function dayKey(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

export function checkLocalModelRateLimit(visitorKey: string) {
  const now = Date.now();
  for (const [key, calls] of visitorCalls) {
    if (now - calls[calls.length - 1] >= VISITOR_WINDOW_MS) visitorCalls.delete(key);
  }
  const day = dayKey(now);
  if (day !== globalDayKey) {
    globalDayKey = day;
    globalDayCount = 0;
  }
  if (globalDayCount >= GLOBAL_DAILY_MAX) {
    throw new ModelQuotaError("denied", "The daily model-analysis budget is exhausted. Replay captured results remain available.");
  }
  const calls = (visitorCalls.get(visitorKey) ?? []).filter((t) => now - t < VISITOR_WINDOW_MS);
  if (calls.length >= VISITOR_MAX) {
    throw new ModelQuotaError("denied", "Five analyses per visitor per ten minutes. Retry shortly; replay and exports remain available.");
  }
  calls.push(now);
  visitorCalls.set(visitorKey, calls);
  globalDayCount += 1;
}

export function resetLocalRateLimitsForTests() {
  visitorCalls.clear();
  globalDayKey = "";
  globalDayCount = 0;
  activeModelCalls = 0;
}

export function acquireModelSlot() {
  const limit = process.env.NODE_ENV === "production" ? quotaConfig().maxConcurrent : localDevelopmentConcurrency();
  if (activeModelCalls >= limit) {
    throw new ModelQuotaError("denied", "The claim-assessment concurrency limit is currently full. Retry after the active request finishes.");
  }
  activeModelCalls += 1;
  return () => {
    activeModelCalls = Math.max(0, activeModelCalls - 1);
  };
}

async function readQuotaResponse(response: Response) {
  if (!response.body) throw new ModelQuotaError("invalid_response", "The quota service response had no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > QUOTA_RESPONSE_MAX_BYTES) {
        throw new ModelQuotaError("invalid_response", "The quota service response was too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    void reader.cancel("quota intake stopped").catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ModelQuotaError("invalid_response", "The quota service did not return JSON.");
  }
  const result = QuotaResponseSchema.safeParse(parsed);
  if (!result.success) throw new ModelQuotaError("invalid_response", "The quota service response did not match its contract.");
  return result.data;
}

async function quotaRequest(config: QuotaConfig, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUOTA_TIMEOUT_MS);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new ModelQuotaError("transport", `The quota service returned HTTP ${response.status}.`);
    return await readQuotaResponse(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ModelQuotaError("transport", "The quota service timed out.");
    }
    if (error instanceof ModelQuotaError) throw error;
    throw new ModelQuotaError("transport", "The quota service could not be reached.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function reserveModelBudget(input: { requestId: string; visitorKey: string }) {
  if (process.env.NODE_ENV !== "production") return null;
  const config = quotaConfig();
  const result = await quotaRequest(config, {
    operation: "reserve",
    idempotencyKey: input.requestId,
    requestId: input.requestId,
    visitorKey: input.visitorKey,
    reservationUsd: config.maxCallCostUsd,
    dailyBudgetUsd: config.dailyBudgetUsd,
    perVisitorBudgetUsd: config.perVisitorBudgetUsd,
    providerHardLimitUsd: config.providerHardLimitUsd,
    maxConcurrent: config.maxConcurrent,
    // Only the concurrency lease expires. Spend must stay reserved until settlement.
    expiresInSeconds: 60,
  });
  if (!result.allowed) {
    throw new ModelQuotaError("denied", result.reason ?? "The configured model budget or concurrency limit denied this request.");
  }
  if (!result.reservationId) {
    throw new ModelQuotaError("invalid_response", "The quota service allowed a request without a reservation ID.");
  }
  return { reservationId: result.reservationId, reservedCostUsd: config.maxCallCostUsd };
}

export async function settleModelBudget(input: { reservationId: string; actualCostUsd: number }) {
  if (process.env.NODE_ENV !== "production") return;
  const config = quotaConfig();
  try {
    const result = await quotaRequest(config, {
      operation: "settle",
      idempotencyKey: input.reservationId,
      reservationId: input.reservationId,
      actualCostUsd: Number.isFinite(input.actualCostUsd) && input.actualCostUsd >= 0 ? input.actualCostUsd : config.maxCallCostUsd,
    });
    if (!result.allowed) throw new ModelQuotaError("transport", "The quota service rejected settlement.");
  } catch {
    // Do not cancel/refund an uncertain settlement or repeat the paid provider call.
    throw new ModelQuotaError("transport", "Model budget settlement was not confirmed. The spend reservation must remain held pending reconciliation.");
  }
}
