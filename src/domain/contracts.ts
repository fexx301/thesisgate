import Decimal from "decimal.js";
import { z } from "zod";

const DECIMAL_PATTERN = /^-?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i;

function isFiniteDecimal(value: string) {
  if (!DECIMAL_PATTERN.test(value.trim())) return false;
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}

export const DecimalStringSchema = z
  .string()
  .trim()
  .regex(DECIMAL_PATTERN, "Enter a decimal number")
  .refine(isFiniteDecimal, "Enter a finite decimal number");

export const NonNegativeDecimalStringSchema = DecimalStringSchema.refine(
  (value) => new Decimal(value).gte(0),
  "Enter zero or a positive number",
);

export const PositiveDecimalStringSchema = DecimalStringSchema.refine(
  (value) => new Decimal(value).gt(0),
  "Enter a number greater than zero",
);

const BoundedFractionSchema = NonNegativeDecimalStringSchema.refine(
  (value) => new Decimal(value).lt(1),
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
    if (new Decimal(value.depthMultiplier).gt(1)) {
      context.addIssue({ code: "custom", path: ["depthMultiplier"], message: "Depth must be between 0 and 1" });
    }
    if (new Decimal(value.priceHaircut).gte(1)) {
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
    if (new Decimal(value.bidPriceShift).lte(-1)) {
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
    provenance: z.enum(["retrieved_official", "user_pasted_unverified", "captured_official_excerpt", "synthetic_test"]),
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

export const ScenarioRowSchema = z
  .object({
    label: z.string().min(1),
    bidPriceShift: DecimalStringSchema,
    effectivePriceShift: DecimalStringSchema.nullable(),
    netPnl: DecimalStringSchema.nullable(),
    netReturn: DecimalStringSchema.nullable(),
    goalComparison: z.enum(["meets", "below", "unavailable"]),
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
    sources: z.array(SourceDocumentSchema),
    claims: z.array(ClaimAssessmentSchema).max(5),
    evidence: EvidenceResultSchema,
    economics: EconomicsResultSchema,
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
    marketMode: z.enum(["captured_real", "live"]),
    inputRevision: z.number().int().nonnegative(),
  })
  .strict();

export const MarketRequestSchema = z
  .object({
    asset: AssetSchema,
    mode: z.enum(["captured_real", "live"]),
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
export type EconomicsResult = z.infer<typeof EconomicsResultSchema>;
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
export type PartialError = z.infer<typeof PartialErrorSchema>;
export type ScenarioRow = z.infer<typeof ScenarioRowSchema>;
export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;

export const RESEARCH_REQUEST_MAX_BYTES = 120_000;
export const MAX_SOURCE_CHARS = 15_000;
export const MAX_MODEL_SOURCE_COUNT = 3;
export const FORMULA_VERSION = "economics-v1";
export const SCHEMA_VERSION = "research-v1";
export const PROMPT_VERSION = "claims-v3";
