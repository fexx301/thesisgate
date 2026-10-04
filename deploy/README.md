# Deploy runbook

## Production host: EC2 `thesisgate-prod` (us-east-1, Amazon Linux 2023)

Live at **https://thesisgate.duckdns.org** (also `https://34-196-4-213.sslip.io`). The host has no SSH key and is managed through AWS Systems Manager. It has no Compose plugin, so `deploy/aws-upgrade.sh` uses plain `docker build` / `docker run`. Containers: `tg-caddy` (HTTPS), `tg-app`, `tg-quota` (ledger on the dedicated `/data` EBS volume). Secrets live only in the root-only `deploy/production.env` on the host and in SSM parameter `/thesisgate/openrouter-api-key`; the non-secret settings (model, budgets, concurrency) come from `deploy/production.env.example` on every deploy.

### Deploying

1. **Snapshot first** (from a machine with AWS access):
   ```sh
   for v in $(aws ec2 describe-instances --region us-east-1 --instance-ids i-03b8a54e47308e5f6 --query 'Reservations[0].Instances[0].BlockDeviceMappings[].Ebs.VolumeId' --output text); do
     aws ec2 create-snapshot --region us-east-1 --volume-id $v --description "pre-deploy $(date -u +%F-%H%M)" --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Project,Value=ThesisGate}]'; done
   ```
2. Push the branch, then run the upgrade through SSM:
   ```sh
   aws ssm send-command --region us-east-1 --instance-ids i-03b8a54e47308e5f6 --document-name AWS-RunShellScript \
     --timeout-seconds 1800 --parameters '{"executionTimeout":["1800"],"commands":["set -e","cd /opt/thesisgate","git fetch -q origin +refs/heads/stronger-after-hours:refs/remotes/origin/stronger-after-hours","git checkout -q -B stronger-after-hours origin/stronger-after-hours","bash deploy/aws-upgrade.sh stronger-after-hours \"thesisgate.duckdns.org, 34-196-4-213.sslip.io\" \"https://thesisgate.duckdns.org,https://34-196-4-213.sslip.io\""]}'
   ```
   (Use the branch you are deploying; `main` and `stronger-after-hours` are kept identical.)

### What the script does, and how it fails safe

- **Preflight:** aborts if `/data` is not mounted (the ledger would otherwise land on the root disk and reset) or if the root disk has under 3 GB free.
- **Builds while the site keeps serving**, tags images by commit, and validates the Caddyfile before touching anything. Each deploy copies its Caddyfile to `/opt/thesisgate-runtime/caddy/Caddyfile.<sha>` (mode 444) and binds that commit-tagged copy into `tg-caddy`, so a rollback reuses the exact config that shipped with the parked generation instead of whatever the shared file happens to hold now. The five newest copies are kept.
- **Swaps gracefully:** `docker stop -t 25` (never `rm -f`, which sends SIGKILL and skips cleanup), parks the running generation as `tg-*-prev` with its restart policy off, and starts the new one.
- **Checks end to end:** the app container must be healthy *and* `https://<primary host>/` must answer 200 through Caddy (`site_check`). Any failure restores `tg-*-prev`, i.e. the last good version. `bash deploy/aws-upgrade.sh --rollback` does the same by hand until the next deploy replaces the parked generation; it now counts the containers it restored, **fails loudly (non-zero) if there is nothing to restore**, and re-runs `site_check` afterwards so a rollback that does not actually bring the site back is reported as a failure rather than a success.
- **Prunes** unused images older than 72 h and build cache older than 24 h.
- The first-generation containers from Sep 19 (`thesisgate-*`) are obsolete and are not used by rollback.

### Bitget Agent Hub session limit (important)

`agent.bitget.com/mcp` and `datahub.noxiaohao.com/mcp` cap open MCP sessions per client IP, and unclosed sessions do not expire in practice (observed 3+ hours). The app therefore closes each session after 60 seconds idle, closes all sessions on SIGTERM/SIGINT (the container sets `NEXT_MANUAL_SIG_HANDLE=true` so Next does not exit before the cleanup finishes), and reuses one session per server. A hard kill can still leak at most the sessions used in the last minute. Do not probe these servers by hand from the production host without sending `DELETE` for the session. If "Too many open sessions" ever returns, the fix is a new Elastic IP (done once on 2026-09-28: 54.84.91.138 to 34.196.4.213), plus DuckDNS and the sslip address above.

### Disaster recovery

- **Snapshots:** daily EBS snapshots of both volumes (root and `/data`), kept 7 days, via an AWS Data Lifecycle Manager policy tagged `Project=ThesisGate`. Restore by creating volumes from the latest snapshots and attaching them to a new instance with the same layout (`/` and `/data`).
- **Rebuilding from scratch** (Amazon Linux 2023): install Docker, mount the `/data` volume, clone the repository to `/opt/thesisgate`, put the model key in SSM `/thesisgate/openrouter-api-key`, and run `deploy/aws-upgrade.sh`. It creates `deploy/production.env` with fresh secrets. Rotating `THESIS_RECOMPUTE_SIGNING_SECRET` only invalidates receipts for briefs already on screen. The quota ledger (spend counters) restarts empty unless restored from a snapshot; the provider's own key limit still bounds spend.

### Emergency: turn the AI off

Set `THESIS_LLM_ENABLED=false` in `/opt/thesisgate/deploy/production.env` on the host (via SSM) and run the deploy command above; the script never overwrites this value. The site keeps working: chat falls back to quick edits and evidence reviews report "Assessment unavailable". For an instant brake, revoke or zero the credit limit of the OpenRouter key in the OpenRouter dashboard.

