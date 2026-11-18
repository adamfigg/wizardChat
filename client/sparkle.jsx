// Scatters sparkles over every element marked data-sparkle:
//
//   - the banner inviting Wanderers to take the Attunement
//     (views/partials/header.ejs);
//   - the beam of light over each item in the Emporium (views/emporium.ejs),
//     where the sparkles are kept invisible by the stylesheet until the item
//     is pointed at.
//
// data-sparkle-count="28" sets how many (56 if not given).
//
// The page is complete without this script: if it fails to load, those
// places are simply still.
//
// After changing this file, run `npm run build` to regenerate
// public/js/sparkle.js, which is the file the browser loads.

import React from 'react';
import { createRoot } from 'react-dom/client';
import Sparkle from 'react-sparkle';

const OVERFLOW = 14; // how far, in pixels, sparkles may stray beyond their element

// Visitors who have asked their device for less motion get none.
const prefersStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// react-sparkle places its first sparkles before it has measured the element,
// which bunches them at the left edge for several seconds. Once its canvas
// has taken the element's width, lay the sparkles out afresh.
function spreadOnceMeasured(layer) {
  return (sparkle) => {
    if (!sparkle || typeof sparkle.end !== 'function' || typeof sparkle.start !== 'function') return;
    let framesLeft = 120;
    const check = () => {
      const canvas = sparkle.sparkleCanvas;
      if (!canvas || framesLeft-- <= 0) return;
      if (Math.abs(canvas.width - (layer.offsetWidth + 2 * OVERFLOW)) <= 1) {
        sparkle.end();
        sparkle.start();
      } else {
        window.requestAnimationFrame(check);
      }
    };
    window.requestAnimationFrame(check);
  };
}

if (!prefersStill) {
  for (const layer of document.querySelectorAll('[data-sparkle]')) {
    createRoot(layer).render(
      <Sparkle
        ref={spreadOnceMeasured(layer)}
        color={['#ffffff', '#f0d48a', '#d4af5a', '#b9a4ff']}
        count={Number(layer.dataset.sparkleCount) || 56}
        minSize={6}
        maxSize={12}
        overflowPx={OVERFLOW}
        fadeOutSpeed={40}
        flicker
        flickerSpeed="slow"
      />
    );
  }
}
