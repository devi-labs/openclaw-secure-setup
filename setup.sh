#!/usr/bin/env bash
# Interactive setup for OpenClaw on GCE
# Reads from .env file or prompts for values, then applies to the container.
set -euo pipefail

ZONE="${GCP_ZONE:-us-central1-a}"
INSTANCE="${OPENCLAW_INSTANCE:-openclaw-vm}"

echo "🐾 OpenClaw Setup"
echo "   Instance: $INSTANCE ($ZONE)"
echo ""

# ── Load existing .env if present ──────────────────────────────────
ENV_FILE="${1:-.env}"
declare -A ENV_VALS

if [[ -f "$ENV_FILE" ]]; then
  echo "📄 Loading defaults from $ENV_FILE"
  while IFS= read -r line; do
    line="${line%%#*}"          # strip comments
    line="${line#"${line%%[![:space:]]*}"}"  # trim leading whitespace
    [[ -z "$line" || "$line" != *=* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    ENV_VALS["$key"]="$val"
  done < "$ENV_FILE"
  echo ""
fi

# ── Prompt helper (pre-fills from .env) ────────────────────────────
prompt_val() {
  local key="$1" label="$2" required="${3:-}" secret="${4:-}"
  local default="${ENV_VALS[$key]:-}"

  if [[ -n "$secret" && -n "$default" ]]; then
    local masked="${default:0:4}****"
    read -rp "$label [$masked]: " val
  else
    read -rp "$label [${default:-}]: " val
  fi

  val="${val:-$default}"

  if [[ -n "$required" && -z "$val" ]]; then
    echo "  ⚠️  $key is required"
    prompt_val "$@"
    return
  fi

  ENV_VALS["$key"]="$val"
}

echo "── Messaging ──"
prompt_val MESSAGING_PLATFORM  "Platform (slack/sms)" required
prompt_val TWILIO_USE_WHATSAPP "Use WhatsApp? (1/0)"

if [[ "${ENV_VALS[MESSAGING_PLATFORM]}" == "sms" ]]; then
  echo ""
  echo "── Twilio ──"
  prompt_val TWILIO_ACCOUNT_SID   "Account SID"    required secret
  prompt_val TWILIO_AUTH_TOKEN     "Auth Token"     required secret
  prompt_val TWILIO_PHONE_NUMBER   "Twilio/Sandbox Phone Number" required
  prompt_val TWILIO_ALLOWED_NUMBER "Your phone number (allowlist)"
else
  echo ""
  echo "── Slack ──"
  prompt_val SLACK_BOT_TOKEN "Bot Token"     required secret
  prompt_val SLACK_APP_TOKEN "App Token"     required secret
fi

echo ""
echo "── API Keys ──"
prompt_val ANTHROPIC_API_KEY "Anthropic API Key" required secret
prompt_val GITHUB_TOKEN      "GitHub PAT"        ""       secret

echo ""
echo "── Identity ──"
prompt_val GIT_AUTHOR_EMAIL "Git author email"
prompt_val GIT_AUTHOR_NAME  "Git author name"

echo ""
echo "── Brain ──"
prompt_val OPENCLAW_BRAIN_DIR    "Brain dir"    "" ""
prompt_val OPENCLAW_BRAIN_BUCKET "GCS bucket"
prompt_val OPENCLAW_BRAIN_PREFIX "GCS prefix"

echo ""
echo "── Gmail (optional) ──"
prompt_val GMAIL_CLIENT_ID     "Gmail Client ID"     "" secret
prompt_val GMAIL_CLIENT_SECRET "Gmail Client Secret"  "" secret
prompt_val GMAIL_REFRESH_TOKEN "Gmail Refresh Token"  "" secret
prompt_val GMAIL_USER_EMAIL    "Gmail address"

echo ""
echo "── Repos (optional, comma-separated) ──"
prompt_val OPENCLAW_REPOS "Repos to index"

# ── Build --container-env string ───────────────────────────────────
CONTAINER_ENV=""
for key in "${!ENV_VALS[@]}"; do
  val="${ENV_VALS[$key]}"
  [[ -z "$val" || "$val" == "..." ]] && continue
  [[ -n "$CONTAINER_ENV" ]] && CONTAINER_ENV+=","
  CONTAINER_ENV+="${key}=${val}"
done

echo ""
echo "── Applying to $INSTANCE ──"
echo ""

gcloud compute instances update-container "$INSTANCE" \
  --zone="$ZONE" \
  --container-env="$CONTAINER_ENV"

echo ""
echo "✅ Setup complete! Container will restart with new config."
echo ""
echo "📱 Webhook URL: http://$(gcloud compute instances describe "$INSTANCE" \
  --zone="$ZONE" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'):8080/sms"
