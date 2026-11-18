'use strict';

// The Council of Wizards: votes on matters laid by a Steward. Anyone may
// read; members vote; only a Steward lays, closes, or withdraws a motion.
// The rules are in src/council.js.

const express = require('express');
const auth = require('../auth');
const council = require('../council');

const router = express.Router();

router.get('/council', (req, res) => {
  res.render('council', {
    title: 'The Council of Wizards',
    REWARD: council.REWARD,
    ...council.business(req.user ? req.user.id : null),
  });
});

function motionForm(res, { error = null, values = {}, status = 200 } = {}) {
  res.status(status).render('motion-form', { title: 'Lay a Motion', error, values, TERMS: council.TERMS, LIMITS: council.LIMITS });
}

router.get('/council/new', auth.requireAdmin, (req, res) => motionForm(res));

router.post('/council', auth.requireAdmin, auth.requireCsrf, (req, res) => {
  const motion = council.readMotion(req.body);
  if (motion.error) return motionForm(res, { error: motion.error, values: motion.values, status: 400 });
  council.lay(req.user.id, motion);
  req.flash('success', 'The motion is laid before the Council, and voting is open.');
  res.redirect('/council');
});

router.post('/council/:id/vote', auth.requireMember, auth.requireCsrf, (req, res) => {
  const outcome = council.vote(req.user.id, Number(req.params.id), req.body.choice);
  if (outcome === 'cast') req.flash('success', 'Your vote is recorded. It cannot now be altered.');
  else if (outcome === 'already') req.flash('info', 'You have already voted upon this motion.');
  else if (outcome === 'closed') req.flash('error', 'Voting upon this motion has closed.');
  else req.flash('error', 'Choose one of the outcomes given.');
  res.redirect(`/council#motion-${Number(req.params.id) || ''}`);
});

router.post('/council/:id/close', auth.requireAdmin, auth.requireCsrf, (req, res) => {
  if (council.closeNow(Number(req.params.id))) req.flash('success', 'The vote is closed and its result declared.');
  else req.flash('error', 'That motion is not open.');
  res.redirect('/council');
});

router.post('/council/:id/withdraw', auth.requireAdmin, auth.requireCsrf, (req, res) => {
  if (council.withdraw(Number(req.params.id))) req.flash('success', 'The motion is withdrawn. No reward is paid upon it.');
  else req.flash('error', 'Only a motion still open may be withdrawn.');
  res.redirect('/council');
});

module.exports = router;
