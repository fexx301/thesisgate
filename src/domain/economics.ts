import Decimal from "decimal.js";
import type {
  EconomicsResult,
  Instrument,
  MarketLevel,
  MarketSnapshot,
  Plan,
  ScenarioRow,
} from "./contracts";

export type EconomicsInput = {
  plan: Plan;
  instrument: Instrument;
  snapshot: MarketSnapshot;
  planRevision: number;
  scenarioRevision: number;
};

type Sweep = {
  value: Decimal;
  filledQty: Decimal;
  remainingQty: Decimal;
  vwap: Decimal | null;
};

type BookCheck = {
  levels: MarketLevel[];
  warnings: string[];
};

const SCENARIO_PRESETS: Array<{ label: string; value: string }> = [
  { label: "-3% downside", value: "-0.03" },
  { label: "Flat", value: "0" },
  { label: "+0.3%", value: "0.003" },
  { label: "+1%", value: "0.01" },
  { label: "+3%", value: "0.03" },
];

function decimal(value: string) {
  return new Decimal(value);
}

function output(value: Decimal | null) {
  return value?.toString() ?? null;
}

function emptyScenarioTable(status: ScenarioRow["status"] = "unavailable", goal: { kind: string } | null = null): ScenarioRow[] {
  return SCENARIO_PRESETS.map(({ label, value }) => ({
    label,
    bidPriceShift: value,
    effectivePriceShift: null,
    netPnl: null,
    netReturn: null,
    goalComparison: goal ? "unavailable" : "not_requested",
    status,
  }));
}

function emptyResult(
  input: EconomicsInput,
  status: EconomicsResult["computationStatus"],
  warnings: string[],
): EconomicsResult {
  const scenarioStatus: ScenarioRow["status"] = status === "insufficient_depth" ? "insufficient_depth" : "unavailable";
  return {
    computationStatus: status,
    goalComparison: input.plan.goal ? "unavailable" : "not_requested",
    snapshotId: input.snapshot.id,
    planRevision: input.planRevision,
    scenarioRevision: input.scenarioRevision,
    units: { quoteCurrency: "USDT", baseAsset: input.instrument.baseCoin },
    requestedNotional: input.plan.purchaseNotionalExcludingFee,
    quantity: null,
    spentNotional: null,
    entryCash: null,
    unspentNotional: null,
    entryVWAP: null,
    modeledExitVWAP: null,
    modeledExitGross: null,
    modeledExitNet: null,
    netPnl: null,
    netReturn: null,
    frictionProxy: null,
    breakEvenShift: null,
    requiredGoalShift: null,
    scenarioBidPriceShift: input.plan.scenario?.bidPriceShift ?? null,
    effectivePriceShift: null,
    scenarioGross: null,
    scenarioNet: null,
    matchedExitQuantity: null,
    unmatchedExitQuantity: null,
    visibleEntryCapacity: null,
    visibleExitCapacity: null,
    exitDepthMultiplier: input.plan.exitAssumptions.depthMultiplier,
    exitPriceHaircut: input.plan.exitAssumptions.priceHaircut,
    warnings,
    scenarioTable: emptyScenarioTable(scenarioStatus, input.plan.goal),
  };
}

function validateInstrument(instrument: Instrument) {
  const warnings: string[] = [];
  if (instrument.category !== "SPOT" || !instrument.isReality || instrument.symbolType !== "stock") {
    warnings.push("Only online Reality SPOT stock tokens are supported in this MVP.");
  }
  if (instrument.status.toLowerCase() !== "online") {
    warnings.push("The selected instrument is not marked online by the venue.");
  }
  if (decimal(instrument.quantityStep).lte(0) || decimal(instrument.minOrderQty).lte(0)) {
    warnings.push("The instrument did not provide a usable quantity step.");
  }
  if (decimal(instrument.minOrderNotional).lte(0)) {
    warnings.push("The instrument did not provide a usable minimum notional.");
  }
  return { valid: warnings.length === 0, warnings };
}

