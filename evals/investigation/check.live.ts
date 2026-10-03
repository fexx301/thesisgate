import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, expect, test } from "vitest";
import { lookupInvestigation } from "../../src/server/investigation-sources";
import { investigateClaim } from "../../src/server/investigation";
import { callMcpToolOnce, closeMcpSessions } from "../../src/server/mcp-client";
import { resetLocalRateLimitsForTests } from "../../src/server/quota";
import type { Asset, ClaimAssessment, Plan } from "../../src/domain/contracts";
import type { InvestigationSource } from "../../src/domain/investigation";

const optedIn = process.env.THESIS_LIVE_INVESTIGATION === "1";
const cases: Array<Record<string, unknown>> = [];
const runId = new Date().toISOString().replace(/[-:.]/g, "");
const output = resolve("evals/investigation/runs", runId);
let calls = 0;
let reportedCost = 0;
let chargedOrReserved = 0;
const MAX_CALLS = 6;
const MAX_CHARGED_OR_RESERVED_USD = 0.20;
const originalFetch = globalThis.fetch;
let model = "not-configured";
const probe = async (source: InvestigationSource, asset: Asset, claim: string) => {
  const result = await lookupInvestigation(source, asset, claim, new Date(), AbortSignal.timeout(8_000));
  cases.push({ kind: "source_probe", source, asset, ...result });
  writeFileSync(resolve(output, "cases.json"), JSON.stringify(cases, null, 2));
  expect(result.sources.length, `${source}: ${result.lookups.map((item) => item.detail).join("; ")}`).toBeGreaterThan(0);
  return result.sources[0];
};
const check = async (name: string, asset: Asset, exactText: string, expected: string) => {
  const claim: ClaimAssessment = { claimId: name, exactText, distinction: "factual", materiality: "material", status: "insufficient", explanation: "Not established by the initial packet", citations: [], missingEvidence: "A dated authoritative record directly establishing this fact." };
  const plan = { asset, thesis: exactText, horizon: { timezone: "UTC" } } as Plan;
  const result = await investigateClaim(plan, [claim], [], "live", new Date(), { requestId: `live-${runId}-${name}`, visitorKey: `live-${runId}` });
  cases.push({ kind: "investigation", name, expected, ...result });
  writeFileSync(resolve(output, "cases.json"), JSON.stringify(cases, null, 2));
  expect(result.investigation.status, `${name}: ${result.investigation.explanation}`).toBe(expected);
  if (expected === "supported" || expected === "contradicted") {
    expect(result.investigation.assessment?.citations.length).toBeGreaterThan(0);
    for (const citation of result.investigation.assessment!.citations) {
      const source = result.sources.find((item) => item.id === citation.sourceId);
      expect(source).toBeDefined();
      expect(source!.cleanedText.slice(citation.startOffset, citation.endOffset)).toBe(citation.excerpt);
    }
  }
  return result;
};

