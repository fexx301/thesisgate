#!/usr/bin/env bash
# Run once on a fresh Ubuntu 24.04 server as the default user (with sudo).
# Installs Docker, adds swap for the Next.js build, and prepares deploy/production.env with random secrets.
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades sqlite3

cd "$(dirname "$0")"
if [ ! -f production.env ]; then
  cp production.env.example production.env
  chmod 600 production.env
  for name in THESIS_RECOMPUTE_SIGNING_SECRET THESIS_VISITOR_HASH_SECRET THESIS_LLM_QUOTA_TOKEN; do
    sed -i "s|^${name}=.*|${name}=$(openssl rand -hex 32)|" production.env
  done
  echo "Created deploy/production.env with fresh secrets. Set SITE_ADDRESS, THESIS_PUBLIC_ORIGINS and THESIS_LLM_API_KEY next."
fi
echo "Bootstrap complete. Log out and back in once so the docker group applies."