### Spend controls (check these before judging)

1. **Set a credit limit on the OpenRouter key** in the OpenRouter dashboard (Keys, edit the key, credit limit). OpenRouter's API reports `limit: null` for a key without one; check with `GET https://openrouter.ai/api/v1/key`.
2. The account balance is a second ceiling and is **shared with any other project using the same account**.
3. The ledger caps the day at `THESIS_LLM_DAILY_BUDGET_USD`. A call that times out is settled at the full per-call reservation, because the provider may still bill it.


## Generic one-box setup (Lightsail or any Docker Compose host): UNTESTED REFERENCE

> The compose stack and `bootstrap-server.sh` below were written for a fresh Ubuntu host but were **never executed**: the live demo uses the EC2 flow above, and Docker was not available where they were written. Treat them as a starting point and test them before relying on them.

One small Ubuntu server runs three containers with Docker Compose:

| Container | Role | Reachable from |
| --- | --- | --- |
| `caddy` | HTTPS (automatic Let's Encrypt certificates) and reverse proxy | Internet, ports 80/443 |
| `app` | The Next.js app (standalone build) | Caddy only |
| `quota` | Durable spend ledger (SQLite on the `quota-data` volume) | The app only, on an internal network with no internet access |

The app calls the quota service at `http://quota:8787`. Plain HTTP is allowed only for loopback and single-label private service names (`isPrivateServiceHost` in `src/server/quota.ts`).

## 1. Create the server

- Lightsail, region **eu-central-1 (Frankfurt)**, Ubuntu 24.04, plan with **2 GB RAM** (the Next.js build needs it; the bootstrap also adds 2 GB swap).
- Attach a **static IP**, and open only ports 22, 80 and 443 in the instance firewall.
- Enable **automatic snapshots**. They back up the quota ledger volume.
- Before deploying, check from the server that the upstreams answer:
  `curl -s "https://api.bitget.com/api/v3/market/tickers?category=SPOT&symbol=RNVDAUSDT" | head -c 200` and
  `curl -s -A "Mozilla/5.0" "https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=1d&interval=1d" | head -c 200`.

## 2. Pick the public address

Use a domain you control (an `A` record pointing at the static IP), or the no-domain fallback `<ip-with-dashes>.sslip.io` (for example `3-120-45-6.sslip.io`), which Caddy can also certify.

## 3. Bootstrap and configure

```sh
deploy/deploy.sh ubuntu@<static-ip> <lightsail-key.pem>      # first sync (the start step fails until production.env exists)
ssh ubuntu@<static-ip> 'bash ~/thesisgate/deploy/bootstrap-server.sh'
ssh ubuntu@<static-ip> 'nano ~/thesisgate/deploy/production.env'  # SITE_ADDRESS, THESIS_PUBLIC_ORIGINS, THESIS_LLM_API_KEY
deploy/deploy.sh ubuntu@<static-ip> <lightsail-key.pem>      # builds and starts the stack
```

`bootstrap-server.sh` generates the recompute, visitor-hash and quota secrets. `production.env` never leaves the server.

## 4. Model spending safety

1. In OpenRouter, create a **dedicated key for this server** with a **credit limit** (for example $10). That limit is the hard cap the quota service cannot provide on its own.
2. The quota ledger adds a daily budget ($3), a per-visitor budget ($0.30) and a concurrency cap (3), and reserves each call's maximum cost before calling the provider.
3. The app adds per-visitor rate limits: 5 briefs and 20 chat messages per 10 minutes.

## 5. Verify after deploy

- `https://<address>/` loads over HTTPS, and the radar shows live headlines and the rNVDA and NVDA prices.
- A chat message builds a plan and a brief whose run details show the model and a provider cost.
- `docker compose -f deploy/docker-compose.yml --env-file deploy/production.env restart quota` keeps the ledger (the reservation count survives).
- Reconciliation: `docker compose ... exec quota node -e "fetch('http://127.0.0.1:8787/v1/reconciliation',{headers:{authorization:'Bearer '+process.env.THESIS_QUOTA_SERVICE_TOKEN}}).then(r=>r.text()).then(console.log)"`.

## Operations

- Update: run `deploy/deploy.sh ubuntu@<ip> <key>` again (it rebuilds and restarts only what changed).
- Logs: `ssh ubuntu@<ip> 'cd ~/thesisgate && docker compose -f deploy/docker-compose.yml --env-file deploy/production.env logs -f --tail 100'`.
- Turn AI off instantly: set `THESIS_LLM_ENABLED=false` in `production.env` and redeploy. Everything else keeps working, and the chat falls back to simple edits.

## Investigation enablement — verified October 4

Production has `THESIS_INVESTIGATION_ENABLED=true` on source commit `d3133e3`, build `tg-bfc794679571affd6050`. The upgrade script does not overwrite this runtime flag from the example file. Change it in the root-only production environment and recreate the app via the normal upgrade path to turn investigation off. Preserve the model and quota settings.

Before enabling, the bounded live check verified supported, contradicted and insufficient states, repeatability, citations and source-failure handling. Bitget earnings/analyst upstream data were returning 503; this remains an explicit unavailable state. The provider cap was left unchanged at the owner’s direction. See `evals/investigation/validation-2026-10-04.json`.

Pre-deployment snapshots: root `snap-0a544ea11cbb33d27`, quota data `snap-08b62645d890f48ce`, both completed. The previous healthy generation is parked as `tg-*-prev`. Full deployed request: HTTP 200, investigation contradicted with a citation, economics calculated, two model calls, 14.4 seconds, $0.0016842.
