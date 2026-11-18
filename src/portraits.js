'use strict';

// The portraits a member may place on their profile card: two for each
// discipline. The drawings are in public/img/portraits/<key>.svg.
//
// Members no longer upload portraits of their own. For now a member may choose
// either portrait of their own discipline; later these are to be unlocked
// through progress.

const PORTRAITS = {
  mage: [
    { key: 'mage-tome', name: 'The Open Tome' },
    { key: 'mage-staff', name: 'The Crystal Staff' },
  ],
  sorcerer: [
    { key: 'sorcerer-flame', name: 'The Inborn Flame' },
    { key: 'sorcerer-diadem', name: 'The Bloodline Diadem' },
  ],
  warlock: [
    { key: 'warlock-raven', name: 'The Raven' },
    { key: 'warlock-sigil', name: 'The Sigil of the Pact' },
  ],
  alchemist: [
    { key: 'alchemist-flask', name: 'The Flask' },
    { key: 'alchemist-mortar', name: 'The Mortar and Pestle' },
  ],
  artificer: [
    { key: 'artificer-cog', name: 'The Cog' },
    { key: 'artificer-astrolabe', name: 'The Astrolabe' },
  ],
};

const ALL_KEYS = new Set(Object.values(PORTRAITS).flatMap((list) => list.map((p) => p.key)));

// The portraits open to a member of the given discipline (none for a Wanderer).
const portraitsFor = (wizardClass) => PORTRAITS[wizardClass] || [];

// The address of a stored portrait's drawing, or null if the key is not one of ours.
const portraitPath = (key) => (ALL_KEYS.has(key) ? `/img/portraits/${key}.svg` : null);

module.exports = { PORTRAITS, portraitsFor, portraitPath };
