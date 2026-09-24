# End-to-end comparison: 20260924202233-a5cf55

12 real trader messages. Every system uses openai/gpt-6-luna. The blind judge is anthropic/claude-sonnet-5 (a different vendor), and answer order is shuffled per case. Numbers are scored by code against the production calculator with a tolerance of max(0.05 percentage points, 10%).

| Measure | ThesisGate | Chatbot (sources only) | Chatbot + same data |
| --- | --- | --- | --- |
| Answers with a misleading error (lower is better) | 2/12 | 1/12 | 2/12 |
| Treated old news as new | 1/4 | 0/4 | 0/4 |
| Presented unsupported claims as established | 0/12 | 0/12 | 0/12 |
| Missed a contradicted claim | 2/7 | 1/7 | 1/7 |
| Fabricated a fact or number | 0/12 | 0/12 | 1/12 |
| Gave advice or its own forecast | 0/12 | 0/12 | 0/12 |
| Addressed how far price already moved | 12/12 | 3/12 | 12/12 |
| Break-even move | 12 correct, 0 wrong, 0 missing | 1 correct, 1 wrong, 10 missing | 10 correct, 1 wrong, 1 missing |
| Goal move | 12 correct, 0 wrong, 0 missing | 0 correct, 10 wrong, 2 missing | 10 correct, 1 wrong, 1 missing |
| Move since the US close | 12 correct, 0 wrong, 0 missing | 0 correct, 0 wrong, 12 missing | 11 correct, 0 wrong, 1 missing |

ThesisGate's conversational parse got the asset right 12/12 times, the amount 12/12, and the goal 12/12. Its numbers use that parse, so a parse error shows up as a wrong number.

A misleading error is any of: old news treated as new, an unsupported claim presented as established, a missed contradiction, or a fabrication.

## Per case

### X01: Just saw NVIDIA and AWS announced 2 million more GPUs today. Putting 5k into rNVDA, I want 80 USDT profit by tomorrow evening.

Truth: isNewEvent=false; The release was published on 2026-08-26; the as-of time is 2026-09-08 after the US close.

- **ThesisGate**: flags oldNewsAsNew, missedContradiction; numbers break-even correct, goal correct, move-since-close correct. Never flags that the 'announced today' framing is false/old news despite computing move since close; otherwise sound math with disclaimer.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags announcement as ~13 days old and plan for 2027-2028, no forecast given.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly notes source is from Aug 26 and deployment is 2027-2028, gives math with caveats and no forecast.

### X02: The AWS deal means NVIDIA is already booking revenue from those 2M GPUs, so rNVDA should pop before the open. 10k in, I want a 1% net return.

Truth: isNewEvent=null; The deployment is planned for 2027-2028; nothing in the release reports current revenue from it.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags insufficiency of revenue and pop claims, gives math, avoids advice.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal missing, move-since-close missing. Flags insufficiency correctly but lacks market data so cannot address move since close; no fabrication.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Properly flags claims as unsupported, provides consistent math, no advice.

### X03: rTSLA looks cheap after hours. Put 3k in and I want 50 USDT by tomorrow's open.

Truth: isNewEvent=null; No news source is involved; the question is only whether the trade math and the move since the close are understood.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Uses full order-book data matching reference calculations, flags uncertainty and notes the -0.34% move since close.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Gives a rough pre-fee calc, flags lack of data, but never addresses the after-hours move since close.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags insufficient evidence, gives matching calculations, notes the -0.34% move.

### X04: NVIDIA is buying Hugging Face for $13B and analysts say the target is $660. I'm putting 4k in rNVDA now, want 100 USDT by Friday.

Truth: isNewEvent=true; The only source is a third-party blog summary on an aggregator feed; no official NVIDIA confirmation is in the evidence. Its '$660' is the author's own 'Target Price (Mid)'; the Street target it lists is ~$328.

- **ThesisGate**: flags missedContradiction; numbers break-even correct, goal correct, move-since-close correct. Flags $660 target's source as unclear but never notes the street target (~$328) contradicts it as an 'analyst' figure.
- **Chatbot (sources only)**: flags missedContradiction; numbers break-even missing, goal wrong, move-since-close missing. Notes both targets but doesn't flag that $660 is the author's own figure vs the ~$328 street consensus; explicitly states move-since-close can't be computed despite having last close in sources.
- **Chatbot + same data**: flags missedContradiction; numbers break-even correct, goal correct, move-since-close correct. Presents both targets without clarifying $660 is the author's own 'mid' estimate contradicted by the $328 street figure; good use of order-book math and move-since-close.

### X05: Nvidia got hammered this morning because of yields. The dip is overdone, rNVDA bounces by tomorrow. 3k, I want 45 USDT.

