'use strict';

const express = require('express');

const { rateLimitOk } = require('./util/rateLimit');
const {
  parseGitHubPullUrl,
  parseOwnerRepo,
  parseGitHubRepoUrl,
  parseTaskBlock,
} = require('./util/parse');

const { sandboxFastPR } = require('./agent/sandbox');
const { fetchRepoAndReadme } = require('./github/repo');
const { summarizePullRequest } = require('./github/pr');

function ts() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}
function log(...args) { console.log(`[${ts()}]`, ...args); }
function logError(...args) { console.error(`[${ts()}]`, ...args); }

function helpText() {
  return [
    'OpenClaw can help with:',
    '',
    '• Dev agent (sandbox PRs):',
    '  repo: your-org/your-repo',
    '  task: create a hello world react app',
    '',
    '• GitHub PR summaries:',
    '  summarize https://github.com/ORG/REPO/pull/123',
    '',
    '• Repo info:',
    '  tell me about owner/repo',
    '',
    '• Brain: brain status / brain show / brain reset',
    '',
    '• Email: email check / email search <query> / email read <id> / email send <to> "Subject" Body',
    '',
    '• Calendar: cal / cal list <date> / cal get <id> / cal create "Title" <date> <time> <duration> [attendees] / cal update <id> <field=value> / cal delete <id>',
    '',
    '• General questions: just ask!',
  ].join('\n');
}

