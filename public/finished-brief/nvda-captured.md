# ThesisGate research brief

Report: report_aaf22109-2f90-46bd-a6d0-81cbfa8c2e5b
Revision: 1
Generated: 2026-09-16T15:01:32.112Z
Formula version: economics-v1
Schema version: research-v2
Prompt version: claims-v4
Model: Not configured
Total duration: 7 ms
Market duration: 3 ms
Model duration: Not measured
Model calls: 0
Provider cost: Not reported by provider
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
- Thesis: The NVIDIA and AWS announcement means rNVDA will rise enough by tomorrow evening to make 100 USDT net profit.
- Evidence input hash: e476758f
- Economics input hash: 8c01d1c0
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

- Status: unavailable
- Verdict: not assessed
- Scope: by the supplied evidence
- Summary: Runtime claim assessment is disabled. Economics can still be calculated; the supplied source remains visible.
- Most consequential unknown: Runtime claim assessment is disabled. Economics can still be calculated; the supplied source remains visible.

No runtime claim assessments were recorded.

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

- NVIDIA and AWS announced a planned expansion of AI infrastructure on August 26, 2026. The announcement describes additional NVIDIA GPU deployments across AWS da
  - Supplied URL domain: nvidianews.nvidia.com
  - URL: https://nvidianews.nvidia.com/news/aws-and-nvidia-to-deliver-2-million-additional-gpus-and-next-generation-infrastructure-for-agentic-and-physical-ai
  - Provenance: user_pasted_unverified
  - Publication date: Unknown
  - Event date: Unknown
  - Text received: 2026-09-16T15:01:32.112Z
  - Text hash: e9498953ce8e7707a7984d5404557bb34cf1c2171ea7a85475a01b767af33c49
  - Truncated: no

## What could change this assessment

- Evidence condition: a validated source passage confirming or contradicting the exact causal or forecast claim could change the verdict.
- Numerical condition: a snapshot where the required 1.4325% bid shift is met, or exit depth above 1 of snapshot snapshot_7de5ee043d0e35d42d9f7974, could change the below outcome. These are conditions to investigate, not promises that a limit order will fill or a stop will bound loss.

## Limitations

- This is a conditional research brief, not a buy or sell instruction.
- The scenario uses one displayed order-book snapshot. It is not a firm quote, an execution promise, or a forecast.
- The model does not estimate how price, depth, or returns evolve over the holding horizon.
- A supplied source can support what an issuer stated without proving future revenue or price direction.
- Captured market mode is historical replay data from the selection spike. It is not current market data.
- Pasted source text is user-supplied and unverified, even when an official-looking URL is present.
- No runtime model assessment was recorded for this report.

## Partial outcomes

- model_unconfigured: Runtime claim assessment is disabled. Economics can still be calculated; the supplied source remains visible. Recovery: Configure the server-only model variables in .env.local, then retry.
