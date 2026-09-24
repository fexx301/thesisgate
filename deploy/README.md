# Self-hosted deploy

## Current production host (EC2 `thesisgate-prod`, us-east-1)

The live demo runs on an existing EC2 instance at **https://thesisgate.duckdns.org** (also `https://54-84-91-138.sslip.io`). The host has no SSH key and is managed through AWS Systems Manager. It has no Compose plugin, so `deploy/aws-upgrade.sh` uses plain `docker build` and `docker run`:

```sh
aws ssm send-command --region us-east-1 --instance-ids i-03b8a54e47308e5f6 --document-name AWS-RunShellScript \
  --parameters 'commands=["cd /opt/thesisgate && git fetch -q origin stronger-after-hours && git checkout -q -B stronger-after-hours origin/stronger-after-hours && bash deploy/aws-upgrade.sh stronger-after-hours \"thesisgate.duckdns.org, 54-84-91-138.sslip.io\" \"https://thesisgate.duckdns.org,https://54-84-91-138.sslip.io\""]'
```

- The OpenRouter key is read from the SecureString parameter `/thesisgate/openrouter-api-key` at deploy time and is written only to the root-only `deploy/production.env` on the host.
- The quota ledger stays on the dedicated `/data` EBS volume (`/data/thesisgate-quota`), and Caddy's certificates stay in the `thesisgate-caddy-*` volumes.
- New containers are `tg-quota`, `tg-app` and `tg-caddy`. The first-generation containers are stopped, not deleted: `bash deploy/aws-upgrade.sh --rollback` brings them back.

## Generic one-box setup (Lightsail or any Docker Compose host)

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
