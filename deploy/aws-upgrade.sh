#!/usr/bin/env bash
# In-place upgrade of the EC2 host (thesisgate-prod). Run as root from /opt/thesisgate, normally via SSM:
#   bash deploy/aws-upgrade.sh <branch> "<site addresses>" "<public origins>"
#   bash deploy/aws-upgrade.sh --rollback
#
# Flow: build new images while the current site keeps serving, validate the Caddy config, stop the current
# containers GRACEFULLY, park them as tg-*-prev (stopped, restart policy off), start the new ones, and
# check the site end to end. Any failure restores the parked containers, i.e. the previous good version.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PARAM="/thesisgate/openrouter-api-key"
ROOT=/opt/thesisgate
ENV_FILE="$ROOT/deploy/production.env"
EXAMPLE="$ROOT/deploy/production.env.example"
STOP_TIMEOUT=25
cd "$ROOT"

# Non-secret settings whose source of truth is the repository (production.env keeps only secrets and addresses).
TUNABLES=(THESIS_LLM_ENABLED THESIS_LLM_BASE_URL THESIS_LLM_MODEL THESIS_LLM_PROTOCOL THESIS_LLM_REASONING_EFFORT
  THESIS_LLM_MAX_CALL_COST_USD THESIS_LLM_DAILY_BUDGET_USD THESIS_LLM_PER_VISITOR_BUDGET_USD
  THESIS_LLM_PROVIDER_HARD_LIMIT_USD THESIS_LLM_MAX_CONCURRENT THESIS_SEC_USER_AGENT
  NEXT_PUBLIC_TELEMETRY_ENABLED THESIS_TELEMETRY_ENABLED)

exists() { docker inspect "$1" >/dev/null 2>&1; }
value() { grep -E "^$1=" "$2" 2>/dev/null | head -1 | cut -d= -f2- || true; }

rollback() {
  echo "Restoring the previous containers."
  for n in caddy app quota; do docker rm -f "tg-$n" >/dev/null 2>&1 || true; done
  for n in quota app caddy; do
    if exists "tg-$n-prev"; then
      docker rename "tg-$n-prev" "tg-$n"
      docker update --restart unless-stopped "tg-$n" >/dev/null
      docker start "tg-$n" >/dev/null || true
    fi
  done
  docker ps --format '{{.Names}}  {{.Status}}' | grep -E '^tg-' || true
}

if [ "${1:-}" = "--rollback" ]; then rollback; exit 0; fi

BRANCH="${1:?branch}"
SITE_ADDRESS="${2:?site addresses, e.g. \"thesisgate.duckdns.org, 34-196-4-213.sslip.io\"}"
PUBLIC_ORIGINS="${3:?public origins, e.g. https://thesisgate.duckdns.org}"

# ---- preflight: refuse to deploy into a state that could lose the ledger or fill the disk ----
mountpoint -q /data || { echo "ABORT: /data is not mounted. The quota ledger would land on the root disk and reset."; exit 1; }
avail_gb=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
[ "${avail_gb:-0}" -ge 3 ] || { echo "ABORT: only ${avail_gb}G free on / (need 3G). Prune images or grow the volume."; exit 1; }

mkdir -p /opt/thesisgate-backup
if [ -f .dockerignore ] && ! git ls-files --error-unmatch .dockerignore >/dev/null 2>&1; then mv .dockerignore "/opt/thesisgate-backup/.dockerignore.$(date +%s)"; fi
git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
SHA="$(git rev-parse --short HEAD)"
echo "Code at $(git log --oneline -1)"

