"use client";

import Decimal from "decimal.js";
import { Clock } from "@phosphor-icons/react";
import type { EconomicsResult, MarketContext } from "@/domain/contracts";
import { pricedInView } from "@/domain/priced-in";
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
      <p className="priced-footnote">
        Close {context.underlying.lastCloseSessionDate} ({timeLabel(context.underlying.lastCloseAt)}){context.session.nextRegularOpenAt ? ` · next US open ${timeLabel(context.session.nextRegularOpenAt)}` : ""}
        {context.basisVsLatest !== null ? ` · r${asset} tracks the latest ${symbol} print within ${signedPercent(context.basisVsLatest, 3)}` : ""}.
        Levels are the best bid moved by the whole-book threshold, an indicator rather than a fill price. Assumes one r{asset} tracks one {symbol} share.
      </p>
    </section>
  );
}
