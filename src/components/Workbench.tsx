"use client";

import { useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import Decimal from "decimal.js";
import {
  ArrowClockwise,
  CaretDown,
  ChartLineUp,
  CheckCircle,
  CircleNotch,
  DownloadSimple,
  FileText,
  Info,
  Lightning,
  MagnifyingGlass,
  Target,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { toJson, toMarkdown } from "@/domain/export";
import { PlanSchema, type Asset, type Plan, type ResearchResult } from "@/domain/contracts";
import { revisionReducer, type MarketMode, type WorkbenchState } from "@/domain/revisions";

const CAPTURED_SOURCE_URL = "https://nvidianews.nvidia.com/news/aws-and-nvidia-to-deliver-2-million-additional-gpus-and-next-generation-infrastructure-for-agentic-and-physical-ai";
const CAPTURED_SOURCE_TEXT = `NVIDIA and AWS announced a planned expansion of AI infrastructure on August 26, 2026. The announcement describes additional NVIDIA GPU deployments across AWS data centers, with further systems planned for 2027 to 2028. The source describes planned infrastructure and future deployment. It does not state that the deployment is already producing revenue or provide a price forecast.`;

function initialPlan(): Plan {
  return {
    asset: "NVDA",
    category: "SPOT",
    side: "long",
    quoteCurrency: "USDT",
    thesis: "The NVIDIA and AWS announcement means rNVDA will rise enough by tomorrow evening to make 100 USDT net profit.",
    purchaseNotionalExcludingFee: "10000",
    horizon: { originalText: "until tomorrow evening", endAtUTC: null, timezone: null },
    goal: { kind: "profit_usdt", amount: "100" },
    exitAssumptions: {
      depthMultiplier: "1",
      priceHaircut: "0",
      depthOrigin: "illustrative_preset",
      haircutOrigin: "illustrative_preset",
    },
    scenario: { bidPriceShift: "0.003", assumptionOrigin: "illustrative_preset" },
    invalidation: null,
    feeIn: "0.001",
    feeOut: "0.001",
    feeOrigin: "published_standard_assumption",
  };
}

function initialState(): WorkbenchState {
  return {
    plan: initialPlan(),
    sourceText: CAPTURED_SOURCE_TEXT,
    sourceUrl: CAPTURED_SOURCE_URL,
    marketMode: "captured_real",
    planRevision: 1,
    thesisRevision: 1,
    scenarioRevision: 1,
    activeRequestId: 0,
    requestState: "idle",
    report: null,
    errorMessage: null,
    changedMessage: null,
    followUpMessage: "",
  };
}

function formatMoney(value: string | null, digits = 2) {
  if (value === null) return "Not available";
  try {
    return `${new Decimal(value).toFixed(digits)} USDT`;
  } catch {
    return "Not available";
  }
}

function formatNumber(value: string | null, digits = 4) {
  if (value === null) return "Not available";
  try {
    return new Decimal(value).toFixed(digits);
  } catch {
    return "Not available";
  }
}

function formatPercent(value: string | null, digits = 4) {
  if (value === null) return "Not available";
  try {
    return `${new Decimal(value).mul(100).toFixed(digits)}%`;
  } catch {
    return "Not available";
  }
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Not available";
  try {
    return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  } catch {
    return value;
  }
}

function modeLabel(mode: MarketMode | "synthetic") {
  if (mode === "captured_real") return "Captured example";
  if (mode === "live") return "Live snapshot";
  return "Synthetic test";
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function safeScenarioPercent(plan: Plan) {
  if (!plan.scenario) return "";
  try {
    return new Decimal(plan.scenario.bidPriceShift).mul(100).toString();
  } catch {
    return "";
  }
}

function IconText({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return <span className="icon-text"><span aria-hidden="true">{icon}</span>{children}</span>;
}

function StatusTag({ tone, children }: { tone: "good" | "warn" | "bad" | "neutral"; children: ReactNode }) {
  const Icon = tone === "good" ? CheckCircle : tone === "bad" ? XCircle : tone === "warn" ? WarningCircle : Info;
  return <span className={`status-tag status-${tone}`}><Icon size={15} weight="bold" aria-hidden="true" />{children}</span>;
}

function SectionHeading({ id, title, detail, icon }: { id?: string; title: string; detail?: string; icon: ReactNode }) {
  return (
    <div className="section-heading">
      <div className="section-heading-icon" aria-hidden="true">{icon}</div>
      <div>
        <h2 id={id}>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span id={id} className="field-error">{message}</span> : null;
}

function Metric({ label, value, note, emphasis = false }: { label: string; value: string; note?: string; emphasis?: boolean }) {
  return (
    <div className={`metric ${emphasis ? "metric-emphasis" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="report-skeleton" aria-label="Loading research brief" role="status">
      <div className="skeleton-line skeleton-wide" />
      <div className="skeleton-grid"><div /><div /></div>
      <div className="skeleton-line" />
      <div className="skeleton-line skeleton-short" />
    </div>
  );
}

function EmptyReport({ onReplay }: { onReplay: () => void }) {
  return (
    <div className="empty-report">
      <div className="empty-report-content">
        <div className="empty-icon" aria-hidden="true"><MagnifyingGlass size={26} weight="regular" /></div>
        <h2>Your brief will appear here</h2>
        <p>Submit a thesis to compare its source evidence with the price move required by your objective.</p>
      </div>
      <div className="empty-report-grid" aria-label="Brief output preview">
        <div className="empty-preview-item"><span>Evidence verdict</span><strong>—</strong><small>Source-grounded</small></div>
        <div className="empty-preview-item"><span>Break-even shift</span><strong>—</strong><small>After visible costs</small></div>
        <div className="empty-preview-item"><span>Goal threshold</span><strong>—</strong><small>Explicit scenario</small></div>
      </div>
      <button className="button button-secondary" type="button" onClick={onReplay}>
        <IconText icon={<ArrowClockwise size={17} weight="bold" />}>Replay captured example</IconText>
      </button>
    </div>
  );
}

function EvidencePanel({ report }: { report: ResearchResult }) {
  const tone = report.evidence.status === "assessed"
    ? report.evidence.verdict === "supported"
      ? "good"
      : report.evidence.verdict === "contradicted"
        ? "bad"
        : "warn"
    : "warn";
  return (
    <section className="report-card evidence-card" aria-labelledby="evidence-heading">
      <div className="card-topline">
        <SectionHeading id="evidence-heading" title="Evidence behind your thesis" detail="Claim review stays separate from the price scenario." icon={<FileText size={22} weight="regular" />} />
        <StatusTag tone={tone}>{humanize(report.evidence.status === "assessed" ? report.evidence.verdict : "not_assessed")}</StatusTag>
      </div>
      <div className="scope-note"><Info size={15} weight="bold" aria-hidden="true" />Scope: by the supplied evidence</div>
      <p className="panel-summary">{report.evidence.summary}</p>
      {report.evidence.mostConsequentialUnknown ? (
        <div className="unknown-callout">
          <span className="callout-label">Most consequential unknown</span>
          <p>{report.evidence.mostConsequentialUnknown}</p>
        </div>
      ) : null}
      {report.claims.length ? (
        <div className="claim-list">
          {report.claims.map((claim) => (
            <article className="claim" key={claim.claimId}>
              <div className="claim-meta"><span>{claim.distinction}</span><StatusTag tone={claim.status === "supported" ? "good" : claim.status === "contradicted" ? "bad" : "warn"}>{claim.status}</StatusTag></div>
              <h3>{claim.exactText}</h3>
              <p>{claim.explanation}</p>
              {claim.citations.map((citation) => <blockquote key={`${citation.sourceId}-${citation.startOffset}`}>{citation.excerpt}</blockquote>)}
              {claim.missingEvidence ? <small>Missing: {claim.missingEvidence}</small> : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="not-assessed">
          <WarningCircle size={20} weight="regular" aria-hidden="true" />
          <div>
            <strong>Claims were not assessed</strong>
            <p>Configure the server-only runtime model to assess the exact claim. No source verdict was invented.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function EconomicsPanel({ report }: { report: ResearchResult }) {
  const result = report.economics;
  const comparisonTone = result.goalComparison === "meets" ? "good" : result.goalComparison === "below" ? "bad" : "warn";
  const computationTone = result.computationStatus === "calculated" ? "good" : result.computationStatus === "threshold_only" ? "warn" : "bad";
  const priceReference = report.snapshot?.mode === "live" ? "Live bid prices, shifted by the scenario" : "Captured bid prices, shifted by the scenario";
  return (
    <section className="report-card economics-card" aria-labelledby="economics-heading">
      <div className="card-topline">
        <SectionHeading id="economics-heading" title="Economics under your assumptions" detail="A conditional sweep of the displayed bid and ask books." icon={<ChartLineUp size={22} weight="regular" />} />
        <StatusTag tone={computationTone}>{humanize(result.computationStatus)}</StatusTag>
      </div>
      <div className="economics-reference">
        <div><span>Price reference</span><strong>{priceReference}</strong></div>
        <div><span>Snapshot</span><strong>{modeLabel(report.snapshot?.mode ?? "synthetic")} at {formatTimestamp(report.snapshot?.exchangeTimestamp)}</strong></div>
      </div>
      <dl className="metric-grid">
        <Metric label="Entry VWAP" value={formatMoney(result.entryVWAP)} note={`${formatNumber(result.quantity)} ${result.units.baseAsset}`} emphasis />
        <Metric label="Entry cash" value={formatMoney(result.entryCash)} note="Notional plus entry fee" />
        <Metric label="Immediate friction" value={formatMoney(result.frictionProxy)} note="Static book proxy" />
        <Metric label="Break-even shift" value={formatPercent(result.breakEvenShift)} note="Before any haircut" emphasis />
        <Metric label="Goal threshold" value={formatPercent(result.requiredGoalShift)} note="Required bid-price shift" />
        <Metric label="Selected scenario" value={formatMoney(result.netPnl)} note={result.scenarioBidPriceShift ? `${formatPercent(result.scenarioBidPriceShift)} bid shift` : "No scenario selected"} />
      </dl>
      <div className={`goal-result goal-${comparisonTone}`}>
        <div><span>Objective check</span><strong>{humanize(result.goalComparison)}</strong></div>
        <p>{result.netPnl === null ? "Choose an explicit scenario to compare it with the objective." : `The selected scenario produces ${formatMoney(result.netPnl)} net PnL on entry cash.`}</p>
      </div>
      {result.effectivePriceShift && result.exitPriceHaircut !== "0" ? <p className="helper-note">Effective stressed price shift after the {formatPercent(result.exitPriceHaircut)} haircut: {formatPercent(result.effectivePriceShift)}.</p> : null}
      {result.warnings.length ? <div className="warning-list">{result.warnings.slice(-3).map((warning) => <p key={warning}><WarningCircle size={15} weight="bold" aria-hidden="true" />{warning}</p>)}</div> : null}
    </section>
  );
}

function ScenarioTable({ report }: { report: ResearchResult }) {
  return (
    <section className="report-card scenario-card" aria-labelledby="scenario-heading">
      <div className="card-topline">
        <SectionHeading id="scenario-heading" title="Scenario comparison" detail="Presets are explicit stresses, not forecasts." icon={<Lightning size={22} weight="regular" />} />
      </div>
      <div className="scenario-table-wrap">
        <table>
          <caption className="sr-only">Scenario comparison for the current order-book snapshot</caption>
          <thead><tr><th scope="col">Scenario</th><th scope="col">Bid shift</th><th scope="col">Net PnL</th><th scope="col">Goal</th></tr></thead>
          <tbody>
            {report.economics.scenarioTable.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{formatPercent(row.bidPriceShift)}</td>
                <td>{formatMoney(row.netPnl)}</td>
                <td><span className={`table-status table-${row.goalComparison}`}>{humanize(row.goalComparison)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SourcesPanel({ report }: { report: ResearchResult }) {
  return (
    <section className="report-card sources-card" aria-labelledby="sources-heading">
      <div className="card-topline">
        <SectionHeading id="sources-heading" title="Sources and provenance" detail="Dates and origin stay visible so context is not mistaken for freshness." icon={<Info size={22} weight="regular" />} />
      </div>
      <div className="source-list">
        {report.sources.length ? report.sources.map((source) => (
          <details key={source.id} className="source-item" open>
            <summary><span>{source.title}</span><CaretDown size={18} aria-hidden="true" /></summary>
            <div className="source-details">
              <p><span>Publisher</span>{source.publisher}</p>
              <p><span>Publication date</span>{source.publicationDate ?? "Unknown"}</p>
              <p><span>Event date</span>{source.eventDate ?? "Unknown"}</p>
              <p><span>Provenance</span>{source.provenance.replaceAll("_", " ")}</p>
              <p><span>Retrieved</span>{formatTimestamp(source.fetchedAt)}</p>
              <p><span>Text hash</span><code>{source.textHash.slice(0, 16)}...</code></p>
              {source.originalUrl ? <a href={source.originalUrl} target="_blank" rel="noreferrer">Open supplied URL</a> : null}
              <p className="source-note">Pasted text is retained as unverified source material. An official-looking URL does not authenticate it.</p>
            </div>
          </details>
        )) : <p className="muted-copy">No source document was supplied.</p>}
      </div>
    </section>
  );
}

function ChangePanel({ report }: { report: ResearchResult }) {
  return (
    <section className="change-panel" aria-labelledby="change-heading">
      <div className="change-icon" aria-hidden="true"><Target size={21} weight="regular" /></div>
      <div>
        <h2 id="change-heading">What could change this assessment?</h2>
        <div className="change-grid">
          <div><span>Evidence condition</span><p>A validated passage could confirm or contradict the exact causal or forecast claim.</p></div>
          <div><span>Numerical condition</span><p>A new order-book snapshot or different exit-depth assumption could change the threshold.</p></div>
        </div>
        {report.limitations.length ? <details className="limitations"><summary>Limits of this brief <CaretDown size={17} aria-hidden="true" /></summary><ul>{report.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></details> : null}
      </div>
    </section>
  );
}

export default function Workbench() {
  const [state, dispatch] = useReducer(revisionReducer, undefined, initialState);
  const [followUpDraft, setFollowUpDraft] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const planErrors = useMemo(() => {
    const parsed = PlanSchema.safeParse(state.plan);
    if (parsed.success) return {} as Record<string, string>;
    return parsed.error.issues.reduce<Record<string, string>>((errors, issue) => {
      const path = issue.path.join(".");
      if (path && !errors[path]) errors[path] = issue.message;
      return errors;
    }, {});
  }, [state.plan]);

  function fieldDescribedBy(helpId: string, errorPath: string) {
    return planErrors[errorPath] ? `${helpId} ${errorPath.replaceAll(".", "-")}-error` : helpId;
  }

  const reportIsCurrent = Boolean(
    state.report
      && state.report.inputRevision === state.planRevision
      && state.report.snapshot?.mode === state.marketMode,
  );
  const scenarioPercent = useMemo(() => safeScenarioPercent(state.plan), [state.plan]);
  const isBusy = state.requestState === "submitting" || state.requestState === "refreshing";

  function commitPlan(nextPlan: Plan, message: string, evidenceChanged: boolean) {
    dispatch({ type: "set-plan", plan: nextPlan, changedMessage: message, evidenceChanged });
  }

  function setAsset(asset: Asset) {
    commitPlan({ ...state.plan, asset }, `Asset changed to r${asset}. Market data will be reloaded on submit.`, true);
  }

  function submitResearch(overrides?: { plan?: Plan; sourceText?: string; sourceUrl?: string; marketMode?: MarketMode; inputRevision?: number }) {
    const nextPlan = overrides?.plan ?? state.plan;
    const nextSource = overrides?.sourceText ?? state.sourceText;
    const nextUrl = overrides?.sourceUrl ?? state.sourceUrl;
    const nextMode = overrides?.marketMode ?? state.marketMode;
    const requestId = state.activeRequestId + 1;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "begin-request", requestId, requestState: nextMode === "live" ? "refreshing" : "submitting" });
    void fetch("/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plan: nextPlan,
        sourceText: nextSource.trim() ? nextSource : null,
        sourceUrl: nextUrl.trim() ? nextUrl : null,
        marketMode: nextMode,
        inputRevision: overrides?.inputRevision ?? state.planRevision,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as ResearchResult | { error?: string };
        if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "The research request could not be completed.");
        return payload as ResearchResult;
      })
      .then((report) => dispatch({ type: "request-success", requestId, report }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        dispatch({ type: "request-error", requestId, message: error instanceof Error ? error.message : "The research request could not be completed." });
      });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = PlanSchema.safeParse(state.plan);
    if (!parsed.success) {
      dispatch({ type: "request-error", requestId: state.activeRequestId, message: parsed.error.issues[0]?.message ?? "Check the highlighted plan fields." });
      return;
    }
    submitResearch({ plan: parsed.data });
  }

  function replayCapturedExample() {
    const replayPlan = initialPlan();
    dispatch({ type: "set-plan", plan: replayPlan, changedMessage: "Captured example loaded. The market snapshot is historical replay data.", evidenceChanged: true });
    dispatch({ type: "set-source-text", sourceText: CAPTURED_SOURCE_TEXT });
    dispatch({ type: "set-source-url", sourceUrl: CAPTURED_SOURCE_URL });
    dispatch({ type: "set-market-mode", marketMode: "captured_real", changedMessage: "Captured example selected. No live fallback is used." });
    submitResearch({ plan: replayPlan, sourceText: CAPTURED_SOURCE_TEXT, sourceUrl: CAPTURED_SOURCE_URL, marketMode: "captured_real", inputRevision: state.planRevision + 3 });
  }

  async function applyFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = followUpDraft.trim();
    if (!message) return;
    setFollowUpDraft("");
    try {
      const response = await fetch("/api/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, plan: state.plan }),
      });
      const result = await response.json() as { plan?: Plan; changed?: string[]; clarification?: string | null; refreshMarket?: boolean; error?: string };
      if (!response.ok || !result.plan) throw new Error(result.error ?? "The follow-up could not be parsed.");
      if (result.changed?.length) {
        const nextPlan = result.plan;
        const evidenceChanged = result.changed.some((item) => item.includes("thesis"));
        commitPlan(nextPlan, `Changed: ${result.changed.join(", ")}.`, evidenceChanged);
        if (result.refreshMarket) {
          dispatch({ type: "set-market-mode", marketMode: "live", changedMessage: "Changed: live market refresh requested." });
          submitResearch({ plan: nextPlan, marketMode: "live", inputRevision: state.planRevision + 1 });
        } else if (state.report && result.changed.some((item) => item.includes("notional") || item.includes("goal") || item.includes("scenario") || item.includes("depth"))) {
          submitResearch({ plan: nextPlan, inputRevision: state.planRevision + 1 });
        }
      }
      if (result.clarification) dispatch({ type: "set-changed-message", changedMessage: result.clarification });
    } catch (error) {
      dispatch({ type: "set-changed-message", changedMessage: error instanceof Error ? error.message : "The follow-up could not be parsed." });
    }
  }

  function download(kind: "markdown" | "json") {
    if (!state.report || !reportIsCurrent) return;
    const content = kind === "markdown" ? toMarkdown(state.report) : toJson(state.report);
    const blob = new Blob([content], { type: kind === "markdown" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `thesisgate-${state.report.reportId}.${kind === "markdown" ? "md" : "json"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const goalKind = state.plan.goal?.kind ?? "none";

  return (
    <main className="app-shell" data-theme="cobalt">
      <a className="skip-link" href="#workbench">Skip to workbench</a>
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><Image className="brand-logo" src="/brand/thesisgate-mark.png" alt="" width={32} height={36} priority /></div>
          <div><strong>ThesisGate</strong><span>Research workbench</span></div>
        </div>
        <div className="header-right">
          <nav className="header-nav" aria-label="Primary navigation">
            <a className="header-cta" href="#workbench">Open workbench <span aria-hidden="true">↘</span></a>
          </nav>
          <div className="header-status">
            <span className="status-led" aria-hidden="true" />
            <span>{state.marketMode === "captured_real" ? "Captured data" : "Live data selected"}</span>
            <span className="header-divider" aria-hidden="true" />
            <span>SPOT only</span>
          </div>
        </div>
      </header>

      <section className="intro-block" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Source plus scenario</p>
          <h1 id="page-title">Stress-test the trade behind the headline.</h1>
          <p className="intro-copy">Compare source evidence with the costs, price thresholds, and unknowns of a stock-linked token using an explicit scenario, not a forecast.</p>
        </div>
        <div className="intro-note"><Info size={17} weight="bold" aria-hidden="true" /><span>The human makes the trading decision. This tool does not place orders.</span></div>
      </section>

      <div id="workbench" className="workbench-layout">
        <form id="plan" className="plan-panel" onSubmit={handleSubmit} noValidate>
          <div className="panel-heading">
            <div><span className="panel-kicker">Your plan</span><h2>Make the claim precise.</h2></div>
            <span className="panel-index">01</span>
          </div>
          <p className="panel-intro">Start with the exact statement you want to test. Paste the relevant source passage below.</p>

          <fieldset>
            <legend>Thesis and source</legend>
            <label htmlFor="thesis">What do you think will happen?</label>
            <textarea id="thesis" value={state.plan.thesis} onChange={(event) => commitPlan({ ...state.plan, thesis: event.target.value }, "Thesis changed. The prior evidence result is now previous context.", true)} rows={5} maxLength={4000} aria-invalid={Boolean(planErrors.thesis)} aria-describedby={fieldDescribedBy("thesis-help", "thesis")} />
            <span id="thesis-help" className="field-help">Separate what the source says from what you expect price to do.</span>
            <FieldError id="thesis-error" message={planErrors.thesis} />

            <label htmlFor="source-text">Source text <span className="required">required for evidence</span></label>
            <textarea id="source-text" value={state.sourceText} onChange={(event) => dispatch({ type: "set-source-text", sourceText: event.target.value })} rows={6} maxLength={60000} aria-describedby="source-text-help" />
            <span id="source-text-help" className="field-help">Paste a bounded passage. URL retrieval is disabled until its SSRF gate is complete.</span>

            <label htmlFor="source-url">Source URL <span className="optional">optional reference</span></label>
            <input id="source-url" type="url" value={state.sourceUrl} onChange={(event) => dispatch({ type: "set-source-url", sourceUrl: event.target.value })} placeholder="https://official-source.example/article" />
          </fieldset>

          <fieldset>
            <legend>Trade inputs</legend>
            <div className="field-grid field-grid-two">
              <div className="field-block">
                <label htmlFor="asset">Asset</label>
                <select id="asset" value={state.plan.asset} onChange={(event) => setAsset(event.target.value as Asset)}>
                  <option value="NVDA">rNVDA</option>
                  <option value="TSLA">rTSLA</option>
                </select>
                <span className="field-help">Reality SPOT token</span>
              </div>
              <div className="field-block">
                <label htmlFor="notional">Purchase notional excluding fee</label>
                <div className="unit-input"><input id="notional" type="number" min="0" step="0.01" inputMode="decimal" value={state.plan.purchaseNotionalExcludingFee} onChange={(event) => commitPlan({ ...state.plan, purchaseNotionalExcludingFee: event.target.value }, "Purchase notional changed. Economics will be recomputed.", false)} aria-invalid={Boolean(planErrors.purchaseNotionalExcludingFee)} aria-describedby={fieldDescribedBy("notional-help", "purchaseNotionalExcludingFee")} /><span>USDT</span></div>
                <span id="notional-help" className="field-help">The entry fee is additional cash.</span>
                <FieldError id="purchaseNotionalExcludingFee-error" message={planErrors.purchaseNotionalExcludingFee} />
              </div>
            </div>
            <label htmlFor="horizon">Holding horizon</label>
            <input id="horizon" type="text" value={state.plan.horizon.originalText} onChange={(event) => commitPlan({ ...state.plan, horizon: { ...state.plan.horizon, originalText: event.target.value } }, "Horizon changed. Evidence will be reassessed.", true)} placeholder="Until tomorrow evening" aria-invalid={Boolean(planErrors["horizon.originalText"])} aria-describedby={fieldDescribedBy("horizon-help", "horizon.originalText")} />
            <span id="horizon-help" className="field-help">Context only. The static book does not model time dynamics.</span>
            <FieldError id="horizon-originalText-error" message={planErrors["horizon.originalText"]} />

            <label htmlFor="goal-kind">Objective</label>
            <select id="goal-kind" value={goalKind} onChange={(event) => {
              const kind = event.target.value;
              const goal = kind === "break_even" ? { kind: "break_even" as const } : kind === "profit_usdt" ? { kind: "profit_usdt" as const, amount: "100" } : kind === "net_return" ? { kind: "net_return" as const, fractionOfEntryCash: "0.01" } : null;
              commitPlan({ ...state.plan, goal }, "Objective changed. Evidence is unchanged.", false);
            }}>
              <option value="none">No stated objective</option>
              <option value="break_even">Break even</option>
              <option value="profit_usdt">Net profit in USDT</option>
              <option value="net_return">Net return on entry cash</option>
            </select>
            {state.plan.goal?.kind === "profit_usdt" ? <div className="unit-input"><input aria-label="Profit objective amount" type="number" min="0" step="0.01" inputMode="decimal" value={state.plan.goal.amount} onChange={(event) => commitPlan({ ...state.plan, goal: { kind: "profit_usdt", amount: event.target.value } }, "Profit objective changed. Evidence is unchanged.", false)} /><span>USDT profit</span></div> : null}
            {state.plan.goal?.kind === "net_return" ? <div className="unit-input"><input aria-label="Net return objective percentage" type="number" min="0" step="0.01" inputMode="decimal" value={new Decimal(state.plan.goal.fractionOfEntryCash || "0").mul(100).toString()} onChange={(event) => commitPlan({ ...state.plan, goal: { kind: "net_return", fractionOfEntryCash: new Decimal(event.target.value || "0").div(100).toString() } }, "Return objective changed. Evidence is unchanged.", false)} /><span>% of entry cash</span></div> : null}
          </fieldset>

          <fieldset>
            <legend>Price scenario</legend>
            <label htmlFor="scenario">Bid-price shift on exit</label>
            <div className="unit-input"><input id="scenario" type="number" step="0.1" inputMode="decimal" value={scenarioPercent} onChange={(event) => {
              const raw = event.target.value;
              try {
                const shift = new Decimal(raw || "0").div(100).toString();
                commitPlan({ ...state.plan, scenario: { bidPriceShift: shift, assumptionOrigin: "user" } }, "Scenario changed. Evidence is unchanged.", false);
              } catch {
                commitPlan({ ...state.plan, scenario: null }, "Enter a valid percentage scenario.", false);
              }
            }} /><span>% vs selected bids</span></div>
            <div className="preset-row" aria-label="Scenario presets">
              {["-3", "0", "0.3", "1", "3"].map((preset) => <button key={preset} type="button" className={`preset ${scenarioPercent === preset ? "preset-active" : ""}`} onClick={() => commitPlan({ ...state.plan, scenario: { bidPriceShift: new Decimal(preset).div(100).toString(), assumptionOrigin: "illustrative_preset" } }, `${preset}% bid-price scenario selected. Evidence is unchanged.`, false)}>{Number(preset) > 0 ? "+" : ""}{preset}%</button>)}
            </div>
            <span className="field-help">This is not a native equity return or a price prediction.</span>
          </fieldset>

          <details className="assumptions-disclosure">
            <summary><span>Fees and exit assumptions</span><CaretDown size={17} aria-hidden="true" /></summary>
            <div className="assumptions-body">
              <div className="field-grid field-grid-two">
                <div className="field-block"><label htmlFor="fee-in">Entry fee</label><div className="unit-input"><input id="fee-in" type="number" min="0" step="0.01" value={new Decimal(state.plan.feeIn || "0").mul(100).toString()} onChange={(event) => commitPlan({ ...state.plan, feeIn: new Decimal(event.target.value || "0").div(100).toString(), feeOrigin: "user_supplied" }, "Entry fee changed. Evidence is unchanged.", false)} /><span>%</span></div></div>
                <div className="field-block"><label htmlFor="fee-out">Exit fee</label><div className="unit-input"><input id="fee-out" type="number" min="0" step="0.01" value={new Decimal(state.plan.feeOut || "0").mul(100).toString()} onChange={(event) => commitPlan({ ...state.plan, feeOut: new Decimal(event.target.value || "0").div(100).toString(), feeOrigin: "user_supplied" }, "Exit fee changed. Evidence is unchanged.", false)} /><span>%</span></div></div>
                <div className="field-block"><label htmlFor="depth">Available exit depth</label><div className="unit-input"><input id="depth" type="number" min="0" max="100" step="1" value={new Decimal(state.plan.exitAssumptions.depthMultiplier || "0").mul(100).toString()} onChange={(event) => commitPlan({ ...state.plan, exitAssumptions: { ...state.plan.exitAssumptions, depthMultiplier: new Decimal(event.target.value || "0").div(100).toString(), depthOrigin: "user" } }, "Exit depth changed. Evidence is unchanged.", false)} /><span>%</span></div></div>
                <div className="field-block"><label htmlFor="haircut">Additional exit haircut</label><div className="unit-input"><input id="haircut" type="number" min="0" max="99.99" step="0.1" value={new Decimal(state.plan.exitAssumptions.priceHaircut || "0").mul(100).toString()} onChange={(event) => commitPlan({ ...state.plan, exitAssumptions: { ...state.plan.exitAssumptions, priceHaircut: new Decimal(event.target.value || "0").div(100).toString(), haircutOrigin: "user" } }, "Exit haircut changed. Evidence is unchanged.", false)} /><span>%</span></div></div>
              </div>
              <p className="assumption-note">Default fees are a published standard scenario, not an account-tier lookup. Exit depth scales quantities while retaining the original bought position.</p>
            </div>
          </details>

          <fieldset className="mode-fieldset">
            <legend>Market data mode</legend>
            <div className="mode-options">
              <label className={`mode-option ${state.marketMode === "captured_real" ? "mode-selected" : ""}`}><input type="radio" name="market-mode" checked={state.marketMode === "captured_real"} onChange={() => dispatch({ type: "set-market-mode", marketMode: "captured_real", changedMessage: "Captured example selected. It is historical replay data." })} /><span><strong>Captured example</strong><small>Sep 8 selection snapshot</small></span></label>
              <label className={`mode-option ${state.marketMode === "live" ? "mode-selected" : ""}`}><input type="radio" name="market-mode" checked={state.marketMode === "live"} onChange={() => dispatch({ type: "set-market-mode", marketMode: "live", changedMessage: "Live market data selected. Failed refreshes will not fall back to fixtures." })} /><span><strong>Attempt live data</strong><small>Public Bitget market endpoints</small></span></label>
            </div>
          </fieldset>

          <button className="button button-primary submit-button" type="submit" disabled={isBusy}>
            {isBusy ? <IconText icon={<CircleNotch size={18} className="spin" aria-hidden="true" />}>Building brief</IconText> : <IconText icon={<Target size={18} weight="bold" />}>Stress-test my thesis</IconText>}
          </button>
          <p className="button-note"><Info size={14} weight="bold" aria-hidden="true" /> No order placement. No price forecast.</p>
        </form>

        <section id="report" className="report-column" aria-live="polite">
          <div className="report-header">
            <div><span className="panel-kicker">Research brief</span><h2>Keep the conclusions distinct.</h2></div>
            <div className="report-actions">
              <button className="button button-quiet" type="button" onClick={() => download("markdown")} disabled={!state.report || !reportIsCurrent}><IconText icon={<DownloadSimple size={16} aria-hidden="true" />}>Markdown</IconText></button>
              <button className="button button-quiet" type="button" onClick={() => download("json")} disabled={!state.report || !reportIsCurrent}><IconText icon={<DownloadSimple size={16} aria-hidden="true" />}>JSON</IconText></button>
            </div>
          </div>
          {state.changedMessage ? <div className="change-banner" role="status"><Info size={16} weight="bold" aria-hidden="true" /><span>{state.changedMessage}</span></div> : null}
          {state.errorMessage ? <div className="error-banner" role="alert"><WarningCircle size={17} weight="bold" aria-hidden="true" /><div><strong>Could not update the brief</strong><p>{state.errorMessage}</p><button className="text-button" type="button" onClick={() => submitResearch()}>Retry</button></div></div> : null}
          {isBusy && !state.report ? <ReportSkeleton /> : state.report ? (
            <>
              {!reportIsCurrent ? <div className="stale-banner" role="status"><Info size={16} weight="bold" aria-hidden="true" /><span>This report is from an earlier plan or market mode. Submit again before exporting.</span></div> : null}
              <div className="report-grid"><EvidencePanel report={state.report} /><EconomicsPanel report={state.report} /></div>
              <ScenarioTable report={state.report} />
              <SourcesPanel report={state.report} />
              <ChangePanel report={state.report} />
              {state.report.partialErrors.length ? <details className="partial-details"><summary>Partial outcomes and recovery <CaretDown size={17} aria-hidden="true" /></summary><ul>{state.report.partialErrors.map((item) => <li key={`${item.kind}-${item.message}`}><strong>{humanize(item.kind)}</strong><span>{item.message}</span><small>Recovery: {item.recovery}</small></li>)}</ul></details> : null}
            </>
          ) : <EmptyReport onReplay={replayCapturedExample} />}

          <form className="follow-up" onSubmit={applyFollowUp}>
            <label htmlFor="follow-up">Follow-up edit</label>
            <div className="follow-up-row"><input id="follow-up" value={followUpDraft} onChange={(event) => setFollowUpDraft(event.target.value)} placeholder="Try: Halve the amount" /><button className="button button-secondary" type="submit" disabled={isBusy}><IconText icon={<ArrowClockwise size={16} weight="bold" />}>Apply edit</IconText></button></div>
            <span className="field-help">Supported edits update only the fields they name. Ambiguous percentage references ask for clarification.</span>
          </form>
        </section>
      </div>
      <footer className="app-footer"><span>ThesisGate is a conditional research tool.</span><span>Market snapshots are not fills.</span><span>Model and source status stays visible.</span></footer>
    </main>
  );
}
