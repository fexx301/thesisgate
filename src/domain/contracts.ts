import Decimal from "decimal.js";
import { z } from "zod";

// Declared before the schemas that use it; module constants are evaluated in order.
const MAX_SELECTED_HEADLINES_LIMIT = 4;

const DECIMAL_PATTERN = /^-?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i;

function isFiniteDecimal(value: string) {
  if (!DECIMAL_PATTERN.test(value.trim())) return false;
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}

// Zod refinements continue after earlier failures, so every Decimal construction in a
// refinement must tolerate syntactically invalid text instead of throwing during parse.
function checkedDecimal(value: string) {
  try {
    return new Decimal(value);
  } catch {
    return null;
  }
}

export const DecimalStringSchema = z
  .string()
  .trim()
  .regex(DECIMAL_PATTERN, "Enter a decimal number")
  .refine(isFiniteDecimal, "Enter a finite decimal number");

export const NonNegativeDecimalStringSchema = DecimalStringSchema.refine(
  (value) => checkedDecimal(value)?.gte(0) === true,
  "Enter zero or a positive number",
);

export const PositiveDecimalStringSchema = DecimalStringSchema.refine(
  (value) => checkedDecimal(value)?.gt(0) === true,
  "Enter a number greater than zero",
);

const BoundedFractionSchema = NonNegativeDecimalStringSchema.refine(
  (value) => checkedDecimal(value)?.lt(1) === true,
  "Enter a fraction below 1",
);

export const AssetSchema = z.enum(["NVDA", "TSLA"]);
export const EvidenceModeSchema = z.enum(["live", "captured_real", "synthetic"]);
export const CategorySchema = z.literal("SPOT");

export const GoalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("break_even") }).strict(),
  z
    .object({
      kind: z.literal("profit_usdt"),
      amount: NonNegativeDecimalStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("net_return"),
      fractionOfEntryCash: NonNegativeDecimalStringSchema,
    })
    .strict(),
]);

export const ExitAssumptionsSchema = z
  .object({
    depthMultiplier: NonNegativeDecimalStringSchema,
    priceHaircut: NonNegativeDecimalStringSchema,
    depthOrigin: z.enum(["user", "illustrative_preset"]),
    haircutOrigin: z.enum(["user", "illustrative_preset"]),
  })
  .strict()
  .superRefine((value, context) => {
    const depth = checkedDecimal(value.depthMultiplier);
    const haircut = checkedDecimal(value.priceHaircut);
    if (depth !== null && depth.gt(1)) {
      context.addIssue({ code: "custom", path: ["depthMultiplier"], message: "Depth must be between 0 and 1" });
    }
    if (haircut !== null && haircut.gte(1)) {
      context.addIssue({ code: "custom", path: ["priceHaircut"], message: "Haircut must be below 1" });
    }
  });

export const PriceScenarioSchema = z
  .object({
    bidPriceShift: DecimalStringSchema,
    assumptionOrigin: z.enum(["user", "illustrative_preset"]),
  })
  .strict()
  .superRefine((value, context) => {
    const shift = checkedDecimal(value.bidPriceShift);
    if (shift !== null && shift.lte(-1)) {
      context.addIssue({ code: "custom", path: ["bidPriceShift"], message: "A price shift must be above -100%" });
    }
  });

export const HorizonSchema = z
  .object({
    originalText: z.string().trim().max(240),
    endAtUTC: z.string().datetime({ offset: true }).nullable(),
    timezone: z.string().trim().max(80).nullable(),
  })
  .strict();

export const PlanSchema = z
  .object({
    asset: AssetSchema,
    category: CategorySchema,
    side: z.literal("long"),
    quoteCurrency: z.literal("USDT"),
    thesis: z.string().trim().max(4000),
    purchaseNotionalExcludingFee: PositiveDecimalStringSchema,
    horizon: HorizonSchema,
    goal: GoalSchema.nullable(),
    exitAssumptions: ExitAssumptionsSchema,
    scenario: PriceScenarioSchema.nullable(),
    invalidation: z.string().trim().max(800).nullable(),
    feeIn: BoundedFractionSchema,
    feeOut: BoundedFractionSchema,
    feeOrigin: z.enum(["published_standard_assumption", "user_supplied"]),
  })
  .strict();

export const MarketLevelSchema = z
  .tuple([PositiveDecimalStringSchema, NonNegativeDecimalStringSchema])
  .rest(z.never());

