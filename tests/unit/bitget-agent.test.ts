import { describe, expect, it } from "vitest";
import { analystTargetsEvidence, earningsCalendarEvidence, newsEvidence } from "../../src/server/bitget-agent";
import { parseRpcBody } from "../../src/server/mcp-client";
import { atrPercent, requiredMoveInTypicalDays, rsi, simpleAverage } from "../../src/domain/technicals";
import { createTtlCache } from "../../src/server/fetch-text";

describe("Bitget MCP responses", () => {
  it("reads JSON-RPC results from server-sent events and plain JSON", () => {
    expect(parseRpcBody('event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"ok"}]}}\n\n')).toEqual({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "ok" }] } });
    expect(parseRpcBody('{"jsonrpc":"2.0","id":1,"error":{"message":"bad"}}').error?.message).toBe("bad");
    expect(() => parseRpcBody("event: ping\n\n")).toThrow();
  });
});

describe("Bitget evidence records", () => {
  const targets = [
    { rating_date: "2026-09-03", analyst_firm: "Rosenblatt", price_target: 390, price_target_previous: 390, rating_current: "买入", action: "维持" },
    { rating_date: "2026-09-09", analyst_firm: "Piper Sandler", price_target: 300, price_target_previous: null, rating_current: "增持", action: "首次覆盖" },
    { rating_date: "2026-08-27", analyst_firm: "Example Capital", price_target: 515, price_target_previous: 480, rating_current: "买入", action: "上调" },
    { rating_date: null, analyst_firm: "Undated", price_target: 999 },
  ];

  it("turns analyst targets into dated, translated, newest-first evidence lines", () => {
    const evidence = analystTargetsEvidence("NVDA", targets);
    expect(evidence).not.toBeNull();
    const lines = evidence!.body.split("\n");
    expect(lines[1]).toBe("2026-09-09: Piper Sandler price target 300.00 USD, rating Overweight, initiated coverage.");
    expect(evidence!.body).toContain("2026-08-27: Example Capital price target 515.00 USD (previously 480.00 USD), rating Buy, raised.");
    expect(evidence!.body).toContain("price targets range from 300.00 to 515.00 USD");
    expect(evidence!.body).not.toContain("Undated");
    expect(evidence!.headline.kind).toBe("market_data");
    expect(evidence!.headline.url).toBeNull();
    expect(evidence!.headline.publishedDate).toBe("2026-09-09");
  });

  it("states the most recent and next earnings dates relative to today", () => {
    const rows = [
      { period_ending: "2026-06-29", fiscal_year: "2026", report_type_name: "二季报", perf_report_dsclsr_date: "2026-07-22", is_trading_time: "盘后" },
      { period_ending: "2026-03-30", fiscal_year: "2026", report_type_name: "一季报", perf_report_dsclsr_date: "2026-04-22", is_trading_time: "盘后" },
      { period_ending: "2026-09-29", fiscal_year: "2026", report_type_name: "三季报", perf_report_fore_dsclsr_date: "2026-10-21" },
    ];
    const evidence = earningsCalendarEvidence("TSLA", rows, "2026-09-28")!;
    expect(evidence.body).toContain("Most recent results: Q2 / half-year report for fiscal 2026 (period ending 2026-06-29), reported 2026-07-22 after the close.");
    expect(evidence.body).toContain("Next scheduled: Q3 report for fiscal 2026, expected 2026-10-21.");
    expect(evidence.headline.title).toBe("Tesla earnings calendar: last reported 2026-07-22, next 2026-10-21");
  });

  it("keeps company news and at most one macro briefing, without duplicates", () => {
    const rows = [
      { title: "Bitget UEX Daily｜US Stocks End Higher", content: "<p>Rates stayed higher for longer. Oil fell.</p>", labels: "['Macro']", published_at: "2026-09-28T09:47:03Z" },
      { title: "Bitget UEX Daily｜US Stocks End Higher", content: "<p>Rates stayed higher for longer. Oil fell.</p>", labels: "['Macro']", published_at: "2026-09-28T09:47:03Z" },
      { title: "U.S. Stocks Weekly Macro Preview", content: "<p>CPI, payrolls and the Fed this week, a busy calendar.</p>", labels: "['Stocks']", published_at: "2026-09-28T11:04:30Z" },
      { title: "Tesla shares move on Semi deliveries", content: "<p>Tesla said Semi production is ramping in Nevada this quarter.</p>", labels: "['Stocks']", published_at: "2026-09-28T12:00:00Z" },
      { title: "Kodiak Sciences surges", content: "<p>Unrelated biotech news with enough text to pass the length check.</p>", labels: "['Stocks']", published_at: "2026-09-28T13:00:00Z" },
    ];
    const items = newsEvidence("TSLA", rows);
    expect(items.map((item) => item.headline.title)).toEqual(["Bitget UEX Daily｜US Stocks End Higher", "Tesla shares move on Semi deliveries"]);
    expect(items[0].headline.publisher).toBe("Bitget macro briefing");
    expect(items[1].body).toContain("Semi production is ramping");
  });
});

