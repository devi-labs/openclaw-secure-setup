#!/usr/bin/env node
// Quick diagnostic for Google Tasks API
// Usage: node test-tasks.js

// Load .env manually (no dotenv dependency)
const fs = require('fs');
try {
  const envFile = fs.readFileSync('.env', 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const key = trimmed.slice(0, trimmed.indexOf('='));
    const val = trimmed.slice(trimmed.indexOf('=') + 1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const { google } = require('googleapis');

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

console.log('── Google Tasks Diagnostic ──\n');
console.log(`Client ID:     ${clientId ? clientId.slice(0, 20) + '...' : '❌ MISSING'}`);
console.log(`Client Secret: ${clientSecret ? clientSecret.slice(0, 8) + '...' : '❌ MISSING'}`);
console.log(`Refresh Token: ${refreshToken ? refreshToken.slice(0, 10) + '...' : '❌ MISSING'}`);
console.log('');

if (!clientId || !clientSecret || !refreshToken) {
  console.log('❌ Missing credentials. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in .env');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
oauth2.setCredentials({ refresh_token: refreshToken });

const tasks = google.tasks({ version: 'v1', auth: oauth2 });

(async () => {
  // Step 1: List task lists
  console.log('1. Listing task lists...');
  try {
    const listRes = await tasks.tasklists.list();
    const lists = listRes.data.items || [];
    console.log(`   ✅ Found ${lists.length} task list(s):`);
    lists.forEach(l => console.log(`      - "${l.title}" (id: ${l.id})`));
    console.log('');
  } catch (err) {
    console.log(`   ❌ Failed: ${err.message}`);
    if (err.message.includes('insufficient')) {
      console.log('\n   👉 Your refresh token is missing the Tasks scope.');
      console.log('   Re-authorize at https://developers.google.com/oauthplayground/');
      console.log('   Make sure to select: https://www.googleapis.com/auth/tasks');
    }
    process.exit(1);
  }

  // Step 2: List tasks from @default
  console.log('2. Listing tasks from @default...');
  try {
    const taskRes = await tasks.tasks.list({ tasklist: '@default', maxResults: 10 });
    const items = taskRes.data.items || [];
    console.log(`   ✅ Found ${items.length} task(s):`);
    items.slice(0, 5).forEach(t => console.log(`      - "${t.title}" (status: ${t.status})`));
    console.log('');
  } catch (err) {
    console.log(`   ❌ Failed: ${err.message}\n`);
    process.exit(1);
  }

  // Step 3: Add a test task
  console.log('3. Adding test task...');
  try {
    const addRes = await tasks.tasks.insert({
      tasklist: '@default',
      requestBody: { title: 'OpenClaw test task — safe to delete' },
    });
    console.log(`   ✅ Added: "${addRes.data.title}" (id: ${addRes.data.id})`);
    console.log('');

    // Step 4: Delete it
    console.log('4. Deleting test task...');
    await tasks.tasks.delete({ tasklist: '@default', task: addRes.data.id });
    console.log('   ✅ Deleted');
    console.log('');
  } catch (err) {
    console.log(`   ❌ Failed: ${err.message}\n`);
    process.exit(1);
  }

  console.log('✅ Google Tasks API is working!');
})();
