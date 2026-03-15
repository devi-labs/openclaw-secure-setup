'use strict';

const config = {
  // Messaging platform: 'slack' or 'sms'
  messagingPlatform: process.env.MESSAGING_PLATFORM || 'slack',
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    allowedNumber: process.env.TWILIO_ALLOWED_NUMBER || '',
    useWhatsApp: process.env.TWILIO_USE_WHATSAPP === '1',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUserIds: process.env.TELEGRAM_ALLOWED_USER_IDS || '',
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
