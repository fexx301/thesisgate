import "server-only";

import { isIP } from "node:net";
import { MAX_SOURCE_CHARS, type SourceDocument } from "@/domain/contracts";
import { newId, sha256 } from "./identifiers";

export const APPROVED_SOURCE_HOSTS = new Set([
  "nvidianews.nvidia.com",
  "investor.nvidia.com",
  "ir.tesla.com",
]);

export const SOURCE_RETRIEVAL_ENABLED = false;

function canonicalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseSafeUrl(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    if (isIP(url.hostname) !== 0 || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) return null;
    return url;
  } catch {
    return null;
  }
}

function titleFromText(text: string, url: URL | null) {
  const heading = text.split("\n").find((line) => line.trim().length >= 8);
  if (heading) return heading.trim().slice(0, 160);
  return url ? `${url.hostname} source text` : "Pasted source text";
}

export function createPastedSourceDocument(input: { text: string; originalUrl?: string | null; fetchedAt: string }): SourceDocument | null {
  const cleaned = canonicalizeText(input.text);
  if (!cleaned) return null;
  const truncated = cleaned.length > MAX_SOURCE_CHARS;
  const boundedText = truncated ? cleaned.slice(0, MAX_SOURCE_CHARS) : cleaned;
  const safeUrl = parseSafeUrl(input.originalUrl);
  const host = safeUrl?.hostname ?? null;
  return {
    id: newId("src"),
    originalUrl: safeUrl?.toString() ?? null,
    finalApprovedUrl: null,
    title: titleFromText(boundedText, safeUrl),
    publisher: host ?? "User supplied source",
    publicationDate: null,
    publicationDatePrecision: "unknown",
    eventDate: null,
    fetchedAt: input.fetchedAt,
    cleanedText: boundedText,
    textHash: sha256(boundedText),
    provenance: "user_pasted_unverified",
    truncated,
  };
}

export function sourceUrlStatus(originalUrl: string | null | undefined) {
  const safeUrl = parseSafeUrl(originalUrl);
  if (!safeUrl) return { valid: false, approvedHost: false, message: "Use an HTTPS URL without credentials or a custom port." };
  const approvedHost = APPROVED_SOURCE_HOSTS.has(safeUrl.hostname);
  if (!approvedHost) return { valid: true, approvedHost: false, message: "This host is not in the initial official-source allowlist." };
  if (!SOURCE_RETRIEVAL_ENABLED) return { valid: true, approvedHost: true, message: "URL retrieval is disabled in this first slice. Paste the source text to continue." };
  return { valid: true, approvedHost: true, message: "Source host is approved." };
}
