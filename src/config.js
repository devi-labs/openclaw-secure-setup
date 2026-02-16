'use strict';

const config = {
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-opus-4-6',
  },
  github: {
    token: process.env.GITHUB_TOKEN,
  },
  gcp: {
    projectId: process.env.GCP_PROJECT_ID || '',
    region: process.env.GCP_REGION || '',
    brainBucket: process.env.OPENCLAW_BRAIN_BUCKET || '',
    brainPrefix: (process.env.OPENCLAW_BRAIN_PREFIX || 'openclaw-brain').replace(/\/+$/, ''),
  },
  workdir: process.env.OPENCLAW_WORKDIR || '/tmp/openclaw-jobs',
  runTests: process.env.OPENCLAW_RUN_TESTS === '1',
  port: process.env.PORT || 8080,
};

module.exports = { config };
