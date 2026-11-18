'use strict';

// Member profiles, and the settings of the profile card: its inscription,
// its portrait, and any adornments bought at the Emporium.

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { removeUpload } = require('../uploads');
const { inscriptionsFor } = require('../classes');
const { portraitsFor } = require('../portraits');
const shop = require('../shop');
const bounties = require('../bounties');

const router = express.Router();

function parseAnswers(user) {
  try {
    return JSON.parse(user.answers);
  } catch {
    return null;
  }
}

router.get('/wizards/:name', (req, res, next) => {
  const who = db.prepare('SELECT * FROM users WHERE name = ? AND verified = 1').get(req.params.name);
  if (!who) return next();
  const posts = db
    .prepare('SELECT id, body, media_type, created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(who.id);
  bounties.mark(req, res, 'call', { memberId: who.id }, { now: true });
  res.render('profile', { title: who.name, who, posts });
});

// The adornments a member owns, arranged by the place they occupy on the card.
function adornmentsOf(user) {
  const owned = shop.ownedBy(user.id);
  return shop.SLOTS.map((slot) => ({
    ...slot,
    worn: shop.worn(user[slot.column], slot.key),
    owned: shop.WARES.filter((ware) => ware.slot === slot.key && owned.has(ware.key)),
  }));
}

router.get('/settings', auth.requireMember, (req, res) => {
  res.render('settings', {
    title: 'Your Profile Card',
    inscriptions: inscriptionsFor(parseAnswers(req.user)),
    portraits: portraitsFor(req.user.wizard_class),
    adornments: adornmentsOf(req.user),
  });
});

// Every choice is checked against what this member may actually have: an
// inscription open to them, a portrait of their own discipline, an adornment
// they own. Anything else in the form is ignored and the present setting kept.
router.post('/settings', auth.requireMember, auth.requireCsrf, (req, res) => {
  const user = req.user;
  const sent = (field) => String(req.body[field] || '');

  let pinned = user.pinned;
  if (inscriptionsFor(parseAnswers(user)).open.includes(sent('pinned'))) pinned = sent('pinned');

  // 'keep' leaves things as they are (it is what a member with a portrait
  // uploaded in earlier days sends to retain it); 'none' shows their initial.
  let portrait = user.portrait;
  let avatar = user.avatar;
  const wanted = sent('portrait');
  if (wanted === 'none' || portraitsFor(user.wizard_class).some((p) => p.key === wanted)) {
    portrait = wanted === 'none' ? null : wanted;
    if (avatar) {
      removeUpload(avatar);
      avatar = null;
    }
  }

  const owned = shop.ownedBy(user.id);
  const wear = {};
  for (const slot of shop.SLOTS) {
    const choice = sent(slot.key);
    wear[slot.key] = user[slot.column];
    if (choice === 'none') wear[slot.key] = null;
    else if (owned.has(choice) && shop.worn(choice, slot.key)) wear[slot.key] = choice;
  }

  db.prepare('UPDATE users SET pinned = ?, portrait = ?, avatar = ?, card_border = ?, card_charm = ? WHERE id = ?').run(
    pinned,
    portrait,
    avatar,
    wear.border,
    wear.charm,
    user.id
  );
  req.flash('success', 'Your profile card has been amended.');
  res.redirect('/settings');
});

module.exports = router;
