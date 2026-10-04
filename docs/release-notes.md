# Release notes

[Back to the project overview](../README.md) · [Live verification](../evals/investigation/validation-2026-10-04.json) · [Deployment runbook](../deploy/README.md)

## October 4, 2026 — form-section spacing

The first form section now has a 24px gap below the draft-toolbar divider, matching the form's existing section spacing. The application fingerprint is `tg-1f00bbb2be6f0881cc0a`.

Verification: the rendered gap measured 24px at 1200px and 375px viewport widths, with no horizontal overflow on mobile; the production build passed. This CSS-only follow-up did not repeat the earlier full test suite or live research checks.

## October 4, 2026 — compact brief and enabled investigation

The compact-brief release was deployed at https://thesisgate.duckdns.org from source commit `e23b0f5`, build `tg-8cec4bfa9fd413e41945`, with `openai/gpt-6-luna-pro` through OpenRouter. `THESIS_INVESTIGATION_ENABLED=true` in production; fresh installations remain default-off. Subsequent documentation-only changes do not alter the application fingerprint. Check Run details or an export for the actual served version.

### Interface

- The composer appears before the greeting and suggestions. The introduction is shorter.
- The result gets more desktop width and focus after completion; the plan collapses.
- The overview leads with the correction and required price move, followed by the remaining assumption and next check. UI and Markdown share this order.
- Explanations are expandable. Investigation states without a new decisive finding start collapsed, retaining their status and details.
- The close-comparison wording describes price versus the last US close. It does not measure how much news is priced in. ATR is a volatility scale, not a direction or time-to-target estimate.

On the deployed 375×812 phone viewport, the composer occupied approximately 331–398px and was fully visible without scrolling. One NVIDIA replay's overview measured about 785px tall, down from about 1,106px before this pass. These are observed layout checks, not participant-study results.

Verification: typecheck, lint, 259 unit/integration tests across 31 files, production build and 34 desktop/mobile browser journeys passed, with zero browser retries.

### Live investigation

The bounded backend verification was recorded on source `d3133e3`, build `tg-bfc794679571affd6050`. It established repeated supported SEC revenue assessments, a cited contradiction of a wrong amount, and insufficient deal attribution. SEC filing metadata and a concrete NVIDIA release were retrieved. Bitget earnings/analyst sources returned HTTP 503; failures preserved the original review and used no additional model call.

An earlier broad-assessment run left the wrong-amount case insufficient; the failed case remains in the evidence. A targeted one-claim instruction corrected that case in the later bounded check. A generic newsroom topic query found no relevant release; a separate concrete-release retrieval succeeded. These observations do not establish broad research reliability.

The complete deployed research request returned HTTP 200, a cited investigation contradiction and calculated economics in 14.379 seconds, with two model calls costing $0.0016842. The six model-check calls cost $0.00603; total reported check/verification cost was $0.0077142. These figures cover that recorded integration check, not every subsequent use or documentation replay.

### Operations and validation status

The EC2 app, quota and proxy containers passed deployment health checks. The previous generation is retained for rollback; pre-deploy root and quota-data snapshots completed. The ledger is volume-backed. A full restore drill, multi-instance load certification and new provider hard-cap verification were not performed in this update. The provider-key cap was left unchanged at the owner's direction; the existing app quotas remain active.

The trader-study baseline is Claude with web search. Its exact displayed model/version must be recorded at session time. Recorded participants: **0**. The walkthrough script is prepared; a public video and completed submission are not claimed.