function validateBook(snapshot: MarketSnapshot): { bids: BookCheck; asks: BookCheck; warnings: string[]; valid: boolean } {
  const warnings: string[] = [];
  const fatal: string[] = [];
  const normalize = (levels: MarketLevel[], side: "bid" | "ask"): BookCheck => {
    const sideWarnings: string[] = [];
    const nonZero = levels.filter(([, quantity]) => !decimal(quantity).isZero());
    if (nonZero.length !== levels.length) {
      // Zero-quantity levels are filtered explicitly per spec; informative only, not fatal.
      sideWarnings.push(`${side === "bid" ? "Bid" : "Ask"} book contained zero-quantity levels; they were ignored.`);
    }
    let previous: Decimal | null = null;
    for (const [price, quantity] of nonZero) {
      const currentPrice = decimal(price);
      const currentQuantity = decimal(quantity);
      if (currentPrice.lte(0) || currentQuantity.lt(0)) {
        sideWarnings.push(`${side === "bid" ? "Bid" : "Ask"} book contains a non-positive level.`);
        fatal.push(`${side} non-positive level`);
        continue;
      }
      if (previous && (side === "ask" ? currentPrice.lt(previous) : currentPrice.gt(previous))) {
        sideWarnings.push(`${side === "bid" ? "Bid" : "Ask"} levels are not sorted.`);
        fatal.push(`${side} unsorted`);
      }
      previous = currentPrice;
    }
    return { levels: nonZero, warnings: sideWarnings };
  };

  const bids = normalize(snapshot.bids, "bid");
  const asks = normalize(snapshot.asks, "ask");
  if (!bids.levels.length || !asks.levels.length) {
    warnings.push("Both sides of the book need at least one non-zero level.");
    fatal.push("empty side");
  }
  if (bids.levels.length && asks.levels.length && decimal(asks.levels[0][0]).lt(decimal(bids.levels[0][0]))) {
    warnings.push("The book is crossed: best ask is below best bid.");
    fatal.push("crossed book");
  }
  warnings.push(...bids.warnings, ...asks.warnings);
  // Propagate fatal sorting/crossed/empty signals; zero-qty filtering alone stays valid.
  if (bids.warnings.some((w) => w.includes("not sorted") || w.includes("non-positive"))) fatal.push("bid malformed");
  if (asks.warnings.some((w) => w.includes("not sorted") || w.includes("non-positive"))) fatal.push("ask malformed");
  return { bids, asks, warnings, valid: fatal.length === 0 };
}

function sweep(levels: MarketLevel[], requestedQty: Decimal, transform?: (price: Decimal, quantity: Decimal) => [Decimal, Decimal]): Sweep {
  let remainingQty = requestedQty;
  let value = new Decimal(0);
  let filledQty = new Decimal(0);

  for (const [priceString, quantityString] of levels) {
    const [price, available] = transform
      ? transform(decimal(priceString), decimal(quantityString))
      : [decimal(priceString), decimal(quantityString)];
    if (available.lte(0)) continue;
    const take = Decimal.min(remainingQty, available);
    value = value.plus(take.mul(price));
    filledQty = filledQty.plus(take);
    remainingQty = remainingQty.minus(take);
    if (remainingQty.lte(0)) break;
  }

  return {
    value,
    filledQty,
    remainingQty: Decimal.max(remainingQty, 0),
    vwap: filledQty.gt(0) ? value.div(filledQty) : null,
  };
}

function budgetQuantity(levels: MarketLevel[], budget: Decimal) {
  // Full visible ask capacity (all levels), independent of the requested budget.
  const fullCapacity = levels.reduce(
    (sum, [priceString, quantityString]) => sum.plus(decimal(priceString).mul(decimal(quantityString))),
    new Decimal(0),
  );
  let remainingBudget = budget;
  let quantity = new Decimal(0);

  for (const [priceString, quantityString] of levels) {
    if (remainingBudget.isZero()) break;
    const price = decimal(priceString);
    const available = decimal(quantityString);
    if (available.lte(0)) continue;
    const levelCapacity = available.mul(price);
    if (remainingBudget.gte(levelCapacity)) {
      // Level fully consumable within the remaining budget: spend its exact capacity.
      quantity = quantity.plus(available);
      remainingBudget = remainingBudget.minus(levelCapacity);
      continue;
    }
    // Budget cannot fully buy this level: divide, then consume this level as
    // budget-complete so rounded division cannot leave a phantom residue.
    const take = Decimal.max(remainingBudget.div(price), 0);
    quantity = quantity.plus(take);
    remainingBudget = new Decimal(0);
    break;
  }

  return { quantity, remainingBudget: Decimal.max(remainingBudget, 0), visibleCapacity: fullCapacity };
}

function roundDown(value: Decimal, step: Decimal) {
  return value.div(step).floor().mul(step);
}

function goalAmount(plan: Plan, entryCash: Decimal) {
  if (!plan.goal) return null;
  if (plan.goal.kind === "break_even") return new Decimal(0);
  if (plan.goal.kind === "profit_usdt") return decimal(plan.goal.amount);
  return entryCash.mul(decimal(plan.goal.fractionOfEntryCash));
}