export const InstrumentSchema = z
  .object({
    symbol: z.string().regex(/^[A-Z0-9]+$/),
    asset: AssetSchema,
    category: CategorySchema,
    baseCoin: z.string().min(1),
    quoteCoin: z.literal("USDT"),
    symbolType: z.literal("stock"),
    isReality: z.literal(true),
    status: z.string().min(1),
    quantityStep: PositiveDecimalStringSchema,
    priceTick: PositiveDecimalStringSchema,
    minOrderQty: PositiveDecimalStringSchema,
    maxOrderQty: NonNegativeDecimalStringSchema,
    minOrderNotional: PositiveDecimalStringSchema,
    maxPositionQty: NonNegativeDecimalStringSchema,
    rawMetadataTime: z.string().datetime({ offset: true }),
  })
  .strict();

export const MarketSnapshotSchema = z
  .object({
    id: z.string().min(8),
    hash: z.string().min(8),
    asset: AssetSchema,
    symbol: z.string().min(1),
    bids: z.array(MarketLevelSchema).min(1),
    asks: z.array(MarketLevelSchema).min(1),
    exchangeTimestamp: z.string().datetime({ offset: true }),
    receivedAt: z.string().datetime({ offset: true }),
    mode: EvidenceModeSchema,
    rawResponseReference: z.string().min(1),
    validationWarnings: z.array(z.string()),
  })
  .strict();

export const CitationSchema = z
  .object({
    sourceId: z.string().min(8),
    excerpt: z.string().trim().min(1).max(360),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endOffset <= value.startOffset) {
      context.addIssue({ code: "custom", path: ["endOffset"], message: "Citation range must be non-empty" });
    }
  });

export const SourceDocumentSchema = z
  .object({
    id: z.string().min(8),
    originalUrl: z.string().url().nullable(),
    finalApprovedUrl: z.string().url().nullable(),
    title: z.string().min(1),
    publisher: z.string().min(1),
    publicationDate: z.string().nullable(),
    publicationDatePrecision: z.enum(["day", "month", "year", "unknown"]),
    eventDate: z.string().nullable(),
    fetchedAt: z.string().datetime({ offset: true }),
    cleanedText: z.string().min(1),
    textHash: z.string().min(8),
    provenance: z.enum(["retrieved_official", "retrieved_feed_summary", "user_pasted_unverified", "captured_official_excerpt", "synthetic_test"]),
    truncated: z.boolean(),
  })
  .strict();

export const ClaimAssessmentSchema = z
  .object({
    claimId: z.string().min(1),
    exactText: z.string().trim().min(1).max(700),
    distinction: z.enum(["factual", "causal", "forecast"]),
    materiality: z.enum(["material", "contextual"]),
    status: z.enum(["supported", "contradicted", "insufficient"]),
    explanation: z.string().trim().min(1).max(900),
    citations: z.array(CitationSchema).max(5),
    missingEvidence: z.string().trim().max(700).nullable(),
  })
  .strict();

export const EvidenceResultSchema = z
  .object({
    status: z.enum(["assessed", "not_assessed", "unavailable"]),
    assessmentOrigin: z.enum(["runtime_model", "manual_replay", "unavailable"]),
    verdict: z.enum(["supported", "contradicted", "insufficient", "mixed", "source_unavailable", "not_assessed"]),
    scope: z.literal("by the supplied evidence"),
    mostConsequentialUnknown: z.string().nullable(),
    summary: z.string().min(1),
  })
  .strict();

export const ModelUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
    costUsd: DecimalStringSchema.nullable(),
  })
  .strict();

export const ReportPerformanceSchema = z
  .object({
    totalDurationMs: z.number().int().nonnegative(),
    marketDurationMs: z.number().int().nonnegative().nullable(),
    modelDurationMs: z.number().int().nonnegative().nullable(),
    modelCalls: z.number().int().nonnegative(),
    modelRunStatus: z.enum(["provider_call", "evidence_reused", "not_attempted", "quota_denied", "provider_failed"]),
    modelUsage: ModelUsageSchema.nullable(),
    reusedEvidence: z.boolean(),
  })
  .strict();