describe("technical context", () => {
  const bars = Array.from({ length: 30 }, (_, index) => ({ high: 102 + (index % 3), low: 98 - (index % 2), close: 100 + (index % 5) - 2 }));

  it("computes ATR as a percentage of the last close, RSI and simple averages", () => {
    const atr = Number(atrPercent(bars));
    expect(atr).toBeGreaterThan(3);
    expect(atr).toBeLessThan(10);
    const value = Number(rsi(bars.map((bar) => bar.close)));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(100);
    expect(simpleAverage([1, 2, 3, 4], 2)).toBe("3.5");
    expect(atrPercent(bars.slice(0, 5))).toBeNull();
    expect(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])).toBe("100");
  });

  it("expresses a required move in typical days of movement", () => {
    expect(requiredMoveInTypicalDays("2.9", "1.9")).toBe("1.5");
    expect(requiredMoveInTypicalDays("-0.4", "2")).toBe("0.2");
    expect(requiredMoveInTypicalDays("1", "0")).toBeNull();
  });
});

describe("partial-failure caching", () => {
  it("does not store values the caller marks as incomplete", async () => {
    const cache = createTtlCache<{ ok: boolean }>(60_000);
    let calls = 0;
    const load = async () => { calls += 1; return { ok: calls > 1 }; };
    const keep = (value: { ok: boolean }) => value.ok;
    expect(await cache.get("k", load, keep)).toEqual({ ok: false });
    expect(await cache.get("k", load, keep)).toEqual({ ok: true });
    expect(await cache.get("k", load, keep)).toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});

describe("MCP session hygiene", () => {
  it("closes a session the server rejected before opening a new one", async () => {
    const { vi } = await import("vitest");
    const { callMcpTool, resetMcpSessionsForTests } = await import("../../src/server/mcp-client");
    resetMcpSessionsForTests();
    const calls: Array<{ method: string; session: string | null; body: string }> = [];
    let sessionCounter = 0;
    let toolCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: URL | string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      const body = typeof init.body === "string" ? init.body : "";
      calls.push({ method: init.method ?? "GET", session: headers.get("mcp-session-id"), body });
      if (init.method === "DELETE") return new Response(null, { status: 200 });
      if (body.includes('"initialize"')) {
        sessionCounter += 1;
        return new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { headers: { "mcp-session-id": `s${sessionCounter}` } });
      }
      if (body.includes("notifications/initialized")) return new Response(null, { status: 202 });
      toolCalls += 1;
      if (toolCalls === 1) return new Response("gone", { status: 404 });
      return new Response('data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"ok"}]}}\n\n');
    }));
    try {
      await expect(callMcpTool("https://agent.bitget.com/mcp", "do_query", {})).resolves.toBe("ok");
      expect(calls.some((call) => call.method === "DELETE" && call.session === "s1")).toBe(true);
      expect(sessionCounter).toBe(2);
    } finally {
      vi.unstubAllGlobals();
      resetMcpSessionsForTests();
    }
  });
});
