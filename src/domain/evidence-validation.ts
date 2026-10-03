import type { ClaimAssessment, EvidenceResult, Plan, SourceDocument } from "./contracts";

export const EVIDENCE_VALIDATION_VERSION = "evidence-rules-v1";

const STOP = new Set("i just saw read heard that the a an and of to for with in on is are was were has have had it this they their more additional new now today announced announce announcement nvidia nvda rnvda company companies says said think believe about".split(" "));
const tokens = (text: string) => text.toLowerCase().replace(/\btwo\b/g, "2").replace(/\bgpus\b/g, "gpu").match(/[a-z]+|\d+(?:\.\d+)?/g) ?? [];

/** Strict event identity matching: every distinctive word/number in the premise must occur in the
 * release title or opening. Deliberately sacrifices recall rather than equating unrelated announcements. */
export function matchesAnnouncement(claim: string, source: SourceDocument) {
  const terms = [...new Set(tokens(claim).filter((term) => !STOP.has(term)))];
  const bodyTokens = tokens(`${source.title} ${source.cleanedText.slice(0, 1400)}`).filter((term) => !STOP.has(term));
  const body = new Set(bodyTokens);
  const ordered = tokens(claim).filter((term) => !STOP.has(term));
  const anchors = ordered.flatMap((term, index) => {
    if (!/^\d/.test(term)) return [];
    const size = /^(?:thousand|million|billion)$/.test(ordered[index + 1] ?? "") ? 3 : 2;
    const anchor = ordered.slice(index, index + size);
    return anchor.length === size ? [anchor.join(" ")] : [];
  });
  // Preserve quantity/object relations: a GPU release also mentioning CPUs must not be read as
  // announcing the same number of CPUs. All entity terms still have to match as an extra check.
  return terms.length >= 3 && terms.every((term) => body.has(term)) && anchors.every((anchor) => ` ${bodyTokens.join(" ")} `.includes(` ${anchor} `));
}

export function referenceDay(asOf: Date, timezone: string | null) {
  try {
    const zone = timezone || "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(asOf);
    const part = (name: string) => parts.find((item) => item.type === name)?.value;
    return { date: `${part("year")}-${part("month")}-${part("day")}`, timezone: zone };
  } catch {
    return { date: asOf.toISOString().slice(0, 10), timezone: "UTC" };
  }
}

function quote(source: SourceDocument, startOffset: number, length = 300) {
  const endOffset = Math.min(source.cleanedText.length, startOffset + length);
  return { sourceId: source.id, excerpt: source.cleanedText.slice(startOffset, endOffset), startOffset, endOffset };
}

export function summarizeClaims(claims: ClaimAssessment[], origin: EvidenceResult["assessmentOrigin"] = "runtime_model"): EvidenceResult {
  const statuses = new Set(claims.map((claim) => claim.status));
  const count = (status: ClaimAssessment["status"]) => claims.filter((claim) => claim.status === status).length;
  return {
    status: "assessed", assessmentOrigin: origin, scope: "by the supplied evidence",
    verdict: statuses.size > 1 ? "mixed" : claims[0]?.status ?? "insufficient",
    mostConsequentialUnknown: claims.find((claim) => claim.materiality === "material" && claim.status === "insufficient")?.missingEvidence ?? null,
    summary: `${count("supported")} supported, ${count("contradicted")} contradicted, ${count("insufficient")} insufficient. Read the individual claims and their dated sources.${origin === "deterministic_validation" ? " Only the narrow announcement-date check ran; other parts of the thesis have not been assessed." : ""}`,
  };
}

/** Runs independently of the investigation flag and model availability. A date alone is never proof.
 * Only a matching official release explicitly announcing the event 'today' can date the announcement.
 * Near-midnight/adjacent-day ambiguity and competing announcement dates stay insufficient. */
export function validateAnnouncementDates(plan: Plan, sources: SourceDocument[], claims: ClaimAssessment[], evidence: EvidenceResult, asOf: Date) {
  const premise = plan.thesis.split(/[!?;\n]|\.(?:\s|$)/)
    .map((part) => part.split(/,?\s+(?:so|therefore|hence|which means)\b/i)[0].trim())
    .find((part) => /\b(?:today\s+announced|announced\b.{0,180}\btoday)\b/i.test(part) && !/\b(?:not|never|didn't|did not|will|might|may|could|would|if|denied|denies|rumou?r|alleged|whether)\b/i.test(part));
  if (!premise || premise.length > 700) return { claims, evidence };
  const official = sources.filter((source) => ["retrieved_official", "captured_official_excerpt"].includes(source.provenance) && matchesAnnouncement(premise, source));
  if (!official.length) return { claims, evidence };
  const reference = referenceDay(asOf, plan.horizon.timezone);
  const dated = official.filter((source) => source.publicationDatePrecision === "day" && /^\d{4}-\d{2}-\d{2}$/.test(source.publicationDate ?? "") && /\btoday\s+announced\b/i.test(source.cleanedText.slice(0, 1400)));
  const dates = new Set(dated.map((source) => source.publicationDate));
  const source = dated[0] ?? official[0];
  const eventDate = source.publicationDate;
  const days = eventDate ? (Date.parse(reference.date) - Date.parse(eventDate)) / 86_400_000 : NaN;
  const contradicted = dates.size === 1 && Number.isFinite(days) && days > 1;
  // Never turn calendar-day equality into an affirmative full-claim verdict, but withdraw an
  // unsupported model recirculation verdict for the matching same-day premise.
  if (dates.size === 1 && days === 0 && !claims.some((claim) => claim.status === "contradicted" && /\btoday\b/i.test(claim.exactText) && matchesAnnouncement(claim.exactText, source))) return { claims, evidence };
  const announcementIndex = source.cleanedText.search(/\btoday\s+announced\b/i);
  const validation: ClaimAssessment = {
    claimId: "date-check-announcement", exactText: premise, distinction: "factual", materiality: "material",
    status: contradicted ? "contradicted" : "insufficient",
    explanation: contradicted
      ? `This matching official release explicitly says "today announced" and is dated ${eventDate}. The announcement in this source predates the report's reference day, ${reference.date} (${reference.timezone}). This does not establish whether there was a separate update today or whether news is priced in.`
      : `The matching source does not unambiguously establish the announcement date relative to ${reference.date} (${reference.timezone}). Publication date alone, conflicting dates, or adjacent calendar days are not enough to contradict "today".`,
    citations: [quote(source, Math.max(0, announcementIndex - 80))],
    missingEvidence: contradicted ? "A separately dated official release identifying a new announcement or substantive update on the reference day." : "An official release explicitly dating this same announcement, with a time zone where the calendar day is ambiguous.",
    validation: { rule: EVIDENCE_VALIDATION_VERSION, referenceDay: reference.date, timezone: reference.timezone },
  };
  const retained = claims.filter((claim) => claim.claimId !== validation.claimId && !(claim.distinction === "factual" && /\bannounc\w*\b/i.test(claim.exactText) && /\btoday\b/i.test(claim.exactText) && matchesAnnouncement(claim.exactText, source)));
  const updated = [validation, ...retained].slice(0, 6);
  return { claims: updated, evidence: summarizeClaims(updated, evidence.status === "assessed" ? evidence.assessmentOrigin : "deterministic_validation") };
}
