'use strict';

const fs = require('fs');
const path = require('path');

const { claudeSandboxPlan, claudeHealStep } = require('./plan');
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

function detectRepoFacts(jobDir) {
  const facts = { language: null, framework: null, packageManager: null, buildCommand: null, testCommand: null, hasCI: false, keyFiles: [] };
  try {
    const files = fs.readdirSync(jobDir);
    facts.keyFiles = files.slice(0, 50);

    if (files.includes('package.json')) {
      facts.packageManager = 'npm';
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(jobDir, 'package.json'), 'utf8'));
        facts.language = 'javascript';
        if (pkg.scripts?.build) facts.buildCommand = `npm run build`;
        if (pkg.scripts?.test) facts.testCommand = `npm test`;
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps.react) facts.framework = 'react';
        else if (allDeps.next) facts.framework = 'next';
        else if (allDeps.vue) facts.framework = 'vue';
        else if (allDeps.express) facts.framework = 'express';
        else if (allDeps.fastify) facts.framework = 'fastify';
        if (allDeps.typescript) facts.language = 'typescript';
      } catch {}
    }
    if (files.includes('yarn.lock')) facts.packageManager = 'yarn';
    if (files.includes('pnpm-lock.yaml')) facts.packageManager = 'pnpm';
    if (files.includes('requirements.txt') || files.includes('setup.py') || files.includes('pyproject.toml')) facts.language = facts.language || 'python';
    if (files.includes('Cargo.toml')) facts.language = facts.language || 'rust';
    if (files.includes('go.mod')) facts.language = facts.language || 'go';
    if (files.includes('.github')) facts.hasCI = true;
    if (files.includes('.gitlab-ci.yml')) facts.hasCI = true;
  } catch {}
  return facts;
}

