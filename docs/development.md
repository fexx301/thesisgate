# Development and architecture

[Back to the project overview](../README.md) · [Evaluation](evaluation.md) · [Deployment runbook](../deploy/README.md)

Run commands from the repository root. The app uses Next.js 16.3, React 19, TypeScript, Zod and Decimal.js.

## Install and verify

~~~bash
npm ci
npx playwright install chromium
npm run typecheck
npm run lint
npm test
npm run eval:packets
npm run eval:runner
node evals/verify-evidence.mjs
npm test -- --run tests/unit/quota-service.test.ts tests/integration/quota-service.test.ts
npm run build
npm run test:e2e
~~~

`npm run test:e2e` starts a production Next server on port `3101` when one is not already running. To point the browser tests at an existing server:

~~~bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3101 npm run test:e2e
~~~

Node `>=24` is the supported contributor engine for this repository, including Vitest 5 and the evaluation runner's native TypeScript stripping. Use `.nvmrc` to keep local and CI runtimes aligned.

The full local verification sequence also includes `npm run eval:packets`, `npm run eval:runner`, and `node evals/verify-evidence.mjs`. Historical evidence integrity is verified, but the archived builder-scored performance result is not a current research-gate pass: it is bound to an older implementation and the current evaluator rejects that stale binding. No independent practitioner validation is claimed.

## Optional local claim model

Basic captured and live economics do not require an AI key. A compatible server-side model enables the full conversation and runtime claim assessment. Without it, quick edits, deterministic economics and the narrow announcement-date check remain available.

Create `.env.local` manually. It is ignored by Git and must never be committed:

~~~dotenv
THESIS_LLM_ENABLED=true
THESIS_LLM_API_KEY=your-provider-key
THESIS_LLM_BASE_URL=https://openrouter.ai/api/v1/chat/completions
THESIS_LLM_MODEL=provider/model-id
THESIS_LLM_PROTOCOL=openai_chat
THESIS_LLM_REASONING_EFFORT=low
~~~

The adapter accepts an explicit `openai_chat` or `openai_responses` protocol. It does not infer a protocol from the URL, browse source URLs, call tools, or place trades. Model availability and aliases can change, so use the provider's current model identifier.

When enabled, the server sends the thesis, the selected source texts, and (for the conversation) the last few chat messages, the current plan and the radar's headline titles to the configured model provider. Do not submit confidential material unless that provider's data terms are acceptable for it.

Set `THESIS_SEC_USER_AGENT` (for example `YourApp you@example.com`) to add SEC EDGAR 8-K filings to the radar. SEC requires a declared contact; the feed is skipped when it is unset.

The reproducible benchmark configuration is frozen in [evals/benchmark-manifest.json](../evals/benchmark-manifest.json). A different provider, model, prompt, or reasoning setting is a different experiment and must not be presented as the same benchmark run.

Keep the key in `.env.local`, never in source, browser state, logs, or exported reports. For a new public deployment, configure and verify the durable budget and concurrency controls before enabling model calls.

## Production request protection

Before deployment, set `THESIS_PUBLIC_ORIGINS` to the exact HTTPS origin or comma-separated origins that serve the app. Production POST routes fail closed when the allowlist is missing or the request origin is not listed. Localhost and test runs do not require this deployment setting.

These settings apply **only to production model calls**, including model assessment during replay. Production model calls require a configured durable quota service; model-disabled replay does not. The app-side adapter calls the reference service in [`quota-service/`](../quota-service/), but that service is a separate process and is not automatically deployed with the Next.js app. Set these server-only variables only as part of a separately verified model rollout:

~~~dotenv
THESIS_LLM_QUOTA_URL=https://your-quota-service.example/v1/reservations
THESIS_LLM_QUOTA_TOKEN=your-quota-service-token
THESIS_LLM_MAX_CALL_COST_USD=0.02
THESIS_LLM_DAILY_BUDGET_USD=1
THESIS_LLM_PER_VISITOR_BUDGET_USD=0.10
THESIS_LLM_MAX_CONCURRENT=2
THESIS_LLM_PROVIDER_HARD_LIMIT_USD=1
THESIS_VISITOR_HASH_SECRET=long-random-server-secret
~~~

