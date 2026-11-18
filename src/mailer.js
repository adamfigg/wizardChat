'use strict';

// Outgoing e-mail.
//
// With SMTP_HOST set in .env, mail is sent through that SMTP server over an
// encrypted connection. Any provider that offers SMTP works (see README).
//
// Without it, and only outside production, nothing is sent: the message is
// printed to the server console so you can read the code there. In production
// the server refuses to start without mail settings, so that codes are never
// written to a log.

const nodemailer = require('nodemailer');

const SITE_NAME = process.env.SITE_NAME || 'WizardChat';
const PRODUCTION = process.env.NODE_ENV === 'production';

let transport = null;
let from = null;

if (process.env.SMTP_HOST) {
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // Port 465 is encrypted from the first byte. Any other port must upgrade
    // to encryption (STARTTLS) before anything is sent, or the send fails.
    secure: port === 465,
    requireTLS: port !== 465,
    tls: { minVersion: 'TLSv1.2' },
    // Gmail displays app passwords in groups of four with spaces between;
    // the spaces are not part of the password, so they are removed.
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER.trim(), pass: String(process.env.SMTP_PASS || '').replace(/\s+/g, '') }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  from = process.env.MAIL_FROM || process.env.SMTP_USER || null;
}

const mailIsConfigured = () => !!transport;

// Called once at startup. Stops a production server that cannot send mail,
// and checks that the SMTP server accepts our connection and login.
async function checkMailSetup() {
  if (!transport) {
    if (PRODUCTION) {
      console.error('Refusing to start: NODE_ENV=production but SMTP_HOST is not set, so verification e-mails cannot be sent.');
      process.exit(1);
    }
    console.log('Mail: SMTP is not configured. Verification codes will be printed here instead of being sent.');
    return;
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('Mail: SMTP_HOST is set but SMTP_USER or SMTP_PASS is empty in .env. Verification e-mails will NOT be sent until both are filled in.');
    if (PRODUCTION) process.exit(1);
    return;
  }
  if (!from || !from.includes('@')) {
    console.error('Mail: MAIL_FROM must be set to the address your provider allows you to send from.');
    if (PRODUCTION) process.exit(1);
  }
  try {
    await transport.verify();
    console.log(`Mail: connected to ${process.env.SMTP_HOST}. Messages will be sent from ${from}.`);
  } catch (err) {
    console.error(`Mail: could not connect or log in to ${process.env.SMTP_HOST}: ${err.message}`);
    console.error('Mail: sign-ups will fail to receive codes until this is corrected. Run "npm run mail:test you@example.com" to retry.');
  }
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Wraps paragraphs in the plain HTML frame shared by every message.
// `highlight`, if given, is shown large between the first and second paragraph.
function htmlBody(paragraphs, highlight) {
  const p = paragraphs.map(
    (t) => `<p style="margin:0 0 16px;font-size:17px;line-height:1.5;color:#2a2633;">${escapeHtml(t)}</p>`
  );
  if (highlight) {
    p.splice(
      1,
      0,
      `<p style="margin:8px 0 24px;font-size:34px;letter-spacing:8px;font-weight:bold;font-family:Consolas,Menlo,monospace;color:#1a1626;">${escapeHtml(highlight)}</p>`
    );
  }
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f1ea;font-family:Georgia,'Times New Roman',serif;">
<div style="max-width:480px;margin:0 auto;padding:28px;background:#ffffff;border:1px solid #d9d2c0;border-radius:6px;">
<p style="margin:0 0 20px;font-size:14px;letter-spacing:3px;text-transform:uppercase;color:#8a6d2e;">${escapeHtml(SITE_NAME)}</p>
${p.join('\n')}
</div></body></html>`;
}

async function send({ to, subject, paragraphs, highlight }) {
  const text = paragraphs
    .flatMap((t, i) => (i === 0 && highlight ? [t, `    ${highlight}`] : [t]))
    .join('\n\n');

  if (!transport) {
    console.log('\n──────── E-MAIL (not sent: SMTP is not configured) ────────');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}\n`);
    console.log(text);
    console.log('────────────────────────────────────────────────────────────\n');
    return;
  }

  await transport.sendMail({
    from,
    to,
    subject,
    text,
    html: htmlBody(paragraphs, highlight),
    headers: {
      // Tell mail systems this is an automatic message, so out-of-office
      // replies and the like are not sent back to us.
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
    },
  });
}

// The messages deliberately contain no links. A member is never asked to
// follow a link from an e-mail, which leaves imitators nothing to forge.

function sendVerificationCode(email, name, code) {
  return send({
    to: email,
    subject: `Your ${SITE_NAME} verification code`,
    highlight: code,
    paragraphs: [
      `${name}, your verification code for ${SITE_NAME} is:`,
      'The code remains valid for 15 minutes. Enter it on the verification page to confirm this address.',
      `No Steward of ${SITE_NAME} will ever ask you for this code. If you did not request admission, no action is required and this message may be disregarded.`,
      `The Stewards of ${SITE_NAME}`,
    ],
  });
}

// Sent when someone tries to sign up with an address that already belongs to
// a member. The sign-up page itself gives nothing away (see routes/account.js).
function sendAlreadyMemberNotice(email, name) {
  return send({
    to: email,
    subject: `Regarding your ${SITE_NAME} membership`,
    paragraphs: [
      `${name}, a petition for admission to ${SITE_NAME} was just made using this e-mail address, which is already bound to your membership.`,
      'If this was you, there is no need to petition again. Simply enter with your address and passphrase.',
      'If this was not you, no action is required. Your membership is unaffected and nothing has been changed.',
      `The Stewards of ${SITE_NAME}`,
    ],
  });
}

function sendTestMessage(email) {
  return send({
    to: email,
    subject: `${SITE_NAME} test message`,
    paragraphs: [
      `This is a test message from ${SITE_NAME}.`,
      'Its arrival confirms that outgoing mail is correctly configured.',
      `The Stewards of ${SITE_NAME}`,
    ],
  });
}

module.exports = { sendVerificationCode, sendAlreadyMemberNotice, sendTestMessage, mailIsConfigured, checkMailSetup };
