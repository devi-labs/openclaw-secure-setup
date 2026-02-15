#!/usr/bin/env bash
set -euo pipefail

BOT_TOKEN="$(security find-generic-password -a "$USER" -s "openclaw/SLACK_BOT_TOKEN" -w)"
APP_TOKEN="$(security find-generic-password -a "$USER" -s "openclaw/SLACK_APP_TOKEN" -w)"
ANTHROPIC_API_KEY="$(security find-generic-password -a "$USER" -s "openclaw/ANTHROPIC_API_KEY" -w)"
GITHUB_TOKEN="$(security find-generic-password -a "$USER" -s "openclaw/GITHUB_TOKEN" -w)"

podman rm -f openclaw >/dev/null 2>&1 || true

exec podman run -d \
  --name openclaw \
  --restart=always \
  -e SLACK_BOT_TOKEN="$BOT_TOKEN" \
  -e SLACK_APP_TOKEN="$APP_TOKEN" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 256 \
  --memory 512m \
  --cpus 1 \
  openclaw:local
