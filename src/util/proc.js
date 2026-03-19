'use strict';

const crypto = require('crypto');
const { spawn } = require('child_process');

function makeJobId() {
  return crypto.randomBytes(6).toString('hex');
}

function safeLogChunk(s, max = 3500) {
  const text = String(s || '');
  return text.length > max ? text.slice(0, max) + '\n…(truncated)…\n' : text;
}

function httpsRepoUrl(owner, repo, token) {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`;
}

function commandAllowed() {
  return true;
}

function runCmd(cmd, args, opts = {}) {
  const { timeout = 120_000, ...spawnOpts } = opts;

  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      ...spawnOpts,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      p.kill('SIGKILL');
    }, timeout);

    p.stdout.on('data', (d) => (out += d.toString('utf8')));
    p.stderr.on('data', (d) => (err += d.toString('utf8')));

    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ code: 1, out, err: err + `\n(killed: timed out after ${timeout / 1000}s)` });
      } else {
        resolve({ code, out, err });
      }
    });
  });
}

module.exports = {
  makeJobId,
  safeLogChunk,
  httpsRepoUrl,
  commandAllowed,
  runCmd,
};
