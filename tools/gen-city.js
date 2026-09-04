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
const TINT = 0.25;

/* Per band: the floor pitch (rows of windows), the lit core within a floor,
   the ink, the tints, and HOW MANY WINDOWS A ROW HOLDS. Farther is smaller: a
   far tower is drawn small, so its floors are shorter and its windows
   narrower — but it still has a row of them, three to six across, however
   tiny. One window per row read as a stripe, not as a building. */
const BANDS = {
  far:  { towers: FAR,  row: 12, core: [5, 8],   ink: 'var(--city-ink-far)', bottom: 'var(--c3)', top: 'var(--c3)', scale: 1.4, windows: [3, 5] },
  mid:  { towers: MID,  row: 18, core: [7, 12],  ink: 'var(--city-ink)',     bottom: 'var(--c4)', top: 'var(--c4)', scale: 1.0, windows: [3, 6] },
  near: { towers: NEAR, row: 26, core: [10, 17], ink: 'var(--city-ink)',     bottom: 'var(--c4)', top: 'var(--c3)', scale: 1.0, windows: [4, 6] }
};

/* Rows: a continuous ramp from the lit core down to a 4% floor and back —
   the vertical half of the glow, built from the band's pitch and core. THE
   FURTHER FROM A WINDOW, THE DARKER, and there is no fully dark stop on
   purpose: real light fades rather than ending, and a hard edge read as a
   stripe. */
function rowGradient(row, core) {
  const a = core[0], b = core[1];
  const stops = [
    'W04 0px',
    'W08 ' + Math.round(a * 0.4) + 'px',
    'W18 ' + Math.round(a * 0.7) + 'px',
    'W40 ' + (a - 1) + 'px',
    'W95 ' + a + 'px ' + b + 'px',
    'W40 ' + (b + 1) + 'px',
    'W18 ' + Math.round(b + (row - b) * 0.3) + 'px',
    'W08 ' + Math.round(b + (row - b) * 0.65) + 'px',
    'W04 ' + row + 'px'
  ];
  return 'repeating-linear-gradient(to top, ' + stops.join(', ') + ')';
}

function rows(band) {
  return rowGradient(band.row, band.core)
    .replace(/W95/g, 'color-mix(in srgb, var(--city-win) 82%, transparent)')
    .replace(/W40/g, 'color-mix(in srgb, var(--city-win) 38%, transparent)')
    .replace(/W18/g, 'color-mix(in srgb, var(--city-win) 18%, transparent)')
    .replace(/W08/g, 'color-mix(in srgb, var(--city-win) 8%, transparent)')
    .replace(/W04/g, 'color-mix(in srgb, var(--city-win) 4%, transparent)');
}

/* A small deterministic generator, so the skyline is the same on every run
   and every device. */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ROOFS. A city of flat rectangles is a bar chart. Each tower draws one of
   these on top of its body, in the body's own top colour: a set-back upper
   storey, a single slope, a gable, an antenna mast, a dome. Flat stays in
   the set because most real roofs are. */
const ROOFS = ['flat', 'step', 'slant', 'peak', 'antenna', 'dome', 'flat', 'step'];

function snap(v, unit) { return Math.max(unit, Math.round(v / unit) * unit); }

function towers(band) {
  const r = rng(band.row * 7919 + band.towers.length * 131);
  return band.towers.map(function (t) {
    const w = Math.max(6, Math.round(t[0] * band.scale));
    const h = snap(Math.round(t[1]), band.row);
    const n = band.windows[0] + Math.floor(r() * (band.windows[1] - band.windows[0] + 1));
    const roof = ROOFS[Math.floor(r() * ROOFS.length)];
    return {
      w: w, h: h, x: t[2],
      lo: Math.round(t[3] * TINT), hi: Math.round(t[4] * TINT),
      n: n, roof: roof, rh: 4 + Math.round(r() * 10)
    };
  });
}

function mix(color, pct, ink) {
  return 'color-mix(in srgb, ' + color + ' ' + pct + '%, ' + ink + ')';
}

/* Where a box of width bw goes so that it sits `offset` px in from the
   tower's own left edge. Percentage positioning aligns the box's own p% to
   the container's p%, so a narrower box lands p% of the width difference
   further left than the tower did; the calc puts that back. */
function posFor(t, bw, offset, y) {
  const p = t.x / 100;
  const dx = offset - p * (t.w - bw);
  return 'calc(' + t.x + '% ' + (dx >= 0 ? '+ ' : '- ') + Math.abs(dx).toFixed(2) + 'px) ' + y;
}

