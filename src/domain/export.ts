import Decimal from "decimal.js";
import { ResearchResultSchema, type ResearchResult } from "./contracts";
import { pricedInView } from "./priced-in";

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
  const openClaim = validated.claims.find((claim) => claim.materiality === "material" && claim.status !== "supported")
    ?? validated.claims.find((claim) => claim.status !== "supported");
  const context = validated.marketContext;
  const view = pricedInView(context, economics);
  const level = (item: { level: string; vsClose: string | null } | null) => item
    ? `${new Decimal(item.level).toFixed(4)} USDT top bid (${item.vsClose ? `${percent(item.vsClose)} vs close` : "close unavailable"})`
    : "Not available";
  const contextLines = context ? [
    `- Data mode: ${context.mode}; observed at ${context.observedAt}`,
    `- US session: ${context.session.label} (${context.session.state})${context.session.nextRegularOpenAt ? `; next regular open ${context.session.nextRegularOpenAt}` : ""}`,
    `- Underlying last close: ${context.underlying ? `${context.underlying.symbol} ${context.underlying.lastClose} USD on ${context.underlying.lastCloseSessionDate} (${context.underlying.lastCloseAt}; source ${context.underlying.source})` : "Not available"}`,
    `- Underlying latest print: ${context.underlying?.latestPrice ? `${context.underlying.latestPrice} USD at ${context.underlying.latestAt}` : "Not available"}`,
    `- rToken book: ${context.rToken ? `bid ${context.rToken.bestBid} / ask ${context.rToken.bestAsk} / mid ${context.rToken.mid} USDT at ${context.rToken.at}` : "Not available"}`,
    `- rToken move since the underlying close: ${percent(context.moveSinceClose)}`,
    `- rToken versus latest underlying print: ${context.basisVsLatest === null ? "Not claimed (no fresh underlying print)" : percent(context.basisVsLatest)}`,
    `- Break-even level: ${level(view.breakEven)}`,
    `- Goal level: ${level(view.goal)}`,
    `- Scenario level: ${level(view.scenario)}`,
    `- Share of the goal's move from the close already made: ${view.shareOfGoalAlreadyMoved === null ? "Not applicable" : percent(view.shareOfGoalAlreadyMoved)}`,
    "- Levels are the best bid moved by the whole-book threshold: an indicator, not a fill price. One rToken is assumed to track one underlying share.",
    ...context.warnings.map((warning) => `- Warning: ${warning}`),
  ].join("\n") : "- Market context was not recorded for this report.";
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
    "## Priced in since the close?",
    "",
    contextLines,
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
    `Selected radar headlines: ${validated.headlineIds.length ? validated.headlineIds.join(", ") : "None"}`,
    "",
    sourceLines,
    "",
    "## What would change this",
    "",
    `- Evidence to look for: ${openClaim ? `${openClaim.missingEvidence ?? `a source that directly establishes "${openClaim.exactText.slice(0, 160)}"`} (claim currently ${openClaim.status})` : validated.claims.length ? `every assessed claim is supported; a dated source contradicting "${validated.claims[0].exactText.slice(0, 140)}" would change that` : "select a headline or paste a source so the claims can be checked"}.`,
    `- Price levels that matter: ${economics.requiredGoalShift ? `the goal needs a ${percent(economics.requiredGoalShift)} bid-book shift (${level(view.goal)}); break-even needs ${percent(economics.breakEvenShift)}` : economics.breakEvenShift ? `break-even needs a ${percent(economics.breakEvenShift)} bid-book shift` : "a usable order-book snapshot is needed before thresholds can be calculated"}. Thinner exit liquidity raises both. These are conditions to investigate, not promises that a limit order will fill or a stop will bound loss.`,
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