function scenarioValues(
  baseExitGross: Decimal,
  entryCash: Decimal,
  feeOut: Decimal,
  haircut: Decimal,
  shift: Decimal,
  goal: Decimal | null,
) {
  const exitGross = baseExitGross.mul(new Decimal(1).plus(shift));
  const exitNet = exitGross.mul(new Decimal(1).minus(feeOut));
  const netPnl = exitNet.minus(entryCash);
  const netReturn = netPnl.div(entryCash);
  return {
    exitGross,
    exitNet,
    netPnl,
    netReturn,
    effectiveShift: new Decimal(1).plus(shift).mul(new Decimal(1).minus(haircut)).minus(1),
    goalComparison: goal === null ? "not_requested" : netPnl.gte(goal) ? "meets" : "below",
  } as const;
}

function buildScenarioTable(
  baseExitGross: Decimal,
  entryCash: Decimal,
  feeOut: Decimal,
  haircut: Decimal,
  goal: Decimal | null,
) {
  return SCENARIO_PRESETS.map(({ label, value }) => {
    const values = scenarioValues(baseExitGross, entryCash, feeOut, haircut, decimal(value), goal);
    return {
      label,
      bidPriceShift: value,
      effectivePriceShift: output(values.effectiveShift),
      netPnl: output(values.netPnl),
      netReturn: output(values.netReturn),
      goalComparison: values.goalComparison,
      status: "calculated",
    } satisfies ScenarioRow;
  });
}

