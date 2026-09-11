import type { Instrument, MarketSnapshot, Plan, ResearchResult, SourceDocument } from "./contracts";

export type MarketMode = "captured_real" | "live";
export type RequestState = "idle" | "submitting" | "refreshing" | "error";

export type WorkbenchState = {
  plan: Plan;
  sourceText: string;
  sourceUrl: string;
  marketMode: MarketMode;
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
  | { type: "set-market-mode"; marketMode: MarketMode; changedMessage?: string }
  | { type: "restore-draft"; plan: Plan; sourceText: string; sourceUrl: string; marketMode: MarketMode; changedMessage: string }
  | { type: "begin-request"; requestId: number; requestState: "submitting" | "refreshing" }
  | { type: "request-success"; requestId: number; report: ResearchResult }
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
    case "set-market-mode":
      return { ...state, marketMode: action.marketMode, changedMessage: action.changedMessage ?? null };
    case "restore-draft":
      return {
        ...state,
        plan: action.plan,
        sourceText: action.sourceText,
        sourceUrl: action.sourceUrl,
        marketMode: action.marketMode,
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

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function evidenceInputHash(
  plan: Plan,
  sources: Array<Pick<SourceDocument, "textHash" | "provenance" | "publicationDate" | "eventDate" | "publicationDatePrecision">>,
  promptVersion: string,
  modelVersion: string,
) {
  return hashString(JSON.stringify({
    asset: plan.asset,
    thesis: plan.thesis,
    sources,
    horizon: plan.horizon,
    invalidation: plan.invalidation,
    promptVersion,
    modelVersion,
  }));
}

export function economicsInputHash(plan: Plan, instrument: Instrument, snapshot: MarketSnapshot, formulaVersion: string) {
  return hashString(JSON.stringify({
    instrument,
    snapshotHash: snapshot.hash,
    notional: plan.purchaseNotionalExcludingFee,
    fees: [plan.feeIn, plan.feeOut],
    goal: plan.goal,
    exitAssumptions: plan.exitAssumptions,
    scenario: plan.scenario,
    formulaVersion,
  }));
}
