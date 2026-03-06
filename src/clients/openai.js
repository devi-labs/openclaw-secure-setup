'use strict';

const OpenAI = require('openai');

function createOpenAIClient(apiKey) {
  return apiKey ? new OpenAI({ apiKey }) : null;
}

module.exports = { createOpenAIClient };
