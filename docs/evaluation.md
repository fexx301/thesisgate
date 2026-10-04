# Evaluation and reproducibility

[Back to the project overview](../README.md) · [Development](development.md)

## What has been verified

| Evidence | Observed result | Scope |
| --- | --- | --- |
| October 4 engineering checks | Typecheck, lint, 259 unit/integration tests across 31 files, production build and 34 desktop/mobile browser journeys passed; zero browser retries | Engineering checks, not independent research-quality or user-benefit evidence |
| [October 4 live investigation check](../evals/investigation/validation-2026-10-04.json) | Repeated supported SEC revenue assessments, a cited incorrect-amount contradiction, insufficient deal attribution, and SEC/NVIDIA retrieval | Small builder-run integration check; earlier failed cases remain in the record |
| [Historical end-to-end comparison v2](../evidence/e2e-comparison-v2/) | Goal thresholds 14/14 versus 10/14; break-even thresholds 14/14 versus 11/14 for the same-model assistant with identical data | Builder-designed cases, restricted non-browsing baselines and model-assisted evidence judging; not a current-build or search-enabled comparison |
| [Trader study](../evals/study/results.md) | **0 participants; study not run** | No independent trader validation |

Evidence interpretation effectively tied the same-model baseline in the historical end-to-end comparison. The separate historical single-passage research gate failed: zero supported unique omissions against a threshold of three. Neither historical result establishes the performance of the current investigation feature.

Known live limitations: Bitget earnings/analyst sources returned HTTP 503 during the October 4 integration check. A subsequent README replay also produced generic “Check next” wording in one run; source and claim details remain inspectable. A screenshot or selected demo take is not a consistency measurement.

## Reproducible trader comparison

The owner selected **Claude with web search**. The [study protocol](../evals/practitioner-validation-sheet.md), [fixed prompt](../evals/study/baseline-prompt.md), [session log](../evals/study/session-log.csv), [task log](../evals/study/task-results.csv), and [results status](../evals/study/results.md) distinguish preparation from observed results. No participants are claimed by the prepared package.

Every new report includes a build fingerprint based on source/configuration/assets, including uncommitted source content. Find it under Run details or in either export. After final verification:

```bash
npm run study:freeze -- cohort-01
npm run study:packet -- path/to/exported-report.json task-a workflow
npm run study:packet -- path/to/exported-report.json task-a equal-data
```

The freeze command preserves inputs and hashes; it does not certify the running server. Match the exported `buildId` and investigation flag, and record Claude's exact displayed model/version before sessions. The packet command removes all candidate findings and numerical answers, preserving the same frozen market inputs for both systems. Raw participant runs are git-ignored. Use the [discovery-based walkthrough](demo-script.md) only after the served build is frozen. The historical benchmarks below remain bound to their recorded builds.

## Evaluation tooling

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

The paid-run controls are `THESISGATE_EVAL_MODE`, `THESISGATE_EVAL_CASES`, `THESISGATE_ALLOW_PAID_EVAL`, and `THESISGATE_EVAL_MAX_CALLS`. The public benchmark inputs and schema are [evals/cases.json](../evals/cases.json), [evals/benchmark-manifest.json](../evals/benchmark-manifest.json), and [evals/report.template.json](../evals/report.template.json). Do not replace case evidence with aggregate counters or placeholder artifacts.

### End-to-end comparison v2: with Bitget Agent Hub data (14 cases)

[`evidence/e2e-comparison-v2/`](../evidence/e2e-comparison-v2/) adds Bitget analyst-target and earnings-calendar records to the comparison, filtered to each case's date and given identically to every system. It also adds two new cases, and every judge flag is audited in [`AUDIT.md`](../evidence/e2e-comparison-v2/AUDIT.md).

| | ThesisGate | Chatbot (sources only) | Chatbot + same data |
| --- | --- | --- | --- |
| Misleading answers (after audit) | 0/14 | 0–1/14 | 0/14 |
| Goal move correct | 14/14 | 0/14 | 10/14 |
| Break-even move correct | 14/14 | 0/14 | 11/14 |
| Addressed the move since the US close | 14/14 | 0/14 | 14/14 |

