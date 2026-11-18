'use strict';

// Fills an empty site with five demonstration members (one per discipline),
// a few posts, responses, sigils, and notices, so every page has content.
// Run with: npm run seed
//
// The demonstration members cannot be logged into (they have no usable
// passphrase). To remove everything and start clean, stop the server and
// delete the data/ folder.

const crypto = require('node:crypto');
const db = require('../src/db');
const { QUESTIONS, CLASS_KEYS, scoreAnswers, assignClass, traitsFor } = require('../src/classes');

if (db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@demo.invalid'").get().n) {
  console.log('Demonstration members are already present. Nothing was changed.');
  process.exit(0);
}

// For each discipline, find the set of answers that points to it most decisively.
function decisiveAnswers() {
  const best = {};
  (function walk(i, answers) {
    if (i === QUESTIONS.length) {
      const cls = assignClass(answers);
      const s = scoreAnswers(answers);
      const margin = s[cls] - Math.max(...CLASS_KEYS.filter((k) => k !== cls).map((k) => s[k]));
      if (!best[cls] || margin > best[cls].margin) best[cls] = { margin, answers };
      return;
    }
    for (const o of QUESTIONS[i].options) walk(i + 1, { ...answers, [QUESTIONS[i].id]: o.value });
  })(0, {});
  return best;
}

const names = {
  mage: 'Ysolde of the Ninth Stack',
  sorcerer: 'Caedmon Emberborn',
  warlock: 'Morwenna Vex',
  alchemist: 'Barnabas Quillfeather',
  artificer: 'Tobias Cogsworth',
};

const best = decisiveAnswers();
const ids = {};
const HOUR = 3600 * 1000;
const now = Date.now();

for (const cls of CLASS_KEYS) {
  const { answers } = best[cls];
  const traits = traitsFor(answers);
  ids[cls] = db
    .prepare(
      `INSERT INTO users (email, name, pass_hash, verified, wizard_class, answers, pinned, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
    )
    .run(
      `${cls}@demo.invalid`,
      names[cls],
      `disabled:${crypto.randomBytes(8).toString('hex')}`,
      cls,
      JSON.stringify(answers),
      traits[QUESTIONS.findIndex((q) => q.id === 'familiar')],
      now - 40 * 24 * HOUR
    ).lastInsertRowid;
}

const post = (cls, hoursAgo, body) =>
  db.prepare('INSERT INTO posts (user_id, body, created_at) VALUES (?, ?, ?)').run(ids[cls], body, now - hoursAgo * HOUR)
    .lastInsertRowid;
const comment = (postId, cls, hoursAgo, body) =>
  db.prepare('INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(postId, ids[cls], body, now - hoursAgo * HOUR);
const react = (postId, cls, emoji) =>
  db.prepare('INSERT OR IGNORE INTO reactions (post_id, user_id, emoji) VALUES (?, ?, ?)').run(postId, ids[cls], emoji);
const ad = (cls, hoursAgo, category, title, body, price, contact) =>
  db.prepare('INSERT INTO ads (user_id, category, title, body, price, contact, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    ids[cls], category, title, body, price, contact, now - hoursAgo * HOUR);

const p1 = post('mage', 30, 'I have completed the recataloguing of the lower stacks. Forty-one volumes had been shelved by height. I refer the membership to the Archive’s guidance on gnomes; the signs were all present and I did not heed them.');
comment(p1, 'alchemist', 28, 'The same occurred in my stillroom last winter, though with jars. Arranged by colour. I confess it was an improvement.');
comment(p1, 'artificer', 27, 'I can furnish a fitted board for the gap if you send the measurements.');
react(p1, 'alchemist', 'scroll'); react(p1, 'artificer', 'scroll'); react(p1, 'sorcerer', 'wizard');

const p2 = post('sorcerer', 20, 'Struck oak on the western ridge after last night’s storm. Still warm at dawn. I have taken what I require; the remainder lies beside the cairn for any who can reach it before the rain.');
comment(p2, 'warlock', 19, 'Collected. My thanks. The charge was considerable.');
react(p2, 'warlock', 'bolt'); react(p2, 'mage', 'bolt'); react(p2, 'artificer', 'flame'); react(p2, 'alchemist', 'bolt');

const p3 = post('artificer', 9, 'The self-winding astrolabe has now kept true for a full lunar month without correction. The fault lay in the third escapement, which I had tempered by candle and should have tempered by forge. Drawings available on request.');
comment(p3, 'mage', 8, 'I should be glad of the drawings. The tower’s own instrument loses a quarter-hour each week.');
react(p3, 'mage', 'wand'); react(p3, 'sorcerer', 'dragon');

const p4 = post('alchemist', 5, 'A caution. Standing-water silt from the old slate quarry has altered since the autumn. Two reductions have failed and the residue is no longer grey. I would advise drawing from elsewhere until the cause is known.');
react(p4, 'mage', 'scroll'); react(p4, 'warlock', 'potion'); react(p4, 'sorcerer', 'scroll');

const p5 = post('warlock', 2, 'Renewed the terms this past new moon. For those who ask each year: read every clause, including those that appear only by candlelight, and agree to nothing described as customary.');
comment(p5, 'sorcerer', 1, 'Sound counsel.');
react(p5, 'alchemist', 'orb'); react(p5, 'mage', 'wizard');

ad('alchemist', 50, 'Reagents & Materials', 'Surplus moonwort, cut this past full moon', 'Eleven stems, cut cleanly and dried flat between linen. More than I shall use before the season turns. Will divide.', '3 gold the stem, or exchange for clean glassware', 'Leave word at the stillroom door, Quillfeather’s Yard');
ad('artificer', 34, 'Services Offered', 'Repair of locks, hinges, and clasps for tomes', 'Iron and brass fittings mended or made new. Work is done with the book closed and is never performed on a volume under seal. Rust removed from boards where it has not yet reached the leaves.', 'From 5 gold, by inspection', 'The workshop beneath the clock, any morning');
ad('mage', 26, 'Tomes & Scrolls', 'Sought: the second volume of Halloran’s Concordance', 'I hold the first and third. Any condition considered provided the plates are intact. Will pay fairly or exchange from my duplicates, a list of which may be had on request.', null, 'By letter to the Ninth Stack, care of the under-librarian');
ad('sorcerer', 12, 'Towers & Lodgings', 'Upper chamber to let, exposed ridge, excellent storms', 'Single round chamber with hearth. Unobstructed weather on three sides. Not suited to those who keep paper in quantity. Familiar welcome, excepting frogs, on account of the stair.', '20 gold the season', 'Enquire at the ridge tower after dusk');
ad('warlock', 4, 'Orbs & Scrying', 'Orb stand of black iron, three-footed', 'Holds an orb of up to two hands’ breadth. No longer required. It has held only the one orb and I make no claims regarding what that orb showed.', '8 gold', 'Leave a sealed note beneath the grey stone at the crossroads');

console.log('Demonstration members, posts, and notices have been added.');
