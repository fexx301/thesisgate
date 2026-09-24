# ThesisGate research brief

Report: report_c7404330-05b1-417c-9af5-72c638212c6b
Revision: 5
Generated: 2026-09-24T14:42:20.515Z
Formula version: economics-v1
Schema version: research-v3
Prompt version: claims-v5-multisource
Model: openai/gpt-5.6-luna
Total duration: 13047 ms
Market duration: 1 ms
Model duration: 13042 ms
Model calls: 1
Provider cost: 0.001919 USD
Evidence reused: no

## Confirmed plan

- Asset: NVDA SPOT long
- Purchase notional excluding fee: 10000 USDT
- Horizon: until tomorrow evening
- Invalidation: Not supplied — no stop-loss invented
- Goal: {"kind":"profit_usdt","amount":"100"}
- Scenario: 0.003 bid-price shift (origin: illustrative_preset)
- Fees: 0.001 in, 0.001 out (origin: published_standard_assumption; published standard is 0.001 each side)
- Exit depth multiplier: 1 (origin: illustrative_preset)
- Exit price haircut: 0 (origin: illustrative_preset)
- Thesis: NVIDIA and AWS announced 2 million more GPUs today, so rNVDA will rise enough by tomorrow evening to make 100 USDT net profit.
- Evidence input hash: evidence-v2:sha256:12e9c93b3c64dc15b6dcc46f47d081d9fdea3d010a388a9d926b50279e6d501c
- Economics input hash: economics-v2:sha256:d582251021464c64eef8b7958d371e994d0b6aecae432a0bdf5e0e708b393d16
- Snapshot hash: 7de5ee043d0e35d42d9f79747aa70774b896f2332463e4d6a96a3538d39299fe

## Instrument identity and venue rules

- Instrument symbol: RNVDAUSDT
- Underlying asset: NVDA
- Base / quote: rNVDA / USDT
- Category: SPOT; type: stock; Reality: yes
- Venue status: online
- Quantity step: 0.0001 rNVDA
- Price tick: 0.01 USDT
- Minimum order quantity: 0.0001 rNVDA
- Maximum order quantity: 0 rNVDA (zero means no configured cap)
- Minimum order notional: 10 USDT
- Maximum position quantity: 200 rNVDA (zero means no configured cap)
- Instrument metadata time: 2026-09-08T21:51:19.213Z

## Evidence behind the thesis

- Status: assessed
- Verdict: mixed
- Scope: by the supplied evidence
- Summary: The supplied source records support an earlier announcement of a plan to deploy 2 million additional GPUs in 2027-2028, but do not establish that the announcement occurred today, that rNVDA will rise by tomorrow evening, or that the trade will produce 100 USDT net profit.
- Most consequential unknown: Whether the earlier announcement will affect rNVDA's price by tomorrow evening and produce 100 USDT net profit is not established by the supplied source.

### c1: contradicted
- Claim: NVIDIA and AWS announced the 2 million additional GPUs today.
- Distinction: factual
- Materiality: material
- Explanation: The supplied NVIDIA Newsroom source was published on 2026-08-26, before today, 2026-09-08, and describes the announcement as occurring in that earlier publication context. It therefore shows an earlier announcement rather than a new announcement today.
- Missing evidence: None recorded
> Amazon Web Services (AWS), an Amazon.com, Inc. company (NASDAQ: AMZN), and NVIDIA (NASDAQ: NVDA) today announced a major expansion of their strategic collaboration
> — source src_326449a6-abe8-4dc3-9bf7-dc973ea4d637 @ 0–163

### c2: supported
- Claim: NVIDIA and AWS plan to deploy 2 million additional NVIDIA GPUs across AWS's global infrastructure in 2027-2028.
- Distinction: factual
- Materiality: material
- Explanation: The issuer's official text explicitly describes the GPU deployment as a plan for 2027-2028, not as completed deployment or realized revenue.
- Missing evidence: None recorded
> Deploy 2 million additional NVIDIA GPUs across AWS’s global infrastructure in 2027-2028
> — source src_326449a6-abe8-4dc3-9bf7-dc973ea4d637 @ 1612–1699
> AWS plans to deploy an additional 2 million NVIDIA Blackwell Ultra, Rubin and Rubin Ultra GPUs in 2027-2028 across AWS Global Infrastructure, including AI factories.
> — source src_326449a6-abe8-4dc3-9bf7-dc973ea4d637 @ 3975–4140

### c3: insufficient
- Claim: The NVIDIA-AWS GPU announcement will cause rNVDA to rise enough by tomorrow evening to make the trade profitable.
- Distinction: causal
- Materiality: material
- Explanation: The source describes planned infrastructure deployment and collaboration, but does not establish a causal effect on rNVDA's price or profitability by tomorrow evening.
- Missing evidence: Evidence linking this earlier announcement to a specific rNVDA price movement by tomorrow evening.
> the companies plan to deploy 2 million additional NVIDIA GPUs across AWS’s global infrastructure
> — source src_326449a6-abe8-4dc3-9bf7-dc973ea4d637 @ 333–429

