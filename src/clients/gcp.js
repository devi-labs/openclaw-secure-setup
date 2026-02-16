'use strict';

const fs = require('fs');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const { google } = require('googleapis');

function loadGcpCredentialsMaybe() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;

  const b64 = process.env.GCP_SA_KEY_B64;
  if (!b64) return;

  const json = Buffer.from(b64, 'base64').toString('utf8');
  const dir = '/tmp/openclaw-secrets';
  const fp = path.join(dir, 'gcp-sa.json');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(fp, json, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = fp;
}

function createStorageClient(projectId) {
  // If GOOGLE_APPLICATION_CREDENTIALS is set, it will use that file.
  // Otherwise on Cloud Run it will use ADC (the service account attached to the service).
  return projectId ? new Storage({ projectId }) : new Storage();
}

async function getRunClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const authClient = await auth.getClient();
  google.options({ auth: authClient });
  return google.run('v2');
}

module.exports = { loadGcpCredentialsMaybe, createStorageClient, getRunClient };
