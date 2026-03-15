'use strict';

const TELEGRAM_API = 'https://api.telegram.org/bot';
const MAX_MSG_LEN = 4096;
const POLL_TIMEOUT = 2; // long-poll timeout in seconds

function createTelegramClient(botToken) {
  if (!botToken) return null;

  const apiBase = `${TELEGRAM_API}${botToken}`;

  async function apiCall(method, body) {
    const resp = await fetch(`${apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(`Telegram API error: ${data.description || resp.statusText}`);
    }
    return data;
  }

  async function sendMessage(chatId, text) {
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, MAX_MSG_LEN));
      remaining = remaining.slice(MAX_MSG_LEN);
    }
    for (const chunk of chunks) {
      await apiCall('sendMessage', { chat_id: chatId, text: chunk });
    }
  }

  async function getUpdates(offset) {
    const data = await apiCall('getUpdates', {
      offset,
      timeout: POLL_TIMEOUT,
      allowed_updates: ['message'],
    });
    return data.result || [];
  }

  async function deleteWebhook() {
    await apiCall('deleteWebhook', {});
  }

  function startPolling(onMessage) {
    let offset = 0;
    let running = true;

    (async () => {
      // Clear any existing webhook so polling works
      await deleteWebhook();

      while (running) {
        try {
          const updates = await getUpdates(offset);
          for (const update of updates) {
            offset = update.update_id + 1;
            if (update.message) {
              onMessage(update.message);
            }
          }
        } catch (err) {
          // Log and retry after a brief pause
          console.error(`[Telegram poll error] ${err.message}`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    })();

    return () => { running = false; };
  }

  return { sendMessage, getUpdates, deleteWebhook, startPolling };
}

module.exports = { createTelegramClient };
