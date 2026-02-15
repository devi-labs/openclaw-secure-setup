# Secure Local Setup: OpenClaw (Slack Socket Mode) with Podman + macOS Keychain

This repo documents a security-forward way to run **OpenClaw** locally as a long-running **Slack bot** using:

- **Podman** (sandboxed containers on macOS via a Podman VM)
- **Slack Socket Mode** (no public inbound webhook required)
- **macOS Keychain** (secrets stored securely, not in `.env`)

## Why this setup

- **No public endpoint:** Socket Mode opens an outbound connection to Slack.
- **No plaintext secrets in repo:** tokens live in Keychain.
- **Hardened container runtime:** non-root, read-only FS, dropped capabilities, no-new-privileges.
- **Always-on:** container restarts automatically.

## Why Podman instead of Docker

For a local bot that holds API keys and talks to Slack/GitHub, reducing privilege and attack surface matters:

- **Rootless by default:** Podman runs containers as your user; there is no root-owned daemon. Docker Desktop runs a privileged daemon (and on macOS, a VM) with broad access to the host.
- **Daemonless:** No long-running privileged process. With Docker, `dockerd` is a high-value target; with Podman, `podman run` starts the container and the parent process is your shell.
- **Smaller trust boundary on macOS:** Podman uses a minimal Linux VM (e.g. Lima-based) to run OCI containers. You avoid the extra surface of Docker Desktop’s daemon and its default permissions.
- **Same Dockerfile, no Docker required:** Podman builds from the same Dockerfile and respects `.dockerignore`. You never need to install Docker; the image is built with `podman build`.

So: same image format and workflow, less privileged runtime.

---

## Prereqs

- **Podman** on macOS (e.g. `brew install podman` or install from [podman.io](https://podman.io)). If `podman` isn’t in your PATH, it may be under `/opt/podman/bin`:

  ```bash
  echo 'export PATH="/opt/podman/bin:$PATH"' >> ~/.zprofile
  source ~/.zprofile
  podman --version
  ```

---

## 1) Store secrets in macOS Keychain

Do not put tokens in the repo or in `.env`. Store them in Keychain so `run-openclaw.sh` can read them at runtime:

```bash
# Slack (from your Slack app config: Basic Information → App-Level Tokens, OAuth & Permissions)
security add-generic-password -a "$USER" -s "openclaw/SLACK_BOT_TOKEN"    -w "xoxb-..."
security add-generic-password -a "$USER" -s "openclaw/SLACK_APP_TOKEN"    -w "xapp-..."

# Optional: Anthropic and GitHub (for /summarize and repo features)
security add-generic-password -a "$USER" -s "openclaw/ANTHROPIC_API_KEY"  -w "sk-ant-..."
security add-generic-password -a "$USER" -s "openclaw/GITHUB_TOKEN"       -w "ghp_..."
```

Use the same account name as `$USER` when you run `run-openclaw.sh`.

---

## 2) Build the image

From the repo root:

```bash
podman build -t openclaw:local .
```

---

## 3) Run the container

```bash
./run-openclaw.sh
```

This script reads the four secrets from Keychain, removes any existing `openclaw` container, and starts a new one with the hardened options (read-only root, dropped capabilities, resource limits). The container is named `openclaw` and set to `--restart=always`.

To view logs:

```bash
podman logs -f openclaw
```

To stop:

```bash
podman stop openclaw
```
