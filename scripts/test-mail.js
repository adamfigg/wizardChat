'use strict';

// Sends one test message using the mail settings in .env.
// Run with: npm run mail:test you@example.com

const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const { sendTestMessage, mailIsConfigured } = require('../src/mailer');

const to = process.argv[2];
if (!to || !to.includes('@')) {
  console.error('State the address to send to:  npm run mail:test you@example.com');
  process.exit(1);
}
if (!mailIsConfigured()) {
  console.error('SMTP_HOST is not set in .env, so there is nothing to test. See the "Sending real e-mail" section of README.md.');
  process.exit(1);
}

sendTestMessage(to).then(
  () => {
    console.log(`Sent. Look for it in the inbox of ${to} (and in the spam folder, the first time).`);
  },
  (err) => {
    console.error(`The message could not be sent: ${err.message}`);
    if (err.code === 'EAUTH') console.error('The mail server refused the login. Check SMTP_USER and SMTP_PASS.');
    if (err.code === 'ESOCKET' || err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT')
      console.error('The mail server could not be reached. Check SMTP_HOST and SMTP_PORT.');
    process.exit(1);
  }
);
