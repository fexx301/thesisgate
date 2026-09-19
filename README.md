# ThesisGate

## In plain English

ThesisGate helps you test whether the pasted passage supports a trading idea and whether a stock-linked crypto token trade still works after fees and limited liquidity.

Paste the source passage, describe what you think it means, choose rNVDA or rTSLA, and review two separate parts of the brief:

1. **Evidence:** what the words you supplied support, contradict, or leave unanswered.
2. **Trade math:** what the displayed market data would require after fees, order-book depth, quantity steps, and your chosen what-if price scenario.

You make the decision. ThesisGate does not place orders, predict prices, treat an rToken as the underlying stock, or promise that displayed liquidity will still be available.

> **Prototype status:** The current slice supports Reality SPOT rNVDA and rTSLA. It is a research and scenario tool, not a broker, execution bot, portfolio manager, or investment recommendation.

## Start here

### Run the app locally

Use Node `>=24` for the app and contributor workflow. The repository's `.nvmrc` pins Node `24.14.0`; with nvm installed, run `nvm install && nvm use` before installing dependencies.

From a cloned or downloaded copy of the repository, open a terminal in the project root and run:

~~~bash
npm ci
npm run dev
~~~

Open <http://localhost:3000>.

For the first successful run:

1. Click **Replay captured example**.
2. Review the brief that appears on the right.
3. Change one input, such as the budget, objective, or price scenario.
4. Click **Stress-test my thesis** again.

After the first brief, edits to the budget, objective, fees, depth, haircut, or scenario recompute the economics without another model call, including when evidence was not assessed. A source-URL reference edit updates provenance without reassessing the pasted text. A market-mode change or live refresh requests a new market snapshot. A thesis, horizon, or source-text change requires a new evidence assessment.

The captured example is historical replay data. It is included so the economics can be demonstrated without a live network request or an AI provider key.

The captured example calculates conditional economics without a model key. The evidence section may show `not_assessed` when the optional local claim model is disabled, unavailable, or fails to return a valid assessment. That status means no usable claim assessment is available; it is not a negative verdict.

### Test your own idea

1. In **What do you think will happen?**, write the exact claim you want to examine.
2. Paste the relevant passage into **Source text**.
3. Optionally add the source URL as a reference.
4. Choose `rNVDA` or `rTSLA`.
5. Enter the amount in `USDT`, your holding horizon, and an objective.
6. Choose a price scenario, such as `+1%`.
7. Choose **Captured example** or **Attempt live data**.
8. Click **Stress-test my thesis**.

The app reads the text you paste. It does not fetch the URL or treat an official-looking URL as proof that the pasted text is authentic.

## How to read the brief

### Evidence behind your thesis

This section asks whether the supplied words support the exact claim. It does not decide whether the trade will make money.

If the status is `not_assessed`, no usable claim assessment is available: the model may be disabled, unavailable, or have failed. That is not the same as “unsupported” or “contradicted.” The text remains visible, and the economics can still be calculated.

To explicitly try failed or unavailable evidence again, choose **Retry evidence assessment**, or submit an unchanged plan with **Stress-test my thesis**. Economics-only edits do not silently retry the model. With the model disabled, a retry still reports `not_assessed`; it does not invent an assessment.

### Economics under your assumptions

This section models a hypothetical entry and exit using the displayed order book, fees, quantity rules, available depth, and your chosen scenario.

The **break-even shift** is the conditional movement in displayed bid prices needed to cover modeled costs. It is not a forecast, a probability, a native-stock return, or a promise of execution.

A stale snapshot is flagged but may still produce conditional math. Missing or insufficient depth can make whole-position profit or loss unavailable, and the report preserves that limitation instead of inventing a result.

Live results show when the snapshot was received and its current age. Use **Refresh live snapshot** when the age is no longer appropriate for your decision. The button requests a new book and reuses the existing evidence review.

### Unknowns and provenance

Read the timestamps, source label, market mode, warnings, and assumptions before interpreting a number. A live result is a request-time snapshot. A captured result is historical replay data. Neither is a fill or a guarantee that the same depth will remain available.

## What the terms mean

| Term | Simple meaning |
| --- | --- |
| **rToken** | A crypto token designed to be linked to a stock. It is not the stock itself, and its rights, liquidity, and risks can differ. |
| **Thesis** | Your reason for considering the trade, written as a claim that can be examined. |
| **SPOT** | Buying or selling the token itself, without leverage or a derivative position in this tool. |
| **USDT** | The dollar-denominated crypto unit used for the trade budget and goals in this app. |
| **Order book** | The prices and quantities currently shown by buyers and sellers. |
| **Bid** | A price a buyer is offering. |
| **Ask** | A price a seller is offering. |
| **Depth** | How much quantity is available across nearby prices. Limited depth can make a larger trade receive worse average prices. |
| **Snapshot** | A copy of the market data at one point in time. |
| **PnL** | Profit or loss after the costs included in the calculation. |
| **Threshold** | The conditional price movement required to reach the selected objective under the displayed assumptions. |
| **Scenario** | A user-selected “what if,” not a prediction of what will happen. |

