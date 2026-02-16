# OpenClaw

**AI-powered development agent that creates PRs from Slack**

OpenClaw is a Slack bot that uses Claude (Anthropic) to plan and execute code changes in a sandboxed environment, then opens pull requests on GitHub. Built for fast iteration with a focus on security and reliability.

## Features

- 🤖 **Autonomous dev agent** - Describe a task in Slack, get a PR
- 🧠 **Stateful brain** - Remembers context across conversations (GCS-backed)
- 📊 **GitHub integration** - Summarize PRs, explore repos, open PRs
- 🔒 **Secure sandbox** - Runs git/npm/node in isolated containers
- ☁️ **Cloud Run ready** - Deploys to GCP with ADC + Secret Manager
- 🏠 **Local option** - Run with Podman + macOS Keychain

## Quick Start

### Prerequisites

1. **Slack App** with Socket Mode enabled
   - Bot Token Scopes: `app_mentions:read`, `chat:write`, `channels:history`
   - App-Level Token with `connections:write` scope
2. **Anthropic API Key** (for Claude)
3. **GitHub Personal Access Token** with `repo` scope
4. **Google Cloud Project** (optional, for brain/GCS features)

### Option 1: Deploy to Cloud Run

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

### Option 2: Run Locally with Podman

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

## Usage

### Dev Agent (Sandbox PR Creation)

```
@OpenClaw
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

### Other Commands

```bash
# GitHub
@OpenClaw summarize https://github.com/org/repo/pull/123
@OpenClaw tell me about org/repo

# Brain (memory)
@OpenClaw brain status
@OpenClaw brain show
@OpenClaw brain last error
@OpenClaw brain reset

# GCP (if configured)
@OpenClaw gcp status
@OpenClaw gcs ls your-bucket
@OpenClaw gcs cat gs://bucket/path
@OpenClaw cloudrun ls

# General
@OpenClaw help
```

## Architecture

```
.
├── server.js              # Entry point (32 lines)
└── src/
    ├── app.js             # Slack routing + handlers
    ├── config.js          # Environment configuration
    ├── http.js            # Health check endpoint
    ├── clients/           # API clients (Anthropic, GitHub, GCP)
    ├── brain/             # GCS-backed state management
    ├── agent/
    │   ├── plan.js        # Claude planner + JSON extraction
    │   └── sandbox.js     # Sandbox execution engine
    ├── github/            # GitHub integrations
    └── util/              # Helpers (parsing, rate limiting, etc.)
```

### How the Sandbox Works

1. **Planning**: Claude receives repo context (file tree, README) and task, returns JSON plan with steps
2. **Execution**: Sandbox clones repo, creates branch, runs allowed commands (`git`, `npm`, `node`)
3. **Safety**: Command allowlist, no shell wrappers, no curl/wget, isolated environment
4. **PR**: Commits changes, pushes branch, opens PR via GitHub API

### Brain (Memory)

OpenClaw stores per-thread and per-repo state in Google Cloud Storage:

- **Thread memory**: Last repo, last task, last error (for debugging)
- **Repo memory**: Preferences, last touched timestamp
- **Error tracking**: Full error context with logs and Claude snippets

## Environment Variables

See [`.env.example`](.env.example) for all configuration options.

Required:
- `SLACK_BOT_TOKEN` - Slack bot user OAuth token
- `SLACK_APP_TOKEN` - Slack app-level token (Socket Mode)
- `ANTHROPIC_API_KEY` - Claude API key
- `GITHUB_TOKEN` - GitHub personal access token

Optional:
- `GCP_PROJECT_ID` - Google Cloud project (for brain/GCS)
- `GCP_REGION` - GCP region (default: `us-central1`)
- `OPENCLAW_BRAIN_BUCKET` - GCS bucket for state storage
- `OPENCLAW_RUN_TESTS` - Set to `1` to run verify commands (default: `0`)

## Security

- **Sandbox isolation**: Only `git`, `npm`, `node` allowed; no shell access
- **Command filtering**: Blocks `bash -c`, `curl`, `wget`, `ssh`, etc.
- **Secrets management**: Uses Secret Manager (Cloud Run) or Keychain (local)
- **Hardened container**: Non-root user, read-only filesystem, dropped capabilities
- **Rate limiting**: 6 requests per 30 seconds per user

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

### "Claude plan JSON parse failed"

- Check logs with `@OpenClaw brain last error`
- Verify `ANTHROPIC_API_KEY` is valid
- Ensure `max_tokens` is sufficient (currently 4096)

### Slow responses (30-60s)

Cloud Run cold starts. Fix:
```bash
gcloud run services update openclaw --region REGION --min-instances 1
```

### Container fails to start

Check logs:
```bash
# Cloud Run
gcloud run services logs read openclaw --region REGION --limit=50

# Local
podman logs openclaw
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

Built with:
- [@slack/bolt](https://github.com/slackapi/bolt-js) - Slack SDK
- [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) - Claude API
- [@octokit/rest](https://github.com/octokit/rest.js) - GitHub API
- [@google-cloud/storage](https://github.com/googleapis/nodejs-storage) - GCS client

---

**Note**: OpenClaw executes code in a sandboxed environment based on AI-generated plans. Review all PRs before merging.
