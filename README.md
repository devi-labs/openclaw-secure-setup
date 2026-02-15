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

---

## Prereqs

### 1) Install Podman on macOS
If `podman` isn’t found, it’s commonly installed at `/opt/podman/bin/podman`. Add it to your PATH:

```bash
echo 'export PATH="/opt/podman/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
podman --version