export const ScenarioRowSchema = z
  .object({
    label: z.string().min(1),
    bidPriceShift: DecimalStringSchema,
    effectivePriceShift: DecimalStringSchema.nullable(),
    netPnl: DecimalStringSchema.nullable(),
    netReturn: DecimalStringSchema.nullable(),
    goalComparison: z.enum(["meets", "below", "not_requested", "unavailable"]),
    status: z.enum(["calculated", "insufficient_depth", "unavailable"]),
  })
  .strict();

export const EconomicsResultSchema = z
  .object({
    computationStatus: z.enum(["calculated", "threshold_only", "missing_inputs", "invalid_instrument", "invalid_book", "insufficient_depth"]),
    goalComparison: z.enum(["meets", "below", "not_requested", "unavailable"]),
    snapshotId: z.string().nullable(),
    planRevision: z.number().int().nonnegative(),
    scenarioRevision: z.number().int().nonnegative(),
    units: z.object({ quoteCurrency: z.literal("USDT"), baseAsset: z.string().min(1) }).strict(),
    requestedNotional: DecimalStringSchema.nullable(),
    quantity: DecimalStringSchema.nullable(),
    spentNotional: DecimalStringSchema.nullable(),
    entryCash: DecimalStringSchema.nullable(),
    unspentNotional: DecimalStringSchema.nullable(),
    entryVWAP: DecimalStringSchema.nullable(),
    modeledExitVWAP: DecimalStringSchema.nullable(),
    modeledExitGross: DecimalStringSchema.nullable(),
    modeledExitNet: DecimalStringSchema.nullable(),
    netPnl: DecimalStringSchema.nullable(),
    netReturn: DecimalStringSchema.nullable(),
    frictionProxy: DecimalStringSchema.nullable(),
    breakEvenShift: DecimalStringSchema.nullable(),
    requiredGoalShift: DecimalStringSchema.nullable(),
    scenarioBidPriceShift: DecimalStringSchema.nullable(),
    effectivePriceShift: DecimalStringSchema.nullable(),
    scenarioGross: DecimalStringSchema.nullable(),
    scenarioNet: DecimalStringSchema.nullable(),
    matchedExitQuantity: DecimalStringSchema.nullable(),
    unmatchedExitQuantity: DecimalStringSchema.nullable(),
    visibleEntryCapacity: DecimalStringSchema.nullable(),
    visibleExitCapacity: DecimalStringSchema.nullable(),
    exitDepthMultiplier: DecimalStringSchema,
    exitPriceHaircut: DecimalStringSchema,
    warnings: z.array(z.string()),
    scenarioTable: z.array(ScenarioRowSchema),
  })
  .strict();

export const PartialErrorSchema = z
  .object({
    kind: z.enum([
      "source_missing",
      "source_unavailable",
      "model_unconfigured",
      "model_timeout",
      "model_invalid_output",
      "model_budget",
      "market_unavailable",
      "market_invalid",
      "insufficient_depth",
      "ambiguous_input",
      "unsupported_instrument",
    ]),
    message: z.string().min(1),
    recovery: z.string().min(1),
  })
  .strict();

export const HeadlineSchema = z
  .object({
    id: z.string().regex(/^hl_[a-f0-9]{16}$/),
    asset: AssetSchema,
    title: z.string().trim().min(1).max(400),
    summary: z.string().trim().max(2_000),
    url: z.string().url(),
    publisher: z.string().trim().min(1).max(120),
    // Exact instant when the feed states one; otherwise only the publication day is known.
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    publishedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    feed: z.enum(["issuer_newsroom", "yahoo_finance_ticker", "sec_edgar_8k"]),
    kind: z.enum(["issuer_official", "regulatory_filing", "news_aggregator"]),
    fullTextAvailable: z.boolean(),
    mode: z.enum(["live", "captured_real"]),
  })
  .strict();

export const SessionStateSchema = z.enum(["regular", "pre_market", "post_market", "overnight", "weekend", "holiday"]);

