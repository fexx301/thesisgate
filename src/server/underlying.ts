import "server-only";

import Decimal from "decimal.js";
import capturedContext from "../../fixtures/captured-context.json";
import type { Asset } from "@/domain/contracts";
import type { UnderlyingQuote } from "@/domain/priced-in";
import { lastCompletedSessionDate, regularCloseInstant } from "@/domain/session";
import { createTtlCache, fetchBoundedText } from "./fetch-text";

const YAHOO_HOST = "query1.finance.yahoo.com";
export const CAPTURED_AT_UTC = (capturedContext as unknown as { capturedAtUTC: string }).capturedAtUTC;
const QUOTE_TIMEOUT_MS = 6_000;
const QUOTE_MAX_BYTES = 600_000;
// Short enough that the tracking basis stays meaningful, long enough to absorb bursts of visitors.
const quoteCache = createTtlCache<UnderlyingQuote>(30_000, 10);

type ChartResult = {
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};

function chartResult(text: string): ChartResult {
  const payload = JSON.parse(text) as { chart?: { result?: ChartResult[] | null; error?: unknown } };
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error("The quote response had no chart result.");
  return result;
}

function newYorkDate(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(epochSeconds * 1000));
}

function bars(result: ChartResult) {
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  return (result.timestamp ?? []).flatMap((time, index) => {
    const close = closes[index];
    return typeof close === "number" && Number.isFinite(close) && close > 0 ? [{ time, close }] : [];
  });
}

// Yahoo returns binary floats; quotes are cents-precision, so rounding restores the printed price.
function price(value: number) {
  return new Decimal(value).toDecimalPlaces(4).toString();
}

/** Picks the official close of the latest completed regular session from daily bars. */
export function lastCloseFromDailyBars(result: ChartResult, observedAt: Date) {
  const sessionDate = lastCompletedSessionDate(observedAt);
  if (!sessionDate) throw new Error("No completed US session was found in the calendar window.");
  const bar = bars(result).find((item) => newYorkDate(item.time) === sessionDate);
  if (!bar) throw new Error(`The quote history did not include the ${sessionDate} close.`);
  return { lastClose: price(bar.close), lastCloseSessionDate: sessionDate, lastCloseAt: regularCloseInstant(sessionDate) };
}

export function latestFromIntradayBars(result: ChartResult) {
  const series = bars(result);
  const last = series[series.length - 1];
  return last ? { latestPrice: price(last.close), latestAt: new Date(last.time * 1000).toISOString() } : { latestPrice: null, latestAt: null };
}

export async function fetchUnderlyingQuote(asset: Asset, observedAt: Date): Promise<UnderlyingQuote> {
  const options = { allowedHosts: new Set([YAHOO_HOST]), maxBytes: QUOTE_MAX_BYTES, timeoutMs: QUOTE_TIMEOUT_MS, accept: "application/json", userAgent: "Mozilla/5.0 (compatible; ThesisGate research prototype)" };
  const [daily, intraday] = await Promise.all([
    fetchBoundedText(`https://${YAHOO_HOST}/v8/finance/chart/${asset}?range=10d&interval=1d`, options),
    fetchBoundedText(`https://${YAHOO_HOST}/v8/finance/chart/${asset}?range=1d&interval=5m&includePrePost=true`, options),
  ]);
  return {
    symbol: asset,
    ...lastCloseFromDailyBars(chartResult(daily.text), observedAt),
    ...latestFromIntradayBars(chartResult(intraday.text)),
    source: "yahoo_finance_chart",
  };
}

export function capturedUnderlyingQuote(asset: Asset): UnderlyingQuote {
  const fixture = capturedContext as unknown as { underlying: Record<Asset, Omit<UnderlyingQuote, "source" | "lastCloseAt">> };
  const quote = fixture.underlying[asset];
  return { ...quote, lastCloseAt: regularCloseInstant(quote.lastCloseSessionDate), source: "captured_yahoo_finance_chart" };
}

export async function getUnderlyingQuote(asset: Asset, mode: "live" | "captured_real", observedAt: Date) {
  return mode === "captured_real" ? capturedUnderlyingQuote(asset) : quoteCache.get(asset, () => fetchUnderlyingQuote(asset, observedAt));
}