### c4: insufficient
- Claim: The trade will make 100 USDT net profit by tomorrow evening.
- Distinction: forecast
- Materiality: material
- Explanation: The supplied source does not establish a future profit amount, price target, probability, or timing outcome.
- Missing evidence: Evidence establishing that the trade will generate 100 USDT net profit by tomorrow evening.
> No validated citation

## Priced in since the close?

- Data mode: captured_real; observed at 2026-09-08T21:51:19Z
- US session: US after-hours: thin extended-hours trading only (post_market); next regular open 2026-09-09T13:30:00.000Z
- Underlying last close: NVDA 225.73 USD on 2026-09-08 (2026-09-08T20:00:00.000Z; source captured_yahoo_finance_chart)
- Underlying latest print: 225.64 USD at 2026-09-08T21:50:00Z
- rToken book: bid 225.62 / ask 225.66 / mid 225.64 USDT at 2026-09-08T21:51:19.332Z
- rToken move since the underlying close: -0.0399%
- rToken versus latest underlying print: 0.0000%
- Break-even level: 226.5884 USDT top bid (0.3803% vs close)
- Goal level: 228.8521 USDT top bid (1.3831% vs close)
- Scenario level: 226.2969 USDT top bid (0.2511% vs close)
- Share of the goal's move from the close already made: Not applicable
- Levels are the best bid moved by the whole-book threshold: an indicator, not a fill price. One rToken is assumed to track one underlying share.

## Economics under the assumptions

- Computation status: calculated
- Goal comparison: below
- Snapshot: snapshot_7de5ee043d0e35d42d9f7974
- Requested notional: 10000 USDT
- Rounded quantity: 44.2934 rNVDA
- Spent notional: 9999.984138 USDT
- Unspent notional: 0.015862 USDT
- Matched exit quantity: 44.2934 rNVDA
- Unmatched exit quantity: 0 rNVDA
- Entry VWAP: 225.76691195528001915 USDT
- Entry cash: 10009.984122138 USDT
- Modeled exit VWAP: 225.25204400655628152 USDT
- Modeled exit gross: 9977.178886 USDT
- Modeled exit net: 9967.201707114 USDT
- Selected scenario gross: 10007.110422658 USDT
- Selected scenario net: 9997.103312235342 USDT
- Immediate friction proxy: 42.782415024 USDT
- Break-even bid-price shift: 0.4292%
- Required goal shift: 1.4325% (pre-haircut scenario variable r; label consistently)
- Selected scenario PnL: -12.880809902658 USDT
- Selected scenario return on entry cash: -0.1287%
- Effective stressed price shift: 0.3000% (shown whenever haircut is nonzero)
- Visible entry capacity: 1170548.833666 USDT
- Visible exit capacity: 1118427.566941 USDT (stressed)

### Calculator warnings

- Visible ask capacity is 1170548.833666 USDT at this snapshot.

### Scenario comparison

| Scenario | Bid-price shift | Effective shift | Net PnL | Goal comparison | Status |
| --- | ---: | ---: | ---: | --- | --- |
| -3% downside | -3.0000% | -3.0000% | -341.79846623742 USDT | below | calculated |
| Flat | 0.0000% | 0.0000% | -42.782415024 USDT | below | calculated |
| +0.3% | 0.3000% | 0.3000% | -12.880809902658 USDT | below | calculated |
| +1% | 1.0000% | 1.0000% | 56.88960204714 USDT | below | calculated |
| +3% | 3.0000% | 3.0000% | 256.23363618942 USDT | meets | calculated |

- Snapshot mode: captured_real
- Exchange timestamp: 2026-09-08T21:51:19.332Z
- Received timestamp: 2026-09-08T21:51:19Z

## Sources and dates

Selected radar headlines: hl_630544480cb72cfe

- AWS and NVIDIA to Deliver 2 Million Additional GPUs and Next-Generation Infrastructure for Agentic and Physical AI
  - Supplied URL domain: nvidianews.nvidia.com
  - URL: https://nvidianews.nvidia.com/news/aws-and-nvidia-to-deliver-2-million-additional-gpus-and-next-generation-infrastructure-for-agentic-and-physical-ai
  - Provenance: captured_official_excerpt
  - Publication date: 2026-08-26
  - Event date: Unknown
  - Text received: 2026-09-24T14:20:00Z
  - Text hash: 2addc2b62f16a04aaea339900f999f045a77f33ef44da5189ca5039a8672b16c
  - Truncated: no

## What would change this

- Evidence to look for: a source that directly establishes "NVIDIA and AWS announced the 2 million additional GPUs today." (claim currently contradicted).
- Price levels that matter: the goal needs a 1.4325% bid-book shift (228.8521 USDT top bid (1.3831% vs close)); break-even needs 0.4292%. Thinner exit liquidity raises both. These are conditions to investigate, not promises that a limit order will fill or a stop will bound loss.

## Limitations

- This is a conditional research brief, not a buy or sell instruction.
- The scenario uses one displayed order-book snapshot. It is not a firm quote, an execution promise, or a forecast.
- The model does not estimate how price, depth, or returns evolve over the holding horizon.
- A supplied source can support what an issuer stated without proving future revenue or price direction.
- Captured market mode is historical replay data from the selection spike. It is not current market data.

## Partial outcomes

- None
