'use strict';

const http = require('http');
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,         // xoxb-...
  appToken: process.env.SLACK_APP_TOKEN,      // xapp-...
  socketMode: true
});

// Basic health endpoint (optional, but good for ops)
const health = http.createServer((_, res) => {
  if (_.url === '/healthz' && _.method === 'GET') {
    res.writeHead(200);
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end();
  }
});
health.listen(process.env.PORT || 8080, '0.0.0.0');

// Respond when mentioned: "@openclaw hi"
app.event('app_mention', async ({ event, say }) => {
  const text = (event.text || '').trim();
  await say(`👋 I heard: "${text}"`);
});

// Simple slash command example (optional):
// Configure /openclaw in Slack → points to nothing in Socket Mode; Bolt will receive it via socket.
app.command('/openclaw', async ({ ack, respond, command }) => {
  await ack();
  await respond(`You said: ${command.text || '(nothing)'}`);
});

(async () => {
  await app.start(); // Socket Mode starts without a port
  console.log('⚡️ OpenClaw Slack bot running (Socket Mode)');
})();
