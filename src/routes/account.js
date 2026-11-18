'use strict';

// Sign-up, e-mail verification, login/logout, and the attunement questionnaire.
//
// The sign-up flow:
//   1. POST /signup   stores the account as unverified and e-mails a code.
//                     The visitor receives a "pending" cookie, NOT a login.
//   2. POST /verify   checks the code. Only now is the account marked
//                     verified and a login session started.
//
// Sign-up never reveals whether an address already belongs to a member: the
// visitor sees the same verification page either way, and the existing member
// is told by e-mail instead.

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { sendVerificationCode, sendAlreadyMemberNotice, mailIsConfigured } = require('../mailer');
const { QUESTIONS, CLASSES, validAnswers, assignClass, traitsFor } = require('../classes');
const ledger = require('../ledger');

const router = express.Router();

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L}\p{N} .'’-]{2,29}$/u;

const signupLimit = auth.rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
const loginLimit = auth.rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const verifyLimit = auth.rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

// Issues a code and e-mails it. Returns 'sent' | 'cooldown' | 'cap' | 'failed'.
async function dispatchCode(user) {
  const issued = auth.issueCode(user.id);
  if (issued.refused) return issued.refused;
  try {
    await sendVerificationCode(user.email, user.name, issued.code);
    return 'sent';
  } catch (err) {
    console.error(`Mail: the verification message could not be sent: ${err.message}`);
    auth.voidCode(user.id);
    return 'failed';
  }
}

const DISPATCH_MESSAGES = {
  sent: ['success', 'A new code has been dispatched.'],
  cooldown: ['info', 'A code was dispatched within the last minute. Allow it time to arrive before requesting another.'],
  cap: ['error', 'Too many codes have been requested for this address. Wait an hour before requesting another.'],
  failed: ['error', 'The message could not be dispatched at this time. Wait a moment, then request a new code.'],
};

// The member whose verified address is named as ADMIN_EMAIL in .env is a
// Steward: they may remove any post, comment, or notice, and write the
// Steward's Address. Checked whenever that member verifies or logs in, so the
// setting may be added before or after the account is created.
function grantStewardIfNamed(user) {
  const named = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (named && named === user.email.toLowerCase() && !user.is_admin) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  }
}

// An existing member is told at most once an hour that their address was used.
const lastNotice = new Map();
async function notifyExistingMember(user) {
  const now = Date.now();
  if (now - (lastNotice.get(user.id) || 0) < 60 * 60 * 1000) return;
  lastNotice.set(user.id, now);
  try {
    await sendAlreadyMemberNotice(user.email, user.name);
  } catch (err) {
    console.error(`Mail: the membership notice could not be sent: ${err.message}`);
  }
}

// ── Sign-up ──────────────────────────────────────────────────────────────────

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('signup', { title: 'Petition for Admission', error: null, values: {} });
});

