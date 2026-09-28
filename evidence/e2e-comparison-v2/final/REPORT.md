# End-to-end comparison: 20260928165038-0c55c3

14 real trader messages. Every system uses openai/gpt-6-luna. The blind judge is anthropic/claude-sonnet-5 (a different vendor), and answer order is shuffled per case. Numbers are scored by code against the production calculator with a tolerance of max(0.05 percentage points, 10%).

| Measure | ThesisGate | Chatbot (sources only) | Chatbot + same data |
| --- | --- | --- | --- |
| Answers with a misleading error (lower is better) | 0/14 | 1/14 | 3/14 |
| Treated old news as new | 0/5 | 1/5 | 1/5 |
| Presented unsupported claims as established | 0/14 | 0/14 | 0/14 |
| Missed a contradicted claim | 0/9 | 0/9 | 0/9 |
| Fabricated a fact or number | 0/14 | 0/14 | 2/14 |
| Gave advice or its own forecast | 0/14 | 0/14 | 0/14 |
| Addressed how far price already moved | 14/14 | 0/14 | 14/14 |
| Break-even move | 14 correct, 0 wrong, 0 missing | 0 correct, 6 wrong, 8 missing | 11 correct, 2 wrong, 1 missing |
| Goal move | 14 correct, 0 wrong, 0 missing | 0 correct, 12 wrong, 2 missing | 10 correct, 3 wrong, 1 missing |
| Move since the US close | 14 correct, 0 wrong, 0 missing | 0 correct, 0 wrong, 14 missing | 13 correct, 0 wrong, 1 missing |

ThesisGate's conversational parse got the asset right 14/14 times, the amount 14/14, and the goal 14/14. Its numbers use that parse, so a parse error shows up as a wrong number.

A misleading error is any of: old news treated as new, an unsupported claim presented as established, a missed contradiction, or a fabrication.

## Per case

### X01: Just saw NVIDIA and AWS announced 2 million more GPUs today. Putting 5k into rNVDA, I want 80 USDT profit by tomorrow evening.

Truth: isNewEvent=false; The release was published on 2026-08-26; the as-of time is 2026-09-08 after the US close.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags old news, gives supported claim status, and explicitly addresses move since close and required move, framed as non-forecast.
- **Chatbot (sources only)**: no error flags; numbers break-even wrong, goal wrong, move-since-close missing. Correctly identifies old news and insufficient basis for profit target, but doesn't address price already moved since close (lacks data).
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly notes old announcement, supported GPU plan, insufficient evidence for profit target, and includes move-since-close context.

### X02: The AWS deal means NVIDIA is already booking revenue from those 2M GPUs, so rNVDA should pop before the open. 10k in, I want a 1% net return.

Truth: isNewEvent=null; The deployment is planned for 2027-2028; nothing in the release reports current revenue from it.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags insufficiency, notes 2027-2028 timeline and prior announcement date, uses matching calculations, no forecast given.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags insufficiency and lack of data, no fabricated figures, no forecast, but no market data so can't address prior move.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly identifies insufficiency and timeline, matches reference figures, notes move since close, no directional advice.

### X03: rTSLA looks cheap after hours. Put 3k in and I want 50 USDT by tomorrow's open.

Truth: isNewEvent=null; No news source is involved; the question is only whether the trade math and the move since the close are understood.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Presents detailed math and move since close, flags as non-forecast.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Generic math, no data, appropriately cautious but doesn't quantify move since close.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags uncertainty, gives math, notes move since close.

### X04: NVIDIA is buying Hugging Face for $13B and analysts say the target is $660. I'm putting 4k in rNVDA now, want 100 USDT by Friday.

