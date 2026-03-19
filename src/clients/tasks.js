'use strict';

const { google } = require('googleapis');

function createTasksClient({ clientId, clientSecret, refreshToken }) {
  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  const tasks = google.tasks({ version: 'v1', auth: oauth2 });

  async function listTasks({ maxResults = 100, showCompleted = false } = {}) {
    const res = await tasks.tasks.list({
      tasklist: '@default',
      maxResults,
      showCompleted,
      showHidden: false,
    });

    return (res.data.items || []).map(t => ({
      id: t.id,
      title: t.title || '(untitled)',
      notes: t.notes || '',
      due: t.due || '',
      status: t.status || 'needsAction',
      completed: t.status === 'completed',
    }));
  }

  async function addTask({ title, notes, due }) {
    const body = { title };
    if (notes) body.notes = notes;
    if (due) body.due = new Date(due).toISOString();

    const res = await tasks.tasks.insert({
      tasklist: '@default',
      requestBody: body,
    });

    return {
      id: res.data.id,
      title: res.data.title,
    };
  }

  async function completeTask(taskId) {
    const res = await tasks.tasks.patch({
      tasklist: '@default',
      task: taskId,
      requestBody: { status: 'completed' },
    });

    return { id: res.data.id, title: res.data.title };
  }

  async function deleteTask(taskId) {
    await tasks.tasks.delete({
      tasklist: '@default',
      task: taskId,
    });
  }

  return { listTasks, addTask, completeTask, deleteTask, enabled: true };
}

module.exports = { createTasksClient };
