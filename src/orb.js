'use strict';

// The crystal orb shown beside the Attunement (views/partials/orb.ejs).
//
// The orb has ten states, 0 to 9: one for each question already answered.
// At 0 it is empty; at 9 every question is answered and it is fully charged.
// All of the drawing and motion is CSS (public/css/style.css, "The orb");
// this file only supplies the words beneath it and the spiral outlines.

const CAPTIONS = [
  'The orb is still.',
  'A faint current stirs within.',
  'The current gathers.',
  'The mists begin to turn.',
  'The mists turn steadily.',
  'A light wakes at the centre.',
  'The currents quicken.',
  'The orb grows restless.',
  'The orb strains upon its stand.',
  'The orb is charged in full.',
];

// An SVG path for one spiral arm, winding outward from the centre of a
// 200 x 200 drawing. The partial repeats it at different rotations.
function spiralArm(turns, maxRadius) {
  const points = [];
  const sweep = turns * 360;
  for (let deg = 0; deg <= sweep; deg += 8) {
    const radius = 3 + (maxRadius - 3) * (deg / sweep);
    const angle = (deg * Math.PI) / 180;
    points.push(`${(100 + radius * Math.cos(angle)).toFixed(1)} ${(100 + radius * Math.sin(angle)).toFixed(1)}`);
  }
  return `M${points.join('L')}`;
}

module.exports = {
  CAPTIONS,
  MAX_LEVEL: CAPTIONS.length - 1,
  ARM_WIDE: spiralArm(1.6, 96),
  ARM_TIGHT: spiralArm(2.4, 80),
};
