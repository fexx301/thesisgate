import { describe, expect, it } from "vitest";
import { cachedHeadline, capturedHeadlines, isRelevant, parseFeed } from "../../src/server/feeds";
import { extractNewsroomArticle, sourceFromHeadline } from "../../src/server/articles";
import { lastCloseFromDailyBars, latestFromIntradayBars } from "../../src/server/underlying";

const rss = `<?xml version="1.0"?><rss><channel>
<item><title>Nvidia &amp; AWS expand deal</title><link>https://finance.yahoo.com/news/nvidia-aws.html?.tsrc=rss</link><description><![CDATA[<p>Nvidia said it will ship more GPUs.</p>]]></description><pubDate>Thu, 24 Sep 2026 13:20:30 +0000</pubDate></item>
<item><title>Treasury yields climb</title><link>https://finance.yahoo.com/news/yields.html</link><description>Bonds sell off.</description><pubDate>Thu, 24 Sep 2026 12:00:00 +0000</pubDate></item>
<item><title>No link item</title></item>
</channel></rss>`;

const definition = { feed: "yahoo_finance_ticker" as const, kind: "news_aggregator" as const, publisher: "Yahoo Finance", url: "https://feeds.finance.yahoo.com/x", host: "feeds.finance.yahoo.com", format: "rss" as const };

describe("feed parsing", () => {
  it("parses items, decodes entities, strips tracking parameters and skips malformed items", () => {
    const headlines = parseFeed(rss, definition, "NVDA");
    expect(headlines).toHaveLength(2);
    expect(headlines[0].title).toBe("Nvidia & AWS expand deal");
    expect(headlines[0].url).toBe("https://finance.yahoo.com/news/nvidia-aws.html");
    expect(headlines[0].summary).toBe("Nvidia said it will ship more GPUs.");
    expect(headlines[0].publishedAt).toBe("2026-09-24T13:20:30.000Z");
    expect(headlines[0].id).toMatch(/^hl_[a-f0-9]{16}$/);
    expect(headlines[0].fullTextAvailable).toBe(false);
  });

  it("keeps only aggregator stories that name the company", () => {
    const [nvidia, yields] = parseFeed(rss, definition, "NVDA");
    expect(isRelevant(nvidia, "NVDA")).toBe(true);
    expect(isRelevant(yields, "NVDA")).toBe(false);
    expect(isRelevant({ ...yields, kind: "issuer_official" }, "NVDA")).toBe(true);
  });

  it("marks only allowlisted newsroom release pages as full-text sources", () => {
    const official = parseFeed(
      `<rss><item><title>Release</title><link>https://nvidianews.nvidia.com/news/some-release</link><pubDate>Tue, 26 Aug 2026 13:00:00 GMT</pubDate></item><item><title>Blog</title><link>https://blogs.nvidia.com/blog/post/</link></item></rss>`,
      { ...definition, feed: "issuer_newsroom", kind: "issuer_official", publisher: "NVIDIA Newsroom" },
      "NVDA",
    );
    expect(official.map((headline) => headline.fullTextAvailable)).toEqual([true, false]);
  });

  it("turns an SEC 8-K Atom entry into a dated filing headline", () => {
    const atom = `<feed><entry><category term="8-K" /><id>urn:tag:sec.gov,2008:accession-number=0001045810-26-000078</id>
      <link href="https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/0001045810-26-000078-index.htm" rel="alternate" type="text/html" />
      <summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-09-03 &lt;b&gt;AccNo:&lt;/b&gt; 0001045810-26-000078 &lt;b&gt;Size:&lt;/b&gt; 146 KB&lt;br&gt;Item 8.01: Other Events</summary>
      <title>8-K  - Current report</title><updated>2026-09-03T08:03:56-04:00</updated></entry></feed>`;
    const [filing] = parseFeed(atom, { ...definition, feed: "sec_edgar_8k", kind: "regulatory_filing", publisher: "SEC EDGAR", format: "atom" }, "NVDA");
    expect(filing.title).toBe("NVIDIA 8-K filing: Item 8.01: Other Events");
    expect(filing.publishedAt).toBe("2026-09-03T12:03:56.000Z");
    expect(filing.summary).toContain("Filed: 2026-09-03");
    expect(isRelevant(filing, "NVDA")).toBe(true);
  });

  it("serves captured headlines with stable IDs that the server can resolve", () => {
    const [captured] = capturedHeadlines("NVDA");
    expect(captured.mode).toBe("captured_real");
    expect(captured.publishedDate).toBe("2026-08-26");
    expect(cachedHeadline(captured.id)?.url).toBe(captured.url);
    expect(capturedHeadlines("TSLA")).toHaveLength(0);
  });
});

