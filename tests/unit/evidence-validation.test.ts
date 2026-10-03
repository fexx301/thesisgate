import { describe, expect, it } from "vitest";
import captured from "../../fixtures/captured-context.json";
import { validateAnnouncementDates } from "../../src/domain/evidence-validation";
import type { Plan, SourceDocument, ClaimAssessment } from "../../src/domain/contracts";
import { unavailableEvidence } from "../../src/server/model";
import { multiSourceClaimPrompt } from "../../src/domain/claim-prompt";

const article = Object.values(captured.articles)[0];
const source: SourceDocument = {
  id: "src_official", originalUrl: Object.keys(captured.articles)[0], finalApprovedUrl: Object.keys(captured.articles)[0],
  title: article.title, publisher: article.publisher, publicationDate: article.publicationDate,
  publicationDatePrecision: "day", eventDate: null, fetchedAt: article.retrievedAt, cleanedText: article.text,
  textHash: "testhash123", provenance: "captured_official_excerpt", truncated: false,
};
const plan = { thesis: "NVIDIA and AWS announced 2 million more GPUs today, so rNVDA rises tomorrow.", horizon: { timezone: null } } as Plan;
const asOf = new Date(captured.capturedAtUTC);
const run = (s = source, p = plan, claims: ClaimAssessment[] = [], date = asOf) => validateAnnouncementDates(p, [s], claims, unavailableEvidence("Model unavailable"), date);

describe("shared announcement date validation", () => {
  it("recovers the omitted NVIDIA contradiction with exact citations and replay date even without a model", () => {
    const result = run();
    expect(result.claims[0]).toMatchObject({ status: "contradicted", distinction: "factual", validation: { referenceDay: "2026-09-08", timezone: "UTC" } });
    expect(result.claims[0].explanation).toContain("2026-08-26");
    expect(result.evidence.assessmentOrigin).toBe("deterministic_validation");
    expect(result.claims[0].exactText).not.toContain("rises tomorrow");
    for (const cite of result.claims[0].citations) expect(source.cleanedText.slice(cite.startOffset, cite.endOffset)).toBe(cite.excerpt);
  });
  it.each(["supported", "insufficient", "contradicted"] as const)("is consistent when a model labels the same premise %s", (status) => {
    const claim = { claimId: "model", exactText: plan.thesis.split(",")[0], distinction: "factual", materiality: "material", status, explanation: "Varies", citations: [], missingEvidence: null } as ClaimAssessment;
    const result = run(source, plan, [claim]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].status).toBe("contradicted");
  });
  it("does not infer an event date from publication date alone", () => {
    expect(run({ ...source, cleanedText: source.cleanedText.replace("today announced", "described") }).claims[0].status).toBe("insufficient");
  });
  it("does not match a different quantity or counterparty", () => {
    expect(run(source, { ...plan, thesis: plan.thesis.replace("2 million", "3 million") }).claims).toEqual([]);
    expect(run(source, { ...plan, thesis: plan.thesis.replace("AWS", "Microsoft") }).claims).toEqual([]);
    expect(run(source, { ...plan, thesis: plan.thesis.replace("GPUs", "CPUs") }).claims).toEqual([]);
    expect(run(source, { ...plan, thesis: plan.thesis.replace("GPUs", "AI factories") }).claims).toEqual([]);
  });
  it.each(["user_pasted_unverified", "retrieved_feed_summary", "synthetic_test"] as const)("does not authenticate %s", (provenance) => {
    expect(run({ ...source, provenance }).claims).toEqual([]);
  });
  it("leaves negation, reading-today and forecasts alone", () => {
    for (const thesis of ["NVIDIA and AWS did not announce 2 million GPUs today", "Today I read that NVIDIA and AWS announced 2 million GPUs", "NVIDIA and AWS might announce 2 million GPUs today"]) {
      expect(run(source, { ...plan, thesis }).claims).toEqual([]);
    }
  });
  it("does not contradict a same-day announcement and keeps adjacent-day ambiguity insufficient", () => {
    expect(run(source, plan, [], new Date("2026-08-26T21:00:00Z")).claims).toEqual([]);
    expect(run(source, plan, [], new Date("2026-08-27T00:10:00Z")).claims[0].status).toBe("insufficient");
  });
  it("uses the explicit reference timezone", () => {
    const result = run(source, { ...plan, horizon: { ...plan.horizon, timezone: "America/New_York" } }, [], new Date("2026-08-28T00:10:00Z"));
    expect(result.claims[0]).toMatchObject({ status: "insufficient", validation: { referenceDay: "2026-08-27" } });
    const prompt = multiSourceClaimPrompt({ ...plan, horizon: { ...plan.horizon, timezone: "America/New_York" } }, [source], new Date("2026-08-28T00:10:00Z"));
    expect(prompt).toContain("2026-08-27 (America/New_York)");
  });

  it("withdraws a false same-day recirculation verdict without asserting full support", () => {
    const claim = { claimId: "model", exactText: plan.thesis.split(",")[0], distinction: "factual", materiality: "material", status: "contradicted", explanation: "Old news", citations: [], missingEvidence: null } as ClaimAssessment;
    expect(run(source, plan, [claim], new Date("2026-08-26T21:00:00Z")).claims[0].status).toBe("insufficient");
  });
});