async function sandboxFastPR({ octokit, anthropic, model, config, sayProgress, threadMemory, repoMemory, repoContext, summaryMemory, threadKey, recordThreadError, owner, repo, task, constraints, acceptance, context }) {
  if (!octokit) throw new Error('GITHUB_TOKEN missing');
  if (!config.github.token) throw new Error('GITHUB_TOKEN missing in container');
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY missing');

  const jobId = makeJobId();
  const root = config.workdir;
  const jobDir = path.join(root, `${owner}-${repo}-${jobId}`);

  try {
    const repoResp = await octokit.repos.get({ owner, repo });
    const defaultBranch = repoResp.data.default_branch;

    fs.mkdirSync(jobDir, { recursive: true });
    // Clone
    const cloneUrl = httpsRepoUrl(owner, repo, config.github.token);
    let r = await runCmd('git', ['clone', '--depth=1', '--branch', defaultBranch, cloneUrl, jobDir], { env: process.env, timeout: 60_000 });
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
      console.warn(`git config verification failed (expected: ${gitEmail}, got: ${r.out.trim()})`);
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

    // Repo inventory (detect language, framework, build/test commands)
    const repoFacts = detectRepoFacts(jobDir);

    // Plan
    await sayProgress?.(`🧠 Planning your PR...`);
    const plan = await claudeSandboxPlan({
      anthropic,
      model,
      owner,
      repo,
      task,
      constraints,
      acceptance,
      context,
      defaultBranch,
      threadMemory,
      repoMemory,
      repoContext,
      repoFacts,
      summaryMemory,
      threadKey,
      jobId,
      recordThreadError,
    });

    // Handle clarification response
    if (plan.needsClarification) {
      return { needsClarification: true, plan };
    }

    // Execute plan steps with self-healing
    const MAX_HEAL_ATTEMPTS = 2;
    let healAttempts = 0;

    for (let stepIdx = 0; stepIdx < plan.steps.length; stepIdx++) {
      const step = plan.steps[stepIdx];
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

      // Give install commands more time (3 min), everything else 2 min
      const isInstall = cmd === 'npm' || cmd === 'yarn' || cmd === 'pnpm' || cmd === 'pip';
      const stepTimeout = isInstall ? 180_000 : 120_000;

      console.log(`▶️ [${jobId}] ${cmd} ${(args || []).join(' ')}`);
      const res = await runCmd(cmd, args, { cwd: jobDir, env: execEnv, timeout: stepTimeout });

      if (res.code !== 0) {
        const errorOutput = (res.err || '') + '\n' + (res.out || '');

        // Attempt self-healing if we haven't exhausted retries
        if (healAttempts < MAX_HEAL_ATTEMPTS) {
          healAttempts++;
          console.log(`🩹 [${jobId}] Self-heal attempt ${healAttempts}/${MAX_HEAL_ATTEMPTS} for: ${cmd}`);
          await sayProgress?.(`⚠️ Step failed (${cmd}), attempting self-heal...`);

          const fix = await claudeHealStep({
            anthropic, model,
            failedStep: step,
            errorOutput,
            remainingSteps: plan.steps.slice(stepIdx + 1),
            repoFacts,
            task,
          });

          if (fix && fix.fixSteps.length > 0) {
            console.log(`🩹 [${jobId}] Diagnosis: ${fix.diagnosis || '(none)'}`);

            // Execute corrective steps
            let fixSucceeded = true;
            for (const fixStep of fix.fixSteps) {
              const fCmd = fixStep.cmd;
              const fArgs = fixStep.args || [];
              if (!commandAllowed(fCmd, fArgs)) {
                console.log(`🩹 [${jobId}] Fix step blocked: ${fCmd}`);
                fixSucceeded = false;
                break;
              }
              const fIsInstall = fCmd === 'npm' || fCmd === 'yarn' || fCmd === 'pnpm' || fCmd === 'pip';
              const fTimeout = fIsInstall ? 180_000 : 120_000;
              console.log(`🩹 [${jobId}] ${fCmd} ${fArgs.join(' ')}`);
              const fRes = await runCmd(fCmd, fArgs, { cwd: jobDir, env: execEnv, timeout: fTimeout });
              if (fRes.code !== 0) {
                console.log(`🩹 [${jobId}] Fix step failed: ${fCmd} (code ${fRes.code})`);
                fixSucceeded = false;
                break;
              }
            }

            // Retry the original failed step if fix says to
            if (fixSucceeded && fix.retryOriginal !== false) {
              console.log(`🩹 [${jobId}] Retrying original step: ${cmd}`);
              const retry = await runCmd(cmd, args, { cwd: jobDir, env: execEnv, timeout: stepTimeout });
              if (retry.code === 0) {
                await sayProgress?.(`✅ Self-healed: ${fix.diagnosis || cmd}`);
                continue; // success — move to next plan step
              }
            } else if (fixSucceeded) {
              // Fix steps handled it, no need to retry original
              await sayProgress?.(`✅ Self-healed: ${fix.diagnosis || cmd}`);
              continue;
            }
          }
        }

        // If we get here, healing failed or was exhausted
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
      console.log(`🧪 [${jobId}] Running verification...`);
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

    // Ensure changes exist — if not, retry with a corrected plan
    r = await runCmd('git', ['status', '--porcelain'], { cwd: jobDir, env: execEnv });
    if (!r.out.trim()) {
      await sayProgress?.('⚠️ First plan produced no file changes — retrying with fix...');

      const retryPlan = await claudeSandboxPlan({
        anthropic, model, owner, repo, task, constraints, acceptance, context,
        defaultBranch,
        threadMemory: {
          ...threadMemory,
          lastError: 'Previous plan produced no file changes. Commands ran successfully but git status was clean afterwards. Common causes: shell redirections (>) don\'t work (we use spawn, not shell), tee/cat with pipes don\'t work, node -e scripts with syntax errors that silently fail. Use node -e "require(\'fs\').writeFileSync(path, content)" for file creation. Make sure paths are relative to the repo root.',
        },
        repoMemory, repoContext, repoFacts, summaryMemory,
        threadKey, jobId, recordThreadError,
      });

      if (retryPlan.needsClarification) {
        return { needsClarification: true, plan: retryPlan };
      }

      for (const step of retryPlan.steps) {
        const cmd = step.cmd;
        const args = step.args || [];
        if (!commandAllowed(cmd, args)) {
          throw new Error(`Blocked command from retry plan: ${cmd} ${(args || []).join(' ')}`);
        }
        const retryIsInstall = cmd === 'npm' || cmd === 'yarn' || cmd === 'pnpm' || cmd === 'pip';
        const retryTimeout = retryIsInstall ? 180_000 : 120_000;
        console.log(`▶️ [${jobId}] (retry) ${cmd} ${(args || []).join(' ')}`);
        const res = await runCmd(cmd, args, { cwd: jobDir, env: execEnv, timeout: retryTimeout });
        if (res.code !== 0) {
          throw new Error(`Retry command failed: ${cmd} ${(args || []).join(' ')}\n${safeLogChunk(res.err || res.out)}`);
        }
      }

      // Update plan metadata for PR body
      if (retryPlan.prTitle) plan.prTitle = retryPlan.prTitle;
      if (retryPlan.prBody) plan.prBody = retryPlan.prBody;
      if (retryPlan.commitMessage) plan.commitMessage = retryPlan.commitMessage;
      if (retryPlan.summaryBullets) plan.summaryBullets = retryPlan.summaryBullets;
      if (retryPlan.testPlanBullets) plan.testPlanBullets = retryPlan.testPlanBullets;

      // Check again
      r = await runCmd('git', ['status', '--porcelain'], { cwd: jobDir, env: execEnv });
      if (!r.out.trim()) {
        await recordThreadError(threadKey, {
          lastError: 'No changes produced in sandbox (after retry)',
          lastErrorJobId: jobId,
          lastErrorContext: 'git:status_clean_retry',
          lastErrorLogs: 'git status was clean after executing both plans',
        });
        throw new Error('No changes produced in sandbox (git status clean after retry).');
      }
    }

    // Commit
    r = await runCmd('git', ['add', '-A'], { cwd: jobDir, env: execEnv });
    if (r.code !== 0) {
      await recordThreadError(threadKey, {
        lastError: 'git add failed',
        lastErrorJobId: jobId,
        lastErrorContext: 'git:add',
        lastErrorLogs: clampString(safeLogChunk(r.err || r.out, 6000), 6000),
      });
      throw new Error(`git add failed:\n${safeLogChunk(r.err || r.out)}`);
    }

    const commitMsg =
      (plan.commitMessage && String(plan.commitMessage).slice(0, 120)) ||
      `openclaw: ${task}`.slice(0, 120);

    await sayProgress?.(`📦 Committing: ${commitMsg}`);

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
    await sayProgress?.(`⬆️ Pushing...`);
    r = await runCmd('git', ['push', 'origin', branch], { cwd: jobDir, env: execEnv, timeout: 60_000 });
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
    await sayProgress?.(`🔀 Opening PR...`);
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
  } finally {
    // Clean up cloned repo to prevent disk exhaustion
    fs.promises.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { sandboxFastPR };
