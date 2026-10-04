# ThesisGate — one discovery in under three minutes

**Recording script, not a completed video.** Aim for **2:40**, leaving 20 seconds for transitions. The [official AI Trading Desk requirement](https://bitget-ai.gitbook.io/bitgetai_hackathons2/base-camp-hackathon-s2-en) is one complete research task, from question to actionable insight. Keep the main take on one trader's plan.

**Story:** the trader discovers that an announcement is older than their thesis assumes, sees the move their profit goal requires, and tests a smaller position without losing the evidence context.

## Prepare the take

- Use the public demo at https://thesisgate.duckdns.org. Start with an empty brief and keep **Replay captured example** visible. The case uses the September 8, 2026 book and the August 26 NVIDIA/AWS announcement; “today” means September 8 throughout this replay.
- Confirm the actual served build in **Run details** or an export. The October 4 UI release is `tg-8cec4bfa9fd413e41945`, with `openai/gpt-6-luna-pro`; production investigation is enabled. Record the actual values with the take. Historical replay does not run current-source investigation.
- Use the existing replay defaults: long rNVDA, 10,000 USDT purchase notional excluding fees, 100 USDT net-profit goal, +0.3% exit-bid scenario, 0.1% fee per side, full exit depth and no haircut.
- Rehearse **“What if I only put in half?”** once. It should change the notional to 5,000 while keeping the 100 USDT goal, thesis and scenario. Check the applied values before narrating the result. Keep the original and revised exports.
- Keep this script and the [historical comparison](../evidence/e2e-comparison-v2/) available. Have a Markdown viewer ready for the downloaded brief. The [trader study](../evals/study/results.md) currently records **0 participants**; use the narration below unless real results have been added.

Freeze and record the build used for the take. Preserve failed runs separately. If editing shortens a wait or joins separate runs, label the cut; do not present it as an uninterrupted latency demonstration. The spoken copy below is a draft timing estimate until an actual timed rehearsal is completed.

## Main take — 2:40

### 0:00–0:20 · The question and the input

**Show:** empty workbench → click **Replay captured example** → the populated plan and loading state. Keep the historical label visible. Do not start with an unexplained finished report.

> “I'm considering an NVIDIA trade after hours. This September eighth replay uses ten thousand USDT before fees and a hundred-USDT profit goal by tomorrow. My premise: NVIDIA and AWS announced two million more GPUs today.”

### 0:20–0:45 · The discovery

**Show:** **What the evidence establishes** → **Why this matters** → the cited official announcement. Point to August 26 and its explicit announcement wording; then return to the brief.

> “The matching official announcement is dated August twenty-sixth. My claim that it was new on September eighth is wrong. The citation lets me inspect that correction. It still doesn't tell me whether the token will rise tomorrow.”

**Recording note:** the correction requires matching announcement content, not publication age alone. If the displayed assessment is unavailable, describe the narrow date check and leave the rest explicitly unassessed; do not read a full-review narration over a fallback result.

### 0:45–1:10 · What the trade actually needs

**Show:** **What the trade requires** → **Calculation assumptions**. Point to the required move, break-even and selected scenario in that order.

> “With these fees and liquidity assumptions, my hundred-USDT goal needs about a one-point-four-three percent rise in exit bid prices. Break-even needs zero-point-four-three percent. My chosen zero-point-three percent scenario actually loses 12.88 USDT. These are conditional calculations, not a forecast.”

**Recording note:** read the actual displayed figures if the inputs differ. The percentage is a shift from the captured bid book, not a percentage of the underlying stock's last close.

### 1:10–1:35 · One meaningful conversation turn

**Show:** send **“What if I only put in half?”**. Show the confirmation and updated notional, then the new required move. Keep the objective at 100 USDT. Briefly open **Run details** to show that the evidence review was reused if that is the observed path.

> “What if I only put in half? The amount becomes five thousand, while my hundred-USDT goal stays fixed. Now the required move is about two-point-four-three percent. The announcement correction stays with the plan. I can compare the trade requirements without starting the research again.”

**Recording note:** the chat may use a model to interpret the edit. Evidence reuse does not mean the entire interaction had no AI call or cost. If the goal or another field changes unexpectedly, correct it openly or retain the run as a failed rehearsal.

### 1:35–2:00 · The honest unknown and next evidence

**Show:** **Still an assumption** → **What remains unknown**. Then open the timing claim's missing-evidence detail or **What would change this?**.

> “The price reaction is still an assumption. A separately dated official update could change the timing conclusion, but it wouldn't establish tomorrow's profit. This tells me what fact to check next, and what my trade would need even if I still believe the idea.”

**Recording note:** some model runs return generic **Check next** wording. Use the specific missing evidence attached to the timing claim; do not claim that every top-level next step is equally specific. This scene already demonstrates insufficient evidence, so the main take does not need a third deal-revenue case.

### 2:00–2:15 · The portable result

**Show:** click **Markdown**, open the downloaded file, and show the four answers and source references. This is the revised 5,000-USDT brief; do not narrate the original 1.43% threshold over it.

> “I can export the revised brief with the claims, costs, assumptions and citations. The trade requirements and evidence stay together.”

### 2:15–2:40 · Evidence and close

**Show:** the README's historical comparison table, with the limitations immediately below it. Finish on the live-demo URL and the product brief.

> “In fourteen historical test cases, ThesisGate calculated every goal threshold correctly; the same-model assistant with identical data got ten. Those assistants couldn't browse, and evidence interpretation tied. We have zero trader-study participants so far. ThesisGate makes the premise and required outcome inspectable. You make the trading decision.”

If trader sessions have actually happened, replace the zero-participant sentence with the observed sample and one measured outcome. Name Claude with web search and its recorded model version. Do not present the historical comparison as a test of the current investigation feature or a search-enabled baseline.

## Optional investigation segment — one replacement, not a third case

**Use this version only after the exact UI case has been rehearsed and saved with citations.** The feature is enabled, but the current three-minute script does not assume a recorded investigation clip already exists. The [October 4 integration record](../evals/investigation/validation-2026-10-04.json) is backend evidence, not a prepared browser recording.

Replace **1:35–2:15** with this 40-second segment; put export at **2:15–2:25** and the evidence/close at **2:25–2:50**. Keep the earlier line that tomorrow's price remains unknown. That preserves a complete question-to-result journey and a 10-second buffer.

### Prepare one concrete SEC check

Use a separate **Live** tab, clearly labelled as a different run. This is a **deliberately incorrect numerical test claim**, not a genuine news headline:

```text
NVIDIA reported 908050000000 USD revenue for the period 2025-01-27 to 2025-07-27.
```

The recorded SEC lookup returned **90,805,000,000 USD** for that period, not 908,050,000,000. This is a six-month period; do not call it one quarter. Keep the literal claim unchanged when rehearsing so its amount and date range can be checked against the record.

1. In the separate tab, use rNVDA and the **Live** data mode. Enter the literal claim in **What do you think will happen?**, with complete trade inputs. Use an actual relevant source that does not itself settle the revenue amount, or paste a clearly labelled unverified research note: `I want to check NVIDIA's revenue for the period 2025-01-27 to 2025-07-27. This note contains no reported amount.` Leave the source URL blank for that note. The model requires a source packet before it can produce a claim for investigation.
2. Run the brief and inspect **Investigation**. Use the segment only if the displayed selected claim matches the numerical test, the prior status is unresolved, SEC evidence was retrieved, and a cited new assessment resolves it. Inspect the amount, exact period and provenance; save the actual exports and reference time. The initial model extraction and current source response may differ from the earlier integration check.
3. Do not depend on earnings or analyst lookups for this shot: both returned 503 in the last recorded integration check. Do not inject the current SEC response into the September 8 replay. If the lookup fails, no new finding appears, or the initial review already settles it, use the main take instead of forcing a before/after claim.

### 1:35–2:15 · What the targeted lookup added

**Show:** the separately prepared live run, its literal test claim, expanded **Investigation**, prior status, SEC citation, corrected amount and exact period. Put **“Separate live run · deliberate numerical-error test”** on screen. If it was recorded beforehand, also show its actual timestamp.

> “Here's a separate factual test: a revenue figure that's ten times too large. The initial evidence doesn't establish it. ThesisGate checks the SEC record for that exact period and produces a cited correction: ninety-point-eight-zero-five billion dollars. Those company totals still don't establish revenue from a particular deal. The lookup resolves one fact, not a future return.”

Only read this narration over the matching observed result. If a prepared run is unavailable, the main take remains complete. A source failure is unavailable evidence, not a contradiction. A supported claim still supplies no probability of a profitable trade.

## Rehearsal reference and recording checks

These values were recalculated with the current production economics function against the stored NVIDIA replay inputs. They verify the script's numeric example, not model consistency or independent user benefit.

| Replay inputs | Goal shift | Break-even shift | PnL at +0.3% |
| --- | --- | --- | --- |
| 10,000 USDT, 100-USDT goal, full exit depth | +1.4325% | +0.4292% | −12.8808 USDT |
| 5,000 USDT, same 100-USDT goal, full exit depth | +2.4289% | +0.4225% | −6.1048 USDT |
| 10,000 USDT, same goal, half exit depth | +1.4352% | +0.4319% | −13.1481 USDT |

Halving the amount provides the clearer visible change for this particular book. Halving depth changes the goal by only about 0.0027 percentage points here; do not imply that every liquidity stress produces a dramatic result.

- Time a complete rehearsal, including loading, clicks, exports and transitions. Cut optional material rather than rushing the explanation. If a wait is shortened in editing, label it with the measured elapsed time.
- Show a genuine unestablished forecast and a checkable citation. Keep captured and live runs labelled separately.
- Confirm the final export matches the last visible plan. Retain its build, model, investigation status, source timestamps and assumptions with the recording.
- Use actual study counts, failures and timing. The screenshot, script and automated tests are not participant results.
- Keep the served build and public evidence links aligned through judging; record necessary repairs as new versions.

Detailed evidence, failures and reproduction commands: [evaluation guide](evaluation.md). Application and model configuration: [release record](release-notes.md).
