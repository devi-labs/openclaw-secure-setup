# OpenClaw

**Your personal AI coding assistant — talk to it on Telegram, and it writes code for you.**

You describe what you want in plain English. OpenClaw figures out the code changes, makes them, and opens a pull request on GitHub — all from a Telegram chat.

No coding experience needed to get it running. This guide walks you through every step.

---

## What Can It Do?

- 🤖 **Write code for you** — Describe a task, get a GitHub pull request
- 💬 **Chat on Telegram** — Just text it like you would a friend
- 📧 **Manage your email** — Check, search, and send emails through Gmail
- 📅 **Manage your calendar** — View, create, and update events
- 🧠 **Remembers your conversations** — Picks up where you left off
- 🔒 **Safe** — Runs in a locked-down sandbox so it can't do anything dangerous

---

## Before You Start

You'll need to sign up for a few free services and grab some keys. Think of these like passwords that let OpenClaw talk to other services on your behalf.

**Don't worry — you only need to do this once.**

### Step 1: Create a Telegram Bot (required)

This is the bot you'll chat with on Telegram.

1. Open Telegram and search for **@BotFather** (it has a blue checkmark)
2. Send it the message: `/newbot`
3. BotFather will ask you for a **name** (e.g. `My OpenClaw`) and a **username** (e.g. `my_openclaw_bot`)
4. It will reply with a **token** that looks like `123456789:ABCdefGHI-jklMNOpqr` — **copy this and save it somewhere safe**

> 💡 This token is secret. Don't share it with anyone.

### Step 2: Get an Anthropic API Key (required)

This connects OpenClaw to Claude, the AI that does the thinking and coding.

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Create an account (or sign in)
3. Click **API Keys** in the sidebar
4. Click **Create Key**
5. Copy the key — it starts with `sk-ant-`

> 💡 Anthropic gives you some free credits to start. After that, usage is pay-as-you-go (typically a few cents per task).

### Step 3: Get a GitHub Token (optional — needed to create pull requests)

This lets OpenClaw push code to your GitHub repositories.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token (classic)**
3. Give it a name like `openclaw`
4. Under **Select scopes**, check the box next to **`repo`**
5. Scroll down and click **Generate token**
6. Copy the token — it starts with `ghp_`

> 💡 If you skip this step, you can still chat with OpenClaw and ask it questions — it just won't be able to create pull requests.

### Step 4: Set a Joining Code (optional — recommended)

You can set a secret code that people must send before the bot will talk to them. This keeps strangers from using your bot.

You'll set this in your configuration file later — just pick a word or phrase now and remember it.

---

## Installation

You'll need to use the **Terminal** (Mac/Linux) or **Command Prompt** (Windows) for these steps. Don't worry — just copy and paste each line.

### 1. Install Node.js

Node.js is what runs OpenClaw. Check if you already have it:

```bash
node --version
```

If you see a version number (like `v20.x.x`), you're good. If not:

