/* =============================================================================
   anatomy.js — front/back muscle heat figures

   Design notes
   -------------
   * The field is 286 x 520, centred on x = 143.

   * THE ARMS LIVE IN THEIR OWN ROTATED FRAME. Previously the whole body was
     authored in one vertical coordinate system, which forced the arms to hang
     straight down against the hips — so the elbows and forearms collided with
     the thighs and the two limbs were impossible to tell apart. Each arm is now
     authored VERTICALLY in a local frame whose origin is the shoulder joint,
     and then placed with translate + rotate. That buys two things at once: the
     arm swings clear of the leg, and every belly in it can still be described
     with the same simple top-to-bottom rows as the torso.

   * Bilateral muscles are authored ONCE for the right half and mirrored with
     matrix(-1,0,0,1,W,0). Perfect symmetry, half the data.

   * The silhouette is the UNION of a torso contour and the two arm contours.
     The arm shapes deliberately overlap the shoulder, so the union reads as one
     body with no seam where the limb meets the trunk.

   * Muscle bellies are described as BANDS: rows of [y, xInner, xOuter] traced
     against the real silhouette bounds and deliberately overshot a little. The
     clip trims the overshoot, so neighbouring bellies butt up against each
     other and against the skin instead of leaving slivers of background
     showing through.

   * EVERY REGION OWNS DISTINCT TERRITORY. Where a deep muscle used to be
     authored underneath a superficial one — rhomboids under the mid traps,
     serratus under the pec — selecting the deep muscle lit a region that was
     then painted over by the idle muscle on top of it, so it looked like
     nothing happened. Neighbouring territories, plus drawing loaded muscles
     last, means anything you select is actually visible.

   * Colour rule: everything structural is black / white / grey. ONLY muscles
     carrying a non-zero load receive the accent heat ramp.
   ============================================================================= */