router.post('/signup', signupLimit, auth.requireCsrf, async (req, res) => {
  if (req.user) return res.redirect('/');
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const fail = (error) =>
    res.status(400).render('signup', { title: 'Petition for Admission', error, values: { name, email } });

  if (!NAME_RE.test(name))
    return fail('Your name must be 3 to 30 characters, begin with a letter, and contain only letters, numerals, spaces, periods, apostrophes, and hyphens.');
  if (!EMAIL_RE.test(email) || email.length > 254) return fail('That does not appear to be a valid e-mail address.');
  const problem = auth.passwordProblem(password, { name, email });
  if (problem) return fail(problem);

  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const byName = db.prepare('SELECT id FROM users WHERE name = ?').get(name);
  // Names are public (they appear on every post), so saying one is taken reveals nothing.
  if (byName && (!byEmail || byName.id !== byEmail.id)) return fail('That name is already borne by another. Choose a different one.');

  // Hashed in every case, so each outcome takes the same time.
  const passHash = await auth.hashPassword(password);

  if (byEmail && byEmail.verified) {
    // The address already belongs to a member. Show the visitor the usual
    // verification page (no code will ever succeed) and tell the member.
    auth.startPending(res, { userId: null, email });
    await notifyExistingMember(byEmail);
    return res.redirect('/verify');
  }

  let userId;
  if (byEmail) {
    // An earlier sign-up for this address was never verified. Replace it.
    // startPending (below) cancels the earlier attempt's cookie, so only
    // whoever can read the mailbox is able to finish.
    db.prepare('UPDATE users SET name = ?, pass_hash = ? WHERE id = ?').run(name, passHash, byEmail.id);
    userId = byEmail.id;
  } else {
    userId = db
      .prepare('INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(email, name, passHash, Date.now()).lastInsertRowid;
  }

  auth.startPending(res, { userId, email });
  const outcome = await dispatchCode({ id: userId, email, name });
  if (outcome === 'failed' || outcome === 'cap') req.flash(...DISPATCH_MESSAGES[outcome]);
  res.redirect('/verify');
});

// ── E-mail verification ──────────────────────────────────────────────────────

function renderVerify(res, pending, error, status = 200) {
  res.status(status).render('verify', {
    title: 'Confirm Your Address',
    error,
    email: pending.email,
    devNote: !mailIsConfigured(),
  });
}

function noPending(req, res) {
  req.flash('info', 'No verification is in progress. Petition for admission, or enter if your address is already confirmed.');
  res.redirect('/signup');
}

router.get('/verify', (req, res) => {
  if (req.user) return res.redirect('/');
  const pending = auth.getPending(req);
  if (!pending) return noPending(req, res);
  renderVerify(res, pending, null);
});

router.post('/verify', verifyLimit, auth.requireCsrf, (req, res) => {
  if (req.user) return res.redirect('/');
  const pending = auth.getPending(req);
  if (!pending) return noPending(req, res);

  const code = String(req.body.code || '').replace(/\D/g, '');
  let result;
  if (code.length !== 6) {
    result = 'wrong';
  } else if (pending.user_id) {
    result = auth.checkCode(pending.user_id, code);
  } else {
    // The address belongs to an existing member: behave exactly as a real
    // verification would, but no code can succeed.
    if (Date.now() - pending.last_sent_at > auth.CODE_TTL_MS) result = 'expired';
    else if (pending.attempts >= auth.CODE_MAX_ATTEMPTS) result = 'locked';
    else {
      db.prepare('UPDATE pending_signups SET attempts = attempts + 1 WHERE token_hash = ?').run(pending.token_hash);
      result = pending.attempts + 1 >= auth.CODE_MAX_ATTEMPTS ? 'locked' : 'wrong';
    }
  }

  if (result !== 'ok') {
    const messages = {
      wrong: 'That code is not correct. Examine the message and try again.',
      expired: 'That code has expired. Request a new one below.',
      locked: 'Too many incorrect attempts have been made. Request a new code below.',
      none: 'No code is pending for this address. Request a new one below.',
    };
    return renderVerify(res, pending, messages[result], 400);
  }

  // Verified. The pending cookie is retired and a login session begins.
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pending.user_id);
  auth.endPending(req, res, user.id);
  grantStewardIfNamed(user);
  auth.startSession(res, user.id);
  req.flash('success', 'Your address is confirmed. You are admitted, and may now take part.');
  res.redirect('/');
});

router.post('/verify/resend', verifyLimit, auth.requireCsrf, async (req, res) => {
  if (req.user) return res.redirect('/');
  const pending = auth.getPending(req);
  if (!pending) return noPending(req, res);

  let outcome;
  if (pending.user_id) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pending.user_id);
    outcome = await dispatchCode(user);
  } else if (Date.now() - pending.last_sent_at < auth.CODE_RESEND_MS) {
    outcome = 'cooldown';
  } else {
    db.prepare('UPDATE pending_signups SET attempts = 0, last_sent_at = ? WHERE token_hash = ?').run(Date.now(), pending.token_hash);
    outcome = 'sent';
  }
  req.flash(...DISPATCH_MESSAGES[outcome]);
  res.redirect('/verify');
});

// ── Login / logout ───────────────────────────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Enter the Conclave', error: null, email: '' });
});

router.post('/login', loginLimit, auth.requireCsrf, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '').slice(0, 200);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // One message for every failure, and the same time taken, whether the
  // address is unknown or the passphrase is wrong.
  const ok = await auth.verifyPasswordOrDummy(password, user && user.pass_hash);
  if (!ok) {
    return res.status(400).render('login', {
      title: 'Enter the Conclave',
      error: 'The address and passphrase do not correspond to any member.',
      email,
    });
  }
  if (!user.verified) {
    // Correct passphrase, but the address was never confirmed: resume verification.
    auth.startPending(res, { userId: user.id, email: user.email });
    const outcome = await dispatchCode(user);
    if (outcome === 'failed' || outcome === 'cap') req.flash(...DISPATCH_MESSAGES[outcome]);
    return res.redirect('/verify');
  }
  grantStewardIfNamed(user);
  auth.startSession(res, user.id);
  res.redirect('/');
});

