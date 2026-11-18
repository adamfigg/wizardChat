'use strict';

// The Council of Wizards: matters ("motions") that a Steward puts to the
// membership, each with a set of outcomes to vote for and a time at which the
// vote closes.
//
// When a vote closes, the outcome with the most votes is carried, and every
// member who voted for it is paid REWARD of a resource chosen at random for
// each of them. Outcomes level at the top are carried jointly.
//
// So that the reward cannot be had simply by joining the leading side:
//
//   - a member has one vote on each motion, and it cannot be changed;
//   - how the votes are falling is not disclosed, to anyone, until the vote
//     has closed (only the number of votes cast is shown);
//   - the reward is paid by the server when it settles the vote, once for
//     each member, through the ledger.

const crypto = require('node:crypto');
const db = require('./db');
const ledger = require('./ledger');

const REWARD = 25;
const MINUTE = 60 * 1000;
// How long a Steward may leave a vote open.
const TERMS = [
  { key: '15m', name: 'A quarter of an hour', ms: 15 * MINUTE },
  { key: '1h', name: 'One hour', ms: 60 * MINUTE },
  { key: '6h', name: 'Six hours', ms: 6 * 60 * MINUTE },
  { key: '1d', name: 'One day', ms: 24 * 60 * MINUTE },
  { key: '3d', name: 'Three days', ms: 3 * 24 * 60 * MINUTE },
  { key: '7d', name: 'Seven days', ms: 7 * 24 * 60 * MINUTE },
];
const LIMITS = { title: [8, 160], body: 1000, options: [2, 6], option: 80 };

const SELECT = 'SELECT m.*, u.name AS steward_name FROM motions m JOIN users u ON u.id = m.user_id';

// Checks what a Steward has entered for a new motion. Returns { error } or
// the cleaned { title, body, options, term }.
function readMotion(form) {
  const title = String(form.title || '').trim().replace(/\s+/g, ' ');
  const body = String(form.body || '').replace(/\r\n/g, '\n').trim();
  const options = String(form.options || '')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const term = TERMS.find((t) => t.key === form.term);
  const values = { title, body, options: options.join('\n'), term: term ? term.key : '' };

  let error = null;
  if (title.length < LIMITS.title[0] || title.length > LIMITS.title[1]) {
    error = `The matter must be stated in ${LIMITS.title[0]} to ${LIMITS.title[1]} characters.`;
  } else if (body.length > LIMITS.body) {
    error = `The particulars must not exceed ${LIMITS.body.toLocaleString('en-GB')} characters.`;
  } else if (options.length < LIMITS.options[0] || options.length > LIMITS.options[1]) {
    error = `Give between ${LIMITS.options[0]} and ${LIMITS.options[1]} outcomes, one to a line.`;
  } else if (options.some((o) => o.length > LIMITS.option)) {
    error = `No outcome may exceed ${LIMITS.option} characters.`;
  } else if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    error = 'Each outcome must differ from the others.';
  } else if (!term) {
    error = 'Choose how long the vote is to remain open.';
  }
  return error ? { error, values } : { title, body, options, term, values };
}