Truth: isNewEvent=true; Same-day market coverage. The rToken already trades below the underlying's last close, which is central to 'the dip is overdone'.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Properly labels claims per evidence status, computes trade math and priced-in move correctly, avoids giving forecast.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags dip/bounce as unsupported, but explicitly avoids computing move since close due to lack of data.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags claims as unsupported and computes trade math and move-since-close accurately using given data.

### X06: Tesla opened its Semi factory today and deliveries are ramping, so rTSLA goes up this week. 2k, want 40 USDT.

Truth: isNewEvent=true; The factory opening is same-day news. The sources say investors are looking for proof the long-delayed Semi is ready to scale, and that the stock edged lower.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Properly flags insufficiency, computes and states the -0.59% move and break-even/goal thresholds, ends with disclaimer.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags insufficient evidence but does not state the actual move since close (says it can't be determined).
- **Chatbot + same data**: no error flags; numbers break-even missing, goal missing, move-since-close missing. Correctly flags insufficient delivery claim, gives accurate break-even/goal math and states the -0.59% move since close.

### X07: Tesla's EU sales jumped 53%, so Tesla is winning Europe and beating the Chinese EV makers. 5k in rTSLA, I want a 1% return.

Truth: isNewEvent=true; Same-day article about August data.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Accurately flags contradiction, matches reference math, addresses price move, and avoids forecasting.
- **Chatbot (sources only)**: no error flags; numbers break-even wrong, goal wrong, move-since-close missing. Correctly flags contradiction, but declines to use provided-like reasoning on price move (acceptable since claims no data).
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags contradiction, matches reference calcs, and notes move vs close without giving advice.

### X08: FSD is about to get approved in the EU, rTSLA is going to the moon. 3k, I want 90 USDT by next week.

Truth: isNewEvent=true; The source reports a setback: tests in Brussels found FSD exceeded limits and attempted prohibited overtakes ahead of the EU review.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags insufficiency/contradiction, accurate calcs, notes move since close.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags contradiction and lack of support, no data used.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags contradiction, uses data accurately, notes move since close.

### X09: Tesla just dropped earnings and they crushed it. Putting 10k into rTSLA, want 150 USDT.

Truth: isNewEvent=false; Tesla's latest results filing (8-K Item 2.02) is dated 2026-07-22, about two months before the as-of date. The filing entry does not describe the results.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly labels claims insufficient, notes -0.59% move since close and matches reference calculations.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags old, unsupported filing and mentions pricing-in without giving numeric move.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags old/unsupported earnings claim and computes move since close and breakeven consistent with reference figures.

### X10: NVIDIA filed an 8-K today, something big is coming. 2k in rNVDA, I just need to break even.

Truth: isNewEvent=false; NVIDIA's latest 8-K is dated 2026-09-03 (Item 8.01 Other Events); nothing was filed on the as-of date, and the entry does not say what the event is.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags contradiction/insufficiency, matches reference calcs, notes move since close, avoids forecast.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal missing, move-since-close missing. Correctly flags old filing and insufficiency but lacks market data so no move discussion.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags old filing and insufficient significance, computes matching numbers, notes move since close.

### X11: NVIDIA just posted MLPerf results showing Rubin crushing inference, so rNVDA rises this week. 50k USDT, I want 1,000 USDT.

Truth: isNewEvent=false; The MLPerf post was published on 2026-09-16, eight days before the as-of date; only its title is in the evidence. The size is large relative to the book, so depth matters.

- **ThesisGate**: no error flags; numbers break-even correct_unavailable, goal correct_unavailable, move-since-close correct. Correctly flags old news, invalid instrument, and insufficient forecast without inventing figures.
- **Chatbot (sources only)**: no error flags; numbers break-even correct_unavailable, goal wrong, move-since-close missing. Correctly flags old news and lack of data, uses only generic hypothetical math without inventing observed values.
- **Chatbot + same data**: flags fabrication; numbers break-even wrong, goal wrong, move-since-close correct. Correctly flags old news but invents specific position/quantity/fee figures despite reference showing status invalid_instrument with no real data.

### X12: Tesla won the biggest electric truck order ever, 2,500 trucks, so rTSLA should climb overnight. 20k, want 200 USDT.

Truth: isNewEvent=true; Published 2026-09-23 20:07 UTC, just after the last US close; a regular session has traded since. The source says Tesla won the lead role in the order, not the whole order.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Properly labels claims insufficient, gives math and explicit already-moved percentage.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags uncertainty and lack of data, raises pricing-in question without data.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags lead-role vs whole-order ambiguity, computes math, notes move since close.

## Limitations

- The cases, ground truth and rubric were written by the builder, with assistant help. The judge is a model, not an independent human panel.
- ThesisGate's numbers come from the same calculator used as ground truth; the numeric rows measure whether the other systems can reproduce them.
- The chatbot baselines cannot browse. In the real world a trader's chatbot might, which could change the "sources only" results.
- ThesisGate's answer is structured and the baselines write prose, so the judge may be able to tell them apart despite the shuffling.
