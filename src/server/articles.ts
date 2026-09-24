import "server-only";

import capturedContext from "../../fixtures/captured-context.json";
import { MAX_SOURCE_CHARS, SourceDocumentSchema, type Headline, type SourceDocument } from "@/domain/contracts";
import { decodeEntities, fetchBoundedText, htmlToText } from "./fetch-text";
import { OFFICIAL_ARTICLE_HOSTS } from "./feeds";
import { newId, sha256 } from "./identifiers";

const ARTICLE_TIMEOUT_MS = 7_000;
const ARTICLE_MAX_BYTES = 2_000_000;

type CapturedArticle = { title: string; publisher: string; publicationDate: string; retrievedAt: string; text: string };

function bounded(text: string) {
  const truncated = text.length > MAX_SOURCE_CHARS;
  return { text: truncated ? text.slice(0, MAX_SOURCE_CHARS) : text, truncated };
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/** Parses an NVIDIA Newsroom release page: the dated article body only, not navigation or boilerplate. */
export function extractNewsroomArticle(html: string) {
  const start = html.search(/class="article-body[^"]*"[^>]*>/i);
  if (start < 0) throw new Error("The article body could not be located on the official page.");
  const afterStart = html.slice(start).replace(/^[^>]*>/, "");
  const endMarker = afterStart.search(/class="article-bottom|class="widget article-contacts/i);
  const body = endMarker > 0 ? afterStart.slice(0, endMarker).replace(/<[^>]*$/, "") : afterStart.slice(0, 200_000);
  let text = htmlToText(body);
  const aboutIndex = text.indexOf("About NVIDIA");
  if (aboutIndex > 200) text = text.slice(0, aboutIndex).trim();
  const dateText = html.match(/class="article-date"[^>]*>\s*([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
  const publicationDate = dateText && MONTHS[dateText[1].toLowerCase()]
    ? `${dateText[3]}-${MONTHS[dateText[1].toLowerCase()]}-${dateText[2].padStart(2, "0")}`
    : null;
  const title = decodeEntities(html.match(/<title>([^<|]+)/i)?.[1]?.trim() ?? "");
  if (text.length < 200) throw new Error("The official page did not contain enough article text.");
  return { text, publicationDate, title };
}

function feedSummaryDocument(headline: Headline, fetchedAt: string): SourceDocument {
  const cleaned = [headline.title, headline.summary].filter(Boolean).join("\n\n");
  const { text, truncated } = bounded(cleaned);
  return SourceDocumentSchema.parse({
    id: newId("src"),
    originalUrl: headline.url,
    finalApprovedUrl: null,
    title: headline.title,
    publisher: headline.publisher,
    publicationDate: headline.publishedAt ?? headline.publishedDate,
    publicationDatePrecision: headline.publishedAt || headline.publishedDate ? "day" : "unknown",
    eventDate: null,
    fetchedAt,
    cleanedText: text,
    textHash: sha256(text),
    provenance: "retrieved_feed_summary",
    truncated,
  });
}

export async function sourceFromHeadline(headline: Headline, fetchedAt: string): Promise<{ source: SourceDocument; warning: string | null }> {
  if (headline.mode === "captured_real") {
    const article = (capturedContext as unknown as { articles: Record<string, CapturedArticle> }).articles[headline.url];
    if (!article) return { source: feedSummaryDocument(headline, fetchedAt), warning: null };
    const { text, truncated } = bounded(article.text);
    return {
      source: SourceDocumentSchema.parse({
        id: newId("src"),
        originalUrl: headline.url,
        finalApprovedUrl: headline.url,
        title: article.title,
        publisher: article.publisher,
        publicationDate: article.publicationDate,
        publicationDatePrecision: "day",
        eventDate: null,
        fetchedAt: article.retrievedAt,
        cleanedText: text,
        textHash: sha256(text),
        provenance: "captured_official_excerpt",
        truncated,
      }),
      warning: null,
    };
  }
  if (!headline.fullTextAvailable) return { source: feedSummaryDocument(headline, fetchedAt), warning: null };
  try {
    const { text: html, finalUrl } = await fetchBoundedText(headline.url, {
      allowedHosts: OFFICIAL_ARTICLE_HOSTS,
      maxBytes: ARTICLE_MAX_BYTES,
      timeoutMs: ARTICLE_TIMEOUT_MS,
      accept: "text/html",
    });
    const article = extractNewsroomArticle(html);
    const { text, truncated } = bounded(article.text);
    return {
      source: SourceDocumentSchema.parse({
        id: newId("src"),
        originalUrl: headline.url,
        finalApprovedUrl: finalUrl,
        title: article.title || headline.title,
        publisher: headline.publisher,
        publicationDate: article.publicationDate ?? headline.publishedDate,
        publicationDatePrecision: article.publicationDate || headline.publishedDate ? "day" : "unknown",
        eventDate: null,
        fetchedAt,
        cleanedText: text,
        textHash: sha256(text),
        provenance: "retrieved_official",
        truncated,
      }),
      warning: null,
    };
  } catch (error) {
    // Full text failed; the feed summary is still genuine server-fetched evidence, labeled as such.
    return {
      source: feedSummaryDocument(headline, fetchedAt),
      warning: `Full text for "${headline.title.slice(0, 80)}" could not be retrieved (${error instanceof Error ? error.message : "unknown error"}); its feed summary was assessed instead.`,
    };
  }
}
