#!/usr/bin/env node
/* =============================================================================
   tools/gen-city.js — regenerates the Skyline and Neon City backgrounds

   Run with `node tools/gen-city.js`; it rewrites the two city sections of
   css/backgrounds.css in place. Every tower is data here rather than a
   hand-typed gradient, because the windows only work when the towers are the
   right size for them:

     WINDOWS ARE COLUMNS CUT BY THE TOWER'S OWN MASK. The lit layer is a stack
     of horizontal rows (one repeating gradient, bottom-aligned, so every tower
     shares the same floors). Each tower's mask is a repeating column pattern
     that starts and ends with a margin, which is what keeps a window off the
     edge of a building — the old design masked a global dot grid with plain
     rectangles, so windows landed wherever the grid happened to fall,
     including half-on the wall's edge. For the last column to end in a margin
     too, a tower's width must be a whole number of column pitches, and for the
     top row to sit below the roof, its height must be a whole number of row
     pitches. The generator snaps both.

     THE GLOW is the product of the two patterns: the row gradient fades above
     and below each window, the column mask fades either side of it, and where
     both are at full strength is the window itself. So the wall is brightest
     next to the glass and falls off in every direction, at the cost of one
     gradient and no filters.

   Positions are the original hand-seeded percentages, kept so the skyline
   stays the one people know.
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

/* ---- the seed --------------------------------------------------------- */

/* [width, height, x%, bottomTint%, topTint%] — tints are the share of scheme
   colour mixed into the city ink. */
const FAR = [
  [13, 238, 13.6, 20, 28], [12, 323, 69.3, 14, 18], [13, 208, 38.6, 24, 33],
  [10, 136, 6.1, 13, 25], [7, 259, 27.1, 11, 21], [14, 217, 43.6, 22, 35],
  [8, 162, 62.7, 12, 21], [12, 155, 0.1, 13, 17], [10, 159, 95.8, 22, 30],
  [9, 225, 75.3, 25, 30], [12, 245, 83.2, 17, 30], [8, 197, 22.0, 20, 31],
  [9, 252, 59.3, 21, 32], [14, 256, 88.5, 20, 29], [11, 164, 35.0, 19, 32],
  [8, 164, 54.9, 21, 35], [8, 302, 48.5, 12, 25], [14, 301, 84.6, 22, 28],
  [9, 189, 30.8, 15, 22], [12, 288, 78.8, 21, 35]
];
const MID = [
  [35, 122, 12.9, 28, 41], [27, 142, 29.6, 23, 32], [30, 180, 19.9, 33, 44],
  [20, 227, 50.4, 24, 35], [20, 159, 77.1, 27, 45], [33, 183, 88.5, 37, 47],
  [20, 134, 97.2, 25, 46], [32, 163, 63.2, 22, 31], [19, 227, 82.6, 30, 44],
  [35, 232, 56.2, 35, 51], [33, 154, 39.7, 37, 50], [19, 124, 70.2, 21, 32],
  [22, 175, 2.8, 32, 45], [21, 183, 28.5, 26, 41]
];
const NEAR = [
  [56, 86, 93.2, 38, 54], [40, 87, 65.6, 29, 46], [51, 100, 49.5, 30, 55],
  [47, 107, 1.6, 37, 53], [40, 122, 26.4, 38, 49], [38, 99, 40.3, 50, 75],
  [32, 70, 14.2, 49, 72], [61, 63, 81.1, 39, 55], [48, 63, 96.1, 33, 46],
  [37, 62, 69.2, 32, 46]
];

/* Buildings are darker than they were: a third of the scheme tint, mixed into
   ink instead of into nothing. The wall itself is now the DARK part of the
   picture and the windows are the only light on it, which is what makes the
   falloff below read as light thrown from the glass. */
const TINT = 0.34;

/* Column pitch, row pitch, and the column mask for each band. The mask's
   first and last stops are the margins — which is what keeps a window off the
   edge of a building — and the wall between them ramps up to the window core
   and back down, which is the sideways half of the same falloff. */
