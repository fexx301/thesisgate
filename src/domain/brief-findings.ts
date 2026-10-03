import type { ResearchResult } from "./contracts";
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

export function briefFindings(report: Pick<ResearchResult, "claims" | "evidence" | "economics">): BriefFindings {
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
  const nextCheck: BriefFindings["nextCheck"] = target?.missingEvidence
    ? { kind: "evidence", text: target.missingEvidence, about: target.exactText }
    : !checked
        ? { kind: "evidence", text: "Select a dated headline or paste the source so each part of the thesis can be checked.", about: null }
        : { kind: "scenario", text: `Stress the trade math: "${report.economics.requiredGoalShift !== null ? POST_BRIEF_SUGGESTIONS.halveDepth : POST_BRIEF_SUGGESTIONS.halveAmount}"`, about: null };

  return { correction, assumption, nextCheck };
}
