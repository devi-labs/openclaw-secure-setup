'use strict';

const vm = require('vm');

const MAX_HEAL_ATTEMPTS = 3;
const EXEC_TIMEOUT = 15_000;
const MAX_OUTPUT = 4000;

// ── Classification ──────────────────────────────────────────────
// Decide if a message needs a skill (actionable code) or just chat.

async function classifyRequest(anthropic, model, message, existingSkills) {
  const skillList = existingSkills.length
    ? `\nExisting skills:\n${existingSkills.map(s => `- "${s.name}": ${s.description}`).join('\n')}`
    : '';

  const resp = await anthropic.messages.create({
    model,
    max_tokens: 300,
    system:
      'You classify user messages for a Telegram bot. ' +
      'Decide if the message is an ACTIONABLE task that requires running code ' +
      '(math, conversions, data processing, lookups, text generation, formatting, analysis, etc.) ' +
      'or a CHAT question that can be answered conversationally (greetings, opinions, explanations, how-to advice). ' +
      'If an existing skill matches the request, prefer reusing it. ' +
      'Return ONLY valid JSON:\n' +
      '• {"type": "skill", "skillName": "name"} — reuse an existing skill\n' +
      '• {"type": "generate", "taskDescription": "what the code should do"} — needs a new skill\n' +
      '• {"type": "chat"} — just conversation' +
      skillList,
    messages: [{ role: 'user', content: message }],
  });

  const raw = resp.content?.find(c => c.type === 'text')?.text?.trim() || '';
  try {
    return JSON.parse(raw);
  } catch {
    return { type: 'chat' };
  }
}

// ── Skill generation ────────────────────────────────────────────
// Generate a JS function to accomplish a task. Includes error memory
// from previous failed attempts so Claude doesn't repeat mistakes.

async function generateSkill(anthropic, model, { userMessage, taskDescription, failedAttempts }) {
  const errorContext = failedAttempts?.length
    ? '\n\nPrevious attempts that FAILED (do NOT repeat these mistakes):\n' +
      failedAttempts.map((a, i) =>
        `Attempt ${i + 1}:\nCode: ${a.code?.slice(0, 500)}\nError: ${a.error}`
      ).join('\n\n')
    : '';

  const resp = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    system:
      'You generate small JavaScript functions for a Telegram bot. ' +
      'The function runs in a sandboxed VM with these globals: ' +
      'fetch, Date, Math, JSON, parseInt, parseFloat, Number, String, Array, Object, ' +
      'RegExp, Map, Set, Promise, encodeURIComponent, decodeURIComponent, ' +
      'Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, setTimeout. ' +
      'NO require, NO fs, NO process, NO eval, NO import. ' +
      'Return ONLY valid JSON:\n' +
      '{\n' +
      '  "name": "short_snake_case_name",\n' +
      '  "description": "one-line description",\n' +
      '  "code": "async function run(input) { ... return \\"result string\\"; }"\n' +
      '}\n' +
      'The `run` function receives the user\'s full message as `input` (string) and MUST return a string. ' +
      'Keep it under 60 lines. Handle errors with try/catch. ' +
      'Do NOT wrap code in markdown. The code must be valid JS that executes directly.' +
      errorContext,
    messages: [{ role: 'user', content: `User message: ${userMessage}\n\nTask: ${taskDescription}` }],
  });

  const raw = resp.content?.find(c => c.type === 'text')?.text?.trim() || '';
  try {
    const skill = JSON.parse(raw);
    if (!skill.name || !skill.code) return null;
    skill.description = skill.description || taskDescription;
    return skill;
  } catch {
    return null;
  }
}

// ── Reflexion: self-verify output ───────────────────────────────
// Ask Claude to check if the skill's output actually answers the request.

async function verifyOutput(anthropic, model, { userMessage, output }) {
  try {
    const resp = await anthropic.messages.create({
      model,
      max_tokens: 200,
      system:
        'You verify if a tool output correctly answers a user request. ' +
        'Return ONLY valid JSON: {"pass": true} or {"pass": false, "reason": "why it failed"}',
      messages: [{
        role: 'user',
        content: `User asked: ${userMessage}\n\nTool returned: ${output.slice(0, 1500)}`,
      }],
    });
    const raw = resp.content?.find(c => c.type === 'text')?.text?.trim() || '';
    return JSON.parse(raw);
  } catch {
    return { pass: true }; // if verification itself fails, don't block
  }
}

// ── Heal: diagnose and fix a failed skill ───────────────────────
// Feed the error back to Claude and get a corrected version.

async function healSkill(anthropic, model, { skill, error, userMessage, failedAttempts }) {
  const resp = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    system:
      'A JavaScript skill function failed. Diagnose the error and return a FIXED version. ' +
      'The function runs in a sandboxed VM with these globals: ' +
      'fetch, Date, Math, JSON, parseInt, parseFloat, Number, String, Array, Object, ' +
      'RegExp, Map, Set, Promise, encodeURIComponent, decodeURIComponent, ' +
      'Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa, setTimeout. ' +
      'NO require, NO fs, NO process, NO eval, NO import. ' +
      'Return ONLY valid JSON:\n' +
      '{\n' +
      '  "diagnosis": "what went wrong",\n' +
      '  "name": "same_or_updated_name",\n' +
      '  "description": "same_or_updated_description",\n' +
      '  "code": "async function run(input) { ... return \\"result\\"; }"\n' +
      '}',
    messages: [{
      role: 'user',
      content:
        `User message: ${userMessage}\n\n` +
        `Failed code:\n${skill.code.slice(0, 1500)}\n\n` +
        `Error: ${error}\n\n` +
        (failedAttempts?.length > 1
          ? `Previous failed attempts: ${failedAttempts.length}. Do something fundamentally different.\n`
          : ''),
    }],
  });

  const raw = resp.content?.find(c => c.type === 'text')?.text?.trim() || '';
  try {
    const fix = JSON.parse(raw);
    if (!fix.code) return null;
    return {
      name: fix.name || skill.name,
      description: fix.description || skill.description,
      code: fix.code,
      diagnosis: fix.diagnosis,
    };
  } catch {
    return null;
  }
}

