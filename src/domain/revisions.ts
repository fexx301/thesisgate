import Decimal from "decimal.js";
import type { Instrument, MarketSnapshot, Plan, ResearchResult, SourceDocument } from "./contracts";

export type MarketMode = "captured_real" | "live";
export type RequestState = "idle" | "submitting" | "refreshing" | "error";

export type WorkbenchState = {
  plan: Plan;
  sourceText: string;
  sourceUrl: string;
  // Server-issued headline IDs selected as evidence; changing them invalidates the evidence result.
  selectedHeadlineIds: string[];
  marketMode: MarketMode;
  // Market mode the current report was requested for, independent of snapshot availability,
  // so partial reports with failed market data are not falsely called stale.
  reportMarketMode: MarketMode | null;
  planRevision: number;
  thesisRevision: number;
  scenarioRevision: number;
  activeRequestId: number;
  requestState: RequestState;
  report: ResearchResult | null;
  errorMessage: string | null;
  changedMessage: string | null;
  followUpMessage: string;
};

export type WorkbenchAction =
  | { type: "set-plan"; plan: Plan; changedMessage: string; evidenceChanged: boolean }
  | { type: "set-source-text"; sourceText: string }
  | { type: "set-source-url"; sourceUrl: string }
  | { type: "set-headlines"; headlineIds: string[]; changedMessage: string | null }
  | { type: "request-success"; requestId: number; report: ResearchResult; requestedMarketMode: MarketMode }
  | { type: "set-market-mode"; marketMode: MarketMode; changedMessage?: string }
  | { type: "restore-draft"; plan: Plan; sourceText: string; sourceUrl: string; marketMode: MarketMode; changedMessage: string }
  | { type: "begin-request"; requestId: number; requestState: "submitting" | "refreshing" }
  | { type: "request-error"; requestId: number; message: string }
  | { type: "set-follow-up"; followUpMessage: string }
  | { type: "set-changed-message"; changedMessage: string | null };

export function revisionReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "set-plan":
      return {
        ...state,
        plan: action.plan,
        planRevision: state.planRevision + 1,
        thesisRevision: action.evidenceChanged ? state.thesisRevision + 1 : state.thesisRevision,
        scenarioRevision: action.evidenceChanged ? state.scenarioRevision : state.scenarioRevision + 1,
        changedMessage: action.changedMessage,
        errorMessage: null,
      };
    case "set-source-text":
      return {
        ...state,
        sourceText: action.sourceText,
        planRevision: state.planRevision + 1,
        thesisRevision: state.thesisRevision + 1,
        changedMessage: "Source text changed. Evidence will be reassessed on submit.",
      };
    case "set-source-url":
      return {
        ...state,
        sourceUrl: action.sourceUrl,
        planRevision: state.planRevision + 1,
        thesisRevision: state.thesisRevision + 1,
        changedMessage: "Source URL changed. The reference remains unverified until retrieval is enabled.",
      };
    case "set-headlines":
      if (JSON.stringify(action.headlineIds) === JSON.stringify(state.selectedHeadlineIds)) return state;
      return {
        ...state,
        selectedHeadlineIds: action.headlineIds,
        planRevision: state.planRevision + 1,
        thesisRevision: state.thesisRevision + 1,
        changedMessage: action.changedMessage,
      };
    case "set-market-mode":
      return { ...state, marketMode: action.marketMode, changedMessage: action.changedMessage ?? null };
    case "restore-draft":
      return {
        ...state,
        plan: action.plan,
        sourceText: action.sourceText,
        sourceUrl: action.sourceUrl,
        marketMode: action.marketMode,
        reportMarketMode: null,
        planRevision: state.planRevision + 1,
        thesisRevision: state.thesisRevision + 1,
        scenarioRevision: state.scenarioRevision + 1,
        activeRequestId: state.activeRequestId + 1,
        requestState: "idle",
        report: null,
        errorMessage: null,
        changedMessage: action.changedMessage,
      };
    case "begin-request":
      return { ...state, activeRequestId: action.requestId, requestState: action.requestState, errorMessage: null };
    case "request-success":
      if (action.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        requestState: "idle",
        report: action.report,
        reportMarketMode: action.requestedMarketMode,
        errorMessage: null,
        changedMessage: null,
      };
    case "request-error":
      if (action.requestId !== state.activeRequestId) return state;
      return { ...state, requestState: "error", errorMessage: action.message };
    case "set-follow-up":
      return { ...state, followUpMessage: action.followUpMessage };
    case "set-changed-message":
      return { ...state, changedMessage: action.changedMessage };
    default:
      return state;
  }
}

