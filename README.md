# OpenClaw Secure Setup

**AI-powered development agent that creates PRs from Slack or WhatsApp**

Describe a task in plain language. OpenClaw clones your repo, plans the changes with Claude, executes them in a sandbox, and opens a pull request — all from a text message or Slack.

## What It Does

- 🤖 **Describe a task → get a PR** — No IDE needed
- 📱 **Works via Slack, WhatsApp, or SMS** — Your choice
- 📧 **Gmail access** — Check, search, read, and send emails
- 🧠 **Remembers context** — Conversation history and repo knowledge persist across messages
- 🔒 **Secure sandbox** — Dangerous commands are blocked, everything else runs freely
- ☁️ **Runs on a GCE VM or locally** — Always on, no cold starts

---

## Prerequisites — Get Your Keys

Before you start, you'll need a few API keys. Here's exactly where to get each one:

### 1. Anthropic API Key (required)

This powers Claude, the AI that plans and writes code.

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Click **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-`)

### 2. GitHub Personal Access Token (optional — needed for PRs)

This lets OpenClaw push branches and create pull requests.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token (classic)**
3. Name it `openclaw`
4. Check the **`repo`** scope
5. Click **Generate token** → copy it (starts with `ghp_`)

### 3. Twilio Account (optional — needed for WhatsApp/SMS)

WhatsApp via Twilio Sandbox is the easiest way to text with OpenClaw. No carrier registration or phone number purchase needed.

1. Sign up at [twilio.com/try-twilio](https://www.twilio.com/try-twilio) (free)
2. From the [Console dashboard](https://console.twilio.com/), copy your **Account SID** and **Auth Token**
3. Go to **Messaging → Try it out → Send a WhatsApp message**
4. Follow the instructions to join the sandbox (send the join code from your WhatsApp)
5. Note the **sandbox phone number** (e.g. `+14155238886`)

### 4. Gmail OAuth2 (optional — needed for email commands)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create or select a project
2. Enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
3. Go to **APIs & Services → OAuth consent screen** → set to **External**, add your email as a test user
4. Go to **APIs & Services → Credentials** → **Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Add redirect URI: `https://developers.google.com/oauthplayground`
5. Copy the **Client ID** and **Client Secret**
6. Go to [OAuth Playground](https://developers.google.com/oauthplayground/)
   - ⚙️ Settings → check **"Use your own OAuth credentials"** → paste Client ID and Secret
   - Step 1: select `https://mail.google.com/` → **Authorize APIs** → sign in
   - Step 2: **Exchange authorization code for tokens** → copy the **Refresh Token**

---

## Setup

```bash
git clone https://github.com/devi-labs/openclaw-secure-setup.git
cd openclaw-secure-setup
npm install
cp .env.example .env
```

Edit `.env` and fill in the keys you gathered above. At minimum you need:

```
MESSAGING_PLATFORM=sms
TWILIO_USE_WHATSAPP=1
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+14155238886
TWILIO_ALLOWED_NUMBER=+1XXXXXXXXXX
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Deploy — Option A: GCE VM (Recommended)

Always-on cloud VM. Best for production use.

### 1. Build and deploy

```bash
bash deploy-gce.sh .env
```

This reads your GCP project from `.env`, builds the container, pushes it to Artifact Registry, creates a VM with a static IP, and opens port 8080.

### 2. Apply your config

```bash
bash setup.sh .env
```

The setup script reads your `.env`, prompts for any missing values, and applies everything to the VM container. No giant one-liner needed.

### 3. Set your Twilio webhook

In the [Twilio Console](https://console.twilio.com/) → **Messaging → WhatsApp sandbox settings**, set the webhook URL to:

```
http://<YOUR-STATIC-IP>:8080/sms
```

Method: **POST**

### 4. Test it

Send a WhatsApp message to the sandbox number:

```
help
```

### SSH into your VM

```bash
gcloud compute ssh openclaw-vm --zone=us-central1-a --tunnel-through-iap
```

### Check container logs

```bash
gcloud compute ssh openclaw-vm --zone=us-central1-a --tunnel-through-iap -- "docker logs \$(docker ps -q) --tail 50"
```

---

## Deploy — Option B: Podman/Docker (Local)

Run on your own machine. Good for development and testing.

### 1. Build the container

```bash
podman build -t openclaw:local .
```

### 2. Run it

```bash
podman run -d \
  --name openclaw \
  --restart=always \
  --env-file .env \
  -p 8080:8080 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 256 \
  --memory 512m \
  --cpus 1 \
  openclaw:local
```

### 3. Set your Twilio webhook

For local development, use a tunnel to expose port 8080:

```bash
# Using ngrok:
ngrok http 8080

# Or using cloudflared:
cloudflared tunnel --url http://localhost:8080
```

Then set the tunnel URL as your Twilio webhook: `https://<tunnel-url>/sms` (POST)

### View logs

```bash
podman logs -f openclaw
```

### Restart after changes

```bash
podman rm -f openclaw
podman build -t openclaw:local .
podman run -d --name openclaw --env-file .env -p 8080:8080 openclaw:local
```

---

## Choose Your Messaging Platform

Set `MESSAGING_PLATFORM` in your `.env`:

| Platform | Setting | You'll Need |
|----------|---------|-------------|
| **WhatsApp** (easiest) | `MESSAGING_PLATFORM=sms` + `TWILIO_USE_WHATSAPP=1` | Free Twilio account |
| **SMS** | `MESSAGING_PLATFORM=sms` | Twilio account + A2P 10DLC registration (US) |
| **Slack** | `MESSAGING_PLATFORM=slack` | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` |

> **Tip:** WhatsApp via the Twilio Sandbox is the fastest way to get started — no phone number purchase, no carrier registration.

To restrict access to a single phone number:

```
TWILIO_ALLOWED_NUMBER=+1XXXXXXXXXX
```

This is your personal WhatsApp number (the one you text *from*), not the Twilio sandbox number.

---

## Usage

### Create a PR

Send this as a single WhatsApp/Slack message:

```
repo: your-org/your-repo
task: add a health check endpoint to the express server
```

OpenClaw clones the repo, plans the work, runs the commands, and opens a PR.

### Commands

| Command | What it does |
|---------|-------------|
| `help` | Show available commands |
| `repos` | List indexed repos |
| `tell me about owner/repo` | Summarize a GitHub repo |
| `summarize https://github.com/.../pull/123` | Summarize a PR |
| `brain status` | Check memory status |
| `brain show` | Show what OpenClaw remembers |
| `brain reset` | Clear memory |
| `email check` | Show recent emails |
| `email search invoices` | Search your inbox |
| `email send user@email.com "Subject" Body` | Send an email |

Or just ask a question — Claude responds directly with conversation history.

---

## Environment Variables

See [`.env.example`](.env.example) for the full list with comments. Here are the essentials:

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `ANTHROPIC_API_KEY` | ✅ | [console.anthropic.com](https://console.anthropic.com/) → API Keys |
| `GITHUB_TOKEN` | For PRs | [github.com/settings/tokens](https://github.com/settings/tokens) → `repo` scope |
| `MESSAGING_PLATFORM` | | `slack` or `sms` (default: `slack`) |
| `TWILIO_ACCOUNT_SID` | For WhatsApp/SMS | [Twilio Console](https://console.twilio.com/) dashboard |
| `TWILIO_AUTH_TOKEN` | For WhatsApp/SMS | [Twilio Console](https://console.twilio.com/) dashboard |
| `TWILIO_PHONE_NUMBER` | For WhatsApp/SMS | Twilio sandbox number |
| `TWILIO_ALLOWED_NUMBER` | | Your personal phone number with country code |
| `TWILIO_USE_WHATSAPP` | | Set to `1` for WhatsApp |
| `GMAIL_CLIENT_ID` | For email | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `GMAIL_CLIENT_SECRET` | For email | Same as above |
| `GMAIL_REFRESH_TOKEN` | For email | [OAuth Playground](https://developers.google.com/oauthplayground/) |
| `GMAIL_USER_EMAIL` | For email | Your Gmail address |
| `OPENCLAW_REPOS` | | Comma-separated repos to index at startup |

---

## Security

- Dangerous commands are denied (`rm`, `sudo`, `curl`, `wget`, `ssh`, `docker`, etc.)
- Non-root container with read-only filesystem
- Rate limiting (6 requests per 30 seconds per user)
- Phone number allowlist for SMS/WhatsApp
- Secrets stay in env vars or Secret Manager — never exposed to the LLM

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Container keeps restarting | Check logs: `docker logs $(docker ps -aq --latest) --tail 50` |
| Brain says "disabled" | GCS backup is off — memory still works locally. Set `OPENCLAW_BRAIN_BUCKET` for backup. |
| Claude plan JSON parse failed | Run `brain last error` to see what happened. Check your API key. |
| WhatsApp not receiving | Check Twilio webhook URL is `http://<IP>:8080/sms` (POST). Check firewall allows port 8080. |
| Unauthorized number rejected | Make sure `TWILIO_ALLOWED_NUMBER` matches your phone with country code (e.g., `+1`). |
| External IP changed | Reserve a static IP. The deploy script does this automatically for new VMs. |
| `Blocked command from plan` | The sandbox denylist blocked a command. Check `src/util/proc.js` to adjust. |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome.

## License

MIT — see [LICENSE](LICENSE).

## Credits

See [CREDITS.md](CREDITS.md).

---

⚠️ **OpenClaw executes code based on AI-generated plans. Always review PRs before merging.**
