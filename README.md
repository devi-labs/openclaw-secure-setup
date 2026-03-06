# OpenClaw

**AI-powered development agent that creates PRs from Slack or WhatsApp**

OpenClaw is a dev agent that uses Claude (Anthropic) to plan and execute code changes in a sandboxed environment, then opens pull requests on GitHub. Talk to it via Slack, WhatsApp, or SMS. Built for fast iteration with a focus on security and reliability.

## Features

- 🤖 **Autonomous dev agent** — Describe a task, get a PR
- 📱 **WhatsApp/SMS support** — Chat via Twilio (alongside Slack)
- 📧 **Gmail integration** — Check, search, read, and send emails
- 🧠 **openclaw-brain** — Local-first memory with GCS backup (always-on, fast)
- 🤔 **Clarification mode** — Asks questions only when it truly can't understand
- 📊 **GitHub integration** — Summarize PRs, explore repos, open PRs
- 🔒 **Secure sandbox** — Runs git/npm/node in isolated containers
- ☁️ **GCE ready** — Always-on VM, no cold starts (Cloud Run also supported)
- 🏠 **Local option** — Run with Podman + macOS Keychain
- ⚙️ **Configurable LLM model** — Set model via `ANTHROPIC_MODEL` env var

## Quick Start

### Prerequisites

1. **Messaging platform** — one of:
   - **Slack App** with Socket Mode enabled (Bot Token Scopes: `app_mentions:read`, `chat:write`, `channels:history`; App-Level Token with `connections:write` scope)
   - **Twilio account** with a phone number (for SMS/WhatsApp)
2. **Anthropic API Key** (for Claude)
3. **GitHub Personal Access Token** with `repo` scope
4. **Google Cloud Project** (optional, for brain GCS backup)

### Option 1: Run Locally with Podman

**Why Podman?** Rootless, daemonless container runtime with better security than Docker Desktop.

```bash
# Install Podman (macOS)
brew install podman

# Store secrets in macOS Keychain
security add-generic-password -a "$USER" -s "openclaw/SLACK_BOT_TOKEN" -w "xoxb-..."
security add-generic-password -a "$USER" -s "openclaw/SLACK_APP_TOKEN" -w "xapp-..."
security add-generic-password -a "$USER" -s "openclaw/ANTHROPIC_API_KEY" -w "sk-ant-..."
security add-generic-password -a "$USER" -s "openclaw/GITHUB_TOKEN" -w "ghp_..."

# Build and run
podman build -t openclaw:local .
./run-openclaw.sh
```

### Option 2: Deploy to GCE (Compute Engine)

GCE is the preferred deployment — always-on VM, no cold starts, persistent local brain storage.

```bash
# Set your project info
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1
export ZONE=${REGION}-a
export INSTANCE_NAME=openclaw-vm
export SA_EMAIL="openclaw-runtime@$PROJECT_ID.iam.gserviceaccount.com"

# Build and push container image
TAG=$(git rev-parse --short HEAD)
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/openclaw/openclaw:$TAG"
gcloud builds submit --tag "$IMAGE" .

# Create the VM with container
gcloud compute instances create-with-container "$INSTANCE_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT_ID" \
  --machine-type=e2-small \
  --service-account="$SA_EMAIL" \
  --scopes=cloud-platform \
  --container-image="$IMAGE" \
  --container-env="\
GCP_PROJECT_ID=$PROJECT_ID,\
GCP_REGION=$REGION,\
OPENCLAW_BRAIN_BUCKET=your-bucket-name,\
OPENCLAW_BRAIN_PREFIX=openclaw-brain,\
OPENCLAW_BRAIN_DIR=/data/openclaw-brain,\
MESSAGING_PLATFORM=sms,\
TWILIO_USE_WHATSAPP=1,\
TWILIO_ALLOWED_NUMBER=+1XXXXXXXXXX" \
  --tags=http-server \
  --metadata=google-logging-enabled=true

# Open firewall for Twilio webhooks (port 8080)
gcloud compute firewall-rules create allow-openclaw-8080 \
  --project="$PROJECT_ID" \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:8080 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=http-server

# Get external IP
EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
  --zone="$ZONE" --project="$PROJECT_ID" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo "Webhook URL: http://$EXTERNAL_IP:8080/sms"

# Set secrets on the VM
gcloud compute instances add-metadata "$INSTANCE_NAME" --zone="$ZONE" \
  --metadata=\
TWILIO_ACCOUNT_SID=AC...,\
TWILIO_AUTH_TOKEN=...,\
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX,\
ANTHROPIC_API_KEY=sk-ant-...,\
GITHUB_TOKEN=ghp_...
```

