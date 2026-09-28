import "server-only";

import Decimal from "decimal.js";
import { HeadlineSchema, MarketSignalsSchema, type Asset, type Headline, type MarketSignals } from "@/domain/contracts";
import { atrPercent, rsi, simpleAverage, type DailyBar } from "@/domain/technicals";
import { createTtlCache, fetchBoundedText, htmlToText } from "./fetch-text";
import { sha256 } from "./identifiers";
import { callMcpTool } from "./mcp-client";

/**
 * Bitget Agent Hub integration, following the Track 3 recommended toolchain:
 * - bitget-mcp-server (agent.bitget.com/mcp): US-equity analyst targets, earnings calendar, Bitget news,
 *   market Fear & Greed. Public, no account or key.
 * - bitget-signal skills backend (datahub.noxiaohao.com/mcp): the technical-analysis skill's indicators.
 * Everything here is optional context: a failure degrades to "unavailable", never to invented data.
 */
export const BITGET_AGENT_MCP = "https://agent.bitget.com/mcp";
export const BITGET_SIGNAL_MCP = "https://datahub.noxiaohao.com/mcp";

const COMPANY: Record<Asset, { name: string; pattern: RegExp }> = {
  NVDA: { name: "NVIDIA", pattern: /\b(nvidia|nvda|jensen huang|blackwell|rubin)\b/i },
  TSLA: { name: "Tesla", pattern: /\b(tesla|tsla|elon musk|cybertruck|robotaxi|cybercab)\b/i },
};

const RATING: Record<string, string> = { "买入": "Buy", "强力买入": "Strong Buy", "强力买进": "Strong Buy", "增持": "Overweight", "跑赢大市": "Outperform", "跑赢大盘": "Outperform", "跑输大盘": "Underperform", "持有": "Hold", "中性": "Neutral", "减持": "Underweight", "跑输大市": "Underperform", "卖出": "Sell" };
const ACTION: Record<string, string> = { "首次覆盖": "initiated coverage", "维持": "maintained", "重申": "reiterated", "上调": "raised", "下调": "lowered", "上调评级": "upgraded", "下调评级": "downgraded" };
const REPORT: Record<string, string> = { "一季报": "Q1 report", "二季报": "Q2 / half-year report", "三季报": "Q3 report", "四季报": "Q4 report", "年报": "annual report" };
const SESSION: Record<string, string> = { "盘后": "after the close", "盘前": "before the open", "盘中": "during the session" };

type QueryEnvelope = { success?: boolean; status_code?: number; data?: { results?: unknown[] } | string | null };

/** Runs one bitget-mcp-server catalog entry and returns its result rows (empty when the source has none). */
export async function bitgetQuery(entryId: string, params: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  // One retry: the public server occasionally drops a request under parallel load.
  const text = await callMcpTool(BITGET_AGENT_MCP, "do_query", { entry_id: entryId, params })
    .catch(() => callMcpTool(BITGET_AGENT_MCP, "do_query", { entry_id: entryId, params }));
  const envelope = JSON.parse(text) as QueryEnvelope;
  if (envelope.success === false) throw new Error(`${entryId} was not successful`);
  if (!envelope.data || typeof envelope.data !== "object") return [];
  return (envelope.data.results ?? []).filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);

function headlineId(feed: string, key: string) {
  return `hl_${sha256(`${feed}\n${key}`).slice(0, 16)}`;
}

export type BitgetEvidence = { headline: Headline; body: string };

