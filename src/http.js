'use strict';

const express = require('express');

function startHealthServer(port) {
  const app = express();
  app.get('/healthz', (_, res) => res.status(200).send('ok'));
  app.listen(port, '0.0.0.0', () => {
    console.log(`Health server listening on port ${port}`);
  });
}

module.exports = { startHealthServer };