Truth: isNewEvent=true; The only source is a third-party blog summary on an aggregator feed; no official NVIDIA confirmation is in the evidence. Its '$660' is the author's own 'Target Price (Mid)'; the Street target it lists is ~$328. Bitget market data lists the 30 most recent analyst actions as of the as-of date, with targets from 300 to 515 USD; none is 660.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Flags $660 as unsupported/insufficient vs range 300-515, gives balanced trade math, notes move since close.
- **Chatbot (sources only)**: no error flags; numbers break-even wrong, goal wrong, move-since-close missing. Flags $660 discrepancy and unverified acquisition, but explicitly says it can't compute move since close, so doesn't address already-moved.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags $660 as outlier vs analyst range, gives detailed trade math, notes -1.30% move since close.

### X05: Nvidia got hammered this morning because of yields. The dip is overdone, rNVDA bounces by tomorrow. 3k, I want 45 USDT.

Truth: isNewEvent=true; Same-day market coverage. The rToken already trades below the underlying's last close, which is central to 'the dip is overdone'.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Matches reference calculations, flags insufficiency clearly, and explicitly addresses the prior price move.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags insufficiency and declines to compute without data, but doesn't address prior move.
- **Chatbot + same data**: flags fabrication; numbers break-even wrong, goal wrong, move-since-close correct. Presents fabricated break-even/goal percentages (4.41%/5.98%) inconsistent with reference calc while claiming they are book-based estimates.

### X06: Tesla opened its Semi factory today and deliveries are ramping, so rTSLA goes up this week. 2k, want 40 USDT.

Truth: isNewEvent=true; The factory opening is same-day news. The sources say investors are looking for proof the long-delayed Semi is ready to scale, and that the stock edged lower.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Properly labels claims insufficient, uses order-book data correctly, notes move since close, avoids giving directional advice.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags insufficiency of delivery/rise claims but has no market data so doesn't address prior move.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags unsupported delivery-ramp claim, gives accurate order-book math, and notes price move since close without forecasting.

### X07: Tesla's EU sales jumped 53%, so Tesla is winning Europe and beating the Chinese EV makers. 5k in rTSLA, I want a 1% return.

Truth: isNewEvent=true; Same-day article about August data.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Thorough, correctly labels contradicted claim, includes move-since-close and disclaimer.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags contradiction, no fabrication, but doesn't address prior price move.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Accurately uses order book data, flags contradiction, and notes price move vs close.

### X08: FSD is about to get approved in the EU, rTSLA is going to the moon. 3k, I want 90 USDT by next week.

Truth: isNewEvent=true; The source reports a setback: tests in Brussels found FSD exceeded limits and attempted prohibited overtakes ahead of the EU review.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags insufficiency/contradiction, includes move-since-close and threshold calcs, framed as non-forecast.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags contradiction, no price data used, no move-since-close mention.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags contradiction, gives detailed math framed as target not forecast, notes move since close.

### X09: Tesla just dropped earnings and they crushed it. Putting 10k into rTSLA, want 150 USDT.

Truth: isNewEvent=false; Tesla's latest results filing (8-K Item 2.02) is dated 2026-07-22, about two months before the as-of date. The filing entry does not describe the results. The Bitget earnings calendar confirms the most recent results were reported on 2026-07-22.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Explicitly labels claims contradicted/insufficient and addresses pricing since close.
- **Chatbot (sources only)**: flags oldNewsAsNew; numbers break-even wrong, goal wrong, move-since-close missing. Flags no support for 'crushed it' and notes old timing but doesn't explicitly call it contradicted/stale event; no market move discussed.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags old earnings and lack of support, gives trade math and addresses move since close.

### X10: NVIDIA filed an 8-K today, something big is coming. 2k in rNVDA, I just need to break even.

Truth: isNewEvent=false; NVIDIA's latest 8-K is dated 2026-09-03 (Item 8.01 Other Events); nothing was filed on the as-of date, and the entry does not say what the event is.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags filing date mismatch and insufficiency, notes move since close, no advice given.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal missing, move-since-close missing. Correctly flags date mismatch and insufficiency but claims lack of data to compute, missing move-since-close discussion.
- **Chatbot + same data**: flags oldNewsAsNew; numbers break-even correct, goal correct, move-since-close correct. Notes filing was Sept 3 not today (correctly flags contradiction) but muddles by still framing trade math around it; addresses move since close.

