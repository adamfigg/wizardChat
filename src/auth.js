'use strict';

// Everything to do with identity: password hashing, login sessions, CSRF
// protection, verification codes, rate limiting, and the route guards.

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);

const SESSION_DAYS = 30;
const PENDING_MS = 24 * 60 * 60 * 1000; // how long a part-finished sign-up is kept
const CODE_TTL_MS = 15 * 60 * 1000; // a verification code is valid for 15 minutes
const CODE_MAX_ATTEMPTS = 5; // wrong guesses allowed before a new code is required
const CODE_RESEND_MS = 60 * 1000; // minimum wait between sending codes
const CODE_MAX_PER_HOUR = 5; // codes that may be sent to one address per hour
const HOUR = 60 * 60 * 1000;
const SECURE = process.env.NODE_ENV === 'production';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── Passwords ────────────────────────────────────────────────────────────────
//
// Stored as "scrypt$N$r$p$salt$hash". scrypt is deliberately slow and
// memory-hungry, which makes guessing passwords from a stolen database
// expensive. The cost settings are stored with each hash so they can be raised
// later without invalidating existing passwords.

const SCRYPT = { N: 2 ** 15, r: 8, p: 3 }; // an OWASP-recommended setting (about 32 MB per hash)
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const KEY_LEN = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, { ...SCRYPT, maxmem: SCRYPT_MAXMEM });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_MAXMEM,
  });
  return crypto.timingSafeEqual(expected, actual);
}

// A real hash to compare against when no such account exists, so that a login
// attempt takes the same time whether or not the address belongs to a member.
const dummyHash = hashPassword(randomToken());
async function verifyPasswordOrDummy(password, stored) {
  if (stored) return verifyPassword(password, stored);
  await verifyPassword(password, await dummyHash);
  return false;
}

// Passphrases that appear near the top of every list of leaked passwords.
const COMMON_PASSWORDS = new Set([
  'password123', 'password1234', 'password12345', 'passwordpassword', 'mypassword1', 'mypassword123',
  '1234567890', '12345678910', '0123456789', '0987654321', '1234512345',
  '1q2w3e4r5t', '1q2w3e4r5t6y', 'qwertyuiop', 'qwertyuiop123', 'qwerty12345', 'qwerty123456',
  'asdfghjkl;', 'asdfghjkl123', 'zxcvbnm123', '1qaz2wsx3edc', 'q1w2e3r4t5', 'abcdefghij', 'abcdefghijk',
  'abcd1234567', 'iloveyou123', 'iloveyou1234', 'letmein12345', 'welcome12345', 'administrator',
  'changeme123', 'football123', 'baseball123', 'sunshine123', 'princess123', 'superman123',
  'wizardchat1', 'wizardwizard', 'abracadabra', 'correcthorsebatterystaple',
]);

// Returns a reason the passphrase is unacceptable, or null if it is acceptable.
function passwordProblem(password, { name, email }) {
  if (password.length < 10) return 'Your passphrase must be at least 10 characters.';
  if (password.length > 200) return 'Your passphrase must not exceed 200 characters.';
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password))
    return 'That passphrase is among the most commonly used and would be guessed at once. Choose another.';
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const own = [squash(name), squash(email.split('@')[0])].filter((s) => s.length >= 4);
  const pw = squash(password);
  if (own.some((s) => pw === s || pw.replace(/\d+$/, '') === s))
    return 'Your passphrase must not be your own name or e-mail address.';
  return null;
}

// ── Cookies ──────────────────────────────────────────────────────────────────

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  return out;
}

// httpOnly: page scripts cannot read the cookie.
// sameSite lax: other sites cannot make the browser send it with a form post.
// secure: sent over HTTPS only (switched on in production).
const cookieOpts = (maxAgeMs) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: SECURE,
  path: '/',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});

// ── Sessions (verified members only) ─────────────────────────────────────────

function startSession(res, userId) {
  const token = randomToken();
  const ms = SESSION_DAYS * 24 * HOUR;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    Date.now() + ms
  );
  res.cookie('sid', token, cookieOpts(ms));
}

function endSession(req, res) {
  if (req.cookies.sid) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(req.cookies.sid));
  }
  res.clearCookie('sid', cookieOpts());
}

