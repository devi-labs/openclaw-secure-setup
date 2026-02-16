'use strict';

const { config } = require('./src/config');
const { startHealthServer } = require('./src/http');
const { loadGcpCredentialsMaybe, createStorageClient } = require('./src/clients/gcp');
const { createAnthropicClient } = require('./src/clients/anthropic');
const { createOctokit } = require('./src/clients/github');
const { createBrain } = require('./src/brain/brain');
const { startSlackApp } = require('./src/app');

(async () => {
  console.log('Starting OpenClaw...');
  const startTime = Date.now();
  
  // Load GCP credentials if needed
  loadGcpCredentialsMaybe();

  // Create clients
  const anthropic = createAnthropicClient(config.anthropic.apiKey);
  const octokit = createOctokit(config.github.token);
  const storage = createStorageClient(config.gcp.projectId);

  // Create brain
  const brain = createBrain({
    storage,
    bucket: config.gcp.brainBucket,
    prefix: config.gcp.brainPrefix,
  });

  // Start health server
  startHealthServer(config.port);

  // Start Slack app
  await startSlackApp({ config, anthropic, octokit, storage, brain });
  
  console.log(`OpenClaw started in ${Date.now() - startTime}ms`);
})();
