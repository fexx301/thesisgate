import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createQuotaServer, type QuotaServiceConfig } from "../../quota-service/server";
import { usdToMicros } from "../../quota-service/store";

describe("quota service HTTP contract", () => {
  let directory = "";
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("authenticates the endpoint and serves idempotent reserve/settle operations", async () => {
    directory = mkdtempSync(join(tmpdir(), "thesisgate-quota-http-"));
    const config: QuotaServiceConfig = {
      token: "test-service-token",
      databasePath: join(directory, "quota.sqlite"),
      host: "127.0.0.1",
      port: 0,
      limits: {
        maxCallCostMicros: usdToMicros(0.02),
        dailyBudgetMicros: usdToMicros(1),
        perVisitorBudgetMicros: usdToMicros(0.1),
        providerHardLimitMicros: usdToMicros(1),
        maxConcurrent: 2,
        leaseSeconds: 60,
      },
    };
    const service = createQuotaServer(config);
    await new Promise<void>((resolve, reject) => {
      service.server.once("error", reject);
      service.server.listen(0, config.host, () => resolve());
    });
    const address = service.server.address();
    if (!address || typeof address === "string") throw new Error("Quota service did not expose a TCP address.");
    const endpoint = `http://${config.host}:${address.port}/v1/reservations`;
    close = async () => {
      service.store.close();
      await new Promise<void>((resolve) => service.server.close(() => resolve()));
    };

    const unauthorized = await fetch(endpoint, { method: "POST", body: "{}" });
    expect(unauthorized.status).toBe(401);

    const body = {
      operation: "reserve",
      idempotencyKey: "request-00000001",
      requestId: "request-00000001",
      visitorKey: "a".repeat(64),
      reservationUsd: 0.02,
      dailyBudgetUsd: 1,
      perVisitorBudgetUsd: 0.1,
      providerHardLimitUsd: 1,
      maxConcurrent: 2,
      expiresInSeconds: 60,
    };
    const headers = { authorization: "Bearer test-service-token", "content-type": "application/json" };
    const first = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const firstJson = await first.json() as { allowed: boolean; reservationId?: string };
    const retry = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const retryJson = await retry.json();
    expect(first.status).toBe(200);
    expect(firstJson.allowed).toBe(true);
    expect(retryJson).toEqual(firstJson);

    const settled = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operation: "settle",
        idempotencyKey: firstJson.reservationId,
        reservationId: firstJson.reservationId,
        actualCostUsd: 0.001,
      }),
    });
    expect((await settled.json() as { allowed: boolean }).allowed).toBe(true);
  });
});
