# End-to-end comparison: 20260924203237-d93edd

12 real trader messages. Every system uses openai/gpt-6-luna. The blind judge is anthropic/claude-sonnet-5 (a different vendor), and answer order is shuffled per case. Numbers are scored by code against the production calculator with a tolerance of max(0.05 percentage points, 10%).

| Measure | ThesisGate | Chatbot (sources only) | Chatbot + same data |
| --- | --- | --- | --- |
| Answers with a misleading error (lower is better) | 1/12 | 1/12 | 1/12 |
| Treated old news as new | 0/4 | 0/4 | 0/4 |
| Presented unsupported claims as established | 0/12 | 0/12 | 0/12 |
| Missed a contradicted claim | 1/7 | 1/7 | 1/7 |
| Fabricated a fact or number | 0/12 | 0/12 | 0/12 |
| Gave advice or its own forecast | 0/12 | 0/12 | 0/12 |
| Addressed how far price already moved | 12/12 | 3/12 | 12/12 |
| Break-even move | 12 correct, 0 wrong, 0 missing | 1 correct, 4 wrong, 7 missing | 9 correct, 3 wrong, 0 missing |
| Goal move | 12 correct, 0 wrong, 0 missing | 0 correct, 11 wrong, 1 missing | 9 correct, 3 wrong, 0 missing |
| Move since the US close | 12 correct, 0 wrong, 0 missing | 0 correct, 0 wrong, 12 missing | 12 correct, 0 wrong, 0 missing |

ThesisGate's conversational parse got the asset right 12/12 times, the amount 12/12, and the goal 12/12. Its numbers use that parse, so a parse error shows up as a wrong number.

A misleading error is any of: old news treated as new, an unsupported claim presented as established, a missed contradiction, or a fabrication.

## Per case

### X01: Just saw NVIDIA and AWS announced 2 million more GPUs today. Putting 5k into rNVDA, I want 80 USDT profit by tomorrow evening.

Truth: isNewEvent=false; The release was published on 2026-08-26; the as-of time is 2026-09-08 after the US close.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags old news, uses matching reference calcs, notes not a forecast.
- **Chatbot (sources only)**: no error flags; numbers break-even wrong, goal wrong, move-since-close missing. Correctly flags old news, notes it may be priced in, gives no calc but no fabrication.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags old news, gives calcs close to reference, mentions mid vs close move.

### X02: The AWS deal means NVIDIA is already booking revenue from those 2M GPUs, so rNVDA should pop before the open. 10k in, I want a 1% net return.

Truth: isNewEvent=null; The deployment is planned for 2027-2028; nothing in the release reports current revenue from it.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags insufficient claims, gives already-moved (-0.04%) and correct break-even/goal figures, clearly labeled non-advice.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags revenue claim as unsupported and explicitly notes inability to determine price move without data, no forecast given.
- **Chatbot + same data**: no error flags; numbers break-even wrong, goal wrong, move-since-close correct. Correctly flags revenue claim as unsupported, notes plan is future, gives move-since-close, numbers differ slightly from reference but are estimates not fabrications.

### X03: rTSLA looks cheap after hours. Put 3k in and I want 50 USDT by tomorrow's open.

Truth: isNewEvent=null; No news source is involved; the question is only whether the trade math and the move since the close are understood.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Closely matches reference calculations, flags insufficiency, explicitly notes move since close and disclaims forecast.
- **Chatbot (sources only)**: no error flags; numbers break-even wrong, goal wrong, move-since-close missing. Correctly flags lack of data but does not use provided market facts to address move since close.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Flags insufficiency of cheapness/goal claims, gives own (slightly different but reasonable) calculations, notes move since close.

### X04: NVIDIA is buying Hugging Face for $13B and analysts say the target is $660. I'm putting 4k in rNVDA now, want 100 USDT by Friday.

Truth: isNewEvent=true; The only source is a third-party blog summary on an aggregator feed; no official NVIDIA confirmation is in the evidence. Its '$660' is the author's own 'Target Price (Mid)'; the Street target it lists is ~$328.

- **ThesisGate**: flags missedContradiction; numbers break-even correct, goal correct, move-since-close correct. Flags $660 vs $328 as mixed but never states the $660 figure is contradicted/wrong.
- **Chatbot (sources only)**: flags missedContradiction; numbers break-even missing, goal wrong, move-since-close missing. Treats both $660 and $328 as unverified long-term targets but never notes $660 is the author's own figure contradicted by the street target.
- **Chatbot + same data**: flags missedContradiction; numbers break-even correct, goal correct, move-since-close correct. Notes discrepancy between $660 and $328 but doesn't clearly state the $660 target is contradicted.

### X05: Nvidia got hammered this morning because of yields. The dip is overdone, rNVDA bounces by tomorrow. 3k, I want 45 USDT.

Truth: isNewEvent=true; Same-day market coverage. The rToken already trades below the underlying's last close, which is central to 'the dip is overdone'.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Thorough, flags all claims correctly as insufficient, addresses already-moved price and gives explicit disclaimer.
- **Chatbot (sources only)**: no error flags; numbers break-even wrong, goal wrong, move-since-close missing. Flags claims as unsupported, no order-book data used, no forecast given, doesn't address already-moved price.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags unsupported claims, uses order-book data appropriately, notes the -1.30% move vs close.

