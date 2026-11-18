'use strict';

// The five disciplines, the attunement questions asked at sign-up, and the
// scoring that assigns a discipline from the answers.
//
// How assignment works:
//   1. Every answer awards points to one or more disciplines (see `w` below).
//   2. The discipline with the highest total is assigned.
//   3. Ties are broken deterministically from the answers themselves, so the
//      same answers always produce the same discipline.
//
// The weights are tuned so that, across every possible combination of answers,
// each discipline is assigned close to one fifth of the time.
// Run `npm run balance` after changing any weight to see the distribution.

const CLASSES = {
  mage: {
    name: 'Mage',
    description:
      'A scholar who learns magic through rigorous study of spellbooks, ancient texts, and academic institutions.',
  },
  sorcerer: {
    name: 'Sorcerer',
    description:
      'Draws power from an innate, often bloodline-based mystical heritage rather than studying books.',
  },
  warlock: {
    name: 'Warlock',
    description: 'Gains arcane power through a pact or bargain with an otherworldly entity.',
  },
  alchemist: {
    name: 'Alchemist',
    description: 'Brews potions, mutates substances, and crafts magical artifacts.',
  },
  artificer: {
    name: 'Artificer',
    description:
      'Acts as a magical engineer who infuses magic into mechanical devices and gear.',
  },
};

const CLASS_KEYS = Object.keys(CLASSES);

// w: points awarded per discipline when the option is chosen.
// trait: how the answer is phrased when shown as a pinned feature on a profile card.
const QUESTIONS = [
  {
    id: 'astral',
    text: 'Where do you find yourself connecting to the astral plane easiest?',
    options: [
      { value: 'wilds', label: 'In the wilds', trait: 'Attuned in the wilds', w: { sorcerer: 2, warlock: 1, alchemist: 1 } },
      { value: 'library', label: 'In the tower library', trait: 'Attuned in the tower library', w: { mage: 2, artificer: 2 } },
    ],
  },
  {
    id: 'pursuit',
    text: 'Do you seek power over knowledge, or knowledge over power?',
    options: [
      { value: 'power', label: 'Power over knowledge', trait: 'Seeks power over knowledge', w: { warlock: 2, sorcerer: 2 } },
      { value: 'knowledge', label: 'Knowledge over power', trait: 'Seeks knowledge over power', w: { mage: 2, artificer: 1, alchemist: 1 } },
    ],
  },
  {
    id: 'lock',
    text: 'Do you prefer a tome with a lock that is iron, or one sealed with arcane power?',
    options: [
      { value: 'iron', label: 'A lock of iron', trait: 'Keeps tomes under iron lock', w: { artificer: 2, alchemist: 1 } },
      { value: 'arcane', label: 'Sealed with arcane power', trait: 'Keeps tomes under arcane seal', w: { mage: 1, sorcerer: 1, warlock: 1 } },
    ],
  },
  {
    id: 'familiar',
    text: 'What is your preferred familiar?',
    options: [
      { value: 'owl', label: 'Owl', trait: 'Familiar: Owl', w: { mage: 2, artificer: 1 } },
      { value: 'raven', label: 'Raven', trait: 'Familiar: Raven', w: { warlock: 2 } },
      { value: 'frog', label: 'Frog', trait: 'Familiar: Frog', w: { alchemist: 2 } },
      { value: 'snake', label: 'Snake', trait: 'Familiar: Snake', w: { sorcerer: 2, warlock: 1 } },
    ],
  },
  {
    id: 'implement',
    text: 'Staff or wand?',
    options: [
      { value: 'staff', label: 'Staff', trait: 'Bears a staff', w: { sorcerer: 1, warlock: 1 } },
      { value: 'wand', label: 'Wand', trait: 'Bears a wand', w: { mage: 1, artificer: 1, alchemist: 1 } },
    ],
  },
  {
    id: 'spells',
    text: 'How many spells are you familiar with?',
    options: [
      { value: 'none', label: 'None', trait: 'Practises without spells', w: { artificer: 2, alchemist: 2 } },
      { value: 'some', label: 'Some', trait: 'Versed in some spells', w: { warlock: 1, alchemist: 1, sorcerer: 1 } },
      { value: 'many', label: 'Many', trait: 'Versed in many spells', w: { mage: 1, sorcerer: 1, warlock: 1 } },
      { value: 'all', label: 'All', trait: 'Versed in all spells', w: { mage: 2 } },
    ],
  },
  {
    id: 'orbs',
    text: 'How many orbs do you ponder?',
    options: [
      { value: 'none', label: 'None', trait: 'Ponders no orbs', w: { artificer: 1, alchemist: 1 } },
      { value: 'few', label: 'Fewer than 3', trait: 'Ponders fewer than 3 orbs', w: { sorcerer: 1, mage: 1 } },
      { value: 'many', label: 'More than 3', trait: 'Ponders more than 3 orbs', w: { warlock: 2 } },
    ],
  },
  {
    id: 'alchemy',
    text: 'Do you enjoy the arts of alchemy?',
    options: [
      { value: 'yes', label: 'Oh my, yes', trait: 'Devoted to alchemy', w: { alchemist: 3 } },
      { value: 'somewhat', label: 'Somewhat, when it fits me', trait: 'Practises alchemy when it suits', w: { artificer: 2, alchemist: 1 } },
      { value: 'no', label: 'Not at all', trait: 'Abstains from alchemy', w: { sorcerer: 1, warlock: 1, mage: 1 } },
    ],
  },
  {
    id: 'element',
    text: 'Which element calls to you naturally?',
    options: [
      { value: 'lightning', label: 'Arcane lightning', trait: 'Called by arcane lightning', w: { artificer: 2, mage: 1 } },
      { value: 'flame', label: 'Blazing flame', trait: 'Called by blazing flame', w: { sorcerer: 2 } },
      { value: 'frost', label: 'Enduring frost', trait: 'Called by enduring frost', w: { mage: 1, alchemist: 1 } },
      { value: 'thorns', label: 'Eldritch thorns', trait: 'Called by eldritch thorns', w: { warlock: 2, alchemist: 1 } },
    ],
  },
];

