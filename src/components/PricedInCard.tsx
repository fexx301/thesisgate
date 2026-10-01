"use client";

import Decimal from "decimal.js";
import { Clock } from "@phosphor-icons/react";
import type { EconomicsResult, MarketContext } from "@/domain/contracts";
import { pricedInView } from "@/domain/priced-in";
import { requiredMoveInTypicalDays } from "@/domain/technicals";
import { price, SessionPill, signedPercent } from "./RadarPanel";

type Marker = { key: string; label: string; value: Decimal; detail: string };

function timeLabel(iso: string | null) {
  if (!iso) return "unknown time";
  return new Intl.DateTimeFormat("en", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(iso));
}

export function PricedInCard({ context, economics, asset }: { context: MarketContext | null; economics: EconomicsResult; asset: string }) {
  if (!context?.rToken || !context.underlying || context.moveSinceClose === null) {
    return (
      <section className="report-card priced-card" aria-labelledby="priced-heading">
        <div className="priced-head">
          <h2 id="priced-heading"><Clock size={20} aria-hidden="true" />Priced in since the close?</h2>
        </div>
        <p className="muted-copy">{context?.warnings[0] ?? "The underlying close or the rToken book was unavailable, so the move since the close cannot be measured for this brief."}</p>
      </section>
    );
  }
  const view = pricedInView(context, economics);
  const symbol = context.underlying.symbol;
  const moved = new Decimal(context.moveSinceClose);
  const markers: Marker[] = [
    { key: "close", label: `${symbol} close`, value: new Decimal(0), detail: `${price(context.underlying.lastClose)} USD` },
    { key: "now", label: `r${asset} now`, value: moved, detail: `${price(context.rToken.mid)} USDT` },
  ];
  if (view.breakEven?.vsClose) markers.push({ key: "breakeven", label: "Break-even", value: new Decimal(view.breakEven.vsClose), detail: `${price(view.breakEven.level)} USDT` });
  if (view.goal?.vsClose) markers.push({ key: "goal", label: "Your goal", value: new Decimal(view.goal.vsClose), detail: `${price(view.goal.level)} USDT` });
  if (view.scenario?.vsClose) markers.push({ key: "scenario", label: "Your scenario", value: new Decimal(view.scenario.vsClose), detail: `${price(view.scenario.level)} USDT` });

  const values = markers.map((marker) => marker.value);
  const low = Decimal.min(...values);
  const high = Decimal.max(...values);
  const pad = Decimal.max(high.minus(low).mul(0.12), new Decimal(0.002));
  const min = low.minus(pad);
  const span = high.plus(pad).minus(min);
  const position = (value: Decimal) => `${value.minus(min).div(span).mul(100).toFixed(2)}%`;
  const closed = !context.session.underlyingOpen;
  const share = view.shareOfGoalAlreadyMoved ? new Decimal(view.shareOfGoalAlreadyMoved).mul(100).toFixed(0) : null;

  let headline: string;
  if (view.goal?.vsClose) {
    const goalVsClose = new Decimal(view.goal.vsClose);
    headline = `Your goal needs r${asset} bids near ${price(view.goal.level)} USDT, ${signedPercent(view.goal.vsClose)} versus ${symbol}'s last close. `
      + (share && moved.gt(0)
        ? `${share}% of that move has already happened on Bitget${closed ? " while the US market was closed" : ""}.`
        : goalVsClose.gt(0) && moved.lt(0)
          ? `The rToken is currently ${moved.abs().mul(100).toFixed(2)}% below the close, so the whole move is still ahead.`
          : `The rToken has moved ${signedPercent(context.moveSinceClose)} since the close.`);
  } else {
    headline = `r${asset} trades ${signedPercent(context.moveSinceClose)} versus ${symbol}'s last close. Set a goal to see how much of the required move has already happened.`;
  }

  return (
    <section className="report-card priced-card" aria-labelledby="priced-heading">
      <div className="priced-head">
        <h2 id="priced-heading"><Clock size={20} aria-hidden="true" />Priced in since the close?</h2>
        <SessionPill context={context} />
      </div>
      <p className="priced-headline">{headline}</p>
      <div className="gauge" role="img" aria-label={markers.map((marker) => `${marker.label} ${signedPercent(marker.value.toString())} versus close`).join(", ")}>
        <div className="gauge-track" />
        {markers.map((marker) => (
          <span key={marker.key} className={`gauge-marker gauge-${marker.key}`} style={{ left: position(marker.value) }} />
        ))}
      </div>
      <dl className="gauge-legend">
        {markers.map((marker) => (
          <div key={marker.key} className={`gauge-item gauge-item-${marker.key}`}>
            <dt><span className="gauge-swatch" aria-hidden="true" />{marker.label}</dt>
            <dd>{signedPercent(marker.value.toString())}<small>{marker.detail}</small></dd>
          </div>
        ))}
      </dl>
      <SkillContext context={context} goalVsBids={economics.requiredGoalShift} asset={asset} />
      <p className="priced-footnote">
        Close {context.underlying.lastCloseSessionDate} ({timeLabel(context.underlying.lastCloseAt)}){context.session.nextRegularOpenAt ? ` · next US open ${timeLabel(context.session.nextRegularOpenAt)}` : ""}
        {context.basisVsLatest !== null ? ` · r${asset} tracks the latest ${symbol} print within ${signedPercent(context.basisVsLatest, 3)}` : ""}.
        Levels are the best bid moved by the whole-book threshold, an indicator rather than a fill price. Assumes one r{asset} tracks one {symbol} share.
      </p>
    </section>
  );
}

