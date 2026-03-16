'use strict';

const config = {
  // Messaging platform: 'telegram'
  messagingPlatform: process.env.MESSAGING_PLATFORM || 'telegram',
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUserIds: process.env.TELEGRAM_ALLOWED_USER_IDS || '',
    joinCode: process.env.TELEGRAM_JOIN_CODE || '',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-6',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-5',
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || '',
    userEmail: process.env.GMAIL_USER_EMAIL || '',
  },
  llmProvider: process.env.LLM_PROVIDER || 'anthropic', // 'anthropic' or 'openai'
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
