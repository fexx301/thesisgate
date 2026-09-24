# ThesisGate

## In plain English

Bitget's rNVDA and rTSLA stock tokens trade 24/7, including nights, weekends and US holidays when Wall Street is closed. That is exactly when a headline lands and the token's order book is the only place the trade exists, usually at its thinnest.

ThesisGate is a research copilot for that moment. Describe the trade you're weighing in plain language, for example *"Jensen says the AI boom won't slow for 2–3 years, I think rNVDA bounces before Monday's open, thinking 3k, want about 60 USDT"*, and it:

1. **Turns the message into a precise plan**: token, amount, horizon, goal, and any what-if you ask for. Follow-ups such as *"what if I only put in 1,500?"* or *"what if exit liquidity halves?"* edit the same plan.
2. **Pulls the evidence itself**: current company headlines, the issuer's official newsroom (full text of NVIDIA releases), and optionally SEC 8-K filings. You can also paste your own passage.
3. **Checks what the sources actually support**, claim by claim, with quotes verified against the source text and publication dates compared with your thesis. An old announcement circulating again is flagged as old, not new.
4. **Shows what is already priced in**: where the rToken trades against the underlying stock's last US close, whether the US market is open, and where your break-even and goal sit relative to that close.
5. **Works out the trade math** from the live order book: fees, quantity steps, depth, the break-even move and your goal's threshold.

You make the decision. ThesisGate never places orders, predicts prices, or tells you to buy or sell. The evidence verdict and the trade math are separate conclusions, and neither is a forecast.

> **Status:** a working prototype for Reality SPOT rNVDA and rTSLA, long only. It is a research tool, not a broker, execution bot or investment recommendation.

## Start here

### Run the app locally

Use Node `>=24`. The repository's `.nvmrc` pins Node `24.14.0`; with nvm, run `nvm install && nvm use` first.

~~~bash
npm ci
npm run dev
~~~

Open <http://localhost:3000>. The app opens in **Live** mode: the after-hours radar loads current headlines, the Bitget book and the US quote.