export function analystTargetsEvidence(asset: Asset, rows: Array<Record<string, unknown>>): BitgetEvidence | null {
  const dated = rows
    .map((row) => ({ date: str(row.rating_date) ?? str(row.published_date), firm: str(row.analyst_firm) ?? str(row.rating_org), target: num(row.price_target) ?? num(row.latest_target_price), previous: num(row.price_target_previous) ?? num(row.pre_target_price), rating: str(row.rating_current) ?? str(row.latest_rating_cn), action: str(row.action) ?? str(row.rating_chg_cn) }))
    .filter((row) => row.date && row.firm && row.target !== null)
    // Newest first; firm name breaks ties so the record is deterministic.
    .sort((left, right) => (right.date as string).localeCompare(left.date as string) || (left.firm as string).localeCompare(right.firm as string))
    .slice(0, 30);
  if (!dated.length) return null;
  const lines = dated.map((row) => {
    const rating = row.rating ? RATING[row.rating] ?? row.rating : null;
    const action = row.action ? ACTION[row.action] ?? row.action : null;
    const change = row.previous !== null && row.previous !== row.target ? ` (previously ${row.previous.toFixed(2)} USD)` : "";
    return `${row.date}: ${row.firm} price target ${row.target!.toFixed(2)} USD${change}${rating ? `, rating ${rating}` : ""}${action ? `, ${action}` : ""}.`;
  });
  const targets = dated.map((row) => row.target!);
  const summaryLine = `Across these ${dated.length} most recent analyst actions, price targets range from ${Math.min(...targets).toFixed(2)} to ${Math.max(...targets).toFixed(2)} USD.`;
  const body = [`Recent analyst price targets for ${COMPANY[asset].name} (${asset}), from Bitget market data:`, ...lines, summaryLine].join("\n");
  const latest = dated[0].date as string;
  return {
    headline: HeadlineSchema.parse({
      id: headlineId("bitget_analyst_targets", `${asset}\n${latest}\n${lines.join("|")}`),
      asset,
      title: `Analyst price targets for ${COMPANY[asset].name}: ${dated.length} recent actions, ${Math.min(...targets).toFixed(0)}–${Math.max(...targets).toFixed(0)} USD`,
      summary: [summaryLine, ...lines.slice(0, 3)].join(" ").slice(0, 2000),
      url: null,
      publisher: "Bitget market data",
      publishedAt: null,
      publishedDate: /^\d{4}-\d{2}-\d{2}$/.test(latest) ? latest : null,
      feed: "bitget_analyst_targets",
      kind: "market_data",
      fullTextAvailable: true,
      mode: "live",
    }),
    body,
  };
}

export function earningsCalendarEvidence(asset: Asset, rows: Array<Record<string, unknown>>, today: string): BitgetEvidence | null {
  const events = rows
    .map((row) => {
      const reported = str(row.perf_report_dsclsr_date) ?? str(row.perf_brief_dsclsr_date);
      const expected = str(row.perf_report_fore_dsclsr_date) ?? str(row.perf_briefing_fore_dsclsr_date);
      const type = str(row.report_type_name);
      return { period: str(row.period_ending), fiscalYear: str(row.fiscal_year), type: type ? REPORT[type] ?? type : "results", reported, expected, session: str(row.is_trading_time) };
    })
    .filter((event) => event.reported || event.expected);
  if (!events.length) return null;
  const past = events.filter((event) => event.reported && event.reported <= today).sort((a, b) => (b.reported as string).localeCompare(a.reported as string));
  const upcoming = events.filter((event) => (event.expected && event.expected > today) || (event.reported && event.reported > today)).sort((a, b) => ((a.expected ?? a.reported) as string).localeCompare((b.expected ?? b.reported) as string));
  const lines: string[] = [];
  if (past[0]) lines.push(`Most recent results: ${past[0].type} for fiscal ${past[0].fiscalYear} (period ending ${past[0].period}), reported ${past[0].reported}${past[0].session ? ` ${SESSION[past[0].session] ?? ""}`.trimEnd() : ""}.`);
  for (const event of past.slice(1, 4)) lines.push(`Earlier: ${event.type} for fiscal ${event.fiscalYear}, reported ${event.reported}.`);
  if (upcoming[0]) lines.push(`Next scheduled: ${upcoming[0].type} for fiscal ${upcoming[0].fiscalYear}, expected ${upcoming[0].expected ?? upcoming[0].reported}.`);
  else lines.push("No upcoming results date is listed yet.");
  const body = [`${COMPANY[asset].name} (${asset}) earnings calendar, from Bitget market data, as of ${today}:`, ...lines].join("\n");
  const latest = past[0]?.reported ?? null;
  return {
    headline: HeadlineSchema.parse({
      id: headlineId("bitget_earnings_calendar", `${asset}\n${lines.join("|")}`),
      asset,
      title: `${COMPANY[asset].name} earnings calendar: last reported ${latest ?? "unknown"}${upcoming[0] ? `, next ${upcoming[0].expected ?? upcoming[0].reported}` : ""}`,
      summary: lines.join(" ").slice(0, 2000),
      url: null,
      publisher: "Bitget market data",
      publishedAt: null,
      publishedDate: latest && /^\d{4}-\d{2}-\d{2}$/.test(latest) ? latest : null,
      feed: "bitget_earnings_calendar",
      kind: "market_data",
      fullTextAvailable: true,
      mode: "live",
    }),
    body,
  };
}