export const MarketContextSchema = z
  .object({
    asset: AssetSchema,
    mode: z.enum(["live", "captured_real"]),
    observedAt: z.string().datetime({ offset: true }),
    session: z
      .object({
        state: SessionStateSchema,
        underlyingOpen: z.boolean(),
        label: z.string().min(1),
        nextRegularOpenAt: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
    underlying: z
      .object({
        symbol: z.string().min(1),
        lastClose: PositiveDecimalStringSchema,
        lastCloseSessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        lastCloseAt: z.string().datetime({ offset: true }),
        latestPrice: PositiveDecimalStringSchema.nullable(),
        latestAt: z.string().datetime({ offset: true }).nullable(),
        source: z.enum(["yahoo_finance_chart", "captured_yahoo_finance_chart"]),
      })
      .strict()
      .nullable(),
    rToken: z
      .object({
        bestBid: PositiveDecimalStringSchema,
        bestAsk: PositiveDecimalStringSchema,
        mid: PositiveDecimalStringSchema,
        at: z.string().datetime({ offset: true }),
      })
      .strict()
      .nullable(),
    // rToken mid versus the underlying's last regular-session close: what the 24/7 venue has already moved.
    moveSinceClose: DecimalStringSchema.nullable(),
    // rToken mid versus the freshest underlying print (regular or extended hours), only when that print is fresh.
    basisVsLatest: DecimalStringSchema.nullable(),
    warnings: z.array(z.string()),
  })
  .strict();

export const ResearchResultSchema = z
  .object({
    reportId: z.string().min(8),
    inputRevision: z.number().int().nonnegative(),
    reportRevision: z.number().int().nonnegative(),
    schemaVersion: z.string().min(1),
    formulaVersion: z.string().min(1),
    promptVersion: z.string().min(1),
    evidenceInputHash: z.string().min(8),
    economicsInputHash: z.string().min(8).nullable(),
    modelId: z.string().nullable(),
    confirmedPlan: PlanSchema,
    instrument: InstrumentSchema.nullable(),
    snapshot: MarketSnapshotSchema.nullable(),
    recomputeToken: z.string().regex(/^v1\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/).nullable(),
    sources: z.array(SourceDocumentSchema),
    headlineIds: z.array(z.string()).max(MAX_SELECTED_HEADLINES_LIMIT).default([]),
    marketContext: MarketContextSchema.nullable().default(null),
    claims: z.array(ClaimAssessmentSchema).max(5),
    evidence: EvidenceResultSchema,
    economics: EconomicsResultSchema,
    performance: ReportPerformanceSchema,
    partialErrors: z.array(PartialErrorSchema),
    generatedAt: z.string().datetime({ offset: true }),
    limitations: z.array(z.string()),
  })
  .strict();

export const ResearchRequestSchema = z
  .object({
    plan: PlanSchema,
    sourceText: z.string().trim().max(60_000).nullable(),
    sourceUrl: z.string().trim().max(2_000).nullable(),
    headlineIds: z.array(z.string().regex(/^hl_[a-f0-9]{16}$/)).max(MAX_SELECTED_HEADLINES_LIMIT).default([]),
    marketMode: z.enum(["captured_real", "live"]),
    inputRevision: z.number().int().nonnegative(),
  })
  .strict();

export const RadarRequestSchema = z
  .object({
    asset: AssetSchema,
    mode: z.enum(["captured_real", "live"]),
  })
  .strict();

export const RadarResultSchema = z
  .object({
    asset: AssetSchema,
    mode: z.enum(["captured_real", "live"]),
    headlines: z.array(HeadlineSchema).max(30),
    marketContext: MarketContextSchema,
    feedWarnings: z.array(z.string()),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

// A plan patch is the only way the conversational layer can change the plan. Percent fields are
// human percentages ("1.5" = 1.5%); the pure applier converts them and re-validates the whole plan.
export const PlanPatchSchema = z
  .object({
    asset: AssetSchema.optional(),
    thesis: z.string().trim().min(1).max(4000).optional(),
    purchaseNotional: PositiveDecimalStringSchema.optional(),
    horizonText: z.string().trim().max(240).optional(),
    goal: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("break_even") }).strict(),
        z.object({ kind: z.literal("profit_usdt"), amount: NonNegativeDecimalStringSchema }).strict(),
        z.object({ kind: z.literal("net_return_percent"), percent: NonNegativeDecimalStringSchema }).strict(),
        z.object({ kind: z.literal("none") }).strict(),
      ])
      .optional(),
    scenarioBidShiftPercent: DecimalStringSchema.nullable().optional(),
    invalidation: z.string().trim().max(800).nullable().optional(),
    exitDepthPercent: NonNegativeDecimalStringSchema.optional(),
    exitHaircutPercent: NonNegativeDecimalStringSchema.optional(),
    feeInPercent: NonNegativeDecimalStringSchema.optional(),
    feeOutPercent: NonNegativeDecimalStringSchema.optional(),
  })
  .strict();