Then set your Twilio webhook URL to `http://<EXTERNAL_IP>:8080/sms` in the Twilio console.

### Option 3: Deploy to Cloud Run

```bash
# Set your project ID and region
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1

# Build and push image
gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT_ID/openclaw/openclaw:latest .

# Create secrets in Secret Manager
echo -n "xoxb-YOUR-BOT-TOKEN" | gcloud secrets create SLACK_BOT_TOKEN --data-file=-
echo -n "xapp-YOUR-APP-TOKEN" | gcloud secrets create SLACK_APP_TOKEN --data-file=-
echo -n "sk-ant-YOUR-KEY" | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
echo -n "ghp_YOUR-TOKEN" | gcloud secrets create GITHUB_TOKEN --data-file=-

# Create service account with permissions
gcloud iam service-accounts create openclaw-runtime --display-name="OpenClaw Runtime"
SA_EMAIL="openclaw-runtime@$PROJECT_ID.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/storage.objectAdmin"

# Deploy
gcloud run deploy openclaw \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/openclaw/openclaw:latest \
  --region $REGION \
  --platform managed \
  --service-account $SA_EMAIL \
  --min-instances 1 \
  --set-env-vars="GCP_PROJECT_ID=$PROJECT_ID,GCP_REGION=$REGION,OPENCLAW_BRAIN_BUCKET=your-bucket-name" \
  --set-secrets="SLACK_BOT_TOKEN=SLACK_BOT_TOKEN:latest,SLACK_APP_TOKEN=SLACK_APP_TOKEN:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,GITHUB_TOKEN=GITHUB_TOKEN:latest"
```

## Messaging Platforms

OpenClaw supports two messaging platforms. Set `MESSAGING_PLATFORM` to choose:

### Slack (default)

```bash
MESSAGING_PLATFORM=slack  # or just omit — Slack is the default
```