export function newsEvidence(asset: Asset, rows: Array<Record<string, unknown>>, maxItems = 6): BitgetEvidence[] {
  const items: BitgetEvidence[] = [];
  const seen = new Set<string>();
  let macroIncluded = false;
  for (const row of rows) {
    const title = str(row.title);
    const published = str(row.published_at) ?? str(row.date);
    if (!title || !published) continue;
    const text = htmlToText(String(row.content ?? "")).slice(0, 15_000);
    const labels = String(row.labels ?? "");
    const isMacro = /macro/i.test(labels) || /UEX Daily|Macro Preview/i.test(title);
    const relevant = COMPANY[asset].pattern.test(`${title} ${text.slice(0, 4000)}`);
    if (!relevant && !(isMacro && !macroIncluded)) continue;
    if (!relevant) macroIncluded = true;
    const publishedAt = new Date(published);
    if (Number.isNaN(publishedAt.getTime())) continue;
    const parsed = HeadlineSchema.safeParse({
      id: headlineId("bitget_news", `${title}\n${published}`),
      asset,
      title: title.slice(0, 400),
      summary: text.replace(/\s+/g, " ").slice(0, 600),
      url: null,
      publisher: isMacro && !relevant ? "Bitget macro briefing" : "Bitget news",
      publishedAt: publishedAt.toISOString(),
      publishedDate: publishedAt.toISOString().slice(0, 10),
      feed: "bitget_news",
      kind: "platform_news",
      fullTextAvailable: true,
      mode: "live",
    });
    if (parsed.success && text.length >= 40 && !seen.has(parsed.data.id)) {
      seen.add(parsed.data.id);
      items.push({ headline: parsed.data, body: `${title}\n\n${text}` });
    }
    if (items.length >= maxItems) break;
  }
  return items;
}

const evidenceCache = createTtlCache<{ items: BitgetEvidence[]; warnings: string[] }>(10 * 60_000, 10);

/** Collects the Bitget evidence records for the radar. Each source fails independently. */
export async function fetchBitgetEvidence(asset: Asset, now = new Date()) {
  return evidenceCache.get(asset, async () => {
    const today = now.toISOString().slice(0, 10);
    const [targets, calendar, stockNews, macroNews] = await Promise.allSettled([
      bitgetQuery("equity_estimates_price_target", { symbol: asset, limit: 40 }),
      bitgetQuery("equity_calendar", { symbol: asset }),
      bitgetQuery("news_label_search", { label: 2, page_size: 40 }),
      bitgetQuery("news_label_search", { label: 1, page_size: 5 }),
    ]);
    const warnings: string[] = [];
    const items: BitgetEvidence[] = [];
    if (targets.status === "fulfilled") {
      const evidence = analystTargetsEvidence(asset, targets.value);
      if (evidence) items.push(evidence);
    } else warnings.push("Bitget analyst targets unavailable.");
    if (calendar.status === "fulfilled") {
      const evidence = earningsCalendarEvidence(asset, calendar.value, today);
      if (evidence) items.push(evidence);
    } else warnings.push("Bitget earnings calendar unavailable.");
    const newsRows = [
      ...(stockNews.status === "fulfilled" ? stockNews.value : []),
      ...(macroNews.status === "fulfilled" ? macroNews.value : []),
    ];
    if (stockNews.status === "rejected" && macroNews.status === "rejected") warnings.push("Bitget news unavailable.");
    items.push(...newsEvidence(asset, newsRows));
    return { items, warnings };
  }, (result) => result.warnings.length === 0);
}

