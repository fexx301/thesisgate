import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveMarket } from "../../src/server/bitget";

afterEach(() => {
  vi.unstubAllGlobals();
});

function instrumentResponse() {
  return {
    code: "00000",
    requestTime: String(Date.now()),
    data: [{
      symbol: "RNVDAUSDT",
      category: "SPOT",
      baseCoin: "rNVDA",
      quoteCoin: "USDT",
      symbolType: "stock",
      isReality: "yes",
      status: "online",
      quantityPrecision: "4",
      pricePrecision: "4",
      minOrderQty: "0.01",
      maxOrderQty: "0",
      minOrderAmount: "10",
      maxPositionNum: "0",
    }],
  };
}

function bookResponse(exchangeTimestamp = Date.now()) {
  return {
    code: "00000",
    data: { ts: String(exchangeTimestamp), b: [["100", "2"]], a: [["101", "2"]] },
  };
}

function mockMarketFetch(tickerResponse: unknown, exchangeTimestamp = Date.now()) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("instruments")) return Response.json(instrumentResponse());
    if (url.includes("tickers")) return Response.json(tickerResponse);
    return Response.json(bookResponse(exchangeTimestamp));
  }));
  return calls;
}

describe("Bitget market adapter", () => {
  it("keeps the book usable when ticker context fails", async () => {
    const calls = mockMarketFetch({ code: "10001", data: [] });
    const result = await fetchLiveMarket("NVDA");
    expect(result.instrument.symbol).toBe("RNVDAUSDT");
    expect(result.snapshot.bids).toEqual([["100", "2"]]);
    expect(result.snapshot.validationWarnings.join(" ")).toContain("Ticker context was unavailable");
    expect(calls.some((url) => url.includes("symbol=RNVDAUSDT"))).toBe(true);
  });

  it("flags a book older than the current-data freshness policy", async () => {
    mockMarketFetch({ code: "00000", data: [{ symbol: "RNVDAUSDT" }] }, Date.now() - 31_000);
    const result = await fetchLiveMarket("NVDA");
    expect(result.snapshot.validationWarnings.join(" ")).toContain("older than 30 seconds");
  });

  it("does not fall back to the captured fixture when the venue is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await expect(fetchLiveMarket("NVDA")).rejects.toMatchObject({ kind: "market_unavailable" });
  });
});