/** [{img, size, pos}] for the roof, drawn in the tower's top colour. */
function roofImages(t, color) {
  const w = t.w, rh = t.rh;
  /* The box's bottom sits on the roof line: a length in background-position
     is an offset from the (container - image) point, so 100% - h puts the
     image's bottom edge h px above the ground. */
  const y = 'calc(100% - ' + t.h + 'px)';
  const solid = 'linear-gradient(' + color + ', ' + color + ')';
  switch (t.roof) {
    case 'step': {
      const bw = Math.max(3, Math.round(w * 0.5));
      return [{ img: solid, size: bw + 'px ' + rh + 'px', pos: posFor(t, bw, (w - bw) / 2, y) }];
    }
    case 'slant':
      return [{ img: 'linear-gradient(to top left, ' + color + ' 50%, transparent 50.5%)',
        size: w + 'px ' + rh + 'px', pos: posFor(t, w, 0, y) }];
    case 'peak': {
      const hw = w / 2;
      return [
        { img: 'linear-gradient(to top left, ' + color + ' 50%, transparent 50.5%)',
          size: hw.toFixed(2) + 'px ' + rh + 'px', pos: posFor(t, hw, 0, y) },
        { img: 'linear-gradient(to top right, ' + color + ' 50%, transparent 50.5%)',
          size: hw.toFixed(2) + 'px ' + rh + 'px', pos: posFor(t, hw, hw, y) }
      ];
    }
    case 'antenna': {
      const bw = Math.max(1, Math.round(w * 0.08));
      return [{ img: solid, size: bw + 'px ' + (rh + 10) + 'px', pos: posFor(t, bw, (w - bw) / 2, y) }];
    }
    case 'dome':
      return [{ img: 'radial-gradient(ellipse ' + (w / 2).toFixed(2) + 'px ' + rh + 'px at 50% 100%, ' +
        color + ' 98%, transparent 100%)', size: w + 'px ' + rh + 'px', pos: posFor(t, w, 0, y) }];
    default:
      return [];
  }
}

function towerLayer(sel, band, extra) {
  const ts = towers(band);
  const imgs = [], sizes = [], poss = [];
  ts.forEach(function (t) {
    const top = mix(band.top, t.hi, band.ink);
    roofImages(t, top).forEach(function (r) {
      imgs.push('    ' + r.img); sizes.push(r.size); poss.push(r.pos);
    });
    imgs.push('    linear-gradient(to top, ' + mix(band.bottom, t.lo, band.ink) + ', ' + top + ')');
    sizes.push(t.w + 'px ' + t.h + 'px');
    poss.push(t.x + '% bottom');
  });
  return sel + ' {\n' +
    (extra || []).map(function (l) { return '  ' + l + '\n'; }).join('') +
    '  background-image:\n' + imgs.join(',\n') + ';\n' +
    '  background-size: ' + sizes.join(', ') + ';\n' +
    '  background-position: ' + poss.join(', ') + ';\n' +
    '  background-repeat: no-repeat;\n' +
    '}\n';
}

/* Column mask for one tower: n windows across its own width. The pitch is
   width / n, so the last window ends in a margin just as the first begins
   with one, whatever the width; and the very edge of the wall stays dark,
   because a window on the edge of a building is a window in mid-air. */
function columnMask(t) {
  const p = t.w / t.n;
  const f = function (k) { return (p * k).toFixed(2) + 'px'; };
  return 'repeating-linear-gradient(to right, transparent 0 ' + f(0.05) +
    ', rgba(0,0,0,0.12) ' + f(0.12) + ', rgba(0,0,0,0.45) ' + f(0.28) +
    ', #000 ' + f(0.36) + ' ' + f(0.64) + ', rgba(0,0,0,0.45) ' + f(0.72) +
    ', rgba(0,0,0,0.12) ' + f(0.88) + ', transparent ' + f(0.95) + ' ' + f(1) + ')';
}

function windowLayer(sel, bands, extra) {
  const band = bands[0];
  const ts = [];
  bands.forEach(function (b) { towers(b).forEach(function (t) { ts.push(t); }); });
  const masks = ts.map(function (t) { return '    ' + columnMask(t); }).join(',\n');
  const sizes = ts.map(function (t) { return t.w + 'px ' + t.h + 'px'; }).join(', ');
  const pos = ts.map(function (t) { return t.x + '% bottom'; }).join(', ');
  return sel + ' {\n' +
    (extra || []).map(function (l) { return '  ' + l + '\n'; }).join('') +
    '  background-image: ' + rows(band) + ';\n' +
    '  background-size: 100% ' + band.row + 'px;\n' +
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
  --city-win-alpha: 0.4;
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
  --city-win-alpha: 0.68;
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
  --city-win-alpha: 0.62;
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
