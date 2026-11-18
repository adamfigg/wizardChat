'use strict';

// The Emporium: adornments for the profile card, sold for the four currencies.
// The stock and the rules of buying are in src/shop.js.

const express = require('express');
const auth = require('../auth');
const ledger = require('../ledger');
const shop = require('../shop');

const router = express.Router();

router.get('/emporium', (req, res) => {
  const held = req.user ? ledger.balances(req.user.id) : null;
  const owned = req.user ? shop.ownedBy(req.user.id) : new Set();
  const wares = shop.WARES.map((ware) => ({
    ...ware,
    currencyName: ledger.CURRENCIES.find((c) => c.key === ware.currency).name.toLowerCase(),
    icon: ledger.CURRENCIES.find((c) => c.key === ware.currency).icon,
    owned: owned.has(ware.key),
    held: held ? held[ware.currency] : 0,
    affordable: !!held && held[ware.currency] >= ware.price,
  }));
  res.render('emporium', { title: 'The Emporium', wares });
});

// The form sends only which item is wanted. The price, and whether the member
// can meet it, are settled here.
router.post('/emporium/buy', auth.requireMember, auth.requireCsrf, (req, res) => {
  const ware = shop.ware(String(req.body.item || ''));
  const outcome = ware ? shop.buy(req.user.id, ware.key) : 'unknown';
  if (outcome === 'bought') {
    req.flash('success', `${ware.name} is now in your possession. It may be applied under Your Profile Card.`);
  } else if (outcome === 'owned') {
    req.flash('info', `${ware.name} is already in your possession.`);
  } else if (outcome === 'short') {
    req.flash('error', `You do not hold enough ${ware.currency} for ${ware.name}.`);
  } else {
    req.flash('error', 'The Purveyor keeps no such item.');
  }
  res.redirect('/emporium');
});

module.exports = router;