function findOption(question, value) {
  return question.options.find((o) => o.value === value);
}

// Returns true when `answers` holds a valid choice for every question.
function validAnswers(answers) {
  return (
    !!answers &&
    QUESTIONS.every((q) => typeof answers[q.id] === 'string' && findOption(q, answers[q.id]))
  );
}

function scoreAnswers(answers) {
  const scores = Object.fromEntries(CLASS_KEYS.map((k) => [k, 0]));
  for (const q of QUESTIONS) {
    const opt = findOption(q, answers[q.id]);
    for (const [cls, pts] of Object.entries(opt.w)) scores[cls] += pts;
  }
  return scores;
}

function assignClass(answers) {
  const scores = scoreAnswers(answers);
  const top = Math.max(...Object.values(scores));
  const tied = CLASS_KEYS.filter((k) => scores[k] === top);
  if (tied.length === 1) return tied[0];
  // Tie-break: derive a stable index from the positions of the chosen answers.
  let n = 0;
  QUESTIONS.forEach((q, i) => {
    n += (q.options.findIndex((o) => o.value === answers[q.id]) + 1) * (i + 1);
  });
  return tied[n % tied.length];
}

// The traits a member may pin to their profile card, derived from their answers.
function traitsFor(answers) {
  if (!validAnswers(answers)) return [];
  return QUESTIONS.map((q) => findOption(q, answers[q.id]).trait);
}

// The inscriptions a member may show on their card. Each is one of their own
// traits. Those from the first five questions are open from the outset; the
// remaining four are sealed, to be unlocked through progress.
const OPEN_INSCRIPTIONS = 5;
function inscriptionsFor(answers) {
  const all = traitsFor(answers);
  return { open: all.slice(0, OPEN_INSCRIPTIONS), sealed: all.slice(OPEN_INSCRIPTIONS) };
}

module.exports = { CLASSES, CLASS_KEYS, QUESTIONS, validAnswers, scoreAnswers, assignClass, traitsFor, inscriptionsFor };