The reference service is a Node 24 process using SQLite WAL, `synchronous=FULL`, and `BEGIN IMMEDIATE` transactions. Run it as one writer with a persistent volume and backups; do not put its database on an ephemeral serverless filesystem or run independent uncoordinated instances. It atomically handles a `reserve` request before the provider call and a `settle` request after it. The reserve body includes a request ID, one-way visitor bucket, maximum per-call reservation, daily and per-visitor caps, provider hard limit, concurrency cap, and `expiresInSeconds: 60`. That expiry is a **concurrency lease only**: it must not automatically refund the spend reservation. Unknown provider outcomes and failed settlements retain the reserved maximum spend and appear through the authenticated reconciliation endpoint. The service returns `{ "allowed": true, "reservationId": "..." }` or `{ "allowed": false, "reason": "..." }`; duplicate reserve and settle requests return the original decision. Settlement receives the reservation ID and actual provider-reported cost, or the reserved maximum when the provider reports no cost. The app never sends the raw visitor address to the model provider.

Run the reference service locally with `npm run quota:start` after setting the `THESIS_QUOTA_*` values in [`.env.example`](../.env.example); its detailed volume, container, reconciliation, and restore instructions are in [`quota-service/README.md`](../quota-service/README.md). The service rejects limit mismatches between its environment and the calling app rather than silently choosing one.

The service-side provider ceiling is an additional UTC-day reservation cap; declaring it in an environment variable does not set a provider-account billing limit. For a new deployment, verify persistence, recovery, HTTPS and the intended spending controls in that environment. The existing public demo is enabled with a volume-backed quota service; the [release record](release-notes.md) states the observed checks and limits. A full restore drill and multi-instance load certification are not claimed.

`THESIS_RECOMPUTE_SIGNING_SECRET` is a separate production requirement even when the model is disabled and all quota variables are unset. Research and market responses carry a server-signed receipt for their validated instrument and snapshot; `/api/recompute` rejects browser-substituted market data. The receipt authenticates origin, not freshness. Use the visible exchange age and refresh control when current data matters. Keep one strong secret consistent across serving instances; rotating it invalidates previously issued receipts and requires a fresh research or market request.

