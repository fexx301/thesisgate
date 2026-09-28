# Audit notes: end-to-end comparison v2 (2026-09-28): with Bitget Agent Hub data

**Run:** [`final/REPORT.md`](final/REPORT.md). The 12 v1 cases plus two new ones ([`cases-v2.json`](cases-v2.json)). X04 and X09 now also include Bitget `bitget-mcp-server` records: analyst price targets and the earnings calendar. All systems receive the identical records, and the records are filtered to dates on or before each case's as-of time (captured 2026-09-28 with `evals/e2e/capture-bitget.mjs`; replayed as of 2026-09-24). The contestants use GPT-6 Luna; the judge is Claude Sonnet 5 with shuffled answer order.

## Judge output (unedited) and the audited reading

| | ThesisGate | Chatbot (sources only) | Chatbot + same data |
| --- | --- | --- | --- |
| Misleading answers, as judged | 0/14 | 1/14 | 3/14 |
| Misleading answers, after audit | **0/14** | 0–1/14 | **0/14** |
| Goal move correct (code-scored) | **14/14** | 0/14 | 10/14 |
| Break-even move correct (code-scored) | **14/14** | 0/14 | 11/14 |
| Addressed the move since the US close | 14/14 | 0/14 | 14/14 |

**Audit of each judge flag.** The published run files are left unedited; this table only explains how to read them.
- **X05 and X11, chatbot + data, "fabrication":** these are calculation mistakes (a 4.41% break-even when it is 0.38%; thresholds for a 50,000 USDT order that Bitget's 200-token position cap forbids). The rubric scores calculation errors in the numeric columns, not as fabrication, so these are judge misapplications. The numbers are still counted wrong.
- **X10, chatbot + data, "old news as new":** the answer itself says the 8-K was filed on Sep 3, not today. This is a judge error.
- **X09, chatbot (sources only), "old news as new":** the answer notes the earnings timing is old but doesn't say plainly that "just reported" is wrong. Borderline; kept as judged.
- **X13, chatbot + data:** its numbers show as "missing" only because it omitted the requested scoring JSON block; the judge's note says its order-book math was accurate. It is not counted as a numeric failure in the reading above.

## What v2 shows

1. **With Bitget's structured data, every system catches the claims that no system caught in v1:** "analysts say $660" (X04), "Tesla just reported earnings" (X09), "analysts have been raising Tesla targets since July" (X13: all 17 actions since Jul 22 were cuts or reiterations), and "Raymond James raised to $515 today" (X14: the raise was on Aug 26). The integration, not the prompt, is what adds this capability; ThesisGate is the only system that fetches these records itself.
2. **Evidence reading is a tie once inputs are equal,** which matches v1.
3. **ThesisGate's trade math is the consistent advantage:** 14/14 correct thresholds. The same model given the identical order book missed several, including a 6.53% goal move that is really 1.51% (X12) and an order that ignored Bitget's position cap (X11). Without the book, a chatbot produced no correct thresholds.

## Limitations

These are the same as v1: the cases and ground truth were written by the builder with assistant help, the judge is a model, and the baselines cannot browse. In addition, the Bitget records were captured four days after the Sep 24 feed pack and filtered by date. A record created after Sep 24 but back-dated would slip through; none were observed.