const BANDS = {
  far: {
    towers: FAR, col: 12, row: 24, ink: 'var(--city-ink-far)', bottom: 'var(--c3)', top: 'var(--c3)',
    mask: 'repeating-linear-gradient(to right, transparent 0 2px, transparent 3px, rgba(0,0,0,0.30) 4px, #000 5px 7px, rgba(0,0,0,0.30) 8px, transparent 9px, transparent 10px 12px)'
  },
  mid: {
    towers: MID, col: 18, row: 24, ink: 'var(--city-ink)', bottom: 'var(--c4)', top: 'var(--c4)',
    mask: 'repeating-linear-gradient(to right, transparent 0 3px, transparent 4px, rgba(0,0,0,0.32) 6px, #000 7px 11px, rgba(0,0,0,0.32) 12px, transparent 14px, transparent 15px 18px)'
  },
  near: {
    towers: NEAR, col: 24, row: 30, ink: 'var(--city-ink)', bottom: 'var(--c4)', top: 'var(--c3)',
    mask: 'repeating-linear-gradient(to right, transparent 0 4px, transparent 5px, rgba(0,0,0,0.32) 8px, #000 9px 15px, rgba(0,0,0,0.32) 16px, transparent 19px, transparent 20px 24px)'
  }
};

/* Rows: gap, a four-step ramp, the lit core, the ramp again, gap — the
   vertical half of the glow. THE FURTHER FROM A WINDOW, THE DARKER: the ramp
   runs 72% -> 26% -> 8% -> 2% -> nothing, so the wall immediately beside the
   glass is lit, a step away is dim, and the middle of the wall between two
   windows is the bare tower colour with no light on it at all. */
const ROWS = {
  24: 'repeating-linear-gradient(to top, transparent 0 7px, W10 8px, W40 9px, W95 10px 14px, W40 15px, W10 16px, transparent 17px 24px)',
  30: 'repeating-linear-gradient(to top, transparent 0 9px, W10 10px, W40 11px, W95 12px 18px, W40 19px, W10 20px, transparent 21px 30px)'
};

function snap(v, unit) { return Math.max(unit, Math.round(v / unit) * unit); }

function towers(band) {
  return band.towers.map(function (t) {
    return { w: snap(t[0], band.col), h: snap(t[1], band.row), x: t[2],
      lo: Math.round(t[3] * TINT), hi: Math.round(t[4] * TINT) };
  });
}

function mix(color, pct, ink) {
  return 'color-mix(in srgb, ' + color + ' ' + pct + '%, ' + ink + ')';
}

function towerLayer(sel, band, extra) {
  const ts = towers(band);
  const imgs = ts.map(function (t) {
    return '    linear-gradient(to top, ' + mix(band.bottom, t.lo, band.ink) + ', ' + mix(band.top, t.hi, band.ink) + ')';
  });
  return sel + ' {\n' +
    (extra || []).map(function (l) { return '  ' + l + '\n'; }).join('') +
    '  background-image:\n' + imgs.join(',\n') + ';\n' +
    '  background-size: ' + ts.map(function (t) { return t.w + 'px ' + t.h + 'px'; }).join(', ') + ';\n' +
    '  background-position: ' + ts.map(function (t) { return t.x + '% bottom'; }).join(', ') + ';\n' +
    '  background-repeat: no-repeat;\n' +
    '}\n';
}

function rows(pitch) {
  return ROWS[pitch]
    .replace(/W95/g, 'color-mix(in srgb, var(--city-win) 72%, transparent)')
    .replace(/W40/g, 'color-mix(in srgb, var(--city-win) 26%, transparent)')
    .replace(/W10/g, 'color-mix(in srgb, var(--city-win) 8%, transparent)')
    .replace(/W02/g, 'color-mix(in srgb, var(--city-win) 2%, transparent)');
}

function windowLayer(sel, bands, extra) {
  const pitch = bands[0].row;
  const all = [];
  bands.forEach(function (b) {
    towers(b).forEach(function (t) { all.push({ t: t, mask: b.mask }); });
  });
  const masks = all.map(function (e) { return '    ' + e.mask; }).join(',\n');
  const sizes = all.map(function (e) { return e.t.w + 'px ' + e.t.h + 'px'; }).join(', ');
  const pos = all.map(function (e) { return e.t.x + '% bottom'; }).join(', ');
  return sel + ' {\n' +
    (extra || []).map(function (l) { return '  ' + l + '\n'; }).join('') +
    '  background-image: ' + rows(pitch) + ';\n' +
    '  background-size: 100% ' + pitch + 'px;\n' +
    '  background-position: 0 bottom;\n' +
    '  background-repeat: repeat;\n' +
    '  -webkit-mask-image:\n' + masks + ';\n' +
    '  -webkit-mask-size: ' + sizes + ';\n' +
    '  -webkit-mask-position: ' + pos + ';\n' +
    '  -webkit-mask-repeat: no-repeat;\n' +
    '  mask-image:\n' + masks + ';\n' +
    '  mask-size: ' + sizes + ';\n' +
    '  mask-position: ' + pos + ';\n' +
    '  mask-repeat: no-repeat;\n' +
    '}\n';
}