## Market data modes

### Captured example

Uses a historical public API capture from the selection spike. It is deterministic, useful for demos and tests, and clearly labeled as historical. It avoids a live network request.

### Attempt live data

Requests a public Bitget market snapshot at run time for the fixed `RNVDAUSDT` or `RTSLAUSDT` allowlist.

- It is a request-time snapshot, not a streaming feed.
- It uses public market endpoints, so no private Bitget key is needed.
- It reads instrument rules, ticker context, and order-book levels.
- It validates the symbol and market category before using the data.
- It does not silently fall back to the historical fixture if the live request fails.
- It does not place an order or confirm that the displayed liquidity is executable for you.

## Boundaries that matter

- **Source text:** You must paste the passage. The optional URL is attribution only; URL retrieval is disabled in this slice.
- **Evidence:** Pasted text is labeled `user_pasted_unverified`. A source verdict is not independent fact-checking.
- **Market data:** Numbers describe one captured or request-time book. They can become stale immediately.
- **Scenario:** A bid-price shift is an explicit assumption, not a price target or forecast.
- **AI:** Claim assessment is optional, server-side, and visibly marked `not_assessed` when it is unavailable.
- **Trade scope:** The supported plan is long-only SPOT, meaning buy the token and later model selling it. Leverage, short positions, derivatives, and portfolio behavior are out of scope.
- **Defaults:** The starting fee assumption is 0.1% on entry and 0.1% on exit. It is a published standard assumption, not an account-tier lookup. Exit depth starts at 100% and the extra price haircut starts at 0%; both can be changed.
- **Horizon:** The holding-horizon text provides context only. The static order book does not model how price, depth, or returns change over time.
- **Source size:** Text is canonicalized and limited to 15,000 characters before hashing and optional claim assessment.
- **Trading:** There are no order placement, custody, or account endpoints.

## Current status

### Built

- A source-bounded research brief for Reality SPOT `rNVDA` and `rTSLA`.
- Captured replay mode that recomputes production economics from the raw fixture.
- Live Bitget instrument, ticker, and order-book requests with a fixed symbol allowlist.
- Input validation, bounded source text, provenance labels, timestamps, warnings, and hashes.
- Decimal.js arithmetic for fees, quantity steps, entry sweeps, exit sweeps, depth, and haircuts.
- Deterministic Markdown and JSON exports from the current validated report, including partial reports with missing market data; unavailable economics and the requested market mode remain explicit.
- A math-only recomputation path that avoids repeat claim-model calls for economics changes.
- Visible run details for model name, market and model duration, model-call count, evidence reuse, and provider-reported cost.
- Browser-local draft save and restore controls, including incomplete numeric input while editing. Draft text is not sent anywhere by the draft feature; restore does not validate or run the draft automatically.
- Optional privacy-preserving success telemetry for submit, completion, failure, follow-up, refresh, export, and draft events.
- Unit, integration, browser, and evaluation-gate test coverage.
- Current local verification: typecheck, lint, 124 unit/integration tests across 17 files, production build, and 24 Chromium/mobile browser journeys pass. The durable quota ledger's unit and authenticated HTTP contract tests are included. The dry-run evaluator covers all 12 benchmark cases with 22 planned provider calls and makes zero provider calls.

### Not ready for public AI use

- **UNVERIFIED — real trader validation:** No five-trader study has been completed. The [practitioner validation sheet](evals/practitioner-validation-sheet.md) is a protocol, not results; code, automated tests, and developer review do not satisfy it.
- **UNVERIFIED — production model spending controls:** A reference durable quota service now exists in `quota-service/`, with transactional ledger tests, but runtime claim assessment stays disabled until that service is actually deployed with a persistent volume, backup/restore, TLS, concurrent multi-instance checks, and a real provider/account hard cap. Local code and passing tests cannot prove those external controls are active.
- URL retrieval stays disabled until its server-side request-forgery protections are complete.
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

When enabled, the server sends the thesis and canonicalized pasted source text to the configured model provider for claim assessment. Do not submit confidential material unless that provider's data terms are acceptable for it.

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

For local development, the quota service is not required. The optional `THESIS_LLM_LOCAL_MAX_CONCURRENT` variable limits simultaneous local model calls in the running process. All POST routes also enforce a single-process per-visitor guard (30 requests/minute per route; model analyses 5 per visitor per 10 minutes with a 200/day global cap). This is defense in depth only: multi-instance production enforcement remains the durable `THESIS_LLM_QUOTA_URL` reservation service.

### Deploying a production replay demo

This checklist deploys a **model-disabled captured-replay walkthrough**. It does not enable paid AI or certify a hosted service. The app still exposes **Attempt live data**; `THESIS_LLM_ENABLED=false` disables model calls, not public market requests. Use **Captured example** for the no-provider, no-live-market walkthrough.

