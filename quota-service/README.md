# ThesisGate durable quota service

This is the durable reservation service used by the optional server-side model adapter. It is deliberately separate from the Next.js app so the app can remain stateless and horizontally deployable while one small service owns the spend ledger.

The service uses Node 24's built-in SQLite driver with WAL mode, `synchronous=FULL`, and `BEGIN IMMEDIATE` transactions. Run it as one writer with a persistent `/data` volume and backups. Do not run it on an ephemeral filesystem or as multiple independent instances: the quota ledger must have one durable serialized writer.

## Local run

From the `thesisgate/` directory, set a service token and matching limits:

```sh
export THESIS_QUOTA_SERVICE_TOKEN='replace-with-a-long-random-token'
export THESIS_QUOTA_DATABASE_PATH="$(pwd)/quota-service/data/quota.sqlite"
export THESIS_QUOTA_MAX_CALL_COST_USD=0.02
export THESIS_QUOTA_DAILY_BUDGET_USD=1
export THESIS_QUOTA_PER_VISITOR_BUDGET_USD=0.10
export THESIS_QUOTA_PROVIDER_HARD_LIMIT_USD=1
export THESIS_QUOTA_MAX_CONCURRENT=2
export THESIS_QUOTA_LEASE_SECONDS=60
npm run quota:start
```

The authenticated reservation endpoint is `POST /v1/reservations`; `GET /healthz` is an unauthenticated liveness check. `GET /v1/reconciliation` lists reservations whose 60-second concurrency lease expired while their spend is still held.

The app's `THESIS_LLM_QUOTA_TOKEN` must equal `THESIS_QUOTA_SERVICE_TOKEN`. The app's `THESIS_LLM_*` budget values must exactly match the service's `THESIS_QUOTA_*` values. The service rejects mismatches instead of silently applying different limits.

## Ledger rules

- Reserve is idempotent by the app request ID. Retrying the same request returns the original decision and reservation ID without spending twice.
- A reservation holds the maximum permitted call cost before the provider call. It counts toward the UTC-day, per-visitor, and provider-service ceilings immediately.
- The lease controls active concurrency only. An expired lease does not refund spend; it appears in reconciliation.
- Settlement is idempotent by reservation ID. A reported cost below the reservation releases the difference; a missing or failed settlement keeps the reserved maximum held.
- A reported cost above the reservation is rejected and left for reconciliation. The ledger never accepts an unbounded provider charge.
- The service-side provider ceiling is an additional UTC-day reservation cap. It is not a substitute for a hard spending limit on the model-provider account.

## Container deployment

Build from the repository's `thesisgate/` directory:

```sh
docker build -f quota-service/Dockerfile -t thesisgate-quota .
docker run --rm \
  -p 8787:8787 \
  -v thesisgate-quota-data:/data \
  -e THESIS_QUOTA_SERVICE_TOKEN='replace-with-a-long-random-token' \
  -e THESIS_QUOTA_MAX_CALL_COST_USD=0.02 \
  -e THESIS_QUOTA_DAILY_BUDGET_USD=1 \
  -e THESIS_QUOTA_PER_VISITOR_BUDGET_USD=0.10 \
  -e THESIS_QUOTA_PROVIDER_HARD_LIMIT_USD=1 \
  -e THESIS_QUOTA_MAX_CONCURRENT=2 \
  thesisgate-quota
```

Put the service behind HTTPS, restrict its network access to the app, back up the SQLite volume, and rehearse restoring it before enabling public model calls. The app should use the HTTPS URL ending in `/v1/reservations` as `THESIS_LLM_QUOTA_URL`.

## Enablement gate

This service implementation does not by itself make production AI safe. Before setting `THESIS_LLM_ENABLED=true`, verify all of the following on the actual deployment:

1. The persistent volume survives a service restart and restore rehearsal.
2. Duplicate reserve and settle requests are idempotent.
3. Concurrent app instances cannot exceed the daily, per-visitor, or concurrency caps.
4. Provider timeout, lost response, and settlement failure leave a reconciliation row and do not trigger an automatic paid retry.
5. The model provider account has its own effective hard spending limit, alerting, and key restrictions.
6. The app can reach the service over TLS with the exact token, and the service's configured limits match the app's values.

Until those checks are recorded, keep the app model-disabled and use captured replay. Deterministic economics and evidence-unavailable states remain fully usable without this service.
