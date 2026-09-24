"use client";

import Decimal from "decimal.js";
import { ArrowClockwise, Broadcast, CheckSquare, FileText, Newspaper, Scroll, Square } from "@phosphor-icons/react";
import type { Headline, MarketContext, RadarResult } from "@/domain/contracts";

export function signedPercent(value: string | null, digits = 2) {
  if (value === null) return "—";
  try {
    const percent = new Decimal(value).mul(100);
    return `${percent.gte(0) ? "+" : ""}${percent.toFixed(digits)}%`;
  } catch {
    return "—";
  }
}

export function price(value: string | null | undefined, digits = 2) {
  if (!value) return "—";
  try {
    return new Decimal(value).toFixed(digits);
  } catch {
    return "—";
  }
}

function relativeTime(iso: string | null, date: string | null, now: number) {
  if (!iso) {
    if (!date) return "undated";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  }
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

export function isNewSinceClose(headline: Headline, context: MarketContext | null) {
  const close = context?.underlying?.lastCloseAt;
  if (!close) return false;
  const published = headline.publishedAt ?? (headline.publishedDate ? `${headline.publishedDate}T23:59:59Z` : null);
  return Boolean(published && published > close);
}

function kindLabel(headline: Headline) {
  if (headline.kind === "issuer_official") return headline.fullTextAvailable ? "Official release · full text" : "Official · summary";
  if (headline.kind === "regulatory_filing") return "SEC filing";
  return "News summary";
}

function KindIcon({ headline }: { headline: Headline }) {
  if (headline.kind === "issuer_official") return <FileText size={15} weight="bold" aria-hidden="true" />;
  if (headline.kind === "regulatory_filing") return <Scroll size={15} weight="bold" aria-hidden="true" />;
  return <Newspaper size={15} weight="bold" aria-hidden="true" />;
}

export function SessionPill({ context }: { context: MarketContext | null }) {
  if (!context) return null;
  const open = context.session.underlyingOpen;
  return (
    <span className={`session-pill ${open ? "session-open" : "session-closed"}`}>
      <span className="session-dot" aria-hidden="true" />
      {context.session.label}
    </span>
  );
}

export function RadarPanel({
  radar,
  loading,
  error,
  selected,
  maxSelected,
  now,
  onToggle,
  onRefresh,
}: {
  radar: RadarResult | null;
  loading: boolean;
  error: string | null;
  selected: string[];
  maxSelected: number;
  now: number;
  onToggle: (id: string) => void;
  onRefresh: () => void;
}) {
  const context = radar?.marketContext ?? null;
  const asset = radar?.asset ?? "NVDA";
  return (
    <section className="radar-panel" aria-labelledby="radar-heading" aria-busy={loading}>
      <div className="radar-heading">
        <span className="chat-heading-icon" aria-hidden="true"><Broadcast size={20} weight="regular" /></span>
        <div>
          <h2 id="radar-heading">After-hours radar · r{asset}</h2>
          <p>{radar?.mode === "captured_real" ? "Captured replay from Sep 8, 2026, 21:51 UTC." : "Live headlines and prices."} Tick up to {maxSelected} headlines to use as evidence.</p>
        </div>
        <button className="button button-quiet radar-refresh" type="button" onClick={onRefresh} disabled={loading} aria-label="Reload headlines and prices">
          <ArrowClockwise size={16} className={loading ? "spin" : undefined} aria-hidden="true" />
        </button>
      </div>

      {context ? (
        <div className="radar-context">
          <SessionPill context={context} />
          <dl className="radar-metrics">
            <div>
              <dt>r{asset} now</dt>
              <dd>{price(context.rToken?.mid)} <small>USDT mid</small></dd>
            </div>
            <div>
              <dt>{context.underlying ? `${context.underlying.symbol} close ${context.underlying.lastCloseSessionDate.slice(5)}` : "US close"}</dt>
              <dd>{price(context.underlying?.lastClose)} <small>USD</small></dd>
            </div>
            <div>
              <dt>Moved since close</dt>
              <dd className={context.moveSinceClose && new Decimal(context.moveSinceClose).lt(0) ? "tone-down" : "tone-up"}>{signedPercent(context.moveSinceClose)}</dd>
            </div>
          </dl>
          {context.basisVsLatest !== null ? <p className="radar-note">Tracking the latest {context.underlying?.symbol} print within {signedPercent(context.basisVsLatest, 3)}.</p> : null}
          {context.warnings.map((warning) => <p key={warning} className="radar-note radar-warning">{warning}</p>)}
        </div>
      ) : loading ? <div className="radar-skeleton" aria-label="Loading radar" role="status"><div /><div /><div /></div> : null}

      {error ? <p className="radar-note radar-warning" role="alert">{error}</p> : null}

      {radar ? (
        radar.headlines.length ? (
          <ul className="headline-list" aria-label="Headlines">
            {radar.headlines.map((headline) => {
              const checked = selected.includes(headline.id);
              const disabled = !checked && selected.length >= maxSelected;
              const fresh = isNewSinceClose(headline, context);
              return (
                <li key={headline.id} className={`headline ${checked ? "headline-selected" : ""}`}>
                  <button type="button" className="headline-toggle" aria-pressed={checked} disabled={disabled} onClick={() => onToggle(headline.id)}>
                    <span className="headline-check" aria-hidden="true">{checked ? <CheckSquare size={20} weight="fill" /> : <Square size={20} />}</span>
                    <span className="headline-body">
                      <span className="headline-title">{headline.title}</span>
                      <span className="headline-meta">
                        <span className={`headline-kind headline-kind-${headline.kind}`}><KindIcon headline={headline} />{kindLabel(headline)}</span>
                        <span>{headline.publisher}</span>
                        <span>{relativeTime(headline.publishedAt, headline.publishedDate, radar.mode === "captured_real" && context ? new Date(context.observedAt).getTime() : now)}</span>
                        {fresh ? <span className="headline-fresh">New since close</span> : context?.underlying ? <span className="headline-old">Before last close</span> : null}
                      </span>
                    </span>
                  </button>
                  <a className="headline-link" href={headline.url} target="_blank" rel="noreferrer">Open</a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted-copy">No company headlines were found for r{asset} {radar.mode === "captured_real" ? "in the captured replay" : "right now"}. Paste a source in the plan below instead.</p>
        )
      ) : null}
      {radar?.feedWarnings.map((warning) => <p key={warning} className="radar-note radar-warning">{warning}</p>)}
    </section>
  );
}
