import type { ResearchResult } from "./contracts";
import Decimal from "decimal.js";
import { POST_BRIEF_SUGGESTIONS } from "./suggestions";

type Claim = ResearchResult["claims"][number];

/**
 * The four answers the top of a brief leads with. Derived deterministically from the claim review and the
 * trade math already in the report (no extra model call), and kept separate: the first two and the last are
 * about evidence, the third is about economics.
 */
export type BriefFindings = {
  /** What the selected sources correct in the trader's thesis. */
  correction:
    | { kind: "contradicted"; claim: string; explanation: string; sourceId: string | null }
    | { kind: "none_contradicted"; checked: number }
    | { kind: "not_checked"; reason: string };
  /** The link between the news and the expected price move that no source establishes. */
  assumption: { claim: string; detail: string } | null;
  /** One specific thing to investigate or change next; `about` names the claim it would settle. */
  nextCheck: { kind: "evidence" | "scenario"; text: string; about: string | null };
};

const RANK = { material: 0, contextual: 1 } as const;
const byMateriality = (a: Claim, b: Claim) => RANK[a.materiality] - RANK[b.materiality];

/** Name the missing evidence, rather than asking the trader to verify the same premise again. */
function nextEvidence(claim: Claim, supplied: string | null): string | null {
  if (claim.validation?.referenceDay && claim.status === "contradicted") {
    return `Look for a separate official release or substantive update dated ${claim.validation.referenceDay}.`;
  }
  const generic = !supplied || /(?:directly (?:addressing|establishing|resolving)|directly (?:address|establish|resolve)|evidence (?:supporting|establishing) (?:this|the) claim|whether the claim)/i.test(supplied);
  if (!generic) return supplied;
  const text = claim.exactText;
  if (/\b(?:deal|contract|customer|deployment|partnership|product|gpu|aws)\b/i.test(text) && /\brevenue\b/i.test(text)) {
    return "Find a filing passage attributing realized revenue to this specific deal or deployment.";
  }
  if (/\bannounc\w*\b/i.test(text)) return "Look for a separately dated official announcement or substantive update.";
  if (/\b(?:earnings|results)\b/i.test(text)) return "Find the dated earnings release or filing that establishes the report date.";
  if (/\banalysts?\b|\btargets?\b/i.test(text)) return "Find the named analyst firm’s dated revision, including its previous and new targets.";
  if (/\brevenue\b/i.test(text)) return "Check the filed revenue amount and the exact reporting period in the company’s SEC records.";
  if (/\b(?:filed|filing|8-k|10-q|10-k)\b/i.test(text)) return "Find the dated filing and the passage that addresses this premise.";
  return supplied ? "Find an independent dated source that directly establishes this factual premise." : null;
}

