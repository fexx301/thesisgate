import Decimal from "decimal.js";
import { ResearchResultSchema, type ResearchResult } from "./contracts";

function value(value: string | null) {
  return value ?? "Not available";
}

function percent(valueToFormat: string | null) {
  if (valueToFormat === null) return "Not available";
  return `${new Decimal(valueToFormat).mul(100).toFixed(4)}%`;
}

function statusLabel(valueToFormat: string) {
  return valueToFormat.replaceAll("_", " ");
}

export function toJson(report: ResearchResult) {
  const validated = ResearchResultSchema.parse(report);
  return JSON.stringify(validated, null, 2);
}

export function toMarkdown(report: ResearchResult) {
  const validated = ResearchResultSchema.parse(report);
  const plan = validated.confirmedPlan;
  const economics = validated.economics;
  const sourceLines = validated.sources.length
    ? validated.sources
        .map((source) => [
          `- ${source.title}`,
          `  - Publisher: ${source.publisher}`,
          `  - URL: ${source.originalUrl ?? "Not supplied"}`,
          `  - Provenance: ${source.provenance}`,
          `  - Publication date: ${source.publicationDate ?? "Unknown"}`,
          `  - Text hash: ${source.textHash}`,
          `  - Truncated: ${source.truncated ? "yes" : "no"}`,
        ].join("\n"))
        .join("\n")
    : "- No source document was supplied.";
  const claimLines = validated.claims.length
    ? validated.claims
        .map((claim) => {
          const citations = claim.citations.length
            ? claim.citations.map((citation) => `> ${citation.excerpt}`).join("\n")
            : "> No validated citation";
          return [
            `### ${claim.claimId}: ${claim.status}`,
            `- Claim: ${claim.exactText}`,
            `- Distinction: ${claim.distinction}`,
            `- Materiality: ${claim.materiality}`,
            `- Explanation: ${claim.explanation}`,
            `- Missing evidence: ${claim.missingEvidence ?? "None recorded"}`,
            citations,
          ].join("\n");
        })
        .join("\n\n")
    : "No runtime claim assessments were recorded.";
  const scenarioLines = economics.scenarioTable
    .map((row) => `| ${row.label} | ${percent(row.bidPriceShift)} | ${value(row.netPnl)} USDT | ${row.goalComparison} |`)
    .join("\n");

  return [
    `# ThesisGate research brief`,
    "",
    `Report: ${validated.reportId}`,
    `Revision: ${validated.reportRevision}`,
    `Generated: ${validated.generatedAt}`,
    `Formula version: ${validated.formulaVersion}`,
    `Schema version: ${validated.schemaVersion}`,
    `Prompt version: ${validated.promptVersion}`,
    `Model: ${validated.modelId ?? "Not configured"}`,
    "",
    "## Confirmed plan",
    "",
    `- Asset: ${plan.asset} SPOT long` ,
    `- Purchase notional excluding fee: ${plan.purchaseNotionalExcludingFee} USDT`,
    `- Horizon: ${plan.horizon.originalText || "Not supplied"}`,
    `- Goal: ${plan.goal ? JSON.stringify(plan.goal) : "Not requested"}`,
    `- Scenario: ${plan.scenario?.bidPriceShift ?? "Not supplied"} bid-price shift`,
    `- Fees: ${plan.feeIn} in, ${plan.feeOut} out`,
    `- Exit depth multiplier: ${plan.exitAssumptions.depthMultiplier}`,
    `- Exit price haircut: ${plan.exitAssumptions.priceHaircut}`,
    `- Thesis: ${plan.thesis || "Not supplied"}`,
    "",
    "## Evidence behind the thesis",
    "",
    `- Status: ${statusLabel(validated.evidence.status)}`,
    `- Verdict: ${statusLabel(validated.evidence.verdict)}`,
    `- Scope: ${validated.evidence.scope}`,
    `- Summary: ${validated.evidence.summary}`,
    `- Most consequential unknown: ${validated.evidence.mostConsequentialUnknown ?? "None recorded"}`,
    "",
    claimLines,
    "",
    "## Economics under the assumptions",
    "",
    `- Computation status: ${statusLabel(economics.computationStatus)}`,
    `- Goal comparison: ${economics.goalComparison}`,
    `- Snapshot: ${economics.snapshotId ?? "Not available"}`,
    `- Entry VWAP: ${value(economics.entryVWAP)} USDT`,
    `- Entry cash: ${value(economics.entryCash)} USDT`,
    `- Modeled exit VWAP: ${value(economics.modeledExitVWAP)} USDT`,
    `- Immediate friction proxy: ${value(economics.frictionProxy)} USDT`,
    `- Break-even bid-price shift: ${percent(economics.breakEvenShift)}`,
    `- Required goal shift: ${percent(economics.requiredGoalShift)}`,
    `- Selected scenario PnL: ${value(economics.netPnl)} USDT`,
    `- Selected scenario return on entry cash: ${percent(economics.netReturn)}`,
    "",
    "### Scenario comparison",
    "",
    "| Scenario | Bid-price shift | Net PnL | Goal comparison |",
    "| --- | ---: | ---: | --- |",
    scenarioLines,
    "",
    `- Snapshot mode: ${validated.snapshot?.mode ?? "Not available"}`,
    `- Exchange timestamp: ${validated.snapshot?.exchangeTimestamp ?? "Not available"}`,
    `- Received timestamp: ${validated.snapshot?.receivedAt ?? "Not available"}`,
    "",
    "## Sources and dates",
    "",
    sourceLines,
    "",
    "## What could change this assessment",
    "",
    "- Evidence condition: a validated source passage could confirm or contradict the exact causal or forecast claim.",
    "- Numerical condition: a new order-book snapshot or a different explicit exit-depth assumption could change the threshold.",
    "",
    "## Limitations",
    "",
    ...validated.limitations.map((limitation) => `- ${limitation}`),
    "",
    "## Partial outcomes",
    "",
    validated.partialErrors.length
      ? validated.partialErrors.map((item) => `- ${item.kind}: ${item.message} Recovery: ${item.recovery}`).join("\n")
      : "- None",
    "",
  ].join("\n");
}
