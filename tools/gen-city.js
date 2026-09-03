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

/* Buildings are darker than they were: half the scheme tint, mixed into ink
   instead of into nothing. */
const TINT = 0.5;

/* Column pitch, row pitch, and the column mask for each band. The mask's
   first and last stops are the margins; the wall between them ramps up to the
   window core and back down, which is the sideways half of the glow. */
const BANDS = {
  far: {
    towers: FAR, col: 8, row: 16, bottom: 'var(--c3)', top: 'var(--c3)',
    mask: 'repeating-linear-gradient(to right, transparent 0 1px, rgba(0,0,0,0.30) 1px, #000 3px 5px, rgba(0,0,0,0.30) 7px, transparent 7px 8px)'
  },
  mid: {
    towers: MID, col: 12, row: 16, bottom: 'var(--c4)', top: 'var(--c4)',
    mask: 'repeating-linear-gradient(to right, transparent 0 1px, rgba(0,0,0,0.35) 1px, #000 4px 8px, rgba(0,0,0,0.35) 11px, transparent 11px 12px)'
  },
  near: {
    towers: NEAR, col: 16, row: 20, bottom: 'var(--c4)', top: 'var(--c3)',
    mask: 'repeating-linear-gradient(to right, transparent 0 2px, rgba(0,0,0,0.35) 2px, #000 5px 11px, rgba(0,0,0,0.35) 14px, transparent 14px 16px)'
  }
};

/* Rows: transparent gap, ramp, core, ramp, gap — the vertical half of the
   glow. The core is the lit glass. */
const ROWS = {
  16: 'repeating-linear-gradient(to top, transparent 0 2px, W10 2px, W40 5px, W95 6px 10px, W40 11px, W10 14px, transparent 14px 16px)',
  20: 'repeating-linear-gradient(to top, transparent 0 2px, W10 2px, W40 6px, W95 7px 13px, W40 14px, W10 18px, transparent 18px 20px)'
};

/* Diagonal bands of ink laid OVER the rows, listed first so they paint on
   top: the floors under them stay dark. Without this every window in the
   city is lit and the towers read as a texture rather than as buildings. The
   periods are deliberately not multiples of any tower width, so the dark
   patches fall differently on each. */
const UNLIT = 'repeating-linear-gradient(107deg, transparent 0 53px, var(--city-ink) 53px 71px, transparent 71px 131px, var(--city-ink) 131px 149px, transparent 149px 233px)';

function snap(v, unit) { return Math.max(unit, Math.round(v / unit) * unit); }

function towers(band) {
  return band.towers.map(function (t) {
    return { w: snap(t[0], band.col), h: snap(t[1], band.row), x: t[2],
      lo: Math.round(t[3] * TINT), hi: Math.round(t[4] * TINT) };
  });
}

function mix(color, pct) {
  return 'color-mix(in srgb, ' + color + ' ' + pct + '%, var(--city-ink))';
}