export function briefFindings(report: Pick<ResearchResult, "claims" | "evidence" | "economics" | "investigation">): BriefFindings {
  const claims = report.claims;
  const checked = report.evidence.status === "assessed" && claims.length > 0;

  // 1. The most consequential correction: a contradicted factual premise first, material before contextual.
  const contradicted = claims
    .filter((claim) => claim.status === "contradicted")
    .sort((a, b) => byMateriality(a, b) || (a.distinction === "factual" ? -1 : 0) - (b.distinction === "factual" ? -1 : 0));
  const top = contradicted[0];
  const correction: BriefFindings["correction"] = top
    ? { kind: "contradicted", claim: top.exactText, explanation: top.explanation, sourceId: top.citations[0]?.sourceId ?? null }
    : checked
      ? { kind: "none_contradicted", checked: claims.length }
      : { kind: "not_checked", reason: report.evidence.status === "assessed" ? "No claims were extracted from the thesis." : report.evidence.summary };

  // 2. The unproven link to the price: a material forecast, then causal, claim that no source supports.
  const link = claims
    .filter((claim) => claim.status === "insufficient" && (claim.distinction === "forecast" || claim.distinction === "causal"))
    .sort((a, b) => byMateriality(a, b) || (a.distinction === "forecast" ? -1 : 0) - (b.distinction === "forecast" ? -1 : 0))[0];
  const assumption = link
    ? { claim: link.exactText, detail: "No selected source establishes this; it is your assumption, and the trade math treats it as one." }
    : report.evidence.assessmentOrigin === "deterministic_validation"
      ? { claim: "The rest of this thesis has not been assessed.", detail: "Only the narrow announcement-date check ran. Price and causal assumptions still need review." }
    : report.evidence.mostConsequentialUnknown
      ? { claim: report.evidence.mostConsequentialUnknown, detail: "The most consequential unknown the claim review found." }
      : null;

  // 3. Next check: a checkable factual gap or the contradicted premise; otherwise a scenario that tests the math.
  const factualGap = claims
    .filter((claim) => claim.distinction === "factual" && claim.status === "insufficient" && claim.missingEvidence)
    .sort(byMateriality)[0];
  // Always name the claim a question would settle: a model's "missing evidence" line can be generic on its own.
  const target = factualGap ?? (top?.missingEvidence ? top : null);
  // The review's "most consequential unknown" is not used here: it is almost always the price forecast, which
  // the assumption cell already shows, and a forecast is not a fact anyone can go and check.
  const investigation = report.investigation;
  const investigatedClaim = investigation?.claimId ? claims.find((claim) => claim.claimId === investigation.claimId && claim.distinction === "factual") : null;
  // Replay/no-lookup states add no new question. A genuine unresolved factual gap takes priority.
  const openInvestigation = investigatedClaim && investigation?.nextFact && ["insufficient", "no_relevant_evidence", "lookup_failed", "assessment_unavailable"].includes(investigation.status);
  const nextTarget = factualGap ?? (openInvestigation ? investigatedClaim : target);
  const evidenceStep = nextTarget ? nextEvidence(nextTarget, openInvestigation && nextTarget === investigatedClaim ? investigation!.nextFact : nextTarget.missingEvidence) : null;
  const nextCheck: BriefFindings["nextCheck"] = evidenceStep
    ? { kind: "evidence", text: evidenceStep, about: nextTarget!.exactText }
    : !checked
        ? { kind: "evidence", text: "Select a dated headline or paste the source so each part of the thesis can be checked.", about: null }
        : { kind: "scenario", text: `Stress the trade math: "${report.economics.requiredGoalShift !== null ? POST_BRIEF_SUGGESTIONS.halveDepth : POST_BRIEF_SUGGESTIONS.halveAmount}"`, about: null };

  return { correction, assumption, nextCheck };
}

/** Shared by the UI and Markdown so the headline always states a requirement, even with a scenario. */
export function tradeRequirement(report: Pick<ResearchResult, "economics" | "confirmedPlan">) {
  const { economics: e, confirmedPlan: plan } = report;
  const percent = (value: string) => `${new Decimal(value).gte(0) ? "+" : ""}${new Decimal(value).mul(100).toFixed(2)}%`;
  const reference = plan.side === "short" ? "buy-back asks" : "exit bids";
  const headline = e.requiredGoalShift !== null ? `Goal needs ${percent(e.requiredGoalShift)}` : e.breakEvenShift !== null ? `Break-even needs ${percent(e.breakEvenShift)}` : "Trade math unavailable";
  const detail = e.breakEvenShift === null ? e.warnings.at(-1) ?? "The order book did not support a calculation." : `On ${reference} under the fee and depth assumptions; break-even ${percent(e.breakEvenShift)}. This is a required move, not a forecast.`;
  const scenario = e.netPnl === null ? null : `Selected scenario: ${new Decimal(e.netPnl).toFixed(2)} USDT net · ${e.goalComparison.replaceAll("_", " ")} · under your assumptions.`;
  return { headline, detail, scenario };
}
