import "server-only";
import type { Asset, Investigation, SourceDocument } from "@/domain/contracts";
import { MAX_SOURCE_CHARS, SourceDocumentSchema } from "@/domain/contracts";
import type { InvestigationSource } from "@/domain/investigation";
import { analystTargetsEvidence, BITGET_AGENT_MCP, earningsCalendarEvidence } from "./bitget-agent";
import { callMcpToolOnce } from "./mcp-client";
import { fetchBoundedText } from "./fetch-text";
import { parseFeed, parseSecSubmissions } from "./feeds";
import { extractNewsroomArticle } from "./articles";
import { newId, sha256 } from "./identifiers";

const CIK: Record<Asset, string> = { NVDA: "0001045810", TSLA: "0001318605", AAPL: "0000320193", MSFT: "0000789019", AMZN: "0001018724", GOOGL: "0001652044", META: "0001326801" };
type Lookup = Investigation["lookups"][number];
export type LookupResult = { sources: SourceDocument[]; lookups: Lookup[] };

function document(title: string, publisher: string, text: string, url: string | null, date: string | null, asOf: Date): SourceDocument {
  const cleanedText = text.slice(0, MAX_SOURCE_CHARS);
  return SourceDocumentSchema.parse({
    id: newId("src"), title, publisher, cleanedText, textHash: sha256(cleanedText),
    originalUrl: url, finalApprovedUrl: url, publicationDate: date, publicationDatePrecision: date ? "day" : "unknown",
    eventDate: null, fetchedAt: asOf.toISOString(), provenance: url ? "retrieved_official" : "retrieved_platform_data", truncated: text.length > MAX_SOURCE_CHARS,
  });
}

/** One source-specific lookup, or newsroom index + one matching article. Never fans out to all feeds.
 * Every transport shares the same deadline signal; no network retries and no caller-supplied URLs. */