### X06: Tesla opened its Semi factory today and deliveries are ramping, so rTSLA goes up this week. 2k, want 40 USDT.

Truth: isNewEvent=true; The factory opening is same-day news. The sources say investors are looking for proof the long-delayed Semi is ready to scale, and that the stock edged lower.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Thorough, flags insufficiency, uses given calculations correctly, and addresses move since close.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags deliveries claim as unsupported and notes stock fell; doesn't address prior move since close due to lack of data, acceptable.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags unsupported claims, gives calculations matching reference, and notes move since close.

### X07: Tesla's EU sales jumped 53%, so Tesla is winning Europe and beating the Chinese EV makers. 5k in rTSLA, I want a 1% return.

Truth: isNewEvent=true; Same-day article about August data.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly labels claims insufficient/contradicted, matches reference calculations, notes move since close, no forecast.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags contradiction, declines to compute trade math without data, no forecast or fabrication.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags contradiction, computes trade math close to reference, notes move vs close, no forecast.

### X08: FSD is about to get approved in the EU, rTSLA is going to the moon. 3k, I want 90 USDT by next week.

Truth: isNewEvent=true; The source reports a setback: tests in Brussels found FSD exceeded limits and attempted prohibited overtakes ahead of the EU review.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Properly flags claims as insufficient/unsupported, includes accurate figures matching reference, and notes move since close.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Correctly flags approval claim as unsupported and treats target as uncertain, but skips move-since-close and gives no numbers (claims can't calculate despite having some data).
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly contradicts approval claim, gives detailed math close to reference, and notes move since close.

### X09: Tesla just dropped earnings and they crushed it. Putting 10k into rTSLA, want 150 USDT.

Truth: isNewEvent=false; Tesla's latest results filing (8-K Item 2.02) is dated 2026-07-22, about two months before the as-of date. The filing entry does not describe the results.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly labels claims contradicted/insufficient, includes move-since-close and break-even math, avoids giving directional advice.
- **Chatbot (sources only)**: no error flags; numbers break-even wrong, goal wrong, move-since-close missing. Correctly flags stale filing and insufficient earnings detail, doesn't calculate move but explicitly states inability to do so.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags old filing and lack of results, gives trade math and explicit move-since-close figure without forecasting.

### X10: NVIDIA filed an 8-K today, something big is coming. 2k in rNVDA, I just need to break even.

Truth: isNewEvent=false; NVIDIA's latest 8-K is dated 2026-09-03 (Item 8.01 Other Events); nothing was filed on the as-of date, and the entry does not say what the event is.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly identifies contradiction and insufficiency, includes move-since-close context.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal missing, move-since-close missing. Correctly flags old filing and insufficiency but fails to use given market data for move/break-even calc.
- **Chatbot + same data**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Correctly flags old filing and insufficient claim, gives break-even calc without advice.

### X11: NVIDIA just posted MLPerf results showing Rubin crushing inference, so rNVDA rises this week. 50k USDT, I want 1,000 USDT.

Truth: isNewEvent=false; The MLPerf post was published on 2026-09-16, eight days before the as-of date; only its title is in the evidence. The size is large relative to the book, so depth matters.

- **ThesisGate**: no error flags; numbers break-even correct_unavailable, goal correct_unavailable, move-since-close correct. Correctly identifies stale news, insufficiency, and cites move since close.
- **Chatbot (sources only)**: no error flags; numbers break-even correct_unavailable, goal wrong, move-since-close missing. Flags old news and insufficiency but does not mention price move since close or current quote.
- **Chatbot + same data**: no error flags; numbers break-even wrong, goal wrong, move-since-close correct. Correctly flags stale news and does math without asserting rise; notes move since close.

### X12: Tesla won the biggest electric truck order ever, 2,500 trucks, so rTSLA should climb overnight. 20k, want 200 USDT.

Truth: isNewEvent=true; Published 2026-09-23 20:07 UTC, just after the last US close; a regular session has traded since. The source says Tesla won the lead role in the order, not the whole order.

- **ThesisGate**: no error flags; numbers break-even correct, goal correct, move-since-close correct. Accurately flags insufficiency of claims, matches reference calculations, explicitly notes it's not a forecast and addresses price move since close.
- **Chatbot (sources only)**: no error flags; numbers break-even missing, goal wrong, move-since-close missing. Appropriately cautious, no calculation attempted, does not address how far price has already moved.
- **Chatbot + same data**: no error flags; numbers break-even wrong, goal wrong, move-since-close correct. Correctly flags insufficiency of claims, gives detailed calc (numbers differ from reference but appear reasoning errors, not fabrication), notes move since close.

## Limitations

- The cases, ground truth and rubric were written by the builder, with assistant help. The judge is a model, not an independent human panel.
- ThesisGate's numbers come from the same calculator used as ground truth; the numeric rows measure whether the other systems can reproduce them.
- The chatbot baselines cannot browse. In the real world a trader's chatbot might, which could change the "sources only" results.
- ThesisGate's answer is structured and the baselines write prose, so the judge may be able to tell them apart despite the shuffling.
