'use strict';

// Bounties: small tasks posted on the Notice Board, each paying a reward of
// 1 to 25 of one currency according to how much it asks.
//
// Every member holds three at a time. When all three are fulfilled, three
// more are issued at once. There is no limit to how many sets a member may
// work through in a day.
//
// As with the rest of the ledger, the browser decides nothing here:
//
//   - A bounty is fulfilled only when a route on the server sees the member
//     do the thing (publish a post, place a sigil) and calls record(). There
//     is no "I have done it" button, and no request names a bounty.
//   - Only what is done after a bounty is issued counts towards it, and the
//     same thing is never counted twice (the same post, the same article).
//   - The reward is fixed when the bounty is issued, kept in the database,
//     and paid once through the ledger.
//
// To add a sort of bounty, add an entry to KINDS. If it depends on something
// new happening, call record() from the route where the server confirms it.

const crypto = require('node:crypto');
const db = require('./db');
const ledger = require('./ledger');
const ARTICLES = require('./articles');
const { REACTIONS } = require('./sigils');

const SET_SIZE = 3; // bounties held at a time

// Words a member may be asked to use in a post.
const WORDS = [
  'goblin', 'dragon', 'grimoire', 'familiar', 'ley line', 'phylactery', 'cauldron', 'basilisk',
  'wyvern', 'elixir', 'rune', 'golem', 'lich', 'homunculus', 'mandrake', 'scrying',
  'portal', 'enchantment', 'troll', 'spellbook', 'amulet', 'necromancer', 'unicorn', 'hex',
];

// True if `text` uses `word` (in any capitals, and in the plural: "Goblins").
const uses = (text, word) =>
  new RegExp(`(^|[^\\p{L}])${word.replace(/ /g, '[\\s-]?')}`, 'iu').test(String(text));

const others = (userId) => db.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id <> ?').get(userId).n;
const sigilOf = (key) => REACTIONS.find((r) => r.key === key);
const onAnothersPost = (bounty, e, userId) => e.authorId !== userId;

