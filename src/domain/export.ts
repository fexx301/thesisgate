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

function costLabel(valueToFormat: string | null) {
  return valueToFormat === null ? "Not reported by provider" : `${new Decimal(valueToFormat).toFixed(6)} USD`;
}

function suppliedUrlDomain(valueToFormat: string | null) {
  if (!valueToFormat) return "Not supplied";
  try {
    return new URL(valueToFormat).hostname;
  } catch {
    return "Invalid supplied URL";
  }
}

export function toJson(report: ResearchResult) {
  const validated = ResearchResultSchema.parse(report);
  // Distributable JSON excludes the server-only recompute capability token.
  // Full cleanedText is retained as the canonical audit artifact; Markdown is the redistributable brief (excerpts only).
  const { recomputeToken: _recomputeToken, ...distributable } = validated;
  void _recomputeToken;
  return JSON.stringify(distributable, null, 2);
}

export function toMarkdown(report: ResearchResult) {
  const validated = ResearchResultSchema.parse(report);
  const plan = validated.confirmedPlan;
  const economics = validated.economics;
  const instrument = validated.instrument;
  const baseAsset = economics.units.baseAsset;
  const instrumentLines = instrument ? [
    `- Instrument symbol: ${instrument.symbol}`,
    `- Underlying asset: ${instrument.asset}`,
    `- Base / quote: ${instrument.baseCoin} / ${instrument.quoteCoin}`,
    `- Category: ${instrument.category}; type: ${instrument.symbolType}; Reality: ${instrument.isReality ? "yes" : "no"}`,
    `- Venue status: ${instrument.status}`,
    `- Quantity step: ${instrument.quantityStep} ${instrument.baseCoin}`,
    `- Price tick: ${instrument.priceTick} ${instrument.quoteCoin}`,
    `- Minimum order quantity: ${instrument.minOrderQty} ${instrument.baseCoin}`,
    `- Maximum order quantity: ${instrument.maxOrderQty} ${instrument.baseCoin} (zero means no configured cap)`,
    `- Minimum order notional: ${instrument.minOrderNotional} ${instrument.quoteCoin}`,
    `- Maximum position quantity: ${instrument.maxPositionQty} ${instrument.baseCoin} (zero means no configured cap)`,
    `- Instrument metadata time: ${instrument.rawMetadataTime}`,
  ].join("\n") : "- Instrument metadata: Not available; venue rules could not be validated.";
  const sourceLines = validated.sources.length
    ? validated.sources
        .map((source) => [
          `- ${source.title}`,
          `  - Supplied URL domain: ${suppliedUrlDomain(source.originalUrl)}`,
          `  - URL: ${source.originalUrl ?? "Not supplied"}`,
          `  - Provenance: ${source.provenance}`,
          `  - Publication date: ${source.publicationDate ?? "Unknown"}`,
          `  - Event date: ${source.eventDate ?? "Unknown"}`,
          `  - Text received: ${source.fetchedAt}`,
          `  - Text hash: ${source.textHash}`,
          `  - Truncated: ${source.truncated ? "yes" : "no"}`,
        ].join("\n"))
        .join("\n")
    : "- No source document was supplied.";
  const claimLines = validated.claims.length
    ? validated.claims
        .map((claim) => {
          const citations = claim.citations.length
            ? claim.citations.map((citation) => `> ${citation.excerpt}\n> — source ${citation.sourceId} @ ${citation.startOffset}–${citation.endOffset}`).join("\n")
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
    .map((row) => `| ${row.label} | ${percent(row.bidPriceShift)} | ${row.effectivePriceShift ? percent(row.effectivePriceShift) : "Not available"} | ${value(row.netPnl)} USDT | ${row.goalComparison} | ${row.status} |`)
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
    `Total duration: ${validated.performance.totalDurationMs} ms`,
    `Market duration: ${validated.performance.marketDurationMs === null ? "Not measured" : `${validated.performance.marketDurationMs} ms`}`,
    `Model duration: ${validated.performance.modelDurationMs === null ? "Not measured" : `${validated.performance.modelDurationMs} ms`}`,
    `Model calls: ${validated.performance.modelCalls}`,
    `Provider cost: ${costLabel(validated.performance.modelUsage?.costUsd ?? null)}`,
    `Evidence reused: ${validated.performance.reusedEvidence ? "yes" : "no"}`,
    "",
    "## Confirmed plan",
    "",
    `- Asset: ${plan.asset} SPOT long` ,
    `- Purchase notional excluding fee: ${plan.purchaseNotionalExcludingFee} USDT`,
    `- Horizon: ${plan.horizon.originalText || "Not supplied"}${plan.horizon.endAtUTC ? ` (ends ${plan.horizon.endAtUTC}${plan.horizon.timezone ? ` ${plan.horizon.timezone}` : ""})` : ""}`,
    `- Invalidation: ${plan.invalidation ?? "Not supplied — no stop-loss invented"}`,
    `- Goal: ${plan.goal ? JSON.stringify(plan.goal) : "Not requested"}`,
    `- Scenario: ${plan.scenario?.bidPriceShift ?? "Not supplied (threshold only)"} bid-price shift${plan.scenario ? ` (origin: ${plan.scenario.assumptionOrigin})` : ""}`,
    `- Fees: ${plan.feeIn} in, ${plan.feeOut} out (origin: ${plan.feeOrigin}; published standard is 0.001 each side)`,
    `- Exit depth multiplier: ${plan.exitAssumptions.depthMultiplier} (origin: ${plan.exitAssumptions.depthOrigin})`,
    `- Exit price haircut: ${plan.exitAssumptions.priceHaircut} (origin: ${plan.exitAssumptions.haircutOrigin})`,
    `- Thesis: ${plan.thesis || "Not supplied"}`,
    `- Evidence input hash: ${validated.evidenceInputHash}`,
    `- Economics input hash: ${validated.economicsInputHash ?? "Not available"}`,
    `- Snapshot hash: ${validated.snapshot?.hash ?? "Not available"}`,
    "",
    "## Instrument identity and venue rules",
    "",
    instrumentLines,
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
    `- Requested notional: ${value(economics.requestedNotional)} USDT`,
    `- Rounded quantity: ${value(economics.quantity)} ${baseAsset}`,
    `- Spent notional: ${value(economics.spentNotional)} USDT`,
    `- Unspent notional: ${value(economics.unspentNotional)} USDT`,
    `- Matched exit quantity: ${value(economics.matchedExitQuantity)} ${baseAsset}`,
    `- Unmatched exit quantity: ${value(economics.unmatchedExitQuantity)} ${baseAsset}`,
    `- Entry VWAP: ${value(economics.entryVWAP)} USDT`,
    `- Entry cash: ${value(economics.entryCash)} USDT`,
    `- Modeled exit VWAP: ${value(economics.modeledExitVWAP)} USDT`,
    `- Modeled exit gross: ${value(economics.modeledExitGross)} USDT`,
    `- Modeled exit net: ${value(economics.modeledExitNet)} USDT`,
    `- Selected scenario gross: ${value(economics.scenarioGross)} USDT`,
    `- Selected scenario net: ${value(economics.scenarioNet)} USDT`,
    `- Immediate friction proxy: ${value(economics.frictionProxy)} USDT`,
    `- Break-even bid-price shift: ${percent(economics.breakEvenShift)}`,
    `- Required goal shift: ${percent(economics.requiredGoalShift)} (pre-haircut scenario variable r; label consistently)`,
    `- Selected scenario PnL: ${value(economics.netPnl)} USDT`,
    `- Selected scenario return on entry cash: ${percent(economics.netReturn)}`,
    `- Effective stressed price shift: ${economics.effectivePriceShift ? percent(economics.effectivePriceShift) : "Not available"} (shown whenever haircut is nonzero)`,
    `- Visible entry capacity: ${economics.visibleEntryCapacity ? `${economics.visibleEntryCapacity} USDT` : "Not available"}`,
    `- Visible exit capacity: ${economics.visibleExitCapacity ? `${economics.visibleExitCapacity} USDT (stressed)` : "Not available"}`,
    "",
    "### Calculator warnings",
    "",
    ...(economics.warnings.length ? economics.warnings.map((warning) => `- ${warning}`) : ["- None"]),
    "",
    "### Scenario comparison",
    "",
    "| Scenario | Bid-price shift | Effective shift | Net PnL | Goal comparison | Status |",
    "| --- | ---: | ---: | ---: | --- | --- |",
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
    `- Evidence condition: ${validated.claims.length ? `a validated passage addressing "${validated.claims[0].exactText.slice(0, 120)}" (currently ${validated.claims[0].status}) could change the ${validated.evidence.verdict} verdict` : "a validated source passage confirming or contradicting the exact causal or forecast claim could change the verdict"}.`,
    `- Numerical condition: ${validated.economics.requiredGoalShift ? `a snapshot where the required ${percent(validated.economics.requiredGoalShift)} bid shift is met, or exit depth above ${validated.economics.exitDepthMultiplier} of snapshot ${validated.economics.snapshotId ?? "unknown"}, could change the ${validated.economics.goalComparison} outcome` : "a new order-book snapshot or a different explicit exit-depth assumption could change the threshold"}. These are conditions to investigate, not promises that a limit order will fill or a stop will bound loss.`,
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
