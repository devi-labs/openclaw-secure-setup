'use strict';

// Helper: parse comma-separated env string into array
function parseList(s) {
  return (s || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Fetch recent tweets for a handle via X API v2
async function fetchTweets(bearerToken, handle) {
  try {
    const userResp = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (!userResp.ok) return [];
    const userData = await userResp.json();
    const userId = userData.data?.id;
    if (!userId) return [];

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tweetsResp = await fetch(
      `https://api.x.com/2/users/${userId}/tweets?max_results=10&start_time=${since}&tweet.fields=created_at,text`,
      { headers: { Authorization: `Bearer ${bearerToken}` } },
    );
    if (!tweetsResp.ok) return [];
    const tweetsData = await tweetsResp.json();
    return (tweetsData.data || []).map(t => ({
      text: t.text,
      date: t.created_at ? new Date(t.created_at).toLocaleDateString() : '',
    }));
  } catch (err) {
    console.error(`[roundup] Twitter fetch error for @${handle}:`, err?.message || err);
    return [];
  }
}

// Fetch news via Google News RSS
async function fetchNewsRSS(topic, maxItems = 10) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
      const block = match[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
      const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
      const cleanTitle = title
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
      items.push({ title: cleanTitle, link, date: pubDate });
    }
    return items;
  } catch (err) {
    console.error(`[roundup] News fetch error for "${topic}":`, err?.message || err);
    return [];
  }
}

// Fetch LinkedIn activity for a person (best effort via Google News)
async function fetchLinkedInUpdates(name) {
  const displayName = name.replace(/-/g, ' ');
  return fetchNewsRSS(`${displayName} linkedin`, 5);
}

// Use Claude to compile a digest
async function compileDigest(anthropic, model, sections, kind) {
  try {
    const rawContent = sections.map(s => `## ${s.heading}\n${s.items.join('\n')}`).join('\n\n');

    const resp = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      system:
        `You are OpenClaw's digest writer. Compile these raw items into a clean, scannable ${kind} email digest. ` +
        'Keep it concise — short summaries, bullet points, include all links. ' +
        'Do not invent information. Do not add items that are not in the source data.',
      messages: [{ role: 'user', content: `Compile this into a readable ${kind} digest email:\n\n${rawContent}` }],
    });

    return resp.content?.find(c => c.type === 'text')?.text?.trim() || rawContent;
  } catch (err) {
    console.error('[roundup] Claude digest error:', err?.message || err);
    return sections.map(s => `${s.heading}\n${s.items.join('\n')}`).join('\n\n');
  }
}

// ── Daily Roundup ────────────────────────────────────────────────
// News topics + Twitter + LinkedIn, sent every day

