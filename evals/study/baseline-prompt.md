# Fixed comparison prompt — Claude with web search

Protocol: trader-study-v2. Owner selected Claude with web search. Record the exact displayed model label/version, enabled search setting, date and any calculation tools available in session-log.csv before the first session. Keep the same configuration across the cohort; document changes. Start a fresh chat per task. Attach only the input packet produced by `study:packet`, never ThesisGate’s output report.

Paste the following verbatim, then attach the task packet:

---

Help me research the proposed stock-token trade in the attached input packet. Use web search to investigate its most consequential checkable factual premise. Cite the source URLs, short supporting passages, publication/event dates and any source limitations. The packet specifies the research reference time; do not use later information as evidence for a historical task. If search cannot establish a fact, say so.

Keep factual evidence, causal/price assumptions and conditional trade calculations separate. Do not predict a return or recommend an order. Publication date alone does not prove an event happened on that date. A token’s difference from the underlying’s last close does not establish how much a headline is priced in. Consolidated company revenue does not establish revenue from a particular deal.

Use ONLY the frozen market snapshot and instrument constraints in the packet for numerical comparisons, even if search finds newer prices. Respect order/position limits, quantity steps, fees, scenario assumptions and insufficient depth. State the break-even move and move needed for the stated goal, naming the price reference and bid/ask side. Show your calculation method; use available calculation tools if useful, and report if you cannot calculate reliably. Do not invent missing inputs or fills.

Return four concise answers:
1. What the evidence establishes or corrects, with citations.
2. What remains an assumption.
3. What this particular trade requires under the supplied assumptions, and the selected scenario outcome if calculable.
4. The next specific fact or assumption change worth checking.

---

One standardized follow-up is permitted if clarification is requested: “Use only the supplied plan and frozen market packet; label anything else unknown.” Record any additional facilitator help as a deviation. Do not retry an unfavorable answer until it looks better.
