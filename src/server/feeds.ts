import "server-only";

import capturedContext from "../../fixtures/captured-context.json";
import { HeadlineSchema, type Asset, type Headline } from "@/domain/contracts";
import { createTtlCache, decodeEntities, fetchBoundedText, htmlToText } from "./fetch-text";
import { sha256 } from "./identifiers";

const FEED_TIMEOUT_MS = 6_000;
const FEED_MAX_BYTES = 1_500_000;
const HEADLINE_CACHE_TTL_MS = 3 * 60 * 60_000;
const HEADLINE_CACHE_MAX = 600;
const MAX_HEADLINES = 20;
// Feeds change slowly; caching keeps SEC fair-access limits and Yahoo rate limits comfortable.
const FEED_CACHE_TTL_MS = 3 * 60_000;
const feedCache = createTtlCache<Headline[]>(FEED_CACHE_TTL_MS);

// Only these hosts can be fetched for full article text; every other headline is summary-only.
export const OFFICIAL_ARTICLE_HOSTS = new Set(["nvidianews.nvidia.com"]);

const COMPANY_NAME: Record<Asset, string> = { NVDA: "NVIDIA", TSLA: "Tesla" };
const SEC_CIK: Record<Asset, string> = { NVDA: "0001045810", TSLA: "0001318605" };
// Aggregator feeds tagged by ticker still carry market-wide stories; keep only ones that name the company.
const RELEVANCE: Record<Asset, RegExp> = { NVDA: /\b(nvidia|nvda|jensen huang|geforce|cuda|blackwell|rubin)\b/i, TSLA: /\b(tesla|tsla|elon musk|musk|cybertruck|robotaxi|model [3sxy]|optimus)\b/i };

export function isRelevant(headline: Pick<Headline, "title" | "summary" | "kind">, asset: Asset) {
  return headline.kind !== "news_aggregator" || RELEVANCE[asset].test(`${headline.title} ${headline.summary}`);
}

type FeedDefinition = {
  feed: Headline["feed"];
  kind: Headline["kind"];
  publisher: string;
  url: string;
  host: string;
  format: "rss" | "atom";
  userAgent?: string;
};

function feedsFor(asset: Asset): FeedDefinition[] {
  const feeds: FeedDefinition[] = [
    {
      feed: "yahoo_finance_ticker",
      kind: "news_aggregator",
      publisher: "Yahoo Finance",
      url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${asset}&region=US&lang=en-US`,
      host: "feeds.finance.yahoo.com",
      format: "rss",
    },
  ];
  if (asset === "NVDA") {
    feeds.push({
      feed: "issuer_newsroom",
      kind: "issuer_official",
      publisher: "NVIDIA Newsroom",
      url: "https://nvidianews.nvidia.com/releases.xml",
      host: "nvidianews.nvidia.com",
      format: "rss",
    });
  }
  // SEC EDGAR requires a declared contact in the user agent; the feed is skipped until one is configured.
  const secAgent = process.env.THESIS_SEC_USER_AGENT?.trim();
  if (secAgent) {
    feeds.push({
      feed: "sec_edgar_8k",
      kind: "regulatory_filing",
      publisher: "SEC EDGAR",
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${SEC_CIK[asset]}&type=8-K&dateb=&owner=include&count=6&output=atom`,
      host: "www.sec.gov",
      format: "atom",
      userAgent: secAgent,
    });
  }
  return feeds;
}

const headlineCache = new Map<string, { headline: Headline; cachedAt: number }>();

function remember(headline: Headline) {
  const now = Date.now();
  for (const [id, entry] of headlineCache) {
    if (now - entry.cachedAt < HEADLINE_CACHE_TTL_MS && headlineCache.size < HEADLINE_CACHE_MAX) break;
    headlineCache.delete(id);
  }
  headlineCache.delete(headline.id);
  headlineCache.set(headline.id, { headline, cachedAt: now });
}

/** Headlines are only trusted when this server fetched them; browsers send IDs, never text. */
export function cachedHeadline(id: string): Headline | null {
  const entry = headlineCache.get(id);
  if (!entry) return capturedHeadlines().find((headline) => headline.id === id) ?? null;
  if (Date.now() - entry.cachedAt > HEADLINE_CACHE_TTL_MS) {
    headlineCache.delete(id);
    return null;
  }
  return entry.headline;
}

export function resetHeadlineCacheForTests() {
  headlineCache.clear();
  feedCache.clear();
}