With Bitget's records, every system catches claims that none caught in v1: "analysts say $660", "Tesla just reported earnings", "analysts have been raising Tesla targets since July" (all 17 actions were cuts or reiterations), and "Raymond James raised to $515 today" (it was Aug 26). In this experiment, ThesisGate retrieved the records and the comparison assistants received fixed input packets; those assistants had no browsing tools. This does not establish an advantage over a search-enabled assistant. ThesisGate's trade thresholds stayed 14/14 correct.

### End-to-end comparison v1 (12 cases, before the Bitget integration)

[`evidence/e2e-comparison-v1/`](../evidence/e2e-comparison-v1/) compares the whole product with how a trader would otherwise ask an AI, on 12 real trader messages built from captured Bitget books, US quotes, headlines, NVIDIA Newsroom posts and SEC filings. All systems use GPT-6 Luna. A blind Claude Sonnet 5 judge scores the evidence handling, and code scores the numbers.

| | ThesisGate | Chatbot (sources only) | Chatbot + same data |
| --- | --- | --- | --- |
| Answers with a misleading evidence error | 1/12 | 1/12 | 1/12 |
| Addressed the move since the US close | 12/12 | 3/12 | 12/12 |
| Break-even move correct | 12/12 | 1/12 | 9/12 |
| Goal move correct | 12/12 | 0/12 | 9/12 |

On reading evidence, a well-prompted general chatbot ties ThesisGate. The measurable advantage is reliable trade math. Even with the full order book, the same model got 3/12 thresholds wrong, including a +1.39% break-even that is really +0.51% and one trade that ignored Bitget's 200-token position cap. Without the book, a chatbot cannot give the thresholds at all. The evaluation also caught and fixed a real bug: the chat step could drop "today" from a thesis. See [`AUDIT.md`](../evidence/e2e-comparison-v1/AUDIT.md) for every judgement call and limitation. To re-run: `npm run eval:capture` (a new live pack), then `THESISGATE_COMPARE_PAID=1 npm run eval:compare`. This makes paid calls; historical costs are not a quote for a new run.

### Historical re-run (research-gate-v4, GPT-6 Luna)

[`evidence/benchmark-gate-v4/`](../evidence/benchmark-gate-v4/) is a paid re-run of the same 12 cases on its frozen historical implementation with `openai/gpt-6-luna`: 22 provider calls, $0.0066 in total. With builder scoring (assistant-assisted, not independent), it has 11/12 complete-correct cases (E11 has no model call by design), every numeric check passing, no material fabrication, and **0 unique omissions corrected** versus the same model with a strong general prompt. Its performance gate failed because the gate needs at least 3; the report is not a current implementation pass.

What this shows: when both prompts get the same single pre-supplied passage, the claim prompt is not measurably better than a good general prompt. The baseline was slightly stronger on E06 (provenance) and E12 (injected return claim). The benchmark does not measure what the product now adds on top of that step: retrieving and dating sources, recirculation checks against publication dates, the close comparison, the order-book math, and the conversation. Those need an end-to-end comparison, such as the planned trader study.

Validate it with `THESISGATE_EVAL_REPORT=evidence/benchmark-gate-v4/report.scored.json npm run eval`.

### Historical artifacts are not the current gate

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

- [fixtures/selection-probe.json](../fixtures/selection-probe.json) is a historical public API capture used for deterministic replay.
- [fixtures/captured-context.json](../fixtures/captured-context.json) holds the underlying closes and extended-hours prints for the same Sep 8 moment, and the NVIDIA/AWS release text (published Aug 26, 2026) used as replay evidence.
- [public/finished-brief/](../public/finished-brief/) is an archived September 24 model run of the captured replay. It retains its original wording, schema and model identity; it is not the current export format.
- [fixtures/synthetic-book-v1.json](../fixtures/synthetic-book-v1.json) supports deterministic calculator tests.
- The [evidence/](../evidence/) records are sanitized smoke and catalog artifacts. They show reachability, normalization, or a recorded integration result, not execution quality or future liquidity.

The repository contains the source and reproducibility artifacts needed to inspect the implementation. It does not contain local credentials, private exchange data, or a claim that the displayed book will remain available.
