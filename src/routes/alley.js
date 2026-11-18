'use strict';

// The Back Alley: games of chance played with the four resources. For now
// there is one, the wheel; its rules are in src/wheel.js.

const express = require('express');
const auth = require('../auth');
const ledger = require('../ledger');
const wheel = require('../wheel');

const router = express.Router();

const SPIN_SECONDS = 6; // how long the wheel on the page takes to come to rest (see .wheel in style.css)
const byKey = Object.fromEntries(ledger.CURRENCIES.map((c) => [c.key, c]));

function alley(req, res, extra = {}) {
  const userId = req.user ? req.user.id : null;
  res.render('alley', {
    title: 'The Back Alley',
    MAX_STAKE: wheel.MAX_STAKE,
    resources: ledger.CURRENCIES,
    byKey,
    wager: userId ? wheel.pending(userId) : null,
    spun: null,
    tally: userId ? wheel.record(userId) : null,
    empty: userId ? !Object.values(ledger.balances(userId)).some((n) => n >= 1) : false,
    ...extra,
  });
}

router.get('/alley', (req, res) => alley(req, res));

// Step 1: the member gives their word, and the Broker takes a stake.
router.post('/alley/stake', auth.requireMember, auth.requireCsrf, (req, res) => {
  if (!wheel.stake(req.user.id)) req.flash('error', 'You hold nothing the Broker would take.');
  res.redirect('/alley');
});

// Step 2: the member names a resource; the wheel is spun.
router.post('/alley/spin', auth.requireMember, auth.requireCsrf, (req, res) => {
  const wager = wheel.spin(req.user.id, String(req.body.pick || ''));
  if (!wager) {
    req.flash('error', 'Name one of the four resources.');
    return res.redirect('/alley');
  }
  res.redirect(`/alley/turn/${wager.id}`);
});

// The wheel turning, and what came of it.
router.get('/alley/turn/:id', auth.requireMember, (req, res, next) => {
  const spun = wheel.finished(req.user.id, Number(req.params.id));
  if (!spun) return next();
  spun.won = spun.pick === spun.landed;
  // While the wheel on the page is still turning, the winnings are left out
  // of the figure at the head of the page, so that it does not give the
  // result away. They are already in the member's account.
  const turning = Date.now() - spun.settled_at < SPIN_SECONDS * 1000;
  if (spun.won && turning) res.locals.heldBack = { currency: spun.currency, amount: spun.amount * 2 };
  alley(req, res, { spun, wager: null });
});

module.exports = router;
