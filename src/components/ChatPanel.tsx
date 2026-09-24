"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { ChatCircleText, CircleNotch, PaperPlaneRight, Sparkle } from "@phosphor-icons/react";

export type ChatEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  changed?: string[];
  origin?: "model" | "rules";
};

export function ChatPanel({
  entries,
  draft,
  pending,
  suggestions,
  onDraftChange,
  onSend,
}: {
  entries: ChatEntry[];
  draft: string;
  pending: boolean;
  suggestions: string[];
  onDraftChange: (value: string) => void;
  onSend: (message: string) => void;
}) {
  const logRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [entries.length, pending]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending) return;
    onSend(message);
  }

  return (
    <section className="chat-panel" aria-labelledby="chat-heading">
      <div className="chat-heading">
        <span className="chat-heading-icon" aria-hidden="true"><ChatCircleText size={20} weight="regular" /></span>
        <div>
          <h2 id="chat-heading">Describe the trade</h2>
          <p>Say it the way you would to a friend. ThesisGate fills in the plan, picks evidence and runs the checks.</p>
        </div>
      </div>
      <ol className="chat-log" ref={logRef} aria-live="polite" aria-label="Conversation">
        {entries.map((entry) => (
          <li key={entry.id} className={`chat-message chat-${entry.role}`}>
            <p>{entry.content}</p>
            {entry.changed?.length ? (
              <ul className="chat-changes" aria-label="Plan changes">
                {entry.changed.map((change) => <li key={change}>{change}</li>)}
              </ul>
            ) : null}
            {entry.role === "assistant" && entry.origin === "rules" ? <small className="chat-origin">Simple-edit mode (model unavailable)</small> : null}
          </li>
        ))}
        {pending ? (
          <li className="chat-message chat-assistant chat-pending" role="status">
            <CircleNotch size={16} className="spin" aria-hidden="true" /><span>Reading your message</span>
          </li>
        ) : null}
      </ol>
      {suggestions.length ? (
        <div className="chat-suggestions" aria-label="Suggested messages">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" className="chat-suggestion" disabled={pending} onClick={() => onSend(suggestion)}>
              <Sparkle size={13} weight="bold" aria-hidden="true" />{suggestion}
            </button>
          ))}
        </div>
      ) : null}
      <form className="chat-compose" onSubmit={submit}>
        <label htmlFor="chat-input" className="sr-only">Message ThesisGate</label>
        <textarea
          id="chat-input"
          rows={2}
          maxLength={2000}
          value={draft}
          placeholder="e.g. Put 3k into rNVDA on the AWS news, hold until Monday's open, I want 60 USDT"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button className="button button-primary chat-send" type="submit" disabled={pending || !draft.trim()} aria-label="Send message">
          <PaperPlaneRight size={18} weight="bold" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