For local development, the quota service is not required. The optional `THESIS_LLM_LOCAL_MAX_CONCURRENT` variable limits simultaneous local model calls in the running process. All POST routes also enforce a single-process per-visitor guard (30 requests/minute per route; claim analyses 12 per visitor per 10 minutes with a 600/day global cap; chat turns have a separate 40 per 10 minutes and 2,000/day bucket. "Visitor" means client IP, so several judges behind one office network share these; the durable ledger's dollar caps are what bound spend. When all model slots are busy, a request waits up to 10 seconds for one before falling back). This is defense in depth only: multi-instance production enforcement remains the durable `THESIS_LLM_QUOTA_URL` reservation service.

## Deploying

The live demo runs on one EC2 host with Docker (Caddy for HTTPS, the app, and the durable quota service). The exact runbook, including snapshots before a deploy, the rollback behaviour, and the Bitget session-limit lesson, is in [`deploy/README.md`](../deploy/README.md). The app is a standard Next.js standalone build (`Dockerfile`), so it also runs on any Docker host; the repository no longer ships Vercel configuration because Vercel was not used.

Minimum production settings, wherever it runs:

1. `THESIS_PUBLIC_ORIGINS`: the exact HTTPS origin(s) that serve the app. Production POST routes fail closed without it.
2. `THESIS_RECOMPUTE_SIGNING_SECRET` (`openssl rand -hex 32`) and `THESIS_VISITOR_HASH_SECRET`: server-only, never `NEXT_PUBLIC_`.
3. For AI: the model variables plus a reachable quota service (`THESIS_LLM_QUOTA_URL` and the budget variables above). With `THESIS_LLM_ENABLED=false` the app still runs: chat falls back to quick edits and the evidence review reports "Assessment unavailable".
4. Set a **credit limit on the provider key** in the provider's dashboard. The ledger bounds spend per day, but only the provider can enforce a hard cap.

## Drafts and validation telemetry

**Save draft** stores the current plan, source passage, URL reference, and market mode in this browser's `localStorage`, including incomplete numeric strings while editing. **Restore saved** restores those inputs without submitting them; **Clear** removes the saved draft. Storage is not encrypted or synchronized across devices. Do not save confidential material unless local browser storage is acceptable for it. Markdown and JSON exports also support current partial reports: a market failure is preserved as missing data rather than replaced with a previous report's market data.

Telemetry is disabled by default. To enable the client events and server sink, set `NEXT_PUBLIC_TELEMETRY_ENABLED=true` at build time and `THESIS_TELEMETRY_ENABLED=true` on the server. The workbench then shows an unchecked **Share anonymous validation events** control; events are sent only after a tester opts in. Without `THESIS_TELEMETRY_ENDPOINT`, events are written as sanitized server log records for the host's log collector. With an endpoint, the server forwards only the validated event envelope. Events contain no thesis, source text, URL, API key, IP address, or provider response. The event set is designed to answer whether a tester submitted, completed, recovered from an error, used a follow-up, refreshed live data, exported a brief, or restored a draft.

## Architecture

~~~text
Browser workbench (chat, radar, plan, brief)
  -> POST /api/radar   headlines (Yahoo RSS, NVIDIA newsroom, SEC 8-K) + Bitget book + US quote
                       -> buildMarketContext (session, move since close, tracking basis)
  -> POST /api/chat    one bounded model call -> plan patch + headline IDs + action
                       -> pure applyPlanPatch (schema-validated) | rule-based fallback
  -> POST /api/research
      -> headline IDs resolved from the server cache -> official full text or labeled feed summary
      -> pasted text (optional, labeled unverified)
      -> Bitget adapter or captured replay -> pure Decimal.js economics
      -> US quote -> market context
      -> claim adapter (claims-v5 for pasted-only, claims-v7-multisource with dated provenance)
      -> shared announcement-date validation + optional bounded factual investigation
          -> durable quota-service reserve/settle when production AI is enabled
      -> validated ResearchResult (`research-v4`, evidence-v3 audit fingerprint)
  -> POST /api/recompute for economics-only changes
  -> deterministic Markdown or JSON export
~~~

The pure domain modules do not read the network, environment, clock, or UI state. Revisions and request IDs prevent late responses from replacing a newer plan. Evidence hashes exclude notional, fees, goals, and scenarios. Economics hashes include normalized numeric inputs, the snapshot hash, and the formula version.

The visual source of truth is `src/app/hallmark.css` plus `tokens.css`; the legacy `globals.css` and `page.module.css` files are intentionally removed.

## Economics model

For a long, entry sweeps asks up to the purchase notional, rounds quantity down to the instrument step, and re-sweeps that quantity. The entry fee is additional cash. Exit sweeps bids with an explicit depth multiplier and price haircut. A hypothetical short opens on bids and closes on asks, with an editable borrow-fee assumption; the application does not establish borrow availability or execute either side. All fees are included in the conditional result.

All money and quantity arithmetic uses Decimal.js. `null` means unavailable; it is never displayed as zero. A partial or insufficient-depth result keeps usable fields and does not invent a whole-position PnL.

## API surface

- `POST /api/radar` returns headlines and the close-comparison market context for an asset and mode.
- `POST /api/chat` turns a conversation turn into a validated plan patch, evidence selection and action.
- `POST /api/research` builds the validated evidence, market-context and economics brief.
- `POST /api/market` retrieves captured or live market data plus the market context.
- `POST /api/recompute` recalculates economics from an already returned instrument and snapshot without calling the claim model.
- `POST /api/intent` applies a strict single-command edit (kept for API compatibility; the chat uses it as its first fallback).
- `POST /api/telemetry` accepts only the small validated event envelope when telemetry is enabled.

All POST routes validate input. Browser-origin checks apply to production POST requests. Provider keys are read only on the server.

## Optional factual investigation

The public demo has investigation enabled. A fresh installation defaults to **false**; set `THESIS_INVESTIGATION_ENABLED=true` on its server to opt in. This is a runtime server setting, not a browser toggle. Restart the application after changing it. The deployment script deliberately does not sync this flag from the example environment, so a deployment cannot silently enable it.

The investigation chooses one material factual claim that is insufficient or contradicted and matches an available source: Bitget earnings/analyst records, SEC revenue/filing metadata, or NVIDIA's newsroom. Forecasts are excluded. It performs at most two source lookups under a shared eight-second transport deadline and, when new evidence needs interpretation, at most one additional assessment with a twelve-second provider timeout using the existing quota ledger. Session cleanup and model-budget admission/settlement have their own bounded overhead; the timeout is not an end-to-end latency claim. It reports source failure, no relevant records, unresolved evidence and supported/contradicted claims separately. Historical replay never fetches current investigation records. With the flag off, there are no extra investigation lookups or model calls.

SEC company totals cannot prove revenue from a specific deal; filing metadata cannot prove filing contents. Results show selected claim, reason, prior status, lookup outcomes, citations, next fact, provider usage and reference time. The [bounded October 4 live verification](../evals/investigation/validation-2026-10-04.json) records observed behavior; it does not establish broad reliability or independent user value.

## Announcement-date validation

The shared `evidence-rules-v1` check can recover an omitted announcement-date correction when the exact factual premise matches an official release explicitly saying “today announced.” It uses the report's reference date (September 8 in captured replay), not the recording date. Publication date alone, uncertain time zones/adjacent days, unrelated releases and user-pasted material cannot establish that contradiction. When only this narrow rule runs, the report labels its origin and does not claim the full thesis was reviewed.

## Reading partial briefs

**Assessment unavailable** (`not_assessed` in exports) means no model result exists because assessment was disabled, over budget or unsuccessful. It is not a negative verdict. If a quoted excerpt cannot be verified against the source, the claim is downgraded to insufficient with an explanation. A narrow deterministic date correction does not imply a full model review of the thesis.

Close-comparison levels are the best bid for a long or best ask for a hypothetical short shifted by the whole-book threshold. They are indicators, not fill prices. The comparison assumes one token tracks one underlying share and shows the observed tracking basis when a fresh US print exists.

## Data sources

| Source | Used for | Mode |
| --- | --- | --- |
| **Bitget Agent Hub: `bitget-mcp-server`** (`agent.bitget.com/mcp`) | Dated analyst price targets, earnings calendar, Bitget news and the daily macro briefing as selectable evidence; the US Fear & Greed index for market mood | Live |
| **Bitget Agent Hub: `bitget-signal` news-briefing, sentiment-analyst and macro-analyst skills** | Company news, crypto market mood and the rates backdrop, each called through the skill's own tool. When a skill doesn't answer, the brief says so and uses the Bitget data above instead | Live |
| **Bitget US quote** (`bitget-mcp-server`) | Cross-checks the underlying close used for the close comparison | Live |
| **Bitget Agent Hub CLI (`bgc`) handoff** | Copy-only commands (read-only price check, then a dry-run IOC limit order) for the trader to run themselves; ThesisGate sends nothing | Live |
| **Bitget Agent Hub: `bitget-signal` technical-analysis skill** | 14-day ATR (typical daily range) and RSI, shown as scale context next to the goal; falls back to the same indicators computed from daily bars | Live |
| Bitget public API (`/api/v3/market/*`) | rToken instrument rules, ticker, 50-level order book | Live; captured Sep 8 fixture for replay |
| Yahoo Finance chart endpoint | Underlying last regular close and latest extended-hours print | Live; captured values for replay |
| Yahoo Finance ticker RSS | Company headlines and summaries (filtered to stories naming the company) | Live |
| NVIDIA Newsroom RSS and release pages | Official releases; full text retrieved from the allowlisted host | Live; captured release for replay |
| SEC EDGAR 8-K feed, submissions metadata and XBRL revenue concepts | Filing dates and reported revenue by period; totals do not prove deal attribution | Live, only when `THESIS_SEC_USER_AGENT` is set (SEC requires a contact) |

All fetches are server-side, to fixed URLs or an allowlisted host, with timeouts, body caps and no cross-host redirects. The browser only ever sends headline **IDs**; the server resolves them from its own cache, so a browser cannot inject text labeled as a retrieved source. Yahoo endpoints are public but unofficial. Check their terms before any commercial use.

The US-session calendar covers 2026–2027 and must be extended for later years.

## Terms

| Term | Simple meaning |
| --- | --- |
| **rToken** | A crypto token designed to track a stock. It is not the stock itself, and its rights, liquidity and risks can differ. |
| **Last close** | The underlying stock's official close from the latest completed US regular session. |
| **Moved since close** | rToken mid-price versus that close: how much the 24/7 venue has already moved. |
| **Thesis** | Your reason for the trade, written as claims that can be checked. |
| **Bid / ask** | Prices buyers are offering / sellers are asking. |
| **Depth** | Quantity available near the best prices. Thin depth makes large trades fill worse. |
| **Break-even shift** | The exit-book shift needed to cover the modeled costs: bids for a long, asks for a hypothetical short. |
| **Goal threshold** | The exit-book shift needed for your stated net profit or return under the chosen assumptions. |
| **Scenario** | A what-if you choose, not a prediction. |
