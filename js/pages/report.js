/* =============================================================================
   pages/report.js — analysis, personal records, rankings, and friend VS
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U, C = App.C;

  let root = null;
  let tab = 'overview';
  const view = { range: '90', metric: 'volume', load: 'all', forecastEx: null, horizon: 365 };
  let friendCache = null;

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'records', label: 'Records' },
    { id: 'forecast', label: 'Forecast' },
    { id: 'ranks', label: 'Ranks' },
    { id: 'vs', label: 'Compare' }
  ];

  function render(el, params) {
    root = el;
    if (params && params[0] && TABS.some(function (t) { return t.id === params[0]; })) {
      tab = params[0];
    }
    draw();
  }

  function onDataChange() { if (root && root.isConnected) draw(); }

  function draw() {
    U.clear(root);
    App.Shell.setTopActions([
      U.h('button.btn.btn-sm', {
        type: 'button', html: U.icon('download') + '<span>Export data</span>',
        onclick: function () {
          U.download('ai-gym-backup-' + U.today() + '.json',
            JSON.stringify(App.Store.exportAll(), null, 2));
          U.toast('Exported', 'Full backup downloaded.');
        }
      })
    ]);

    const tabs = U.h('.btn-group', TABS.map(function (t) {
      return U.h('button.btn.btn-sm' + (t.id === tab ? '.is-active' : ''), {
        type: 'button', text: t.label,
        onclick: function () { tab = t.id; App.Shell.navigate('report/' + t.id); }
      });
    }));

    root.appendChild(U.h('.row.row-wrap', [
      tabs,
      U.h('.spacer'),
      tab === 'overview' || tab === 'records' || tab === 'ranks'
        ? C.rangePicker(view.range, function (r) { view.range = r.id; draw(); })
        : null
    ]));

    if (tab === 'overview') drawOverview();
    else if (tab === 'records') drawRecords();
    else if (tab === 'forecast') drawForecast();
    else if (tab === 'ranks') drawRanks();
    else drawVS();
  }

  /* ---------------------------------------------------------------------------
     WHAT KIND OF SESSION WAS THAT

     A session carries the id of the plan it was run from, when it was run from
     one, but plenty are logged freehand — and two different plans can be the
     same kind of day. So sessions are labelled BOTH ways: by the plan they came
     from, and by the split the work itself describes. The second is derived from
     the sets that were actually logged, which means it is right even for a
     session that was improvised or that drifted away from its plan halfway
     through.
     ------------------------------------------------------------------------ */

  function sessionType(s) {
    const split = App.Store.suggestSplit({ items: s.entries || [] });
    return (split && split.label) || 'Unclassified';
  }

  /** Does this session pass the current training-load filter? */
  function passesLoadFilter(s) {
    const f = view.load;
    if (!f || f === 'all') return true;
    if (f.indexOf('plan:') === 0) return s.workoutId === f.slice(5);
    if (f.indexOf('type:') === 0) return sessionType(s) === f.slice(5);
    return true;
  }

  function loadFilterLabel() {
    const f = view.load;
    if (!f || f === 'all') return 'every session';
    if (f.indexOf('type:') === 0) return f.slice(5).toLowerCase() + ' sessions';
    const w = App.Store.getWorkout(f.slice(5));
    return w ? '"' + w.name + '" sessions' : 'those sessions';
  }

  function rangeSessions() {
    const range = C.rangeById(view.range);
    return App.Store.sessionsBetween(U.daysAgo(range.days), U.today())
      .slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  /**
   * The window of the same length immediately before this one. Tapping a muscle
   * should say more than "18%" — the useful question is whether that is more or
   * less than it used to be, and the honest baseline is the previous period.
   */
  function priorRangeSessions() {
    const range = C.rangeById(view.range);
    if (!range.days) return [];
    return App.Store.sessionsBetween(U.daysAgo(range.days * 2), U.daysAgo(range.days))
      .slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  /* ===========================================================================
     OVERVIEW
     ======================================================================== */

  function drawOverview() {
    const sessions = rangeSessions();
    const units = App.Store.getSettings().units;

    if (!sessions.length) {
      root.appendChild(U.h('.card', [
        U.h('.empty', [
          U.h('div', { html: U.icon('chart') }),
          U.h('.empty-title', 'No sessions in this period'),
          U.h('p', 'Widen the range, or log a workout to start building the picture.')
        ])
      ]));
      return;
    }

    let volume = 0, sets = 0, reps = 0, time = 0;
    sessions.forEach(function (s) {
      time += s.durationSec || 0;
      (s.entries || []).forEach(function (en) {
        volume += App.Ranks.volumeOf(en.sets);
        sets += (en.sets || []).length;
        (en.sets || []).forEach(function (x) { reps += Number(x.reps) || 0; });
      });
    });

    root.appendChild(U.h('.grid.grid-4', [
      C.statTile('Sessions', sessions.length, ''),
      C.statTile('Total volume', U.compact(volume), units),
      C.statTile('Working sets', U.compact(sets), ''),
      C.statTile('Time under the bar', U.dur(time), '')
    ]));

    /* --- volume over time ---
       Filtered by kind of session, because one line through everything answers
       a question nobody asked. Push volume and leg volume move for different
       reasons and on different weeks, and averaged together they hide each
       other: a leg day cut short reads as a flat month rather than as the thing
       that actually happened. */
    normaliseLoadFilter(sessions);
    const loadSessions = sessions.filter(passesLoadFilter);
    const volEl = U.h('div');
    root.appendChild(U.h('.card', [
      U.h('.card-head', [
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('h2', 'Training load'),
          U.h('.card-sub', { text: 'Per session across ' + loadFilterLabel() +
            ', with the trend line through it.' })
        ]),
        U.h('.spacer'),
        loadFilterSelect(sessions),
        U.h('select.select.input-sm', {
          style: { width: 'auto' }, 'aria-label': 'Metric',
          onchange: function () { view.metric = this.value; draw(); }
        }, [
          U.h('option', { value: 'volume', selected: view.metric === 'volume' }, 'Volume'),
          U.h('option', { value: 'sets', selected: view.metric === 'sets' }, 'Sets'),
          U.h('option', { value: 'reps', selected: view.metric === 'reps' }, 'Reps'),
          U.h('option', { value: 'duration', selected: view.metric === 'duration' }, 'Duration')
        ])
      ]),
      loadSessions.length
        ? volEl
        : U.h('.empty', [
            U.h('.empty-title', 'No sessions of that kind in this period'),
            U.h('p', 'Widen the range, or set the filter back to every session.'),
            U.h('button.btn.btn-sm', { type: 'button', text: 'Show every session',
              onclick: function () { view.load = 'all'; draw(); } })
          ])
    ]));

    if (!loadSessions.length) { drawDistribution(sessions); return; }

    const points = loadSessions.map(function (s) {
      let v = 0;
      if (view.metric === 'duration') v = (s.durationSec || 0) / 60;
      else {
        (s.entries || []).forEach(function (en) {
          if (view.metric === 'volume') v += App.Ranks.volumeOf(en.sets);
          else if (view.metric === 'sets') v += (en.sets || []).length;
          else (en.sets || []).forEach(function (x) { v += Number(x.reps) || 0; });
        });
      }
      return { x: new Date(s.date + 'T12:00:00').getTime(), y: v };
    });

    const fit = App.Charts.regress(points);
    setTimeout(function () {
      const series = [{ name: 'Per session', accent: true, area: true, points: points }];
      if (fit && points.length >= 3) {
        series.push({
          name: 'Trend', dash: true, dots: false,
          points: [
            { x: points[0].x, y: fit.at(points[0].x) },
            { x: points[points.length - 1].x, y: fit.at(points[points.length - 1].x) }
          ]
        });
      }
      App.Charts.line(volEl, {
        xType: 'date', height: 240, series: series,
        yMin: 0,
        yFormat: function (v) {
          return view.metric === 'duration' ? U.num(v, 0) + 'm' : U.compact(v);
        }
      });
    }, 0);

    drawDistribution(sessions);
  }

  /* Everything below the training-load chart, which always describes the WHOLE
     range: the filter narrows one question, not the page. */
  function drawDistribution(sessions) {
    const heat = App.Store.sessionsHeat(sessions);
    const priorHeat = App.Store.sessionsHeat(priorRangeSessions());
    const groups = App.Muscles.groupAverages(heat);

    root.appendChild(U.h('.grid.grid-main', [
      U.h('.card', [
        U.h('.card-head', [
          U.h('div', [
            U.h('h2', 'Where the work landed'),
            U.h('.card-sub', '100% is a full week of the training a muscle needs at ' +
              'your bodyweight — averaged over the weeks you actually trained, ' +
              'not spread across the whole range. Tap one for its share.')
          ])
        ]),
        C.heatPanel(heat, { limit: 12, compare: priorHeat })
      ]),
      U.h('.stack', [
        U.h('.card', [
          U.h('.card-head', [
            U.h('div', [
              U.h('h2', 'By muscle group'),
              U.h('.card-sub', 'Averaged across each group, against a week’s work.')
            ])
          ]),
          groupBars(groups)
        ]),
        U.h('.card', [
          U.h('.card-head', [U.h('h2', 'Weekly frequency')]),
          weekdayCard(sessions)
        ])
      ])
    ]));

    /* --- session table --- */
    root.appendChild(U.h('.card', [
      U.h('.card-head', [U.h('h2', 'Every session in range')]),
      sessionTable(sessions.slice().reverse())
    ]));
  }

  /**
   * The training-load filter.
   *
   * Both lists are built from the sessions actually in range rather than from
   * everything that exists, so the menu can only ever offer a choice that has
   * something behind it — picking one and landing on an empty chart is the
   * failure this is meant to avoid. Each option carries its own count for the
   * same reason.
   */
  function loadFilterSelect(sessions) {
    const plans = Object.create(null);
    const types = Object.create(null);
    sessions.forEach(function (s) {
      if (s.workoutId) plans[s.workoutId] = (plans[s.workoutId] || 0) + 1;
      const t = sessionType(s);
      types[t] = (types[t] || 0) + 1;
    });

    const sel = U.h('select.select.input-sm', {
      style: { width: 'auto' }, 'aria-label': 'Filter training load by session type',
      onchange: function () { view.load = this.value; draw(); }
    }, [U.h('option', { value: 'all', selected: view.load === 'all' },
      'All sessions (' + sessions.length + ')')]);

    const typeKeys = Object.keys(types).sort();
    if (typeKeys.length > 1) {
      const g = U.h('optgroup', { label: 'By session type' });
      typeKeys.forEach(function (t) {
        g.appendChild(U.h('option', { value: 'type:' + t,
          selected: view.load === 'type:' + t }, t + ' (' + types[t] + ')'));
      });
      sel.appendChild(g);
    }

    const planKeys = Object.keys(plans);
    if (planKeys.length) {
      const g = U.h('optgroup', { label: 'By workout plan' });
      planKeys.map(function (id) {
        const w = App.Store.getWorkout(id);
        return { id: id, name: w ? w.name : 'Deleted workout', n: plans[id] };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); })
        .forEach(function (p) {
          g.appendChild(U.h('option', { value: 'plan:' + p.id,
            selected: view.load === 'plan:' + p.id }, p.name + ' (' + p.n + ')'));
        });
      sel.appendChild(g);
    }

    return sel;
  }

  /**
   * A filter chosen over a wide range can have nothing behind it in a narrow
   * one — pick "Leg day", shorten the range to 7 days, and the selection now
   * names a set that is empty. Reset it to everything BEFORE the chart is
   * built, not while the menu is being drawn: by then the chart has already
   * been computed against the filter that is about to be discarded.
   */
  function normaliseLoadFilter(sessions) {
    if (!view.load || view.load === 'all') return;
    const ok = sessions.some(passesLoadFilter);
    if (!ok) view.load = 'all';
  }

  function groupBars(groups) {
    const el = U.h('div');
    const data = Object.keys(App.Muscles.GROUPS)
      .map(function (g) { return { label: App.Muscles.GROUPS[g].name, value: groups[g] || 0 }; })
      .filter(function (d) { return d.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    setTimeout(function () {
      App.Charts.bars(el, { data: data, horizontal: true,
        yFormat: function (v) { return U.num(v, 0) + '%'; } });
    }, 0);
    return el;
  }

  function weekdayCard(sessions) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    sessions.forEach(function (s) {
      counts[new Date(s.date + 'T12:00:00').getDay()]++;
    });
    const el = U.h('div');
    setTimeout(function () {
      App.Charts.bars(el, {
        height: 150,
        data: names.map(function (n, i) { return { label: n, value: counts[i] }; }),
        yFormat: function (v) { return U.num(v, 0); }
      });
    }, 0);
    return el;
  }

  function sessionTable(sessions) {
    const units = App.Store.getSettings().units;
    return U.h('.table-wrap', [U.h('table.tbl', [
      U.h('thead', [U.h('tr', [
        U.h('th', 'Date'), U.h('th', 'Session'), U.h('th.num', 'Volume'),
        U.h('th.num', 'Sets'), U.h('th.num', 'Duration'), U.h('th', 'Muscles'),
        U.h('th.shrink', '')
      ])]),
      U.h('tbody', sessions.map(function (s) {
        let vol = 0, sets = 0;
        (s.entries || []).forEach(function (en) {
          vol += App.Ranks.volumeOf(en.sets);
          sets += (en.sets || []).length;
        });
        return U.h('tr', [
          U.h('td.u-nowrap', { text: U.fmtDate(s.date) }),
          U.h('td', { text: s.name || 'Session' }),
          U.h('td.num', { text: U.compact(vol) + ' ' + units }),
          U.h('td.num', { text: String(sets) }),
          U.h('td.num', { text: s.durationSec ? U.dur(s.durationSec) : '—' }),
          U.h('td', [C.heatStrip(App.Store.sessionsHeat([s]), { absolute: true })]),
          U.h('td.shrink', [
            U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
              type: 'button', 'aria-label': 'Delete session', html: U.icon('trash'),
              onclick: function () {
                U.confirm({ title: 'Delete this session?',
                  message: U.fmtDate(s.date) + ' · ' + (s.name || 'Session'),
                  confirmLabel: 'Delete', danger: true }).then(function (ok) {
                  if (ok) App.Store.deleteSession(s.id);
                });
              }
            })
          ])
        ]);
      }))
    ])]);
  }

  /* ===========================================================================
     RECORDS
     ======================================================================== */

  function drawRecords() {
    const prs = App.Store.personalRecords();
    const units = App.Store.getSettings().units;

    if (!prs.length) {
      root.appendChild(U.h('.card', [
        U.h('.empty', [
          U.h('div', { html: U.icon('trophy') }),
          U.h('.empty-title', 'No records yet'),
          U.h('p', 'Log a session with weight and reps and your estimated one-rep ' +
            'maxes appear here, ranked.')
        ])
      ]));
      return;
    }

    const rank = App.Store.rank();
    const byScore = Object.create(null);
    rank.scored.forEach(function (s) { byScore[s.exerciseId] = s.score; });

    root.appendChild(U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Personal records'),
          U.h('.card-sub', 'Estimated one-rep max, best set ever recorded. ' +
            'Strength score is relative to a bodyweight-adjusted elite standard.')
        ])
      ]),
      U.h('.table-wrap', [U.h('table.tbl', [
        U.h('thead', [U.h('tr', [
          U.h('th', 'Movement'), U.h('th', 'Equipment'), U.h('th.num', 'Est. 1RM'),
          U.h('th.num', 'Score'), U.h('th', 'Set on'), U.h('th.shrink', 'Trend')
        ])]),
        U.h('tbody', prs.map(function (pr) {
          const hist = App.Store.exerciseHistory(pr.exerciseId);
          const score = byScore[pr.exerciseId];
          return U.h('tr', [
            U.h('td', [U.h('div', { style: { fontWeight: '560' }, text: pr.name })]),
            U.h('td.u-muted', { text: pr.exercise
              ? (App.Equipment[pr.exercise.equipment] || pr.exercise.equipment) : '—' }),
            U.h('td.num', { text: U.num(pr.e1rm, 0) + ' ' + units }),
            U.h('td.num', [
              score === undefined ? '—'
                : U.h('span.badge' + (score >= 85 ? '.badge-good' : ''),
                    { text: U.num(score, 0) })
            ]),
            U.h('td.u-nowrap.u-muted', { text: U.fmtDate(pr.date) + ' · ' + U.relDate(pr.date) }),
            U.h('td.shrink', {
              html: App.Charts.spark(hist.map(function (h) { return h.e1rm; }))
            })
          ]);
        }))
      ])])
    ]));
  }

  /* ===========================================================================
     FORECAST

     What this answers is "where will this lift be in a year", and the honest
     answer bends. The straight-line projection already in the app is fine over
     sixty days and dishonest over three hundred and sixty-five, because it
     assumes the last three months repeat forever. Strength does not work that
     way: the closer a lift gets to what a body of that size can do, the less
     each month adds, and the curve flattens.

     The ceiling used is the exercise's own world record, scaled allometrically
     to the lifter's bodyweight — the same number the ranks are already measured
     against, so the forecast and the rank cannot tell different stories. Both
     curves are drawn together on purpose: the gap between them at twelve months
     IS the diminishing return, and showing it is more useful than quietly
     replacing one number with a smaller one.
     ======================================================================== */

  const HORIZONS = [
    { days: 90, label: '3 months' },
    { days: 180, label: '6 months' },
    { days: 365, label: '12 months' }
  ];

  /** Every movement with enough logged history to fit a curve to. */
  function forecastable() {
    const out = [];
    App.Store.allExercises().forEach(function (ex) {
      const hist = App.Store.exerciseHistory(ex.id).filter(function (h) { return h.e1rm > 0; });
      if (hist.length >= 3) out.push({ ex: ex, hist: hist });
    });
    out.sort(function (a, b) { return b.hist.length - a.hist.length; });
    return out;
  }

  /**
   * The ceiling for a movement, in the units its sets are LOGGED in.
   *
   * `displayRecord` already halves a two-dumbbell record for someone who logs
   * one dumbbell, which is what makes it comparable with the history. The
   * bodyweight case needs one more step: the record for a pull-up is the
   * athlete plus whatever they hung off themselves, while the log only holds
   * the added weight, so the athlete has to come back off again.
   */
  function ceilingFor(ex, settings) {
    let c = App.Ranks.displayRecord(ex, settings.bodyweight, settings);
    if (ex.equipment === 'bodyweight') c -= settings.bodyweight;
    return c;
  }

  function drawForecast() {
    const settings = App.Store.getSettings();
    const units = settings.units;
    const candidates = forecastable();

    if (!candidates.length) {
      root.appendChild(U.h('.card', [
        U.h('.empty', [
          U.h('div', { html: U.icon('chart') }),
          U.h('.empty-title', 'Not enough history to project from'),
          U.h('p', 'A movement needs at least three logged sessions before a growth ' +
            'curve means anything. Keep logging and this fills in on its own.')
        ])
      ]));
      return;
    }

    if (!view.forecastEx || !candidates.some(function (c) { return c.ex.id === view.forecastEx; })) {
      view.forecastEx = candidates[0].ex.id;
    }
    const pick = candidates.find(function (c) { return c.ex.id === view.forecastEx; });
    const ex = pick.ex;
    const hist = pick.hist;

    /* --- controls --- */
    root.appendChild(U.h('.card', [
      U.h('.card-head', [
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('h2', 'Growth forecast'),
          U.h('.card-sub', 'Projected against the ceiling for your bodyweight, so it ' +
            'slows down the way real progress does.')
        ])
      ]),
      U.h('.row.row-wrap', [
        U.h('select.select.input-sm', {
          style: { width: 'auto', maxWidth: '100%' }, 'aria-label': 'Movement',
          onchange: function () { view.forecastEx = this.value; draw(); }
        }, candidates.map(function (c) {
          return U.h('option', { value: c.ex.id, selected: c.ex.id === view.forecastEx },
            c.ex.name + ' (' + c.hist.length + ' sessions)');
        })),
        U.h('.spacer'),
        U.h('.btn-group', { role: 'group', 'aria-label': 'Horizon' },
          HORIZONS.map(function (hz) {
            return U.h('button.btn.btn-sm' + (view.horizon === hz.days ? '.is-active' : ''), {
              type: 'button', text: hz.label,
              onclick: function () { view.horizon = hz.days; draw(); }
            });
          }))
      ])
    ]));

    const points = hist.map(function (h) {
      return { x: new Date(h.date + 'T12:00:00').getTime(), y: h.e1rm };
    });
    const ceiling = ceilingFor(ex, settings);
    const fit = App.Charts.saturating(points, ceiling);
    const linear = App.Charts.regress(points);

    const lastX = points[points.length - 1].x;
    const lastY = points[points.length - 1].y;
    const endX = lastX + view.horizon * 86400000;
    const horizonLabel = (HORIZONS.find(function (h) { return h.days === view.horizon; })
      || HORIZONS[2]).label;

    if (!fit || !fit.growing) {
      root.appendChild(U.h('.card', [
        U.h('.card-head', [U.h('h2', { text: ex.name })]),
        U.h('.callout.is-warn', [
          U.h('.callout-bar'),
          U.h('div', [
            U.h('div', [U.h('strong', 'No growth to project here yet.')]),
            U.h('.u-xs.u-muted', { style: { marginTop: '4px' },
              text: fit
                ? 'Across the sessions logged, this movement is flat or going ' +
                  'backwards. A curve fitted to that would only project the decline ' +
                  'forwards, which is a worse guess than no guess.'
                : 'Three sessions with a recorded load are needed before a curve can ' +
                  'be fitted.' })
          ])
        ])
      ]));
      return;
    }

    /* --- the two projections --- */
    const curve = [];
    const naive = [];
    const band = [];
    for (let i = 0; i <= 12; i++) {
      const x = lastX + ((endX - lastX) * i) / 12;
      const y = fit.at(x);
      curve.push({ x: x, y: y });
      if (linear) naive.push({ x: x, y: Math.max(0, linear.at(x)) });
      /* A projection widens with distance. The spread is a share of the gap
         still to be closed, so it narrows as the curve flattens — which is the
         same thing the curve itself is saying. */
      const gap = fit.ceiling - y;
      const spread = Math.max(gap * 0.14, y * 0.02) * (0.4 + i / 12);
      band.push({ x: x, lo: Math.max(0, y - spread), hi: Math.min(fit.ceiling, y + spread) });
    }

    const projected = fit.at(endX);
    const naiveEnd = linear ? Math.max(0, linear.at(endX)) : null;
    const gainPct = lastY ? ((projected - lastY) / lastY) * 100 : 0;

    root.appendChild(U.h('.grid.grid-4', [
      C.statTile('Now', U.num(lastY, 0), units),
      C.statTile('In ' + horizonLabel, U.num(projected, 0), units,
        { dir: projected > lastY ? 'up' : 'flat',
          text: (projected >= lastY ? '+' : '') + U.num(projected - lastY, 0) + ' ' + units }),
      C.statTile('Of the ceiling', U.num((projected / fit.ceiling) * 100, 0), '%',
        { dir: 'flat', text: 'now ' + U.num((lastY / fit.ceiling) * 100, 0) + '%' }),
      C.statTile('Half the gap in', fit.halfLifeDays < 3650
        ? U.num(fit.halfLifeDays / 30.4, 1) : '—', 'months')
    ]));

    const chartEl = U.h('div');
    root.appendChild(U.h('.card', [
      U.h('.card-head', [
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('h2', { class: 'u-truncate', text: ex.name }),
          U.h('.card-sub', { text: hist.length + ' logged sessions · ceiling ' +
            U.num(fit.ceiling, 0) + ' ' + units +
            App.Ranks.loadSuffix(ex, settings) })
        ])
      ]),
      chartEl
    ]));

    setTimeout(function () {
      const series = [
        { name: 'Logged', accent: true, points: points },
        { name: 'Forecast', dash: true, dots: false, points: curve }
      ];
      if (naive.length && naiveEnd !== null) {
        series.push({ name: 'If it stayed linear', dash: true, dots: false, points: naive });
      }
      App.Charts.line(chartEl, {
        xType: 'date', height: 280, series: series, bands: [{ points: band }],
        /* The ceiling is the thing the whole curve is bending towards, so the
           scale has to reach it — otherwise the one line that explains the
           shape is the one line dropped for being off the top. */
        yMin: 0, yMax: fit.ceiling,
        rules: [{ y: fit.ceiling, label: 'World-record ceiling for ' +
          settings.bodyweight + ' ' + units }],
        yFormat: function (v) { return U.compact(v) + units; }
      });
    }, 0);

    /* --- what the numbers mean --- */
    const overshoot = naiveEnd !== null ? naiveEnd - projected : 0;
    root.appendChild(U.h('.card', [
      U.h('.card-head', [U.h('h2', 'How this is worked out')]),
      U.h('.stack-sm', [
        U.h('.callout', [
          U.h('.callout-bar'),
          U.h('div', [
            U.h('div', [
              U.h('strong', 'Gains are modelled as a share of what is left, not a ' +
                'fixed amount per month. '),
              'On this fit you close half the remaining gap to the ceiling every ' +
              U.num(fit.halfLifeDays / 30.4, 1) + ' months, so each month adds less ' +
              'than the one before it.'
            ])
          ])
        ]),
        overshoot > 0.5 ? U.h('.callout.is-warn', [
          U.h('.callout-bar'),
          U.h('div', [
            U.h('div', [
              U.h('strong', 'A straight line would say ' + U.num(naiveEnd, 0) + ' ' +
                units + '. '),
              'That is ' + U.num(overshoot, 0) + ' ' + units + ' more than this ' +
              'forecast, and it is the whole reason for the curve: extrapolating ' +
              'recent progress in a straight line quietly assumes it never slows.'
            ])
          ])
        ]) : null,
        U.h('.callout' + (fit.r2 < 0.3 ? '.is-warn' : ''), [
          U.h('.callout-bar'),
          U.h('div', [
            U.h('div', [
              U.h('strong', 'Fitted over ' + fit.n + ' sessions · r² = ' +
                U.num(fit.r2, 2) + '. '),
              fit.r2 < 0.3
                ? 'That is a weak fit — the sessions are scattered enough that this ' +
                  'is a direction rather than a number. More history tightens it.'
                : 'The shaded band is the uncertainty, and it narrows as the curve ' +
                  'flattens because there is less room left to be wrong in.'
            ]),
            U.h('.u-xs.u-muted', { style: { marginTop: '6px' },
              text: 'The ceiling is this movement’s world record re-scaled to ' +
                settings.bodyweight + ' ' + units + ' — the same standard your rank ' +
                'is measured against. Set a truer record on the exercise itself and ' +
                'this curve follows it.' })
          ])
        ])
      ])
    ]));
  }

  /* ===========================================================================
     RANKS
     ======================================================================== */

  /* ---------------------------------------------------------------------------
     RANKING OVER TIME

     Points are a function of the sessions logged up to a moment, so a history
     is produced by recomputing the score with the sessions truncated at each
     sample date — not by storing a running total, which would be wrong the
     moment a past session was edited.

     Recomputing is O(sessions) per sample, so the range is sampled at a fixed
     number of points rather than daily; a year still costs 40 passes, not 365.
     ------------------------------------------------------------------------ */

  const RANK_SAMPLES = 40;

  /**
   * @param {Object[]} sessions   all sessions, any order
   * @param {Object}   exercises  id -> exercise
   * @param {number[]} stamps     sample times, ascending
   * @returns {Object[]} [{x, y}] — points at each sample
   */
  function pointsHistory(sessions, exercises, stamps, bodyweight, settings) {
    const dated = (sessions || []).map(function (s) {
      return { t: new Date(s.date + (s.date.length === 10 ? 'T12:00:00' : '')).getTime(), s: s };
    }).sort(function (a, b) { return a.t - b.t; });

    const out = [];
    let i = 0;
    const upTo = [];

    stamps.forEach(function (t) {
      while (i < dated.length && dated[i].t <= t) { upTo.push(dated[i].s); i++; }
      if (!upTo.length) { out.push({ x: t, y: 0 }); return; }
      const r = App.Ranks.compute({
        sessions: upTo.slice(),
        exercises: exercises,
        bodyweight: bodyweight,
        settings: settings
      });
      out.push({ x: t, y: r.points });
    });

    return out;
  }

  function sampleStamps(days) {
    const end = Date.now();
    const span = Math.max(1, days) * 86400000;
    const start = end - span;
    const n = Math.min(RANK_SAMPLES, Math.max(6, Math.ceil(days / 3)));
    const out = [];
    for (let i = 0; i < n; i++) out.push(Math.round(start + (span * i) / (n - 1)));
    return out;
  }

  /** Rank thresholds inside the plotted range, as chart rules. */
  function rankRules(maxPoints) {
    return App.Ranks.RANKS.filter(function (x) { return x.wr > 0; })
      .map(function (x) {
        return { y: App.Ranks.pointsForRank(x), label: x.name, color: x.color };
      })
      .filter(function (r) { return r.y <= maxPoints * 1.15; });
  }

  function rankingCard() {
    const card = U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Ranking over time'),
          U.h('.card-sub', 'Points across the selected period, with each tier ' +
            'marked. Friends appear once their data has been read.')
        ])
      ])
    ]);

    const chartEl = U.h('.chart');
    const note = U.h('.u-xs.u-muted', { style: { marginTop: '8px' } });
    card.appendChild(chartEl);
    card.appendChild(note);

    const settings = App.Store.getSettings();
    const days = C.rangeById(view.range).days;
    const stamps = sampleStamps(days);
    const meName = settings.name || 'You';

    const series = [{
      name: meName,
      accent: true,
      points: pointsHistory(App.Store.allSessions(), App.Store.exerciseMap(),
        stamps, settings.bodyweight, settings)
    }];

    function paint() {
      const peak = series.reduce(function (m, s) {
        return s.points.reduce(function (n, p) { return Math.max(n, p.y); }, m);
      }, 0);
      App.Charts.line(chartEl, {
        xType: 'date',
        height: 260,
        yMin: 0,
        legend: true,
        yFormat: function (v) { return U.num(v, 0) + ' pts'; },
        rules: rankRules(peak),
        series: series.filter(function (s) { return s.points.length; })
      });
    }

    setTimeout(paint, 0);

    /* Friends are a network read, so the chart draws immediately with just the
       user's line and each friend is added as their data lands. One failing
       friend must not cost the others their line, so each is caught alone. */
    const load = friendCache ? Promise.resolve(friendCache) : App.Sync.listFriends();
    load.then(function (rows) {
      friendCache = rows;
      const friends = (rows || []).filter(function (f) { return f.status === 'accepted'; });
      if (!friends.length) {
        note.textContent = 'Add a friend in the Control Panel to compare rankings.';
        return;
      }

      note.textContent = 'Reading ' + friends.length + ' friend' +
        (friends.length === 1 ? '' : 's') + '…';
      let failed = 0;

      return Promise.all(friends.map(function (f) {
        return App.Sync.readFriendData(f.id, { since: U.daysAgo(days) })
          .then(function (data) {
            const name = f.display_name || f.handle;
            if (data && data.sessions && data.sessions.length) {
              series.push({
                name: name,
                points: pointsHistory(data.sessions, App.Store.exerciseMap(),
                  stamps, settings.bodyweight, settings)
              });
              return;
            }
            /* Only their published summary is readable — a single current
               value. Shown as a flat line, and said so, rather than implied
               to be a history they did not share. */
            const pts = data && data.profile && data.profile.stats &&
              data.profile.stats.points;
            if (pts > 0) {
              series.push({
                name: name + ' (now)', dash: true,
                points: stamps.map(function (t) { return { x: t, y: pts }; })
              });
            }
          })
          .catch(function () { failed++; });
      })).then(function () {
        paint();
        note.textContent = failed
          ? failed + ' friend' + (failed === 1 ? '' : 's') +
            ' could not be read — their data is private or their project is offline.'
          : '';
      });
    }).catch(function (err) {
      note.textContent = 'Friends could not be listed: ' + err.message;
    });

    return card;
  }

  function drawRanks() {
    const r = App.Store.rank();

    root.appendChild(rankingCard());

    root.appendChild(U.h('.grid.grid-main', [
      U.h('.card', [
        U.h('.card-head', [
          U.h('div', [
            U.h('h2', 'Rank'),
            U.h('.card-sub', 'Eight tiers, Wood to Diamond, measured against the world ' +
              'record for your bodyweight. Your rank is the AVERAGE across every ' +
              'movement you train.')
          ])
        ]),
        C.rankCard(r, { large: true })
      ]),
      U.h('.card', [
        U.h('.card-head', [U.h('h2', 'The ladder')]),
        U.h('.stack-sm', App.Ranks.RANKS.map(function (x) {
          const done = r.average >= x.wr;
          return U.h('.row', { style: { opacity: done ? '1' : '0.55' } }, [
            U.h('.rank-medal', {
              style: { '--rank-color': x.color, width: '36px', height: '36px',
                fontSize: 'var(--fs-xs)' },
              text: App.Ranks.initials(x)
            }),
            U.h('div', { style: { flex: 1, minWidth: 0 } }, [
              U.h('div', { style: { fontWeight: '580' },
                text: x.name + (x.elite ? ' · Elite' : '') }),
              U.h('.u-xs.u-muted', { text: x.wr + '% of world record — averaged' })
            ]),
            done ? U.h('span.badge.badge-good', 'held')
                 : U.h('span.u-xs.u-muted', { text: '+' + U.num(x.wr - r.average, 1) + '%' })
          ]);
        }))
      ])
    ]));

    /* --- what is driving the score --- */
    root.appendChild(U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Distance from the world record'),
          U.h('.card-sub', '100% is the world record for that movement at ' +
            App.Store.getSettings().bodyweight + ' ' + App.Store.getSettings().units +
            '. Your rank is the average of these rows.')
        ])
      ]),
      r.scored.length ? U.h('.table-wrap', [U.h('table.tbl', [
        U.h('thead', [U.h('tr', [
          U.h('th', 'Movement'), U.h('th.num', 'Your 1RM'), U.h('th.num', 'World record'),
          U.h('th.num', '% WR'), U.h('th.bar-cell', '')
        ])]),
        U.h('tbody', r.scored.slice(0, 30).map(function (s) {
          const units = App.Store.getSettings().units;
          const isFloor = r.weakest && s.exerciseId === r.weakest.exerciseId;
          return U.h('tr', { style: s.rankBearing ? null : { opacity: '0.55' } }, [
            U.h('td', [
              U.h('div', { style: { fontWeight: isFloor ? '680' : '500' }, text: s.name }),
              isFloor
                ? U.h('.u-xs', { style: { color: 'var(--bad)' }, text: 'lowest — drags the average' })
                : (s.rankBearing ? null
                    : U.h('.u-xs.u-muted', 'not rank-bearing — no load recorded'))
            ]),
            U.h('td.num', { text: U.num(s.e1rm, 0) + ' ' + units }),
            /* Shown in the same terms the lift was logged in: for a per-hand
               dumbbell movement that is one dumbbell, not the pair. Printing
               the two-arm record beside a per-hand entry invites exactly the
               comparison that is wrong. */
            U.h('td.num.u-muted', [
              U.h('span', { text: U.num(s.displayRecord || s.record, 0) + ' ' + units }),
              s.loadMode === 'per-hand'
                ? U.h('.u-xs.u-muted', 'per side') : null
            ]),
            U.h('td.num', { text: U.num(s.score, 1) + '%' }),
            U.h('td.bar-cell', [
              U.h('.mlist-bar', [
                U.h('i.mlist-fill', {
                  style: { width: Math.min(100, s.score) + '%',
                    background: App.Anatomy.heatColor(s.score / 100) }
                })
              ])
            ])
          ]);
        }))
      ])]) : U.h('.empty', [U.h('p', 'Log some weighted sets to build a strength profile.')])
    ]));

    /* --- friend leaderboard --- */
    const lbEl = U.h('div');
    root.appendChild(U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Leaderboard'),
          U.h('.card-sub', 'You and everyone you are connected to.')
        ])
      ]),
      lbEl
    ]));
    renderLeaderboard(lbEl, r);
  }

  function renderLeaderboard(el, myRank) {
    if (!App.Sync.signedIn()) {
      el.appendChild(U.h('.empty', [
        U.h('div', { html: U.icon('users') }),
        U.h('.empty-title', 'Sign in to compare'),
        U.h('p', 'Create a free account in the Control Panel to add friends and see ' +
          'where you sit. Everything else works without one.'),
        U.h('a.btn.btn-sm', { href: '#/settings', text: 'Open the Control Panel' })
      ]));
      return;
    }
    el.appendChild(U.h('.row', [U.h('.spinner'), U.h('span.u-sm.u-muted', 'Loading…')]));

    App.Sync.leaderboard().then(function (rows) {
      U.clear(el);
      if (!rows || !rows.length) {
        el.appendChild(U.h('.empty', [U.h('p', 'No friends yet — add some in the Control Panel.')]));
        return;
      }
      el.appendChild(U.h('.table-wrap', [U.h('table.tbl', [
        U.h('thead', [U.h('tr', [
          U.h('th', '#'), U.h('th', 'Athlete'), U.h('th', 'Rank'), U.h('th.num', 'Points')
        ])]),
        U.h('tbody', rows.map(function (row, i) {
          const rk = App.Ranks.RANKS.find(function (x) { return x.id === row.rank_id; })
            || App.Ranks.RANKS[0];
          return U.h('tr', { style: row.is_self
            ? { background: 'color-mix(in srgb, var(--accent) 8%, transparent)' } : null }, [
            U.h('td.num.u-muted', { text: String(i + 1) }),
            U.h('td', [U.h('.row', [
              U.h('span', { text: row.avatar_emoji || '💪' }),
              U.h('div', [
                U.h('div', { style: { fontWeight: row.is_self ? '680' : '540' },
                  text: (row.display_name || row.handle) + (row.is_self ? ' (you)' : '') }),
                U.h('.u-xs.u-muted', { text: U.handle(row.handle) })
              ])
            ])]),
            U.h('td', [U.h('span.chip', { style: { color: rk.color,
              borderColor: rk.color }, text: rk.name })]),
            U.h('td.num', { text: U.num(row.rank_points, 0) })
          ]);
        }))
      ])]));
    }).catch(function (err) {
      U.clear(el);
      el.appendChild(U.h('.callout.is-bad', [
        U.h('.callout-bar'),
        U.h('div', { text: 'Could not load the leaderboard: ' + err.message })
      ]));
    });
  }

  /* ===========================================================================
     VS — friend comparison
     ======================================================================== */

  function drawVS() {
    if (!App.Sync.signedIn()) {
      root.appendChild(U.h('.card', [
        U.h('.empty', [
          U.h('div', { html: U.icon('users') }),
          U.h('.empty-title', 'Sign in to compare with friends'),
          U.h('p', 'The VS screen puts your numbers side by side with a friend\'s: ' +
            'volume, rank, records and a muscle-by-muscle split. It needs an account ' +
            'so the two apps can find each other.'),
          U.h('a.btn.btn-primary.btn-sm', { href: '#/settings',
            text: 'Set up an account' })
        ])
      ]));
      return;
    }

    const pickWrap = U.h('.card');
    const resultWrap = U.h('div');
    root.appendChild(pickWrap);
    root.appendChild(resultWrap);

    pickWrap.appendChild(U.h('.row', [U.h('.spinner'), U.h('span.u-sm.u-muted', 'Loading friends…')]));

    const load = friendCache ? Promise.resolve(friendCache) : App.Sync.listFriends();
    load.then(function (rows) {
      friendCache = rows;
      const friends = (rows || []).filter(function (r) { return r.status === 'accepted'; });
      U.clear(pickWrap);
      pickWrap.appendChild(U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Head to head'),
          U.h('.card-sub', 'Pick a friend to compare against.')
        ])
      ]));

      if (!friends.length) {
        pickWrap.appendChild(U.h('.empty', [
          U.h('.empty-title', 'No friends connected yet'),
          U.h('p', 'Add someone in the Control Panel and they will show up here.'),
          U.h('a.btn.btn-sm', { href: '#/settings', text: 'Add a friend' })
        ]));
        return;
      }

      pickWrap.appendChild(U.h('.tag-row', friends.map(function (f) {
        return U.h('button.chip.chip-btn', {
          type: 'button',
          text: (f.avatar_emoji || '💪') + '  ' + (f.display_name || f.handle),
          onclick: function () {
            pickWrap.querySelectorAll('.chip').forEach(function (c) {
              c.classList.remove('is-active');
            });
            this.classList.add('is-active');
            compare(resultWrap, f);
          }
        });
      })));
    }).catch(function (err) {
      U.clear(pickWrap);
      pickWrap.appendChild(U.h('.callout.is-bad', [
        U.h('.callout-bar'), U.h('div', { text: err.message })
      ]));
    });
  }

  function compare(el, friend) {
    U.clear(el);
    el.appendChild(U.h('.card', [
      U.h('.row', [U.h('.spinner'), U.h('span.u-sm.u-muted',
        'Reading ' + (friend.display_name || friend.handle) + '’s data…')])
    ]));

    const mine = App.Sync.publicStats();
    const theirsCached = friend.stats && friend.stats.points !== undefined ? friend.stats : null;

    App.Sync.readFriendData(friend.id).then(function (data) {
      const theirs = (data.profile && data.profile.stats) || theirsCached || {};
      renderCompare(el, mine, theirs, friend, data);
    }).catch(function (err) {
      if (theirsCached) {
        renderCompare(el, mine, theirsCached, friend, null);
        el.appendChild(U.h('.callout.is-warn', [
          U.h('.callout-bar'),
          U.h('div', { text: 'Showing their cached summary — a live read failed: ' + err.message })
        ]));
      } else {
        U.clear(el);
        el.appendChild(U.h('.card', [
          U.h('.empty', [
            U.h('.empty-title', 'Could not read their data'),
            U.h('p', { text: err.message })
          ])
        ]));
      }
    });
  }

  function renderCompare(el, mine, theirs, friend, live) {
    U.clear(el);
    const units = App.Store.getSettings().units;
    const meName = App.Store.getSettings().name || 'You';
    const themName = friend.display_name || friend.handle;

    const myRank = App.Ranks.RANKS.find(function (x) { return x.id === mine.rank; })
      || App.Ranks.RANKS[0];
    const theirRank = App.Ranks.RANKS.find(function (x) { return x.id === theirs.rank; })
      || App.Ranks.RANKS[0];

    el.appendChild(U.h('.card', [
      U.h('.vs-grid', [
        U.h('.vs-side', [
          U.h('.rank-medal.is-lg', { style: { '--rank-color': myRank.color, margin: '0 auto' },
            text: App.Ranks.initials(myRank) }),
          U.h('div', { style: { fontWeight: '680', marginTop: '8px' }, text: meName }),
          U.h('.u-xs.u-muted', { text: myRank.name + ' · ' + U.num(mine.points, 0) + ' pts' })
        ]),
        U.h('.vs-mark', 'VS'),
        U.h('.vs-side', [
          U.h('.rank-medal.is-lg', { style: { '--rank-color': theirRank.color, margin: '0 auto' },
            text: App.Ranks.initials(theirRank) }),
          U.h('div', { style: { fontWeight: '680', marginTop: '8px' }, text: themName }),
          U.h('.u-xs.u-muted', { text: theirRank.name + ' · ' + U.num(theirs.points || 0, 0) + ' pts' })
        ])
      ])
    ]));

    const rows = [
      ['Rank points', mine.points, theirs.points || 0, ''],
      ['Sessions · 28d', mine.sessions28, theirs.sessions28 || 0, ''],
      ['Volume · 28d', mine.volume28, theirs.volume28 || 0, units],
      ['Total sessions', mine.sessions, theirs.sessions || 0, ''],
      ['Lifetime volume', mine.totalVolume, theirs.totalVolume || 0, units],
      ['Strength index', (mine.indices || {}).strength || 0,
        (theirs.indices || {}).strength || 0, '/100'],
      ['Consistency', (mine.indices || {}).consistency || 0,
        (theirs.indices || {}).consistency || 0, '/100'],
      ['Balance', (mine.indices || {}).balance || 0,
        (theirs.indices || {}).balance || 0, '/100']
    ];

    el.appendChild(U.h('.card', [
      U.h('.card-head', [U.h('h2', 'Side by side')]),
      U.h('.stack', rows.map(function (r) {
        const a = Number(r[1]) || 0, b = Number(r[2]) || 0;
        const total = a + b || 1;
        return U.h('div', [
          U.h('.vs-bar', [
            U.h('span.u-right.u-mono.u-sm', { text: U.compact(a) + (r[3] ? ' ' + r[3] : '') }),
            U.h('.vs-label', { text: r[0] }),
            U.h('span.u-mono.u-sm', { text: U.compact(b) + (r[3] ? ' ' + r[3] : '') })
          ]),
          U.h('.vs-track', { style: { marginTop: '4px' } }, [
            U.h('i.l', { style: { width: ((a / total) * 50) + '%' } }),
            U.h('i.r', { style: { width: ((b / total) * 50) + '%' } })
          ])
        ]);
      }))
    ]));

    /* --- muscle split, side by side --- */
    const mineHeat = mine.heat || {};
    const theirHeat = theirs.heat || {};
    if (Object.keys(theirHeat).length || Object.keys(mineHeat).length) {
      const a = U.h('.anat-wrap'), b = U.h('.anat-wrap');
      el.appendChild(U.h('.grid.grid-2', [
        U.h('.card', [
          U.h('.card-head', [U.h('h2', { text: meName + ' · 28 days' })]), a
        ]),
        U.h('.card', [
          U.h('.card-head', [U.h('h2', { text: themName + ' · 28 days' })]), b
        ])
      ]));
      setTimeout(function () {
        App.Anatomy.render(a, mineHeat, { compact: true, compare: theirHeat, max: 100 });
        App.Anatomy.render(b, theirHeat, { compact: true, compare: mineHeat, max: 100 });
      }, 0);
    }

    /* --- top lifts --- */
    const myTop = mine.top || [];
    const theirTop = theirs.top || [];
    if (myTop.length || theirTop.length) {
      el.appendChild(U.h('.grid.grid-2', [
        topLiftCard(meName, myTop, units),
        topLiftCard(themName, theirTop, units)
      ]));
    }

    if (live && live.sessions && live.sessions.length) {
      el.appendChild(U.h('.callout.is-good', [
        U.h('.callout-bar'),
        U.h('div', [U.h('strong', 'Live read.'), ' Pulled ' + live.sessions.length +
          ' sessions straight from ' + themName + '’s own Supabase project.'])
      ]));
    }
  }

  function topLiftCard(name, top, units) {
    return U.h('.card', [
      U.h('.card-head', [U.h('h2', { text: name + ' · best lifts' })]),
      top.length ? U.h('.table-wrap', [U.h('table.tbl', [
        U.h('tbody', top.map(function (t) {
          return U.h('tr', [
            U.h('td', { class: 'u-truncate', text: t.name }),
            U.h('td.num', { text: U.num(t.e1rm, 0) + ' ' + units }),
            U.h('td.num.u-muted', { text: U.num(t.score, 0) })
          ]);
        }))
      ])]) : U.h('.empty', [U.h('p', 'No lifts shared yet.')])
    ]);
  }

  App.Pages = App.Pages || {};
  App.Pages.report = { render: render, onDataChange: onDataChange };
})(window.App = window.App || {});