/* ---- the sections ------------------------------------------------------ */

const LIGHTING = `/* CITY LIGHTING — shared by Skyline and Neon.

   --city-ink is what the towers are made of: the scheme colour is mixed INTO
   it, not into nothing, so a building is a dark thing with a tint rather than
   a tinted haze. Towers are opaque; the far band reads as far because it is
   made of --city-ink-far, a hazier ink, not because it is see-through.
   That ink has to sit clearly APART from the sky: when it matched the
   horizon the far row read as ghosts — solid, but indistinguishable from
   what was behind it, which is the same thing to the eye. It is also what the picker swatches use, so it lives on the
   mode, not on the background.

   The sky is the host's ::before, under every layer, and carries the moon
   (dark modes) or the sun (light). The ::after, over every layer, is the little
   light that body throws onto the city — kept faint on purpose: a moon that
   lights a skyline is a floodlight. */
:root {
  --city-ink: #161b27;
  --city-ink-far: #3a4256;
  --city-win: var(--c5);
  --city-win-alpha: 0.3;
  --city-glow-alpha: 0.08;
  --city-sky:
    radial-gradient(circle at 20% 11%, #fff9dc 0 26px, rgba(255, 236, 170, 0.75) 30px,
      rgba(255, 220, 120, 0.28) 72px, rgba(255, 210, 100, 0.08) 130px, transparent 190px),
    linear-gradient(to bottom, #c9dbf1, #edf2f8 72%);
  --city-sky-alpha: 1;
  --city-cast: radial-gradient(48% 30% at 20% 11%, rgba(255, 238, 190, 0.3), transparent 70%);
}
[data-mode='dark'] {
  --city-ink: #05070d;
  --city-ink-far: #171c2b;
  --city-win-alpha: 0.5;
  --city-glow-alpha: 0.04;
  --city-sky:
    radial-gradient(circle at 77% 13%, rgba(216, 224, 238, 0.82) 0 13px, rgba(216, 224, 238, 0.22) 15px,
      rgba(190, 204, 232, 0.08) 34px, transparent 90px),
    linear-gradient(to bottom, #02030a, #060a15 55%, #0a0f1e);
  --city-sky-alpha: 1;
  --city-cast: radial-gradient(48% 30% at 77% 13%, rgba(200, 212, 240, 0.07), transparent 70%);
}
[data-mode='amoled'] {
  --city-ink: #000000;
  --city-ink-far: #121626;
  --city-win-alpha: 0.45;
  --city-glow-alpha: 0.03;
  --city-sky:
    radial-gradient(circle at 77% 13%, rgba(200, 210, 228, 0.7) 0 13px, rgba(200, 210, 228, 0.16) 15px,
      rgba(180, 196, 226, 0.06) 34px, transparent 90px),
    linear-gradient(to bottom, #000000, #02040a 60%, #050813);
  --city-sky-alpha: 1;
  --city-cast: radial-gradient(48% 30% at 77% 13%, rgba(200, 212, 240, 0.05), transparent 70%);
}
[data-bg='skyline'] .bg-fx::before, [data-bg='neon'] .bg-fx::before,
[data-bg='skyline'] .bg-fx::after,  [data-bg='neon'] .bg-fx::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
}
[data-bg='skyline'] .bg-fx::before, [data-bg='neon'] .bg-fx::before {
  background: var(--city-sky);
  opacity: var(--city-sky-alpha);
}
[data-bg='skyline'] .bg-fx::after, [data-bg='neon'] .bg-fx::after {
  background: var(--city-cast);
}

`;