export async function lookupInvestigation(source: InvestigationSource, asset: Asset, claim: string, asOf: Date, signal: AbortSignal): Promise<LookupResult> {
  const lookups: Lookup[] = [];
  const sources: SourceDocument[] = [];
  const get = async (url: string, label: string, accept: string, userAgent?: string) => {
    const entry: Lookup = { source: label, status: "failed", detail: "Lookup did not complete.", sourceIds: [] };
    lookups.push(entry);
    const response = await fetchBoundedText(url, { allowedHosts: new Set([new URL(url).hostname]), maxBytes: 4_000_000, timeoutMs: 8_000, accept, userAgent, signal });
    entry.status = "empty";
    entry.detail = "No relevant record found in the returned data.";
    return response;
  };
  const add = (doc: SourceDocument) => {
    sources.push(doc);
    Object.assign(lookups[lookups.length - 1], { status: "found", detail: "Dated evidence retrieved; this is not itself a claim verdict.", sourceIds: [doc.id] });
  };
  try {
    signal.throwIfAborted();
    if (source === "earnings" || source === "analysts") {
      lookups.push({ source: `Bitget ${source}`, status: "failed", detail: "Lookup did not complete.", sourceIds: [] });
      const text = await callMcpToolOnce(BITGET_AGENT_MCP, "do_query", {
        entry_id: source === "earnings" ? "equity_calendar" : "equity_estimates_price_target",
        params: { symbol: asset, ...(source === "analysts" ? { limit: 40 } : {}) },
      }, signal);
      const data = JSON.parse(text) as { success?: boolean; status_code?: number; data?: { results?: unknown } };
      if (data.success === false) throw new Error(`Bitget ${source} data service returned HTTP ${data.status_code ?? "error"}. The source is unavailable; this does not contradict the claim.`);
      if (!Array.isArray(data.data?.results)) throw new Error("The data provider did not return a valid records list.");
      const rows = data.data.results.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
      const result = source === "earnings" ? earningsCalendarEvidence(asset, rows, asOf.toISOString().slice(0, 10)) : analystTargetsEvidence(asset, rows);
      lookups[0].status = "empty";
      lookups[0].detail = "No usable records returned; absence does not contradict the claim.";
      if (result) add(document(result.headline.title, result.headline.publisher, `${result.body}\nCoverage: returned records only, not an exhaustive history.`, null, result.headline.publishedDate, asOf));
    } else if (source === "revenue" || source === "filings") {
      const agent = process.env.THESIS_SEC_USER_AGENT?.trim();
      if (!agent) throw new Error("SEC contact user agent is not configured; no SEC request was made.");
      const today = asOf.toISOString().slice(0, 10);
      if (source === "revenue") {
        // Company-wide facts can exceed 4 MB. Fetch only revenue concepts, with one fallback at most.
        const concepts = asset === "NVDA" ? ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"] : ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"];
        const requestedDates = claim.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
        for (const name of concepts) {
          const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${CIK[asset]}/us-gaap/${name}.json`;
          const { text } = await get(url, `SEC EDGAR ${name}`, "application/json", agent);
          const data = JSON.parse(text) as { units?: { USD?: Array<Record<string, unknown>> } };
          const rows = data.units?.USD ?? [];
          const eligible = rows.filter((row) => typeof row.filed === "string" && row.filed <= today && typeof row.start === "string" && typeof row.end === "string" && typeof row.val === "number" && Number.isFinite(row.val))
            .filter((row) => requestedDates.length === 0 || requestedDates.every((date) => row.start === date || row.end === date || row.filed === date))
            .sort((a, b) => String(b.filed).localeCompare(String(a.filed))).slice(0, 12);
          const lines = eligible.map((row) => `${name}: ${row.val} USD; period ${row.start} to ${row.end}; form ${row.form}; filed ${row.filed}; accession ${row.accn}.`);
          if (lines.length) {
            add(document(`${asset} reported revenue: SEC XBRL ${name}`, "SEC EDGAR", `${asset} consolidated revenue facts retrieved as of ${today}.\n${lines.join("\n")}\nThese facts do not attribute revenue to a deal, product or customer. Period start/end define the duration; quarterly and year-to-date values are not interchangeable.`, url, null, asOf));
            break;
          }
        }
      } else {
        const url = `https://data.sec.gov/submissions/CIK${CIK[asset]}.json`;
        const { text } = await get(url, "SEC EDGAR filing dates", "application/json", agent);
        const entries = parseSecSubmissions(text, { feed: "sec_edgar_8k", kind: "regulatory_filing", publisher: "SEC EDGAR", url, host: "data.sec.gov", format: "sec_json" }, asset, 12).filter((item) => item.publishedDate && item.publishedDate <= today);
        if (entries.length) add(document(`${asset} recent 8-K filing records`, "SEC EDGAR", entries.map((item) => `${item.title}\n${item.summary}\n${item.url}`).join("\n\n") + "\nFiling metadata only. The underlying filing text and exhibits were not read; no conclusion about their contents is established.", url, entries[0].publishedDate, asOf));
      }
    } else {
      const url = "https://nvidianews.nvidia.com/releases.xml";
      const { text } = await get(url, "NVIDIA newsroom index", "application/rss+xml");
      const headlines = parseFeed(text, { feed: "issuer_newsroom", kind: "issuer_official", publisher: "NVIDIA Newsroom", url, host: "nvidianews.nvidia.com", format: "rss" }, asset);
      const stop = new Set("nvidia nvda announced announcement today the and that with for this was has more".split(" "));
      const terms = [...new Set(claim.toLowerCase().match(/[a-z]+|\d+/g) ?? [])].filter((term) => !stop.has(term));
      const best = headlines.map((headline) => ({ headline, score: terms.filter((term) => `${headline.title} ${headline.summary}`.toLowerCase().includes(term)).length })).sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 2 && best.headline.url && new URL(best.headline.url).hostname === "nvidianews.nvidia.com") {
        lookups[0].status = "found";
        lookups[0].detail = "A potentially relevant official release was found; its full text is checked next.";
        const response = await get(best.headline.url, "NVIDIA official release", "text/html");
        const article = extractNewsroomArticle(response.text);
        add(document(article.title || best.headline.title, "NVIDIA Newsroom", article.text, response.finalUrl, article.publicationDate, asOf));
      }
    }
  } catch (error) {
    const entry = lookups[lookups.length - 1];
    const detail = signal.aborted ? "Lookup deadline reached; unfinished requests were cancelled." : error instanceof Error ? error.message : "Lookup failed.";
    if (entry) Object.assign(entry, { status: "failed", detail });
    else lookups.push({ source, status: "failed", detail, sourceIds: [] });
  }
  return { sources, lookups };
}
