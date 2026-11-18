'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Load settings from .env (if present) before anything else reads them.
if (fs.existsSync(path.join(__dirname, '.env'))) process.loadEnvFile(path.join(__dirname, '.env'));

const express = require('express');
const { sessionMiddleware } = require('./src/auth');
const { checkMailSetup } = require('./src/mailer');
const { UPLOAD_DIR } = require('./src/uploads');
const { CLASSES } = require('./src/classes');
const { REACTIONS } = require('./src/routes/hall');
const ledger = require('./src/ledger');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
// Set TRUST_PROXY=1 when running behind a reverse proxy (nginx, a host's load
// balancer) so the visitor's real IP address is used for rate limiting.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

// Security headers.
app.use((req, res, next) => {
  // The policy forbids styles written into the page. The one exception is the
  // small stylesheet the torph package adds on the Attunement pages: it is let
  // through by carrying this random value, which is new for every response.
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  res.set({
    'Content-Security-Policy':
      `default-src 'self'; style-src 'self' https://fonts.googleapis.com 'nonce-${nonce}'; ` +
      "font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; " +
      "script-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

// The stylesheet and scripts are linked with a version in the address
// (style.css?v=...; see `asset` below). The version changes whenever the file
// does, so a versioned address can be kept by the browser for a year: moving
// between pages then needs no request for them at all.
const PUBLIC_DIR = path.join(__dirname, 'public');
const IN_PRODUCTION = process.env.NODE_ENV === 'production';
app.use(
  express.static(PUBLIC_DIR, {
    maxAge: IN_PRODUCTION ? '1h' : 0,
    setHeaders(res) {
      if (res.req.query.v) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  })
);
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));
app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
// A logged-in member's first page of the day earns the day's attendance.
app.use((req, res, next) => {
  if (req.user && req.method === 'GET') ledger.attend(req.user.id);
  next();
});

// Values and helpers available in every view.
app.locals.siteName = process.env.SITE_NAME || 'WizardChat';
// asset('/css/style.css') gives '/css/style.css?v=<when the file last changed>'.
// In development the file is checked on every use, so edits appear at once.
const assetVersions = new Map();
app.locals.asset = (urlPath) => {
  let version = IN_PRODUCTION ? assetVersions.get(urlPath) : null;
  if (!version) {
    try {
      version = Math.round(fs.statSync(path.join(PUBLIC_DIR, urlPath)).mtimeMs).toString(36);
    } catch {
      version = '0';
    }
    assetVersions.set(urlPath, version);
  }
  return `${urlPath}?v=${version}`;
};
app.locals.CLASSES = CLASSES;
// Members who have not taken the Attunement are shown as Wanderers.
app.locals.className = (cls) => (CLASSES[cls] ? CLASSES[cls].name : 'Wanderer');
app.locals.REACTIONS = REACTIONS;
app.locals.ORB = require('./src/orb');
// The four currencies shown at the head of the page. holdingsOf is called as
// the page is drawn, so it includes anything earned by opening that very page.
app.locals.CURRENCIES = ledger.CURRENCIES;
app.locals.holdingsOf = ledger.balances;
// For the profile card: where a portrait's drawing is kept, and which bought
// adornment (if any) a card wears in a given place.
app.locals.portraitPath = require('./src/portraits').portraitPath;
app.locals.worn = require('./src/shop').worn;
app.locals.timeAgo = (ms) => {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'moments ago';
  const units = [
    [31536000, 'year'],
    [2592000, 'month'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [secs, name] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
};
// "in 3 hours", for a time still to come.
app.locals.timeUntil = (ms) => {
  const s = Math.floor((ms - Date.now()) / 1000);
  if (s < 60) return 'within the minute';
  const units = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [secs, name] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `in ${n} ${name}${n > 1 ? 's' : ''}`;
  }
};
app.locals.fullDate = (ms) =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

app.use(require('./src/routes/account'));
app.use(require('./src/routes/hall').router);
app.use(require('./src/routes/addresses').router);
app.use(require('./src/routes/board'));
app.use(require('./src/routes/archive'));
app.use(require('./src/routes/emporium'));
app.use(require('./src/routes/council'));
app.use(require('./src/routes/alley'));
app.use(require('./src/routes/profile'));

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'No Such Chamber',
    message: 'The page you seek is not to be found within these halls. It may have been moved, withdrawn, or never committed to record.',
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'A Disturbance Has Occurred',
    message: 'Something has gone amiss on our side. The Stewards have been made aware. Please try again shortly.',
  });
});

app.listen(PORT, () => {
  console.log(`${app.locals.siteName} is open at http://localhost:${PORT}`);
  checkMailSetup();
});