- **Try it with no setup:** click **Replay captured example**. It replays the real Sep 8, 2026 after-hours book with the NVIDIA/AWS release as evidence, and needs no network or AI key.
- **Try the conversation:** type a trade idea in **Describe the trade**, or click a suggestion. The full conversational layer and the claim review need a model key (see [Optional local claim model](#optional-local-claim-model)). Without one, the chat still applies simple edits (amounts like "3k", switching token, horizons, profit goals, "assume bids rise 1%", halving depth or amount, refreshing prices) and says it is in simple-edit mode.

After a brief exists, economics-only changes (amount, goal, fees, depth, scenario) recompute without another model call. Changing the thesis, horizon, token or evidence selection re-runs the claim review.

## How to read the brief

| Section | Question it answers |
| --- | --- |
| **At a glance** | Evidence verdict, plus the scenario result (or, with no scenario, what your goal needs). |
| **Priced in since the close?** | Where the rToken trades against the underlying's last regular-session close, the US session state, and your break-even and goal as price levels versus that close. |
| **Evidence behind your thesis** | Each claim in your thesis (factual, causal, forecast) marked supported, contradicted or insufficient, with verified quotes. |
| **Economics under your assumptions** | Entry VWAP, fees, friction, break-even shift, goal threshold and scenario PnL from the displayed book. |
| **What would change this?** | The specific evidence to look for, and the price levels that matter. |
| **Sources and provenance** | Publisher, publication date, how the text was obtained, and a text hash for each source. |

**Assessment unavailable** (`not_assessed` in exports) means no model result exists (disabled, over budget, or failed). It is not a negative verdict. If the model quotes text that cannot be found in the source, that claim is downgraded to *insufficient* with an explanation, instead of being trusted.

The price levels in the priced-in card are the best bid moved by the whole-book threshold. They indicate where the market must trade; they are not fill prices. One rToken is assumed to track one underlying share; the live tracking basis is shown when a fresh US print exists.

## What the terms mean

| Term | Simple meaning |
| --- | --- |
| **rToken** | A crypto token designed to track a stock. It is not the stock itself, and its rights, liquidity and risks can differ. |
| **Last close** | The underlying stock's official close from the latest completed US regular session. |
| **Moved since close** | rToken mid-price versus that close: how much the 24/7 venue has already moved. |
| **Thesis** | Your reason for the trade, written as claims that can be checked. |
| **Bid / ask** | Prices buyers are offering / sellers are asking. |
| **Depth** | Quantity available near the best prices. Thin depth makes large trades fill worse. |
| **Break-even shift** | How far the bid book must rise to cover fees and spread on your size. |
| **Goal threshold** | How far the bid book must rise for your stated profit or return. |
| **Scenario** | A what-if you choose, not a prediction. |

## Data sources

| Source | Used for | Mode |
| --- | --- | --- |
| Bitget public API (`/api/v3/market/*`) | rToken instrument rules, ticker, 50-level order book | Live; captured Sep 8 fixture for replay |
| Yahoo Finance chart endpoint | Underlying last regular close and latest extended-hours print | Live; captured values for replay |
| Yahoo Finance ticker RSS | Company headlines and summaries (filtered to stories naming the company) | Live |
| NVIDIA Newsroom RSS and release pages | Official releases; full text retrieved from the allowlisted host | Live; captured release for replay |
| SEC EDGAR 8-K Atom feed | Regulatory filings | Live, only when `THESIS_SEC_USER_AGENT` is set (SEC requires a contact) |

All fetches are server-side, to fixed URLs or an allowlisted host, with timeouts, body caps and no cross-host redirects. The browser only ever sends headline **IDs**; the server resolves them from its own cache, so a browser cannot inject text labeled as a retrieved source. Yahoo endpoints are public but unofficial. Check their terms before any commercial use.

## Boundaries that matter

- **Evidence:** a verdict means "by the supplied sources". Feed summaries are labeled as summaries; pasted text is labeled unverified.
- **Market data:** one request-time or captured book. It can go stale immediately, and live requests never fall back to the fixture.
- **Scenario:** a bid-price shift is an explicit assumption, not a target or forecast.
- **Horizon:** context only. The static book does not model time.
- **Defaults:** 0.1% fee each side (a published standard, not your account tier), 100% exit depth, 0% haircut. All editable.
- **Trade scope:** long-only SPOT. No leverage, shorts, derivatives, orders, custody or account access.
- **Calendar:** US session logic covers the NYSE calendar for 2026–2027 and must be extended after that.

## Current status

### Built

- Conversational plan builder: one bounded JSON-mode model call per message returns a plan patch, evidence selection and action. The patch is applied by a pure, schema-validated applier (`src/domain/plan-patch.ts`) that cannot touch protected fields. A deterministic fallback handles common edits when the model is unavailable.
- After-hours radar: live company headlines, official newsroom full text, optional SEC 8-K filings, US session state, and the rToken's move since the last close.
- Multi-source claim review with dated provenance, recirculation detection, tolerant but verified citation matching, and honest downgrading of unverifiable quotes.
- Priced-in card: session, move since close, tracking basis, and break-even, goal and scenario as price levels versus the close.
- Decimal.js order-book economics, captured and live modes, a math-only recompute path, and deterministic Markdown/JSON exports that include the priced-in context and selected headlines.
- Revision safety: late responses never overwrite newer edits, including chat replies that return after a manual edit.
- Current local verification: typecheck, lint, 159 unit/integration tests across 22 files, production build, and 26 Chromium/mobile browser journeys pass.

### Not ready for public AI use

- **UNVERIFIED — real trader validation:** No five-trader study has been completed. The [practitioner validation sheet](evals/practitioner-validation-sheet.md) is a protocol, not results; code, automated tests, and developer review do not satisfy it.
- **UNVERIFIED — production model spending controls:** A reference durable quota service now exists in `quota-service/`, with transactional ledger tests, but runtime claim assessment stays disabled until that service is actually deployed with a persistent volume, backup/restore, TLS, concurrent multi-instance checks, and a real provider/account hard cap. Local code and passing tests cannot prove those external controls are active.
- Arbitrary URL retrieval stays disabled; only the fixed feeds and the allowlisted newsroom host are fetched.
- A public deployment is not implied by this repository. The local app and public source repository are separate from a hosted service.

## For developers

### Install and verify

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

### Optional local claim model

Basic captured and live economics do not require an AI key. A compatible server-side model is needed only when you want runtime claim assessment during local development.

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

The reproducible benchmark configuration is frozen in [evals/benchmark-manifest.json](evals/benchmark-manifest.json). A different provider, model, prompt, or reasoning setting is a different experiment and must not be presented as the same benchmark run.

Keep the key in `.env.local`, never in source, browser state, logs, or exported reports. Public model use must remain disabled until the production budget and concurrency gates are satisfied.

### Production request protection

Before deployment, set `THESIS_PUBLIC_ORIGINS` to the exact HTTPS origin or comma-separated origins that serve the app. Production POST routes fail closed when the allowlist is missing or the request origin is not listed. Localhost and test runs do not require this deployment setting.

These settings apply **only to production model calls**, not to the model-disabled replay demo. Production claim-model calls fail closed until the durable quota service is deployed and verified. The app-side adapter calls the reference service in [`quota-service/`](quota-service/), but that service is a separate process and is not automatically deployed with the Next.js app. Set these server-only variables only as part of a separately verified model rollout:

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

Run the reference service locally with `npm run quota:start` after setting the `THESIS_QUOTA_*` values in [`.env.example`](.env.example); its detailed volume, container, reconciliation, and restore instructions are in [`quota-service/README.md`](quota-service/README.md). The service rejects limit mismatches between its environment and the calling app rather than silently choosing one.

The provider hard limit must still be enforced by the provider account or an effective external control, not merely declared in an environment variable. The service-side provider ceiling is an additional UTC-day reservation cap; it is not proof of the provider's billing cap. The durable service's local unit/HTTP tests pass, but its persistent deployment, backup/restore, multi-instance load behavior, TLS path, and provider/account hard cap are **external UNVERIFIED gates**. Keep `THESIS_LLM_ENABLED=false` until those actual deployment checks are recorded.

`THESIS_RECOMPUTE_SIGNING_SECRET` is a separate production requirement even when the model is disabled and all quota variables are unset. Research and market responses carry a server-signed receipt for their validated instrument and snapshot; `/api/recompute` rejects browser-substituted market data. The receipt authenticates origin, not freshness. Use the visible exchange age and refresh control when current data matters. Keep one strong secret consistent across serving instances; rotating it invalidates previously issued receipts and requires a fresh research or market request.

For local development, the quota service is not required. The optional `THESIS_LLM_LOCAL_MAX_CONCURRENT` variable limits simultaneous local model calls in the running process. All POST routes also enforce a single-process per-visitor guard (30 requests/minute per route; claim analyses 5 per visitor per 10 minutes with a 200/day global cap; chat turns have a separate 20 per 10 minutes and 600/day bucket). This is defense in depth only: multi-instance production enforcement remains the durable `THESIS_LLM_QUOTA_URL` reservation service.

### Deploying a production demo

This checklist deploys a **model-disabled** demo. It does not enable paid AI or certify a hosted service. The app opens in **Live** mode and calls the public market and news endpoints; `THESIS_LLM_ENABLED=false` disables model calls only. Use **Captured replay** for the no-provider, no-network walkthrough. Some exchanges and data providers restrict datacenter or regional traffic, so confirm the live radar actually loads from the chosen host region.

1. Import this repository into a Next.js-capable host. For Vercel, select the directory containing `package.json` as the project root, the Next.js framework preset, Node 24, install command `npm ci`, and build command `npm run build`. The included `vercel.json` sets API `Cache-Control: no-store` and function durations. On a Node host, build with `npm ci && npm run build`, then serve with `npm run start` behind HTTPS.
2. Assign the intended HTTPS domain before exposing the app. Set `THESIS_PUBLIC_ORIGINS` in that deployment's server environment to its **exact origin**, such as `https://demo.example` (illustrative only), or a comma-separated list of exact origins. Include a preview origin only if that deployment must accept it. Do not include paths, trailing slashes, wildcard hosts, or the example domain. Missing or mismatched origins make production POST requests fail closed.
3. Generate a unique secret with `openssl rand -hex 32` and store its output in the host's secret store as `THESIS_RECOMPUTE_SIGNING_SECRET`. It is **mandatory for production replay and economics reuse**, independently of model quota settings. Do not commit it or expose it through a `NEXT_PUBLIC_` variable.
4. Set `THESIS_LLM_ENABLED=false`, `NEXT_PUBLIC_TELEMETRY_ENABLED=false`, and `THESIS_TELEMETRY_ENABLED=false`. Leave the model key, endpoint, model, and model-only quota variables unset. `.env.example` separates these groups; local development does not require the production origin or signing-secret settings.
5. Build and deploy with those environment values. `NEXT_PUBLIC_` settings are baked into the browser bundle, so changing telemetry requires rebuilding. Do not enable model assessment merely because deployment succeeds.
6. In a logged-out browser on the actual allowed HTTPS origin, select **Replay captured example**. Confirm historical captured provenance, visible **Assessment unavailable** evidence (the model is off), the priced-in card, and conditional economics. Send a chat message such as "use 3k" and confirm simple-edit mode applies it. Change the budget or scenario and submit; confirm economics recompute while evidence is reused. Export Markdown and JSON and check unavailable fields remain unavailable. Save an incomplete draft, restore it, and confirm its text survives without an automatic request.
7. Record the real deployed URL and the observed smoke-test outcome before sharing it. No hosted link or successful production smoke test is claimed in this README. A replay demo does not resolve the external model-budget gates or real five-trader validation.

### Drafts and validation telemetry

**Save draft** stores the current plan, source passage, URL reference, and market mode in this browser's `localStorage`, including incomplete numeric strings while editing. **Restore saved** restores those inputs without submitting them; **Clear** removes the saved draft. Storage is not encrypted or synchronized across devices. Do not save confidential material unless local browser storage is acceptable for it. Markdown and JSON exports also support current partial reports: a market failure is preserved as missing data rather than replaced with a previous report's market data.

Telemetry is disabled by default. To enable the client events and server sink, set `NEXT_PUBLIC_TELEMETRY_ENABLED=true` at build time and `THESIS_TELEMETRY_ENABLED=true` on the server. The workbench then shows an unchecked **Share anonymous validation events** control; events are sent only after a tester opts in. Without `THESIS_TELEMETRY_ENDPOINT`, events are written as sanitized server log records for the host's log collector. With an endpoint, the server forwards only the validated event envelope. Events contain no thesis, source text, URL, API key, IP address, or provider response. The event set is designed to answer whether a tester submitted, completed, recovered from an error, used a follow-up, refreshed live data, exported a brief, or restored a draft.

### Architecture

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
      -> claim adapter (claims-v4 for pasted-only, claims-v5-multisource with dated provenance)
          -> durable quota-service reserve/settle when production AI is enabled
      -> validated ResearchResult (`research-v3`)
  -> POST /api/recompute for economics-only changes
  -> deterministic Markdown or JSON export
~~~

The pure domain modules do not read the network, environment, clock, or UI state. Revisions and request IDs prevent late responses from replacing a newer plan. Evidence hashes exclude notional, fees, goals, and scenarios. Economics hashes include normalized numeric inputs, the snapshot hash, and the formula version.

The visual source of truth is `src/app/hallmark.css` plus `tokens.css`; the legacy `globals.css` and `page.module.css` files are intentionally removed.

### Economics model

Entry spends the requested USDT budget across asks, floors the resulting quantity to the instrument quantity step, and re-sweeps the same asks. Exit sweeps the bought quantity across bids with an explicit depth multiplier and price haircut. Fees are applied as cash multipliers.

All money and quantity arithmetic uses Decimal.js. `null` means unavailable; it is never displayed as zero. A partial or insufficient-depth result keeps usable fields and does not invent a whole-position PnL.

### API surface

- `POST /api/radar` returns headlines and the priced-in market context for an asset and mode.
- `POST /api/chat` turns a conversation turn into a validated plan patch, evidence selection and action.
- `POST /api/research` builds the validated evidence, market-context and economics brief.
- `POST /api/market` retrieves captured or live market data plus the market context.
- `POST /api/recompute` recalculates economics from an already returned instrument and snapshot without calling the claim model.
- `POST /api/intent` applies a strict single-command edit (kept for API compatibility; the chat uses it as its first fallback).
- `POST /api/telemetry` accepts only the small validated event envelope when telemetry is enabled.

All POST routes validate input. Browser-origin checks apply to production POST requests. Provider keys are read only on the server.

### Evaluation tooling

`npm run eval:packets` prints the effective benchmark packet fingerprints.

`npm run eval:runner` creates an unscored dry-run manifest and production-calculator artifacts by default. It makes no provider calls.

To run a paid subset, opt in explicitly and set every paid-run control:

~~~bash
THESISGATE_EVAL_MODE=paid \
THESISGATE_EVAL_CASES=E01 \
THESISGATE_ALLOW_PAID_EVAL=1 \
THESISGATE_EVAL_MAX_CALLS=2 \
npm run eval:runner
~~~

The runner still produces an **unscored** report and artifacts. A final research-gate report is a separate step. `npm run eval` intentionally exits non-zero until `THESISGATE_EVAL_REPORT` points to a genuinely scored 12-case report with status `scored-final` that matches the **current implementation** and satisfies the gate. A stored historical score is not a current pass.

The final report validator requires:

- all twelve effective packet hashes;
- real candidate, general-baseline, and calculator artifacts with matching SHA-256 files;
- frozen input and configuration hashes;
- explicit observed outcomes;
- a fair same-model baseline;
- machine-checked numeric results;
- structured grader fields and a declared grader.

The paid-run controls are `THESISGATE_EVAL_MODE`, `THESISGATE_EVAL_CASES`, `THESISGATE_ALLOW_PAID_EVAL`, and `THESISGATE_EVAL_MAX_CALLS`. The public benchmark inputs and schema are [evals/cases.json](evals/cases.json), [evals/benchmark-manifest.json](evals/benchmark-manifest.json), and [evals/report.template.json](evals/report.template.json). Do not replace case evidence with aggregate counters or placeholder artifacts.

#### Historical artifacts are not the current gate

The stored benchmark records describe a frozen historical implementation. The original builder grading reported 11/12 completeness, but that is neither independent grading nor proof of the current code. Paired review removed the four unsupported unique-omission credits (E01, E04, E05, E10), leaving **zero supported unique omissions**; the historical performance threshold is not met. No independent benchmark success or completed trader study is claimed.

Use the offline paths for their distinct purposes:

~~~bash
# Integrity only: stored bytes, hashes, and artifact bindings; no performance claim.
node evals/verify-evidence.mjs

# Historical performance scoring: expected non-zero for the failed historical gate.
node evals/verify-evidence.mjs --performance

# Current implementation gate: the old report must not pass after implementation changes.
THESISGATE_EVAL_REPORT=evidence/benchmark-gate-final/report.scored.json npm run eval
~~~

The historical verifier exits `0` for valid artifact integrity, or `2` for invalid evidence. With `--performance`, it exits `1` when valid evidence fails the historical thresholds (`0` only when those thresholds pass). The current eval command rejects stale implementation bindings; it requires a new, genuinely scored report bound to the current code before any current performance claim can be made. None of these commands calls a provider or substitutes for the five-trader study.

## Public evidence and fixtures

- [fixtures/selection-probe.json](fixtures/selection-probe.json) is a historical public API capture used for deterministic replay.
- [fixtures/captured-context.json](fixtures/captured-context.json) holds the underlying closes and extended-hours prints for the same Sep 8 moment, and the NVIDIA/AWS release text (published Aug 26, 2026) used as replay evidence.
- [public/finished-brief/](public/finished-brief/) is a brief exported from a real model run of the captured replay.
- [fixtures/synthetic-book-v1.json](fixtures/synthetic-book-v1.json) supports deterministic calculator tests.
- The [evidence/](evidence/) records are sanitized smoke and catalog artifacts. They show reachability, normalization, or a recorded integration result, not execution quality or future liquidity.

The repository contains the source and reproducibility artifacts needed to inspect the implementation. It does not contain local credentials, private exchange data, or a claim that the displayed book will remain available.
