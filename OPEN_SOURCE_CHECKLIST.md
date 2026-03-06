# Open Source Release Checklist

Before publishing to GitHub, verify:

## ✅ Code Cleanup

- [x] No hardcoded project IDs, bucket names, or service accounts
- [x] No user-specific emails or usernames
- [x] All examples use placeholder values
- [x] `.gitignore` covers secrets and local files
- [x] `.env.example` has generic values only
- [x] `deploy.sh` is gitignored

## ✅ Documentation

- [x] README.md — comprehensive setup guide (Slack, WhatsApp/SMS, Gmail, GCE)
- [x] CONTRIBUTING.md — contributor guidelines
- [x] LICENSE — MIT license
- [x] Issue templates — bug report & feature request

## ✅ Security

- [x] No secrets in code or config
- [x] Dockerfile uses non-root user
- [x] Command allowlist (git, npm, node only)
- [x] Rate limiting enabled
- [x] Secrets via Secret Manager or Keychain
- [x] Phone number allowlist for SMS/WhatsApp
- [x] Unauthorized numbers receive "Not authorized" reply

## ✅ Testing

- [x] Unit tests for parse utilities (14 tests)
- [x] Unit tests for JSON plan extraction/repair (7 tests)
- [x] Unit tests for brain local storage, CRUD, summary cap (11 tests)
- [x] Unit tests for phone matching and allowlist logic (11 tests)
- [x] All 56 tests passing via `npm test`

## ✅ Features Documented

- [x] Slack integration
- [x] WhatsApp/SMS via Twilio
- [x] Gmail integration (check, search, read, send)
- [x] Local-first memory with GCS backup
- [x] Clarification mode (only when truly confused)
- [x] Configurable LLM model via env var
- [x] GCE deployment (preferred, always-on)
- [x] Cloud Run deployment (alternative)
- [x] Local Podman deployment

## 🔲 Before Publishing

- [ ] Review all diffs: `git diff`
- [ ] Stage relevant files: `git add <files>`
- [ ] Commit: `git commit -m "v2.0: WhatsApp, Gmail, local brain, GCE deploy, tests"`
- [ ] Push: `git push origin main`
- [ ] Update repo description: "AI-powered dev agent — PRs from Slack or WhatsApp"
- [ ] Add topics: `slack-bot`, `whatsapp-bot`, `ai-agent`, `claude`, `github-automation`
- [ ] Enable Issues and Discussions

## 🔲 Post-Publishing

- [ ] Add badges to README: build status, license, tests
- [ ] Share announcement
- [ ] Monitor issues and respond to questions
- [ ] Add examples of PRs created by OpenClaw

---

**Ready to publish!** All code, docs, and tests are in order. 🚀
