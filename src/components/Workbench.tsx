"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";
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
import { InstrumentSchema, MAX_SOURCE_CHARS, MarketSnapshotSchema, PlanSchema, RecomputeResultSchema, ResearchResultSchema, type Asset, type Instrument, type MarketSnapshot, type Plan, type ResearchResult } from "@/domain/contracts";
import { TelemetryEventSchema, type TelemetryEvent } from "@/domain/telemetry";
import { revisionReducer, type MarketMode, type WorkbenchState } from "@/domain/revisions";

const CAPTURED_SOURCE_URL = "https://nvidianews.nvidia.com/news/aws-and-nvidia-to-deliver-2-million-additional-gpus-and-next-generation-infrastructure-for-agentic-and-physical-ai";
const CAPTURED_SOURCE_TEXT = `NVIDIA and AWS announced a planned expansion of AI infrastructure on August 26, 2026. The announcement describes additional NVIDIA GPU deployments across AWS data centers, with further systems planned for 2027 to 2028. The source describes planned infrastructure and future deployment. It does not state that the deployment is already producing revenue or provide a price forecast.`;
const DRAFT_STORAGE_KEY = "thesisgate.draft.v1";
const TELEMETRY_CONSENT_KEY = "thesisgate.telemetry-consent.v1";
const APPROVED_SOURCE_HOSTS = new Set(["nvidianews.nvidia.com", "investor.nvidia.com", "ir.tesla.com"]);

type DraftPayload = {
  version: 1;
  savedAt: string;
  plan: Plan;
  sourceText: string;
  sourceUrl: string;
  marketMode: MarketMode;
};

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

function ageSeconds(value: string | null | undefined, now: number) {
  if (!value) return null;
  const receivedAt = new Date(value).getTime();
  if (!Number.isFinite(receivedAt)) return null;
  return Math.max(0, Math.floor((now - receivedAt) / 1000));
}

function formatAge(value: string | null | undefined, now: number) {
  const seconds = ageSeconds(value, now);
  if (seconds === null) return "Age unavailable";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s old`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m old`;
  return `${Math.floor(minutes / 60)}h old`;
}

function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined) return "Not measured";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function formatProviderCost(value: string | null | undefined) {
  if (value === null || value === undefined) return "Not reported by provider";
  try {
    return `${new Decimal(value).toFixed(6)} USD`;
  } catch {
    return "Not reported by provider";
  }
}