- **Mac**: Go to [nodejs.org](https://nodejs.org/), download the LTS version, and run the installer
- **Windows**: Same — download from [nodejs.org](https://nodejs.org/) and run the installer
- **Linux**: Run `sudo apt install nodejs npm` (Ubuntu/Debian) or `sudo dnf install nodejs` (Fedora)

### 2. Download OpenClaw

```bash
git clone https://github.com/devi-labs/openclaw-secure-setup.git
cd openclaw-secure-setup
npm install
```

> 💡 If `git` isn't installed, download it from [git-scm.com](https://git-scm.com/).

### 3. Set Up Your Configuration

```bash
cp .env.example .env
```

Now open the `.env` file in any text editor (Notepad, TextEdit, VS Code — anything works).

Find these lines and fill in the values you got earlier:

```
TELEGRAM_BOT_TOKEN=paste-your-telegram-token-here
ANTHROPIC_API_KEY=paste-your-anthropic-key-here
```

If you have a GitHub token, add it too:

```
GITHUB_TOKEN=paste-your-github-token-here
```

If you want a joining code (recommended), add:

```
TELEGRAM_JOIN_CODE=your-secret-code-here
```

Save the file.

### 4. Start OpenClaw

```bash
node server.js
```

You should see something like:

```
Starting OpenClaw...
⚡️ OpenClaw Telegram server running on port 8080 (polling mode)
Claude: enabled | GitHub: enabled | Brain: enabled | Allowed users: (any)
```

**That's it!** Open Telegram, find your bot, and send it a message.

> 💡 If you set a joining code, you'll need to send that code first before the bot responds.

---

## How to Use It

Open your bot in Telegram and start chatting. Here are some things you can do:

### Ask it to write code

Send a message like this:

```
repo: your-username/your-repo
task: add a health check endpoint to the express server
```

OpenClaw will clone your repo, write the code, and open a pull request. It sends you progress updates along the way.

### Ask it questions

Just type a question like you're texting a friend:

```
What's the difference between let and const in JavaScript?
```

### Check your email

```
email check
```

### Quick reference

| What to type | What it does |
|---|---|
| `help` | Show all commands |
| `repo: owner/repo` + `task: do something` | Create a pull request |
| `tell me about owner/repo` | Get a summary of a GitHub repo |
| `summarize https://github.com/.../pull/123` | Summarize a pull request |
| `email check` | Show recent emails |
| `email search invoices` | Search your inbox |
| `email send user@email.com "Subject" Body` | Send an email |
| `cal` | Show today's calendar events |
| `brain status` | Check if memory is working |
| `brain reset` | Clear conversation memory |
| `self destruct` | Shut down the VM |

---

## Keeping It Running 24/7

When you close your terminal, OpenClaw stops. If you want it running all the time, you have two options:

### Option A: Run in the Cloud (Recommended)

This puts OpenClaw on a Google Cloud VM that's always on. You'll need a [Google Cloud account](https://cloud.google.com/) (free tier available).

```bash
bash deploy-gce.sh .env
```

Then apply your settings:

```bash
bash setup.sh .env
```

The script handles everything — building, deploying, setting up a static IP, and opening the right ports.

### Option B: Run Locally with Docker

If you have [Docker](https://docs.docker.com/get-docker/) or [Podman](https://podman.io/) installed:

```bash
docker build -t openclaw:local .
docker run -d --name openclaw --restart=always --env-file .env -p 8080:8080 openclaw:local
```

This keeps it running in the background, even if you close your terminal. It auto-restarts if your computer reboots.

To check if it's running:

```bash
docker logs -f openclaw
```

To stop it:

```bash
docker rm -f openclaw
```

---

## Setting Up Gmail (Optional)

If you want OpenClaw to check and send emails for you, this takes about 10 minutes:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project (or select an existing one)
2. Search for **Gmail API** in the search bar and click **Enable**
3. Go to **APIs & Services → OAuth consent screen**
   - Choose **External**
   - Fill in the app name (anything — e.g. "OpenClaw")
   - Add your email as a **test user**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Under **Authorized redirect URIs**, add: `https://developers.google.com/oauthplayground`
   - Click **Create** and copy the **Client ID** and **Client Secret**
5. Go to [OAuth Playground](https://developers.google.com/oauthplayground/)
   - Click the ⚙️ gear icon → check **"Use your own OAuth credentials"** → paste your Client ID and Secret
   - In the left panel, find and select `https://mail.google.com/`
   - Click **Authorize APIs** → sign in with your Google account
   - Click **Exchange authorization code for tokens** → copy the **Refresh Token**

Add all four values to your `.env` file:

```
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token
GMAIL_USER_EMAIL=you@gmail.com
```

Restart OpenClaw and you're good to go.

---

## Something Not Working?

| What's happening | What to do |
|---|---|
| Bot doesn't respond at all | Make sure `node server.js` is running and check for errors in the terminal |
| Bot says "Please send the joining code" | Send the code you set in `TELEGRAM_JOIN_CODE` |
| "ANTHROPIC_API_KEY missing" | Make sure you added your Anthropic key to the `.env` file |
| "GITHUB_TOKEN missing" | Add your GitHub token to `.env` (needed for creating PRs) |
| PR creation fails | Send `brain last error` to see what went wrong |
| Bot is slow to respond | Claude is thinking — complex tasks can take 30–60 seconds |
| Container keeps restarting | Check logs: `docker logs openclaw --tail 50` |

---

## Security

OpenClaw is designed to be safe:

- **Dangerous commands are blocked** — It can't delete files, download things, or access your system
- **Sandboxed** — Code runs in an isolated container with no special permissions
- **Rate limited** — Max 6 requests per 30 seconds per user to prevent abuse
- **Access control** — Use a joining code and/or user ID allowlist to restrict who can use it
- **Secrets are protected** — Your API keys are never exposed to the AI

---

## Contributing

Want to help improve OpenClaw? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

## Credits

See [CREDITS.md](CREDITS.md).

---

⚠️ **OpenClaw writes code using AI. Always review pull requests before merging them into your project.**
