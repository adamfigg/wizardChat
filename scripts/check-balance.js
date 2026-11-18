'use strict';

// Enumerates every possible combination of attunement answers and reports how
// often each discipline is assigned. Run with: npm run balance

const { QUESTIONS, CLASS_KEYS, CLASSES, assignClass } = require('../src/classes');

const counts = Object.fromEntries(CLASS_KEYS.map((k) => [k, 0]));
let total = 0;

function walk(i, answers) {
  if (i === QUESTIONS.length) {
    counts[assignClass(answers)]++;
    total++;
    return;
  }
  const q = QUESTIONS[i];
  for (const o of q.options) walk(i + 1, { ...answers, [q.id]: o.value });
}
walk(0, {});

console.log(`${total} possible combinations of answers\n`);
for (const k of CLASS_KEYS) {
  const pct = ((counts[k] / total) * 100).toFixed(1);
  console.log(`${CLASSES[k].name.padEnd(10)} ${String(counts[k]).padStart(5)}  ${pct}%`);
}
