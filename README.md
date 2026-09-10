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

The Next app minimum is Node `>=20.9.0`. For the complete developer verification workflow, use Node `>=24`.

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

The captured example is historical replay data. It is included so the economics can be demonstrated without a live network request or an AI provider key.

The replay always gives you an economics result. The evidence section may show `not_assessed` unless the optional local claim model is configured. That status means no claim assessment was run; it is not a negative verdict.

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

If the status is `not_assessed`, the claim model did not run. That is not the same as “unsupported” or “contradicted.” The text remains visible, and the economics can still be calculated.

### Economics under your assumptions

This section models a hypothetical entry and exit using the displayed order book, fees, quantity rules, available depth, and your chosen scenario.

The **break-even shift** is the conditional movement in displayed bid prices needed to cover modeled costs. It is not a forecast, a probability, a native-stock return, or a promise of execution.

A stale snapshot is flagged but may still produce conditional math. Missing or insufficient depth can make whole-position profit or loss unavailable, and the report preserves that limitation instead of inventing a result.

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
- Deterministic Markdown and JSON exports from the validated report.
- Unit, integration, browser, and evaluation-gate test coverage.

### Not ready for public AI use

- Independent trader validation is still an open gate.
- Runtime claim assessment stays disabled in production until durable per-visitor limits, concurrency controls, atomic budget reservations, and a provider hard limit are configured.
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
npm run build
npm run test:e2e
~~~

`npm run test:e2e` starts a dev server on port `3101` when one is not already running. To point the browser tests at an existing server:

~~~bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3101 npm run test:e2e
~~~

The evaluation runner uses Node's native TypeScript stripping and requires Node `>=24`. Vitest 5 and the full verification workflow also require a Node 22.12 or 24-class runtime, so Node `>=24` is the simplest recommendation for contributors.

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

### Architecture

~~~text
Browser workbench
  -> strict POST /api/research
      -> server-only source normalization
      -> server-only Bitget adapter or explicit captured replay
      -> pure Decimal.js economics
      -> optional server-only claim adapter
      -> validated canonical ResearchResult
  -> deterministic Markdown or JSON export
~~~

The pure domain modules do not read the network, environment, clock, or UI state. Revisions and request IDs prevent late responses from replacing a newer plan. Evidence hashes exclude notional, fees, goals, and scenarios. Economics hashes include normalized numeric inputs, the snapshot hash, and the formula version.

### Economics model

Entry spends the requested USDT budget across asks, floors the resulting quantity to the instrument quantity step, and re-sweeps the same asks. Exit sweeps the bought quantity across bids with an explicit depth multiplier and price haircut. Fees are applied as cash multipliers.

All money and quantity arithmetic uses Decimal.js. `null` means unavailable; it is never displayed as zero. A partial or insufficient-depth result keeps usable fields and does not invent a whole-position PnL.

### API surface

- `POST /api/research` builds the validated evidence and economics brief.
- `POST /api/market` retrieves either captured or live market data.
- `POST /api/intent` applies a bounded follow-up edit such as changing the budget or requesting a market refresh.

All three routes validate input. Browser-origin checks apply to production POST requests. Provider keys are read only on the server.

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

The runner still produces an **unscored** report and artifacts. A final research-gate report is a separate step. `npm run eval` intentionally exits non-zero until `THESISGATE_EVAL_REPORT` points to a genuinely scored 12-case report with status `scored-final`.

The final report validator requires:

- all twelve effective packet hashes;
- real candidate, general-baseline, and calculator artifacts with matching SHA-256 files;
- frozen input and configuration hashes;
- explicit observed outcomes;
- a fair same-model baseline;
- machine-checked numeric results;
- structured grader fields and a declared grader.

The paid-run controls are `THESISGATE_EVAL_MODE`, `THESISGATE_EVAL_CASES`, `THESISGATE_ALLOW_PAID_EVAL`, and `THESISGATE_EVAL_MAX_CALLS`. The public benchmark inputs and schema are [evals/cases.json](evals/cases.json), [evals/benchmark-manifest.json](evals/benchmark-manifest.json), and [evals/report.template.json](evals/report.template.json). Do not replace case evidence with aggregate counters or placeholder artifacts.

## Public evidence and fixtures

- [fixtures/selection-probe.json](fixtures/selection-probe.json) is a historical public API capture used for deterministic replay.
- [fixtures/synthetic-book-v1.json](fixtures/synthetic-book-v1.json) supports deterministic calculator tests.
- The [evidence/](evidence/) records are sanitized smoke and catalog artifacts. They show reachability, normalization, or a recorded integration result, not execution quality or future liquidity.

The repository contains the source and reproducibility artifacts needed to inspect the implementation. It does not contain local credentials, private exchange data, or a claim that the displayed book will remain available.