Requires `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`. See [Prerequisites](#prerequisites).

### SMS / WhatsApp via Twilio

```bash
MESSAGING_PLATFORM=sms
```

For WhatsApp instead of plain SMS:

```bash
TWILIO_USE_WHATSAPP=1
```

**Twilio setup:**

1. Create a [Twilio account](https://www.twilio.com/) and get a phone number
2. Set the required env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
3. In the Twilio console, set your webhook URL to `http://<YOUR_IP>:8080/sms` (POST)
4. For WhatsApp, connect your number via the Twilio WhatsApp sandbox or Business API

**Phone allowlist:** Set `TWILIO_ALLOWED_NUMBER` to restrict access to a single phone number. If unset, any number can message the bot.

```bash
TWILIO_ALLOWED_NUMBER=+1XXXXXXXXXX
```

## Usage

### Dev Agent (Sandbox PR Creation)

Works the same on Slack, WhatsApp, and SMS:

**Slack:**
```
@OpenClaw
repo: your-org/your-repo
task: create a hello world react app with vite
```

**WhatsApp/SMS:**
```
repo: your-org/your-repo
task: create a hello world react app with vite
```

OpenClaw will:
1. Clone the repo
2. Create a branch
3. Use Claude to plan the implementation
4. Execute the plan (npm, node, git commands)
5. Commit and push
6. Open a pull request

If the task is ambiguous, OpenClaw enters **clarification mode** — it asks targeted questions before proceeding, then builds the PR once you reply.

### GitHub Commands

```bash
# Summarize a PR
summarize https://github.com/org/repo/pull/123

# Repo info
tell me about org/repo
```

### Brain (Memory) Commands

```bash
brain status
brain show
brain last error
brain reset
```

### Gmail Commands

```bash
# Check recent emails
email check

# Search emails
email search <query>

# Read a specific email by ID
email read <id>

# Send an email
email send user@email.com "Subject" Body text here
```

### GCP Commands (if configured)

```bash
gcp status
gcs ls your-bucket
gcs cat gs://bucket/path
cloudrun ls
```

### General

```bash
help
```

Or just ask a question — Claude will respond directly.

## Architecture

```
.
├── server.js              # Entry point — picks Slack or SMS mode
├── Dockerfile             # Container with local brain volume
└── src/
    ├── app.js             # Slack routing + handlers
    ├── sms.js             # SMS/WhatsApp routing (Twilio webhooks)
    ├── config.js          # Environment configuration
    ├── http.js            # Health check endpoint
    ├── clients/
    │   ├── anthropic.js   # Claude API client
    │   ├── openai.js      # OpenAI API client
    │   ├── github.js      # GitHub (Octokit) client
    │   ├── gcp.js         # GCP/GCS client
    │   ├── gmail.js       # Gmail API client (OAuth2)
    │   ├── twilio.js      # Twilio SMS/WhatsApp client
    │   └── llm.js         # LLM provider abstraction
    ├── brain/
    │   └── brain.js       # Local-first memory + async GCS backup
    ├── agent/
    │   ├── plan.js        # Claude planner + JSON extraction
    │   └── sandbox.js     # Sandbox execution engine
    ├── github/            # GitHub integrations (PRs, repos)
    └── util/              # Helpers (parsing, rate limiting, etc.)
```

### How the Sandbox Works

1. **Planning**: Claude receives repo context (file tree, README) and task, returns JSON plan with steps
2. **Execution**: Sandbox clones repo, creates branch, runs allowed commands (`git`, `npm`, `node`)
3. **Safety**: Command allowlist, no shell wrappers, no curl/wget, isolated environment
4. **PR**: Commits changes, pushes branch, opens PR via GitHub API

### Brain (Memory)

OpenClaw uses a **local-first** memory architecture (openclaw-brain):

- **Local filesystem primary** — All reads and writes go to the local disk first (`OPENCLAW_BRAIN_DIR`, defaults to `/tmp/openclaw-brain`). Reads are instant, no network latency.
- **Async GCS backup** — Every write is fire-and-forget backed up to Google Cloud Storage. If GCS is unavailable, local storage continues working.
- **Fallback on read** — If data isn't found locally (e.g., fresh VM), it's pulled from GCS and cached locally.
- **Brain prefix** defaults to `openclaw-brain` (configurable via `OPENCLAW_BRAIN_PREFIX`).

Memory types:
- **Thread memory**: Last repo, last task, last error (for debugging)
- **Repo memory**: Preferences, last touched timestamp
- **Global summary**: Cross-conversation memory of completed tasks
- **Error tracking**: Full error context with logs and Claude snippets

## Environment Variables

See [`.env.example`](.env.example) for all configuration options.

### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `GITHUB_TOKEN` | GitHub personal access token |

Plus one of the messaging platform sets:

**Slack:**
| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Slack bot user OAuth token |
| `SLACK_APP_TOKEN` | Slack app-level token (Socket Mode) |

**SMS/WhatsApp:**
| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number (e.g., `+1XXXXXXXXXX`) |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `MESSAGING_PLATFORM` | `slack` or `sms` | `slack` |
| `ANTHROPIC_MODEL` | Claude model to use | `claude-opus-4-6` |
| `TWILIO_ALLOWED_NUMBER` | Restrict SMS/WhatsApp to this number | *(any)* |
| `TWILIO_USE_WHATSAPP` | Set to `1` for WhatsApp mode | `0` |
| `GCP_PROJECT_ID` | Google Cloud project (for GCS backup) | |
| `GCP_REGION` | GCP region | `us-central1` |
| `OPENCLAW_BRAIN_BUCKET` | GCS bucket for brain backup | |
| `OPENCLAW_BRAIN_PREFIX` | GCS object prefix | `openclaw-brain` |
| `OPENCLAW_BRAIN_DIR` | Local brain storage directory | `/tmp/openclaw-brain` |
| `OPENCLAW_RUN_TESTS` | Set to `1` to run verify commands | `0` |
| `GMAIL_CLIENT_ID` | Gmail OAuth2 client ID | |
| `GMAIL_CLIENT_SECRET` | Gmail OAuth2 client secret | |
| `GMAIL_REFRESH_TOKEN` | Gmail OAuth2 refresh token | |
| `GMAIL_USER_EMAIL` | Gmail sender email address | |

## Security

- **Sandbox isolation**: Only `git`, `npm`, `node` allowed; no shell access
- **Command filtering**: Blocks `bash -c`, `curl`, `wget`, `ssh`, etc.
- **Secrets management**: Uses Secret Manager (Cloud Run) or Keychain (local)
- **Hardened container**: Non-root user, read-only filesystem, dropped capabilities
- **Rate limiting**: 6 requests per 30 seconds per user
- **Phone allowlist**: Restrict SMS/WhatsApp access to a single number via `TWILIO_ALLOWED_NUMBER`

## Development

```bash
# Install dependencies
npm install

# Run locally (requires env vars)
node server.js

# Lint
npm run lint  # (if you add a lint script)

# Test
npm test  # (if you add tests)
```

## Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### "Brain: disabled"

Brain requires:
- `GCP_PROJECT_ID` set
- Service account with `roles/storage.objectAdmin` on the bucket
- Valid `OPENCLAW_BRAIN_BUCKET`

Note: Brain always works locally even without GCS. "Disabled" means GCS backup is off, not that memory is unavailable.

### "Claude plan JSON parse failed"

- Check logs with `brain last error`
- Verify `ANTHROPIC_API_KEY` is valid
- Ensure `max_tokens` is sufficient (currently 4096)

### Slow responses (30-60s)

Cloud Run cold starts. Fix:
```bash
gcloud run services update openclaw --region REGION --min-instances 1
```

Or switch to GCE (Option 2) — always-on VM, no cold starts.

### Container fails to start

Check logs:
```bash
# GCE
gcloud compute instances get-serial-port-output INSTANCE_NAME --zone=ZONE

# Cloud Run
gcloud run services logs read openclaw --region REGION --limit=50

# Local
podman logs openclaw
```

### WhatsApp/SMS not receiving messages

- Verify your Twilio webhook URL is set to `http://<EXTERNAL_IP>:8080/sms` (POST method)
- Check that `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` are set
- Ensure the firewall allows inbound traffic on port 8080
- If using `TWILIO_ALLOWED_NUMBER`, confirm the number matches your phone (country code included)

### WhatsApp messages not sending

- Confirm `TWILIO_USE_WHATSAPP=1` is set
- For sandbox testing, join the Twilio WhatsApp sandbox first
- Check Twilio console logs for delivery errors

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Built with:
- [@slack/bolt](https://github.com/slackapi/bolt-js) - Slack SDK
- [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) - Claude API
- [@octokit/rest](https://github.com/octokit/rest.js) - GitHub API
- [@google-cloud/storage](https://github.com/googleapis/nodejs-storage) - GCS client
- [twilio](https://github.com/twilio/twilio-node) - Twilio SMS/WhatsApp
- [googleapis](https://github.com/googleapis/google-api-nodejs-client) - Gmail API

---

**Note**: OpenClaw executes code in a sandboxed environment based on AI-generated plans. Review all PRs before merging.
