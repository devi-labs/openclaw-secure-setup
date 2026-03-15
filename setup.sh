#!/usr/bin/env bash
# Apply .env config to OpenClaw GCE container.
# Usage: bash setup.sh [.env file]
#   -i  Interactive mode (prompt for each value)
set -euo pipefail

# ── Parse flags ──────────────────────────────────────────────────
INTERACTIVE=false
while getopts "i" opt; do
  case "$opt" in
    i) INTERACTIVE=true ;;
    *) ;;
  esac
done
shift $((OPTIND - 1))

# ── Pre-load key vars from .env ──────────────────────────────────
ENV_FILE="${1:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

_val() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }

ZONE="${GCP_ZONE:-$(_val GCP_ZONE)}"
ZONE="${ZONE:-us-central1-a}"
INSTANCE="${OPENCLAW_INSTANCE:-$(_val OPENCLAW_INSTANCE)}"
INSTANCE="${INSTANCE:-openclaw-vm}"
PROJECT="${GCP_PROJECT_ID:-$(_val GCP_PROJECT_ID)}"

echo "🐾 OpenClaw Setup"
echo "   Instance: $INSTANCE ($ZONE)"
if [[ -n "$PROJECT" ]]; then
  echo "   Project:  $PROJECT"
fi
echo ""

# ── Load .env into associative array ─────────────────────────────
declare -A ENV_VALS

echo "📄 Loading from $ENV_FILE"
while IFS= read -r line; do
  line="${line%%#*}"          # strip comments
  line="${line#"${line%%[![:space:]]*}"}"  # trim leading whitespace
  [[ -z "$line" || "$line" != *=* ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  ENV_VALS["$key"]="$val"
done < "$ENV_FILE"
echo ""

# ── Interactive prompts (only with -i flag) ──────────────────────
if [[ "$INTERACTIVE" == "true" ]]; then
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
  prompt_val MESSAGING_PLATFORM  "Platform (slack/sms/telegram)" required

  if [[ "${ENV_VALS[MESSAGING_PLATFORM]}" == "sms" ]]; then
    prompt_val TWILIO_USE_WHATSAPP "Use WhatsApp? (1/0)"
    echo ""
    echo "── Twilio ──"
    prompt_val TWILIO_ACCOUNT_SID   "Account SID"    required secret
    prompt_val TWILIO_AUTH_TOKEN     "Auth Token"     required secret
    prompt_val TWILIO_PHONE_NUMBER   "Twilio/Sandbox Phone Number" required
    prompt_val TWILIO_ALLOWED_NUMBER "Your phone number (allowlist)"
  elif [[ "${ENV_VALS[MESSAGING_PLATFORM]}" == "telegram" ]]; then
    echo ""
    echo "── Telegram ──"
    prompt_val TELEGRAM_BOT_TOKEN      "Bot Token (from @BotFather)" required secret
    prompt_val TELEGRAM_ALLOWED_USER_IDS "Allowed user IDs (comma-separated)"
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
fi

# ── Write env file for gcloud (avoids comma-delimiter issues) ─────
TMPENV=$(mktemp)
trap 'rm -f "$TMPENV"' EXIT
for key in "${!ENV_VALS[@]}"; do
  val="${ENV_VALS[$key]}"
  [[ -z "$val" || "$val" == "..." ]] && continue
  echo "${key}=${val}" >> "$TMPENV"
done

echo "── Applying to $INSTANCE ──"
echo ""

PROJECT_FLAG=""
if [[ -n "$PROJECT" ]]; then
  PROJECT_FLAG="--project=$PROJECT"
fi

gcloud compute instances update-container "$INSTANCE" \
  --zone="$ZONE" \
  $PROJECT_FLAG \
  --container-env-file="$TMPENV"

echo ""
echo "✅ Setup complete! Container will restart with new config."
echo ""
echo "📱 Webhook URL: http://$(gcloud compute instances describe "$INSTANCE" \
  --zone="$ZONE" \
  $PROJECT_FLAG \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'):8080/sms"