async function sendDailyRoundup({ config, anthropic, gmail }) {
  const rc = config.roundup;
  const dailyTopics = parseList(rc.dailyTopics);
  const handles = parseList(rc.twitterHandles);
  const linkedinNames = parseList(rc.linkedinNames);

  if (!dailyTopics.length && !handles.length && !linkedinNames.length) return;
  if (!gmail?.enabled) { console.log('[roundup] Gmail not configured, skipping daily roundup'); return; }
  if (!rc.emailTo) { console.log('[roundup] ROUNDUP_EMAIL_TO not set, skipping'); return; }

  console.log('[roundup] Building daily roundup...');
  const sections = [];

  // News
  if (dailyTopics.length) {
    for (const topic of dailyTopics) {
      const articles = await fetchNewsRSS(topic, 5);
      if (articles.length) {
        sections.push({
          heading: `📰 ${topic}`,
          items: articles.map(a => `• ${a.title} — ${a.link}`),
        });
      }
    }
  }

  // Twitter
  if (handles.length && rc.xBearerToken) {
    const allTweets = [];
    for (const handle of handles) {
      const tweets = await fetchTweets(rc.xBearerToken, handle);
      allTweets.push(...tweets.map(t => `@${handle}: ${t.text} (${t.date})`));
    }
    if (allTweets.length) sections.push({ heading: '🐦 Twitter/X', items: allTweets });
  }

  // LinkedIn
  if (linkedinNames.length) {
    const allUpdates = [];
    for (const name of linkedinNames) {
      const updates = await fetchLinkedInUpdates(name);
      allUpdates.push(...updates.map(u => `${name}: ${u.title} — ${u.link}`));
    }
    if (allUpdates.length) sections.push({ heading: '💼 LinkedIn', items: allUpdates });
  }

  if (!sections.length) { console.log('[roundup] No content for daily roundup'); return; }

  let body;
  if (anthropic) {
    body = await compileDigest(anthropic, config.anthropic.model, sections, 'daily');
  } else {
    body = sections.map(s => `${s.heading}\n${s.items.join('\n')}`).join('\n\n');
  }

  const subject = `OpenClaw Daily — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
  await gmail.sendEmail({ to: rc.emailTo, subject, body });
  console.log(`[roundup] Daily roundup sent to ${rc.emailTo}`);
}

// ── Weekly Roundup ───────────────────────────────────────────────
// Deep-dive topics, sent on the configured day (default: Saturday)

async function sendWeeklyRoundup({ config, anthropic, gmail }) {
  const rc = config.roundup;
  const topics = parseList(rc.weeklyTopics);

  if (!topics.length) return;
  if (!gmail?.enabled) { console.log('[roundup] Gmail not configured, skipping weekly roundup'); return; }
  if (!rc.emailTo) { console.log('[roundup] ROUNDUP_EMAIL_TO not set, skipping'); return; }

  console.log('[roundup] Building weekly roundup...');
  const sections = [];

  for (const topic of topics) {
    const articles = await fetchNewsRSS(topic, 8);
    if (articles.length) {
      sections.push({
        heading: `📰 ${topic}`,
        items: articles.map(a => `• ${a.title} — ${a.link}`),
      });
    }
  }

  if (!sections.length) { console.log('[roundup] No content for weekly roundup'); return; }

  let body;
  if (anthropic) {
    body = await compileDigest(anthropic, config.anthropic.model, sections, 'weekly');
  } else {
    body = sections.map(s => `${s.heading}\n${s.items.join('\n')}`).join('\n\n');
  }

  const subject = `OpenClaw Weekly — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  await gmail.sendEmail({ to: rc.emailTo, subject, body });
  console.log(`[roundup] Weekly roundup sent to ${rc.emailTo}`);
}

// ── Scheduler ────────────────────────────────────────────────────

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function startRoundupScheduler(deps) {
  const rc = deps.config.roundup;
  const hasDaily = parseList(rc.dailyTopics).length || parseList(rc.twitterHandles).length || parseList(rc.linkedinNames).length;
  const hasWeekly = parseList(rc.weeklyTopics).length;

  if (!rc.emailTo || (!hasDaily && !hasWeekly)) {
    console.log('[roundup] No roundup configured, scheduler inactive');
    return;
  }

  console.log(`[roundup] Scheduler active — daily: ${hasDaily ? 'yes' : 'no'}, weekly: ${hasWeekly ? rc.weeklyDay : 'no'}`);

  let lastDailySent = null;
  let lastWeeklySent = null;

  const CHECK_INTERVAL = 60 * 60 * 1000;

  async function check() {
    const now = new Date();
    const today = DAY_NAMES[now.getDay()];
    const dateKey = now.toISOString().slice(0, 10);

    // Daily — send every day after 8am
    if (hasDaily && now.getHours() >= 8 && lastDailySent !== dateKey) {
      lastDailySent = dateKey;
      try {
        await sendDailyRoundup(deps);
      } catch (err) {
        console.error('[roundup] Daily roundup error:', err?.message || err);
      }
    }

    // Weekly — send on the configured day after 8am
    if (hasWeekly && today === rc.weeklyDay.toLowerCase() && now.getHours() >= 8 && lastWeeklySent !== dateKey) {
      lastWeeklySent = dateKey;
      try {
        await sendWeeklyRoundup(deps);
      } catch (err) {
        console.error('[roundup] Weekly roundup error:', err?.message || err);
      }
    }
  }

  setTimeout(check, 10_000);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { startRoundupScheduler, sendDailyRoundup, sendWeeklyRoundup };
