'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { executeSkill } = require('../src/skills');

describe('executeSkill', () => {
  it('runs a simple sync skill', async () => {
    const code = 'async function run(input) { return "hello " + input; }';
    const result = await executeSkill(code, 'world');
    assert.equal(result, 'hello world');
  });

  it('runs a skill with math', async () => {
    const code = 'async function run(input) { return String(2 + 2); }';
    const result = await executeSkill(code, '');
    assert.equal(result, '4');
  });

  it('runs a skill using JSON', async () => {
    const code = `async function run(input) {
      const obj = JSON.parse('{"a":1}');
      return JSON.stringify({ result: obj.a + 1 });
    }`;
    const result = await executeSkill(code, '');
    assert.equal(result, '{"result":2}');
  });

  it('runs a skill using Date', async () => {
    const code = 'async function run(input) { return new Date().getFullYear().toString(); }';
    const result = await executeSkill(code, '');
    assert.equal(result, '2026');
  });

  it('truncates output to 4000 chars', async () => {
    const code = 'async function run(input) { return "x".repeat(10000); }';
    const result = await executeSkill(code, '');
    assert.equal(result.length, 4000);
  });

  it('returns "(no result)" for undefined return', async () => {
    const code = 'async function run(input) { }';
    const result = await executeSkill(code, '');
    assert.equal(result, '(no result)');
  });

  it('throws on syntax error', async () => {
    const code = 'async function run(input) { return @@@ }';
    assert.throws(() => executeSkill(code, ''), /SyntaxError|Invalid or unexpected/);
  });

  it('throws on timeout', async () => {
    const code = 'async function run(input) { while(true){} }';
    assert.throws(() => executeSkill(code, '', { timeout: 100 }), /timed out|timeout/i);
  });

  it('cannot access require', async () => {
    const code = 'async function run(input) { return typeof require; }';
    const result = await executeSkill(code, '');
    assert.equal(result, 'undefined');
  });

  it('cannot access process', async () => {
    const code = 'async function run(input) { return typeof process; }';
    const result = await executeSkill(code, '');
    assert.equal(result, 'undefined');
  });

  it('has access to URL and URLSearchParams', async () => {
    const code = `async function run(input) {
      const u = new URL('https://example.com?a=1');
      return u.searchParams.get('a');
    }`;
    const result = await executeSkill(code, '');
    assert.equal(result, '1');
  });

  it('has access to Buffer', async () => {
    const code = 'async function run(input) { return Buffer.from("hello").toString("base64"); }';
    const result = await executeSkill(code, '');
    assert.equal(result, 'aGVsbG8=');
  });

  it('has access to encodeURIComponent', async () => {
    const code = 'async function run(input) { return encodeURIComponent("hello world"); }';
    const result = await executeSkill(code, '');
    assert.equal(result, 'hello%20world');
  });
});
