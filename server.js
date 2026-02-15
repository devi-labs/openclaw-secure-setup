'use strict';

const { App } = require('@slack/bolt');
const express = require('express');

const Anthropic = require('@anthropic-ai/sdk');
const { Octokit } = require('@octokit/rest');

// ---- Slack App (Socket Mode) ----
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,     // xoxb-...
  appToken: process.env.SLACK_APP_TOKEN,  // xapp-...
  socketMode: true,
});

// ---- Optional integrations ----
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const octokit = process.env.GITHUB_TOKEN
  ? new Octokit({ auth: process.env.GITHUB_TOKEN })
  : null;

// ---- Health endpoint (nice for ops) ----
const health = express();
health.get('/healthz', (_, res) => res.status(200).send('ok'));
health.listen(process.env.PORT || 8080, '0.0.0.0');

// ---- Helpers ----
function stripBotMention(text) {
  return (text || '').replace(/<@[^>]+>\s*/g, '').trim();
}

function parseGitHubPullUrl(text) {
  const m = (text || '').match(/https:\/\/github\.com\/([^\/\s]+)\/([^\/\s]+)\/pull\/(\d+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2], pull_number: Number(m[3]) };
}

function parseOwnerRepo(text) {
  // Matches "owner/repo" anywhere in the text.
  const m = (text || '').match(/\b([a-z0-9_.-]+)\/([a-z0-9_.-]+)\b/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

function parseGitHubRepoUrl(text) {
  // Matches "https://github.com/owner/repo"
  const m = (text || '').match(/https:\/\/github\.com\/([^\/\s]+)\/([^\/\s#?]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

async function fetchRepoAndReadme({ owner, repo }) {
  if (!octokit) throw new Error('GITHUB_TOKEN missing');

  const repoResp = await octokit.repos.get({ owner, repo });
  const repoData = repoResp.data;

  let readmeText = '';
  try {
    const readmeResp = await octokit.repos.getReadme({ owner, repo });
    const content = readmeResp.data?.content || '';
    readmeText = Buffer.from(content, 'base64').toString('utf8');
  } catch {
    readmeText = '(README not found or not accessible)';
  }

  return { repoData, readmeText };
}

// Simple in-memory rate limit (good enough for local)
const RATE_LIMIT_WINDOW_MS = 30_000;
const RATE_LIMIT_MAX = 6;
const rateState = new Map(); // key -> { ts, count }

function rateLimitOk(key) {
  const now = Date.now();
  const cur = rateState.get(key);
  if (!cur || now - cur.ts > RATE_LIMIT_WINDOW_MS) {
    rateState.set(key, { ts: now, count: 1 });
    return true;
  }
  if (cur.count >= RATE_LIMIT_MAX) return false;
  cur.count += 1;
  return true;
}

function helpText() {
  return [
    '*OpenClaw* can help with:',
    '• General questions / drafting: `@OpenClaw write...`',
    '• GitHub repo info: `@OpenClaw tell me about owner/repo` or paste a repo URL',
    '• GitHub PR summaries: `@OpenClaw summarize https://github.com/ORG/REPO/pull/123`',
    '• Thread summaries: `@OpenClaw summarize this thread` (basic)',
    '',
    '_Notes:_',
    '• Claude is used when `ANTHROPIC_API_KEY` is configured.',
    '• GitHub features require `GITHUB_TOKEN` (fine-grained PAT).',
  ].join('\n');
}

async function summarizePullRequest(pr, slackContext = '') {
  if (!octokit) {
    return "GitHub integration isn't configured (`GITHUB_TOKEN` missing).";
  }

  const prResp = await octokit.pulls.get(pr);
  const prData = prResp.data;

  const filesResp = await octokit.pulls.listFiles({ ...pr, per_page: 100 });
  const files = filesResp.data.map((f) => ({
    filename: f.filename,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    status: f.status,
  }));

  const baseSummary = [
    `*PR:* ${prData.title}`,
    `*Repo:* ${pr.owner}/${pr.repo}`,
    `*Author:* ${prData.user?.login ?? 'unknown'}`,
    `*URL:* ${prData.html_url}`,
    `*State:* ${prData.state}${prData.draft ? ' (draft)' : ''}`,
    `*Files changed:* ${files.length}`,
  ].join('\n');

  if (!anthropic) {
    return [
      baseSummary,
      '',
      '*Top changed files:*',
      ...files.slice(0, 10).map((f) => `• ${f.filename} (+${f.additions}/-${f.deletions})`),
      '',
      '_Tip: configure `ANTHROPIC_API_KEY` to get a full narrative summary._',
    ].join('\n');
  }

  const prompt = [
    'Summarize this GitHub pull request for a Slack thread.',
    'Be concise, technical, and practical.',
    'Output format:',
    '1) 1-sentence summary',
    '2) Key changes (bullets)',
    '3) Risks / what to review',
    '4) Suggested test plan',
    '',
    `Slack context (if any): ${slackContext || '(none)'}`,
    '',
    `Title: ${prData.title}`,
    `Author: ${prData.user?.login}`,
    `URL: ${prData.html_url}`,
    `Description:\n${prData.body || '(none)'}`,
    '',
    `Changed files (${files.length}):`,
    ...files
      .slice(0, 40)
      .map((f) => `- ${f.filename} [${f.status}] (+${f.additions}/-${f.deletions})`),
  ].join('\n');

  const resp = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 950,
    system:
      "You are OpenClaw, a Slack bot. This bot may have server-side integrations (e.g., GitHub via a token). " +
      "Do not claim you lack integrations. If asked about GitHub, say: 'I can summarize GitHub PR links you paste here.' " +
      "Never reveal secrets. If uncertain, say so. Keep the answer readable.",
    messages: [{ role: 'user', content: prompt }],
  });

  return resp.content?.find((c) => c.type === 'text')?.text?.trim() || '(No response)';
}

// ---- Slack: mention handler ----
app.event('app_mention', async ({ event, say }) => {
  const cleaned = stripBotMention(event.text).trim();
  if (!cleaned) return;

  const reply = event.thread_ts ? { thread_ts: event.thread_ts } : { thread_ts: event.ts };

  // Status command
  if (cleaned.toLowerCase() === 'github status') {
    await say({ text: `GitHub integration: ${octokit ? 'enabled' : 'disabled'}`, ...reply });
    return;
  }

  const userKey = `${event.user}:${event.channel}`;
  if (!rateLimitOk(userKey)) {
    await say({ text: 'Rate limit: try again in ~30 seconds 🙏', ...reply });
    return;
  }

  const lower = cleaned.toLowerCase();

  // Help
  if (lower === 'help' || lower.startsWith('help ') || lower.includes('what can you do')) {
    await say({ text: helpText(), ...reply });
    return;
  }

  // GitHub PR summary (PR URL only)
  const pr = parseGitHubPullUrl(cleaned);
  if (pr) {
    try {
      await say({ text: 'Got it — summarizing that PR…', ...reply });
      const summary = await summarizePullRequest(pr, cleaned);
      await say({ text: summary, ...reply });
    } catch (err) {
      console.error('GitHub PR summary error:', err?.message || err);
      await say({ text: 'I hit an error summarizing that PR. Check logs.', ...reply });
    }
    return;
  }

  // GitHub repo summary (owner/repo or repo URL)
  const repoRef = parseGitHubRepoUrl(cleaned) || parseOwnerRepo(cleaned);
  if (repoRef) {
    try {
      await say({ text: `Got it — looking up ${repoRef.owner}/${repoRef.repo}…`, ...reply });

      if (!octokit) {
        await say({ text: "GitHub isn't configured (`GITHUB_TOKEN` missing).", ...reply });
        return;
      }

      const { repoData, readmeText } = await fetchRepoAndReadme(repoRef);

      // If Claude configured, ask for a clean summary
      if (anthropic) {
        const prompt = [
          'Summarize this GitHub repository for a Slack reply.',
          'Output:',
          '1) What it is (1-2 sentences)',
          '2) How to run it (bullets)',
          '3) Key security choices / design notes (bullets)',
          '4) What to do next (bullets)',
          '',
          `Repo: ${repoData.full_name}`,
          `Description: ${repoData.description || '(none)'}`,
          `Default branch: ${repoData.default_branch}`,
          `URL: ${repoData.html_url}`,
          '',
          `README:\n${readmeText.slice(0, 12000)}`,
        ].join('\n');

        const resp = await anthropic.messages.create({
          model: 'claude-opus-4-6',
          max_tokens: 900,
          system:
            'You are OpenClaw. You CAN access GitHub via server-side integration when available. ' +
            "Do not claim you cannot browse if GitHub integration is enabled. Never reveal secrets.",
          messages: [{ role: 'user', content: prompt }],
        });

        const text = resp.content?.find((c) => c.type === 'text')?.text?.trim() || '(No response)';
        await say({ text, ...reply });
        return;
      }

      // No Claude: return a basic summary
      await say({
        text: [
          `*${repoData.full_name}*`,
          repoData.description || '',
          repoData.html_url,
          '',
          '*README (first ~20 lines):*',
          readmeText.split('\n').slice(0, 20).join('\n'),
        ].join('\n'),
        ...reply,
      });
      return;
    } catch (err) {
      console.error('GitHub repo summary error:', err?.message || err);
      await say({ text: 'I hit an error reading that repo. Check logs.', ...reply });
      return;
    }
  }

  // Basic "summarize this thread" (no Slack history fetch here; safe minimal)
  if (lower.includes('summarize this thread')) {
    await say({
      text:
        "I can summarize threads, but I need permission + code to fetch message history. For now, paste the messages you want summarized (or tell me to add `conversations.history` + thread fetching).",
      ...reply,
    });
    return;
  }

  // Claude general response (fallback)
  if (!anthropic) {
    await say({
      text: "Claude isn't configured (`ANTHROPIC_API_KEY` missing). I can still do GitHub PR summaries (if `GITHUB_TOKEN` is set) or show help: `@OpenClaw help`.",
      ...reply,
    });
    return;
  }

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 800,
      system:
        'You are OpenClaw, a helpful assistant in Slack. Be concise and practical. Never reveal secrets. ' +
        'If asked about GitHub, you can look up repos and summarize READMEs when GitHub integration is enabled.',
      messages: [{ role: 'user', content: cleaned }],
    });

    const text = resp.content?.find((c) => c.type === 'text')?.text?.trim() || '(No response)';
    await say({ text, ...reply });
  } catch (err) {
    console.error('Claude error:', err?.message || err);
    await say({ text: 'Claude call failed — check logs.', ...reply });
  }
});

(async () => {
  await app.start();
  console.log('⚡️ OpenClaw Slack bot running (Socket Mode)');
  console.log(`Claude: ${anthropic ? 'enabled' : 'disabled'} | GitHub: ${octokit ? 'enabled' : 'disabled'}`);
})();