export const ChatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const ChatRequestSchema = z
  .object({
    messages: z.array(ChatMessageSchema).min(1).max(12),
    plan: PlanSchema,
    marketMode: z.enum(["captured_real", "live"]),
    headlines: z
      .array(z.object({ id: z.string().regex(/^hl_[a-f0-9]{16}$/), title: z.string().max(400), publisher: z.string().max(120), publishedAt: z.string().nullable() }).strict())
      .max(30),
    selectedHeadlineIds: z.array(z.string().regex(/^hl_[a-f0-9]{16}$/)).max(MAX_SELECTED_HEADLINES_LIMIT),
    hasSourceText: z.boolean(),
    briefSummary: z.string().max(1_500).nullable(),
  })
  .strict();

export const ChatResultSchema = z
  .object({
    reply: z.string().trim().min(1).max(1_200),
    plan: PlanSchema,
    changed: z.array(z.string().max(200)).max(12),
    selectHeadlineIds: z.array(z.string().regex(/^hl_[a-f0-9]{16}$/)).max(MAX_SELECTED_HEADLINES_LIMIT).nullable(),
    action: z.enum(["none", "run_brief", "refresh_market"]),
    marketMode: z.enum(["captured_real", "live"]).nullable(),
    origin: z.enum(["model", "rules"]),
    modelId: z.string().nullable(),
  })
  .strict();

export const MarketRequestSchema = z
  .object({
    asset: AssetSchema,
    mode: z.enum(["captured_real", "live"]),
  })
  .strict();

export const RecomputeRequestSchema = z
  .object({
    plan: PlanSchema,
    instrument: InstrumentSchema,
    snapshot: MarketSnapshotSchema,
    recomputeToken: z.string().regex(/^v1\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/),
    planRevision: z.number().int().nonnegative(),
    scenarioRevision: z.number().int().nonnegative(),
  })
  .strict();

export const RecomputeResultSchema = z
  .object({
    reportId: z.string().min(8),
    reportRevision: z.number().int().nonnegative(),
    economicsInputHash: z.string().min(8),
    economics: EconomicsResultSchema,
    performance: ReportPerformanceSchema,
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const IntentRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    plan: PlanSchema,
  })
  .strict();

export type DecimalString = z.infer<typeof DecimalStringSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Instrument = z.infer<typeof InstrumentSchema>;
export type MarketLevel = z.infer<typeof MarketLevelSchema>;
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type ClaimAssessment = z.infer<typeof ClaimAssessmentSchema>;
export type EvidenceResult = z.infer<typeof EvidenceResultSchema>;
export type ModelUsage = z.infer<typeof ModelUsageSchema>;
export type ReportPerformance = z.infer<typeof ReportPerformanceSchema>;
export type EconomicsResult = z.infer<typeof EconomicsResultSchema>;
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
export type PartialError = z.infer<typeof PartialErrorSchema>;
export type ScenarioRow = z.infer<typeof ScenarioRowSchema>;
export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;
export type RecomputeRequest = z.infer<typeof RecomputeRequestSchema>;
export type RecomputeResult = z.infer<typeof RecomputeResultSchema>;
export type Headline = z.infer<typeof HeadlineSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type MarketContext = z.infer<typeof MarketContextSchema>;
export type RadarResult = z.infer<typeof RadarResultSchema>;
export type PlanPatch = z.infer<typeof PlanPatchSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResult = z.infer<typeof ChatResultSchema>;

export const RESEARCH_REQUEST_MAX_BYTES = 120_000;
export const CHAT_REQUEST_MAX_BYTES = 60_000;
export const MAX_SOURCE_CHARS = 15_000;
export const MAX_MODEL_SOURCE_COUNT = 5;
export const MAX_SELECTED_HEADLINES = MAX_SELECTED_HEADLINES_LIMIT;
export const FORMULA_VERSION = "economics-v1";
export const SCHEMA_VERSION = "research-v3";
// Pasted-source-only briefs keep the frozen benchmark prompt; retrieved sources add dated provenance.
export const PROMPT_VERSION = "claims-v4";
export const MULTI_SOURCE_PROMPT_VERSION = "claims-v5-multisource";
export const CHAT_PROMPT_VERSION = "chat-v1";