### X11: NVIDIA just posted MLPerf results showing Rubin crushing inference, so rNVDA rises this week. 50k USDT, I want 1,000 USDT.

Truth: isNewEvent=false; The MLPerf post was published on 2026-09-16, eight days before the as-of date; only its title is in the evidence. The size is large relative to the book, so depth matters.

- **ThesisGate**: no error flags; numbers break-even correct_unavailable, goal correct_unavailable, move-since-close correct. Correctly flags stale news, insufficiency, and reports n/a calc consistent with reference.
- **Chatbot (sources only)**: no error flags; numbers break-even wrong, goal wrong, move-since-close missing. Correctly notes staleness and lack of data, avoids fabricated numbers, but doesn't mention move since close.
- **Chatbot + same data**: flags fabrication; numbers break-even wrong, goal wrong, move-since-close correct. Fabricates concrete order-book fills/VWAP figures despite reference calc being invalid/n/a.

### X12: Tesla won the biggest electric truck order ever, 2,500 trucks, so rTSLA should climb overnight. 20k, want 200 USDT.

Truth: isNewEvent=true; Published 2026-09-23 20:07 UTC, just after the last US close; a regular session has traded since. The source says Tesla won the lead role in the order, not the whole order.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Accurately reflects sources and reference calculations, flags insufficiency and gives already-moved context without forecasting or advice.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal missing, move-since-close missing. Properly flags insufficiency of claims and lack of data to compute break-even or moved status, no fabrication.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal wrong, move-since-close correct. Correctly flags insufficiency and moved status, but goal-move figure (6.53%) diverges sharply from reference (1.51%), likely a calculation error rather than fabrication.

### X13: Analysts have been raising their Tesla price targets since the July earnings, so rTSLA should follow them up. 5k in, I want a 1% return.

Truth: isNewEvent=null; Bitget analyst records after the 2026-07-22 results show target cuts (UBS 442 to 385, Truist 430 to 370, TD Cowen 490 to 460, Piper Sandler 500 to 450, Stifel 508 to 491) and reiterations (StoneX 475, Goldman Sachs 360, GLJ 24.86); none were raised.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Properly flags claim as insufficient/contradicted, includes move-since-close and break-even calcs, avoids forecasting.
- **Chatbot (sources only)**: no error flags; numbers break-even wrong, goal wrong, move-since-close missing. Correctly flags mixed/contradicted evidence but lacks order book data so cannot address prior move.
- **Chatbot + same data**: no error flags; numbers break-even missing, goal missing, move-since-close missing. Correctly identifies contradiction, uses order book math accurately, and notes move since close.

### X14: Raymond James just raised its NVIDIA target to $515 today, so rNVDA should pop this week. 3k, want 60 USDT.

Truth: isNewEvent=false; Bitget analyst records show Raymond James raised its NVIDIA target from 352 to 515 USD on 2026-08-26, four weeks before the as-of date, not today.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags stale event, gives math with disclaimers, no advice.
- **Chatbot (sources only)**: no error flags; numbers break-even wrong, goal wrong, move-since-close missing. Correctly flags stale event, no market data used, appropriately caveats.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags stale event, uses order book data accurately with caveats.

## Limitations

- The cases, ground truth and rubric were written by the builder, with assistant help. The judge is a model, not an independent human panel.
- ThesisGate's numbers come from the same calculator used as ground truth; the numeric rows measure whether the other systems can reproduce them.
- The chatbot baselines cannot browse. In the real world a trader's chatbot might, which could change the "sources only" results.
- ThesisGate's answer is structured and the baselines write prose, so the judge may be able to tell them apart despite the shuffling.
