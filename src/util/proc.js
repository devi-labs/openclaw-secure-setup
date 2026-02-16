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
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

function commandAllowed(cmd, args) {
  const allow = new Set(['git', 'npm', 'node']);
  if (!allow.has(cmd)) return false;

  const joined = [cmd, ...args].join(' ').toLowerCase();

  const blocked = [
    'bash -c',
    'sh -c',
    'curl',
    'wget',
    'nc ',
    'netcat',
    'ssh ',
    'scp ',
    'sftp',
  ];
  if (blocked.some((b) => joined.includes(b))) return false;

  return true;
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      ...opts,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString('utf8')));
    p.stderr.on('data', (d) => (err += d.toString('utf8')));

    p.on('error', reject);
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

module.exports = {
  makeJobId,
  safeLogChunk,
  httpsRepoUrl,
  commandAllowed,
  runCmd,
};
