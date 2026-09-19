import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuotaStore, usdToMicros, type QuotaLimits, type ReserveInput } from "../../quota-service/store";

const limits: QuotaLimits = {
  maxCallCostMicros: usdToMicros(0.02),
  dailyBudgetMicros: usdToMicros(0.04),
  perVisitorBudgetMicros: usdToMicros(0.04),
  providerHardLimitMicros: usdToMicros(0.04),
  maxConcurrent: 1,
  leaseSeconds: 60,
};

function reserve(overrides: Partial<ReserveInput> = {}): ReserveInput {
  const idempotencyKey = overrides.idempotencyKey ?? "request-00000001";
  return {
    operation: "reserve",
    idempotencyKey,
    requestId: overrides.requestId ?? idempotencyKey,
    visitorKey: overrides.visitorKey ?? "a".repeat(64),
    reservationUsd: overrides.reservationUsd ?? 0.02,
    dailyBudgetUsd: overrides.dailyBudgetUsd ?? 0.04,
    perVisitorBudgetUsd: overrides.perVisitorBudgetUsd ?? 0.04,
    providerHardLimitUsd: overrides.providerHardLimitUsd ?? 0.04,
    maxConcurrent: overrides.maxConcurrent ?? 1,
    expiresInSeconds: overrides.expiresInSeconds ?? 60,
  };
}

describe("durable quota ledger", () => {
  let directory = "";
  let store: QuotaStore;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "thesisgate-quota-"));
    store = new QuotaStore(join(directory, "quota.sqlite"), limits);
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("returns the same reservation for an idempotent retry", () => {
    const first = store.reserve(reserve(), new Date("2026-09-19T10:00:00.000Z"));
    const retry = store.reserve(reserve({ visitorKey: "b".repeat(64) }), new Date("2026-09-19T10:00:02.000Z"));

    expect(first).toMatchObject({ allowed: true, activeRequests: 1 });
    expect(retry).toEqual(first);
  });

  it("enforces the active concurrency lease before the daily budget", () => {
    const first = store.reserve(reserve(), new Date("2026-09-19T10:00:00.000Z"));
    const concurrent = store.reserve(reserve({ idempotencyKey: "request-00000002", requestId: "request-00000002" }), new Date("2026-09-19T10:00:01.000Z"));
    const afterLease = store.reserve(
      reserve({ idempotencyKey: "request-00000003", requestId: "request-00000003", visitorKey: "b".repeat(64) }),
      new Date("2026-09-19T10:01:01.000Z"),
    );
    expect(first.allowed).toBe(true);
    expect(concurrent).toMatchObject({ allowed: false, reason: "The model concurrency lease limit is full." });
    expect(afterLease.allowed).toBe(true);
    if (!afterLease.reservationId) throw new Error("Expected the expired lease reservation to be allowed.");
    store.settle({ operation: "settle", idempotencyKey: afterLease.reservationId, reservationId: afterLease.reservationId, actualCostUsd: 0.02 });
    const afterSpend = store.reserve(
      reserve({ idempotencyKey: "request-00000004", requestId: "request-00000004", visitorKey: "c".repeat(64) }),
      new Date("2026-09-19T10:01:02.000Z"),
    );
    expect(afterSpend).toMatchObject({ allowed: false, reason: "The daily model budget is exhausted." });
  });

  it("keeps reserved spend held until settlement and settles idempotently", () => {
    const now = new Date("2026-09-19T10:00:00.000Z");
    const first = store.reserve(reserve(), now);
    if (!first.reservationId) throw new Error("Expected a reservation.");

    const tooHigh = store.settle({
      operation: "settle",
      idempotencyKey: first.reservationId,
      reservationId: first.reservationId,
      actualCostUsd: 0.03,
    }, new Date("2026-09-19T10:00:05.000Z"));
    expect(tooHigh).toMatchObject({ allowed: false, reason: "The provider-reported cost exceeded the reserved maximum; reconciliation is required." });
    expect(store.reconciliation(10, new Date("2026-09-19T10:02:00.000Z"))).toHaveLength(1);

    const settled = store.settle({
      operation: "settle",
      idempotencyKey: first.reservationId,
      reservationId: first.reservationId,
      actualCostUsd: 0.005,
    }, new Date("2026-09-19T10:02:01.000Z"));
    const retry = store.settle({
      operation: "settle",
      idempotencyKey: first.reservationId,
      reservationId: first.reservationId,
      actualCostUsd: 0.02,
    }, new Date("2026-09-19T10:02:02.000Z"));

    expect(settled).toMatchObject({ allowed: true, reservationId: first.reservationId, remainingUsd: 0.035 });
    expect(retry).toEqual(settled);
    expect(store.reconciliation(10, new Date("2026-09-19T10:02:02.000Z"))).toHaveLength(0);
  });

  it("counts a pending reservation after its lease expires", () => {
    const first = store.reserve(reserve(), new Date("2026-09-19T10:00:00.000Z"));
    expect(first.allowed).toBe(true);
    const second = store.reserve(
      reserve({ idempotencyKey: "request-00000002", requestId: "request-00000002", visitorKey: "b".repeat(64) }),
      new Date("2026-09-19T10:01:01.000Z"),
    );
    expect(second.allowed).toBe(true);
    if (!second.reservationId) throw new Error("Expected the second reservation to be allowed.");
    store.settle({ operation: "settle", idempotencyKey: second.reservationId, reservationId: second.reservationId, actualCostUsd: 0.02 });
    const third = store.reserve(
      reserve({ idempotencyKey: "request-00000003", requestId: "request-00000003", visitorKey: "c".repeat(64) }),
      new Date("2026-09-19T10:01:02.000Z"),
    );
    expect(third).toMatchObject({ allowed: false, reason: "The daily model budget is exhausted." });
  });

  it("retains idempotency across a database reopen", () => {
    const first = store.reserve(reserve(), new Date("2026-09-19T10:00:00.000Z"));
    store.close();
    store = new QuotaStore(join(directory, "quota.sqlite"), limits);
    const reopened = store.reserve(reserve(), new Date("2026-09-19T11:00:00.000Z"));

    expect(reopened).toEqual(first);
  });

  it("shares the cap across independent store instances", () => {
    const secondStore = new QuotaStore(join(directory, "quota.sqlite"), limits);
    try {
      const first = store.reserve(reserve(), new Date("2026-09-19T10:00:00.000Z"));
      const second = secondStore.reserve(
        reserve({ idempotencyKey: "request-00000002", requestId: "request-00000002", visitorKey: "b".repeat(64) }),
        new Date("2026-09-19T10:00:01.000Z"),
      );

      expect(first.allowed).toBe(true);
      expect(second).toMatchObject({ allowed: false, reason: "The model concurrency lease limit is full." });
    } finally {
      secondStore.close();
    }
  });
});
