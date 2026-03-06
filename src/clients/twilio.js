'use strict';

function createTwilioClient(accountSid, authToken) {
  if (!accountSid || !authToken) return null;
  const twilio = require('twilio');
  return twilio(accountSid, authToken);
}

module.exports = { createTwilioClient };
