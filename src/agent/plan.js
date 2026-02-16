'use strict';

function clampString(s, n) {
  return String(s || '').slice(0, n);
}

function extractJsonFromText(text) {
  const s = String(text || '').trim();

  // Strip leading ```json or ``` so we always work with raw content
  let content = s.replace(/^\s*```(?:json)?\s*/i, '').trim();
  // If there was a closing ```, strip it (fenced block complete)
  const closingFence = content.indexOf('```');
  if (closingFence !== -1) content = content.slice(0, closingFence).trim();

  // Find first { and last } (handles truncated JSON when closing ``` was never sent)
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return content.slice(start, end + 1).trim();
  }
  if (start !== -1) return content.slice(start).trim(); // truncated, try parsing anyway
  return content;
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Try to repair JSON truncated mid-response (e.g. cut off inside prBody string).
function parsePlanJson(extracted) {
  let json = safeJsonParse(extracted);
  if (json) return json;
  const t = (extracted || '').trim();
  if (t.length < 20) return null;
  // Truncation often leaves unclosed string or object; try closing minimally.
  const repairSuffixes = ['"}', '"}', '}', ']"}', ']}'];
  for (const suf of repairSuffixes) {
    json = safeJsonParse(t + suf);
    if (json && json.prTitle != null && Array.isArray(json.steps)) return json;
  }
  return null;
}

async function claudeSandboxPlan({ anthropic, model, owner, repo, task, defaultBranch, threadMemory, repoMemory, repoContext, threadKey, jobId, recordThreadError }) {
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY missing');

  const system =
    'You are OpenClaw, a senior software engineer controlling a sandbox runner. ' +
    'Return STRICT JSON only. No markdown. No commentary. ' +
    'Optimize for FAST PR creation; build/tests are secondary.';

  const repoContextBlock = repoContext
    ? [
        '',
        'Current repo state (use this to decide bootstrap vs modify):',
        `- Top-level paths: ${(repoContext.rootPaths || []).join(', ') || '(empty repo)'}`,
        `- Description: ${(repoContext.description || '').slice(0, 200)}`,
        `- README (excerpt): ${(repoContext.readmeSnippet || '').slice(0, 1500)}`,
      ].join('\n')
    : '';

  const lastErrorHint =
    threadMemory?.lastError
      ? `\n\nPrevious run in this thread failed: "${String(threadMemory.lastError).slice(0, 200)}". Avoid repeating (e.g. output raw JSON only, no markdown fences).`
      : '';

  const prompt = [
    'Create an execution plan to implement the task in a fresh cloned repo checkout.',
    '',
    'Return JSON ONLY, shape:',
    '{',
    '  "prTitle": string,',
    '  "prBody": string,',
    '  "commitMessage": string,',
    '  "summaryBullets": string[],',
    '  "testPlanBullets": string[],',
    '  "steps": [{ "cmd": "git"|"npm"|"node", "args": string[] }],',
    '  "verify": { "commands": string[][] }',
    '}',
    '',
    'Guidance:',
    '- Allowed commands: git, npm, node only (no npx).',
    '- For SPEED, prefer minimal manual setup over scaffolding tools:',
    '  * Write package.json with node -e (just react, react-dom, vite as deps)',
    '  * npm install',
    '  * Write minimal src/App.jsx, index.html, vite.config.js with node -e',
    '  (Avoid npm create vite - it\'s slow. Write minimal files directly.)',
    '- If repo already has package.json / src/, add or edit files with node -e "require(\'fs\').writeFileSync(...)" — one file per step, keep payloads under 2000 chars.',
    '- Do NOT use shell wrappers (no bash -c / sh -c). Do NOT use curl/wget.',
    '- IMPORTANT: Output MUST be raw JSON only (no ``` fences).',
    '- Keep prBody and summaryBullets brief (1-2 short sentences) so the full plan fits in one response.',
    repoContextBlock,
    lastErrorHint,
    '',
    'Thread memory (may be empty):',
    JSON.stringify(threadMemory || {}, null, 2).slice(0, 5000),
    '',
    'Repo memory (may be empty):',
    JSON.stringify(repoMemory || {}, null, 2).slice(0, 5000),
    '',
    `Repo: ${owner}/${repo}`,
    `Default branch: ${defaultBranch}`,
    `Task: ${task}`,
    '',
    'Output must be valid JSON only.',
  ].join('\n');

  const resp = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = resp.content?.find((c) => c.type === 'text')?.text?.trim() || '';
  const extracted = extractJsonFromText(raw);
  let json = parsePlanJson(extracted);

  if (!json) {
    // Capture raw snippet for this thread (safe, truncated)
    await recordThreadError(threadKey, {
      lastError: 'Claude plan returned invalid JSON (first pass).',
      lastErrorJobId: jobId,
      lastErrorContext: `planning:parse:first_pass`,
      lastClaudeRawSnippet: clampString(raw, 1800),
    });

    // ONE repair pass
    const repairPrompt = [
      'You returned invalid JSON.',
      'Return ONLY valid JSON for the plan. No markdown, no backticks, no commentary.',
      '',
      'Here is your previous output (for reference):',
      raw.slice(0, 12000),
      '',
      'Return ONLY valid JSON with the required keys.',
    ].join('\n');

    const repair = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: 'Return ONLY valid JSON. No markdown. Keep prBody and summaryBullets very short.',
      messages: [{ role: 'user', content: repairPrompt }],
    });

    const raw2 = repair.content?.find((c) => c.type === 'text')?.text?.trim() || '';
    const extracted2 = extractJsonFromText(raw2);
    json = parsePlanJson(extracted2);

    if (!json) {
      await recordThreadError(threadKey, {
        lastError: 'Claude plan returned invalid JSON (repair pass).',
        lastErrorJobId: jobId,
        lastErrorContext: `planning:parse:repair_pass`,
        lastClaudeRawSnippet: clampString(raw2, 1800),
      });
    }
  }

  if (!json) {
    throw new Error(`Claude plan JSON parse failed. Got: ${raw.slice(0, 220)}`);
  }

  // clamps
  json.steps = (Array.isArray(json.steps) ? json.steps : []).slice(0, 30);
  json.verify = json.verify || { commands: [] };
  json.verify.commands = (Array.isArray(json.verify.commands) ? json.verify.commands : []).slice(0, 6);

  return json;
}

module.exports = { claudeSandboxPlan };
