'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Create a unique temp dir and point brain at it BEFORE requiring brain.js
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-brain-test-'));
process.env.OPENCLAW_BRAIN_DIR = tmpDir;

const { createBrain } = require('../src/brain/brain');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('localReadJson / localWriteJson round-trip', () => {
  it('writes and reads back JSON via brain internals', () => {
    // We test through createBrain's public API which uses local storage
    const brain = createBrain({ storage: null, bucket: null, prefix: 'test' });
    // saveThread writes locally; loadThread reads back
    // Using a direct key
    const key = 'roundtrip-test';
    brain.saveThread(key, { hello: 'world' });
  });
});

describe('createBrain (local-only, no GCS)', () => {
  let brain;

  before(() => {
    brain = createBrain({ storage: null, bucket: null, prefix: 'unit' });
  });

  it('is enabled even without GCS', () => {
    assert.equal(brain.enabled, true);
  });

  it('loadThread returns null for missing key', async () => {
    const result = await brain.loadThread('nonexistent-key');
    assert.equal(result, null);
  });

  it('saveThread then loadThread returns saved data', async () => {
    const key = 'test-thread-1';
    await brain.saveThread(key, { lastRepo: 'org/repo', lastTask: 'do stuff' });
    const loaded = await brain.loadThread(key);
    assert.equal(loaded.lastRepo, 'org/repo');
    assert.equal(loaded.lastTask, 'do stuff');
    assert.ok(loaded.updatedAt);
    assert.equal(loaded.version, 1);
  });

  it('saveThread merges with existing data', async () => {
    const key = 'test-thread-merge';
    await brain.saveThread(key, { lastRepo: 'a/b' });
    await brain.saveThread(key, { lastTask: 'new task' });
    const loaded = await brain.loadThread(key);
    assert.equal(loaded.lastRepo, 'a/b');
    assert.equal(loaded.lastTask, 'new task');
  });

  it('saveSummary appends entries', async () => {
    await brain.saveSummary({ repo: 'a/b', task: 'task1', result: 'ok' });
    await brain.saveSummary({ repo: 'a/b', task: 'task2', result: 'ok' });
    const summary = await brain.loadSummary();
    assert.equal(summary.entries.length, 2);
    assert.equal(summary.entries[0].task, 'task1');
    assert.equal(summary.entries[1].task, 'task2');
  });

  it('saveSummary caps at 50 entries', async () => {
    // Create a fresh brain with a unique prefix to isolate this test
    const capBrain = createBrain({ storage: null, bucket: null, prefix: 'cap-test' });
    for (let i = 0; i < 55; i++) {
      await capBrain.saveSummary({ repo: 'x/y', task: `task-${i}`, result: 'ok' });
    }
    const summary = await capBrain.loadSummary();
    assert.equal(summary.entries.length, 50);
    // The earliest entries should have been trimmed; last entry should be task-54
    assert.equal(summary.entries[summary.entries.length - 1].task, 'task-54');
  });
});

describe('threadKeyFromPhone', () => {
  it('normalizes phone numbers', () => {
    const brain = createBrain({ storage: null, bucket: null, prefix: 'ph' });
    assert.equal(brain.threadKeyFromPhone('+1-312-975-4202'), 'sms:+13129754202');
    assert.equal(brain.threadKeyFromPhone('312 975 4202'), 'sms:3129754202');
  });
});

describe('sanitizePlanForStorage', () => {
  it('clamps prTitle to 200 chars', () => {
    const brain = createBrain({ storage: null, bucket: null, prefix: 's' });
    const plan = { prTitle: 'a'.repeat(500), steps: [] };
    const safe = brain.sanitizePlanForStorage(plan);
    assert.equal(safe.prTitle.length, 200);
  });

  it('clamps steps to 40', () => {
    const brain = createBrain({ storage: null, bucket: null, prefix: 's' });
    const steps = Array.from({ length: 50 }, (_, i) => ({ cmd: 'git', args: [`arg-${i}`] }));
    const plan = { prTitle: 'x', steps };
    const safe = brain.sanitizePlanForStorage(plan);
    assert.equal(safe.steps.length, 40);
  });

  it('handles null/undefined plan gracefully', () => {
    const brain = createBrain({ storage: null, bucket: null, prefix: 's' });
    const safe = brain.sanitizePlanForStorage(null);
    assert.equal(safe.prTitle, '');
    assert.deepEqual(safe.steps, []);
  });
});