1. Import this repository into a Next.js-capable host. For Vercel, select the directory containing `package.json` as the project root, the Next.js framework preset, Node 24, install command `npm ci`, and build command `npm run build`. The included `vercel.json` sets API `Cache-Control: no-store` and function durations. On a Node host, build with `npm ci && npm run build`, then serve with `npm run start` behind HTTPS.
2. Assign the intended HTTPS domain before exposing the app. Set `THESIS_PUBLIC_ORIGINS` in that deployment's server environment to its **exact origin**, such as `https://demo.example` (illustrative only), or a comma-separated list of exact origins. Include a preview origin only if that deployment must accept it. Do not include paths, trailing slashes, wildcard hosts, or the example domain. Missing or mismatched origins make production POST requests fail closed.
3. Generate a unique secret with `openssl rand -hex 32` and store its output in the host's secret store as `THESIS_RECOMPUTE_SIGNING_SECRET`. It is **mandatory for production replay and economics reuse**, independently of model quota settings. Do not commit it or expose it through a `NEXT_PUBLIC_` variable.
4. Set `THESIS_LLM_ENABLED=false`, `NEXT_PUBLIC_TELEMETRY_ENABLED=false`, and `THESIS_TELEMETRY_ENABLED=false`. Leave the model key, endpoint, model, and model-only quota variables unset. `.env.example` separates these groups; local development does not require the production origin or signing-secret settings.
5. Build and deploy with those environment values. `NEXT_PUBLIC_` settings are baked into the browser bundle, so changing telemetry requires rebuilding. Do not enable model assessment merely because deployment succeeds.
6. In a logged-out browser on the actual allowed HTTPS origin, select **Replay captured example**. Confirm historical captured provenance, visible `not_assessed` evidence, and conditional economics. Change the budget or scenario and submit; confirm economics recompute while evidence is reused. Export Markdown and JSON and check unavailable fields remain unavailable. Save an incomplete draft, restore it, and confirm its text survives without an automatic request.
7. Record the real deployed URL and the observed smoke-test outcome before sharing it. No hosted link or successful production smoke test is claimed in this README. A replay demo does not resolve the external model-budget gates or real five-trader validation.

### Drafts and validation telemetry

**Save draft** stores the current plan, source passage, URL reference, and market mode in this browser's `localStorage`, including incomplete numeric strings while editing. **Restore saved** restores those inputs without submitting them; **Clear** removes the saved draft. Storage is not encrypted or synchronized across devices. Do not save confidential material unless local browser storage is acceptable for it. Markdown and JSON exports also support current partial reports: a market failure is preserved as missing data rather than replaced with a previous report's market data.

Telemetry is disabled by default. To enable the client events and server sink, set `NEXT_PUBLIC_TELEMETRY_ENABLED=true` at build time and `THESIS_TELEMETRY_ENABLED=true` on the server. The workbench then shows an unchecked **Share anonymous validation events** control; events are sent only after a tester opts in. Without `THESIS_TELEMETRY_ENDPOINT`, events are written as sanitized server log records for the host's log collector. With an endpoint, the server forwards only the validated event envelope. Events contain no thesis, source text, URL, API key, IP address, or provider response. The event set is designed to answer whether a tester submitted, completed, recovered from an error, used a follow-up, refreshed live data, exported a brief, or restored a draft.

### Architecture

~~~text
Browser workbench
  -> strict POST /api/research
      -> server-only source normalization
      -> server-only Bitget adapter or explicit captured replay
      -> pure Decimal.js economics
      -> optional server-only claim adapter
          -> durable quota-service reserve/settle when production AI is enabled
      -> validated canonical ResearchResult (`research-v2`)
  -> /api/recompute for economics-only changes
  -> deterministic Markdown or JSON export
~~~

The pure domain modules do not read the network, environment, clock, or UI state. Revisions and request IDs prevent late responses from replacing a newer plan. Evidence hashes exclude notional, fees, goals, and scenarios. Economics hashes include normalized numeric inputs, the snapshot hash, and the formula version.

The visual source of truth is `src/app/hallmark.css` plus `tokens.css`; the legacy `globals.css` and `page.module.css` files are intentionally removed.

### Economics model

Entry spends the requested USDT budget across asks, floors the resulting quantity to the instrument quantity step, and re-sweeps the same asks. Exit sweeps the bought quantity across bids with an explicit depth multiplier and price haircut. Fees are applied as cash multipliers.

All money and quantity arithmetic uses Decimal.js. `null` means unavailable; it is never displayed as zero. A partial or insufficient-depth result keeps usable fields and does not invent a whole-position PnL.

### API surface

- `POST /api/research` builds the validated evidence and economics brief.
- `POST /api/market` retrieves either captured or live market data.
- `POST /api/recompute` recalculates economics from an already returned instrument and snapshot without calling the claim model.
- `POST /api/intent` applies a bounded follow-up edit such as changing the budget or requesting a market refresh.
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
- [fixtures/synthetic-book-v1.json](fixtures/synthetic-book-v1.json) supports deterministic calculator tests.
- The [evidence/](evidence/) records are sanitized smoke and catalog artifacts. They show reachability, normalization, or a recorded integration result, not execution quality or future liquidity.

The repository contains the source and reproducibility artifacts needed to inspect the implementation. It does not contain local credentials, private exchange data, or a claim that the displayed book will remain available.