function moodLabel(rating: string) {
  return rating.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Context from the Bitget Agent Hub skills. Descriptive scale and mood only: no verdicts, stops or forecasts. */
function SkillContext({ context, goalVsBids, asset }: { context: MarketContext; goalVsBids: string | null; asset: string }) {
  const signals = context.signals;
  if (!signals) return null;
  const { technicals, sentiment, macro, cryptoSentiment, bitgetQuote, secFinancials } = signals;
  const goalPercent = goalVsBids ? new Decimal(goalVsBids).mul(100).toString() : null;
  const days = technicals && goalPercent ? requiredMoveInTypicalDays(goalPercent, technicals.atrPercent) : null;
  const symbol = context.underlying?.symbol ?? asset;
  const close = context.underlying ? new Decimal(context.underlying.lastClose) : null;
  const quoteMatches = bitgetQuote?.prevClose && close ? new Decimal(bitgetQuote.prevClose).minus(close).abs().div(close).lte("0.0025") : null;
  const used = signals.skills.filter((item) => item.status === "used").map((item) => item.skill);
  const fellBack = signals.skills.filter((item) => item.status === "fallback").map((item) => item.skill);
  if (!technicals && !sentiment && !macro && !cryptoSentiment && !bitgetQuote && !secFinancials) return null;
  return (
    <div className="skill-context" aria-label="Market context from Bitget Agent Hub">
      {technicals ? (
        <div className="skill-item">
          <span className="skill-label">Typical daily range</span>
          <strong>{new Decimal(technicals.atrPercent).toFixed(2)}%</strong>
          <small>
            {symbol} 14-day ATR{days ? ` · your goal needs about ${days} typical days of movement in your favour` : ""}
            {technicals.rsi14 ? ` · RSI(14) ${new Decimal(technicals.rsi14).toFixed(0)}` : ""}
          </small>
        </div>
      ) : null}
      {sentiment ? (
        <div className="skill-item">
          <span className="skill-label">Market mood</span>
          <strong>{moodLabel(sentiment.rating)} {new Decimal(sentiment.score).toFixed(0)}</strong>
          <small>US Fear &amp; Greed index{sentiment.previousMonth ? ` · ${new Decimal(sentiment.previousMonth).toFixed(0)} a month ago` : ""}{cryptoSentiment ? ` · crypto mood ${moodLabel(cryptoSentiment.rating)} ${new Decimal(cryptoSentiment.score).toFixed(0)}` : ""}</small>
        </div>
      ) : null}
      {macro ? (
        <div className="skill-item">
          <span className="skill-label">Rates backdrop</span>
          <strong>{macro.tenYearYield ? `10Y ${new Decimal(macro.tenYearYield).toFixed(2)}%` : "—"}</strong>
          <small>{macro.fedFundsLower && macro.fedFundsUpper ? `Fed funds target ${new Decimal(macro.fedFundsLower).toFixed(2)}–${new Decimal(macro.fedFundsUpper).toFixed(2)}%` : "Fed funds target unavailable"}</small>
        </div>
      ) : null}
      {bitgetQuote ? (
        <div className="skill-item">
          <span className="skill-label">Bitget US quote</span>
          <strong>{symbol} {new Decimal(bitgetQuote.lastPrice).toFixed(2)}</strong>
          <small>
            {bitgetQuote.prevClose ? `previous close ${new Decimal(bitgetQuote.prevClose).toFixed(2)}` : "previous close unavailable"}
            {quoteMatches === true ? " · agrees with the close used here" : quoteMatches === false ? " · differs from the close used here, which is the official consolidated close; Bitget's quote uses IEX prints" : ""}
          </small>
        </div>
      ) : null}
      {secFinancials ? (
        <div className="skill-item">
          <span className="skill-label">{secFinancials.label}</span>
          <strong>${new Decimal(secFinancials.valueUsd).div("1000000000").toDecimalPlaces(1).toString()}B</strong>
          <small>
            {symbol} {secFinancials.fiscalPeriod ? `${secFinancials.fiscalPeriod} · ` : ""}period ended {secFinancials.periodEnd} · SEC {secFinancials.form} filed {secFinancials.filed}
          </small>
        </div>
      ) : null}
      <p className="skill-source">
        Bitget Agent Hub skills: {used.length ? `${used.join(", ")} answered` : "none answered"}{fellBack.length ? `; ${fellBack.join(", ")} fell back to Bitget market data` : ""}.{secFinancials ? " Revenue from SEC EDGAR XBRL." : ""} Context for scale, not a forecast.
      </p>
    </div>
  );
}