set_var() {
  local name="$1" val="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^${name}=" "$ENV_FILE"; then
    while IFS= read -r line; do
      if [[ "$line" == "${name}="* ]]; then printf '%s=%s\n' "$name" "$val"; else printf '%s\n' "$line"; fi
    done < "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"; printf '%s=%s\n' "$name" "$val" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  # Carry over the first deploy's secrets so existing receipts and the quota ledger token stay valid.
  RECOMPUTE="$(value THESIS_RECOMPUTE_SIGNING_SECRET app.env)"
  QUOTA_TOKEN="$(value THESIS_QUOTA_SERVICE_TOKEN quota.env)"
  set_var THESIS_RECOMPUTE_SIGNING_SECRET "${RECOMPUTE:-$(openssl rand -hex 32)}"
  set_var THESIS_LLM_QUOTA_TOKEN "${QUOTA_TOKEN:-$(openssl rand -hex 32)}"
  set_var THESIS_VISITOR_HASH_SECRET "$(openssl rand -hex 32)"
fi
set_var SITE_ADDRESS "$SITE_ADDRESS"
set_var THESIS_PUBLIC_ORIGINS "$PUBLIC_ORIGINS"
for name in "${TUNABLES[@]}"; do
  from_example="$(value "$name" "$EXAMPLE")"
  [ -n "$from_example" ] && set_var "$name" "$from_example"
done
# The model key lives only in Parameter Store and this root-only file.
set_var THESIS_LLM_API_KEY "$(aws ssm get-parameter --region "$REGION" --name "$PARAM" --with-decryption --query Parameter.Value --output text)"
chmod 600 "$ENV_FILE"

# ---- build while the current site keeps serving ----
echo "Building images ($SHA)."
docker build --quiet -t "thesisgate-app:$SHA" -f Dockerfile . >/dev/null
docker build --quiet -t "thesisgate-quota:$SHA" -f quota-service/Dockerfile . >/dev/null
docker run --rm -e SITE_ADDRESS="$SITE_ADDRESS" -v "$ROOT/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || { echo "ABORT: the Caddyfile is invalid; nothing was changed."; exit 1; }

docker network inspect thesisgate-edge >/dev/null 2>&1 || docker network create thesisgate-edge >/dev/null
docker network inspect thesisgate-private >/dev/null 2>&1 || docker network create --internal thesisgate-private >/dev/null

# ---- swap: graceful stop, park the current generation as -prev ----
for n in caddy app quota; do
  if exists "tg-$n"; then docker stop -t "$STOP_TIMEOUT" "tg-$n" >/dev/null 2>&1 || true; fi
done
for n in caddy app quota; do docker rm -f "tg-$n-prev" >/dev/null 2>&1 || true; done
for n in caddy app quota; do
  if exists "tg-$n"; then
    docker rename "tg-$n" "tg-$n-prev"
    # A parked container must never come back on its own after a reboot next to its replacement.
    docker update --restart no "tg-$n-prev" >/dev/null
  fi
done

trap 'rollback' ERR

docker run -d --name tg-quota --restart unless-stopped --stop-timeout "$STOP_TIMEOUT" \
  --network thesisgate-private --network-alias quota \
  -v /data/thesisgate-quota:/data \
  -e THESIS_QUOTA_HOST=0.0.0.0 -e THESIS_QUOTA_PORT=8787 -e THESIS_QUOTA_DATABASE_PATH=/data/quota.sqlite \
  -e THESIS_QUOTA_SERVICE_TOKEN="$(value THESIS_LLM_QUOTA_TOKEN "$ENV_FILE")" \
  -e THESIS_QUOTA_MAX_CALL_COST_USD="$(value THESIS_LLM_MAX_CALL_COST_USD "$ENV_FILE")" \
  -e THESIS_QUOTA_DAILY_BUDGET_USD="$(value THESIS_LLM_DAILY_BUDGET_USD "$ENV_FILE")" \
  -e THESIS_QUOTA_PER_VISITOR_BUDGET_USD="$(value THESIS_LLM_PER_VISITOR_BUDGET_USD "$ENV_FILE")" \
  -e THESIS_QUOTA_PROVIDER_HARD_LIMIT_USD="$(value THESIS_LLM_PROVIDER_HARD_LIMIT_USD "$ENV_FILE")" \
  -e THESIS_QUOTA_MAX_CONCURRENT="$(value THESIS_LLM_MAX_CONCURRENT "$ENV_FILE")" \
  -e THESIS_QUOTA_LEASE_SECONDS=60 \
  --health-cmd "node -e \"fetch('http://127.0.0.1:8787/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))\"" \
  --health-interval 5s --health-retries 10 \
  "thesisgate-quota:$SHA" >/dev/null

for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' tg-quota)" = "healthy" ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' tg-quota)" = "healthy" ] || { echo "quota service did not become healthy"; docker logs --tail 30 tg-quota; false; }

docker run -d --name tg-app --restart unless-stopped --stop-timeout "$STOP_TIMEOUT" \
  --network thesisgate-private --network-alias app \
  --env-file "$ENV_FILE" \
  -e THESIS_LLM_QUOTA_URL=http://quota:8787/v1/reservations \
  --memory 900m \
  "thesisgate-app:$SHA" >/dev/null
# The private network has no internet egress; the edge network gives the app outbound access and Caddy a route in.
docker network connect --alias app thesisgate-edge tg-app

docker run -d --name tg-caddy --restart unless-stopped --stop-timeout "$STOP_TIMEOUT" \
  --network thesisgate-edge -p 80:80 -p 443:443 \
  -e SITE_ADDRESS="$SITE_ADDRESS" \
  -v "$ROOT/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v thesisgate-caddy-data:/data -v thesisgate-caddy-config:/config \
  caddy:2-alpine >/dev/null

for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' tg-app)" = "healthy" ] && break
  sleep 3
done
[ "$(docker inspect -f '{{.State.Health.Status}}' tg-app)" = "healthy" ] || { echo "app did not become healthy"; docker logs --tail 40 tg-app; false; }

# End-to-end: the public name must answer over HTTPS through Caddy, not just the app container.
PRIMARY="$(printf '%s' "$SITE_ADDRESS" | cut -d, -f1 | tr -d ' ')"
ok=0
for _ in $(seq 1 20); do
  code="$(curl -sk -m 8 -o /dev/null -w '%{http_code}' --resolve "$PRIMARY:443:127.0.0.1" "https://$PRIMARY/" || true)"
  [ "$code" = "200" ] && { ok=1; break; }
  sleep 3
done
[ "$ok" = "1" ] || { echo "site did not answer 200 over HTTPS for $PRIMARY (last code: ${code:-none})"; docker logs --tail 20 tg-caddy; false; }

trap - ERR
# Keep the parked previous generation (and its images) for the next rollback; drop everything older.
docker image prune -af --filter "until=72h" >/dev/null
docker builder prune -af --filter "until=24h" >/dev/null
echo "Upgrade complete ($SHA)."
docker ps -a --format '{{.Names}}  {{.Status}}' | grep -E '^tg-'
df -h / | tail -1
