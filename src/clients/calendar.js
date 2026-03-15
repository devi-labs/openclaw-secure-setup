'use strict';

const { google } = require('googleapis');

function createCalendarClient({ clientId, clientSecret, refreshToken }) {
  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2 });

  function parseDuration(dur) {
    const match = dur.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
    if (!match) return 60;
    return (parseInt(match[1] || '0', 10) * 60) + parseInt(match[2] || '0', 10);
  }

  function resolveDate(dateStr) {
    const lower = dateStr.toLowerCase();
    const now = new Date();
    if (lower === 'today') return now.toISOString().split('T')[0];
    if (lower === 'tomorrow') {
      now.setDate(now.getDate() + 1);
      return now.toISOString().split('T')[0];
    }
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayIdx = days.indexOf(lower);
    if (dayIdx !== -1) {
      const diff = (dayIdx - now.getDay() + 7) % 7 || 7;
      now.setDate(now.getDate() + diff);
      return now.toISOString().split('T')[0];
    }
    return dateStr; // assume YYYY-MM-DD
  }

  function formatEvent(ev) {
    const start = ev.start?.dateTime || ev.start?.date || '?';
    const end = ev.end?.dateTime || ev.end?.date || '?';
    const attendees = (ev.attendees || []).map(a => a.email).join(', ');
    return [
      `${ev.summary || '(no title)'} [${ev.id}]`,
      `  When: ${start} → ${end}`,
      ev.location ? `  Where: ${ev.location}` : null,
      attendees ? `  Who: ${attendees}` : null,
      ev.description ? `  Note: ${ev.description.slice(0, 200)}` : null,
    ].filter(Boolean).join('\n');
  }

  async function listEvents({ timeMin, timeMax, maxResults = 10 } = {}) {
    const now = new Date();
    if (!timeMin) {
      timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    }
    if (!timeMax) {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timeMax = end.toISOString();
    }

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (res.data.items || []).map(ev => ({
      id: ev.id,
      summary: ev.summary || '(no title)',
      start: ev.start?.dateTime || ev.start?.date || '',
      end: ev.end?.dateTime || ev.end?.date || '',
      location: ev.location || '',
      attendees: (ev.attendees || []).map(a => a.email),
      description: ev.description || '',
      formatted: formatEvent(ev),
    }));
  }

  async function getEvent(eventId) {
    const res = await calendar.events.get({
      calendarId: 'primary',
      eventId,
    });
    const ev = res.data;
    return {
      id: ev.id,
      summary: ev.summary || '(no title)',
      start: ev.start?.dateTime || ev.start?.date || '',
      end: ev.end?.dateTime || ev.end?.date || '',
      location: ev.location || '',
      attendees: (ev.attendees || []).map(a => a.email),
      description: ev.description || '',
      htmlLink: ev.htmlLink || '',
      formatted: formatEvent(ev),
    };
  }

  async function createEvent({ summary, description, date, time, duration, attendees, location }) {
    const dateStr = resolveDate(date);
    const minutes = parseDuration(duration || '1h');

    const startDt = new Date(`${dateStr}T${time}:00`);
    const endDt = new Date(startDt.getTime() + minutes * 60 * 1000);

    const event = {
      summary,
      description: description || '',
      start: { dateTime: startDt.toISOString() },
      end: { dateTime: endDt.toISOString() },
    };

    if (location) event.location = location;

    if (attendees && attendees.length) {
      event.attendees = attendees.map(email => ({ email: email.trim() }));
    }

    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      sendUpdates: attendees?.length ? 'all' : 'none',
    });

    return {
      id: res.data.id,
      htmlLink: res.data.htmlLink,
      summary: res.data.summary,
      start: res.data.start?.dateTime || res.data.start?.date,
    };
  }

  async function updateEvent(eventId, updates) {
    // Fetch current event first
    const current = await calendar.events.get({
      calendarId: 'primary',
      eventId,
    });

    const ev = current.data;

    if (updates.summary) ev.summary = updates.summary;
    if (updates.description) ev.description = updates.description;
    if (updates.location) ev.location = updates.location;

    if (updates.time) {
      const currentStart = new Date(ev.start?.dateTime || ev.start?.date);
      const currentEnd = new Date(ev.end?.dateTime || ev.end?.date);
      const durationMs = currentEnd.getTime() - currentStart.getTime();

      const dateStr = currentStart.toISOString().split('T')[0];
      const newStart = new Date(`${dateStr}T${updates.time}:00`);
      const newEnd = new Date(newStart.getTime() + durationMs);

      ev.start = { dateTime: newStart.toISOString() };
      ev.end = { dateTime: newEnd.toISOString() };
    }

    if (updates.date) {
      const resolved = resolveDate(updates.date);
      const currentStart = new Date(ev.start?.dateTime || ev.start?.date);
      const currentEnd = new Date(ev.end?.dateTime || ev.end?.date);
      const durationMs = currentEnd.getTime() - currentStart.getTime();

      const timeStr = currentStart.toISOString().split('T')[1];
      const newStart = new Date(`${resolved}T${timeStr}`);
      const newEnd = new Date(newStart.getTime() + durationMs);

      ev.start = { dateTime: newStart.toISOString() };
      ev.end = { dateTime: newEnd.toISOString() };
    }

    if (updates.duration) {
      const minutes = parseDuration(updates.duration);
      const startDt = new Date(ev.start?.dateTime || ev.start?.date);
      ev.end = { dateTime: new Date(startDt.getTime() + minutes * 60 * 1000).toISOString() };
    }

    if (updates.attendees) {
      ev.attendees = updates.attendees.map(email => ({ email: email.trim() }));
    }

    const hasAttendees = ev.attendees?.length > 0;

    const res = await calendar.events.update({
      calendarId: 'primary',
      eventId,
      requestBody: ev,
      sendUpdates: hasAttendees ? 'all' : 'none',
    });

    return {
      id: res.data.id,
      htmlLink: res.data.htmlLink,
      summary: res.data.summary,
    };
  }

  async function deleteEvent(eventId) {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
      sendUpdates: 'all',
    });
  }

  return { listEvents, getEvent, createEvent, updateEvent, deleteEvent, resolveDate, parseDuration, enabled: true };
}

module.exports = { createCalendarClient };
