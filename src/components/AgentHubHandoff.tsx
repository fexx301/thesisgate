"use client";

import { useState } from "react";
import { CaretDown, Copy, Check, Terminal } from "@phosphor-icons/react";
import type { ResearchResult } from "@/domain/contracts";
import { agentHubHandoff } from "@/domain/handoff";

/** Copy-only handoff to Bitget's official Agent Hub CLI. ThesisGate itself never sends an order. */
export function AgentHubHandoffCard({ report }: { report: ResearchResult }) {
  const [copied, setCopied] = useState<string | null>(null);
  const handoff = agentHubHandoff(report.economics, report.instrument, report.snapshot, report.confirmedPlan.feeIn, report.confirmedPlan.side);
  if (!handoff) return null;
  const captured = report.snapshot?.mode !== "live";
  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }
  return (
    <details className="report-card handoff-card">
      <summary className="card-topline handoff-summary">
        <span className="handoff-title"><Terminal size={20} aria-hidden="true" />If you decide to trade: hand off to Bitget Agent Hub</span>
        <CaretDown size={17} aria-hidden="true" />
      </summary>
      <p className="handoff-intro">
        ThesisGate never places orders. These are commands for Bitget&apos;s official Agent Hub CLI (<code>bgc</code>), for you to review and run yourself, starting with a dry run.
        {captured ? " This brief uses a captured historical book: switch to live data first, because these prices are not current." : ""}
      </p>
      {handoff.side === "short" ? (
        <p className="handoff-max"><strong>Opens a short · minimum proceeds: {handoff.maxSpendWithFee} USDT</strong> after the fee, by selling {handoff.quantity} into the bids (plan amount {handoff.budget} USDT). Buying back to close is a separate order.</p>
      ) : (
        <p className="handoff-max"><strong>Maximum spend: {handoff.maxSpendWithFee} USDT</strong> including the entry fee (plan amount {handoff.budget} USDT){handoff.reducedToFitBudget ? `. Sized down from the modeled ${handoff.modeledQuantity} so the order can never exceed your amount.` : "."}</p>
      )}
      <ol className="handoff-commands">
        {handoff.commands.map((item) => (
          <li key={item.command}>
            <span>{item.label}</span>
            <div className="handoff-command">
              <code>{item.command}</code>
              <button type="button" className="button button-quiet handoff-copy" onClick={() => void copy(item.command)} aria-label={`Copy: ${item.label}`}>
                {copied === item.command ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <ul className="handoff-notes">{handoff.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      <p className="handoff-install">Install once: <code>npm install -g @bitget-ai/bitget-agent-cli</code>, then connect a Bitget Agentic account.</p>
    </details>
  );
}
