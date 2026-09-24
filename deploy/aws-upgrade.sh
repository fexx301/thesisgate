#!/usr/bin/env bash
# In-place upgrade of the existing EC2 host (thesisgate-prod). Run as root from /opt/thesisgate, usually via SSM:
#   bash deploy/aws-upgrade.sh <branch> "<site addresses>" "<public origins>"
# Builds the new images while the current stack keeps serving, then swaps containers. The previous
# generation is stopped, not removed, so `bash deploy/aws-upgrade.sh --rollback` restores it.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PARAM="/thesisgate/openrouter-api-key"
ROOT=/opt/thesisgate
ENV_FILE="$ROOT/deploy/production.env"
OLD=(thesisgate-app thesisgate-caddy thesisgate-quota)
NEW=(tg-caddy tg-app tg-quota)
cd "$ROOT"

rollback() {
  echo "Rolling back to the previous containers."
  for c in "${NEW[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  for c in thesisgate-quota thesisgate-app thesisgate-caddy; do docker start "$c" >/dev/null 2>&1 || true; done
}

if [ "${1:-}" = "--rollback" ]; then rollback; exit 0; fi

BRANCH="${1:?branch}"
SITE_ADDRESS="${2:?site addresses, e.g. \"thesisgate.duckdns.org, 54-84-91-138.sslip.io\"}"
PUBLIC_ORIGINS="${3:?public origins, e.g. https://thesisgate.duckdns.org}"

# Untracked files from the first manual deploy would block checkout; keep a copy.
mkdir -p /opt/thesisgate-backup
for f in .dockerignore; do
  if [ -f "$f" ] && ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then mv "$f" "/opt/thesisgate-backup/$f.$(date +%s)"; fi
done
git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
echo "Code at $(git log --oneline -1)"

value() { grep -E "^$1=" "$2" 2>/dev/null | head -1 | cut -d= -f2- || true; }
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
  cp deploy/production.env.example "$ENV_FILE"
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
# The model key lives only in Parameter Store and this root-only file.
set_var THESIS_LLM_API_KEY "$(aws ssm get-parameter --region "$REGION" --name "$PARAM" --with-decryption --query Parameter.Value --output text)"
chmod 600 "$ENV_FILE"

echo "Building images while the current site keeps serving."
docker build --quiet -t thesisgate-app:next -f Dockerfile . >/dev/null
docker build --quiet -t thesisgate-quota:next -f quota-service/Dockerfile . >/dev/null

docker network inspect thesisgate-edge >/dev/null 2>&1 || docker network create thesisgate-edge >/dev/null
docker network inspect thesisgate-private >/dev/null 2>&1 || docker network create --internal thesisgate-private >/dev/null

trap 'rollback' ERR

for c in "${OLD[@]}"; do docker stop "$c" >/dev/null 2>&1 || true; done
for c in "${NEW[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done

docker run -d --name tg-quota --restart unless-stopped \
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
  thesisgate-quota:next >/dev/null

for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' tg-quota)" = "healthy" ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' tg-quota)" = "healthy" ] || { echo "quota service did not become healthy"; docker logs --tail 30 tg-quota; false; }

docker run -d --name tg-app --restart unless-stopped \
  --network thesisgate-private --network-alias app \
  --env-file "$ENV_FILE" \
  -e THESIS_LLM_QUOTA_URL=http://quota:8787/v1/reservations \
  --memory 900m \
  thesisgate-app:next >/dev/null
# The private network has no internet egress; the edge network gives the app outbound access and Caddy a route in.
docker network connect --alias app thesisgate-edge tg-app

docker run -d --name tg-caddy --restart unless-stopped \
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

trap - ERR
docker image prune -f >/dev/null
echo "Upgrade complete."
docker ps --format '{{.Names}}  {{.Status}}' | grep -E '^(tg-|thesisgate-)'
