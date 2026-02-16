'use strict';

const Anthropic = require('@anthropic-ai/sdk');

function createAnthropicClient(apiKey) {
  return apiKey ? new Anthropic({ apiKey }) : null;
}

module.exports = { createAnthropicClient };
