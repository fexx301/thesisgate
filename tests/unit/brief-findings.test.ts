import { describe, expect, it } from "vitest";
import { briefFindings } from "../../src/domain/brief-findings";
import type { ResearchResult } from "../../src/domain/contracts";

type Claim = ResearchResult["claims"][number];
const claim = (overrides: Partial<Claim>): Claim => ({
  claimId: "c", exactText: "x", distinction: "factual", materiality: "material", status: "supported",
  explanation: "e", citations: [], missingEvidence: null, ...overrides,
});
const evidence = (overrides: Partial<ResearchResult["evidence"]> = {}): ResearchResult["evidence"] => ({
  status: "assessed", assessmentOrigin: "runtime_model", verdict: "mixed", scope: "by the supplied evidence",
  mostConsequentialUnknown: null, summary: "s", ...overrides,
});
const economics = (requiredGoalShift: string | null) => ({ requiredGoalShift } as ResearchResult["economics"]);

describe("brief findings (top of the brief)", () => {
  it("leads the NVIDIA example with the dated correction and keeps the price move as an assumption", () => {
    const findings = briefFindings({
      claims: [
        claim({ claimId: "1", exactText: "NVIDIA and AWS announced 2 million more GPUs today", status: "contradicted", explanation: "The release is dated August 26, not today.", citations: [{ sourceId: "src_nvidia_0826", excerpt: "August 26", startOffset: 0, endOffset: 9 }] }),
        claim({ claimId: "2", exactText: "Deployment is planned for 2027 to 2028", status: "supported" }),
        claim({ claimId: "3", exactText: "rNVDA rises before tomorrow's open", distinction: "forecast", status: "insufficient", missingEvidence: "A price outcome cannot be sourced." }),
      ],
      evidence: evidence({ mostConsequentialUnknown: "Whether any deployment produces revenue before 2027." }),
      economics: economics("0.0138"),
    });
    expect(findings.correction).toMatchObject({ kind: "contradicted", claim: "NVIDIA and AWS announced 2 million more GPUs today", sourceId: "src_nvidia_0826" });
    expect(findings.assumption?.claim).toBe("rNVDA rises before tomorrow's open");
    // Neither the forecast nor the review's unknown (a restated forecast) is a checkable fact, so the next step
    // is a trade-math stress rather than a duplicate of the assumption cell.
    expect(findings.nextCheck.kind).toBe("scenario");
    // When the contradicted premise says what would settle it, that becomes the next check, naming the claim.
    const withMissing = briefFindings({
      claims: [claim({ exactText: "announced today", status: "contradicted", missingEvidence: "A source dated 2026-09-08 announcing it." })],
      evidence: evidence(), economics: economics("0.0138"),
    });
    expect(withMissing.nextCheck).toEqual({ kind: "evidence", text: "A source dated 2026-09-08 announcing it.", about: "announced today" });
  });

  it("prefers a checkable factual gap as the next check, and a material contradiction over a contextual one", () => {
    const findings = briefFindings({
      claims: [
        claim({ claimId: "a", exactText: "contextual aside", materiality: "contextual", status: "contradicted" }),
        claim({ claimId: "b", exactText: "earnings were reported today", status: "contradicted" }),
        claim({ claimId: "c", exactText: "analysts raised targets", status: "insufficient", missingEvidence: "A dated analyst action raising the target." }),
      ],
      evidence: evidence(),
      economics: economics(null),
    });
    expect(findings.correction).toMatchObject({ kind: "contradicted", claim: "earnings were reported today" });
    expect(findings.nextCheck).toEqual({ kind: "evidence", text: "A dated analyst action raising the target.", about: "analysts raised targets" });
  });

  it("says plainly when nothing was checked, without inventing an assumption", () => {
    const findings = briefFindings({ claims: [], evidence: evidence({ status: "unavailable", verdict: "not_assessed", summary: "The claim model is disabled." }), economics: economics("0.01") });
    expect(findings.correction).toEqual({ kind: "not_checked", reason: "The claim model is disabled." });
    expect(findings.assumption).toBeNull();
    expect(findings.nextCheck.kind).toBe("evidence");
  });

  it("falls back to a trade-math scenario when the evidence leaves no open question", () => {
    const findings = briefFindings({ claims: [claim({ status: "supported" })], evidence: evidence({ verdict: "supported" }), economics: economics("0.02") });
    expect(findings.correction).toEqual({ kind: "none_contradicted", checked: 1 });
    expect(findings.nextCheck.kind).toBe("scenario");
    expect(findings.nextCheck.text).toContain("exit liquidity halves");
  });

  it("asks for a separately dated update instead of repeating an already-corrected announcement in replay", () => {
    const corrected = claim({ claimId: "date-check", exactText: "NVIDIA and AWS announced 2 million GPUs today", status: "contradicted", missingEvidence: "A separate official release on the reference day.", validation: { rule: "evidence-rules-v1", referenceDay: "2026-09-08", timezone: "UTC" } });
    const duplicate = claim({ claimId: "model-date", exactText: "AWS and NVIDIA announced the GPU plan today, September 8, 2026", status: "contradicted", missingEvidence: null });
    const result = briefFindings({ claims: [corrected, duplicate], evidence: evidence(), economics: economics("0.0143"), investigation: { status: "captured_only", claimId: duplicate.claimId, claim: duplicate.exactText, nextFact: `A dated record directly addressing: ${duplicate.exactText}` } as ResearchResult["investigation"] });
    expect(result.nextCheck.text).toBe("Look for a separate official release or substantive update dated 2026-09-08.");
    expect(result.nextCheck.text).not.toContain(duplicate.exactText);
  });

  it("turns a generic failed revenue lookup into the specific attribution evidence needed", () => {
    const gap = claim({ claimId: "revenue", exactText: "The AWS deployment already generated revenue", status: "insufficient", missingEvidence: "A dated record directly addressing this claim" });
    const result = briefFindings({ claims: [gap], evidence: evidence(), economics: economics("0.01"), investigation: { status: "lookup_failed", claimId: gap.claimId, claim: gap.exactText, nextFact: `A dated record directly addressing: ${gap.exactText}` } as ResearchResult["investigation"] });
    expect(result.nextCheck.text).toBe("Find a filing passage attributing realized revenue to this specific deal or deployment.");
    expect(result.nextCheck.about).toBe(gap.exactText);
  });
});