router.post('/logout', auth.requireCsrf, (req, res) => {
  auth.endSession(req, res);
  res.redirect('/');
});

// ── Attunement (optional questionnaire; determines a member's discipline) ────
//
// One question per page: /attunement/1 to /attunement/9, then
// /attunement/complete. Each answer is saved as it is given (in
// users.attune_draft), so a member may go back, or leave and resume later.
// Nothing is assigned until they confirm on the final page.

// The answers saved so far, keeping only those that are still valid choices.
function draftOf(user) {
  let saved = {};
  try {
    saved = JSON.parse(user.attune_draft || '{}') || {};
  } catch {
    /* an unreadable draft is treated as empty */
  }
  const draft = {};
  for (const q of QUESTIONS) {
    if (q.options.some((o) => o.value === saved[q.id])) draft[q.id] = saved[q.id];
  }
  return draft;
}

// Position (from 0) of the first unanswered question; QUESTIONS.length when none remain.
function firstOpen(draft) {
  const i = QUESTIONS.findIndex((q) => !draft[q.id]);
  return i === -1 ? QUESTIONS.length : i;
}

const stepPath = (i) => (i >= QUESTIONS.length ? '/attunement/complete' : `/attunement/${i + 1}`);

// Members who already hold a discipline have no further business here.
function unattuned(req, res, next) {
  if (req.user.wizard_class) return res.redirect('/settings');
  next();
}

// Resolves /attunement/:step to a question. Unknown steps fall through to the
// 404 page; a step beyond the first unanswered question is sent back to it.
function loadStep(req, res, next) {
  const step = Number(req.params.step);
  if (!Number.isInteger(step) || step < 1 || step > QUESTIONS.length) return next('route');
  req.draft = draftOf(req.user);
  req.stepIndex = step - 1;
  const open = firstOpen(req.draft);
  if (req.stepIndex > open) return res.redirect(stepPath(open));
  next();
}

function renderStep(req, res, error, status = 200) {
  const question = QUESTIONS[req.stepIndex];
  res.status(status).render('attunement', {
    title: 'The Attunement',
    question,
    index: req.stepIndex,
    total: QUESTIONS.length,
    chosen: req.draft[question.id] || null,
    error,
  });
}

router.get('/attunement', auth.requireLogin, unattuned, (req, res) => {
  res.redirect(stepPath(firstOpen(draftOf(req.user))));
});

router.get('/attunement/complete', auth.requireLogin, unattuned, (req, res) => {
  const open = firstOpen(draftOf(req.user));
  if (open < QUESTIONS.length) return res.redirect(stepPath(open));
  res.render('attunement-complete', { title: 'The Attunement', total: QUESTIONS.length });
});

router.post('/attunement/complete', auth.requireLogin, auth.requireCsrf, unattuned, (req, res) => {
  const answers = draftOf(req.user);
  if (!validAnswers(answers)) return res.redirect(stepPath(firstOpen(answers)));

  const cls = assignClass(answers);
  const familiarTrait = traitsFor(answers)[QUESTIONS.findIndex((q) => q.id === 'familiar')];
  // Keep an inscription the member already chose as a Wanderer.
  const pinned = req.user.pinned || familiarTrait;
  db.prepare('UPDATE users SET wizard_class = ?, answers = ?, pinned = ?, attune_draft = NULL WHERE id = ?').run(
    cls,
    JSON.stringify(answers),
    pinned,
    req.user.id
  );
  ledger.award(req.user.id, 'attuned', 'once');
  res.locals.user = { ...req.user, wizard_class: cls, pinned };
  res.render('attuned', { title: 'Your Discipline', cls, info: CLASSES[cls], who: res.locals.user });
});

router.get('/attunement/:step', auth.requireLogin, unattuned, loadStep, (req, res) => {
  renderStep(req, res, null);
});

router.post('/attunement/:step', auth.requireLogin, auth.requireCsrf, unattuned, loadStep, (req, res) => {
  const question = QUESTIONS[req.stepIndex];
  const answer = String(req.body.answer || '');
  if (!question.options.some((o) => o.value === answer)) {
    return renderStep(req, res, 'Choose one of the answers given.', 400);
  }
  req.draft[question.id] = answer;
  db.prepare('UPDATE users SET attune_draft = ? WHERE id = ?').run(JSON.stringify(req.draft), req.user.id);
  res.redirect(stepPath(req.stepIndex + 1));
});

module.exports = router;
