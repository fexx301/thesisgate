import type { Asset, ClaimAssessment } from "./contracts";

export type InvestigationSource = "earnings" | "analysts" | "revenue" | "filings" | "newsroom";
export function sourceForClaim(claim: ClaimAssessment, asset: Asset): InvestigationSource | null {
  if (claim.distinction !== "factual" || claim.materiality !== "material" || claim.status === "supported" || claim.validation) return null;
  const text = claim.exactText;
  // A model mislabelling a forecast must not route it into factual investigation.
  if (/\b(?:will|would|could|might|should)\b|\b(?:price|token)\b.{0,30}\b(?:rise|fall|rally|bounce)\b/i.test(text)) return null;
  if (/\banalysts?\b|\bprice targets?\b|\b(?:raised|cut|lowered)\b.{0,30}\btargets?\b/i.test(text)) return "analysts";
  if (/\b(?:earnings|results)\b/i.test(text) && /\b(?:reported|released|today|yesterday|date|scheduled)\b/i.test(text)) return "earnings";
  if (/\brevenue\b/i.test(text)) return "revenue";
  if (/\b(?:filed|filing|8-k|10-q|10-k|edgar)\b/i.test(text)) return "filings";
  if (asset === "NVDA" && /\bannounc\w*\b/i.test(text)) return "newsroom";
  return null;
}

export function selectInvestigationClaim(claims: ClaimAssessment[], asset: Asset) {
  // Materiality is mandatory. Preserve review order within each status; unresolved premises go first.
  const ordered = [...claims].sort((a, b) => Number(a.status !== "insufficient") - Number(b.status !== "insufficient"));
  for (const claim of ordered) {
    const source = sourceForClaim(claim, asset);
    if (source) return { claim, source, reason: `This material factual premise is ${claim.status}; ${source} records can address it. Forecasts are left as assumptions.` };
  }
  return null;
}
