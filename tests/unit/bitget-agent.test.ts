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

describe("skill tool parsing (defensive)", () => {
  it("accepts plausible news, sentiment and rates shapes and rejects empty errors", async () => {
    const { parseSkillNews, parseSkillSentiment, parseSkillRates } = await import("../../src/server/bitget-agent");
    const news = parseSkillNews(JSON.stringify({ items: [
      { title: "Tesla Semi enters volume production", url: "http://example.com/a", published_at: "2026-09-28T10:00:00Z", summary: "<p>Tesla said...</p>", source: "Reuters" },
      { title: "Unrelated bank story", url: "https://example.com/b", published_at: "2026-09-28T10:00:00Z" },
      { title: "Tesla missing date", url: "https://example.com/c" },
    ] }), "TSLA");
    expect(news).toHaveLength(1);
    expect(news[0].url).toBe("https://example.com/a");
    expect(news[0].publisher).toBe("Reuters");
    expect(news[0].feed).toBe("skill_news_briefing");
    expect(parseSkillNews('{"error": ""}', "TSLA")).toEqual([]);
    expect(parseSkillSentiment('{"value": "42", "value_classification": "Fear"}')).toEqual({ score: "42", rating: "Fear" });
    expect(parseSkillSentiment('{"data": [{"value": 71, "value_classification": "Greed"}]}')).toEqual({ score: "71", rating: "Greed" });
    expect(parseSkillSentiment('{"alt_me_error": ""}')).toBeNull();
    expect(parseSkillRates('{"t10y": {"value": 4.21, "date": "2026-09-26"}, "fed_funds_target_lower": 4.25, "fed_funds_target_upper": {"value": 4.5}}')).toEqual({ tenYearYield: "4.21", fedFundsLower: "4.25", fedFundsUpper: "4.5" });
    expect(parseSkillRates('{"t10y": {"error": ""}, "fed_funds_target_upper": {"error": ""}}')).toBeNull();
  });
});

describe("Agent Hub handoff", () => {
  it("builds a dry-run-first IOC limit whose total can never exceed the plan's amount", async () => {
    const { agentHubHandoff, sweepLimitPrice } = await import("../../src/domain/handoff");
    expect(sweepLimitPrice([["100", "1"], ["100.5", "2"], ["101", "5"]], "2.5")).toBe("100.5");
    expect(sweepLimitPrice([["100", "1"]], "2")).toBeNull();
    expect(sweepLimitPrice([["99", "0"], ["100", "3"]], "2")).toBe("100");
    const instrument = { symbol: "RNVDAUSDT", baseCoin: "rNVDA", quantityStep: "0.0001", minOrderQty: "0.0001", minOrderNotional: "10" } as never;
    // The review's repro: asks 100x1 and 200x1, 300 USDT models 2 units; a 200 limit on 2 units could spend 400.
    const gap = agentHubHandoff({ quantity: "2", requestedNotional: "300", computationStatus: "calculated" } as never, instrument, { mode: "live", asks: [["100", "1"], ["200", "1"]] } as never, "0.001");
    expect(gap?.limitPrice).toBe("200");
    expect(gap?.quantity).toBe("1.5");
    expect(gap?.maxSpend).toBe("300");
    expect(gap?.maxSpendWithFee).toBe("300.3");
    expect(gap?.reducedToFitBudget).toBe(true);
    expect(gap?.commands[1].command).toBe("bgc order --action place --category SPOT --symbol RNVDAUSDT --side buy --orderType limit --price 200 --qty 1.5 --timeInForce ioc --dry-run");
    expect(gap?.commands[0].command).toContain("--read-only");
    // A deep book where the modeled quantity already fits keeps it.
    const deep = agentHubHandoff({ quantity: "4.4", requestedNotional: "1000", computationStatus: "threshold_only" } as never, instrument, { mode: "live", asks: [["222.58", "10"]] } as never);
    expect(deep?.quantity).toBe("4.4");
    expect(deep?.reducedToFitBudget).toBe(false);
    expect(Number(deep?.maxSpend)).toBeLessThanOrEqual(1000);
    expect(agentHubHandoff({ quantity: "5", requestedNotional: "1000", computationStatus: "invalid_instrument" } as never, instrument, { mode: "live", asks: [["100", "10"]] } as never)).toBeNull();
    expect(agentHubHandoff({ quantity: null, requestedNotional: "1000", computationStatus: "calculated" } as never, instrument, { mode: "live", asks: [["100", "10"]] } as never)).toBeNull();
  });
});