test.skipIf(!optedIn)("bounded live investigation: source retrieval, supported/contradicted/insufficient outcomes, stable repeat", async () => {
  // Vitest sets NODE_ENV=test; Next intentionally skips .env.local in that mode.
  // This explicitly opted-in live harness uses the local development credential without printing it.
  if (process.env.THESIS_LIVE_USE_PRODUCTION_ENV !== "1") {
    Object.assign(process.env, { NODE_ENV: "development" });
    loadEnvConfig(process.cwd(), true);
  }
  const production = Object.fromEntries(readFileSync("deploy/production.env.example", "utf8").split("\n").filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
  model = production.THESIS_LLM_MODEL;
  process.env.THESIS_LLM_MODEL = model;
  process.env.THESIS_LLM_ENABLED = "true";
  process.env.THESIS_INVESTIGATION_ENABLED = "true";
  process.env.THESIS_LLM_LOCAL_MAX_CONCURRENT = "1";
  resetLocalRateLimitsForTests();
  mkdirSync(output, { recursive: true });
  const diagnostic = process.env.THESIS_LIVE_DIAGNOSTIC_ENTRY;
  if (diagnostic && ["equity_calendar", "equity_estimates_price_target"].includes(diagnostic)) {
    const text = await callMcpToolOnce("https://agent.bitget.com/mcp", "do_query", { entry_id: diagnostic, params: { symbol: diagnostic === "equity_calendar" ? "TSLA" : "NVDA", limit: 40 } }, AbortSignal.timeout(8000));
    console.log(`PUBLIC_SOURCE_DIAGNOSTIC=${text.slice(0, 10000)}`);
    cases.push({ kind: "diagnostic_only", entry: diagnostic, text });
    return;
  }
  const provider = process.env.THESIS_LLM_BASE_URL;
  expect(provider).toBeTruthy();
  expect(process.env.THESIS_LLM_API_KEY).toBeTruthy();
  globalThis.fetch = async (input, init) => {
    if (String(input) === provider) {
      if (calls >= MAX_CALLS || chargedOrReserved + 0.02 > MAX_CHARGED_OR_RESERVED_USD) throw new Error("Live-check call/cost cap reached");
      calls += 1;
      const response = await originalFetch(input, init);
      try {
        const data = await response.clone().json() as { usage?: { cost?: number } };
        const cost = data.usage?.cost;
        if (typeof cost === "number" && Number.isFinite(cost)) { reportedCost += cost; chargedOrReserved += cost; }
        else chargedOrReserved += 0.02;
      } catch { chargedOrReserved += 0.02; }
      return response;
    }
    return originalFetch(input, init);
  };
  const earnings = await probe("earnings", "TSLA", "Tesla reported earnings today");
  const lastReported = earnings.cleanedText.match(/Most recent results:[^\n]*?reported (\d{4}-\d{2}-\d{2})/)?.[1];
  expect(lastReported).toBeTruthy();
  await check("earnings-supported", "TSLA", `Tesla reported its most recent earnings on ${lastReported}.`, "supported");
  const today = new Date().toISOString().slice(0, 10);
  const expectedToday = lastReported === today ? "supported" : "contradicted";
  await check("earnings-today-1", "TSLA", "Tesla reported its most recent earnings today.", expectedToday);
  await check("earnings-today-2", "TSLA", "Tesla reported its most recent earnings today.", expectedToday);
  const analysts = await probe("analysts", "NVDA", "NVIDIA analysts raised price targets");
  const action = analysts.cleanedText.match(/(\d{4}-\d{2}-\d{2}): (.+?) price target (\d+(?:\.\d+)?) USD/);
  expect(action).toBeTruthy();
  await check("analyst-supported", "NVDA", `${action![2]}'s NVIDIA price target was ${action![3]} USD on ${action![1]}.`, "supported");
  const revenue = await probe("revenue", "NVDA", "NVIDIA reported revenue");
  const fact = revenue.cleanedText.match(/Revenues: (\d+(?:\.\d+)?) USD; period (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/);
  expect(fact).toBeTruthy();
  await check("revenue-supported", "NVDA", `NVIDIA reported ${fact![1]} USD revenue for the period ${fact![2]} to ${fact![3]}.`, "supported");
  const before = calls;
  await check("deal-attribution-insufficient", "NVDA", "NVIDIA's AWS deployment already generated revenue.", "insufficient");
  expect(calls).toBe(before);
  await probe("filings", "TSLA", "Tesla filed an 8-K");
  await probe("newsroom", "NVDA", "NVIDIA announced AI infrastructure");
}, 240_000);

afterAll(async () => {
  if (!optedIn) return;
  globalThis.fetch = originalFetch;
  await closeMcpSessions();
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "summary.json"), JSON.stringify({ runId, model, maxCalls: MAX_CALLS, maxChargedOrReservedUsd: MAX_CHARGED_OR_RESERVED_USD, calls, reportedCostUsd: reportedCost, chargedOrReservedUsd: chargedOrReserved, cases: cases.map((item) => ({ kind: item.kind, name: item.name, source: item.source, expected: item.expected, status: (item.investigation as { status?: string } | undefined)?.status })), note: "Bounded live integration check, not independent trader validation. Source records are public; credentials and provider request headers are excluded." }, null, 2));
  console.log(`LIVE_CHECK_OUTPUT=${output}; calls=${calls}; reportedCostUsd=${reportedCost.toFixed(6)}`);
});
