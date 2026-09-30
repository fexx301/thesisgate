import "server-only";

import capturedContext from "../../fixtures/captured-context.json";
import { HeadlineSchema, type Asset, type Headline } from "@/domain/contracts";
import { fetchBitgetEvidence, fetchSkillNews, OPTIONAL_DEADLINE_MS } from "./bitget-agent";
import { createTtlCache, decodeEntities, fetchBoundedText, htmlToText, withDeadline } from "./fetch-text";
import { sha256 } from "./identifiers";

const FEED_TIMEOUT_MS = 8_000;
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
  format: "rss" | "atom" | "sec_json";
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
      // The submissions API is EDGAR's supported programmatic endpoint; the legacy browse page often stalls.
      url: `https://data.sec.gov/submissions/CIK${SEC_CIK[asset]}.json`,
      host: "data.sec.gov",
      format: "sec_json",
      userAgent: secAgent,
    });
  }
  return feeds;
}

const headlineCache = new Map<string, { headline: Headline; cachedAt: number }>();
// Full text for Bitget records, kept server-side so browsers only ever send headline IDs.
const headlineBodies = new Map<string, string>();

/** Registers server-held full text for a headline (used by the evaluation replay of captured Bitget records). */
export function registerHeadlineBody(id: string, body: string) {
  headlineBodies.set(id, body);
}

export function cachedHeadlineBody(id: string) {
  return headlineBodies.get(id) ?? null;
}

function remember(headline: Headline) {
  const now = Date.now();
  for (const [id, entry] of headlineCache) {
    if (now - entry.cachedAt < HEADLINE_CACHE_TTL_MS && headlineCache.size < HEADLINE_CACHE_MAX) break;
    headlineCache.delete(id);
    headlineBodies.delete(id);
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
  headlineBodies.clear();
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

const SEC_ITEMS: Record<string, string> = {
  "1.01": "Entry into a Material Definitive Agreement",
  "1.02": "Termination of a Material Definitive Agreement",
  "2.01": "Completion of Acquisition or Disposition of Assets",
  "2.02": "Results of Operations and Financial Condition",
  "2.03": "Creation of a Direct Financial Obligation",
  "2.05": "Costs Associated with Exit or Disposal Activities",
  "2.06": "Material Impairments",
  "3.02": "Unregistered Sales of Equity Securities",
  "5.02": "Departure or Appointment of Directors or Officers",
  "5.03": "Amendments to Articles of Incorporation or Bylaws",
  "5.07": "Submission of Matters to a Vote of Security Holders",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events",
  "9.01": "Financial Statements and Exhibits",
};

/** Turns EDGAR's submissions JSON into dated 8-K filing headlines linking to the filed document. */
export function parseSecSubmissions(json: string, definition: FeedDefinition, asset: Asset, limit = 6): Headline[] {
  const data = JSON.parse(json) as { cik?: string; filings?: { recent?: Record<string, unknown[]> } };
  const recent = data.filings?.recent ?? {};
  const forms = (recent.form ?? []) as string[];
  const headlines: Headline[] = [];
  const cik = String(Number(data.cik ?? SEC_CIK[asset]));
  for (let index = 0; index < forms.length && headlines.length < limit; index += 1) {
    if (forms[index] !== "8-K") continue;
    const filingDate = String(recent.filingDate?.[index] ?? "");
    const accession = String(recent.accessionNumber?.[index] ?? "");
    const document = String(recent.primaryDocument?.[index] ?? "");
    const accepted = String(recent.acceptanceDateTime?.[index] ?? "");
    const items = String(recent.items?.[index] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filingDate) || !accession) continue;
    const itemText = items.map((item) => `Item ${item}: ${SEC_ITEMS[item] ?? "Other"}`).join("; ");
    const acceptedAt = accepted && !Number.isNaN(new Date(accepted).getTime()) ? new Date(accepted).toISOString() : null;
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll("-", "")}/${document || `${accession}-index.htm`}`;
    const parsed = HeadlineSchema.safeParse({
      id: headlineId(definition.feed, url, filingDate),
      asset,
      title: `${COMPANY_NAME[asset]} 8-K filing${itemText ? `: ${itemText}` : ""}`.slice(0, 400),
      summary: `Filed with the SEC on ${filingDate}${acceptedAt ? ` (accepted ${acceptedAt.slice(11, 16)} UTC)` : ""}. Form 8-K${itemText ? `, ${itemText}` : ""}. Accession number ${accession}.`,
      url,
      publisher: definition.publisher,
      publishedAt: acceptedAt,
      publishedDate: filingDate,
      feed: definition.feed,
      kind: definition.kind,
      fullTextAvailable: false,
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
      id: headlineId(`captured:${item.feed}`, item.url ?? "", item.title),
      fullTextAvailable: true,
      mode: "captured_real",
    }));
}

export async function fetchHeadlines(asset: Asset, mode: "live" | "captured_real") {
  if (mode === "captured_real") return { headlines: capturedHeadlines(asset), warnings: [] as string[] };
  const warnings: string[] = [];
  const bitgetPromise = fetchBitgetEvidence(asset).catch(() => ({ items: [], warnings: ["Bitget market data unavailable."] }));
  const results = await Promise.allSettled(feedsFor(asset).map((definition) => feedCache.get(definition.url, async () => {
    const { text } = await fetchBoundedText(definition.url, {
      allowedHosts: new Set([definition.host]),
      maxBytes: FEED_MAX_BYTES,
      timeoutMs: FEED_TIMEOUT_MS,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      userAgent: definition.userAgent,
    });
    return definition.format === "sec_json" ? parseSecSubmissions(text, definition, asset) : parseFeed(text, definition, asset);
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
  const [bitget, skillNews] = await Promise.all([
    withDeadline(bitgetPromise, OPTIONAL_DEADLINE_MS + 1_000, () => ({ items: [], warnings: ["Bitget market data timed out."] })),
    withDeadline(fetchSkillNews(asset), OPTIONAL_DEADLINE_MS, () => []),
  ]);
  warnings.push(...bitget.warnings);
  for (const headline of skillNews) {
    const key = headline.title.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      headlines.push(headline);
    }
  }
  // Structured Bitget data (analyst targets, earnings calendar) leads the list; Bitget news joins the dated feed.
  const data = bitget.items.filter((item) => item.headline.kind === "market_data");
  const news = bitget.items.filter((item) => item.headline.kind === "platform_news");
  const merged = [...headlines, ...news.map((item) => item.headline)]
    .sort((left, right) => (right.publishedAt ?? right.publishedDate ?? "").localeCompare(left.publishedAt ?? left.publishedDate ?? ""));
  // Always keep the latest regulatory filings visible; a busy newsroom must not crowd them out.
  const filings = merged.filter((headline) => headline.kind === "regulatory_filing").slice(0, 2);
  const rest = merged.filter((headline) => !filings.includes(headline)).slice(0, MAX_HEADLINES - filings.length);
  const bounded = [...data.map((item) => item.headline), ...[...rest, ...filings]
    .sort((left, right) => (right.publishedAt ?? right.publishedDate ?? "").localeCompare(left.publishedAt ?? left.publishedDate ?? ""))];
  const shown = new Set(bounded.map((headline) => headline.id));
  for (const item of bitget.items) if (shown.has(item.headline.id)) headlineBodies.set(item.headline.id, item.body);
  bounded.forEach(remember);
  return { headlines: bounded, warnings };
}