function headlineId(feed: string, url: string, title: string) {
  return `hl_${sha256(`${feed}\n${url}\n${title}`).slice(0, 16)}`;
}

function tagValue(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return null;
  return match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
}

function toIso(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function plain(value: string | null, max: number) {
  if (!value) return "";
  const text = htmlToText(decodeEntities(value)).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function parseFeed(xml: string, definition: FeedDefinition, asset: Asset): Headline[] {
  const blocks = definition.format === "rss"
    ? [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1])
    : [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  const headlines: Headline[] = [];
  for (const block of blocks.slice(0, 40)) {
    let title = plain(tagValue(block, "title"), 400);
    const link = definition.format === "rss"
      ? decodeEntities(tagValue(block, "link") ?? "").trim()
      : decodeEntities(block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "").trim();
    if (!title || !link) continue;
    let url: URL;
    try {
      url = new URL(link);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      url.protocol = "https:";
    } catch {
      continue;
    }
    // Yahoo appends tracking parameters; drop them so the same story keeps a stable ID.
    url.searchParams.delete(".tsrc");
    const publishedAt = toIso(tagValue(block, "pubDate") ?? tagValue(block, "updated") ?? tagValue(block, "published"));
    const summary = plain(tagValue(block, "description") ?? tagValue(block, "summary"), 1_200);
    if (definition.feed === "sec_edgar_8k") {
      // EDGAR titles are generic ("8-K - Current report"); the item list says what was filed.
      const items = [...summary.matchAll(/Item \d+\.\d+:[^I]*/g)].map((match) => match[0].trim()).join("; ");
      title = `${COMPANY_NAME[asset]} 8-K filing${items ? `: ${items}` : ""}`.slice(0, 400);
    }
    const parsed = HeadlineSchema.safeParse({
      id: headlineId(definition.feed, url.toString(), title),
      asset,
      title,
      summary,
      url: url.toString(),
      publisher: definition.publisher,
      publishedAt,
      publishedDate: publishedAt ? publishedAt.slice(0, 10) : null,
      feed: definition.feed,
      kind: definition.kind,
      fullTextAvailable: OFFICIAL_ARTICLE_HOSTS.has(url.hostname) && url.pathname.startsWith("/news/"),
      mode: "live",
    });
    if (parsed.success) headlines.push(parsed.data);
  }
  return headlines;
}

type CapturedContext = {
  capturedAtUTC: string;
  headlines: Array<Omit<Headline, "id" | "fullTextAvailable" | "mode">>;
};

export function capturedHeadlines(asset?: Asset): Headline[] {
  const fixture = capturedContext as unknown as CapturedContext;
  return fixture.headlines
    .filter((item) => !asset || item.asset === asset)
    .map((item) => HeadlineSchema.parse({
      ...item,
      id: headlineId(`captured:${item.feed}`, item.url, item.title),
      fullTextAvailable: true,
      mode: "captured_real",
    }));
}

export async function fetchHeadlines(asset: Asset, mode: "live" | "captured_real") {
  if (mode === "captured_real") return { headlines: capturedHeadlines(asset), warnings: [] as string[] };
  const warnings: string[] = [];
  const results = await Promise.allSettled(feedsFor(asset).map((definition) => feedCache.get(definition.url, async () => {
    const { text } = await fetchBoundedText(definition.url, {
      allowedHosts: new Set([definition.host]),
      maxBytes: FEED_MAX_BYTES,
      timeoutMs: FEED_TIMEOUT_MS,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      userAgent: definition.userAgent,
    });
    return parseFeed(text, definition, asset);
  })));
  const seen = new Set<string>();
  const headlines: Headline[] = [];
  results.forEach((result, index) => {
    const definition = feedsFor(asset)[index];
    if (result.status === "rejected") {
      warnings.push(`${definition.publisher} feed unavailable: ${result.reason instanceof Error ? result.reason.message : "request failed"}`);
      return;
    }
    for (const headline of result.value) {
      if (!isRelevant(headline, asset)) continue;
      const key = headline.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      headlines.push(headline);
    }
  });
  headlines.sort((left, right) => (right.publishedAt ?? right.publishedDate ?? "").localeCompare(left.publishedAt ?? left.publishedDate ?? ""));
  const bounded = headlines.slice(0, MAX_HEADLINES);
  bounded.forEach(remember);
  return { headlines: bounded, warnings };
}
