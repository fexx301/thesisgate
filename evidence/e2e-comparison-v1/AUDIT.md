# Audit notes: end-to-end comparison v1 (2026-09-24)

**Final run:** [`final/REPORT.md`](final/REPORT.md). It covers 12 trader messages built from real captured data: the Sep 8 after-hours Bitget book with the NVIDIA/AWS release, and a Sep 24 live capture of Bitget books, Yahoo quotes, Yahoo ticker headlines, NVIDIA Newsroom posts and SEC 8-K filings. All three systems use `openai/gpt-6-luna`. The judge is `anthropic/claude-sonnet-5`, sees the answers in shuffled order, and is given ground truth written by the builder with assistant help.

## Result in one line

On reading the evidence, ThesisGate ties a well-prompted general chatbot (1/12 misleading answers each). Its measurable advantage is the numbers: 12/12 correct break-even and goal thresholds, against 9/12 for the same model given the identical order book and 0/12 for a chatbot without market data. It also addresses the move since the US close every time (12/12), against 3/12 for a typical chatbot.

## What changed between runs, and why

1. **Judge calibration (runs 1 to 2).** The first full run gave the judge the market facts without saying that some answers never received them. It penalized the plain chatbot for correctly saying "no price data was provided", and it treated calculation slips as fabrication. The judge now knows the inputs differ. Calculation errors are scored only by code. Whether a check applies ("old news as new", "missed contradiction") is decided by the ground truth, not by the judge.
2. **Fairness fixes (runs 1 to 2).** The chatbot-with-data prompt now includes Bitget's position and order caps, which ThesisGate's calculator already enforces (rNVDA and rTSLA positions are capped at 200 tokens). ThesisGate's rendered answer now includes the calculator warnings the app shows on screen.
3. **A real ThesisGate bug, found by this evaluation (runs 2 to 3).** In [`pre-fix-run/`](pre-fix-run/), the conversational step sometimes rewrote the trader's thesis and dropped checkable words: "announced **today**" became "announced plans", so the recirculated-news check never ran (X01). It also softened "analysts say $660" (X04). The chat prompt now requires keeping timing words, attributed figures and the price expectation (`src/server/agent.ts`, with a unit test). The final run is after this fix; the pre-fix run is kept here unedited.

## Remaining judgement calls in the final run

- **X04:** all three systems noted the $660 versus ~$328 discrepancy, but none said plainly that "$660" is the blog author's own figure rather than the analysts'. The judge flagged each as a missed contradiction. This is kept as a shared miss.
- **X11 (50,000 USDT rNVDA):** the calculator marks the order invalid because about 224.6 rNVDA exceeds Bitget's 200-token position cap. The chatbot-with-data answer computed thresholds for the full 50,000 USDT without applying the cap, so code scored its numbers as wrong. In the previous run the same baseline did apply the cap: its behavior varies between runs.
- **X02 and X12:** the chatbot-with-data answer's order-book math was off by about 0.2 and 0.9 percentage points; on the 20,000 USDT rTSLA trade it reported a +1.39% break-even against the calculator's +0.51%.

## Limitations

The cases, ground truth and rubric were written by the builder, with assistant help, and the judge is a model, not a panel of traders. ThesisGate's numbers come from the same calculator used as ground truth; that calculator is covered by hand-checked unit tests and the Sep 8 selection probe. The baselines cannot browse. ThesisGate makes two model calls per brief (chat parse and claim review); each baseline makes one. The raw feed capture (`evals/e2e/packs/`) is kept out of the public repository because it contains third-party feed content; the per-case artifacts here quote only the headlines and summaries each case used.