function towerLayer(sel, band, extra) {
  const ts = towers(band);
  const imgs = ts.map(function (t) {
    return '    linear-gradient(to top, ' + mix(band.bottom, t.lo) + ', ' + mix(band.top, t.hi) + ')';
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
    .replace(/W95/g, 'color-mix(in srgb, var(--city-win) 95%, transparent)')
    .replace(/W40/g, 'color-mix(in srgb, var(--city-win) 40%, transparent)')
    .replace(/W10/g, 'color-mix(in srgb, var(--city-win) 10%, transparent)');
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
    '  background-image:\n    ' + UNLIT + ',\n    ' + rows(pitch) + ';\n' +
    '  background-size: auto, 100% ' + pitch + 'px;\n' +
    '  background-position: 0 0, 0 bottom;\n' +
    '  background-repeat: repeat, repeat;\n' +
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
   a tinted haze. It is also what the picker swatches use, so it lives on the
   mode, not on the background.

   The sky is the host's ::before, under every layer, and carries the moon
   (dark modes) or the sun (light). The ::after, over every layer, is the little
   light that body throws onto the city — kept faint on purpose: a moon that
   lights a skyline is a floodlight. */
:root {
  --city-ink: #161b27;
  --city-win: var(--c5);
  --city-alpha: 0.9;
  --city-win-alpha: 0.4;
  --city-sky:
    radial-gradient(circle at 20% 11%, #fff9dc 0 26px, rgba(255, 236, 170, 0.75) 30px,
      rgba(255, 220, 120, 0.28) 72px, rgba(255, 210, 100, 0.08) 130px, transparent 190px),
    linear-gradient(to bottom, #c9dbf1, #edf2f8 72%);
  --city-sky-alpha: 0.8;
  --city-cast: radial-gradient(70% 55% at 20% 11%, rgba(255, 238, 190, 0.3), transparent 70%);
}
[data-mode='dark'] {
  --city-ink: #05070d;
  --city-alpha: 0.94;
  --city-win-alpha: 0.95;
  --city-sky:
    radial-gradient(circle at 77% 13%, rgba(216, 224, 238, 0.82) 0 13px, rgba(216, 224, 238, 0.22) 15px,
      rgba(190, 204, 232, 0.08) 34px, transparent 90px),
    linear-gradient(to bottom, #02030a, #060a15 55%, #0a0f1e);
  --city-sky-alpha: 0.94;
  --city-cast: radial-gradient(70% 55% at 77% 13%, rgba(200, 212, 240, 0.09), transparent 70%);
}
[data-mode='amoled'] {
  --city-ink: #000000;
  --city-alpha: 0.96;
  --city-win-alpha: 0.95;
  --city-sky:
    radial-gradient(circle at 77% 13%, rgba(200, 210, 228, 0.7) 0 13px, rgba(200, 210, 228, 0.16) 15px,
      rgba(180, 196, 226, 0.06) 34px, transparent 90px),
    linear-gradient(to bottom, #000000, #02040a 60%, #050813);
  --city-sky-alpha: 1;
  --city-cast: radial-gradient(70% 55% at 77% 13%, rgba(200, 212, 240, 0.07), transparent 70%);
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

     l1  far towers      l4  windows of the far and mid bands
     l2  mid towers      l5  windows of the near band (bigger glass)
     l3  near towers     l6  horizon glow

   The sky, and the moon or sun in it, are the host's ::before, painted under
   everything; the faint light they throw onto the city is its ::after, over
   everything. Both are in the CITY LIGHTING block that follows.
   -------------------------------------------------------------------------- */
` + LIGHTING +
  towerLayer("[data-bg='skyline'] .bg-l1", BANDS.far, ['inset: 0;', 'opacity: calc(var(--city-alpha) * 0.6);']) +
  towerLayer("[data-bg='skyline'] .bg-l2", BANDS.mid, ['inset: 0;', 'opacity: var(--city-alpha);']) +
  towerLayer("[data-bg='skyline'] .bg-l3", BANDS.near, ['inset: 0;', 'opacity: var(--city-alpha);']) +
  windowLayer("[data-bg='skyline'] .bg-l4", [BANDS.far, BANDS.mid], ['inset: 0;', 'opacity: calc(var(--city-win-alpha) * 0.8);']) +
  windowLayer("[data-bg='skyline'] .bg-l5", [BANDS.near], ['inset: 0;', 'opacity: var(--city-win-alpha);']) +
`[data-bg='skyline'] .bg-l6 {
  opacity: calc(var(--city-alpha) * 0.35);
  background: radial-gradient(94% 44% at 50% 82%, var(--c4), transparent 100%);
}

`;

const NEON = `/* --- 11. Neon City: the same city, alive (animated) --------------------------

   GENERATED BY tools/gen-city.js — edit the seed there, not the numbers here.

   Three tower bands on a PARALLAX — the near block travels furthest per second
   and the far block barely moves, which is what turns a flat drift into depth.
   Each lit-window layer carries the same animation as the band it is masked
   by, or the lights would slide off their own buildings. The far band is left
   unlit: it is haze, and it has no layer to spare.
   -------------------------------------------------------------------------- */
` +
  towerLayer("[data-bg='neon'] .bg-l1", BANDS.far, ['inset: 0 -22%;', 'opacity: calc(var(--city-alpha) * 0.55);', 'animation: city-far 74s linear infinite;']) +
  towerLayer("[data-bg='neon'] .bg-l2", BANDS.mid, ['inset: 0 -22%;', 'opacity: var(--city-alpha);', 'animation: city-mid 47s linear infinite;']) +
  towerLayer("[data-bg='neon'] .bg-l3", BANDS.near, ['inset: 0 -22%;', 'opacity: var(--city-alpha);', 'animation: city-near 29s linear infinite;']) +
  windowLayer("[data-bg='neon'] .bg-l4", [BANDS.mid], ['inset: 0 -22%;', 'opacity: calc(var(--city-win-alpha) * 0.85);', 'animation: city-mid 47s linear infinite;']) +
  windowLayer("[data-bg='neon'] .bg-l5", [BANDS.near], ['inset: 0 -22%;', 'opacity: var(--city-win-alpha);', 'animation: city-near 29s linear infinite;']) +
`[data-bg='neon'] .bg-l6 {
  opacity: calc(var(--city-alpha) * 0.35);
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
