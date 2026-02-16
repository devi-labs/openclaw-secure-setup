'use strict';

const RATE_LIMIT_WINDOW_MS = 30_000;
const RATE_LIMIT_MAX = 6;
const rateState = new Map();

function rateLimitOk(key) {
  const now = Date.now();
  const cur = rateState.get(key);
  if (!cur || now - cur.ts > RATE_LIMIT_WINDOW_MS) {
    rateState.set(key, { ts: now, count: 1 });
    return true;
  }
  if (cur.count >= RATE_LIMIT_MAX) return false;
  cur.count += 1;
  return true;
}

module.exports = { rateLimitOk };