const SKYLINE = `/* --- 9. Skyline: a sci-fi city under a moon or a sun (static) ----------------

   GENERATED BY tools/gen-city.js — edit the seed there, not the numbers here.

   Every tower is its own background image with its own width, height,
   position and darkness, snapped so its windows fit: see the generator for
   why. Layers:

     l1  far towers      l2  far windows
     l3  mid towers      l4  mid windows
     l5  near towers     l6  near windows (bigger glass)
                         l7  horizon glow

   EACH BAND'S WINDOWS SIT DIRECTLY ON ITS OWN TOWERS, and the next band's
   towers are painted over both. The windows used to be three layers stacked
   above all three tower layers, so a far tower's lit windows showed through
   the near tower standing in front of it — which is not a lighting effect,
   it is a building you can see through.

   EVERY BAND IS LIT. The far band used to be left dark on the grounds that it
   is haze; the result was a row of blank slabs behind a lit city, which reads
   as unfinished rather than as distant. It is lit at a lower opacity instead.

   The sky, and the moon or sun in it, are the host's ::before, painted under
   everything; the faint light they throw onto the city is its ::after, over
   everything. Both are in the CITY LIGHTING block that follows.
   -------------------------------------------------------------------------- */
` + LIGHTING +
  towerLayer("[data-bg='skyline'] .bg-l1", BANDS.far, ['inset: 0;', 'opacity: 1;']) +
  towerLayer("[data-bg='skyline'] .bg-l3", BANDS.mid, ['inset: 0;', 'opacity: 1;']) +
  towerLayer("[data-bg='skyline'] .bg-l5", BANDS.near, ['inset: 0;', 'opacity: 1;']) +
  windowLayer("[data-bg='skyline'] .bg-l2", [BANDS.far], ['inset: 0;', 'opacity: calc(var(--city-win-alpha) * 0.7);']) +
  windowLayer("[data-bg='skyline'] .bg-l4", [BANDS.mid], ['inset: 0;', 'opacity: calc(var(--city-win-alpha) * 0.8);']) +
  windowLayer("[data-bg='skyline'] .bg-l6", [BANDS.near], ['inset: 0;', 'opacity: var(--city-win-alpha);']) +
`[data-bg='skyline'] .bg-l7 {
  opacity: var(--city-glow-alpha);
  background: radial-gradient(94% 44% at 50% 82%, var(--c4), transparent 100%);
}

`;

const NEON = `/* --- 11. Neon City: the same city, alive (animated) --------------------------

   GENERATED BY tools/gen-city.js — edit the seed there, not the numbers here.

   Three tower bands on a PARALLAX — the near block travels furthest per second
   and the far block barely moves, which is what turns a flat drift into depth.
   Each lit-window layer carries the same animation as the band it is masked
   by, or the lights would slide off their own buildings — which is why every
   band needs its own window layer, and why there are eight layer hosts.
   -------------------------------------------------------------------------- */
` +
  towerLayer("[data-bg='neon'] .bg-l1", BANDS.far, ['inset: 0 -22%;', 'opacity: 1;', 'animation: city-far 74s linear infinite;']) +
  towerLayer("[data-bg='neon'] .bg-l3", BANDS.mid, ['inset: 0 -22%;', 'opacity: 1;', 'animation: city-mid 47s linear infinite;']) +
  towerLayer("[data-bg='neon'] .bg-l5", BANDS.near, ['inset: 0 -22%;', 'opacity: 1;', 'animation: city-near 29s linear infinite;']) +
  windowLayer("[data-bg='neon'] .bg-l2", [BANDS.far], ['inset: 0 -22%;', 'opacity: calc(var(--city-win-alpha) * 0.7);', 'animation: city-far 74s linear infinite;']) +
  windowLayer("[data-bg='neon'] .bg-l4", [BANDS.mid], ['inset: 0 -22%;', 'opacity: calc(var(--city-win-alpha) * 0.85);', 'animation: city-mid 47s linear infinite;']) +
  windowLayer("[data-bg='neon'] .bg-l6", [BANDS.near], ['inset: 0 -22%;', 'opacity: var(--city-win-alpha);', 'animation: city-near 29s linear infinite;']) +
`[data-bg='neon'] .bg-l7 {
  opacity: var(--city-glow-alpha);
  background: radial-gradient(96% 46% at 50% 84%, var(--c4), transparent 100%);
}

`;

/* ---- splice ------------------------------------------------------------ */

const file = path.join(__dirname, '..', 'css', 'backgrounds.css');
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.indexOf('\r\n') >= 0;
let css = raw.replace(/\r\n/g, '\n');

function splice(startMarker, endMarker, replacement) {
  const i = css.indexOf(startMarker);
  const j = css.indexOf(endMarker);
  if (i < 0 || j < 0 || j < i) throw new Error('markers not found: ' + startMarker);
  css = css.slice(0, i) + replacement + css.slice(j);
}

splice('/* --- 9. Skyline', '/* --- 10. Circuit', SKYLINE);
splice('/* --- 11. Neon City', '@keyframes city-far', NEON);

fs.writeFileSync(file, crlf ? css.replace(/\n/g, '\r\n') : css);
console.log('backgrounds.css: skyline and neon regenerated (' +
  (FAR.length + MID.length + NEAR.length) + ' towers)');