function lay(stewardId, { title, body, options, term }) {
  const now = Date.now();
  return db
    .prepare('INSERT INTO motions (user_id, title, body, options, created_at, closes_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(stewardId, title, body || null, JSON.stringify(options), now, now + term.ms).lastInsertRowid;
}

// Records a member's vote. Returns 'cast', 'already' (they have voted),
// 'closed' (the vote is over, or there is no such motion), or 'invalid'.
function vote(userId, motionId, choice) {
  const motion = db.prepare('SELECT * FROM motions WHERE id = ?').get(motionId);
  if (!motion || motion.settled_at || motion.closes_at <= Date.now()) return 'closed';
  const index = Number(choice);
  if (!Number.isInteger(index) || index < 0 || index >= JSON.parse(motion.options).length) return 'invalid';
  const made = db
    .prepare('INSERT OR IGNORE INTO votes (motion_id, user_id, choice, created_at) VALUES (?, ?, ?, ?)')
    .run(motion.id, userId, index, Date.now()).changes;
  return made ? 'cast' : 'already';
}

// Closes every vote whose time has come: works out what was carried and pays
// those who voted for it. Run every half minute, and before any page that
// shows the Council's business, so a result is never stale.
function settle() {
  const due = db.prepare('SELECT * FROM motions WHERE settled_at IS NULL AND closes_at <= ?').all(Date.now());
  for (const motion of due) {
    try {
      const tally = JSON.parse(motion.options).map(() => 0);
      const votes = db.prepare('SELECT user_id, choice FROM votes WHERE motion_id = ?').all(motion.id);
      for (const v of votes) if (tally[v.choice] !== undefined) tally[v.choice] += 1;
      const most = Math.max(...tally);
      const winners = most > 0 ? tally.map((n, i) => (n === most ? i : -1)).filter((i) => i >= 0) : [];

      // Marked as settled first, and only by whoever gets there first, so the
      // rewards below are handed out once.
      const mine = db
        .prepare('UPDATE motions SET settled_at = ?, winners = ? WHERE id = ? AND settled_at IS NULL')
        .run(Date.now(), JSON.stringify(winners), motion.id).changes;
      if (!mine) continue;
      for (const v of votes) {
        if (!winners.includes(v.choice)) continue;
        const resource = ledger.CURRENCIES[crypto.randomInt(ledger.CURRENCIES.length)].key;
        ledger.credit(v.user_id, resource, REWARD, 'council', `motion ${motion.id}`);
      }
    } catch (err) {
      console.error('Council: a vote could not be settled.', err);
    }
  }
}
setInterval(settle, 30 * 1000).unref();

// Ends a vote now (a Steward's doing). The usual settlement follows.
function closeNow(motionId) {
  const changed = db
    .prepare('UPDATE motions SET closes_at = ? WHERE id = ? AND settled_at IS NULL')
    .run(Date.now(), motionId).changes;
  settle();
  return changed === 1;
}

// Removes a motion on which voting is still open. Nothing is paid.
function withdraw(motionId) {
  return db.prepare('DELETE FROM motions WHERE id = ? AND settled_at IS NULL').run(motionId).changes === 1;
}

// A motion as the pages show it to `viewerId` (null for a visitor). The
// count for each outcome is included only once the vote has closed.
function shown(motion, viewerId) {
  const options = JSON.parse(motion.options);
  const settled = !!motion.settled_at;
  const winners = settled ? JSON.parse(motion.winners || '[]') : [];
  const mine = viewerId
    ? db.prepare('SELECT choice FROM votes WHERE motion_id = ? AND user_id = ?').get(motion.id, viewerId)
    : null;
  const cast = db.prepare('SELECT COUNT(*) AS n FROM votes WHERE motion_id = ?').get(motion.id).n;

  let counts = null;
  if (settled) {
    counts = options.map(() => 0);
    for (const row of db.prepare('SELECT choice, COUNT(*) AS n FROM votes WHERE motion_id = ? GROUP BY choice').all(motion.id)) {
      if (counts[row.choice] !== undefined) counts[row.choice] = row.n;
    }
  }
  const reward =
    settled && viewerId
      ? db.prepare("SELECT currency, amount FROM ledger WHERE user_id = ? AND reason = 'council' AND ref = ?").get(viewerId, `motion ${motion.id}`)
      : null;

  return {
    id: motion.id,
    title: motion.title,
    body: motion.body,
    steward: motion.steward_name,
    closesAt: motion.closes_at,
    settledAt: motion.settled_at,
    settled,
    cast,
    myChoice: mine ? mine.choice : null,
    reward: reward || null,
    options: options.map((text, i) => ({
      text,
      count: counts ? counts[i] : null,
      share: counts && cast ? Math.round((counts[i] / cast) * 100) : 0,
      carried: winners.includes(i),
    })),
    carried: winners.map((i) => options[i]),
  };
}

// Everything for the Council's own page.
function business(viewerId) {
  settle();
  return {
    open: db.prepare(`${SELECT} WHERE m.settled_at IS NULL ORDER BY m.closes_at, m.id`).all().map((m) => shown(m, viewerId)),
    decided: db.prepare(`${SELECT} WHERE m.settled_at IS NOT NULL ORDER BY m.settled_at DESC, m.id DESC LIMIT 20`).all().map((m) => shown(m, viewerId)),
  };
}

// For the scroll in the Gathering Hall: the latest result, and the vote that
// closes soonest. Null if the Council has no business at all.
function forHall(viewerId) {
  settle();
  const latest = db.prepare(`${SELECT} WHERE m.settled_at IS NOT NULL ORDER BY m.settled_at DESC, m.id DESC LIMIT 1`).get();
  const next = db.prepare(`${SELECT} WHERE m.settled_at IS NULL ORDER BY m.closes_at, m.id LIMIT 1`).get();
  if (!latest && !next) return null;
  return { latest: latest ? shown(latest, viewerId) : null, next: next ? shown(next, viewerId) : null };
}

module.exports = { REWARD, TERMS, LIMITS, readMotion, lay, vote, settle, closeNow, withdraw, business, forHall };