// The sorts of bounty.
//   on        the event that can count towards it (see record() below)
//   goal      how many times the thing must be done
//   params    the words or sigils it may name; one is chosen when it is issued
//   possible  whether the site has what the task needs (other members' posts,
//             say), so that nobody is issued a bounty they cannot fulfil
//   counts    whether a given event counts
//   ref       what, about the event, must differ for it to be counted again
const KINDS = {
  call: {
    on: 'call', goal: 1, currency: 'attunement', amount: 1,
    title: () => 'A Call to Be Paid',
    task: () => 'Visit the page of another member of the Conclave.',
    possible: (userId) => db.prepare('SELECT COUNT(*) AS n FROM users WHERE verified = 1 AND id <> ?').get(userId).n > 0,
    counts: (bounty, e, userId) => e.memberId !== userId,
    ref: (e) => e.memberId,
  },
  sigil: {
    on: 'sigil', goal: 1, currency: 'power', amount: 2,
    title: () => 'A Sigil to Be Placed',
    task: () => 'Place any sigil upon a post by another member.',
    possible: (userId) => others(userId) >= 1,
    counts: onAnothersPost,
    ref: (e) => e.postId,
  },
  'sigil-named': {
    on: 'sigil', goal: 1, currency: 'power', amount: 3,
    params: () => REACTIONS.map((r) => r.key),
    title: (b) => `The Sigil “${sigilOf(b.param).label}”`,
    task: (b) => `Place the sigil ${sigilOf(b.param).emoji} “${sigilOf(b.param).label}” upon a post by another member.`,
    possible: (userId) => others(userId) >= 1,
    counts: (bounty, e, userId) => e.authorId !== userId && e.emoji === bounty.param,
    ref: (e) => e.postId,
  },
  consult: {
    on: 'article', goal: 1, currency: 'knowledge', amount: 3,
    title: () => 'The Archive to Be Consulted',
    task: () => 'Open an article of the Advice Archive.',
    possible: () => ARTICLES.length >= 1,
    counts: () => true,
    ref: (e) => e.slug,
  },
  respond: {
    on: 'response', goal: 1, currency: 'attunement', amount: 5,
    title: () => 'A Response Requested',
    task: () => 'Respond to a post by another member, in no fewer than 20 characters.',
    possible: (userId) => others(userId) >= 1,
    counts: (bounty, e, userId) => e.authorId !== userId && e.body.length >= 20,
    ref: (e) => e.postId,
  },
  notice: {
    on: 'notice', goal: 1, currency: 'gold', amount: 6,
    title: () => 'A Notice to Be Posted',
    task: () => 'Post a notice of your own upon this board.',
    possible: () => true,
    counts: () => true,
    ref: (e) => e.noticeId,
  },
  word: {
    on: 'post', goal: 1, currency: 'gold', amount: 8,
    params: () => WORDS,
    title: (b) => `Mention to Be Made of the Word “${b.param}”`,
    task: (b) => `Share a post in the Gathering Hall that uses the word “${b.param}”, in no fewer than 40 characters.`,
    possible: () => true,
    counts: (bounty, e) => e.body.length >= 40 && uses(e.body, bounty.param),
    ref: (e) => e.postId,
  },
  reading: {
    on: 'article', goal: 3, currency: 'knowledge', amount: 8,
    title: () => 'A Course of Reading',
    task: () => 'Open 3 different articles of the Advice Archive.',
    possible: () => ARTICLES.length >= 3,
    counts: () => true,
    ref: (e) => e.slug,
  },
  illustration: {
    on: 'post', goal: 1, currency: 'gold', amount: 10,
    title: () => 'An Illustration Sought',
    task: () => 'Share a post in the Gathering Hall with an image or recording attached.',
    possible: () => true,
    counts: (bounty, e) => e.media,
    ref: (e) => e.postId,
  },
  sigils: {
    on: 'sigil', goal: 5, currency: 'power', amount: 10,
    title: () => 'Sigils in Number',
    task: () => 'Place sigils upon 5 different posts by other members.',
    possible: (userId) => others(userId) >= 5,
    counts: onAnothersPost,
    ref: (e) => e.postId,
  },
  responses: {
    on: 'response', goal: 3, currency: 'attunement', amount: 14,
    title: () => 'Responses in Number',
    task: () => 'Respond to 3 different posts by other members, in no fewer than 20 characters each.',
    possible: (userId) => others(userId) >= 3,
    counts: (bounty, e, userId) => e.authorId !== userId && e.body.length >= 20,
    ref: (e) => e.postId,
  },
  treatise: {
    on: 'post', goal: 1, currency: 'knowledge', amount: 25,
    params: () => WORDS,
    title: (b) => `A Treatise Touching Upon the Word “${b.param}”`,
    task: (b) => `Share a post in the Gathering Hall of no fewer than 400 characters that uses the word “${b.param}”.`,
    possible: () => true,
    counts: (bounty, e) => e.body.length >= 400 && uses(e.body, bounty.param),
    ref: (e) => e.postId,
  },
  // Not yet offered: "Complete 5 mini-games". It waits on there being games
  // (see TODO.md). When there are, add it here with on: 'game' and have the
  // game's route call record(userId, 'game', { gameId }).
};

