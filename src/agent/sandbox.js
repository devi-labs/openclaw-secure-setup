'use strict';

const fs = require('fs');
const path = require('path');

const { claudeSandboxPlan } = require('./plan');
const { makeJobId, httpsRepoUrl, runCmd, commandAllowed, safeLogChunk } = require('../util/proc');

function clampString(s, n) {
  return String(s || '').slice(0, n);
}

function buildPRBodyFromPlan({ task, plan }) {
  let body = `${(plan.prBody || '').trim()}\n\n---\n`;
  body += `## Task\n${task}\n\n`;
  body += `## What I did\n${(plan.summaryBullets || []).map((b) => `- ${b}`).join('\n') || '- (no summary)'}\n\n`;
  body += `## Suggested test plan\n${(plan.testPlanBullets || []).map((b) => `- ${b}`).join('\n') || '- (none)'}\n`;

  if (plan.verify?.failed) {
    body += `\n\n⚠️ Verification failed (logs):\n\`\`\`\n${plan.verify.logs || ''}\n\`\`\`\n`;
  }
  return body.trim() + '\n';
}

async function sandboxFastPR({ octokit, anthropic, model, config, sayProgress, threadMemory, repoMemory, repoContext, threadKey, recordThreadError, owner, repo, task }) {
  if (!octokit) throw new Error('GITHUB_TOKEN missing');
  if (!config.github.token) throw new Error('GITHUB_TOKEN missing in container');
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY missing');

  const repoResp = await octokit.repos.get({ owner, repo });
  const defaultBranch = repoResp.data.default_branch;

  const jobId = makeJobId();
  const root = config.workdir;
  const jobDir = path.join(root, `${owner}-${repo}-${jobId}`);

  fs.mkdirSync(jobDir, { recursive: true });

  try {
    // Clone
    await sayProgress?.(`🧱 [${jobId}] Cloning repo into sandbox...`);
    const cloneUrl = httpsRepoUrl(owner, repo, config.github.token);
    let r = await runCmd('git', ['clone', '--depth=1', '--branch', defaultBranch, cloneUrl, jobDir], { env: process.env });
    if (r.code !== 0) {
      await recordThreadError(threadKey, {
        lastError: 'git clone failed',
        lastErrorJobId: jobId,
        lastErrorContext: 'git:clone',
        lastErrorLogs: clampString(safeLogChunk(r.err || r.out, 6000), 6000),
      });
      throw new Error(`git clone failed:\n${safeLogChunk(r.err || r.out)}`);
    }

    // Configure git identity (required for any commits)
    const gitEmail = process.env.GIT_AUTHOR_EMAIL || 'openclaw@bot.local';
    const gitName = process.env.GIT_AUTHOR_NAME || 'OpenClaw Bot';
    
    await sayProgress?.(`🔧 [${jobId}] Configuring git identity (${gitName} <${gitEmail}>)...`);
    
    r = await runCmd('git', ['config', 'user.email', gitEmail], { cwd: jobDir, env: process.env });
    if (r.code !== 0) {
      await recordThreadError(threadKey, {
        lastError: 'git config user.email failed',
        lastErrorJobId: jobId,
        lastErrorContext: 'git:config:email',
        lastErrorLogs: clampString(safeLogChunk(r.err || r.out, 6000), 6000),
      });
      throw new Error(`git config user.email failed:\n${safeLogChunk(r.err || r.out)}`);
    }
    
    r = await runCmd('git', ['config', 'user.name', gitName], { cwd: jobDir, env: process.env });
    if (r.code !== 0) {
      await recordThreadError(threadKey, {
        lastError: 'git config user.name failed',
        lastErrorJobId: jobId,
        lastErrorContext: 'git:config:name',
        lastErrorLogs: clampString(safeLogChunk(r.err || r.out, 6000), 6000),
      });
      throw new Error(`git config user.name failed:\n${safeLogChunk(r.err || r.out)}`);
    }
    
    // Verify git config was set
    r = await runCmd('git', ['config', '--get', 'user.email'], { cwd: jobDir, env: process.env });
    if (r.code !== 0 || r.out.trim() !== gitEmail) {
      await sayProgress?.(`⚠️ [${jobId}] Warning: git config verification failed (expected: ${gitEmail}, got: ${r.out.trim()})`);
    }

    // Prepare environment with git identity for all commands
    const execEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: gitName,
      GIT_AUTHOR_EMAIL: gitEmail,
      GIT_COMMITTER_NAME: gitName,
      GIT_COMMITTER_EMAIL: gitEmail,
    };

    // Branch
    const branch = `openclaw/sandbox-${Date.now().toString(36)}-${jobId}`;
    await sayProgress?.(`🌿 [${jobId}] Creating branch ${branch}...`);
    r = await runCmd('git', ['checkout', '-b', branch], { cwd: jobDir, env: execEnv });
    if (r.code !== 0) {
      await recordThreadError(threadKey, {
        lastError: 'git checkout failed',
        lastErrorJobId: jobId,
        lastErrorContext: 'git:checkout',
        lastErrorLogs: clampString(safeLogChunk(r.err || r.out, 6000), 6000),
      });
      throw new Error(`git checkout failed:\n${safeLogChunk(r.err || r.out)}`);
    }

    // Plan
    await sayProgress?.(`🧠 [${jobId}] Planning...`);
    const plan = await claudeSandboxPlan({
      anthropic,
      model,
      owner,
      repo,
      task,
      defaultBranch,
      threadMemory,
      repoMemory,
      repoContext,
      threadKey,
      jobId,
      recordThreadError,
    });

    // Execute plan steps
    for (const step of plan.steps) {
      const cmd = step.cmd;
      const args = step.args || [];
      if (!commandAllowed(cmd, args)) {
        await recordThreadError(threadKey, {
          lastError: 'Blocked command from plan',
          lastErrorJobId: jobId,
          lastErrorContext: 'plan:blocked_command',
          lastErrorLogs: clampString(`${cmd} ${(args || []).join(' ')}`, 2000),
        });
        throw new Error(`Blocked command from plan: ${cmd} ${(args || []).join(' ')}`);
      }

      await sayProgress?.(`▶️ [${jobId}] ${cmd} ${(args || []).join(' ')}`);
      const res = await runCmd(cmd, args, { cwd: jobDir, env: execEnv });

      if (res.code !== 0) {
        await recordThreadError(threadKey, {
          lastError: 'Plan command failed',
          lastErrorJobId: jobId,
          lastErrorContext: `plan:exec:${cmd}`,
          lastErrorLogs: clampString(safeLogChunk(res.err || res.out, 6000), 6000),
        });
        throw new Error(
          `Command failed: ${cmd} ${(args || []).join(' ')}\n` +
          safeLogChunk(res.err || res.out)
        );
      }
    }

    // Secondary: verification
    if (config.runTests && plan.verify?.commands?.length) {
      await sayProgress?.(`🧪 [${jobId}] Running verification...`);
      for (const v of plan.verify.commands) {
        const [cmd, ...args] = v;
        if (!commandAllowed(cmd, args)) {
          await recordThreadError(threadKey, {
            lastError: 'Blocked verify command',
            lastErrorJobId: jobId,
            lastErrorContext: 'verify:blocked_command',
            lastErrorLogs: clampString(`${cmd} ${(args || []).join(' ')}`, 2000),
          });
          throw new Error(`Blocked verify command: ${cmd} ${args.join(' ')}`);
        }
        const res = await runCmd(cmd, args, { cwd: jobDir, env: execEnv });
        if (res.code !== 0) {
          plan.verify.failed = true;
          plan.verify.logs = safeLogChunk(res.err || res.out, 6000);

          await recordThreadError(threadKey, {
            lastError: 'Verification failed (non-blocking)',
            lastErrorJobId: jobId,
            lastErrorContext: `verify:${cmd}`,
            lastErrorLogs: clampString(plan.verify.logs, 6000),
          });
          break; // keep PR fast
        }
      }
    }

    // Ensure changes exist
    r = await runCmd('git', ['status', '--porcelain'], { cwd: jobDir, env: execEnv });
    if (!r.out.trim()) {
      await recordThreadError(threadKey, {
        lastError: 'No changes produced in sandbox',
        lastErrorJobId: jobId,
        lastErrorContext: 'git:status_clean',
        lastErrorLogs: 'git status was clean after executing plan',
      });
      throw new Error('No changes produced in sandbox (git status clean).');
    }

    // Commit
    await sayProgress?.(`📦 [${jobId}] Committing...`);
    await runCmd('git', ['add', '-A'], { cwd: jobDir, env: execEnv });

    const commitMsg =
      (plan.commitMessage && String(plan.commitMessage).slice(0, 120)) ||
      `openclaw: ${task}`.slice(0, 120);

    r = await runCmd('git', ['commit', '-m', commitMsg], { cwd: jobDir, env: execEnv });
    if (r.code !== 0) {
      await recordThreadError(threadKey, {
        lastError: 'git commit failed',
        lastErrorJobId: jobId,
        lastErrorContext: 'git:commit',
        lastErrorLogs: clampString(safeLogChunk(r.err || r.out, 6000), 6000),
      });
      throw new Error(`git commit failed:\n${safeLogChunk(r.err || r.out)}`);
    }

    // Push
    await sayProgress?.(`⬆️ [${jobId}] Pushing branch...`);
    r = await runCmd('git', ['push', 'origin', branch], { cwd: jobDir, env: execEnv });
    if (r.code !== 0) {
      await recordThreadError(threadKey, {
        lastError: 'git push failed',
        lastErrorJobId: jobId,
        lastErrorContext: 'git:push',
        lastErrorLogs: clampString(safeLogChunk(r.err || r.out, 6000), 6000),
      });
      throw new Error(`git push failed:\n${safeLogChunk(r.err || r.out)}`);
    }

    // PR
    await sayProgress?.(`🔀 [${jobId}] Opening PR...`);
    const prBody = buildPRBodyFromPlan({ task, plan });

    const pr = await octokit.pulls.create({
      owner,
      repo,
      title: String(plan.prTitle || `OpenClaw: ${task}`).slice(0, 180),
      head: branch,
      base: defaultBranch,
      body: prBody,
    });

    // Clear last error on success (nice UX)
    await recordThreadError(threadKey, {
      lastError: null,
      lastErrorJobId: null,
      lastErrorContext: null,
      lastErrorLogs: null,
      lastClaudeRawSnippet: null,
    });

    return { prUrl: pr.data.html_url, branch, jobId, plan };
  } catch (e) {
    // Ensure we at least store the thrown error message too
    await recordThreadError(threadKey, {
      lastError: clampString(e?.message || 'unknown error', 800),
      lastErrorJobId: jobId,
      lastErrorContext: 'sandboxFastPR:throw',
    });
    throw e;
  }
}

module.exports = { sandboxFastPR };
