'use strict';

function nowIso() {
  return new Date().toISOString();
}

function clampString(s, n) {
  return String(s || '').slice(0, n);
}

function brainObjectPath(prefix, kind, key) {
  const safe = String(key).replace(/[^a-zA-Z0-9._:@-]/g, '_');
  return `${prefix}/${kind}/${safe}.json`;
}

async function gcsReadJson(storage, bucketName, objectName) {
  try {
    const [buf] = await storage.bucket(bucketName).file(objectName).download();
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    if (e?.code === 404 || e?.statusCode === 404) return null;
    return null;
  }
}

async function gcsWriteJson(storage, bucketName, objectName, obj) {
  const text = JSON.stringify(obj, null, 2);
  await storage.bucket(bucketName).file(objectName).save(text, {
    resumable: false,
    contentType: 'application/json; charset=utf-8',
  });
}

function threadKeyFromEvent(event) {
  const threadTs = event.thread_ts || event.ts;
  return `${event.team || 'team'}:${event.channel}:${threadTs}`;
}

function repoKey(owner, repo) {
  return `${owner}/${repo}`;
}

function sanitizePlanForStorage(plan) {
  const safe = {
    prTitle: clampString(plan?.prTitle, 200),
    prBody: clampString(plan?.prBody, 6000),
    commitMessage: clampString(plan?.commitMessage, 200),
    summaryBullets: Array.isArray(plan?.summaryBullets) ? plan.summaryBullets.slice(0, 30).map((x) => clampString(x, 300)) : [],
    testPlanBullets: Array.isArray(plan?.testPlanBullets) ? plan.testPlanBullets.slice(0, 30).map((x) => clampString(x, 300)) : [],
    steps: Array.isArray(plan?.steps)
      ? plan.steps.slice(0, 40).map((st) => ({
          cmd: clampString(st?.cmd, 20),
          args: Array.isArray(st?.args) ? st.args.slice(0, 30).map((a) => clampString(a, 300)) : [],
        }))
      : [],
    verify: {
      failed: !!plan?.verify?.failed,
      logs: clampString(plan?.verify?.logs, 8000),
      commands: Array.isArray(plan?.verify?.commands)
        ? plan.verify.commands.slice(0, 10).map((cmdArr) => (Array.isArray(cmdArr) ? cmdArr.slice(0, 30).map((x) => clampString(x, 200)) : []))
        : [],
    },
  };
  return safe;
}

function createBrain({ storage, bucket, prefix }) {
  const enabled = !!storage && !!bucket;

  async function loadThread(threadKey) {
    if (!enabled) return null;
    const objPath = brainObjectPath(prefix, 'threads', threadKey);
    return await gcsReadJson(storage, bucket, objPath);
  }

  async function saveThread(threadKey, patch) {
    if (!enabled) return;
    const objPath = brainObjectPath(prefix, 'threads', threadKey);
    const existing = (await gcsReadJson(storage, bucket, objPath)) || {};
    const merged = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
      version: 1,
    };
    await gcsWriteJson(storage, bucket, objPath, merged);
  }

  async function loadRepo(owner, repo) {
    if (!enabled) return null;
    const key = repoKey(owner, repo);
    const objPath = brainObjectPath(prefix, 'repos', key);
    return await gcsReadJson(storage, bucket, objPath);
  }

  async function saveRepo(owner, repo, patch) {
    if (!enabled) return;
    const key = repoKey(owner, repo);
    const objPath = brainObjectPath(prefix, 'repos', key);
    const existing = (await gcsReadJson(storage, bucket, objPath)) || {};
    const merged = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
      version: 1,
    };
    await gcsWriteJson(storage, bucket, objPath, merged);
  }

  async function recordThreadError(threadKey, patch) {
    try {
      await saveThread(threadKey, {
        lastErrorAt: nowIso(),
        ...patch,
      });
    } catch (e) {
      // If brain is off, silently ignore.
    }
  }

  return {
    enabled,
    threadKeyFromEvent,
    loadThread,
    saveThread,
    loadRepo,
    saveRepo,
    recordThreadError,
    sanitizePlanForStorage,
  };
}

module.exports = { createBrain };
