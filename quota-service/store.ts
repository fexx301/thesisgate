import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const MICRODOLLARS = 1_000_000;

export type QuotaLimits = {
  maxCallCostMicros: number;
  dailyBudgetMicros: number;
  perVisitorBudgetMicros: number;
  providerHardLimitMicros: number;
  maxConcurrent: number;
  leaseSeconds: number;
};

export type ReserveInput = {
  operation: "reserve";
  idempotencyKey: string;
  requestId: string;
  visitorKey: string;
  reservationUsd: number;
  dailyBudgetUsd: number;
  perVisitorBudgetUsd: number;
  providerHardLimitUsd: number;
  maxConcurrent: number;
  expiresInSeconds: number;
};

export type SettleInput = {
  operation: "settle";
  idempotencyKey: string;
  reservationId: string;
  actualCostUsd: number;
};

export type QuotaResponse = {
  allowed: boolean;
  reservationId?: string;
  reason?: string;
  remainingUsd?: number;
  activeRequests?: number;
};

export type ReconciliationRow = {
  reservationId: string;
  requestId: string;
  visitorKey: string;
  reservedUsd: number;
  createdAt: string;
  leaseExpiresAt: string;
};

export class QuotaConfigurationMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaConfigurationMismatchError";
  }
}

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;

  CREATE TABLE IF NOT EXISTS reserve_requests (
    idempotency_key TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    visitor_key TEXT NOT NULL,
    day_key TEXT NOT NULL,
    reserved_micros INTEGER NOT NULL CHECK (reserved_micros > 0),
    actual_micros INTEGER,
    status TEXT NOT NULL CHECK (status IN ('pending', 'settled')),
    created_at TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    settled_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS settlement_requests (
    idempotency_key TEXT PRIMARY KEY,
    reservation_id TEXT NOT NULL REFERENCES reservations(id),
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS reservations_day_idx
    ON reservations(day_key, status);
  CREATE INDEX IF NOT EXISTS reservations_visitor_day_idx
    ON reservations(visitor_key, day_key, status);
  CREATE INDEX IF NOT EXISTS reservations_lease_idx
    ON reservations(status, lease_expires_at);
`;

function storedResponse(row: unknown): QuotaResponse {
  if (!row || typeof row !== "object") throw new Error("Quota response row was invalid.");
  const responseJson = (row as { response_json?: unknown }).response_json;
  if (typeof responseJson !== "string") throw new Error("Quota response JSON was missing.");
  const parsed = JSON.parse(responseJson) as unknown;
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { allowed?: unknown }).allowed !== "boolean") {
    throw new Error("Quota response JSON was invalid.");
  }
  return parsed as QuotaResponse;
}

function rowNumber(row: unknown, key: string) {
  if (!row || typeof row !== "object") return 0;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0);
}

function usdValue(micros: number) {
  return Number((micros / MICRODOLLARS).toFixed(6));
}

export function usdToMicros(value: number, allowZero = false) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error("USD values must be finite and positive.");
  }
  const micros = Math.round(value * MICRODOLLARS);
  if (!Number.isSafeInteger(micros) || (!allowZero && micros <= 0)) {
    throw new Error("USD value is outside the supported precision.");
  }
  return micros;
}

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function assertLimitShape(limits: QuotaLimits) {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value) && name.endsWith("Micros")) {
      throw new Error(`Invalid quota limit: ${name}.`);
    }
  }
  if (limits.maxCallCostMicros <= 0 || limits.dailyBudgetMicros <= 0 || limits.perVisitorBudgetMicros <= 0 || limits.providerHardLimitMicros <= 0) {
    throw new Error("Quota USD limits must be positive.");
  }
  if (!Number.isInteger(limits.maxConcurrent) || limits.maxConcurrent < 1) {
    throw new Error("Quota concurrency must be a positive integer.");
  }
  if (limits.leaseSeconds !== 60) throw new Error("Quota leases must be exactly 60 seconds.");
  if (limits.perVisitorBudgetMicros > limits.dailyBudgetMicros) {
    throw new Error("Per-visitor quota cannot exceed the daily quota.");
  }
  if (limits.providerHardLimitMicros > limits.dailyBudgetMicros) {
    throw new Error("Provider quota cannot exceed the daily quota.");
  }
  if (limits.maxCallCostMicros > limits.providerHardLimitMicros) {
    throw new Error("Per-call quota cannot exceed the provider quota.");
  }
}

export class QuotaStore {
  private readonly database: DatabaseSync;
  private readonly limits: QuotaLimits;

  constructor(databasePath: string, limits: QuotaLimits) {
    assertLimitShape(limits);
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath, {
      timeout: 5_000,
      enableForeignKeyConstraints: true,
      defensive: true,
    });
    this.database.exec(SCHEMA);
    this.limits = limits;
  }

  close() {
    this.database.close();
  }

  private transaction<T>(operation: () => T) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    }
  }

  private assertReserveClaims(input: ReserveInput) {
    if (input.requestId !== input.idempotencyKey) {
      throw new QuotaConfigurationMismatchError("Reserve requestId must equal idempotencyKey.");
    }
    if (input.expiresInSeconds !== this.limits.leaseSeconds) {
      throw new QuotaConfigurationMismatchError("Reserve lease duration does not match the quota service.");
    }
    const claims: Array<[string, number, number]> = [
      ["daily budget", usdToMicros(input.dailyBudgetUsd), this.limits.dailyBudgetMicros],
      ["per-visitor budget", usdToMicros(input.perVisitorBudgetUsd), this.limits.perVisitorBudgetMicros],
      ["provider hard limit", usdToMicros(input.providerHardLimitUsd), this.limits.providerHardLimitMicros],
    ];
    for (const [label, requested, configured] of claims) {
      if (requested !== configured) throw new QuotaConfigurationMismatchError(`The app ${label} does not match the quota service.`);
    }
    if (input.maxConcurrent !== this.limits.maxConcurrent) {
      throw new QuotaConfigurationMismatchError("The app concurrency limit does not match the quota service.");
    }
  }

  private spendForDay(dayKey: string) {
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(
        CASE WHEN status = 'settled' THEN actual_micros ELSE reserved_micros END
      ), 0) AS used_micros
      FROM reservations
      WHERE day_key = ?
    `).get(dayKey);
    return rowNumber(row, "used_micros");
  }

  private spendForVisitor(visitorKey: string, dayKey: string) {
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(
        CASE WHEN status = 'settled' THEN actual_micros ELSE reserved_micros END
      ), 0) AS used_micros
      FROM reservations
      WHERE visitor_key = ? AND day_key = ?
    `).get(visitorKey, dayKey);
    return rowNumber(row, "used_micros");
  }

  private activeRequests(nowIso: string) {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS active_requests
      FROM reservations
      WHERE status = 'pending' AND lease_expires_at > ?
    `).get(nowIso);
    return rowNumber(row, "active_requests");
  }

  reserve(input: ReserveInput, now = new Date()): QuotaResponse {
    this.assertReserveClaims(input);
    const reservationMicros = usdToMicros(input.reservationUsd);
    const nowIso = now.toISOString();
    const dayKey = utcDay(now);

    return this.transaction(() => {
      const existing = this.database.prepare(`
        SELECT response_json FROM reserve_requests WHERE idempotency_key = ?
      `).get(input.idempotencyKey);
      if (existing) return storedResponse(existing);

      const dailyUsed = this.spendForDay(dayKey);
      const visitorUsed = this.spendForVisitor(input.visitorKey, dayKey);
      const activeRequests = this.activeRequests(nowIso);
      let response: QuotaResponse;

      if (reservationMicros > this.limits.maxCallCostMicros) {
        response = {
          allowed: false,
          reason: "The requested reservation exceeds the per-call model budget.",
          remainingUsd: usdValue(Math.max(0, this.limits.dailyBudgetMicros - dailyUsed)),
          activeRequests,
        };
      } else if (activeRequests >= this.limits.maxConcurrent) {
        response = {
          allowed: false,
          reason: "The model concurrency lease limit is full.",
          remainingUsd: usdValue(Math.max(0, this.limits.dailyBudgetMicros - dailyUsed)),
          activeRequests,
        };
      } else if (dailyUsed + reservationMicros > this.limits.dailyBudgetMicros) {
        response = {
          allowed: false,
          reason: "The daily model budget is exhausted.",
          remainingUsd: usdValue(Math.max(0, this.limits.dailyBudgetMicros - dailyUsed)),
          activeRequests,
        };
      } else if (visitorUsed + reservationMicros > this.limits.perVisitorBudgetMicros) {
        response = {
          allowed: false,
          reason: "The per-visitor model budget is exhausted.",
          remainingUsd: usdValue(Math.max(0, this.limits.dailyBudgetMicros - dailyUsed)),
          activeRequests,
        };
      } else if (dailyUsed + reservationMicros > this.limits.providerHardLimitMicros) {
        response = {
          allowed: false,
          reason: "The provider-side service ceiling is exhausted.",
          remainingUsd: usdValue(Math.max(0, this.limits.providerHardLimitMicros - dailyUsed)),
          activeRequests,
        };
      } else {
        const reservationId = `quota_${randomUUID()}`;
        const leaseExpiresAt = new Date(now.getTime() + this.limits.leaseSeconds * 1_000).toISOString();
        this.database.prepare(`
          INSERT INTO reservations (
            id, request_id, visitor_key, day_key, reserved_micros, actual_micros,
            status, created_at, lease_expires_at, settled_at
          ) VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?, ?, NULL)
        `).run(
          reservationId,
          input.requestId,
          input.visitorKey,
          dayKey,
          reservationMicros,
          nowIso,
          leaseExpiresAt,
        );
        response = {
          allowed: true,
          reservationId,
          remainingUsd: usdValue(this.limits.dailyBudgetMicros - dailyUsed - reservationMicros),
          activeRequests: activeRequests + 1,
        };
      }

      this.database.prepare(`
        INSERT INTO reserve_requests (idempotency_key, request_id, response_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(input.idempotencyKey, input.requestId, JSON.stringify(response), nowIso);
      return response;
    });
  }

  settle(input: SettleInput, now = new Date()): QuotaResponse {
    const actualMicros = usdToMicros(input.actualCostUsd, true);
    const nowIso = now.toISOString();

    return this.transaction(() => {
      const existingSettlement = this.database.prepare(`
        SELECT response_json FROM settlement_requests WHERE idempotency_key = ?
      `).get(input.idempotencyKey);
      if (existingSettlement) return storedResponse(existingSettlement);

      const reservation = this.database.prepare(`
        SELECT id, day_key, reserved_micros, status
        FROM reservations WHERE id = ?
      `).get(input.reservationId) as { id?: unknown; day_key?: unknown; reserved_micros?: unknown; status?: unknown } | undefined;

      if (!reservation || typeof reservation.day_key !== "string" || typeof reservation.status !== "string") {
        return { allowed: false, reason: "The reservation was not found; reconciliation is required." };
      }

      const reservedMicros = Number(reservation.reserved_micros);
      if (!Number.isSafeInteger(reservedMicros) || actualMicros > reservedMicros) {
        // Keep the reservation pending. A later authoritative settlement can still
        // close it; no excess provider spend is ever accepted into the ledger.
        return { allowed: false, reason: "The provider-reported cost exceeded the reserved maximum; reconciliation is required." };
      }

      if (reservation.status !== "settled") {
        this.database.prepare(`
          UPDATE reservations
          SET actual_micros = ?, status = 'settled', settled_at = ?
          WHERE id = ? AND status = 'pending'
        `).run(actualMicros, nowIso, input.reservationId);
      }

      const dayUsed = this.spendForDay(String(reservation.day_key));
      const response: QuotaResponse = {
        allowed: true,
        reservationId: input.reservationId,
        remainingUsd: usdValue(Math.max(0, this.limits.dailyBudgetMicros - dayUsed)),
        activeRequests: this.activeRequests(nowIso),
      };
      this.database.prepare(`
        INSERT INTO settlement_requests (idempotency_key, reservation_id, response_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(input.idempotencyKey, input.reservationId, JSON.stringify(response), nowIso);
      return response;
    });
  }

  reconciliation(limit = 100, now = new Date()): ReconciliationRow[] {
    const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const rows = this.database.prepare(`
      SELECT id, request_id, visitor_key, reserved_micros, created_at, lease_expires_at
      FROM reservations
      WHERE status = 'pending' AND lease_expires_at <= ?
      ORDER BY lease_expires_at ASC
      LIMIT ?
    `).all(now.toISOString(), boundedLimit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      reservationId: String(row.id),
      requestId: String(row.request_id),
      visitorKey: String(row.visitor_key),
      reservedUsd: usdValue(Number(row.reserved_micros)),
      createdAt: String(row.created_at),
      leaseExpiresAt: String(row.lease_expires_at),
    }));
  }
}