describe("article retrieval", () => {
  it("extracts the dated body of a newsroom release without boilerplate", () => {
    const body = "Paragraph one describes the plan. ".repeat(10);
    const html = `<html><title>Big News | NVIDIA Newsroom</title><div class="article-date">
      August 26, 2026 </div><div class="article-body"><p>${body}</p><ul><li>Deploy GPUs in 2027-2028</li></ul><p>About NVIDIA</p><p>Boilerplate</p></div><div class="article-bottom">x</div></html>`;
    const article = extractNewsroomArticle(html);
    expect(article.publicationDate).toBe("2026-08-26");
    expect(article.title).toBe("Big News");
    expect(article.text).toContain("- Deploy GPUs in 2027-2028");
    expect(article.text).not.toContain("Boilerplate");
  });

  it("builds a dated official source from the captured release", async () => {
    const [captured] = capturedHeadlines("NVDA");
    const { source, warning } = await sourceFromHeadline(captured, "2026-09-24T00:00:00.000Z");
    expect(warning).toBeNull();
    expect(source.provenance).toBe("captured_official_excerpt");
    expect(source.publicationDate).toBe("2026-08-26");
    expect(source.cleanedText).toContain("2 million additional NVIDIA GPUs");
  });

  it("uses the labeled feed summary for non-official headlines", async () => {
    const [headline] = parseFeed(rss, definition, "NVDA");
    const { source } = await sourceFromHeadline(headline, "2026-09-24T14:00:00.000Z");
    expect(source.provenance).toBe("retrieved_feed_summary");
    expect(source.cleanedText).toBe("Nvidia & AWS expand deal\n\nNvidia said it will ship more GPUs.");
  });
});

describe("underlying quotes", () => {
  // Daily bars are stamped at the 09:30 ET session open.
  const daily = { timestamp: [1790170200, 1790256600], indicators: { quote: [{ close: [225.50999450683594, 222.1] }] } };

  it("picks the last completed session close, not the in-progress day", () => {
    expect(lastCloseFromDailyBars(daily, new Date("2026-09-24T15:00:00Z"))).toEqual({
      lastClose: "225.51", lastCloseSessionDate: "2026-09-23", lastCloseAt: "2026-09-23T20:00:00.000Z",
    });
  });

  it("uses the last non-null intraday print as the latest price", () => {
    expect(latestFromIntradayBars({ timestamp: [1790259000, 1790259300], indicators: { quote: [{ close: [222.1, null] }] } }))
      .toEqual({ latestPrice: "222.1", latestAt: "2026-09-24T14:10:00.000Z" });
  });
});

describe("ttl cache", () => {
  it("coalesces concurrent misses, serves hits, and does not cache failures", async () => {
    const { createTtlCache } = await import("../../src/server/fetch-text");
    const cache = createTtlCache<number>(60_000);
    let calls = 0;
    const load = async () => { calls += 1; return calls; };
    const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    expect(await cache.get("k", load)).toBe(1);
    await expect(cache.get("bad", async () => { throw new Error("upstream"); })).rejects.toThrow("upstream");
    expect(await cache.get("bad", async () => 7)).toBe(7);
  });
});
