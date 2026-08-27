/* =============================================================================
   charts.js — hand-rolled SVG charts

   House style (per spec): structure is black / white / grey only. The single
   chromatic element is the themed heat ramp, used for the series that carries
   the value being measured. Forecasts are drawn dashed with a grey confidence
   band so a projection can never be mistaken for recorded data.

   Responsiveness: every chart measures its container and builds the viewBox at
   that exact pixel width, so one SVG unit is always one CSS pixel and nothing
   is ever scaled non-uniformly. A ResizeObserver redraws on rotation or layout
   change. (An earlier fixed-width viewBox with preserveAspectRatio="none"
   squeezed the whole plot — labels included — by ~2.5x on a phone.)
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U;
  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const k in (attrs || {})) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  function f(n) { return Math.round(n * 100) / 100; }

  /** Usable width of a container, with a sane floor before first layout. */
  function measure(container) {
    const w = container.getBoundingClientRect().width ||
      (container.parentElement ? container.parentElement.getBoundingClientRect().width : 0);
    return Math.max(220, Math.round(w) || 320);
  }

  /**
   * Draw now, and again whenever the container changes width. The observer is
   * attached once per container and keyed so repeated calls replace, never
   * stack up.
   */
  function responsive(container, draw) {
    let last = 0;
    function run() {
      const w = measure(container);
      if (Math.abs(w - last) < 2) return;
      last = w;
      draw(w);
    }
    run();
    if (container.__chartRO) container.__chartRO.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      container.__chartRO = new ResizeObserver(run);
      container.__chartRO.observe(container);
    }
  }

  /* ---------------------------------------------------------------------------
     SCALES & TICKS
     ------------------------------------------------------------------------ */

  /** "Nice" axis bounds and step for a value range. */
  function niceScale(min, max, ticks) {
    ticks = ticks || 5;
    if (min === max) { min = min - 1; max = max + 1; }
    const raw = (max - min) / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    return {
      min: Math.floor(min / step) * step,
      max: Math.ceil(max / step) * step,
      step: step
    };
  }

  function ticksFor(scale) {
    const out = [];
    /* guard against float drift producing a runaway loop */
    for (let v = scale.min, i = 0; v <= scale.max + scale.step * 0.001 && i < 200; v += scale.step, i++) {
      out.push(Math.round(v * 1e6) / 1e6);
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
     LINEAR REGRESSION — used for the progress forecast
     ------------------------------------------------------------------------ */

  /**
   * Least-squares fit over {x, y} points.
   * Returns slope/intercept, r², and the residual standard error used to draw
   * the forecast confidence band.
   */
  function regress(points) {
    const n = points.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    points.forEach(function (p) {
      sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x;
    });
    const d = n * sxx - sx * sx;
    if (!d) return null;
    const slope = (n * sxy - sx * sy) / d;
    const intercept = (sy - slope * sx) / n;

    const meanY = sy / n;
    let ssTot = 0, ssRes = 0;
    points.forEach(function (p) {
      const yh = slope * p.x + intercept;
      ssTot += Math.pow(p.y - meanY, 2);
      ssRes += Math.pow(p.y - yh, 2);
    });
    const r2 = ssTot ? 1 - ssRes / ssTot : 0;
    const se = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
    return { slope: slope, intercept: intercept, r2: r2, se: se, n: n,
      at: function (x) { return slope * x + intercept; } };
  }

  /* ---------------------------------------------------------------------------
     SATURATING GROWTH — a projection that knows strength has a ceiling

     A straight line through someone's estimated 1RM says the next twelve months
     will look exactly like the last three did. They will not. Progress against
     a ceiling slows as the gap to it closes: the training that adds 10 kg to a
     60 kg bench adds a fraction of that to a 160 kg one, because what is left
     to gain is what is left. Extrapolated a year out, a straight line promises
     a number nobody has ever lifted, and it is most confident exactly where it
     is most wrong.

     The model is the standard bounded-growth curve

         y(t) = C - (C - y0) * e^(-k t)

     which starts at y0, rises fast while the gap is wide, and flattens as it
     approaches the ceiling C. Taking logs of the REMAINING GAP linearises it:

         ln(C - y) = ln(C - y0) - k t

     so the same least-squares fit above solves it, and the decay rate k falls
     out of the slope. One substitution, and the curve does the rest.
     ------------------------------------------------------------------------ */

  /**
   * @param {Array}  points   [{x: epoch ms, y}] oldest first
   * @param {number} ceiling  the asymptote to approach, in the same units as y
   * @returns {Object|null} {at(x), k, r2, n, ceiling, halfLifeDays, growing}
   */
  function saturating(points, ceiling) {
    if (!points || points.length < 3 || !(ceiling > 0)) return null;

    let maxY = 0;
    points.forEach(function (p) { maxY = Math.max(maxY, p.y); });

    /* A ceiling at or below what has already been lifted leaves no gap to fit,
       and ln() of zero or of a negative gap is not a number. Someone who has
       beaten the estimate simply has a higher ceiling than the estimate knew. */
    const C = Math.max(ceiling, maxY * 1.02 + 0.5);

    /* Fit against time SINCE THE FIRST POINT. Epoch milliseconds are ~1.7e12,
       and the sums of squares a least-squares fit takes then land near the edge
       of what a double can hold apart — the subtraction inside it cancels most
       of the significant digits. Shifting the origin costs one subtraction and
       removes the problem. */
    const x0 = points[0].x;
    const lin = regress(points.map(function (p) {
      return { x: p.x - x0, y: Math.log(C - p.y) };
    }));
    if (!lin) return null;

    const k = -lin.slope;
    return {
      ceiling: C,
      k: k,
      n: lin.n,
      r2: lin.r2,
      growing: k > 0,
      /* k in a unit a person can hold: how long to close half the gap that is
         left. "Half of what remains, every four months" is a statement about
         training; "k = 5.9e-9" is not. */
      halfLifeDays: k > 0 ? Math.LN2 / k / 86400000 : Infinity,
      at: function (x) {
        const y = C - Math.exp(lin.at(x - x0));
        return Math.max(0, Math.min(C, y));
      }
    };
  }

  /* ---------------------------------------------------------------------------
     LINE / AREA CHART
     ------------------------------------------------------------------------ */

  /**
   * line(container, opts)
   *  series:   [{ name, points:[{x,y}], accent, dash, area, dots }]
   *  bands:    [{ points:[{x, lo, hi}] }]   grey confidence regions
   *  xType:    'date' | 'number'
   *  yFormat:  fn(value) -> string
   *  height:   px (default 220; shrinks on narrow screens)
   */
  function line(container, opts) {
    opts = opts || {};
    const series = (opts.series || []).filter(function (s) { return s.points && s.points.length; });

    if (!series.length) {
      container.innerHTML = '<div class="empty"><p>Not enough data yet.</p></div>';
      return null;
    }
    responsive(container, function (Wv) { drawLine(container, opts, series, Wv); });
  }

  function drawLine(container, opts, series, Wv) {
    const bands = opts.bands || [];
    const narrow = Wv < 420;
    const H = opts.height ? (narrow ? Math.max(150, opts.height - 40) : opts.height)
                          : (narrow ? 180 : 220);
    const pad = { t: 12, r: narrow ? 10 : 14, b: narrow ? 22 : 26, l: narrow ? 38 : 46 };

    let xs = [], ys = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) { xs.push(p.x); ys.push(p.y); });
    });
    bands.forEach(function (b) {
      b.points.forEach(function (p) { xs.push(p.x); ys.push(p.lo); ys.push(p.hi); });
    });

    const xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
    const yScale = niceScale(
      opts.yMin !== undefined ? opts.yMin : Math.min.apply(null, ys),
      opts.yMax !== undefined ? Math.max(opts.yMax, Math.max.apply(null, ys))
                              : Math.max.apply(null, ys),
      narrow ? 3 : (opts.yTicks || 4));
    if (opts.yMin !== undefined) yScale.min = Math.min(yScale.min, opts.yMin);
    /* A reference rule above the data is dropped rather than clamped, which is
       right — but a caller drawing a CEILING wants the ceiling on screen, not
       silently discarded for being higher than everything under it. `yMax`
       makes room for it. */
    if (opts.yMax !== undefined) yScale.max = Math.max(yScale.max, opts.yMax);

    const iw = Wv - pad.l - pad.r, ih = H - pad.t - pad.b;
    const sx = function (x) {
      return pad.l + (xMax === xMin ? iw / 2 : ((x - xMin) / (xMax - xMin)) * iw);
    };
    const sy = function (y) {
      return pad.t + ih - ((y - yScale.min) / (yScale.max - yScale.min)) * ih;
    };

    const svg = el('svg', { viewBox: '0 0 ' + Wv + ' ' + H,
      width: Wv, height: H,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img', 'aria-label': opts.label || 'chart' });

    /* --- gridlines + y axis --- */
    const grid = el('g', { class: 'ch-grid' });
    const axis = el('g', { class: 'ch-axis' });
    ticksFor(yScale).forEach(function (v) {
      const y = sy(v);
      grid.appendChild(el('line', { x1: pad.l, y1: f(y), x2: Wv - pad.r, y2: f(y) }));
      const t = el('text', { class: 'ch-tick', x: pad.l - 6, y: f(y) + 3, 'text-anchor': 'end' });
      t.textContent = opts.yFormat ? opts.yFormat(v) : U.compact(v);
      axis.appendChild(t);
    });
    axis.appendChild(el('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: pad.t + ih }));
    axis.appendChild(el('line', { x1: pad.l, y1: pad.t + ih, x2: Wv - pad.r, y2: pad.t + ih }));
    svg.appendChild(grid);
    svg.appendChild(axis);

    /* --- x ticks --- */
    const xTickCount = Math.min(6, Math.max(2, Math.floor(iw / (narrow ? 78 : 110))));
    const xAxis = el('g', { class: 'ch-axis' });
    for (let i = 0; i < xTickCount; i++) {
      const v = xMin + ((xMax - xMin) * i) / (xTickCount - 1);
      const t = el('text', { class: 'ch-tick', x: f(sx(v)), y: H - 6, 'text-anchor':
        i === 0 ? 'start' : i === xTickCount - 1 ? 'end' : 'middle' });
      t.textContent = opts.xType === 'date'
        ? U.fmtDate(new Date(v).toISOString().slice(0, 10), 'short')
        : U.compact(v);
      xAxis.appendChild(t);
    }
    svg.appendChild(xAxis);

    /* --- reference rules (drawn under the lines) ---------------------------
       A labelled horizontal line at a meaningful y — rank thresholds on the
       ranking chart, so a series crossing one reads as a promotion rather than
       just a number going up. Rules outside the current y range are dropped
       rather than clamped to the edge, where they would look like a threshold
       that had been reached. */
    (opts.rules || []).filter(function (r) {
      return r.y >= yScale.min && r.y <= yScale.max;
    }).forEach(function (r) {
      const y = sy(r.y);
      const ln = el('line', { class: 'ch-rule', x1: pad.l, y1: f(y), x2: Wv - pad.r, y2: f(y) });
      if (r.color) ln.setAttribute('stroke', r.color);
      svg.appendChild(ln);
      if (r.label && !narrow) {
        const t = el('text', { class: 'ch-rule-label', x: Wv - pad.r - 4, y: f(y) - 4,
          'text-anchor': 'end' });
        if (r.color) t.setAttribute('fill', r.color);
        t.textContent = r.label;
        svg.appendChild(t);
      }
    });

    /* --- confidence bands (drawn under the lines) --- */
    bands.forEach(function (b) {
      const up = b.points.map(function (p) { return f(sx(p.x)) + ',' + f(sy(p.hi)); });
      const dn = b.points.slice().reverse().map(function (p) {
        return f(sx(p.x)) + ',' + f(sy(p.lo)); });
      svg.appendChild(el('polygon', { class: 'ch-band', points: up.concat(dn).join(' ') }));
    });

    /* --- series --- */
    series.forEach(function (s) {
      const d = s.points.map(function (p, i) {
        return (i ? 'L' : 'M') + f(sx(p.x)) + ' ' + f(sy(p.y));
      }).join('');

      if (s.area) {
        svg.appendChild(el('path', {
          class: 'ch-area',
          d: d + 'L' + f(sx(s.points[s.points.length - 1].x)) + ' ' + f(sy(yScale.min)) +
             'L' + f(sx(s.points[0].x)) + ' ' + f(sy(yScale.min)) + 'Z'
        }));
      }
      svg.appendChild(el('path', {
        class: 'ch-line' + (s.accent ? ' is-accent' : '') + (s.dash ? ' is-dash' : ''),
        d: d
      }));
      /* Dots get noisy once they are closer together than a fingertip. */
      const spacing = iw / Math.max(1, s.points.length - 1);
      if (s.dots !== false && spacing > (narrow ? 14 : 9)) {
        s.points.forEach(function (p) {
          svg.appendChild(el('circle', {
            class: 'ch-dot' + (s.accent ? ' is-accent' : ''),
            cx: f(sx(p.x)), cy: f(sy(p.y)), r: narrow ? 2.4 : 2.8
          }));
        });
      }
    });

    /* --- hover / touch readout --- */
    const wrap = U.h('.chart-wrap');
    const tip = U.h('.chart-tip');
    const cursor = el('line', { class: 'ch-cursor', y1: pad.t, y2: pad.t + ih, opacity: 0 });
    svg.appendChild(cursor);

    const hit = el('rect', { class: 'ch-hit', x: pad.l, y: pad.t, width: Math.max(0, iw), height: Math.max(0, ih) });
    svg.appendChild(hit);

    const flat = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) { flat.push({ x: p.x, y: p.y, name: s.name, dash: s.dash }); });
    });

    function readout(e) {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * Wv;
      const xv = xMin + ((vx - pad.l) / iw) * (xMax - xMin);
      let best = null, bd = Infinity;
      flat.forEach(function (p) {
        const d = Math.abs(p.x - xv);
        if (d < bd) { bd = d; best = p; }
      });
      if (!best) return;
      cursor.setAttribute('x1', f(sx(best.x)));
      cursor.setAttribute('x2', f(sx(best.x)));
      cursor.setAttribute('opacity', 1);
      const label = opts.xType === 'date'
        ? U.fmtDate(new Date(best.x).toISOString().slice(0, 10))
        : U.num(best.x, 0);
      tip.textContent = label + '  ·  ' +
        (opts.yFormat ? opts.yFormat(best.y) : U.num(best.y)) +
        (best.dash ? ' (projected)' : '');
      tip.style.left = ((sx(best.x) / Wv) * 100) + '%';
      tip.style.top = ((sy(best.y) / H) * 100) + '%';
      tip.classList.add('is-on');
    }
    function clear() {
      tip.classList.remove('is-on');
      cursor.setAttribute('opacity', 0);
    }
    hit.addEventListener('pointermove', readout);
    hit.addEventListener('pointerdown', readout);
    hit.addEventListener('pointerleave', clear);
    hit.addEventListener('pointercancel', clear);

    const chart = U.h('.chart');
    chart.appendChild(svg);
    wrap.appendChild(chart);
    wrap.appendChild(tip);

    U.clear(container);
    container.appendChild(wrap);

    if (opts.legend !== false && series.length > 1) {
      const lg = U.h('.chart-legend');
      series.forEach(function (s) {
        lg.appendChild(U.h('span', [
          U.h('i.legend-swatch' + (s.accent ? '.is-accent' : '') + (s.dash ? '.is-dash' : '')),
          s.name || ''
        ]));
      });
      container.appendChild(lg);
    }
    return svg;
  }

  /* ---------------------------------------------------------------------------
     BAR CHART
     ------------------------------------------------------------------------ */

  /**
   * bars(container, {data:[{label, value, muted}], height, yFormat, horizontal})
   */
  function bars(container, opts) {
    opts = opts || {};
    const data = opts.data || [];
    if (!data.length) {
      container.innerHTML = '<div class="empty"><p>No data for this period.</p></div>';
      return;
    }
    if (opts.horizontal) return hbars(container, opts);
    responsive(container, function (Wv) { drawBars(container, opts, data, Wv); });
  }

  function drawBars(container, opts, data, Wv) {
    const narrow = Wv < 420;
    const H = opts.height ? (narrow ? Math.max(140, opts.height - 30) : opts.height)
                          : (narrow ? 170 : 200);
    const pad = { t: 12, r: narrow ? 8 : 12, b: narrow ? 26 : 30, l: narrow ? 38 : 46 };
    const iw = Wv - pad.l - pad.r, ih = H - pad.t - pad.b;

    const yScale = niceScale(0, Math.max.apply(null, data.map(function (d) { return d.value; })),
      narrow ? 3 : 4);
    const bw = iw / data.length;
    const barW = Math.max(2, Math.min(46, bw * 0.62));

    const svg = el('svg', { viewBox: '0 0 ' + Wv + ' ' + H, width: Wv, height: H,
      preserveAspectRatio: 'xMidYMid meet' });

    const grid = el('g', { class: 'ch-grid' });
    const axis = el('g', { class: 'ch-axis' });
    ticksFor(yScale).forEach(function (v) {
      const y = pad.t + ih - (v / (yScale.max || 1)) * ih;
      grid.appendChild(el('line', { x1: pad.l, y1: f(y), x2: Wv - pad.r, y2: f(y) }));
      const t = el('text', { class: 'ch-tick', x: pad.l - 6, y: f(y) + 3, 'text-anchor': 'end' });
      t.textContent = opts.yFormat ? opts.yFormat(v) : U.compact(v);
      axis.appendChild(t);
    });
    axis.appendChild(el('line', { x1: pad.l, y1: pad.t + ih, x2: Wv - pad.r, y2: pad.t + ih }));
    svg.appendChild(grid);
    svg.appendChild(axis);

    const step = Math.ceil(data.length / Math.max(2, Math.floor(iw / (narrow ? 44 : 70))));
    data.forEach(function (d, i) {
      const x = pad.l + bw * i + (bw - barW) / 2;
      const hgt = yScale.max ? (d.value / yScale.max) * ih : 0;
      const rect = el('rect', {
        class: 'ch-bar' + (d.muted ? ' is-muted' : ''),
        x: f(x), y: f(pad.t + ih - hgt), width: f(barW), height: f(Math.max(0, hgt)), rx: 2
      });
      const title = el('title');
      title.textContent = d.label + ': ' + (opts.yFormat ? opts.yFormat(d.value) : U.num(d.value));
      rect.appendChild(title);
      svg.appendChild(rect);

      if (i % step === 0) {
        const t = el('text', { class: 'ch-tick', x: f(x + barW / 2), y: H - 8,
          'text-anchor': 'middle' });
        t.textContent = d.label;
        svg.appendChild(t);
      }
    });

    const chart = U.h('.chart');
    chart.appendChild(svg);
    U.clear(container);
    container.appendChild(chart);
  }

  /** Horizontal ranked bars — used for muscle-group volume splits. */
  function hbars(container, opts) {
    const data = opts.data;
    const max = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    const wrap = U.h('.mlist');
    data.forEach(function (d) {
      wrap.appendChild(U.h('.mlist-row', [
        U.h('span.mlist-name', { text: d.label }),
        U.h('span.mlist-pct', { text: opts.yFormat ? opts.yFormat(d.value) : U.num(d.value) }),
        U.h('span.mlist-bar', [
          U.h('i.mlist-fill', { style: { width: ((d.value / max) * 100) + '%' } })
        ])
      ]));
    });
    U.clear(container);
    container.appendChild(wrap);
  }

  /* ---------------------------------------------------------------------------
     SPARKLINE — inline, no axes
     ------------------------------------------------------------------------ */

  function spark(values, opts) {
    opts = opts || {};
    const w = opts.width || 96, hh = opts.height || 26;
    if (!values || values.length < 2) return '';
    const min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    const rng = max - min || 1;
    const d = values.map(function (v, i) {
      const x = (i / (values.length - 1)) * (w - 2) + 1;
      const y = hh - 2 - ((v - min) / rng) * (hh - 4);
      return (i ? 'L' : 'M') + f(x) + ' ' + f(y);
    }).join('');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + hh + '" width="' + w + '" height="' + hh +
      '" aria-hidden="true"><path d="' + d + '" fill="none" stroke="var(--heat-4)" ' +
      'stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  App.Charts = {
    line: line,
    bars: bars,
    spark: spark,
    regress: regress,
    saturating: saturating,
    niceScale: niceScale
  };
})(window.App = window.App || {});