const openOf = db.prepare('SELECT * FROM bounties WHERE user_id = ? AND completed_at IS NULL ORDER BY id');
const latestOf = db.prepare('SELECT * FROM bounties WHERE user_id = ? ORDER BY id DESC LIMIT ?');
const fulfilledBy = db.prepare('SELECT COUNT(*) AS n FROM bounties WHERE user_id = ? AND completed_at IS NOT NULL');
const insert = db.prepare(
  'INSERT INTO bounties (user_id, kind, param, goal, currency, amount, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);

const pick = (list) => list[crypto.randomInt(list.length)];
function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Makes sure the member holds a set of bounties: if none is open, issues
// three. Three different sorts are chosen, preferring sorts that were not in
// the set just finished.
function ensureSet(userId) {
  if (openOf.all(userId).length) return;

  const last = new Set(latestOf.all(userId, SET_SIZE).map((b) => b.kind));
  const possible = shuffled(Object.keys(KINDS).filter((kind) => KINDS[kind].possible(userId)));
  const chosen = [...possible.filter((kind) => !last.has(kind)), ...possible.filter((kind) => last.has(kind))].slice(0, SET_SIZE);

  const now = Date.now();
  for (const kind of chosen) {
    const k = KINDS[kind];
    insert.run(userId, kind, k.params ? pick(k.params()) : null, k.goal, k.currency, k.amount, now);
  }
}

// A bounty as the pages show it.
function shown(bounty) {
  const kind = KINDS[bounty.kind];
  return {
    id: bounty.id,
    title: kind ? kind.title(bounty) : 'A Bounty',
    task: kind ? kind.task(bounty) : 'This bounty has been withdrawn.',
    done: Math.min(JSON.parse(bounty.seen).length, bounty.goal),
    goal: bounty.goal,
    currency: bounty.currency,
    amount: bounty.amount,
    fulfilled: !!bounty.completed_at,
  };
}

// What the Notice Board shows a member: their present set (the three most
// lately issued) and how many they have fulfilled in all.
function boardFor(userId) {
  ensureSet(userId);
  return {
    set: latestOf.all(userId, SET_SIZE).reverse().map(shown),
    fulfilled: fulfilledBy.get(userId).n,
  };
}

// Tells the bounties that a member has done something. `event` is one of:
//   'post'      { postId, body, media }     published a post in the Hall
//   'sigil'     { postId, authorId, emoji } placed a sigil on a post
//   'response'  { postId, authorId, body }  responded to a post
//   'article'   { slug }                    opened an article of the Archive
//   'notice'    { noticeId }                posted a notice on the board
//   'call'      { memberId }                visited a member's page
// Returns the bounties this fulfilled (as shown() describes them), having
// paid for each. It never throws: a fault here must not stop the action.
function record(userId, event, detail) {
  try {
    ensureSet(userId);
    const fulfilled = [];
    for (const bounty of openOf.all(userId)) {
      const kind = KINDS[bounty.kind];
      if (!kind || kind.on !== event || !kind.counts(bounty, detail, userId)) continue;
      const seen = JSON.parse(bounty.seen);
      const ref = String(kind.ref(detail));
      if (seen.includes(ref)) continue;
      seen.push(ref);
      const complete = seen.length >= bounty.goal;
      const changed = db
        .prepare('UPDATE bounties SET seen = ?, completed_at = ? WHERE id = ? AND completed_at IS NULL')
        .run(JSON.stringify(seen), complete ? Date.now() : null, bounty.id).changes;
      if (complete && changed) {
        ledger.credit(userId, bounty.currency, bounty.amount, 'bounty', `bounty ${bounty.id}`);
        fulfilled.push(shown({ ...bounty, seen: JSON.stringify(seen), completed_at: Date.now() }));
      }
    }
    // If that was the last of the set, the next three are issued at once.
    if (fulfilled.length) ensureSet(userId);
    return fulfilled;
  } catch (err) {
    console.error('Bounties: event not recorded.', err);
    return [];
  }
}

// The words with which a member is told of bounties just fulfilled, or null.
function announcement(fulfilled) {
  if (!fulfilled.length) return null;
  const paid = (b) => `${b.amount} ${b.currency}`;
  if (fulfilled.length === 1) {
    const b = fulfilled[0];
    return `Bounty fulfilled: ${b.title}. ${paid(b)} has been entered to your account.`;
  }
  return `Bounties fulfilled: ${fulfilled.map((b) => `${b.title} (${paid(b)})`).join('; ')}. The rewards have been entered to your account.`;
}

// For routes: records the event and, if it fulfilled anything, tells the
// member. After a redirect the message appears on the next page; pass
// `{ now: true }` from a route that draws its page directly.
function mark(req, res, event, detail, { now = false } = {}) {
  if (!req.user) return;
  const message = announcement(record(req.user.id, event, detail));
  if (!message) return;
  if (now) res.locals.flash = { type: 'success', message };
  else req.flash('success', message);
}

module.exports = { SET_SIZE, KINDS, boardFor, record, mark, announcement };
