# Contributing to OpenClaw

Thanks for your interest in contributing! This doc covers how to get set up and guidelines for contributions.

## Development Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR-USERNAME/openclaw.git
cd openclaw
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required for local dev:
- `SLACK_BOT_TOKEN` - Get from your Slack app settings
- `SLACK_APP_TOKEN` - App-level token for Socket Mode
- `ANTHROPIC_API_KEY` - Claude API key
- `GITHUB_TOKEN` - Personal access token with `repo` scope

### 3. Run locally

```bash
node server.js
```

You should see:
```
⚡️ OpenClaw Slack bot running (Socket Mode)
Claude: enabled | GitHub: enabled | ...
```

### 4. Test in Slack

In a Slack channel where your app is installed:
```
@YourBotName help
```

## Project Structure

```
.
├── server.js              # Entry point
└── src/
    ├── app.js             # Main Slack event handler
    ├── config.js          # Environment config
    ├── http.js            # Health check server
    ├── clients/           # API client factories
    ├── brain/             # State management (GCS)
    ├── agent/             # Sandbox planner & executor
    ├── github/            # GitHub integrations
    └── util/              # Helpers
```

## Code Style

- Use `'use strict';` at the top of all modules
- Prefer `async/await` over promises
- Use CommonJS (`require`/`module.exports`) for consistency
- Keep functions focused (one job per function)
- Add comments for non-obvious logic
- Use descriptive variable names

## Pull Request Guidelines

1. **One feature per PR** - Keep changes focused
2. **Test locally first** - Ensure the bot starts and responds
3. **Update README** if adding user-facing features
4. **No secrets in code** - Use env vars, never hardcode tokens
5. **Check for smart quotes** - Use regular quotes/apostrophes only

## Testing

Currently there are no automated tests. When adding new features:

1. Test manually in Slack
2. Check error handling with `@OpenClaw brain last error`
3. Verify logs with `podman logs openclaw` or `gcloud run services logs read openclaw`

## Adding New Commands

To add a new Slack command:

1. Add the handler in `src/app.js` in the `app.event('app_mention')` block
2. Keep the handler concise; extract complex logic to separate modules
3. Update help text in `helpText()` function
4. Add error handling and brain error recording

Example:

```javascript
if (lower.startsWith('my command')) {
  try {
    // Your logic here
    await say({ text: 'Response', ...reply });
    return;
  } catch (e) {
    console.error('My command error:', e?.message || e);
    await brain.recordThreadError(threadKey, { 
      lastError: e?.message, 
      lastErrorContext: 'mycommand' 
    });
    await say({ text: `Error: ${e?.message}`, ...reply });
    return;
  }
}
```

## Adding New Sandbox Commands

To allow a new command in the sandbox (e.g., `python`, `pip`):

1. Add to the allowlist in `src/util/proc.js`:
   ```javascript
   const allow = new Set(['git', 'npm', 'node', 'python', 'pip']);
   ```

2. Update the blocked patterns if needed (e.g., block `python -c` with shell injection)

3. Update the planner prompt in `src/agent/plan.js` to mention the new commands

4. Test thoroughly to ensure no security issues

## Security Considerations

When contributing, please ensure:

- **No arbitrary command execution** - Only allow safe, audited commands
- **Input sanitization** - Don't trust user input in commands/prompts
- **Secret protection** - Never log or expose tokens
- **Sandbox isolation** - Keep the sandbox locked down (no network exfil)
- **Rate limiting** - Prevent abuse

## Questions?

Open an issue or discussion on GitHub. We're happy to help!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
