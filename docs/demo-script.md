# ThesisGate walkthrough: 3-minute shot list

**Story in one line:** stock tokens trade while Wall Street sleeps, so before you trade a headline you need three answers: is it new, how far has the token already moved, and what does your trade need after costs?

## Before you hit record

- **When:** a weekday evening after 16:00 New York time (21:00 Lagos), or a weekend. The session pill then reads "US market closed" or "US after-hours", which is the whole story. Avoid US market hours.
- **Browser:** a clean Chrome window at 1440×900 or larger, zoom 100%, bookmarks bar hidden, notifications off. Open https://thesisgate.duckdns.org and wait until the radar shows headlines.
- **Warm-up:** send one throwaway chat message first so the first AI answer on camera isn't slow, then reload the page.
- **Pick your live headline:** in the radar, find a real company headline marked **New since close**. Write your chat message around it (template below). If nothing good is live, use the fallback in step 3.
- **Audio:** record the voice separately if you can; speak slowly. 3:00 is a hard maximum.
- Don't say the AI "predicts" anything, and don't say "guaranteed".

## Shot list

### 0:00–0:15 · Hook (the page header and the "right now" panel)

> "rNVDA and rTSLA trade 24/7 on Bitget. Wall Street doesn't. So when a headline drops tonight, this order book is the only place the trade exists. Before I trade it, I want three answers."

Point at the session pill ("US market closed…") and "Moved since close".

### 0:15–0:35 · The radar

Scroll to **After-hours radar**. Point at the live rNVDA price against NVDA's last close, at a **New since close** badge, and at an official source (NVIDIA Newsroom or an SEC filing).

> "ThesisGate pulls the news itself: company headlines, NVIDIA's newsroom, SEC filings. It marks what's new since the close, and shows how far the token has already moved."

### 0:35–1:00 · Describe the trade in plain words

Click into **Describe the trade** and type (adapt to your headline):

> *"[Company] says [headline claim] — I think rNVDA pops before tomorrow's open. Thinking 3k, want about 60 USDT."*

Press Enter. Show the reply and the green "changed" chips: amount, goal, horizon, and the headline it picked as evidence.

> "No forms. It turns my message into a precise plan and picks the evidence, and it won't tell me whether to buy."

### 1:00–1:25 · The brief: evidence, then the move since the close

Show **At a glance**, then **Token price vs. the last US close**. Point along the gauge: close → token now → break-even → your goal.

> "My goal needs rNVDA bids around this level, X% above yesterday's close. The token has already moved Y%, so here's how much of my move is already gone."

Scroll to **Evidence behind your thesis**. Show one supported claim with its quote, and the causal or forecast claim marked insufficient.

> "Each part of my thesis is checked separately, against quotes verified in the source. The news can be true without proving the price will move."

### 1:25–1:40 · Data sources & integrations, on screen (a scoring criterion)

In the radar, expand **Data sources & integrations** so the whole list is on screen at once (this is the "integration count and effectiveness" criterion, made visible in one shot): the Bitget order book, the five Bitget MCP-server feeds (analyst targets, earnings calendar, Bitget news, macro, Fear & Greed), the technical-analysis skill, NVIDIA Newsroom, SEC EDGAR filings, **SEC EDGAR XBRL financials**, and Yahoo. Then point at the close-comparison card's context row — typical daily range, market mood, and the **last reported revenue from SEC's XBRL data**.

> "It's built on Bitget's own Agent Hub — analyst targets, earnings, news, macro and the technical-analysis skill — plus independent primary sources: NVIDIA's newsroom, SEC filings, and SEC's XBRL financials for the last reported revenue. The brief shows which answered and falls back when one doesn't."

Check the skills line the morning you record: if Bitget's skill server is still erroring, say so plainly and don't claim those answered — the honest fallback is part of the story, not a flaw to hide.

### 1:40–2:00 · Follow-ups change only what they should

In the chat, click **What if I only put in half?**, then **What if exit liquidity halves?**.

> "Follow-ups update the plan. The trade math recalculates from the live order book, and the evidence check isn't re-run, so there's no extra AI cost."

### 2:00–2:20 · The trap it catches (captured replay)

Scroll to the report area and click **Replay captured example** (or reload and use the button in the empty state).

> "Here's a real moment from September 8, after the US close. A trader reads 'NVIDIA and AWS announce 2 million GPUs' and thinks it's today's news. ThesisGate fetched the official release: it's from August 26. 'Announced today' is contradicted, the plan is real but for 2027 to 2028, and the 100 USDT goal needs about 1.4% on the book."

Point at the **contradicted** tag and the Aug 26 date in Sources.

### 2:20–2:30 · The handoff (optional if you are short on time)

Open **If you decide to trade: hand off to Bitget Agent Hub** and show the three `bgc` commands: a read-only price check, a dry-run preview, then the real order that you run yourself.

> "ThesisGate never places orders. When you decide, it hands you the exact Bitget CLI command — dry run first, and sized so it can never spend more than your amount, fees included."

### 2:30–2:50 · Proof, not claims

Cut to the results table (README, "End-to-end comparison", or `evidence/e2e-comparison-v1/final/REPORT.md`):

> "We tested it against the same AI used as a normal chatbot, on 12 real cases. Reading the news? A good chatbot ties us, and we say so. But on trade math, ThesisGate was right 12 out of 12. The same model, given the same order book, got 3 wrong, including ignoring Bitget's 200-token position cap. Without the data it couldn't answer at all."

### 2:50–3:00 · Close

> "ThesisGate never places orders or predicts prices. You decide, with the evidence, the timing and the costs in view. thesisgate.duckdns.org."

## Fallbacks

- **The AI reply is slow:** keep talking over the "Reading your message" state; replies usually take 5–10 seconds.
- **No good live headline:** skip to the captured replay at 0:35. Then, for the follow-up shot, type "what if I only put in 3k instead?" in the chat.
- **The live market data fails:** switch **Market data mode** to **Captured replay**; everything still works offline.
- **The daily AI budget is exhausted:** the chat falls back to simple-edit mode and says so. Record at a quiet time, and don't hammer it during rehearsals (limits: 20 chat messages and 5 briefs per 10 minutes per visitor).
