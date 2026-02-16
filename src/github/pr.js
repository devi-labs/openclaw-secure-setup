'use strict';

async function summarizePullRequest({ octokit, anthropic, model, pr, slackContext = '' }) {
  if (!octokit) return "GitHub integration isn\'t configured (`GITHUB_TOKEN` missing).";

  const prResp = await octokit.pulls.get(pr);
  const prData = prResp.data;

  const filesResp = await octokit.pulls.listFiles({ ...pr, per_page: 100 });
  const files = filesResp.data.map((f) => ({
    filename: f.filename,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    status: f.status,
  }));

  const baseSummary = [
    `*PR:* ${prData.title}`,
    `*Repo:* ${pr.owner}/${pr.repo}`,
    `*Author:* ${prData.user?.login ?? 'unknown'}`,
    `*URL:* ${prData.html_url}`,
    `*State:* ${prData.state}${prData.draft ? ' (draft)' : ''}`,
    `*Files changed:* ${files.length}`,
  ].join('\n');

  if (!anthropic) {
    return [
      baseSummary,
      '',
      '*Top changed files:*',
      ...files.slice(0, 10).map((f) => `• ${f.filename} (+${f.additions}/-${f.deletions})`),
      '',
      '_Tip: configure `ANTHROPIC_API_KEY` to get a full narrative summary._',
    ].join('\n');
  }

  const prompt = [
    'Summarize this GitHub pull request for a Slack thread.',
    'Be concise, technical, and practical.',
    'Output format:',
    '1) 1-sentence summary',
    '2) Key changes (bullets)',
    '3) Risks / what to review',
    '4) Suggested test plan',
    '',
    `Slack context (if any): ${slackContext || '(none)'}`,
    '',
    `Title: ${prData.title}`,
    `Author: ${prData.user?.login}`,
    `URL: ${prData.html_url}`,
    `Description:\n${prData.body || '(none)'}`,
    '',
    `Changed files (${files.length}):`,
    ...files.slice(0, 40).map((f) => `- ${f.filename} [${f.status}] (+${f.additions}/-${f.deletions})`),
  ].join('\n');

  const resp = await anthropic.messages.create({
    model,
    max_tokens: 950,
    system:
      "You are OpenClaw, a Slack bot with server-side integrations. " +
      "Never reveal secrets. Keep the answer readable.",
    messages: [{ role: 'user', content: prompt }],
  });

  return resp.content?.find((c) => c.type === 'text')?.text?.trim() || '(No response)';
}

module.exports = { summarizePullRequest };
