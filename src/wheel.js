'use strict';

// The Back Alley's wheel. A turn goes in three steps, and the server holds
// every one of them:
//
//   1. stake()  The member gives their word. The Broker takes between 1 and
//               MAX_STAKE of one resource: which resource, and how much, are
//               chosen here at random from what the member holds. It is
//               taken at once, so a member who dislikes the stake cannot
//               walk away and try again for a better one. They may have only
//               one turn in progress.
//   2. spin()   The member names one of the four resources. Only then does
//               the server decide where the wheel comes to rest, so the
//               result does not exist anywhere to be read beforehand.
//   3.          If the wheel rests on the resource named, the stake is paid
//               back twofold. Otherwise it is kept.
//
// The page shows a wheel turning, but the turning decides nothing: by the
// time it is drawn the result is already in the database.
//
// With four resources, a member wins one turn in four, and so on average
// loses half of everything staked.

const crypto = require('node:crypto');
const db = require('./db');
const ledger = require('./ledger');

const MAX_STAKE = 25;
const RESOURCES = ledger.CURRENCIES.map((c) => c.key);

const openOf = db.prepare('SELECT * FROM wagers WHERE user_id = ? AND landed IS NULL');

// The turn a member has in progress (staked, not yet spun), or null.
const pending = (userId) => openOf.get(userId) || null;

// Step 1. Returns the new wager, or null if the member holds nothing to stake.
function stake(userId) {
  const open = pending(userId);
  if (open) return open;

  const held = ledger.balances(userId);
  const able = RESOURCES.filter((key) => held[key] >= 1);
  if (!able.length) return null;
  const currency = able[crypto.randomInt(able.length)];
  const amount = crypto.randomInt(1, Math.min(MAX_STAKE, held[currency]) + 1);

  const id = Number(
    db.prepare('INSERT INTO wagers (user_id, currency, amount, created_at) VALUES (?, ?, ?, ?)').run(userId, currency, amount, Date.now()).lastInsertRowid
  );
  // The stake leaves the member's account here. If it cannot be taken after
  // all (they spent it elsewhere in the same instant), there is no wager.
  if (!ledger.spend(userId, currency, amount, 'wager', `wager ${id}`)) {
    db.prepare('DELETE FROM wagers WHERE id = ?').run(id);
    return null;
  }
  return db.prepare('SELECT * FROM wagers WHERE id = ?').get(id);
}

// Step 2. Returns the settled wager, or null if `pick` is not a resource or
// the member has no turn in progress.
function spin(userId, pick) {
  if (!RESOURCES.includes(pick)) return null;
  const wager = pending(userId);
  if (!wager) return null;

  const landed = RESOURCES[crypto.randomInt(RESOURCES.length)];
  const mine = db
    .prepare('UPDATE wagers SET pick = ?, landed = ?, settled_at = ? WHERE id = ? AND landed IS NULL')
    .run(pick, landed, Date.now(), wager.id).changes;
  if (!mine) return null;
  if (pick === landed) ledger.credit(userId, wager.currency, wager.amount * 2, 'wager-won', `wager ${wager.id}`);
  return db.prepare('SELECT * FROM wagers WHERE id = ?').get(wager.id);
}

// A finished turn belonging to this member, for the page that shows it.
function finished(userId, wagerId) {
  return db.prepare('SELECT * FROM wagers WHERE id = ? AND user_id = ? AND landed IS NOT NULL').get(wagerId, userId) || null;
}

// How the member has fared: turns taken, turns won.
function record(userId) {
  return db
    .prepare('SELECT COUNT(*) AS turns, COALESCE(SUM(pick = landed), 0) AS won FROM wagers WHERE user_id = ? AND landed IS NOT NULL')
    .get(userId);
}

module.exports = { MAX_STAKE, RESOURCES, pending, stake, spin, finished, record };
