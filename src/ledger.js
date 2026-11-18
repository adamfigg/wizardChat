'use strict';

// The ledger: what every member holds of the four currencies (gold,
// attunement, knowledge, power), and how they came by it.
//
// It is built so that members cannot grant themselves anything:
//
//   1. The browser never states an amount. No page or form sends "give me 5
//      gold". A route on the server confirms that something really happened
//      (an article was opened, the Attunement was completed) and then calls
//      award() itself, naming a rule from RULES below. The amount comes from
//      the rule, not from the request.
//   2. Nothing is paid twice. Every entry records the rule and the particular
//      thing it was for (`ref`), and the database refuses a second entry with
//      the same member, rule, and ref. Reloading a page, pressing a button
//      twice, or withdrawing a sigil and placing it again earns nothing more.
//   3. A balance is never stored where a member could alter it (a cookie, the
//      page). It is the sum of that member's entries, worked out afresh from
//      the database whenever it is shown.
//   4. Spending checks the balance and records the cost in one step, so a
//      balance cannot fall below nothing however fast requests arrive.
//
// To change what earns what, edit RULES. To add a new way of earning, add a
// rule and call award() from the route where the action is confirmed.

const db = require('./db');

// In the order they are shown at the head of the page. `icon` is the drawing
// that stands for the currency: the inside of an SVG 24 units square.
const CURRENCIES = [
  {
    key: 'gold',
    name: 'Gold',
    // a coin
    icon: '<circle cx="12" cy="12" r="9.25" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="5.9" fill="none" stroke="currentColor" stroke-opacity=".6"/><path d="M12 8.4l1.05 2.55L15.6 12l-2.55 1.05L12 15.6l-1.05-2.55L8.4 12l2.55-1.05z" fill="currentColor"/>',
  },
  {
    key: 'attunement',
    name: 'Attunement',
    // the orb upon its stand
    icon: '<circle cx="12" cy="10.25" r="7.25" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.5"/><path d="M8.7 10.8c0-2.1 1.5-3.6 3.4-3.6 1.6 0 2.8 1.1 2.8 2.5 0 1.2-.9 2.1-2 2.1-.9 0-1.5-.6-1.5-1.3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M7 21.5h10l-1.7-3.4H8.7z" fill="currentColor"/>',
  },
  {
    key: 'knowledge',
    name: 'Knowledge',
    // an open book
    icon: '<path d="M12 6.6C10.2 5.3 7.6 4.8 4 5.1v13c3.6-.3 6.2.2 8 1.5 1.8-1.3 4.4-1.8 8-1.5v-13c-3.6-.3-6.2.2-8 1.5z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 6.6v13" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  },
  {
    key: 'power',
    name: 'Power',
    // a bolt
    icon: '<path d="M13.6 2.5L5 13.6h5.6l-1.1 7.9L19 10.1h-5.9z" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  },
];
const CURRENCY_KEYS = new Set(CURRENCIES.map((c) => c.key));

// What earns what. `perDay`, where given, is the most entries under that rule
// one member may receive in a day.
const RULES = {
  // First visit of the day while logged in.            ref: the date
  attendance: { currency: 'gold', amount: 5 },
  // Completing the Attunement.                         ref: 'once'
  attuned: { currency: 'attunement', amount: 10 },
  // Opening an article of the Advice Archive.          ref: the article
  'article-read': { currency: 'knowledge', amount: 1 },
  // Another member placing a sigil on one of your posts; counted once for
  // each member on each post.                          ref: the post and the member
  'sigil-received': { currency: 'power', amount: 1, perDay: 20 },
};

// Days are reckoned in UTC, so "today" does not depend on where the server is.
const today = () => new Date().toISOString().slice(0, 10);
const startOfToday = () => Date.parse(`${today()}T00:00:00Z`);

const insertEntry = db.prepare(
  `INSERT OR IGNORE INTO ledger (user_id, currency, amount, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)`
);
const countSince = db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE user_id = ? AND reason = ? AND created_at >= ?');
const sumByCurrency = db.prepare('SELECT currency, SUM(amount) AS total FROM ledger WHERE user_id = ? GROUP BY currency');
const sumOne = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM ledger WHERE user_id = ? AND currency = ?');

// Pays `userId` under the rule named `reason`, for the thing identified by
// `ref`. Returns true if an entry was made, false if it had been paid already
// or the day's limit was reached. It never throws: a fault here must not stop
// the action the member was actually taking.
function award(userId, reason, ref) {
  const rule = RULES[reason];
  try {
    if (!rule) throw new Error(`The ledger has no rule named "${reason}"`);
    if (rule.perDay && countSince.get(userId, reason, startOfToday()).n >= rule.perDay) return false;
    return insertEntry.run(userId, rule.currency, rule.amount, reason, String(ref), Date.now()).changes === 1;
  } catch (err) {
    console.error('Ledger: award not recorded.', err);
    return false;
  }
}

// Pays a member an amount that is not fixed by a rule above but was fixed
// elsewhere on the server (a bounty's reward, set when the bounty was issued).
// As with award(), `reason` and `ref` together are paid once only, and the
// amount never comes from the browser. Returns true if an entry was made.
function credit(userId, currency, amount, reason, ref) {
  try {
    if (!CURRENCY_KEYS.has(currency) || !Number.isInteger(amount) || amount <= 0) {
      throw new Error('credit() needs a known currency and a whole amount above zero');
    }
    return insertEntry.run(userId, currency, amount, reason, String(ref), Date.now()).changes === 1;
  } catch (err) {
    console.error('Ledger: credit not recorded.', err);
    return false;
  }
}

// What a member holds: { gold, attunement, knowledge, power }.
function balances(userId) {
  const held = Object.fromEntries(CURRENCIES.map((c) => [c.key, 0]));
  for (const row of sumByCurrency.all(userId)) held[row.currency] = row.total;
  return held;
}

// Takes `amount` of `currency` from a member, for the thing identified by
// `reason` and `ref` (for example 'purchase', 'banner:embers'). Returns true
// if it was taken; false if they hold too little, or have already paid for
// that same thing. The check and the entry happen inside one transaction.
// Used by the Emporium (src/shop.js).
function spend(userId, currency, amount, reason, ref) {
  if (!CURRENCY_KEYS.has(currency) || !Number.isInteger(amount) || amount <= 0) {
    throw new Error('spend() needs a known currency and a whole amount above zero');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const enough = sumOne.get(userId, currency).total >= amount;
    const taken = enough && insertEntry.run(userId, currency, -amount, reason, String(ref), Date.now()).changes === 1;
    db.exec('COMMIT');
    return taken;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// A gift from a Steward: `amount` of `currency`, entered in the ledger like
// everything else, with a note of what it was for. Only scripts/grant.js
// calls this, from the machine that holds the database; no page can.
function grant(userId, currency, amount, note) {
  if (!CURRENCY_KEYS.has(currency) || !Number.isInteger(amount) || amount <= 0) {
    throw new Error('grant() needs a known currency and a whole amount above zero');
  }
  // The time and a random part make each grant a separate entry.
  const ref = `${note || 'grant'} · ${new Date().toISOString()} · ${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO ledger (user_id, currency, amount, reason, ref, created_at) VALUES (?, ?, ?, 'steward-grant', ?, ?)`
  ).run(userId, currency, amount, ref, Date.now());
}

// The day's attendance. Called on every page a logged-in member opens, so it
// remembers who has been paid today and troubles the database once each.
const attended = new Map(); // member id -> the date last paid
function attend(userId) {
  const day = today();
  if (attended.get(userId) === day) return;
  attended.set(userId, day);
  award(userId, 'attendance', day);
}

// Members who completed the Attunement before the ledger existed are paid for
// it now. Safe to run at every start: nothing is paid twice.
db.prepare(
  `INSERT OR IGNORE INTO ledger (user_id, currency, amount, reason, ref, created_at)
   SELECT id, ?, ?, 'attuned', 'once', ? FROM users WHERE wizard_class IS NOT NULL`
).run(RULES.attuned.currency, RULES.attuned.amount, Date.now());

module.exports = { CURRENCIES, RULES, award, credit, balances, spend, grant, attend };