describe("MCP idle close", () => {
  it("closes a session after 60s idle, but never while a call is in flight", async () => {
    const { vi } = await import("vitest");
    const { callMcpTool, resetMcpSessionsForTests } = await import("../../src/server/mcp-client");
    resetMcpSessionsForTests();
    vi.useFakeTimers();
    const deletes: string[] = [];
    const gate: { release: () => void } = { release: () => undefined };
    vi.stubGlobal("fetch", vi.fn(async (_url: URL | string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      const body = typeof init.body === "string" ? init.body : "";
      if (init.method === "DELETE") { deletes.push(headers.get("mcp-session-id") ?? ""); return new Response(null, { status: 200 }); }
      if (body.includes('"initialize"')) return new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { headers: { "mcp-session-id": "sess-1" } });
      if (body.includes("notifications/initialized")) return new Response(null, { status: 202 });
      if (body.includes('"slow"')) await new Promise<void>((resolve) => { gate.release = resolve; });
      return new Response('{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"ok"}]}}');
    }));
    try {
      await expect(callMcpTool("https://agent.bitget.com/mcp", "do_query", {})).resolves.toBe("ok");
      await vi.advanceTimersByTimeAsync(59_000);
      expect(deletes).toEqual([]);
      // A long call keeps the session alive past the idle window.
      const slow = callMcpTool("https://agent.bitget.com/mcp", "do_query", { mode: "slow" });
      await vi.advanceTimersByTimeAsync(90_000);
      expect(deletes).toEqual([]);
      gate.release();
      await expect(slow).resolves.toBe("ok");
      await vi.advanceTimersByTimeAsync(61_000);
      expect(deletes).toEqual(["sess-1"]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      resetMcpSessionsForTests();
    }
  });
});

describe("optional signals deadline", () => {
  it("returns within the shared deadline when both MCP servers stall, using the daily-bar fallback", async () => {
    const { vi } = await import("vitest");
    const { fetchMarketSignals, resetBitgetCachesForTests, OPTIONAL_DEADLINE_MS } = await import("../../src/server/bitget-agent");
    const { resetMcpSessionsForTests } = await import("../../src/server/mcp-client");
    resetBitgetCachesForTests();
    resetMcpSessionsForTests();
    vi.useFakeTimers();
    const closes = Array.from({ length: 40 }, (_, index) => 100 + (index % 5));
    const chart = JSON.stringify({ chart: { result: [{ indicators: { quote: [{ close: closes, high: closes.map((c) => c + 2), low: closes.map((c) => c - 2) }] } }] } });
    vi.stubGlobal("fetch", vi.fn((input: URL | string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("query1.finance.yahoo.com")) return Promise.resolve(new Response(chart));
      // Both MCP servers stall until the caller aborts.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }));
    try {
      let settled = false;
      const pending = fetchMarketSignals("NVDA").then((value) => { settled = true; return value; });
      await vi.advanceTimersByTimeAsync(OPTIONAL_DEADLINE_MS + 500);
      expect(settled).toBe(true);
      const signals = await pending;
      expect(signals.technicals?.source).toBe("computed_from_daily_bars");
      expect(signals.sentiment).toBeNull();
      expect(signals.skills.find((item) => item.skill === "technical-analysis")?.status).toBe("fallback");
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      resetBitgetCachesForTests();
      resetMcpSessionsForTests();
    }
  });
});
