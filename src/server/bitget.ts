import "server-only";

import Decimal from "decimal.js";
import { parse as parseLossless } from "lossless-json";
import selectionProbe from "../../fixtures/selection-probe.json";
import {
  InstrumentSchema,
  MarketSnapshotSchema,
  type Asset,
  type Instrument,
  type MarketLevel,
  type MarketSnapshot,
} from "@/domain/contracts";
import { canonicalJson, sha256 } from "./identifiers";

const BITGET_BASE_URL = "https://api.bitget.com";
const MARKET_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;

const ASSET_CONFIG: Record<Asset, { symbol: string; baseCoin: string }> = {
  NVDA: { symbol: "RNVDAUSDT", baseCoin: "rNVDA" },
  TSLA: { symbol: "RTSLAUSDT", baseCoin: "rTSLA" },
};

type MarketAdapterErrorKind = "market_unavailable" | "market_invalid";

export class MarketAdapterError extends Error {
  kind: MarketAdapterErrorKind;

  constructor(kind: MarketAdapterErrorKind, message: string) {
    super(message);
    this.name = "MarketAdapterError";
    this.kind = kind;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object" && typeof (value as { toString?: unknown }).toString === "function") {
    return String(value);
  }
  throw new Error("Expected a decimal-compatible value");
}

function responseCode(value: unknown) {
  return stringValue(record(value).code);
}

function requestTime(value: unknown) {
  return stringValue(record(value).requestTime);
}

function isoFromMilliseconds(value: string) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) throw new Error("Invalid exchange timestamp");
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid exchange timestamp");
  return date.toISOString();
}

function precisionStep(value: unknown) {
  const precision = Number(stringValue(value));
  if (!Number.isInteger(precision) || precision < 0 || precision > 18) throw new Error("Unsupported precision");
  return new Decimal(10).pow(-precision).toString();
}

function levelsFrom(value: unknown): MarketLevel[] {
  if (!Array.isArray(value)) throw new Error("Order book side is missing");
  return value.map((level) => {
    if (!Array.isArray(level) || level.length !== 2) throw new Error("Order book level is malformed");
    return [stringValue(level[0]), stringValue(level[1])] as MarketLevel;
  });
}

function instrumentFromResponse(asset: Asset, response: unknown): Instrument {
  const root = record(response);
  if (responseCode(root) !== "00000") throw new Error("Instrument response was not successful");
  const data = root.data;
  if (!Array.isArray(data) || data.length !== 1) throw new Error("Instrument response had no unique record");
  const item = record(data[0]);
  const config = ASSET_CONFIG[asset];
  if (stringValue(item.symbol) !== config.symbol || stringValue(item.category) !== "SPOT") throw new Error("Instrument identity did not match the fixed allowlist");
  if (stringValue(item.baseCoin) !== config.baseCoin || stringValue(item.quoteCoin) !== "USDT") throw new Error("Instrument quote identity did not match the allowlist");
  return InstrumentSchema.parse({
    symbol: config.symbol,
    asset,
    category: "SPOT",
    baseCoin: config.baseCoin,
    quoteCoin: "USDT",
    symbolType: stringValue(item.symbolType),
    isReality: stringValue(item.isReality) === "yes",
    status: stringValue(item.status),
    quantityStep: precisionStep(item.quantityPrecision),
    priceTick: precisionStep(item.pricePrecision),
    minOrderQty: stringValue(item.minOrderQty),
    maxOrderQty: stringValue(item.maxOrderQty),
    minOrderNotional: stringValue(item.minOrderAmount),
    maxPositionQty: stringValue(item.maxPositionNum || "0"),
    rawMetadataTime: isoFromMilliseconds(requestTime(root)),
  });
}

function bookFromResponse(asset: Asset, instrument: Instrument, response: unknown, receivedAt: string, reference: string): MarketSnapshot {
  const root = record(response);
  if (responseCode(root) !== "00000") throw new Error("Order book response was not successful");
  const data = record(root.data);
  const rawBids = levelsFrom(data.b);
  const rawAsks = levelsFrom(data.a);
    const exchangeTimestamp = isoFromMilliseconds(stringValue(data.ts));
    const hash = sha256(canonicalJson({ asset, symbol: instrument.symbol, bids: rawBids, asks: rawAsks, exchangeTimestamp }));
  return MarketSnapshotSchema.parse({
    id: `snapshot_${hash.slice(0, 24)}`,
    hash,
    asset,
    symbol: instrument.symbol,
    bids: rawBids,
    asks: rawAsks,
    exchangeTimestamp,
    receivedAt,
    mode: "live",
    rawResponseReference: reference,
    validationWarnings: [],
  });
}

type Probe = {
  description: string;
  capturedAtUTC: string;
  requests: Array<{ name: string; url: string; response: unknown }>;
};

function capturedRequest(probe: Probe, name: string) {
  const request = probe.requests.find((candidate) => candidate.name === name);
  if (!request) throw new Error(`Captured fixture request is missing: ${name}`);
  return request.response;
}

