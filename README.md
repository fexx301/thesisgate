# ThesisGate

ThesisGate is a trust-first research workbench for stress-testing a retail rToken thesis. A user supplies a source passage and a proposed long SPOT trade. The app keeps two conclusions independent:

1. What the supplied evidence supports, contradicts, or leaves unresolved.
2. What the displayed order-book snapshot requires after fees, quantity steps, exit depth, and an explicit price-shift scenario.

The human makes the trading decision. ThesisGate does not place orders, infer a price forecast, or claim that displayed depth will remain available.

## Current implementation status

The first vertical slice is implemented for Reality SPOT rNVDA and rTSLA:

- Captured replay mode uses the raw `selection-probe.json` response and recomputes production math. It does not copy the fixture's preliminary calculations.
- Live mode uses a fixed Bitget symbol allowlist, concurrent instrument/ticker/book requests, explicit no-store caching, bounded retries, response limits, and no fixture fallback.
- A sanitized live smoke record covers both allowlisted Reality SPOT mappings; it is evidence of endpoint reachability and normalization only, not execution or future liquidity.
- Pasted source text is canonicalized, bounded to 15,000 characters, hashed, and labeled `user_pasted_unverified`.
- Runtime claim assessment is server-only and disabled in production until durable request and budget controls are added. Local Luna integration is recorded; missing model access remains visibly `not_assessed`.
- Markdown and JSON exports are deterministic renderings of the validated report object.
- No private Bitget credentials or order endpoints are used.

A bounded Luna integration smoke, the builder-scored 12-case research benchmark, and the desktop/mobile browser acceptance matrix are recorded. Independent trader validation, public hosting, and production budget controls remain open gates. See [`../Buildthesis.md`](../Buildthesis.md) for the acceptance contract and [`../base-camp-s2-2026/NOTE.md`](../base-camp-s2-2026/NOTE.md) for the current progress record.

## Run locally

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. The default example is explicitly labeled captured historical data. Use “Stress-test my thesis” to build the brief.

Verification commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run eval
```

`npm run eval` remains pending unless `THESISGATE_EVAL_REPORT` points to a scored 12-case report; it exits non-zero without that artifact so an unrun research gate cannot be mistaken for a pass. The current builder-scored report is under the local paid run recorded in `base-camp-s2-2026/NOTE.md`. Run `npm run eval:packets` to print the effective packet fingerprints. `npm run eval:runner` creates an unscored dry-run manifest and production-calculator artifacts by default; it makes no provider calls. Paid runs require an explicit case allowlist, `THESISGATE_ALLOW_PAID_EVAL=1`, and `THESISGATE_EVAL_MAX_CALLS`. The validator then requires all twelve effective packet hashes, real candidate/general-baseline/calculator JSON artifacts with matching SHA-256 files, frozen input/configuration hashes, explicit observed outcomes, a fair same-model baseline, machine-checked numeric results, structured grader fields, and a declared grader. Start from [`evals/cases.json`](evals/cases.json), [`evals/benchmark-manifest.json`](evals/benchmark-manifest.json), and the rubric/schema notes in [`evals/report.template.json`](evals/report.template.json); the runner produces the actual unscored report to edit. Do not use aggregate counters or placeholder artifacts in place of case evidence. The runner uses Node's native TypeScript stripping and currently requires Node 24 or newer.

For a browser run against an already-running server:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3101 npm run test:e2e
```

## Runtime model configuration

Copy the variable names from [`.env.example`](.env.example) into a local `.env.local` only when testing a compatible provider locally. `THESIS_LLM_ENABLED=true` is accepted only outside production in this slice. The adapter accepts either an explicit `openai_chat` or `openai_responses` protocol; it does not infer protocol from a URL, retry automatically, or allow the model to fetch URLs or call trading tools.

The selected local runtime is OpenRouter with OpenAI GPT-5.6 Luna. Use the exact OpenRouter alias `openai/gpt-5.6-luna`; the catalog currently resolves it to the dated snapshot `openai/gpt-5.6-luna-20260709` and lists JSON/structured-output support. The reasoning setting is `low`: it preserves a bounded reasoning pass while avoiding the slower provider default. `none` remains available for Luna if a latency-first probe is needed. The pre-freeze captured E01 integration result and browser acceptance run are recorded in [`evidence/live-research-luna-e01-2026-09-09.json`](evidence/live-research-luna-e01-2026-09-09.json); the current benchmark prompt is `claims-v3`.

```dotenv
THESIS_LLM_ENABLED=true
THESIS_LLM_API_KEY=replace-with-your-openrouter-key
THESIS_LLM_BASE_URL=https://openrouter.ai/api/v1/chat/completions
THESIS_LLM_MODEL=openai/gpt-5.6-luna
THESIS_LLM_PROTOCOL=openai_chat
THESIS_LLM_REASONING_EFFORT=low
```

Keep the key in `.env.local`, never in source, browser state, logs, or exported reports. For the research gate, record the response model/provider, resolved snapshot, prompt version, latency, token usage when available, and the exact packet hash. A catalog lookup alone does not count as a real model run.

Public model use must not be enabled until a shared or durable per-visitor limit, concurrency bound, atomic global budget reservation, and provider hard limit are configured. A process-local guard would not satisfy that gate.

Before deployment, set `THESIS_PUBLIC_ORIGINS` to the exact HTTPS origin(s) serving the app. Production POST routes fail closed when the allowlist is missing or the request `Origin` is not listed; localhost/test runs do not require this deployment setting.

The benchmark scoring procedure is in [`evals/scoring-rubric.md`](evals/scoring-rubric.md). The practitioner study plan is in [`evals/practitioner-validation-sheet.md`](evals/practitioner-validation-sheet.md); it is preparatory only and contains no fabricated participant results.

## Architecture

```text
Client workbench
  -> strict POST /api/research
      -> server-only source normalization
      -> server-only Bitget adapter or explicit captured replay
      -> pure Decimal.js economics
      -> server-only bounded claim adapter
      -> validated canonical ResearchResult
  -> deterministic Markdown or JSON export
```

The pure domain modules do not read the network, environment, clock, or UI state. Revisions and request IDs prevent late async responses from replacing a newer plan. Evidence hashes exclude notional, fees, goals, and scenarios; economics hashes include normalized numeric inputs, snapshot hash, and formula version.

## Economics model

Entry spends the requested USDT budget across asks, floors the resulting quantity to the instrument quantity step, then re-sweeps the same asks. Exit sweeps the bought quantity across bids with an explicit depth multiplier `d` and price haircut `h`. Fees are applied as cash multipliers. The displayed threshold is a conditional bid-price shift, not a native-equity target or a probability.

All money and quantity arithmetic uses Decimal.js. Null means unavailable; it is never displayed as zero. A partial or insufficient-depth result preserves the usable fields and does not invent a whole-position PnL.

## Fixture provenance

`fixtures/selection-probe.json` is a copied public API capture from the selection spike. Its timestamps are historical. The capture is a replay input for deterministic tests and the UI example, not current market data and not production truth.