// Runs on every request: reads cookies, loads the logged-in member (if any),
// makes sure a CSRF token exists, and exposes flash messages to the views.
function sessionMiddleware(req, res, next) {
  req.cookies = parseCookies(req);
  req.user = null;

  if (req.cookies.sid) {
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.verified = 1`
      )
      .get(sha256(req.cookies.sid), Date.now());
    if (row) req.user = row;
    else res.clearCookie('sid', cookieOpts());
  }

  // CSRF token (double-submit cookie): every form carries it in a hidden field
  // and it must match the cookie. Other sites cannot read or set our cookie.
  req.csrfToken = req.cookies.csrf;
  if (!req.csrfToken || req.csrfToken.length < 20) {
    req.csrfToken = randomToken();
    res.cookie('csrf', req.csrfToken, cookieOpts());
  }

  // Flash: a one-time message carried across a redirect.
  let flash = null;
  if (req.cookies.flash) {
    try {
      flash = JSON.parse(req.cookies.flash);
    } catch {
      /* ignore */
    }
    res.clearCookie('flash', cookieOpts());
  }
  req.flash = (type, message) => res.cookie('flash', JSON.stringify({ type, message }), cookieOpts());

  res.locals.user = req.user;
  res.locals.csrf = req.csrfToken;
  res.locals.flash = flash;
  res.locals.path = req.path;
  next();
}

// ── Pending sign-ups (address not yet verified) ──────────────────────────────
//
// Until the code is confirmed there is no login session, only a "pv" cookie
// that identifies which verification is in progress. Starting a new one for
// the same account cancels any earlier one.

function startPending(res, { userId, email }) {
  const token = randomToken();
  if (userId) db.prepare('DELETE FROM pending_signups WHERE user_id = ?').run(userId);
  db.prepare(
    'INSERT INTO pending_signups (token_hash, email, user_id, last_sent_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(sha256(token), email, userId || null, Date.now(), Date.now() + PENDING_MS);
  res.cookie('pv', token, cookieOpts(PENDING_MS));
}

function getPending(req) {
  if (!req.cookies.pv) return null;
  return (
    db
      .prepare('SELECT * FROM pending_signups WHERE token_hash = ? AND expires_at > ?')
      .get(sha256(req.cookies.pv), Date.now()) || null
  );
}

function endPending(req, res, userId) {
  if (userId) db.prepare('DELETE FROM pending_signups WHERE user_id = ?').run(userId);
  else if (req.cookies.pv) db.prepare('DELETE FROM pending_signups WHERE token_hash = ?').run(sha256(req.cookies.pv));
  res.clearCookie('pv', cookieOpts());
}

// ── CSRF ─────────────────────────────────────────────────────────────────────

function csrfOk(req) {
  const sent = req.body && req.body._csrf;
  return typeof sent === 'string' && !!req.cookies.csrf && safeEqual(sent, req.cookies.csrf);
}

// Use directly on routes. For file-upload routes it must come AFTER the upload
// middleware, because the form fields are not readable until the upload is parsed.
function requireCsrf(req, res, next) {
  if (csrfOk(req)) return next();
  res.status(403).render('error', {
    title: 'Request Refused',
    message: 'This request could not be confirmed as your own. Return to the previous page, reload it, and try again.',
  });
}

// ── Route guards ─────────────────────────────────────────────────────────────

// Only members with a verified address ever hold a session, so being logged in
// is all that posting, commenting, reacting, and placing notices require.
// The Attunement is optional; members who have not taken it are Wanderers.
function requireLogin(req, res, next) {
  if (req.user) return next();
  req.flash('info', 'You must enter the Conclave before proceeding.');
  res.redirect('/login');
}
const requireMember = requireLogin;

// Stewards only (the account named by ADMIN_EMAIL in .env).
function requireAdmin(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (req.user.is_admin) return next();
  res.status(403).render('error', {
    title: 'Not Permitted',
    message: 'This chamber is reserved to the Stewards of the Conclave.',
  });
}

// ── Verification codes ───────────────────────────────────────────────────────

// Creates (or replaces) the pending code for a user.
// Returns { code } to be e-mailed, or { refused: 'cooldown' | 'cap' }.
function issueCode(userId) {
  const now = Date.now();
  const v = db.prepare('SELECT * FROM verifications WHERE user_id = ?').get(userId);
  if (v && now - v.last_sent_at < CODE_RESEND_MS) return { refused: 'cooldown' };
  const sameHour = !!v && now - v.window_start < HOUR;
  const count = sameHour ? v.send_count : 0;
  if (count >= CODE_MAX_PER_HOUR) return { refused: 'cap' };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare(
    `INSERT INTO verifications (user_id, code_hash, expires_at, attempts, last_sent_at, send_count, window_start)
     VALUES (?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
       last_sent_at = excluded.last_sent_at, send_count = excluded.send_count, window_start = excluded.window_start`
  ).run(userId, sha256(`${userId}:${code}`), now + CODE_TTL_MS, now, count + 1, sameHour ? v.window_start : now);
  return { code };
}

// Called when the e-mail could not be sent: the code is void, and another may
// be requested without waiting out the usual minute.
function voidCode(userId) {
  db.prepare('UPDATE verifications SET expires_at = 0, last_sent_at = 0 WHERE user_id = ?').run(userId);
}

// Returns 'ok' | 'wrong' | 'expired' | 'locked' | 'none'.
function checkCode(userId, code) {
  const v = db.prepare('SELECT * FROM verifications WHERE user_id = ?').get(userId);
  if (!v) return 'none';
  if (Date.now() > v.expires_at) return 'expired';
  if (v.attempts >= CODE_MAX_ATTEMPTS) return 'locked';
  if (!safeEqual(sha256(`${userId}:${code}`), v.code_hash)) {
    db.prepare('UPDATE verifications SET attempts = attempts + 1 WHERE user_id = ?').run(userId);
    return v.attempts + 1 >= CODE_MAX_ATTEMPTS ? 'locked' : 'wrong';
  }
  db.prepare('DELETE FROM verifications WHERE user_id = ?').run(userId);
  db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(userId);
  return 'ok';
}

// ── Rate limiting (in memory, per IP address) ────────────────────────────────

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || now > h.reset) hits.set(req.ip, (h = { count: 0, reset: now + windowMs }));
    if (++h.count > max) {
      return res.status(429).render('error', {
        title: 'Patience Is Advised',
        message: 'Too many attempts have been made from your location. Wait a short while before trying again.',
      });
    }
    next();
  };
}

// Housekeeping, hourly: expired sessions, lapsed pending sign-ups, and
// accounts never verified within a day (freeing the name and address).
setInterval(() => {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM pending_signups WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM users WHERE verified = 0 AND created_at < ?').run(now - PENDING_MS);
}, HOUR).unref();

module.exports = {
  hashPassword,
  verifyPasswordOrDummy,
  passwordProblem,
  startSession,
  endSession,
  sessionMiddleware,
  startPending,
  getPending,
  endPending,
  requireCsrf,
  requireLogin,
  requireMember,
  requireAdmin,
  issueCode,
  voidCode,
  checkCode,
  rateLimit,
  CODE_TTL_MS,
  CODE_RESEND_MS,
  CODE_MAX_ATTEMPTS,
};