export function calculateEconomics(input: EconomicsInput): EconomicsResult {
  const instrumentCheck = validateInstrument(input.instrument);
  const initialWarnings = [...input.snapshot.validationWarnings, ...instrumentCheck.warnings];
  if (!instrumentCheck.valid) return emptyResult(input, "invalid_instrument", initialWarnings);

  const bookCheck = validateBook(input.snapshot);
  const warnings = [...initialWarnings, ...bookCheck.warnings];
  if (!bookCheck.valid) return emptyResult(input, "invalid_book", warnings);

  const budget = decimal(input.plan.purchaseNotionalExcludingFee);
  const entryPlan = budgetQuantity(bookCheck.asks.levels, budget);
  const quantity = roundDown(entryPlan.quantity, decimal(input.instrument.quantityStep));
  const entry = sweep(bookCheck.asks.levels, quantity);
  const unspent = budget.minus(entry.value);

  warnings.push(`Visible ask capacity is ${entryPlan.visibleCapacity.toString()} USDT at this snapshot.`);
  if (entryPlan.remainingBudget.gt(0)) {
    return {
      ...emptyResult(input, "insufficient_depth", [
        ...warnings,
        `The visible asks cannot cover the requested ${budget.toString()} USDT notional. ${entryPlan.remainingBudget.toString()} USDT remains unallocated.`,
      ]),
      visibleEntryCapacity: output(entryPlan.visibleCapacity),
      unspentNotional: output(entryPlan.remainingBudget),
    };
  }
  if (quantity.lte(0) || entry.filledQty.lt(quantity)) {
    return emptyResult(input, "insufficient_depth", [...warnings, "Quantity rounding left no valid position in the visible asks."]);
  }
  if (quantity.lt(decimal(input.instrument.minOrderQty)) || entry.value.lt(decimal(input.instrument.minOrderNotional))) {
    return emptyResult(input, "invalid_instrument", [...warnings, "The rounded order falls below the venue minimum quantity or notional."]);
  }
  if (decimal(input.instrument.maxOrderQty).gt(0) && quantity.gt(decimal(input.instrument.maxOrderQty))) {
    return emptyResult(input, "invalid_instrument", [...warnings, "The rounded quantity exceeds the configured venue maximum."]);
  }
  if (decimal(input.instrument.maxPositionQty).gt(0) && quantity.gt(decimal(input.instrument.maxPositionQty))) {
    return emptyResult(input, "invalid_instrument", [...warnings, "The rounded quantity exceeds the configured venue position maximum."]);
  }

  const entryNotional = entry.value;
  const entryCash = entryNotional.mul(new Decimal(1).plus(decimal(input.plan.feeIn)));
  const depthMultiplier = decimal(input.plan.exitAssumptions.depthMultiplier);
  const haircut = decimal(input.plan.exitAssumptions.priceHaircut);
  const exitPlan = sweep(bookCheck.bids.levels, quantity, (price, available) => [
    price.mul(new Decimal(1).minus(haircut)),
    available.mul(depthMultiplier),
  ]);
  // Visible exit capacity in USDT (stressed bid value), consistent with entry capacity units.
  const visibleExitCapacity = bookCheck.bids.levels.reduce(
    (sum, [price, available]) => sum.plus(decimal(price).mul(new Decimal(1).minus(haircut)).mul(decimal(available).mul(depthMultiplier))),
    new Decimal(0),
  );
  if (exitPlan.remainingQty.gt(0)) {
    return {
      ...emptyResult(input, "insufficient_depth", [
        ...warnings,
        `The stressed bid depth leaves ${exitPlan.remainingQty.toString()} ${input.instrument.baseCoin} unmatched. No whole-position PnL is shown.`,
      ]),
      quantity: output(quantity),
      spentNotional: output(entryNotional),
      entryCash: output(entryCash),
      unspentNotional: output(unspent),
      entryVWAP: output(entry.vwap),
      matchedExitQuantity: output(exitPlan.filledQty),
      unmatchedExitQuantity: output(exitPlan.remainingQty),
      visibleEntryCapacity: output(entryPlan.visibleCapacity),
      visibleExitCapacity: output(visibleExitCapacity),
    };
  }

  const baseExitGross = exitPlan.value;
  const feeOut = decimal(input.plan.feeOut);
  // Guard degenerate math: non-positive books or invalid fees must yield unavailable thresholds, never Infinity/NaN.
  if (baseExitGross.lte(0) || entryCash.lte(0) || feeOut.gte(1) || feeOut.lt(0)) {
    return {
      ...emptyResult(input, "invalid_book", [...warnings, "The stressed book produced no valid exit value; thresholds are unavailable."]),
      quantity: output(quantity),
      spentNotional: output(entryNotional),
      entryCash: output(entryCash),
      unspentNotional: output(unspent),
      entryVWAP: output(entry.vwap),
      matchedExitQuantity: output(exitPlan.filledQty),
      unmatchedExitQuantity: output(exitPlan.remainingQty),
      visibleEntryCapacity: output(entryPlan.visibleCapacity),
      visibleExitCapacity: output(visibleExitCapacity),
    };
  }
  const exitFeeMultiplier = new Decimal(1).minus(feeOut);
  const modeledExitNet = baseExitGross.mul(exitFeeMultiplier);
  if (modeledExitNet.lte(0)) {
    return {
      ...emptyResult(input, "invalid_book", [...warnings, "The modeled exit value is non-positive after fees; thresholds are unavailable."]),
      quantity: output(quantity),
      spentNotional: output(entryNotional),
      entryCash: output(entryCash),
      unspentNotional: output(unspent),
      entryVWAP: output(entry.vwap),
      matchedExitQuantity: output(exitPlan.filledQty),
      unmatchedExitQuantity: output(exitPlan.remainingQty),
      visibleEntryCapacity: output(entryPlan.visibleCapacity),
      visibleExitCapacity: output(visibleExitCapacity),
    };
  }
  const friction = entryCash.minus(modeledExitNet);
  const breakEvenShift = entryCash.div(modeledExitNet).minus(1);
  const goal = goalAmount(input.plan, entryCash);
  const requiredGoalShift = goal === null ? null : entryCash.plus(goal).div(modeledExitNet).minus(1);
  const selectedShift = input.plan.scenario ? decimal(input.plan.scenario.bidPriceShift) : null;
  const selectedScenario = selectedShift === null
    ? null
    : scenarioValues(baseExitGross, entryCash, feeOut, haircut, selectedShift, goal);
  const scenarioTable = buildScenarioTable(baseExitGross, entryCash, feeOut, haircut, goal);
  // Out-of-range notice: thresholds beyond the ±3% preset band were computed, not simulated row-by-row.
  const SUPPORTED_SHIFT = new Decimal("0.03");
  if (breakEvenShift.abs().gt(SUPPORTED_SHIFT)) {
    warnings.push(`Break-even shift ${breakEvenShift.mul(100).toDecimalPlaces(2).toString()}% is outside the ±3% scenario band; it is a computed threshold, not a simulated row.`);
  }
  if (requiredGoalShift !== null && requiredGoalShift.abs().gt(SUPPORTED_SHIFT)) {
    warnings.push(`Goal threshold ${requiredGoalShift.mul(100).toDecimalPlaces(2).toString()}% is outside the ±3% scenario band; it is a computed threshold, not a simulated row.`);
  }

  return {
    computationStatus: selectedScenario ? "calculated" : "threshold_only",
    goalComparison: !input.plan.goal ? "not_requested" : !selectedScenario ? "unavailable" : selectedScenario.goalComparison,
    snapshotId: input.snapshot.id,
    planRevision: input.planRevision,
    scenarioRevision: input.scenarioRevision,
    units: { quoteCurrency: "USDT", baseAsset: input.instrument.baseCoin },
    requestedNotional: input.plan.purchaseNotionalExcludingFee,
    quantity: output(quantity),
    spentNotional: output(entryNotional),
    entryCash: output(entryCash),
    unspentNotional: output(unspent),
    entryVWAP: output(entry.vwap),
    modeledExitVWAP: output(exitPlan.vwap),
    modeledExitGross: output(baseExitGross),
    modeledExitNet: output(modeledExitNet),
    netPnl: selectedScenario ? output(selectedScenario.netPnl) : null,
    netReturn: selectedScenario ? output(selectedScenario.netReturn) : null,
    frictionProxy: output(friction),
    breakEvenShift: output(breakEvenShift),
    requiredGoalShift: output(requiredGoalShift),
    scenarioBidPriceShift: selectedShift !== null ? output(selectedShift) : null,
    effectivePriceShift: selectedScenario ? output(selectedScenario.effectiveShift) : null,
    scenarioGross: selectedScenario ? output(selectedScenario.exitGross) : null,
    scenarioNet: selectedScenario ? output(selectedScenario.exitNet) : null,
    matchedExitQuantity: output(exitPlan.filledQty),
    unmatchedExitQuantity: output(exitPlan.remainingQty),
    visibleEntryCapacity: output(entryPlan.visibleCapacity),
    visibleExitCapacity: output(visibleExitCapacity),
    exitDepthMultiplier: input.plan.exitAssumptions.depthMultiplier,
    exitPriceHaircut: input.plan.exitAssumptions.priceHaircut,
    warnings,
    scenarioTable,
  };
}