function canonicalSuppliedUrl(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.includes(":") || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function suppliedUrlDomain(value: string | null) {
  if (!value) return "Not supplied";
  const canonical = canonicalSuppliedUrl(value);
  return canonical ? new URL(canonical).hostname : "Invalid supplied URL";
}

function sourceUrlIssue(value: string, hasSource: boolean) {
  if (!value.trim()) return null;
  const canonical = canonicalSuppliedUrl(value);
  if (!canonical) {
    return {
      message: "The supplied source URL is not eligible for retrieval: use an HTTPS URL without credentials or a custom port.",
      recovery: "Keep the URL as context if useful, but paste the relevant source text for this first slice.",
    };
  }
  if (!APPROVED_SOURCE_HOSTS.has(new URL(canonical).hostname)) {
    return {
      message: "The supplied source URL is not eligible for retrieval: this host is not in the initial official-source allowlist.",
      recovery: "Keep the URL as context if useful, but paste the relevant source text for this first slice.",
    };
  }
  if (!hasSource) {
    return {
      message: "The source URL was retained as an unverified reference, but URL retrieval is disabled.",
      recovery: "Paste the source text to continue, then re-run the brief.",
    };
  }
  return null;
}

function normalizeSourceText(value: string) {
  const canonical = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return canonical.slice(0, MAX_SOURCE_CHARS);
}

function evidenceInputsMatch(report: ResearchResult, plan: Plan, sourceText: string) {
  const reportPlan = report.confirmedPlan;
  const samePlan = JSON.stringify({
    asset: reportPlan.asset,
    thesis: reportPlan.thesis,
    horizon: reportPlan.horizon,
    invalidation: reportPlan.invalidation,
  }) === JSON.stringify({
    asset: plan.asset,
    thesis: plan.thesis,
    horizon: plan.horizon,
    invalidation: plan.invalidation,
  });
  const normalizedSource = normalizeSourceText(sourceText);
  const reportSource = report.sources[0]?.cleanedText ?? "";
  return samePlan && reportSource === normalizedSource && Boolean(report.instrument && report.snapshot);
}

function parseDraft(value: unknown): DraftPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const parsedPlan = PlanSchema.safeParse(candidate.plan);
  if (!parsedPlan.success) return null;
  if (candidate.version !== 1 || typeof candidate.savedAt !== "string" || typeof candidate.sourceText !== "string" || typeof candidate.sourceUrl !== "string") return null;
  if (candidate.sourceText.length > 60_000 || candidate.sourceUrl.length > 2_000) return null;
  if (candidate.marketMode !== "captured_real" && candidate.marketMode !== "live") return null;
  return {
    version: 1,
    savedAt: candidate.savedAt,
    plan: parsedPlan.data,
    sourceText: candidate.sourceText,
    sourceUrl: candidate.sourceUrl,
    marketMode: candidate.marketMode,
  };
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
            <p>No claim verdict was invented. When enabled, the server-only model can assess the exact claim against the supplied text.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function EconomicsPanel({ report, now, onRefresh, isRefreshing }: { report: ResearchResult; now: number; onRefresh: () => void; isRefreshing: boolean }) {
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
        <div className="snapshot-age">
          <span>{report.snapshot?.mode === "live" ? "Exchange data age" : "Captured at"}</span>
          <strong className={report.snapshot?.mode === "live" && (ageSeconds(report.snapshot.exchangeTimestamp, now) ?? 0) > 30 ? "snapshot-age-warning" : undefined}>{report.snapshot?.mode === "live" ? `${formatAge(report.snapshot.exchangeTimestamp, now)} · received ${formatTimestamp(report.snapshot.receivedAt)}` : `${formatTimestamp(report.snapshot?.receivedAt)} · historical replay`}</strong>
          {report.snapshot?.mode === "live" ? <button className="button button-quiet refresh-button" type="button" onClick={onRefresh} disabled={isRefreshing}><IconText icon={<ArrowClockwise size={15} className={isRefreshing ? "spin" : undefined} aria-hidden="true" />}>{isRefreshing ? "Refreshing" : "Refresh live snapshot"}</IconText></button> : null}
        </div>
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
              <p><span>Supplied URL domain</span>{suppliedUrlDomain(source.originalUrl)}</p>
              <p><span>Publication date</span>{source.publicationDate ?? "Unknown"}</p>
              <p><span>Event date</span>{source.eventDate ?? "Unknown"}</p>
              <p><span>Provenance</span>{source.provenance.replaceAll("_", " ")}</p>
              <p><span>Text received</span>{formatTimestamp(source.fetchedAt)}</p>
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

function RunDetails({ report }: { report: ResearchResult }) {
  const performance = report.performance;
  return (
    <details className="run-details">
      <summary><span>Run details</span><CaretDown size={17} aria-hidden="true" /></summary>
      <div className="run-details-grid">
        <p><span>Claim model</span><strong>{report.modelId ?? "Not configured"}</strong></p>
        <p><span>Total duration</span><strong>{formatDuration(performance.totalDurationMs)}</strong></p>
        <p><span>Market request</span><strong>{formatDuration(performance.marketDurationMs)}</strong></p>
        <p><span>Model request</span><strong>{performance.reusedEvidence ? "Reused, no new call" : formatDuration(performance.modelDurationMs)}</strong></p>
        <p><span>Model calls in brief</span><strong>{performance.modelCalls}</strong></p>
        <p><span>Provider cost</span><strong>{performance.reusedEvidence ? "No new cost" : formatProviderCost(performance.modelUsage?.costUsd)}</strong></p>
      </div>
      <p className="run-details-note">Provider cost is shown only when the provider reports it. A missing cost is not treated as zero.</p>
    </details>
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
  const [clock, setClock] = useState(() => Date.now());
  const [savedDraft, setSavedDraft] = useState<DraftPayload | null>(null);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [telemetryConsent, setTelemetryConsent] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestCounterRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartedRef = useRef(false);
  const telemetryConsentRef = useRef(false);

  const track = useCallback((event: TelemetryEvent["event"], details: Omit<Partial<TelemetryEvent>, "event" | "sessionId" | "occurredAt"> = {}) => {
    if (process.env.NEXT_PUBLIC_TELEMETRY_ENABLED !== "true" || !telemetryConsentRef.current) return;
    if (!sessionIdRef.current) {
      sessionIdRef.current = typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `tg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
    const parsed = TelemetryEventSchema.safeParse({
      event,
      sessionId: sessionIdRef.current,
      occurredAt: new Date().toISOString(),
      ...details,
    });
    if (!parsed.success) return;
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
        if (active && raw) setSavedDraft(parseDraft(JSON.parse(raw) as unknown));
        const consent = window.localStorage.getItem(TELEMETRY_CONSENT_KEY) === "yes";
        telemetryConsentRef.current = consent;
        if (active) setTelemetryConsent(consent);
      } catch {
        if (active) setSavedDraft(null);
      }
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    track("session_started", { marketMode: state.marketMode });
  }, [track, state.marketMode]);

  useEffect(() => {
    /* Keep the previous cleanup separate from browser draft hydration. */
    return () => controllerRef.current?.abort();
  }, []);

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

  function beginRequest(nextMode: MarketMode) {
    const requestId = Math.max(requestCounterRef.current, state.activeRequestId) + 1;
    requestCounterRef.current = requestId;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "begin-request", requestId, requestState: nextMode === "live" ? "refreshing" : "submitting" });
    return { requestId, controller, startedAt: performance.now() };
  }

  async function responsePayload(response: Response, fallback: string) {
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : fallback);
    return payload;
  }

  function submitEconomics(nextPlan: Plan, nextMode: MarketMode, inputRevision: number, refreshMarket: boolean, nextSourceUrl: string) {
    const baseReport = state.report;
    if (!baseReport?.instrument || !baseReport.snapshot || !baseReport.recomputeToken) return;
    const request = beginRequest(nextMode);
    track("brief_submitted", { marketMode: nextMode, reusedEvidence: true, modelConfigured: Boolean(baseReport.modelId) });
    void (async () => {
      let instrument: Instrument = baseReport.instrument as Instrument;
      let snapshot: MarketSnapshot = baseReport.snapshot as MarketSnapshot;
      let recomputeToken = baseReport.recomputeToken;
      const sourceReference = canonicalSuppliedUrl(nextSourceUrl);
      let marketDurationMs: number | null = null;
      try {
        if (refreshMarket || snapshot.mode !== nextMode) {
          const marketStartedAt = performance.now();
          const marketResponse = await fetch("/api/market", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ asset: nextPlan.asset, mode: nextMode }),
            signal: request.controller.signal,
          });
          const marketPayload = await responsePayload(marketResponse, "The market snapshot could not be refreshed.");
          const parsedInstrument = InstrumentSchema.safeParse(marketPayload.instrument);
          const parsedSnapshot = MarketSnapshotSchema.safeParse(marketPayload.snapshot);
          if (!parsedInstrument.success || !parsedSnapshot.success || typeof marketPayload.recomputeToken !== "string") throw new Error("The refreshed market response did not match the expected contract.");
          instrument = parsedInstrument.data;
          snapshot = parsedSnapshot.data;
          recomputeToken = marketPayload.recomputeToken;
          marketDurationMs = Math.max(0, Math.round(performance.now() - marketStartedAt));
        }

        const recomputeResponse = await fetch("/api/recompute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan: nextPlan, instrument, snapshot, recomputeToken, planRevision: inputRevision, scenarioRevision: inputRevision }),
          signal: request.controller.signal,
        });
        const recompute = RecomputeResultSchema.parse(await responsePayload(recomputeResponse, "The economics could not be recomputed."));
        const partialErrors: ResearchResult["partialErrors"] = baseReport.partialErrors.filter((item) => !["insufficient_depth", "market_unavailable", "market_invalid", "source_unavailable"].includes(item.kind));
        const urlIssue = sourceUrlIssue(nextSourceUrl, baseReport.sources.length > 0);
        if (urlIssue) partialErrors.push({ kind: "source_unavailable", ...urlIssue });
        if (recompute.economics.computationStatus === "insufficient_depth") {
          partialErrors.push({
            kind: "insufficient_depth",
            message: "The requested position or stressed exit could not be filled by the displayed depth.",
            recovery: "Reduce the notional or exit-depth stress, then re-run with the limitation visible.",
          });
        }
        const report: ResearchResult = {
          ...baseReport,
          reportId: recompute.reportId,
          inputRevision,
          reportRevision: recompute.reportRevision,
          confirmedPlan: nextPlan,
          instrument,
          snapshot,
          recomputeToken,
          sources: baseReport.sources.map((source, index) => index === 0
            ? {
                ...source,
                originalUrl: sourceReference,
                publisher: sourceReference ? new URL(sourceReference).hostname : "User supplied source",
              }
            : source),
          economics: recompute.economics,
          economicsInputHash: recompute.economicsInputHash,
          performance: {
            ...recompute.performance,
            totalDurationMs: Math.max(0, Math.round(performance.now() - request.startedAt)),
            marketDurationMs,
            reusedEvidence: true,
          },
          partialErrors,
          generatedAt: recompute.generatedAt,
        };
        dispatch({ type: "request-success", requestId: request.requestId, report });
        track("brief_completed", {
          marketMode: nextMode,
          durationMs: report.performance.totalDurationMs,
          evidenceStatus: report.evidence.status,
          computationStatus: report.economics.computationStatus,
          reusedEvidence: true,
          modelConfigured: Boolean(report.modelId),
        });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "The economics could not be recomputed.";
        dispatch({ type: "request-error", requestId: request.requestId, message });
        track("brief_failed", { marketMode: nextMode, durationMs: Math.max(0, Math.round(performance.now() - request.startedAt)), reusedEvidence: true, errorKind: "network" });
      }
    })();
  }

  function submitResearch(overrides?: { plan?: Plan; sourceText?: string; sourceUrl?: string; marketMode?: MarketMode; inputRevision?: number; forceMarketRefresh?: boolean }) {
    const nextPlan = overrides?.plan ?? state.plan;
    const nextSource = overrides?.sourceText ?? state.sourceText;
    const nextUrl = overrides?.sourceUrl ?? state.sourceUrl;
    const nextMode = overrides?.marketMode ?? state.marketMode;
    const inputRevision = overrides?.inputRevision ?? state.planRevision;
    const canReuseEvidence = Boolean(state.report && state.report.recomputeToken && evidenceInputsMatch(state.report, nextPlan, nextSource));
    if (canReuseEvidence) {
      submitEconomics(nextPlan, nextMode, inputRevision, Boolean(overrides?.forceMarketRefresh) || state.report?.snapshot?.mode !== nextMode, nextUrl);
      return;
    }

    const request = beginRequest(nextMode);
    track("brief_submitted", { marketMode: nextMode, reusedEvidence: false });
    void fetch("/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        plan: nextPlan,
        sourceText: nextSource.trim() ? nextSource : null,
        sourceUrl: nextUrl.trim() ? nextUrl : null,
        marketMode: nextMode,
        inputRevision,
      }),
      signal: request.controller.signal,
    })
      .then((response) => responsePayload(response, "The research request could not be completed."))
      .then((payload) => {
        const report = ResearchResultSchema.parse(payload);
        dispatch({ type: "request-success", requestId: request.requestId, report });
        track("brief_completed", {
          marketMode: nextMode,
          durationMs: report.performance?.totalDurationMs ?? Math.max(0, Math.round(performance.now() - request.startedAt)),
          evidenceStatus: report.evidence?.status,
          computationStatus: report.economics?.computationStatus,
          reusedEvidence: false,
          modelConfigured: Boolean(report.modelId),
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error ? error.message : "The research request could not be completed.";
        dispatch({ type: "request-error", requestId: request.requestId, message });
        track("brief_failed", { marketMode: nextMode, durationMs: Math.max(0, Math.round(performance.now() - request.startedAt)), reusedEvidence: false, errorKind: "network" });
      });
  }

  function saveDraft() {
    const draft: DraftPayload = {
      version: 1,
      savedAt: new Date().toISOString(),
      plan: state.plan,
      sourceText: state.sourceText,
      sourceUrl: state.sourceUrl,
      marketMode: state.marketMode,
    };
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      setSavedDraft(draft);
      setDraftStatus("Draft saved in this browser only.");
      track("draft_saved", { marketMode: state.marketMode });
    } catch {
      setDraftStatus("This browser did not allow local draft storage.");
    }
  }

  function changeTelemetryConsent(enabled: boolean) {
    telemetryConsentRef.current = enabled;
    setTelemetryConsent(enabled);
    try {
      window.localStorage.setItem(TELEMETRY_CONSENT_KEY, enabled ? "yes" : "no");
    } catch {
      // Consent remains active for this tab even when persistent storage is unavailable.
    }
    if (enabled) track("session_started", { marketMode: state.marketMode });
  }

  function restoreDraft() {
    if (!savedDraft) return;
    controllerRef.current?.abort();
    dispatch({
      type: "restore-draft",
      plan: savedDraft.plan,
      sourceText: savedDraft.sourceText,
      sourceUrl: savedDraft.sourceUrl,
      marketMode: savedDraft.marketMode,
      changedMessage: "Saved draft restored. Submit again to build a fresh brief.",
    });
    setDraftStatus(`Draft restored from ${formatTimestamp(savedDraft.savedAt)} UTC.`);
    track("draft_restored", { marketMode: savedDraft.marketMode });
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // Storage may be unavailable; clearing the in-memory reference is still safe.
    }
    setSavedDraft(null);
    setDraftStatus("Saved draft cleared from this browser.");
    track("draft_cleared", { marketMode: state.marketMode });
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
      track("follow_up_applied", { marketMode: result.refreshMarket ? "live" : state.marketMode, reusedEvidence: Boolean(state.report && !result.changed?.some((item) => item.includes("thesis"))) });
      if (result.changed?.length) {
        const nextPlan = result.plan;
        const evidenceChanged = result.changed.some((item) => item.includes("thesis"));
        commitPlan(nextPlan, `Changed: ${result.changed.join(", ")}.`, evidenceChanged);
        if (result.refreshMarket) {
          dispatch({ type: "set-market-mode", marketMode: "live", changedMessage: "Changed: live market refresh requested." });
          submitResearch({ plan: nextPlan, marketMode: "live", inputRevision: state.planRevision + 1, forceMarketRefresh: true });
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
    track("export_downloaded", { marketMode: state.marketMode });
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
          <div className="draft-toolbar">
            <div><strong>Local draft</strong><span>Stored in this browser only.</span></div>
            <div className="draft-actions">
              <button className="button button-quiet" type="button" onClick={saveDraft}>Save draft</button>
              {savedDraft ? <button className="button button-quiet" type="button" onClick={restoreDraft}>Restore saved</button> : null}
              {savedDraft ? <button className="text-button" type="button" onClick={clearDraft}>Clear</button> : null}
            </div>
          </div>
          {savedDraft ? <p className="draft-available">Saved draft from {formatTimestamp(savedDraft.savedAt)} UTC is available.</p> : null}
          {draftStatus ? <p className="draft-status" role="status">{draftStatus}</p> : null}
          {process.env.NEXT_PUBLIC_TELEMETRY_ENABLED === "true" ? <label className="telemetry-control"><input type="checkbox" checked={telemetryConsent} onChange={(event) => changeTelemetryConsent(event.target.checked)} /><span><strong>Share anonymous validation events</strong><small>Optional. No thesis, source text, URL, or report content is sent.</small></span></label> : null}

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

        <section id="report" className="report-column" aria-live="off" aria-busy={isBusy}>
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
              <div className="report-grid"><EvidencePanel report={state.report} /><EconomicsPanel report={state.report} now={clock} onRefresh={() => { track("live_refresh_requested", { marketMode: "live" }); submitResearch({ marketMode: "live", forceMarketRefresh: true }); }} isRefreshing={state.requestState === "refreshing"} /></div>
              <ScenarioTable report={state.report} />
              <SourcesPanel report={state.report} />
              <RunDetails report={state.report} />
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