// ---- Signals: technical-analysis and sentiment-analyst skills ----

async function signalTechnicals(asset: Asset): Promise<NonNullable<MarketSignals["technicals"]>> {
  const text = await callMcpTool(BITGET_SIGNAL_MCP, "technical_analysis", { action: "full_analysis", symbol: asset, timeframe: "1d" }, 20_000);
  const result = JSON.parse(text) as { atr?: { atr_pct?: unknown }; rsi?: { rsi?: unknown }; ma?: { price?: unknown; ma7?: unknown; ma25?: unknown } };
  const atr = num(result.atr?.atr_pct);
  if (atr === null || atr <= 0) throw new Error("technical_analysis returned no ATR");
  const decimal = (value: unknown) => (num(value) === null ? null : new Decimal(num(value) as number).toString());
  return {
    atrPercent: new Decimal(atr).toString(),
    rsi14: decimal(result.rsi?.rsi),
    price: decimal(result.ma?.price),
    ma7: decimal(result.ma?.ma7),
    ma25: decimal(result.ma?.ma25),
    source: "bitget_signal_technical_analysis",
  };
}

async function computedTechnicals(asset: Asset): Promise<NonNullable<MarketSignals["technicals"]>> {
  const { text } = await fetchBoundedText(`https://query1.finance.yahoo.com/v8/finance/chart/${asset}?range=3mo&interval=1d`, {
    allowedHosts: new Set(["query1.finance.yahoo.com"]), maxBytes: 600_000, timeoutMs: 6_000, accept: "application/json", userAgent: "Mozilla/5.0 (compatible; ThesisGate research prototype)",
  });
  const result = (JSON.parse(text) as { chart?: { result?: Array<{ indicators?: { quote?: Array<{ high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }> } }> } }).chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const bars: DailyBar[] = (quote?.close ?? []).flatMap((close, index) => {
    const high = quote?.high?.[index];
    const low = quote?.low?.[index];
    return typeof close === "number" && typeof high === "number" && typeof low === "number" ? [{ high, low, close }] : [];
  });
  const atr = atrPercent(bars);
  if (!atr) throw new Error("Not enough daily bars for ATR");
  const closes = bars.map((bar) => bar.close);
  return { atrPercent: atr, rsi14: rsi(closes), price: new Decimal(closes[closes.length - 1]).toString(), ma7: simpleAverage(closes, 7), ma25: simpleAverage(closes, 25), source: "computed_from_daily_bars" };
}

async function fearGreed(): Promise<NonNullable<MarketSignals["sentiment"]>> {
  const [row] = await bitgetQuery("sentiment_market_fear_greed", {});
  const score = num(row?.score);
  const asOf = str(row?.timestamp);
  if (score === null || !asOf) throw new Error("No Fear & Greed reading");
  const decimal = (value: unknown) => (num(value) === null ? null : new Decimal(num(value) as number).toDecimalPlaces(1).toString());
  return { score: new Decimal(score).toString(), rating: str(row?.rating) ?? "unknown", asOf: new Date(asOf).toISOString(), previousWeek: decimal(row?.previous_1_week), previousMonth: decimal(row?.previous_1_month), source: "bitget_market_fear_greed" };
}

const signalsCache = createTtlCache<MarketSignals>(10 * 60_000, 10);

export async function fetchMarketSignals(asset: Asset): Promise<MarketSignals> {
  return signalsCache.get(asset, async () => {
    const warnings: string[] = [];
    const technicals = await signalTechnicals(asset).catch(async () => {
      warnings.push("The technical-analysis skill was unavailable; indicators were computed from daily bars instead.");
      return computedTechnicals(asset).catch(() => {
        warnings.push("Technical context is unavailable.");
        return null;
      });
    });
    const sentiment = await fearGreed().catch(() => {
      warnings.push("Market sentiment is unavailable.");
      return null;
    });
    return MarketSignalsSchema.parse({ technicals, sentiment, warnings });
  }, (signals) => signals.technicals !== null && signals.sentiment !== null);
}

export function resetBitgetCachesForTests() {
  evidenceCache.clear();
  signalsCache.clear();
}