// ── Sandboxed execution ─────────────────────────────────────────

function executeSkill(code, input, { timeout = EXEC_TIMEOUT } = {}) {
  const sandbox = {
    fetch: globalThis.fetch,
    Date, Math, JSON,
    parseInt, parseFloat, Number, String, Array, Object,
    RegExp, Map, Set, Promise,
    encodeURIComponent, decodeURIComponent,
    Buffer, URL, URLSearchParams,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    setTimeout: globalThis.setTimeout,
    console: { log: () => {}, error: () => {}, warn: () => {} },
  };

  const wrapped = `
    ${code}
    (async () => {
      const result = await run(input);
      return String(result ?? '(no result)');
    })();
  `;

  const context = vm.createContext({ ...sandbox, input });
  const script = new vm.Script(wrapped, { timeout });

  // runInContext returns a promise for async code
  return Promise.resolve(script.runInContext(context, { timeout }))
    .then(r => String(r ?? '(no result)').slice(0, MAX_OUTPUT));
}

// ── Full pipeline with self-healing loop ────────────────────────
//
// Flow (Voyager/Reflexion-inspired):
//
//   1. Classify: is this a skill request or just chat?
//   2. Match: does an existing skill handle this?
//   3. Generate: create a new skill if needed
//   4. Execute: run in VM sandbox
//   5. Verify: does the output make sense? (Reflexion)
//   6. Heal loop: if execute/verify fails, feed error to Claude,
//      get fixed code, retry (up to MAX_HEAL_ATTEMPTS)
//   7. Persist: save working skills to brain for reuse
//   8. Error memory: track failed code so heal doesn't repeat mistakes

async function runSkillPipeline({ anthropic, model, brain, threadKey, userMessage }) {
  const skills = await brain.loadSkills();

  // 1. Classify
  const classification = await classifyRequest(anthropic, model, userMessage, skills);
  if (classification.type === 'chat') return null;

  // 2. Match existing skill
  let skill = null;
  if (classification.type === 'skill' && classification.skillName) {
    skill = skills.find(s => s.name === classification.skillName) || null;
  }

  // 3. Generate new skill if no match
  if (!skill) {
    const taskDesc = classification.taskDescription || userMessage;
    skill = await generateSkill(anthropic, model, {
      userMessage,
      taskDescription: taskDesc,
      failedAttempts: [],
    });
    if (!skill) return null;
  }

  // 4–6. Execute → Verify → Heal loop
  const failedAttempts = [];

  for (let attempt = 0; attempt <= MAX_HEAL_ATTEMPTS; attempt++) {
    let output;
    let execError = null;

    // 4. Execute
    try {
      output = await executeSkill(skill.code, userMessage);
    } catch (err) {
      execError = (err?.message || String(err)).slice(0, 800);
    }

    if (execError) {
      failedAttempts.push({ code: skill.code, error: execError });

      if (attempt < MAX_HEAL_ATTEMPTS) {
        // 6. Heal
        const fixed = await healSkill(anthropic, model, {
          skill,
          error: execError,
          userMessage,
          failedAttempts,
        });
        if (fixed) {
          skill = { ...skill, ...fixed };
          continue;
        }
      }
      // All heal attempts exhausted
      await brain.recordSkillError(skill.name, execError);
      return null;
    }

    // 5. Verify (Reflexion) — only on first successful execution
    if (attempt === 0 || failedAttempts.length > 0) {
      const check = await verifyOutput(anthropic, model, {
        userMessage,
        output,
      });

      if (!check.pass) {
        const verifyError = `Verification failed: ${check.reason || 'output did not match request'}`;
        failedAttempts.push({ code: skill.code, error: verifyError });

        if (attempt < MAX_HEAL_ATTEMPTS) {
          const fixed = await healSkill(anthropic, model, {
            skill,
            error: verifyError,
            userMessage,
            failedAttempts,
          });
          if (fixed) {
            skill = { ...skill, ...fixed };
            continue;
          }
        }
        // Verification keeps failing — return the output anyway with a warning
        return {
          result: `⚠️ Result may be inaccurate:\n\n${output}`,
          skill,
          reused: false,
          healed: failedAttempts.length > 0,
        };
      }
    }

    // 7. Persist — save the working skill
    skill.createdAt = skill.createdAt || new Date().toISOString();
    skill.lastUsedAt = new Date().toISOString();
    skill.successCount = (skill.successCount || 0) + 1;
    if (failedAttempts.length > 0) {
      skill.healedAt = new Date().toISOString();
    }
    await brain.saveSkill(skill);

    return {
      result: output,
      skill,
      reused: classification.type === 'skill',
      healed: failedAttempts.length > 0,
    };
  }

  return null; // should not reach here
}

module.exports = {
  classifyRequest,
  generateSkill,
  verifyOutput,
  healSkill,
  executeSkill,
  runSkillPipeline,
};
