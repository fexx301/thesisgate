import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "ThesisGate: stress-test the trade behind the headline. Is the news new, how far has the token moved since the US close, and what does the trade need after fees?";

/** The link-preview card shown when the site is shared (X, Telegram, Discord). Uses only built-in fonts. */
export function renderOgCard() {
  const point = (label: string, detail: string) => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "22px 26px", borderRadius: 18, background: "#1f2530", border: "1px solid #3a4352" }}>
      <div style={{ fontSize: 32, fontWeight: 700, color: "#9cc0ff" }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 24, lineHeight: 1.3, color: "#c9d1de" }}>{detail}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "52px 72px 56px", background: "#151a22", color: "#f2f5fa", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: "#9cc0ff", fontWeight: 700, letterSpacing: 1 }}>
          <div style={{ display: "flex", width: 18, height: 18, borderRadius: 9, background: "#4b8dff" }} />
          THESISGATE · rNVDA · rTSLA · BITGET REALITY SPOT
        </div>
        <div style={{ display: "flex", marginTop: 30, fontSize: 74, lineHeight: 1.05, fontWeight: 800, letterSpacing: -2 }}>
          Stress-test the trade behind the headline.
        </div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 30, color: "#c9d1de" }}>
          Stock tokens trade 24/7. Wall Street doesn&apos;t.
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: "auto", paddingTop: 24 }}>
          {point("Is it new?", "Sources checked claim by claim, with dates.")}
          {point("Moved since the close?", "Token vs the last US close, right now.")}
          {point("What it needs", "Break-even after fees, from the live book.")}
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
