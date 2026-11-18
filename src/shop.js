'use strict';

// The Emporium's stock, and who owns what.
//
// Everything here is decided on the server. The page sends only the name of
// the item a member wishes to buy; the price comes from WARES below and the
// member's balance from the ledger (src/ledger.js). A purchase is one entry
// in the ledger, made only if the member holds enough, and the database
// refuses a second entry for the same member and item. What a member owns is
// read back from those entries, so owning and paying cannot come apart.
//
// To put a new item on sale: add it here, draw it (views/partials/adornment.ejs
// and public/css/style.css), and it appears on the Emporium and, once bought,
// under Your Profile Card.

// `slot` is the place on the profile card the item occupies. A member may
// wear one item in each slot:
//   border  replaces the frame of their discipline
//   charm   sits in the corner of the card
const WARES = [
  {
    key: 'gilt-border',
    slot: 'border',
    name: 'The Gilt Border',
    about: 'A border of unalloyed gold, burnished daily. It takes the place of the frame of your discipline.',
    price: 1000,
    currency: 'gold',
  },
  {
    key: 'storm-border',
    slot: 'border',
    name: 'The Crimson Storm',
    about: 'A border of red lightning, bound in place and not expected to hold still. It takes the place of the frame of your discipline.',
    price: 1000,
    currency: 'power',
  },
  {
    key: 'winged-eye',
    slot: 'charm',
    name: 'The Winged Eye',
    about: 'An eye, winged, which keeps watch from the corner of the card. It blinks. It has not been observed to sleep.',
    price: 1000,
    currency: 'knowledge',
  },
];
const BY_KEY = new Map(WARES.map((w) => [w.key, w]));
const SLOTS = [
  { key: 'border', column: 'card_border', name: 'Border', none: 'My card’s own frame' },
  { key: 'charm', column: 'card_charm', name: 'Charm', none: 'None' },
];

const db = require('./db');
const ledger = require('./ledger');

const purchases = db.prepare("SELECT ref FROM ledger WHERE user_id = ? AND reason = 'purchase'");

// The keys of the items a member owns.
function ownedBy(userId) {
  return new Set(purchases.all(userId).map((row) => row.ref).filter((key) => BY_KEY.has(key)));
}

// Buys an item for a member. Returns:
//   'bought'   it is now theirs, and the price has been taken
//   'owned'    they had it already; nothing was taken
//   'short'    they do not hold enough; nothing was taken
//   'unknown'  there is no such item
function buy(userId, key) {
  const ware = BY_KEY.get(key);
  if (!ware) return 'unknown';
  if (ownedBy(userId).has(key)) return 'owned';
  return ledger.spend(userId, ware.currency, ware.price, 'purchase', ware.key) ? 'bought' : 'short';
}

// The item a card should show in a slot: the key stored for the member, if it
// is a real item of that slot; otherwise null.
function worn(key, slot) {
  const ware = BY_KEY.get(key);
  return ware && ware.slot === slot ? ware.key : null;
}

module.exports = { WARES, SLOTS, ware: (key) => BY_KEY.get(key) || null, ownedBy, buy, worn };