export function missingEconomics(plan: Plan, planRevision: number, scenarioRevision: number, message: string): EconomicsResult {
  return {
    computationStatus: "missing_inputs",
    goalComparison: plan.goal ? "unavailable" : "not_requested",
    snapshotId: null,
    planRevision,
    scenarioRevision,
    units: { quoteCurrency: "USDT", baseAsset: `r${plan.asset}` },
    requestedNotional: plan.purchaseNotionalExcludingFee,
    quantity: null,
    spentNotional: null,
    entryCash: null,
    unspentNotional: null,
    entryVWAP: null,
    modeledExitVWAP: null,
    modeledExitGross: null,
    modeledExitNet: null,
    netPnl: null,
    netReturn: null,
    frictionProxy: null,
    breakEvenShift: null,
    requiredGoalShift: null,
    scenarioBidPriceShift: plan.scenario?.bidPriceShift ?? null,
    effectivePriceShift: null,
    scenarioGross: null,
    scenarioNet: null,
    matchedExitQuantity: null,
    unmatchedExitQuantity: null,
    visibleEntryCapacity: null,
    visibleExitCapacity: null,
    exitDepthMultiplier: plan.exitAssumptions.depthMultiplier,
    exitPriceHaircut: plan.exitAssumptions.priceHaircut,
    warnings: [message],
    scenarioTable: emptyScenarioTable("unavailable", plan.goal),
  };
}

export function syntheticInstrument(): Instrument {
  return {
    symbol: "SYNTHETICUSDT",
    asset: "NVDA",
    category: "SPOT",
    baseCoin: "synthetic",
    quoteCoin: "USDT",
    symbolType: "stock",
    isReality: true,
    status: "online",
    quantityStep: "0.01",
    priceTick: "0.01",
    minOrderQty: "0.01",
    maxOrderQty: "0",
    minOrderNotional: "10",
    maxPositionQty: "0",
    rawMetadataTime: "2026-09-09T00:00:00.000Z",
  };
}

export function syntheticSnapshot(): MarketSnapshot {
  return {
    id: "snapshot_d48547bf49b3cb23f8d849a3",
    hash: "d48547bf49b3cb23f8d849a3f8926945b65efa0dbb46467f8de1d4dca75907cf",
    asset: "NVDA",
    symbol: "SYNTHETICUSDT",
    bids: [
      ["99", "2"],
      ["98", "3"],
    ],
    asks: [
      ["100", "2"],
      ["101", "3"],
    ],
    exchangeTimestamp: "2026-09-09T00:00:00.000Z",
    receivedAt: "2026-09-09T00:00:00.000Z",
    mode: "synthetic",
    rawResponseReference: "synthetic:test-book",
    validationWarnings: [],
  };
}