async function hashInput(kind: "evidence" | "economics", input: unknown) {
  const payload = new TextEncoder().encode(JSON.stringify(input));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", payload));
  return `${kind}-v2:sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function numeric(value: string) {
  return new Decimal(value).toString();
}

export function evidenceInputHash(
  plan: Plan,
  sources: Array<Pick<SourceDocument, "textHash" | "provenance" | "publicationDate" | "eventDate" | "publicationDatePrecision">>,
  promptVersion: string,
  modelVersion: string,
) {
  return hashInput("evidence", {
    asset: plan.asset,
    thesis: plan.thesis,
    sources: sources.map((source) => ({
      textHash: source.textHash,
      provenance: source.provenance,
      publicationDate: source.publicationDate,
      eventDate: source.eventDate,
      publicationDatePrecision: source.publicationDatePrecision,
    })),
    horizon: {
      originalText: plan.horizon.originalText,
      endAtUTC: plan.horizon.endAtUTC,
      timezone: plan.horizon.timezone,
    },
    invalidation: plan.invalidation,
    promptVersion,
    modelVersion,
  });
}

export function economicsInputHash(plan: Plan, instrument: Instrument, snapshot: MarketSnapshot, formulaVersion: string) {
  return hashInput("economics", {
    asset: plan.asset,
    category: plan.category,
    side: plan.side,
    quoteCurrency: plan.quoteCurrency,
    instrument: {
      symbol: instrument.symbol,
      asset: instrument.asset,
      category: instrument.category,
      baseCoin: instrument.baseCoin,
      quoteCoin: instrument.quoteCoin,
      symbolType: instrument.symbolType,
      isReality: instrument.isReality,
      status: instrument.status.toLowerCase(),
      quantityStep: numeric(instrument.quantityStep),
      priceTick: numeric(instrument.priceTick),
      minOrderQty: numeric(instrument.minOrderQty),
      maxOrderQty: numeric(instrument.maxOrderQty),
      minOrderNotional: numeric(instrument.minOrderNotional),
      maxPositionQty: numeric(instrument.maxPositionQty),
    },
    book: {
      asset: snapshot.asset,
      symbol: snapshot.symbol,
      bids: snapshot.bids.map(([price, quantity]) => [numeric(price), numeric(quantity)]),
      asks: snapshot.asks.map(([price, quantity]) => [numeric(price), numeric(quantity)]),
    },
    notional: numeric(plan.purchaseNotionalExcludingFee),
    fees: [numeric(plan.feeIn), numeric(plan.feeOut)],
    goal: plan.goal?.kind === "profit_usdt"
      ? { kind: plan.goal.kind, amount: numeric(plan.goal.amount) }
      : plan.goal?.kind === "net_return"
        ? { kind: plan.goal.kind, fractionOfEntryCash: numeric(plan.goal.fractionOfEntryCash) }
        : plan.goal ? { kind: plan.goal.kind } : null,
    exitAssumptions: {
      depthMultiplier: numeric(plan.exitAssumptions.depthMultiplier),
      priceHaircut: numeric(plan.exitAssumptions.priceHaircut),
    },
    scenario: plan.scenario ? { bidPriceShift: numeric(plan.scenario.bidPriceShift) } : null,
    formulaVersion,
  });
}
