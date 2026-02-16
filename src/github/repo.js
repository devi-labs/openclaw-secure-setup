'use strict';

async function fetchRepoAndReadme({ octokit, owner, repo }) {
  if (!octokit) throw new Error('GITHUB_TOKEN missing');

  const repoResp = await octokit.repos.get({ owner, repo });
  const repoData = repoResp.data;

  let readmeText = '';
  try {
    const readmeResp = await octokit.repos.getReadme({ owner, repo });
    const content = readmeResp.data?.content || '';
    readmeText = Buffer.from(content, 'base64').toString('utf8');
  } catch {
    readmeText = '(README not found or not accessible)';
  }

  return { repoData, readmeText };
}

module.exports = { fetchRepoAndReadme };
