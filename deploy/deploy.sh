#!/usr/bin/env bash
# Syncs this working tree to the server and (re)starts the stack.
# Usage: deploy/deploy.sh ubuntu@203.0.113.10 [path-to-ssh-key]
set -euo pipefail
TARGET="${1:?usage: deploy/deploy.sh user@host [ssh-key]}"
KEY="${2:-}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -n "$KEY" ] && SSH_OPTS+=(-i "$KEY")
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude 'test-results' --exclude 'playwright-report' \
  --exclude 'evals/results' --exclude '.env*' --exclude 'deploy/production.env' --exclude 'deploy/*.secret' \
  --exclude 'quota-service/data' --exclude '*.tsbuildinfo' --exclude .hallmark \
  -e "ssh ${SSH_OPTS[*]}" "$ROOT/" "$TARGET:~/thesisgate/"

ssh "${SSH_OPTS[@]}" "$TARGET" 'cd ~/thesisgate && test -f deploy/production.env || { echo "deploy/production.env missing on server"; exit 1; }
  docker compose -f deploy/docker-compose.yml --env-file deploy/production.env up -d --build --remove-orphans
  docker image prune -f >/dev/null
  docker compose -f deploy/docker-compose.yml --env-file deploy/production.env ps'
