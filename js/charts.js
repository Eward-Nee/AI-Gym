/* =============================================================================
   charts.js — hand-rolled SVG charts

   House style (per spec): structure is black / white / grey only. The single
   chromatic element is the themed heat ramp, used for the series that carries
   the value being measured. Forecasts are drawn dashed with a grey confidence
   band so a projection can never be mistaken for recorded data.
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
    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    points.forEach(function (p) {
      sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; syy += p.y * p.y;
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
     LINE / AREA CHART
     ------------------------------------------------------------------------ */

  /**
   * line(container, opts)
   *  series:   [{ name, points:[{x,y}], accent, dash, area, dots }]
   *  bands:    [{ points:[{x, lo, hi}] }]   grey confidence regions
   *  xType:    'date' | 'number'
   *  yFormat:  fn(value) -> string
   *  height:   px (default 220)
   */
  function line(container, opts) {
    opts = opts || {};
    const series = (opts.series || []).filter(function (s) { return s.points && s.points.length; });
    const bands = opts.bands || [];
    const H = opts.height || 220;
    const Wv = 720;                                  /* viewBox width; scales via CSS */
    const pad = { t: 12, r: 14, b: 26, l: 46 };

    if (!series.length) {
      container.innerHTML = '<div class="empty"><p>Not enough data yet.</p></div>';
      return null;
    }

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
      Math.max.apply(null, ys), opts.yTicks || 4);
    if (opts.yMin !== undefined) yScale.min = Math.min(yScale.min, opts.yMin);

    const iw = Wv - pad.l - pad.r, ih = H - pad.t - pad.b;
    const sx = function (x) {
      return pad.l + (xMax === xMin ? iw / 2 : ((x - xMin) / (xMax - xMin)) * iw);
    };
    const sy = function (y) {
      return pad.t + ih - ((y - yScale.min) / (yScale.max - yScale.min)) * ih;
    };

    const svg = el('svg', { viewBox: '0 0 ' + Wv + ' ' + H, preserveAspectRatio: 'none',
      role: 'img', 'aria-label': opts.label || 'chart' });
    svg.style.height = H + 'px';

    /* --- gridlines + y axis --- */
    const grid = el('g', { class: 'ch-grid' });
    const axis = el('g', { class: 'ch-axis' });
    ticksFor(yScale).forEach(function (v) {
      const y = sy(v);
      grid.appendChild(el('line', { x1: pad.l, y1: f(y), x2: Wv - pad.r, y2: f(y) }));
      const t = el('text', { class: 'ch-tick', x: pad.l - 7, y: f(y) + 3, 'text-anchor': 'end' });
      t.textContent = opts.yFormat ? opts.yFormat(v) : U.compact(v);
      axis.appendChild(t);
    });
    axis.appendChild(el('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: pad.t + ih }));
    axis.appendChild(el('line', { x1: pad.l, y1: pad.t + ih, x2: Wv - pad.r, y2: pad.t + ih }));
    svg.appendChild(grid);
    svg.appendChild(axis);

    /* --- x ticks --- */
    const xTickCount = Math.min(6, Math.max(2, Math.floor(iw / 110)));
    const xAxis = el('g', { class: 'ch-axis' });
    for (let i = 0; i < xTickCount; i++) {
      const v = xMin + ((xMax - xMin) * i) / (xTickCount - 1);
      const t = el('text', { class: 'ch-tick', x: f(sx(v)), y: H - 8, 'text-anchor':
        i === 0 ? 'start' : i === xTickCount - 1 ? 'end' : 'middle' });
      t.textContent = opts.xType === 'date'
        ? U.fmtDate(new Date(v).toISOString().slice(0, 10), 'short')
        : U.compact(v);
      xAxis.appendChild(t);
    }
    svg.appendChild(xAxis);

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
      if (s.dots !== false && s.points.length <= 60) {
        s.points.forEach(function (p) {
          svg.appendChild(el('circle', {
            class: 'ch-dot' + (s.accent ? ' is-accent' : ''),
            cx: f(sx(p.x)), cy: f(sy(p.y)), r: 2.8
          }));
        });
      }
    });

    /* --- hover readout --- */
    const wrap = U.h('.chart-wrap');
    const tip = U.h('.chart-tip');
    const cursor = el('line', { class: 'ch-cursor', y1: pad.t, y2: pad.t + ih, opacity: 0 });
    svg.appendChild(cursor);

    const hit = el('rect', { class: 'ch-hit', x: pad.l, y: pad.t, width: iw, height: ih });
    svg.appendChild(hit);

    const flat = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) { flat.push({ x: p.x, y: p.y, name: s.name, dash: s.dash }); });
    });

    hit.addEventListener('pointermove', function (e) {
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
    });
    hit.addEventListener('pointerleave', function () {
      tip.classList.remove('is-on');
      cursor.setAttribute('opacity', 0);
    });

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

    const H = opts.height || 200;
    const Wv = 720;
    const pad = { t: 12, r: 12, b: 30, l: 46 };
    const iw = Wv - pad.l - pad.r, ih = H - pad.t - pad.b;

    const yScale = niceScale(0, Math.max.apply(null, data.map(function (d) { return d.value; })), 4);
    const bw = iw / data.length;
    const barW = Math.max(3, Math.min(46, bw * 0.62));

    const svg = el('svg', { viewBox: '0 0 ' + Wv + ' ' + H, preserveAspectRatio: 'none' });
    svg.style.height = H + 'px';

    const grid = el('g', { class: 'ch-grid' });
    const axis = el('g', { class: 'ch-axis' });
    ticksFor(yScale).forEach(function (v) {
      const y = pad.t + ih - (v / (yScale.max || 1)) * ih;
      grid.appendChild(el('line', { x1: pad.l, y1: f(y), x2: Wv - pad.r, y2: f(y) }));
      const t = el('text', { class: 'ch-tick', x: pad.l - 7, y: f(y) + 3, 'text-anchor': 'end' });
      t.textContent = opts.yFormat ? opts.yFormat(v) : U.compact(v);
      axis.appendChild(t);
    });
    axis.appendChild(el('line', { x1: pad.l, y1: pad.t + ih, x2: Wv - pad.r, y2: pad.t + ih }));
    svg.appendChild(grid);
    svg.appendChild(axis);

    const step = Math.ceil(data.length / Math.max(2, Math.floor(iw / 70)));
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
        const t = el('text', { class: 'ch-tick', x: f(x + barW / 2), y: H - 10,
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
    niceScale: niceScale
  };
})(window.App = window.App || {});
