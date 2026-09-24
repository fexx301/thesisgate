# Trader study kit (five-trader validation)

The goal is to find out whether real rToken traders understand a trade better with ThesisGate than with the AI chatbot they already use. Report every participant, including failures, and never replace missing sessions with estimates.

## Who to recruit

Three to five crypto-native retail traders who have traded, or would trade, rNVDA, rTSLA or other stock tokens with roughly 1,000–10,000 USDT. Good places to find them: the Bitget hackathon community, Bitget-focused Telegram or Discord groups, and X replies under #BitgetHackathon. Friends count if they actually trade; note it.

### Recruiting message (paste as-is)

> Hi! I built ThesisGate for the Bitget AI hackathon. It checks the news behind an rNVDA/rTSLA trade idea: is it actually new, what's already priced in since the US close, and what move your trade needs after fees. Could you give me 10 minutes to try it on three short trade ideas, next to the chatbot you normally use? No account or wallet needed, and nothing is traded. I'll only record your answers, anonymously. Link: https://thesisgate.duckdns.org

## Consent (read at the start)

> This takes about 10 minutes. I'll note your answers and how long each takes, under a code like P1, and not your name or any account details. You can stop at any time. Nothing here is financial advice and no trades are placed. Is that OK?

Record: participant code, date, self-described trading experience (none / some / regular), and whether they already use an AI chatbot for trading research.

## The session (10 minutes)

For each of the three trade ideas below, the participant does two things, in alternating order: P1, P3 and P5 start with their usual chatbot; P2 and P4 start with ThesisGate.
- **Their usual chatbot** (ChatGPT, Gemini, Claude, Grok, …): paste the message and the headline, and ask what they'd want to know.
- **ThesisGate:** type the same message into **Describe the trade**. For idea 1, use **Replay captured example** instead.

After each tool, ask the same three questions and time the answer (target: within 90 seconds):

1. **Is the news behind this idea actually new?** (yes / no / not sure)
2. **How far has the token already moved since the last US close?** (a number, or "don't know")
3. **What price move does this trade need to break even and to hit the goal?** (numbers, or "don't know")

### The three trade ideas

These come from the automated comparison (`evidence/e2e-comparison-v1/`), so the correct answers are known.

| # | Message | Headline to paste | Correct answers |
| --- | --- | --- | --- |
| 1 | "Just saw NVIDIA and AWS announced 2 million more GPUs today. Putting 10k into rNVDA, I want 100 USDT profit by tomorrow evening." (captured replay) | "AWS and NVIDIA to Deliver 2 Million Additional GPUs…" (NVIDIA Newsroom) | **Not new:** published Aug 26, about two weeks before the replay date. Moved since close: **−0.04%**. Break-even: **about +0.43%** on the bid book; goal: **about +1.43%**. |
| 2 | "Tesla's EU sales jumped 53%, so Tesla is winning Europe and beating the Chinese EV makers. 5k in rTSLA, I want a 1% return." | "Tesla's EU Registrations Jump Nearly 53% In August – But Chinese EV Rivals Grow Much Faster" | The 53% is supported. **"Beating Chinese EV makers" is contradicted** by the same headline. Use the live numbers shown at the time. |
| 3 | "Tesla won the biggest electric truck order ever, 2,500 trucks, so rTSLA should climb overnight. 20k, want 200 USDT." | "Tesla wins lead role in 2,500-truck electric Class 8 order" | Tesla won the **lead role**, not the whole order. On a 20k position, depth matters: note the break-even ThesisGate shows. |

For ideas 2 and 3, write down the live numbers ThesisGate shows (move since close, break-even, goal), so answers can be checked afterwards against the calculator.

### Closing questions (2 minutes)

4. Which would you use before a real trade: your chatbot, ThesisGate, or both? Why?
5. Did anything in either tool change what you'd do? What exactly?
6. What was confusing or missing in ThesisGate?

## Results table (fill in per participant)

| Code | Experience | Uses AI for trading? | Idea | Tool | Q1 correct? | Q2 correct? | Q3 correct? | Seconds | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | | | 1 | Chatbot | | | | | |
| P1 | | | 1 | ThesisGate | | | | | |

Then one line per participant for questions 4–6, quoting their words.

A Q3 answer is "correct" if it is within 0.1 percentage points of what ThesisGate's calculator shows for the same snapshot. Q2 is correct within 0.1 percentage points. Q1 is correct if it matches the table.

## Predeclared targets (write the results next to these; do not change them afterwards)

- At least 4 of 5 participants answer all three questions correctly with ThesisGate within 90 seconds.
- ThesisGate gets more correct Q2 and Q3 answers than participants' usual chatbot, across all ideas.
- At least 3 of 5 would use ThesisGate before a real trade and name a specific thing it showed them.
- Zero material source or arithmetic errors observed in what ThesisGate displayed.

If fewer than five people take part, report the actual number (for example "3 participants") with every result. If nobody can be reached by the deadline, say "no independent user validation", and do not substitute developer judgement or invented usage figures.