/** Builds a validated instrument and snapshot from raw Bitget responses captured earlier (replay and evaluation). */
export function marketFromCapturedResponses(asset: Asset, instrumentResponse: unknown, bookResponse: unknown, receivedAt: string, reference: string) {
  const instrument = instrumentFromResponse(asset, instrumentResponse);
  const snapshot = bookFromResponse(asset, instrument, bookResponse, receivedAt, reference);
  return { instrument, snapshot: MarketSnapshotSchema.parse({ ...snapshot, mode: "captured_real" }) };
}

export function createCapturedMarket(asset: Asset) {
  try {
    const probe = selectionProbe as unknown as Probe;
    const suffix = asset.toLowerCase();
    const instrumentResponse = capturedRequest(probe, `${suffix}_spot_instrument`);
    const bookResponse = capturedRequest(probe, `${suffix}_spot_book`);
    return marketFromCapturedResponses(asset, instrumentResponse, bookResponse, probe.capturedAtUTC, "fixture:selection-probe.json");
  } catch (error) {
    throw new MarketAdapterError("market_invalid", error instanceof Error ? error.message : "Captured market fixture is invalid.");
  }
}

async function readLimitedBody(response: Response) {
  if (!response.body) throw new Error("Market response did not expose a body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel("response body too large");
        throw new Error("Market response exceeded the 1 MB body limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function retryAfterMs(response: Response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return 250;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) return 250;
  return Math.min(Math.max(seconds * 1000, 0), 1000);
}

async function wait(milliseconds: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MARKET_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if ((response.status === 408 || response.status === 429 || response.status >= 500) && attempt === 0) {
        await wait(retryAfterMs(response));
        continue;
      }
      const body = await readLimitedBody(response);
      if (!response.ok) throw new Error(`Bitget returned HTTP ${response.status}`);
      return { payload: parseLossless(body) as unknown, requestTime: response.headers.get("date") ?? null };
    } catch (error) {
      lastError = error;
      const aborted = error instanceof DOMException && error.name === "AbortError";
      if (aborted) {
        lastError = new Error("Bitget market request timed out");
      }
      if (attempt === 0 && (aborted || error instanceof TypeError)) {
        await wait(250);
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Bitget market request failed");
}

export async function fetchLiveMarket(asset: Asset) {
  const symbol = ASSET_CONFIG[asset].symbol;
  const urls = {
    instrument: `${BITGET_BASE_URL}/api/v3/market/instruments?category=SPOT&symbol=${symbol}`,
    ticker: `${BITGET_BASE_URL}/api/v3/market/tickers?category=SPOT&symbol=${symbol}`,
    book: `${BITGET_BASE_URL}/api/v3/market/orderbook?category=SPOT&symbol=${symbol}&limit=50`,
  };
  try {
    const results = await Promise.allSettled([
      fetchJson(urls.instrument),
      fetchJson(urls.ticker),
      fetchJson(urls.book),
    ]);
    const instrumentResult = results[0];
    const tickerResult = results[1];
    const bookResult = results[2];
    if (instrumentResult.status !== "fulfilled") throw instrumentResult.reason;
    if (bookResult.status !== "fulfilled") throw bookResult.reason;
    const instrument = instrumentFromResponse(asset, instrumentResult.value.payload);
    let tickerWarning = tickerResult.status === "rejected";
    if (tickerResult.status === "fulfilled") {
      try {
        const tickerRoot = record(tickerResult.value.payload);
        if (responseCode(tickerRoot) !== "00000") throw new Error("Ticker response was not successful");
        if (!Array.isArray(tickerRoot.data) || tickerRoot.data.length !== 1) throw new Error("Ticker response had no unique record");
        if (stringValue(record(tickerRoot.data[0]).symbol) !== symbol) throw new Error("Ticker identity did not match the fixed allowlist");
      } catch {
        tickerWarning = true;
      }
    }
    const receivedAt = new Date().toISOString();
    const snapshot = bookFromResponse(asset, instrument, bookResult.value.payload, receivedAt, `bitget:${urls.book}`);
    const exchangeMs = new Date(snapshot.exchangeTimestamp).getTime();
    const receivedMs = new Date(snapshot.receivedAt).getTime();
    const skewWarnings = exchangeMs > receivedMs + 5_000
      ? ["Exchange timestamp is more than 5 seconds ahead of receipt time."]
      : [];
    if (receivedMs - exchangeMs > 30_000) skewWarnings.push("Snapshot is older than 30 seconds; refresh for current data.");
    if (tickerWarning) skewWarnings.push("Ticker context was unavailable or invalid; book-based economics remains independent.");
    return { instrument, snapshot: MarketSnapshotSchema.parse({ ...snapshot, validationWarnings: skewWarnings }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bitget market data was unavailable.";
    // Preserve invalid vs unavailable: identity/code/schema failures are data errors, not transport.
    const invalidHints = ["identity", "not successful", "no unique record", "malformed", "missing", "precision", "timestamp", "successful"];
    const isInvalid = invalidHints.some((hint) => message.toLowerCase().includes(hint.toLowerCase()));
    throw new MarketAdapterError(isInvalid ? "market_invalid" : "market_unavailable", message);
  }
}

export async function getMarket(asset: Asset, mode: "captured_real" | "live") {
  return mode === "captured_real" ? createCapturedMarket(asset) : fetchLiveMarket(asset);
}

export function supportedAssets() {
  return Object.entries(ASSET_CONFIG).map(([asset, values]) => ({ asset: asset as Asset, ...values }));
}