(function (App) {
  'use strict';

  const W = 276, H = 520;
  const CX = 138;               /* midline */
  let uid = 0;

  /* ---------------------------------------------------------------------------
     PROPORTIONS — the eight-head canon, on a 500-unit body inside a 520 field:

       y  10  crown        y 198  navel        y 366  knee
       y  72  chin         y 210  waist        y 478  ankle
       y  92  shoulders    y 260  crotch       y 510  sole
       y 135  nipple line

     Shoulder width comes from the DELTOIDS, which live in the arm frame, so the
     trunk itself stays near 50 and the waist pulls in to 36. That is where a
     V-taper actually comes from on a real body — not from a flared ribcage.
     ------------------------------------------------------------------------ */

  /* THE ARM IS TWO HINGED FRAMES, not one straight limb.

     A single rotation cannot be both things at once: angled enough at the elbow
     to clear the ribs, and narrow enough at the hand to stay on the canvas. So
     the upper arm swings out 20 degrees from the shoulder and the forearm hangs
     back at 10 from the elbow — the natural carrying angle. The elbow clears the
     waist, the hand falls at mid-thigh, and the figure stays inside its box. */
  const SHOULDER_X = CX + 42, SHOULDER_Y = 112, UPPER_DEG = 16;
  const UPPER_LEN = 98;                       /* shoulder joint -> elbow joint */
  const FORE_DEG = 8;

  const RAD = Math.PI / 180;
  const ELBOW_X = SHOULDER_X + Math.sin(UPPER_DEG * RAD) * UPPER_LEN;
  const ELBOW_Y = SHOULDER_Y + Math.cos(UPPER_DEG * RAD) * UPPER_LEN;

  /* ---------------------------------------------------------------------------
     PATH HELPERS
     ------------------------------------------------------------------------ */

  function f(n) { return Math.round(n * 100) / 100; }

  /** Catmull-Rom through points as cubic beziers; closed unless open is true. */
  function spline(pts, open) {
    const n = pts.length;
    const P = function (i) {
      if (open) return pts[Math.max(0, Math.min(n - 1, i))];
      return pts[((i % n) + n) % n];
    };
    let d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
    const last = open ? n - 1 : n;
    for (let i = 0; i < last; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C' + f(c1x) + ' ' + f(c1y) + ' ' + f(c2x) + ' ' + f(c2y) +
           ' ' + f(p2[0]) + ' ' + f(p2[1]);
    }
    return d + (open ? '' : 'Z');
  }

  /** Build a belly from [y, xInner, xOuter] rows, top -> bottom. */
  function band(rows) {
    const outer = rows.map(function (r) { return [r[2], r[0]]; });
    const inner = rows.map(function (r) { return [r[1], r[0]]; }).reverse();
    return spline(outer.concat(inner));
  }

  /** Same, but for rows written as offsets from the midline. */
  function torsoBand(rows) {
    return band(rows.map(function (r) { return [r[0], CX + r[1], CX + r[2]]; }));
  }

  /* ---------------------------------------------------------------------------
     SILHOUETTES

     Authored as point lists rather than hand-written beziers. Tracing a body by
     eye through forty control points is guesswork; moving one vertex and letting
     the spline re-fit is not.
     ------------------------------------------------------------------------ */

  /* Right half of the trunk: crown -> down the outside -> foot -> up the inside
     -> crotch. Closing back up the midline gives the fill; the mirror hides
     that edge. Offsets are from CX. */
  const TORSO_PTS = [
    [0, 10], [11, 13], [20, 24], [23, 40], [22, 54], [18, 65], [12, 74], [9, 82],
    [12, 88], [19, 92], [30, 96],                          /* neck into trap */
    [44, 102], [49, 118], [50, 134],                       /* trap ridge, ribcage */
    [49, 150], [47, 166], [44, 182],                       /* lat flare */
    [40, 196], [36, 210], [37, 224],                       /* waist */
    [42, 238], [49, 252], [53, 264], [54, 276],            /* hip */
    [55, 292], [52, 312], [46, 334], [41, 352], [37, 366], /* thigh */
    [37, 380], [44, 398], [45, 418],                       /* calf */
    [40, 442], [31, 462], [25, 478], [24, 492],            /* ankle */
    [29, 502], [30, 510], [24, 514], [9, 515], [3, 511], [2, 502],   /* foot */
    [5, 488], [7, 466], [9, 440], [10, 416], [9, 394],     /* inner calf */
    [8, 374], [7, 352], [5, 326], [2, 298], [0, 278], [0, 262]       /* crotch */
  ];

  /* Upper arm, authored straight down from the shoulder joint. The cap reaches
     well inside the trunk so the union has no seam at the shoulder, and the
     bottom edge runs straight across the elbow where the forearm overlaps it. */
  const UPPER_ARM_PTS = [
    [-9, -8], [-2, -16], [6, -19], [15, -13], [20, 0],    /* deltoid cap */
    [21, 18], [20, 37], [18, 56],                           /* delt insertion */
    [17, 72], [16, 88], [15, 106],                          /* down to the elbow */
    [-15, 106], [-16, 88], [-17, 68],                       /* back up the inside */
    [-18, 48], [-17, 30], [-15, 14], [-12, 0]
  ];

  /* Forearm and hand, hanging from the elbow joint. */
  const FOREARM_PTS = [
    [15, -16], [17, -2], [19, 16], [20, 34],                /* brachioradialis */
    [18, 52], [16, 70], [13, 86], [12, 98],                 /* taper to the wrist */
    [13, 108], [14, 118], [12, 128], [6, 134],              /* hand */
    [-1, 132], [-6, 124], [-10, 112],
    [-10, 98], [-11, 84], [-12, 66],                        /* flexor bulge */
    [-14, 46], [-15, 26], [-13, 8], [-12, -14]
  ];

  const TORSO_D = spline(TORSO_PTS.map(function (p) { return [CX + p[0], p[1]]; }), true) +
    'L' + CX + ' 10Z';
  const UPPER_ARM_D = spline(UPPER_ARM_PTS);
  const FOREARM_D = spline(FOREARM_PTS);

  const UPPER_TF = 'translate(' + f(SHOULDER_X) + ',' + f(SHOULDER_Y) + ') rotate(-' + UPPER_DEG + ')';
  const FORE_TF = 'translate(' + f(ELBOW_X) + ',' + f(ELBOW_Y) + ') rotate(-' + FORE_DEG + ')';
  const MIRROR_TF = 'matrix(-1,0,0,1,' + W + ',0)';

  /* ---------------------------------------------------------------------------
     TORSO MUSCLES — rows are [y, dxInner, dxOuter] from the midline.
     ------------------------------------------------------------------------ */

  const FRONT_TORSO = [
    { id: 'sternocleidomastoid', rows: [[76,3,9],[84,2,11],[92,1,13],[100,1,15]] },
    { id: 'trap_upper', rows: [[90,8,18],[97,12,32],[104,15,44],[112,17,50]] },

    { id: 'pec_upper',  rows: [[101,1,24],[110,1,36],[120,1,44]] },
    { id: 'pec_mid',    rows: [[120,1,43],[131,1,44],[142,1,43]] },
    { id: 'pec_lower',  rows: [[142,1,43],[153,1,41],[164,1,36],[172,1,26]] },
    { id: 'serratus',   rows: [[142,43,52],[153,42,50],[164,40,48],[175,38,46],[185,35,43]] },

    { id: 'abs_upper',  rows: [[168,1,25],[181,1,27],[194,1,27],[206,1,26],[216,1,24]] },
    { id: 'abs_lower',  rows: [[216,1,24],[228,1,24],[240,1,22],[250,1,18],[258,1,11]] },
    { id: 'oblique',    rows: [[168,25,44],[183,27,43],[198,27,40],[213,26,42],[228,25,46],[240,25,49]] },

    { id: 'hip_flexor', rows: [[246,16,41],[258,12,48],[268,12,50],[278,17,49]] },
    { id: 'adductor',   rows: [[264,1,16],[284,2,18],[304,5,20],[322,7,17],[338,8,14]] },
    { id: 'quad_medial',rows: [[302,13,27],[322,13,28],[338,12,28],[354,13,26],[368,14,22]] },
    { id: 'quad_rectus',rows: [[268,18,36],[290,21,38],[312,22,37],[332,23,35],[350,22,32],[362,22,30]] },
    { id: 'quad_lateral',rows:[[266,36,54],[286,36,53],[306,37,55],[326,35,50],[344,32,45],[358,31,42]] },

    { id: 'tibialis',   rows: [[382,11,35],[404,11,38],[424,10,39],[446,9,37],[466,8,33]] },
    { id: 'calf_gastro',rows: [[382,35,48],[402,38,50],[422,37,49],[442,33,44]] }
  ];

  const BACK_TORSO = [
    { id: 'splenius',   rows: [[72,1,11],[82,1,14],[92,1,13],[99,2,11]] },

    { id: 'rotator_cuff', rows: [[118,39,55],[131,39,55],[144,39,52],[155,39,48]] },
    { id: 'teres_major',rows: [[146,41,54],[157,40,53],[168,39,50],[178,39,46]] },

    { id: 'trap_upper', rows: [[90,1,15],[98,1,28],[106,1,40],[113,2,45]] },
    { id: 'trap_mid',   rows: [[113,1,43],[125,1,43],[137,1,39]] },
    { id: 'rhomboid',   rows: [[137,1,39],[149,1,36],[160,1,30]] },
    { id: 'trap_lower', rows: [[160,1,30],[174,1,26],[188,1,20],[200,1,14]] },

    { id: 'lat',        rows: [[140,28,47],[157,24,50],[174,19,50],[192,15,48],[209,13,45],[225,13,42],[238,15,39]] },
    { id: 'erector',    rows: [[190,1,17],[210,1,19],[228,1,19],[244,1,16],[256,1,12]] },

    { id: 'glute_med',  rows: [[230,32,50],[243,37,56],[255,39,54],[264,39,50]] },
    { id: 'glute_max',  rows: [[242,1,39],[259,1,44],[276,1,49],[291,2,51],[303,7,48]] },

    { id: 'ham_semi',   rows: [[292,7,29],[311,8,29],[330,9,28],[348,10,27],[362,12,26]] },
    { id: 'ham_biceps', rows: [[292,29,52],[311,29,51],[330,28,49],[348,27,45],[362,26,42]] },

    { id: 'calf_gastro',rows: [[380,10,45],[399,10,48],[418,9,48],[436,9,45],[450,10,42]] },
    { id: 'calf_soleus',rows: [[440,9,44],[454,9,42],[468,9,38],[480,10,34]] }
  ];

  /* ---------------------------------------------------------------------------
     ARM MUSCLES — [y, xInner, xOuter] in the UPPER-ARM or FOREARM frame.
     Negative x is medial (toward the body), positive is lateral.
     ------------------------------------------------------------------------ */

  const FRONT_UPPER = [
    { id: 'delt_front', rows: [[-14,-11,4],[-2,-15,5],[12,-15,5],[26,-13,5],[40,-11,5],[52,-6,4]] },
    { id: 'delt_side',  rows: [[-16,4,13],[-2,5,20],[12,5,22],[26,5,22],[40,5,21],[54,4,18]] },
    { id: 'biceps_short', rows: [[44,-15,-2],[60,-16,-2],[76,-16,-2],[92,-15,-2],[105,-14,-4]] },
    { id: 'biceps_long',  rows: [[42,-2,9],[58,-2,10],[74,-2,10],[90,-2,10],[104,-4,7]] },
    { id: 'brachialis',   rows: [[46,9,20],[64,9,20],[82,9,20],[98,7,18],[108,7,17]] }
  ];

  const BACK_UPPER = [
    { id: 'delt_rear',  rows: [[-14,-11,4],[-2,-15,5],[12,-15,5],[26,-13,5],[40,-11,5],[52,-6,4]] },
    { id: 'delt_side',  rows: [[-16,4,13],[-2,5,20],[12,5,22],[26,5,22],[40,5,21],[54,4,18]] },
    { id: 'triceps_long', rows: [[40,-16,-2],[56,-17,-2],[72,-17,-3],[86,-16,-4]] },
    { id: 'triceps_med',  rows: [[86,-16,-4],[96,-15,-3],[107,-13,-4]] },
    { id: 'triceps_lat',  rows: [[36,-2,13],[54,-2,17],[70,-2,18],[88,-2,16],[103,-4,12]] }
  ];

  const FRONT_FORE = [
    { id: 'brachioradialis', rows: [[-10,5,19],[8,7,21],[26,9,21],[44,7,20],[62,7,18]] },
    { id: 'pronator',        rows: [[-10,-13,-1],[0,-12,2],[12,-9,6]] },
    { id: 'forearm_flex',    rows: [[14,-14,6],[34,-15,10],[52,-14,10],[70,-12,9],[88,-10,5]] }
  ];

  const BACK_FORE = [
    { id: 'brachioradialis', rows: [[-10,12,20],[8,13,21],[28,13,20],[46,12,18]] },
    { id: 'forearm_ext',     rows: [[-8,-2,15],[12,-1,17],[32,-1,18],[52,-1,18],[70,-1,16],[88,-1,13]] },
    { id: 'forearm_flex',    rows: [[2,-14,-1],[22,-15,0],[42,-15,0],[62,-13,-1],[82,-12,-1]] }
  ];

  /* Fibre striations and tendinous lines — decorative, always grey. These are
     what stop a filled region reading as a flat tile: a trained body has visible
     separations, and the figure should show them. */
  const FRONT_DETAIL = [
    'M138 172V262',                                        /* linea alba */
    'M139 184H163', 'M139 197H165', 'M139 210H165', 'M139 222H163',
    'M140 106L176 120', 'M140 128L180 137', 'M140 150L178 151', 'M140 168L170 161',
    'M180 150C184 162 185 175 183 187',                    /* serratus slips */
    'M175 156C179 168 180 181 179 192',
    'M170 162C174 173 175 186 174 197',
    'M156 270V360', 'M173 268V356',                        /* quad borders */
    'M151 306C154 325 156 345 155 368',                    /* teardrop */
    'M149 386V464'                                         /* tibia edge */
  ];

  const BACK_DETAIL = [
    'M138 94V252',                                         /* spine */
    'M140 148L180 161', 'M140 170L178 181', 'M140 192L172 200', 'M141 214L166 220',
    'M140 110L177 123', 'M140 129L175 140',                /* trap fibres */
    'M139 248L178 264', 'M139 268L178 283',                /* glute fibres */
    'M166 296V360', 'M148 296V358',                        /* hamstring split */
    'M151 386V448',                                        /* gastroc heads */
    'M156 122C167 133 174 146 176 161'                     /* scapular spine */
  ];

  const UPPER_DETAIL_FRONT = ['M-1 48V104', 'M10 68V106'];
  const UPPER_DETAIL_BACK  = ['M-2 44V106', 'M7 40V102'];
  const FORE_DETAIL_FRONT  = ['M1 18V90', 'M-7 22V86'];
  const FORE_DETAIL_BACK   = ['M2 6V88', 'M13 2V80'];

  function compileTorso(list) {
    return list.map(function (m) { return { id: m.id, d: torsoBand(m.rows), frame: 'torso' }; });
  }
  function compileLimb(list, frame) {
    return list.map(function (m) { return { id: m.id, d: band(m.rows), frame: frame }; });
  }

  const FIGURES = {
    front: {
      muscles: compileTorso(FRONT_TORSO)
        .concat(compileLimb(FRONT_UPPER, 'upper'))
        .concat(compileLimb(FRONT_FORE, 'fore')),
      detail: FRONT_DETAIL, upperDetail: UPPER_DETAIL_FRONT, foreDetail: FORE_DETAIL_FRONT,
      label: 'Front'
    },
    back: {
      muscles: compileTorso(BACK_TORSO)
        .concat(compileLimb(BACK_UPPER, 'upper'))
        .concat(compileLimb(BACK_FORE, 'fore')),
      detail: BACK_DETAIL, upperDetail: UPPER_DETAIL_BACK, foreDetail: FORE_DETAIL_BACK,
      label: 'Back'
    }
  };

  /* ---------------------------------------------------------------------------
     HEAT SCALE — non-zero values only ever use the accent ramp.
     ------------------------------------------------------------------------ */

  const STEPS = [0.001, 0.18, 0.38, 0.62, 0.84];

  function heatColor(t) {
    if (!(t > 0)) return 'var(--anat-idle)';
    let n = 1;
    for (let i = 0; i < STEPS.length; i++) if (t >= STEPS[i]) n = i + 1;
    return 'var(--heat-' + n + ')';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------------------------------------------------------------------
     RENDER
     ------------------------------------------------------------------------ */

  /* Every frame a shape can be drawn in, as flat transform STRINGS — never as
     nested <g> wrappers. A <clipPath> only honours shape children: a <g> inside
     one is silently ignored, and the clip then consists of whatever bare path
     happened to come first. That single detail is why the arms and the entire
     mirrored half once rendered as bare skin — they were being clipped away by
     a region that only ever covered half a torso. */
  const FRAMES = {
    torso: ['', MIRROR_TF],
    upper: [UPPER_TF, MIRROR_TF + ' ' + UPPER_TF],
    fore:  [FORE_TF,  MIRROR_TF + ' ' + FORE_TF]
  };

  /** One shape, emitted once per frame, as sibling paths. */
  function place(d, frames, attrs) {
    return frames.map(function (tf) {
      return '<path d="' + d + '"' + (tf ? ' transform="' + tf + '"' : '') +
        (attrs || '') + '/>';
    }).join('');
  }
  /** Same, but the shape carries child content (a <title>). */
  function placeRich(d, frames, attrs, inner) {
    return frames.map(function (tf) {
      return '<path d="' + d + '"' + (tf ? ' transform="' + tf + '"' : '') +
        attrs + '>' + inner + '</path>';
    }).join('');
  }

  /**
   * Build one figure as an SVG string.
   * @param {'front'|'back'} view
   * @param {Object} heat  {muscleId: 0..100}
   * @param {Object} opts  {max}
   */
  function figureSVG(view, heat, opts) {
    opts = opts || {};
    const fig = FIGURES[view];
    const clip = 'anatclip' + (++uid);

    /* Composite ids from older exercises are rewritten onto the regions this
       figure actually draws, so selecting "Biceps" lights both heads. */
    heat = App.Muscles.expand(heat || {});

    let max = opts.max || 0;
    if (!max) for (const k in heat) max = Math.max(max, heat[k] || 0);
    if (!max) max = 1;

    const p = [];
    p.push('<svg class="anat-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="' + esc(fig.label) + ' view of muscle activation" ' +
      'preserveAspectRatio="xMidYMid meet">');

    /* --- clip: the union of trunk and both arms --- */
    const bodyShapes = place(TORSO_D, FRAMES.torso) +
                       place(UPPER_ARM_D, FRAMES.upper) +
                       place(FOREARM_D, FRAMES.fore);
    p.push('<defs><clipPath id="' + clip + '">' + bodyShapes + '</clipPath></defs>');

    /* THE OUTLINE IS DRAWN UNDERNEATH THE FILL.

       The body is three overlapping shapes per side — trunk, upper arm,
       forearm — and stroking each one separately draws every place they cross:
       an arm contour ruled across the chest, a straight edge sawn through the
       elbow, and a seam down the midline where the two halves meet. Stroking
       them WIDE and in the ink colour first, then covering all of it with the
       plain fill, leaves ink showing only where no shape covered it — which is
       exactly the outside edge of the union, and nowhere else. No masks, no
       hand-trimmed open contours, and no interior seams by construction. */
    p.push('<g class="anat-silhouette">' + bodyShapes + '</g>');
    p.push('<g class="anat-body">' + bodyShapes + '</g>');

    /* --- muscle regions, clipped to the skin ---
       Loaded muscles are drawn AFTER idle ones. Territories no longer overlap,
       but where two bellies do meet this guarantees the one carrying work is
       the one you can see, rather than whichever happened to be authored
       later. */
    const ordered = fig.muscles.slice().sort(function (a, b) {
      return ((Number(heat[a.id]) || 0) > 0 ? 1 : 0) - ((Number(heat[b.id]) || 0) > 0 ? 1 : 0);
    });

    p.push('<g class="anat-muscles" clip-path="url(#' + clip + ')">');
    ordered.forEach(function (m) {
      const v = Number(heat[m.id]) || 0;
      const title = esc(App.Muscles.label(m.id, true)) +
        (v > 0 ? ' — ' + (Math.round(v * 10) / 10) + '%' : '');
      const attrs = ' class="anat-m' + (v > 0 ? ' is-active' : '') +
        '" data-muscle="' + m.id + '" data-value="' + v + '"' +
        ' fill="' + heatColor(v / max) + '"';
      p.push(placeRich(m.d, FRAMES[m.frame], attrs, '<title>' + title + '</title>'));
    });
    p.push('</g>');

    /* --- striations --- */
    p.push('<g class="anat-detail" clip-path="url(#' + clip + ')">');
    fig.detail.forEach(function (d) { p.push(place(d, FRAMES.torso)); });
    fig.upperDetail.forEach(function (d) { p.push(place(d, FRAMES.upper)); });
    fig.foreDetail.forEach(function (d) { p.push(place(d, FRAMES.fore)); });
    p.push('</g>');

    p.push('</svg>');
    return p.join('');
  }

  function legendHTML(max) {
    return '<div class="anat-legend">' +
      '<span class="anat-legend-label">0%</span>' +
      '<i class="anat-legend-ramp"></i>' +
      '<span class="anat-legend-label">' + (max ? Math.round(max) + '%' : 'max') + '</span>' +
    '</div>';
  }

  /**
   * @param {Element} el
   * @param {Object} heat  {muscleId: 0..100}
   * @param {Object} opts  {legend:false, compact:true, interactive:false,
   *                        compare:<heat map to show a delta against>}
   */
  function render(el, heat, opts) {
    if (!el) return;
    opts = opts || {};
    heat = heat || {};
    const shown = App.Muscles.expand(heat);
    let max = 0;
    for (const k in shown) max = Math.max(max, shown[k] || 0);

    el.innerHTML =
      '<div class="anat-pair' + (opts.compact ? ' is-compact' : '') + '">' +
        '<figure class="anat-fig">' + figureSVG('front', heat, { max: max }) +
          '<figcaption>Front</figcaption></figure>' +
        '<figure class="anat-fig">' + figureSVG('back', heat, { max: max }) +
          '<figcaption>Back</figcaption></figure>' +
      '</div>' +
      (opts.legend === false ? '' : legendHTML(max));

    if (opts.interactive !== false) {
      bindTooltip(el, opts.compare ? App.Muscles.expand(opts.compare) : null);
    }
  }

  /**
   * Readout shared across both figures, highlighting the mirrored twin too.
   *
   * Hover is a desktop idea. On a phone `pointermove` only fires while a finger
   * is already dragging, and `pointerleave` fires the moment it lifts — so a
   * tap, which is the only gesture a phone user has here, showed nothing at
   * all. Touch therefore gets its own model: tap a muscle to PIN the readout,
   * tap it again or anywhere else to dismiss. Mouse keeps hover.
   */
  function bindTooltip(root, compare) {
    let tip = root.querySelector('.anat-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'anat-tip';
      tip.setAttribute('aria-hidden', 'true');
      root.appendChild(tip);
    }
    let pinned = null;

    function clearHot() {
      root.querySelectorAll('.anat-m.is-hot').forEach(function (n) { n.classList.remove('is-hot'); });
    }

    function hide() {
      pinned = null;
      tip.classList.remove('is-on', 'is-pinned');
      clearHot();
    }

    function text(id, v) {
      let out = App.Muscles.label(id, true) + '  ·  ' +
        (v > 0 ? (Math.round(v * 10) / 10) + '% of this workload' : 'not worked');
      if (compare) {
        const was = Number(compare[id]) || 0;
        const d = v - was;
        /* Both numbers are shares of a total, so the difference is in
           percentage POINTS — calling it a percent change would be wrong. */
        if (Math.abs(d) >= 0.1) {
          out += '  ·  ' + (d > 0 ? '+' : '−') + (Math.round(Math.abs(d) * 10) / 10) + ' pts';
        } else if (was > 0 || v > 0) {
          out += '  ·  level';
        }
      }
      return out;
    }

    function show(path, clientX, clientY) {
      const id = path.getAttribute('data-muscle');
      const v = Number(path.getAttribute('data-value')) || 0;
      clearHot();
      root.querySelectorAll('.anat-m[data-muscle="' + id + '"]')
          .forEach(function (n) { n.classList.add('is-hot'); });
      tip.textContent = text(id, v);
      tip.classList.add('is-on');

      const r = root.getBoundingClientRect();
      let x = clientX - r.left;
      const y = clientY - r.top;
      const half = tip.offsetWidth / 2;
      /* Centred on the touch point, so clamp by half its width or a muscle near
         either edge puts the label outside the card. */
      x = Math.max(half + 4, Math.min(r.width - half - 4, x));
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
      return id;
    }

    function hit(e) {
      return e.target && e.target.closest ? e.target.closest('.anat-m') : null;
    }

    root.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || pinned) return;
      const path = hit(e);
      if (!path) { tip.classList.remove('is-on'); clearHot(); return; }
      show(path, e.clientX, e.clientY);
    });

    root.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse' && !pinned) { tip.classList.remove('is-on'); clearHot(); }
    });

    root.addEventListener('click', function (e) {
      const path = hit(e);
      if (!path) { hide(); return; }
      const id = path.getAttribute('data-muscle');
      if (pinned === id) { hide(); return; }   /* second tap closes it */
      pinned = show(path, e.clientX, e.clientY);
      tip.classList.add('is-pinned');
    });

    if (!root.__anatDismiss) {
      root.__anatDismiss = function (e) {
        if (!pinned) return;
        if (!root.contains(e.target)) hide();
      };
      document.addEventListener('click', root.__anatDismiss, true);
    }
  }

  App.Anatomy = {
    render: render,
    figureSVG: figureSVG,
    heatColor: heatColor,
    band: band,
    /** Every muscle id the figures can actually draw — used by the self-check. */
    drawnIds: function () {
      const s = Object.create(null);
      ['front', 'back'].forEach(function (v) {
        FIGURES[v].muscles.forEach(function (m) { s[m.id] = true; });
      });
      return Object.keys(s);
    },
    W: W, H: H
  };
})(window.App = window.App || {});
