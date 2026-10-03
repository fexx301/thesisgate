# Trader study v2 — Claude with web search

Status: protocol prepared; no participant results recorded in this package. This is an exploratory five-person study, not evidence of demand, profitability or retention.

## Hypothesis and comparison

Test whether ThesisGate helps relevant traders find the evidence, preserve their intended trade, and understand its conditional economics with less effort. The fixed comparison is **Claude with web search enabled**, selected by the owner. Record the exact displayed model label/version and search setting before the first session; do not silently switch models. Use a fresh conversation and the unchanged [baseline prompt](study/baseline-prompt.md) for every task.

Two separate comparisons answer different questions:

1. **Practical workflow:** both tools receive the same thesis, plan and frozen market packet. Claude can search; ThesisGate can use its existing sources and, if enabled on the frozen build, bounded investigation. Record time spent finding/entering inputs as well as reading the answer. This measures the whole workflow; it does not isolate model reasoning.
2. **Equal-data technical check:** give Claude the same source texts and market snapshot used by ThesisGate, with no ThesisGate verdicts or calculated answers. Score evidence and numbers separately. Label this as a builder-run technical comparison, not another participant study.

Use `npm run study:packet -- <exported-report.json> <unique-task-label> workflow` to create the input-only packet; use `equal-data` for the second comparison. The script strips claims, findings, thresholds and PnL. It preserves the snapshot, instrument constraints, costs and report reference time.

## Recruitment — owner sends invitations

Recruit five crypto-native retail traders with experience or concrete interest in tokenized equities, typically considering 1,000–10,000 USDT positions. Record actual experience and whether they are friends, colleagues or community recruits. Do not treat five volunteers as a representative market sample.

> I’m testing ThesisGate, a research tool that checks the evidence behind a stock-token trade and calculates what the trade needs after fees. Could you spare 20–25 minutes to compare it with Claude using web search? No wallet connection, account credentials or trades. You’ll try a few examples and can bring one of your own. I’ll record anonymous task answers and timing, including anything that fails. Demo: https://thesisgate.duckdns.org

No outreach or messages have been sent by this protocol.

## Freeze before sessions

Target cutoff: **October 5, 2026, 12:00 Africa/Lagos**. Ship the investigation only if representative cases pass; otherwise set `THESIS_INVESTIGATION_ENABLED=false` and restart the serving application. Sessions proceed either way.

1. Complete build, tests and desktop/mobile rehearsal. Do not freeze merely because time expired.
2. Choose one flag setting for the cohort. Record the claim model from the exported report and Claude’s exact displayed model label. Leave no field guessed.
3. Run `npm run study:freeze -- cohort-01` to preserve the protocol, prompt and captured fixtures with hashes and the source build fingerprint. This prepares artifacts; it does not certify the running server.
4. Export a fresh report from the actual study URL. Match its `buildId` to `freeze.json`. Confirm its `investigation.status` matches the intended flag. If not, fix deployment/versioning before using it.
5. For each task, retain the exported JSON, input-only Claude packet, source URLs, snapshot hash, timestamps, both complete answers, and independent scoring notes. Never refresh one tool’s book while leaving the other on an older snapshot.
6. Fill [session-log.csv](study/session-log.csv). If a material fix is needed, create a new freeze label and record the version per session; report cohorts separately. Do not rewrite prior answers.

## Session (20–25 minutes)

Consent: “I’ll record your answers and timing under a participant code, without account details or names. You may stop at any time. Nothing is traded. May I proceed?” Do not record without agreement.

Record participant code, experience, recruitment relationship, usual research tools and start time. Use task order A/B/C for P1–P3 and C/B/A for P4–P5. P1/P3/P5 start with ThesisGate; P2/P4 start with Claude. Counterbalancing reduces but does not eliminate learning effects; report that limitation.

The following are task intents, not fabricated real-world facts. Prepare and independently check the actual source packet before use:

- **A — recirculated announcement:** use the built-in September 8 NVIDIA/AWS replay. The official August 26 release explicitly says “today announced”; “announced today” in the September 8 thesis is the dated premise to examine. The application must use September 8 as the reference date. Historical search findings after that cutoff are disallowed evidence. Preserve this as a historical task rather than claiming it is live.
- **B — a checkable factual premise:** use a verified dated Bitget earnings record or a named analyst action. Choose the exact claim before the session and preserve the source. Include at least one supported premise so the product is not rewarded for objecting to everything. A limited set of analyst records cannot establish that no other analyst issued a different target.
- **C — honestly insufficient evidence:** use a claim that a particular deployment or deal already generated revenue when the available SEC facts only give consolidated revenue. Correct answer: the supplied facts do not establish deal attribution. The trade math can still be calculated independently.
- **D — participant’s own thesis (optional, unscored exploration):** let them supply a thesis without coaching. Freeze its market packet before comparison. Record whether they voluntarily want this second/own-thesis task, and record failures. Do not fold this variable task into the predefined accuracy denominator.

For each tool and task, time from complete inputs submitted to answer available (system latency), then time to the participant’s answers (comprehension). Also record setup/retrieval effort separately. A 90-second comprehension target excludes system latency; never present it as end-to-end latency.

Ask:

1. What factual premise is supported, contradicted or still unknown? Identify the source and relevant date.
2. What is the token’s price difference from the underlying’s last close? Does this prove how much the news is priced in? (Correct: no.)
3. What moves are required to break even and meet the stated goal under this snapshot’s fees/depth? Which book side and reference apply?
4. Is that requirement a forecast? What next evidence or assumption change would affect the result?

Use the exact same frozen market snapshot for both tools. On a live task, generate ThesisGate’s initial report once, export its inputs, and do not refresh its book during that comparison. Subsequent evidence research can be live with its retrieval time recorded; later source updates must be flagged when scoring.

## Scoring and targets — freeze before observing results

A reviewer checks the actual quoted passages and independently verifies reference numbers from the frozen instrument/book/fee inputs; do not score merely by agreement with the displayed ThesisGate answer. Keep source judgments, arithmetic judgments, unsupported causal claims and user comprehension separate. Record disagreements and all failures.

- At least 4/5 participants correctly explain evidence status, price context and trade requirements within 90 seconds of seeing each tool’s answer on the fixed tasks. Report participant/task denominators, not just “4/5” if tasks differ.
- At least 3/5 prefer using ThesisGate before a trade and identify a concrete useful finding.
- Zero material factual or arithmetic errors in ThesisGate’s displayed outputs. Any error remains in the report even if later fixed.
- Threshold/price-difference tolerance: 0.1 percentage points, with the correct instrument, book side and reference. An unavailable/insufficient-depth answer can be correct; invented whole-position PnL is not.
- Record median setup, response and comprehension times separately, task completion, corrections noticed, and voluntary own-thesis use. No speed-improvement claim without comparable timing and accuracy.

Afterwards ask: Which tool would you use, or both? What changed your understanding? What was confusing? Quote their actual words with permission.

Populate [task-results.csv](study/task-results.csv) and [results.md](study/results.md). If nobody participates, publish **“0 participants; no independent trader validation.”** Do not substitute developer or model judgments. Recruit/record/submit are owner actions; this package does not perform them.
