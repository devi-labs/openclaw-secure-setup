'use strict';

/**
 * Unified LLM client that works with both Anthropic and OpenAI
 */
async function callLLM({ provider, anthropic, openai, model, maxTokens, system, messages }) {
  if (provider === 'openai' && openai) {
    // Convert to OpenAI format
    const openaiMessages = [
      { role: 'system', content: system },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const response = await openai.chat.completions.create({
      model: model || 'gpt-4-turbo-preview',
      messages: openaiMessages,
      max_tokens: maxTokens,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || '';
  }

  // Default to Anthropic
  if (!anthropic) {
    throw new Error('No LLM provider configured (ANTHROPIC_API_KEY or OPENAI_API_KEY required)');
  }

  const response = await anthropic.messages.create({
    model: model || 'claude-opus-4-6',
    max_tokens: maxTokens,
    system,
    messages,
  });

  return response.content?.find((c) => c.type === 'text')?.text?.trim() || '';
}

module.exports = { callLLM };
