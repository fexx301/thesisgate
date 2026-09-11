import "server-only";

import type { TelemetryEvent } from "@/domain/telemetry";

const TELEMETRY_TIMEOUT_MS = 2_000;

function sinkUrl() {
  const raw = process.env.THESIS_TELEMETRY_ENDPOINT?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if ((url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && localDevelopment)) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function recordTelemetry(event: TelemetryEvent) {
  if (process.env.THESIS_TELEMETRY_ENABLED !== "true") return;
  const endpoint = sinkUrl();
  if (!endpoint) {
    console.info(`[thesisgate] telemetry ${JSON.stringify(event)}`);
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);
  try {
    const token = process.env.THESIS_TELEMETRY_TOKEN?.trim();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(event),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) console.warn(`[thesisgate] telemetry sink returned HTTP ${response.status}`);
  } catch {
    console.warn("[thesisgate] telemetry sink was unavailable");
  } finally {
    clearTimeout(timeout);
  }
}
