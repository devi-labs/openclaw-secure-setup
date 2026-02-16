'use strict';

const { Octokit } = require('@octokit/rest');

function createOctokit(token) {
  return token ? new Octokit({ auth: token }) : null;
}

module.exports = { createOctokit };