async function startTelegramApp({ config, anthropic, openai, octokit, storage, brain, gmail, calendar }) {
  const app = express();
  app.use(express.json());

  app.get('/healthz', (_, res) => res.status(200).send('ok'));

  const { createTelegramClient } = require('./clients/telegram');
  const tg = createTelegramClient(config.telegram.botToken);

  if (!tg) {
    throw new Error('Telegram bot token missing (TELEGRAM_BOT_TOKEN)');
  }

  const allowedUserIds = config.telegram.allowedUserIds
    .split(',').map(s => s.trim()).filter(Boolean);

  async function sendReply(chatId, text) {
    try {
      await tg.sendMessage(chatId, text);
    } catch (err) {
      logError(`Telegram send error: ${err.message || err}`);
    }
  }

  async function handleMessage(message) {
    if (!message?.text) return;

    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const messageBody = message.text.trim();

    if (!messageBody) return;

    // Allowlist check
    if (allowedUserIds.length > 0 && !allowedUserIds.includes(userId)) {
      await sendReply(chatId, 'Not authorized.');
      return;
    }

    const userKey = `tg:${userId}`;

    if (!rateLimitOk(userKey)) {
      await sendReply(chatId, 'Rate limit: try again in ~30 seconds');
      return;
    }

    const threadKey = brain.threadKeyFromTelegram(userId);
    const threadState = await brain.loadThread(threadKey);
    const lower = messageBody.toLowerCase();

    // Strip /start command (Telegram sends this on first interaction)
    if (lower === '/start') {
      await sendReply(chatId, helpText());
      return;
    }

    try {
      // Help
      if (lower === 'help' || lower === '/help' || lower.includes('what can you do')) {
        await sendReply(chatId, helpText());
        return;
      }

      // Brain status
      if (lower.startsWith('brain status')) {
        await sendReply(chatId,
          `Brain: ${brain.enabled ? 'enabled' : 'disabled'}\n` +
          `Bucket: ${config.gcp.brainBucket || '(missing)'}\n` +
          `Prefix: ${config.gcp.brainPrefix}`
        );
        return;
      }
      if (lower.startsWith('brain show')) {
        const mem = JSON.stringify(threadState || {}, null, 2).slice(0, 3500);
        await sendReply(chatId, `Thread memory:\n${mem}`);
        return;
      }
      if (/^brain\s+last\s+error/i.test(lower)) {
        const err = threadState?.lastError;
        if (!err) {
          await sendReply(chatId, '✅ No recorded error.');
          return;
        }
        await sendReply(chatId,
          `❌ Last error (${threadState?.lastErrorAt || '?'}):\n${err}`
        );
        return;
      }
      if (lower.startsWith('brain reset')) {
        if (!brain.enabled) {
          await sendReply(chatId, 'Brain is disabled (no bucket).');
          return;
        }
        await brain.saveThread(threadKey, {
          clearedAt: new Date().toISOString(),
          lastRepo: null, lastTask: null, lastPrUrl: null,
          lastBranch: null, lastPlan: null, lastError: null,
          lastErrorAt: null, lastErrorJobId: null,
          lastErrorContext: null, lastErrorLogs: null,
          lastClaudeRawSnippet: null,
        });
        await sendReply(chatId, '✅ Brain reset.');
        return;
      }

      // List indexed repos
      if (lower === 'repos' || lower === 'list repos') {
        const repoList = await brain.listRepos();
        if (!repoList.length) {
          await sendReply(chatId, 'No repos indexed yet. Set OPENCLAW_REPOS or wait for auto-discovery.');
          return;
        }
        const list = repoList.map(r => `• ${r.name} (${r.language || '?'})`).join('\n');
        await sendReply(chatId, `📦 Indexed repos:\n${list}`);
        return;
      }

      // PR summary
      const pr = parseGitHubPullUrl(messageBody);
      if (pr) {
        await sendReply(chatId, 'Summarizing that PR...');
        const summary = await summarizePullRequest({
          octokit, anthropic,
          model: config.anthropic.model,
          pr, slackContext: messageBody,
        });
        await brain.saveThread(threadKey, {
          lastPrUrl: `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.pull_number}`,
          lastRepo: `${pr.owner}/${pr.repo}`,
        });
        await sendReply(chatId, summary);
        return;
      }

      // Dev agent task block
      const taskBlock = parseTaskBlock(messageBody);
      if (taskBlock) {
        if (!octokit) {
          await sendReply(chatId, 'GitHub not configured (GITHUB_TOKEN missing).');
          return;
        }
        if (!anthropic) {
          await sendReply(chatId, 'Claude not configured (ANTHROPIC_API_KEY missing).');
          return;
        }

        let owner = taskBlock.repoRef?.owner || null;
        let repo = taskBlock.repoRef?.repo || null;

        if ((!owner || !repo) && threadState?.lastRepo) {
          const m = parseOwnerRepo(threadState.lastRepo);
          if (m) { owner = m.owner; repo = m.repo; }
        }

        if (!owner || !repo) {
          await sendReply(chatId, 'I need a repo. Send:\nrepo: owner/repo\ntask: what to do');
          return;
        }

        const sayProgress = async (t) => sendReply(chatId, t);

        const repoMem = await brain.loadRepo(owner, repo);
        const summaryMemory = await brain.loadSummary();

        let repoContext = null;
        try {
          const { repoData, readmeText } = await fetchRepoAndReadme({ octokit, owner, repo });
          let rootPaths = [];
          try {
            const contentResp = await octokit.repos.getContent({ owner, repo, path: '', ref: repoData.default_branch });
            if (Array.isArray(contentResp.data)) rootPaths = contentResp.data.map((i) => i.path);
          } catch { rootPaths = []; }
          repoContext = {
            rootPaths,
            description: repoData.description || '',
            readmeSnippet: readmeText.slice(0, 4000),
          };
        } catch { repoContext = null; }

        await sayProgress(`🧠 Starting sandbox dev job for ${owner}/${repo}...`);
        const result = await sandboxFastPR({
          octokit, anthropic,
          model: config.anthropic.model,
          config, sayProgress,
          threadMemory: threadState || {},
          repoMemory: repoMem || {},
          repoContext, summaryMemory,
          threadKey,
          recordThreadError: brain.recordThreadError,
          owner, repo,
          task: taskBlock.task,
          constraints: taskBlock.constraints,
          acceptance: taskBlock.acceptance,
          context: taskBlock.context,
        });

        if (result.needsClarification) {
          const questions = (result.plan.questions || []).slice(0, 3);
          const msg = [
            '🤔 Before I proceed:',
            '',
            `Understanding: ${result.plan.restatement || '(unclear)'}`,
            '',
            ...questions.map((q, i) => `${i + 1}. ${q}`),
            '',
            'Reply with answers and I\'ll build the PR.',
          ].join('\n');
          await sendReply(chatId, msg);
          return;
        }

        await brain.saveThread(threadKey, {
          lastRepo: `${owner}/${repo}`,
          lastTask: taskBlock.task,
          lastPrUrl: result.prUrl,
          lastBranch: result.branch,
          lastJobId: result.jobId,
          lastPlan: brain.sanitizePlanForStorage(result.plan),
        });

        await brain.saveRepo(owner, repo, {
          lastTouchedAt: new Date().toISOString(),
          lastPrUrl: result.prUrl,
          lastBranch: result.branch,
          preferences: { fastPRs: true, testsSecondary: true },
        });

        await brain.saveSummary({
          repo: `${owner}/${repo}`,
          task: taskBlock.task,
          result: `PR created: ${result.prUrl}`,
          branch: result.branch,
        });

        await sendReply(chatId, `✅ PR created: ${result.prUrl}\nBranch: ${result.branch}`);
        return;
      }

      // Repo summary
      const repoRef = parseGitHubRepoUrl(messageBody) || parseOwnerRepo(messageBody);
      if (repoRef && (lower.startsWith('tell me about') || lower.startsWith('describe') || lower.startsWith('what is'))) {
        if (!octokit) {
          await sendReply(chatId, 'GitHub not configured.');
          return;
        }
        await sendReply(chatId, `Looking up ${repoRef.owner}/${repoRef.repo}...`);
        const { repoData, readmeText } = await fetchRepoAndReadme({ octokit, ...repoRef });
        await brain.saveThread(threadKey, { lastRepo: `${repoRef.owner}/${repoRef.repo}` });

        if (anthropic) {
          const prompt = [
            'Summarize this GitHub repository briefly.',
            `Repo: ${repoData.full_name}`,
            `Description: ${repoData.description || '(none)'}`,
            `README:\n${readmeText.slice(0, 4000)}`,
          ].join('\n');

          const resp = await anthropic.messages.create({
            model: config.anthropic.model,
            max_tokens: 500,
            system: 'You are OpenClaw. Be concise.',
            messages: [{ role: 'user', content: prompt }],
          });
          const text = resp.content?.find((c) => c.type === 'text')?.text?.trim() || '(No response)';
          await sendReply(chatId, text);
        } else {
          await sendReply(chatId, `${repoData.full_name}\n${repoData.description || ''}\n${repoData.html_url}`);
        }
        return;
      }

      // Gmail commands
      if (gmail && lower.startsWith('email')) {
        const emailCmd = lower.replace(/^email\s*/, '').trim();
        const emailCmdRaw = messageBody.replace(/^email\s*/i, '').trim();

        if (emailCmd === 'check' || emailCmd === 'inbox' || emailCmd === '') {
          const msgs = await gmail.listMessages({ maxResults: 5 });
          if (!msgs.length) {
            await sendReply(chatId, '📭 No recent emails.');
            return;
          }
          const lines = msgs.map((m, i) =>
            `${i + 1}. ${m.from.slice(0, 40)}\n   ${m.subject}\n   ${m.date}`
          );
          await sendReply(chatId, `📬 Recent emails:\n\n${lines.join('\n\n')}`);
          return;
        }

        if (emailCmd.startsWith('search ')) {
          const query = emailCmd.replace(/^search\s*/, '').trim();
          const msgs = await gmail.listMessages({ query, maxResults: 5 });
          if (!msgs.length) {
            await sendReply(chatId, `No emails found for: ${query}`);
            return;
          }
          const lines = msgs.map((m, i) =>
            `${i + 1}. ${m.from.slice(0, 40)}\n   ${m.subject}`
          );
          await sendReply(chatId, `📬 Results for "${query}":\n\n${lines.join('\n\n')}`);
          return;
        }

        if (emailCmd.startsWith('read ')) {
          const msgId = emailCmd.replace(/^read\s*/, '').trim();
          const msg = await gmail.readMessage(msgId);
          await sendReply(chatId,
            `📧 From: ${msg.from}\nSubject: ${msg.subject}\nDate: ${msg.date}\n\n${msg.body.slice(0, 3500)}`
          );
          return;
        }

        if (emailCmd.startsWith('send ')) {
          const sendMatch = emailCmdRaw.match(/^send\s+(\S+)\s+["\u201c\u201e\u00ab]([^"\u201d\u201f\u00bb]+)["\u201d\u201f\u00bb]\s+(.+)$/is);
          if (!sendMatch) {
            await sendReply(chatId, 'Usage: email send user@email.com "Subject" Body text here');
            return;
          }
          await gmail.sendEmail({ to: sendMatch[1], subject: sendMatch[2], body: sendMatch[3] });
          await sendReply(chatId, `✅ Email sent to ${sendMatch[1]}`);
          return;
        }

        await sendReply(chatId,
          'Email commands:\n• email check\n• email search <query>\n• email read <id>\n• email send user@email.com "Subject" Body'
        );
        return;
      }

      // Calendar commands
      if (calendar && lower.startsWith('cal')) {
        const calCmd = lower.replace(/^cal\s*/, '').trim();
        const calCmdRaw = messageBody.replace(/^cal\s*/i, '').trim();

        if (calCmd === '' || calCmd === 'list' || calCmd === 'today') {
          const events = await calendar.listEvents();
          if (!events.length) {
            await sendReply(chatId, '📅 No events today.');
            return;
          }
          await sendReply(chatId, `📅 Today's events:\n\n${events.map(e => e.formatted).join('\n\n')}`);
          return;
        }

        if (calCmd.startsWith('list ')) {
          const arg = calCmd.replace(/^list\s*/, '').trim();
          let timeMin, timeMax;
          if (arg === 'week') {
            const now = new Date();
            timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();
          } else {
            const dateStr = calendar.resolveDate(arg);
            timeMin = new Date(`${dateStr}T00:00:00`).toISOString();
            timeMax = new Date(`${dateStr}T23:59:59`).toISOString();
          }
          const events = await calendar.listEvents({ timeMin, timeMax });
          if (!events.length) {
            await sendReply(chatId, `📅 No events for ${arg}.`);
            return;
          }
          await sendReply(chatId, `📅 Events (${arg}):\n\n${events.map(e => e.formatted).join('\n\n')}`);
          return;
        }

        if (calCmd.startsWith('get ')) {
          const eventId = calCmd.replace(/^get\s*/, '').trim();
          const ev = await calendar.getEvent(eventId);
          await sendReply(chatId, `📅 ${ev.formatted}\n${ev.htmlLink || ''}`);
          return;
        }

        if (calCmd.startsWith('create ')) {
          const createMatch = calCmdRaw.match(/^create\s+["\u201c\u201e\u00ab]([^"\u201d\u201f\u00bb]+)["\u201d\u201f\u00bb]\s+(\S+)\s+(\d{1,2}:\d{2})\s+(\S+)(.*)$/is);
          if (!createMatch) {
            await sendReply(chatId, 'Usage: cal create "Title" <date> <time> <duration> [attendees] [location:"place"]');
            return;
          }
          const [, title, date, time, duration, rest] = createMatch;
          const locMatch = (rest || '').match(/location\s*:\s*["\u201c]([^"\u201d]+)["\u201d]/i);
          const location = locMatch ? locMatch[1] : '';
          const attendeePart = (rest || '').replace(/location\s*:\s*["\u201c][^"\u201d]*["\u201d]/i, '').trim();
          const attendees = attendeePart ? attendeePart.split(',').map(s => s.trim()).filter(Boolean) : [];

          const result = await calendar.createEvent({ summary: title, date, time, duration, attendees, location });
          await sendReply(chatId, `✅ Event created: ${result.summary}\n${result.htmlLink || ''}`);
          return;
        }

        if (calCmd.startsWith('update ')) {
          const parts = calCmdRaw.replace(/^update\s*/i, '').trim().split(/\s+/);
          const eventId = parts[0];
          if (!eventId || parts.length < 2) {
            await sendReply(chatId, 'Usage: cal update <eventId> title="New Title" time=14:00 date=2026-03-15 duration=1h location="Room"');
            return;
          }
          const updates = {};
          const kvStr = parts.slice(1).join(' ');
          const kvMatches = kvStr.matchAll(/(\w+)\s*=\s*["\u201c]([^"\u201d]+)["\u201d]|(\w+)\s*=\s*(\S+)/g);
          for (const m of kvMatches) {
            const key = m[1] || m[3];
            const val = m[2] || m[4];
            if (key === 'title') updates.summary = val;
            else if (key === 'attendees') updates.attendees = val.split(',').map(s => s.trim());
            else updates[key] = val;
          }
          const result = await calendar.updateEvent(eventId, updates);
          await sendReply(chatId, `✅ Event updated: ${result.summary}\n${result.htmlLink || ''}`);
          return;
        }

        if (calCmd.startsWith('delete ')) {
          const eventId = calCmd.replace(/^delete\s*/, '').trim();
          await calendar.deleteEvent(eventId);
          await sendReply(chatId, `✅ Event deleted.`);
          return;
        }

        await sendReply(chatId,
          'Calendar commands:\n• cal / cal list / cal list <date> / cal list week\n• cal get <id>\n• cal create "Title" <date> <time> <duration> [attendees]\n• cal update <id> field=value\n• cal delete <id>'
        );
        return;
      }

      // Claude general response fallback
      if (!anthropic) {
        await sendReply(chatId, 'Claude not configured. Send "help" for commands.');
        return;
      }

      // Load conversation history from brain
      const historyKey = `${threadKey}:history`;
      const historyState = await brain.loadThread(historyKey);
      const history = Array.isArray(historyState?.messages) ? historyState.messages : [];

      // Add current message
      history.push({ role: 'user', content: messageBody });

      // Keep last 20 messages to stay within token limits
      const trimmed = history.slice(-20);

      // Build repo context
      const indexedRepos = await brain.listRepos();
      const repoContext = indexedRepos.length
        ? `\nUser's repos:\n${indexedRepos.map(r => `- ${r.name} (${r.language || '?'}): ${r.description || 'no description'}`).join('\n')}`
        : '';

      const systemPrompt = [
        'You are OpenClaw, a helpful assistant via Telegram. Be concise.',
        'You can create PRs (user sends "repo: owner/repo" + "task: ..."), send emails ("email send ..."), manage calendar ("cal ..."), and check brain memory.',
        threadState?.lastRepo ? `User last worked on repo: ${threadState.lastRepo}` : '',
        threadState?.lastTask ? `Last task: ${threadState.lastTask}` : '',
        repoContext,
      ].filter(Boolean).join('\n');

      const resp = await anthropic.messages.create({
        model: config.anthropic.model,
        max_tokens: 500,
        system: systemPrompt,
        messages: trimmed,
      });
      const text = resp.content?.find((c) => c.type === 'text')?.text?.trim() || '(No response)';

      // Save assistant reply to history
      trimmed.push({ role: 'assistant', content: text });
      await brain.saveThread(historyKey, { messages: trimmed.slice(-20) });

      await sendReply(chatId, text);

    } catch (err) {
      logError('Telegram handler error:', err?.message || err);
      await brain.recordThreadError(threadKey, {
        lastError: (err?.message || 'unknown error').slice(0, 800),
        lastErrorContext: 'telegram:handler',
      });
      await sendReply(chatId, `❌ Error: ${(err?.message || 'unknown').slice(0, 200)}`);
    }
  }

  // Start polling for messages
  tg.startPolling((message) => {
    handleMessage(message).catch(err => logError('Unhandled message error:', err?.message || err));
  });

  app.listen(config.port, '0.0.0.0', () => {
    log(`⚡️ OpenClaw Telegram server running on port ${config.port} (polling mode)`);
    log(
      `Claude: ${anthropic ? 'enabled' : 'disabled'} | GitHub: ${octokit ? 'enabled' : 'disabled'} | ` +
      `Brain: ${brain.enabled ? 'enabled' : 'disabled'} | ` +
      `Allowed users: ${config.telegram.allowedUserIds || '(any)'}`
    );
  });

  return app;
}

module.exports = { startTelegramApp };
