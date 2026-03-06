'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { extractJsonFromText, parsePlanJson } = require('../src/agent/plan');

describe('extractJsonFromText', () => {
  it('extracts raw JSON object', () => {
    const input = '{"prTitle":"fix","steps":[]}';
    assert.equal(extractJsonFromText(input), '{"prTitle":"fix","steps":[]}');
  });

  it('extracts JSON from ```json fenced block', () => {
    const input = '```json\n{"prTitle":"fix","steps":[]}\n```';
    const result = extractJsonFromText(input);
    assert.equal(result, '{"prTitle":"fix","steps":[]}');
  });

  it('extracts JSON from ``` fenced block (no language)', () => {
    const input = '```\n{"a":1}\n```';
    assert.equal(extractJsonFromText(input), '{"a":1}');
  });

  it('handles truncated JSON (no closing brace)', () => {
    const input = '{"prTitle":"fix","prBody":"some long text';
    const result = extractJsonFromText(input);
    assert.ok(result.startsWith('{"prTitle":'));
  });

  it('strips surrounding text', () => {
    const input = 'Here is the plan:\n{"a":1}\nDone.';
    assert.equal(extractJsonFromText(input), '{"a":1}');
  });
});

describe('parsePlanJson', () => {
  it('parses valid plan JSON', () => {
    const json = JSON.stringify({
      prTitle: 'Add feature',
      prBody: 'Implements X',
      commitMessage: 'feat: add X',
      summaryBullets: ['added X'],
      testPlanBullets: ['test X'],
      steps: [{ cmd: 'git', args: ['add', '.'] }],
      verify: { commands: [['npm', 'test']] },
    });
    const result = parsePlanJson(json);
    assert.equal(result.prTitle, 'Add feature');
    assert.equal(result.steps.length, 1);
  });

  it('repairs truncated plan JSON', () => {
    const base = {
      prTitle: 'Fix bug',
      prBody: 'Fixes the bug',
      commitMessage: 'fix: bug',
      summaryBullets: ['fixed'],
      testPlanBullets: [],
      steps: [{ cmd: 'git', args: ['commit', '-m', 'fix'] }],
      verify: { commands: [] },
    };
    // Simulate truncation: cut off the last few chars
    const full = JSON.stringify(base);
    const truncated = full.slice(0, -1); // remove final }
    const result = parsePlanJson(truncated);
    assert.ok(result, 'should repair and parse');
    assert.equal(result.prTitle, 'Fix bug');
  });

  it('returns null for garbage input', () => {
    assert.equal(parsePlanJson('this is not json at all'), null);
  });

  it('returns parsed object for minimal valid JSON', () => {
    // '{}' is valid JSON — parsePlanJson returns it as-is
    const result = parsePlanJson('{}');
    assert.deepEqual(result, {});
  });

  it('returns null for short non-JSON', () => {
    assert.equal(parsePlanJson('hello'), null);
  });
});
