/* =============================================================================
   anatomy.js — anatomical front/back heat figures

   Design notes
   -------------
   * Each figure is drawn in a 220 x 520 viewBox, centred on x = 110.
   * Bilateral muscles are authored ONCE for the right half of the body and
     mirrored with matrix(-1,0,0,1,220,0). Perfect symmetry, half the data.
   * The silhouette is an OPEN contour (head-top -> outer side -> foot -> inner
     leg -> crotch). Appending "Z" closes it up the midline for the fill; the
     open form strokes the outline, so no seam runs down the middle of the body.
   * Muscle bellies are described as BANDS: a list of [y, xInner, xOuter] rows
     traced against the real silhouette bounds, expanded into a closed
     Catmull-Rom spline. Authoring against measured limb bounds is what keeps
     each belly anatomically seated instead of floating.
   * Every belly is drawn slightly oversized and clipped to the silhouette,
     which is what produces the crisp "filled to the skin" edges of a medical
     plate and makes small authoring errors impossible to see.
   * Colour rule (per spec): everything structural is black / white / grey.
     ONLY muscles carrying a non-zero load receive the accent heat ramp.
   ============================================================================= */
(function (App) {
  'use strict';

  const W = 220, H = 520;
  let uid = 0;

  /* ---------------------------------------------------------------------------
     PATH HELPERS
     ------------------------------------------------------------------------ */

  function f(n) { return Math.round(n * 100) / 100; }

  /** Closed Catmull-Rom spline through points, emitted as cubic beziers. */
  function spline(pts) {
    const n = pts.length;
    const P = function (i) { return pts[((i % n) + n) % n]; };
    let d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C' + f(c1x) + ' ' + f(c1y) + ' ' + f(c2x) + ' ' + f(c2y) + ' ' + f(p2[0]) + ' ' + f(p2[1]);
    }
    return d + 'Z';
  }

  /** Build a muscle belly from [y, xInner, xOuter] rows, top -> bottom. */
  function band(rows) {
    const outer = rows.map(function (r) { return [r[2], r[0]]; });
    const inner = rows.map(function (r) { return [r[1], r[0]]; }).reverse();
    return spline(outer.concat(inner));
  }

  /* ---------------------------------------------------------------------------
     SILHOUETTES
     ------------------------------------------------------------------------ */

  /* ---------------------------------------------------------------------------
     PROPORTIONS
     Athletic canon on a 220 x 520 field, centred on x = 110:
       y  13  crown          y 136  nipple line     y 262  crotch
       y  82  chin           y 205  waist (narrow)  y 356  knee
       y 100  shoulder line  y 240  iliac crest     y 470  ankle
     Shoulder span comes from the deltoids (half-width ~65) while the ribcage
     stays near 50 and the waist at 30 — which is where the V-taper actually
     comes from on a real body, rather than from a flared ribcage.
     ------------------------------------------------------------------------ */

  /* ONE continuous silhouette for the right half of the body: crown -> head ->
     neck -> trap -> around the whole arm -> back up to the armpit -> down the
     ribs, hip and leg -> foot -> up the inner leg -> crotch.

     Authoring it as a single open contour rather than as separate torso and arm
     shapes is what makes the figure read as one body: there is no stroke where
     the arm meets the shoulder, so the limb is attached instead of floating
     beside the torso. Appending "Z" closes it up the midline to give the fill
     and the clip region; the open form is what gets stroked. */
  const SILHOUETTE =
    "M110 13" +
    "C123 13 132 25 132 41" +          /* cranium */
    "C132 51 130 59 127 65" +          /* temple */
    "C125 69 123 72 120 75" +          /* cheek */
    "C118 78 116 80 114 82" +          /* jaw to chin */
    "C116 86 118 89 119 93" +          /* under the jaw */
    "C120 96 123 98 129 100" +         /* neck into the trapezius */
    "C137 100 144 101 149 99" +        /* trap ridge to the shoulder */
    "C161 102 170 111 174 125" +       /* deltoid */
    "C177 138 176 152 173 165" +       /* upper arm outer */
    "C171 177 169 190 169 202" +       /* elbow */
    "C169 213 171 226 173 240" +       /* brachioradialis */
    "C175 253 175 265 173 277" +       /* forearm taper */
    "C172 287 171 296 171 304" +       /* wrist */
    "C173 313 174 323 172 332" +       /* hand */
    "C170 340 164 345 158 343" +
    "C153 341 151 336 152 329" +
    "C150 331 147 329 146 324" +       /* thumb side */
    "C144 317 144 308 146 300" +
    "C145 287 143 273 142 258" +       /* inner forearm */
    "C141 242 140 227 141 214" +
    "C143 202 145 190 146 178" +       /* inner upper arm */
    "C147 168 147 161 147 155" +       /* up to the armpit apex */
    "C146 165 145 174 143 183" +       /* back down the ribcage */
    "C141 193 140 200 140 208" +
    "C140 219 142 230 146 240" +       /* iliac crest */
    "C151 251 154 260 154 271" +       /* hip */
    "C154 287 152 302 149 317" +       /* thigh */
    "C147 331 144 345 142 357" +
    "C141 365 140 372 140 380" +       /* knee */
    "C140 392 142 404 143 416" +       /* calf */
    "C144 430 142 448 139 460" +
    "C138 468 137 474 137 480" +       /* ankle */
    "C137 488 139 496 138 502" +
    "C135 507 127 508 122 506" +       /* foot */
    "C119 505 118 501 118 496" +
    "C118 488 119 482 119 476" +
    "C119 458 121 436 122 416" +       /* inner calf */
    "C123 398 123 382 122 368" +
    "C121 348 119 324 117 301" +       /* inner thigh */
    "C116 285 115 273 113 266" +
    "C112 263 111 262 110 262";        /* crotch */

  /* ---------------------------------------------------------------------------
     MUSCLE BANDS — [y, xInner, xOuter], traced against MEASURED silhouette
     bounds and then deliberately overshot by a couple of units on each side.
     The clip path trims the overshoot, and the result is that neighbouring
     bellies butt up against each other and against the skin instead of leaving
     slivers of background showing through — which is what separates a medical
     plate from a diagram of floating tiles.
     Order matters: deep muscles first, superficial last.
     ------------------------------------------------------------------------ */

  const FRONT_MUSCLES = [
    { id: 'sternocleidomastoid', rows: [[74,113,122],[84,111,125],[93,109,124],[101,108,120]] },
    { id: 'trap_upper',   rows: [[94,118,128],[102,121,143],[110,125,156],[119,129,159]] },

    { id: 'serratus',     rows: [[145,137,153],[158,135,151],[172,133,148],[186,131,145],[199,130,142]] },
    { id: 'pec_upper',    rows: [[102,108,126],[110,108,146],[118,108,156],[128,108,156]] },
    { id: 'pec_mid',      rows: [[128,108,156],[140,108,154],[152,108,151],[164,108,147]] },
    { id: 'pec_lower',    rows: [[164,108,147],[172,108,144],[180,108,138],[188,108,127]] },

    { id: 'delt_side',    rows: [[97,149,162],[110,152,169],[124,154,177],[140,155,178],[154,156,174],[167,157,169]] },
    { id: 'delt_front',   rows: [[97,143,155],[110,142,162],[124,142,167],[140,142,167],[154,143,164],[165,144,159]] },

    { id: 'biceps',       rows: [[149,141,158],[165,141,162],[182,141,162],[198,141,160],[212,141,157]] },
    { id: 'brachialis',   rows: [[151,157,173],[170,157,175],[188,156,172],[204,155,170],[218,153,167]] },
    { id: 'forearm_flex', rows: [[204,141,159],[222,139,166],[242,138,171],[262,138,173],[282,141,173],[297,144,169]] },

    { id: 'oblique',      rows: [[175,128,148],[194,129,146],[212,128,143],[230,127,146],[248,126,152],[263,126,155]] },
    { id: 'abs_upper',    rows: [[175,108,130],[192,108,132],[208,108,132],[222,108,130],[234,108,128]] },
    { id: 'abs_lower',    rows: [[234,108,128],[248,108,129],[262,108,126],[272,108,120],[281,108,113]] },

    { id: 'hip_flexor',   rows: [[241,117,140],[254,113,148],[266,111,153],[279,115,155]] },
    { id: 'adductor',     rows: [[261,107,127],[280,111,131],[300,115,131],[320,117,129],[340,118,126]] },
    { id: 'quad_lateral', rows: [[263,135,155],[284,136,155],[304,136,153],[324,134,150],[344,132,146],[359,130,143]] },
    { id: 'quad_rectus',  rows: [[265,123,139],[288,124,140],[310,124,139],[332,123,137],[352,122,134],[367,122,131]] },
    { id: 'quad_medial',  rows: [[306,117,131],[326,116,133],[344,115,133],[360,115,130],[376,117,125]] },
    { id: 'tibialis',     rows: [[370,121,141],[392,121,142],[412,120,144],[432,119,144],[452,118,141],[472,117,138]] }
  ];

  const BACK_MUSCLES = [
    { id: 'splenius',     rows: [[72,110,124],[84,108,126],[94,108,123],[101,108,119]] },

    { id: 'rhomboid',     rows: [[112,108,136],[126,108,144],[140,108,142],[157,108,131]] },
    { id: 'rotator_cuff', rows: [[117,127,154],[132,127,158],[146,128,154],[161,129,146]] },
    { id: 'teres_major',  rows: [[151,129,154],[164,128,155],[176,128,151],[187,129,145]] },
    { id: 'erector',      rows: [[160,108,121],[184,108,127],[206,108,129],[228,108,129],[250,108,126],[274,108,120]] },
    { id: 'lat',          rows: [[143,108,150],[162,108,155],[180,108,153],[200,108,148],[220,108,143],[240,108,141],[254,108,138]] },

    { id: 'trap_upper',   rows: [[86,108,120],[96,108,139],[107,108,153],[119,110,159]] },
    { id: 'trap_mid',     rows: [[119,108,153],[133,108,152],[147,108,148],[161,108,140]] },
    { id: 'trap_lower',   rows: [[159,108,140],[175,108,134],[191,108,126],[207,108,118],[218,108,112]] },

    { id: 'delt_side',    rows: [[97,149,162],[110,152,170],[124,154,178],[140,155,179],[154,156,175],[167,157,170]] },
    { id: 'delt_rear',    rows: [[97,143,155],[110,142,163],[124,142,168],[140,142,168],[154,143,165],[165,144,160]] },

    { id: 'triceps_long', rows: [[149,141,158],[166,141,161],[184,141,161],[200,141,159],[214,141,156]] },
    { id: 'triceps_lat',  rows: [[147,156,173],[166,156,175],[184,155,173],[200,154,170],[214,152,166]] },
    { id: 'forearm_ext',  rows: [[202,142,162],[220,140,168],[240,138,173],[262,138,173],[282,141,173],[297,144,169]] },

    { id: 'glute_med',    rows: [[222,129,150],[238,129,154],[252,130,156],[267,131,154]] },
    { id: 'glute_max',    rows: [[226,108,139],[246,108,149],[264,108,154],[282,108,156],[298,108,154],[310,112,150]] },

    { id: 'ham_biceps',   rows: [[269,133,155],[292,134,154],[312,134,152],[332,133,148],[352,131,144],[370,129,141]] },
    { id: 'ham_semi',     rows: [[269,113,138],[294,115,140],[314,116,140],[334,116,138],[352,116,135],[370,117,132]] },

    { id: 'calf_gastro',  rows: [[364,120,141],[386,120,142],[406,119,144],[426,119,144],[446,118,142],[460,118,139]] },
    { id: 'calf_soleus',  rows: [[438,118,143],[454,117,141],[470,116,139],[482,117,137],[492,118,134]] }
  ];

  /* Expand the bands into path data once, at load. */
  function compile(list) {
    return list.map(function (m) { return { id: m.id, d: m.d || band(m.rows) }; });
  }

  /* Fibre striations & tendinous inscriptions — decorative, always grey. */
  const FRONT_DETAIL = [
    "M110 178V275",                                              /* linea alba */
    "M111 192H133", "M111 206H133", "M111 220H131", "M111 232H129", /* inscriptions */
    "M112 108L148 122", "M112 132L149 140", "M112 156L146 152",  /* pec fibres */
    "M112 174L138 166",
    "M138 152C142 163 143 175 141 188",                          /* serratus slips */
    "M134 158C137 169 138 181 137 192",
    "M125 268V362", "M137 266V356",                              /* quad borders */
    "M119 314C124 332 126 352 125 372",                          /* vastus medialis */
    "M147 130V204", "M158 132V208",                              /* biceps / brachialis */
    "M143 212V288", "M156 216V284",                              /* forearm */
    "M124 380V468"                                               /* tibia edge */
  ];

  const BACK_DETAIL = [
    "M110 96V272",                                               /* spine */
    "M112 152L150 166", "M113 176L148 186", "M114 200L142 206",  /* lat fibres */
    "M115 222L138 226",
    "M112 116L146 130", "M112 134L144 144",                      /* trap fibres */
    "M111 238L146 256", "M111 258L146 274",                      /* glute fibres */
    "M135 278V362", "M118 278V360",                              /* hamstring split */
    "M119 376V452",                                              /* gastroc heads */
    "M128 122C136 134 141 146 142 160",                          /* scapular spine */
    "M145 130V206", "M157 132V208",
    "M144 212V288", "M157 216V284",
    "M110 212L128 200"                                           /* thoracolumbar */
  ];

  const FIGURES = {
    front: { muscles: compile(FRONT_MUSCLES), detail: FRONT_DETAIL, label: 'Anterior' },
    back:  { muscles: compile(BACK_MUSCLES),  detail: BACK_DETAIL,  label: 'Posterior' }
  };

  /* ---------------------------------------------------------------------------
     HEAT SCALE — non-zero values only ever use the accent ramp.
     ------------------------------------------------------------------------ */

  const STEPS = [0.001, 0.18, 0.38, 0.62, 0.84];

  /** Map a 0..1 intensity onto the themed accent ramp. */
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

  function mirror(d) { return '<path d="' + d + '" transform="matrix(-1,0,0,1,' + W + ',0)"'; }

  /* ---------------------------------------------------------------------------
     RENDER
     ------------------------------------------------------------------------ */

  /**
   * Build one figure as an SVG string.
   * @param {'front'|'back'} view
   * @param {Object} heat  {muscleId: 0..100}
   * @param {Object} opts  {max}
   */
  function figureSVG(view, heat, opts) {
    opts = opts || {};
    heat = heat || {};
    const fig = FIGURES[view];
    const clip = 'anatclip' + (++uid);

    let max = opts.max || 0;
    if (!max) for (const k in heat) max = Math.max(max, heat[k] || 0);
    if (!max) max = 1;

    const bodyFill = SILHOUETTE + 'Z';
    const p = [];

    p.push('<svg class="anat-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="' + esc(fig.label) + ' view of muscle activation" preserveAspectRatio="xMidYMid meet">');

    p.push('<defs><clipPath id="' + clip + '">');
    p.push('<path d="' + bodyFill + '"/>');
    p.push(mirror(bodyFill) + '/>');
    p.push('</clipPath></defs>');

    /* --- body base fill --- */
    p.push('<g class="anat-body">');
    p.push('<path d="' + bodyFill + '"/>');
    p.push(mirror(bodyFill) + '/>');
    p.push('</g>');

    /* --- muscle regions, clipped to the silhouette --- */
    p.push('<g class="anat-muscles" clip-path="url(#' + clip + ')">');
    fig.muscles.forEach(function (m) {
      const v = Number(heat[m.id]) || 0;
      const cls = 'anat-m' + (v > 0 ? ' is-active' : '');
      const title = esc(App.Muscles.label(m.id, true)) +
        (v > 0 ? ' — ' + (Math.round(v * 10) / 10) + '%' : '');
      const tail = ' class="' + cls + '" data-muscle="' + m.id + '" data-value="' + v + '"' +
        ' fill="' + heatColor(v / max) + '"><title>' + title + '</title></path>';
      p.push('<path d="' + m.d + '"' + tail);
      p.push(mirror(m.d) + tail);
    });
    p.push('</g>');

    /* --- fibre / inscription detail --- */
    p.push('<g class="anat-detail" clip-path="url(#' + clip + ')">');
    fig.detail.forEach(function (d) {
      p.push('<path d="' + d + '"/>');
      p.push(mirror(d) + '/>');
    });
    p.push('</g>');

    /* --- outline last so it always reads crisply --- */
    p.push('<g class="anat-outline">');
    p.push('<path d="' + SILHOUETTE + '"/>');
    p.push(mirror(SILHOUETTE) + '/>');
    p.push('</g>');

    p.push('</svg>');
    return p.join('');
  }

  /**
   * Render a front+back pair into a container element.
   * @param {HTMLElement} el
   * @param {Object} heat  {muscleId: percentage}
   * @param {Object} opts  {legend:false, compact:true, interactive:false}
   */
  function render(el, heat, opts) {
    if (!el) return;
    opts = opts || {};
    heat = heat || {};
    let max = 0;
    for (const k in heat) max = Math.max(max, heat[k] || 0);

    el.innerHTML =
      '<div class="anat-pair' + (opts.compact ? ' is-compact' : '') + '">' +
        '<figure class="anat-fig">' + figureSVG('front', heat, { max: max }) +
          '<figcaption>Anterior</figcaption></figure>' +
        '<figure class="anat-fig">' + figureSVG('back', heat, { max: max }) +
          '<figcaption>Posterior</figcaption></figure>' +
      '</div>' +
      (opts.legend === false ? '' : legendHTML(max));

    if (opts.interactive !== false) bindTooltip(el);
  }

  function legendHTML(max) {
    return '<div class="anat-legend">' +
      '<span class="anat-legend-label">none</span>' +
      '<span class="anat-legend-ramp" aria-hidden="true"></span>' +
      '<span class="anat-legend-label">' + (max ? Math.round(max) + '%' : 'max') + '</span>' +
    '</div>';
  }

  /* Shared hover readout across both figures; highlights the mirrored twin too. */
  function bindTooltip(root) {
    let tip = root.querySelector('.anat-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'anat-tip';
      tip.setAttribute('aria-hidden', 'true');
      root.appendChild(tip);
    }
    function clear() {
      root.querySelectorAll('.anat-m.is-hot').forEach(function (n) { n.classList.remove('is-hot'); });
    }
    root.addEventListener('pointermove', function (e) {
      const path = e.target && e.target.closest ? e.target.closest('.anat-m') : null;
      if (!path) { tip.classList.remove('is-on'); clear(); return; }
      const id = path.getAttribute('data-muscle');
      const v = Number(path.getAttribute('data-value')) || 0;
      clear();
      root.querySelectorAll('.anat-m[data-muscle="' + id + '"]')
          .forEach(function (n) { n.classList.add('is-hot'); });
      tip.textContent = App.Muscles.label(id, true) +
        (v > 0 ? '  ·  ' + (Math.round(v * 10) / 10) + '%' : '  ·  not worked');
      const r = root.getBoundingClientRect();
      tip.style.left = (e.clientX - r.left) + 'px';
      tip.style.top = (e.clientY - r.top) + 'px';
      tip.classList.add('is-on');
    });
    root.addEventListener('pointerleave', function () { tip.classList.remove('is-on'); clear(); });
  }

  App.Anatomy = {
    render: render,
    figureSVG: figureSVG,
    heatColor: heatColor,
    band: band,
    W: W, H: H
  };
})(window.App = window.App || {});
