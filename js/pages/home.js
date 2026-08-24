/* =============================================================================
   pages/home.js — dashboard: quick actions, 30-day heat, rank, recent activity
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U, C = App.C;
  let root = null;

  function render(el) {
    root = el;
    draw();
  }

  function onDataChange() { if (root && root.isConnected) draw(); }

  function draw() {
    const el = root;
    U.clear(el);
    App.Shell.setTopActions([
      U.h('button.btn.btn-sm', {
        type: 'button', html: U.icon('plus') + '<span>Exercise</span>',
        onclick: function () { C.editExercise(null, function () {}); }
      }),
      U.h('button.btn.btn-primary.btn-sm', {
        type: 'button', html: U.icon('play') + '<span>Start workout</span>',
        onclick: startWorkout
      })
    ]);

    const sessions = App.Store.allSessions();
    const last30 = App.Store.sessionsBetween(U.daysAgo(30), U.today());
    const heat = App.Store.sessionsHeat(last30);
    const rank = App.Store.rank();
    const settings = App.Store.getSettings();

    /* --- greeting + quick actions ---------------------------------------- */
    el.appendChild(U.h('.grid.grid-3', [
      quickAction('plus', 'Add an exercise',
        'Build a movement with its own muscle split and image.',
        function () { C.editExercise(null, function () {}); }),
      quickAction('play', 'Start a workout',
        App.Store.allWorkouts().length
          ? 'Log a session from one of your ' + App.Store.allWorkouts().length + ' plans.'
          : 'Create your first workout plan.',
        startWorkout),
      quickAction('chart', 'Open the report',
        'Progress, personal records, rankings and friend comparisons.',
        function () { App.Shell.navigate('report'); })
    ]));

    /* --- headline stats --------------------------------------------------- */
    const vol30 = last30.reduce(function (a, s) {
      return a + (s.entries || []).reduce(function (b, en) {
        return b + App.Ranks.volumeOf(en.sets); }, 0);
    }, 0);
    const prev30 = App.Store.sessionsBetween(U.daysAgo(60), U.daysAgo(31));
    const volPrev = prev30.reduce(function (a, s) {
      return a + (s.entries || []).reduce(function (b, en) {
        return b + App.Ranks.volumeOf(en.sets); }, 0);
    }, 0);
    const delta = volPrev ? ((vol30 - volPrev) / volPrev) * 100 : null;

    el.appendChild(U.h('.grid.grid-4', [
      C.statTile('Sessions · 30d', last30.length, '',
        prev30.length ? dirDelta(last30.length - prev30.length, ' vs prev') : null),
      C.statTile('Volume · 30d', U.compact(vol30), settings.units,
        delta === null ? null : dirDelta(delta, '%', true)),
      C.statTile('Streak', streak(sessions), 'days'),
      C.statTile('Movements logged', rank.breadth, '')
    ]));

    /* --- heat + rank ------------------------------------------------------ */
    el.appendChild(U.h('.grid.grid-main', [
      U.h('.card', [
        U.h('.card-head', [
          U.h('div', [
            U.h('h2', 'Last 30 days'),
            U.h('.card-sub', last30.length
              ? 'Where the work actually landed, across ' + last30.length + ' sessions.'
              : 'Log a session and this figure fills in.')
          ]),
          U.h('.spacer'),
          U.h('a.btn.btn-sm.btn-ghost', { href: '#/report',
            html: '<span>Full report</span>' + U.icon('chevron') })
        ]),
        Object.keys(heat).length
          ? C.heatPanel(heat, { limit: 10 })
          : U.h('.empty', [
              U.h('div', { html: U.icon('target') }),
              U.h('.empty-title', 'No training logged yet'),
              U.h('p', 'Start a workout and the front and back figures will show ' +
                'exactly which muscles carried the load.')
            ])
      ]),
      U.h('.stack', [
        U.h('.card', [
          U.h('.card-head', [U.h('h2', 'Your rank')]),
          C.rankCard(rank, { showIndices: false, showGate: false }),
          U.h('a.btn.btn-sm.btn-block', { href: '#/report/ranks',
            style: { marginTop: '14px' }, html: U.icon('trophy') + '<span>Rank detail</span>' })
        ]),
        nextUpCard()
      ])
    ]));

    /* --- recent sessions -------------------------------------------------- */
    el.appendChild(U.h('.card', [
      U.h('.card-head', [
        U.h('h2', 'Recent sessions'),
        U.h('.spacer'),
        sessions.length ? U.h('a.btn.btn-sm.btn-ghost', { href: '#/report',
          text: 'View all' }) : null
      ]),
      sessions.length ? recentTable(sessions.slice(0, 8))
        : U.h('.empty', [
            U.h('div', { html: U.icon('calendar') }),
            U.h('.empty-title', 'Nothing logged yet'),
            U.h('p', 'Your completed sessions will appear here with volume, ' +
              'duration and the muscles they hit.')
          ])
    ]));
  }

  function dirDelta(v, suffix, isPct) {
    const dir = v > 0.5 ? 'up' : v < -0.5 ? 'down' : 'flat';
    const sign = v > 0 ? '+' : '';
    return { dir: dir, text: sign + U.num(v, isPct ? 0 : 0) + (suffix || '') };
  }

  function quickAction(icon, title, sub, onClick) {
    return U.h('.card.card-link', { role: 'button', tabindex: '0',
      onclick: onClick,
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }
    }, [
      U.h('.row', [
        U.h('.brand-mark', { html: U.icon(icon), style: { background: 'var(--surface-2)',
          color: 'var(--accent)', border: '1px solid var(--line)' } }),
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('div', { style: { fontWeight: '620' }, text: title }),
          U.h('.u-xs.u-muted', { text: sub })
        ])
      ])
    ]);
  }

  /** Suggests the group that has had the least attention lately. */
  function nextUpCard() {
    const last14 = App.Store.sessionsBetween(U.daysAgo(14), U.today());
    const heat = App.Store.sessionsHeat(last14);
    const groups = App.Muscles.groupTotals(heat);
    const all = Object.keys(App.Muscles.GROUPS).filter(function (g) { return g !== 'neck'; });
    const ranked = all.map(function (g) { return { g: g, v: groups[g] || 0 }; })
      .sort(function (a, b) { return a.v - b.v; });

    if (!last14.length) {
      return U.h('.card', [
        U.h('.card-head', [U.h('h2', 'Getting started')]),
        U.h('.stack-sm', [
          U.h('p.u-sm.u-muted', 'Three steps and the whole app comes alive:'),
          stepLine('1', 'Browse the ' + App.Store.allExercises().length + ' built-in exercises'),
          stepLine('2', 'Build a workout from them'),
          stepLine('3', 'Log a session — charts and ranks follow automatically')
        ])
      ]);
    }

    return U.h('.card', [
      U.h('.card-head', [U.h('h2', 'Least trained · 14d')]),
      U.h('.mlist', ranked.slice(0, 4).map(function (r) {
        const max = ranked[ranked.length - 1].v || 1;
        return U.h('.mlist-row', [
          U.h('span.mlist-name', { text: App.Muscles.GROUPS[r.g].name }),
          U.h('span.mlist-pct', { text: U.num(r.v, 0) + '%' }),
          U.h('span.mlist-bar', [
            U.h('i.mlist-fill', { style: { width: ((r.v / max) * 100) + '%',
              background: App.Anatomy.heatColor(r.v / max) } })
          ])
        ]);
      }))
    ]);
  }

  function stepLine(n, text) {
    return U.h('.row', [
      U.h('.step-num', { text: n }),
      U.h('span.u-sm', { text: text })
    ]);
  }

  function recentTable(sessions) {
    const units = App.Store.getSettings().units;
    const tbl = U.h('table.tbl', [
      U.h('thead', [U.h('tr', [
        U.h('th', 'Session'),
        U.h('th', 'Date'),
        U.h('th.num', 'Volume'),
        U.h('th.num', 'Sets'),
        U.h('th.num', 'Time'),
        U.h('th', 'Focus'),
        U.h('th.shrink', '')
      ])]),
      U.h('tbody', sessions.map(function (s) {
        let vol = 0, sets = 0;
        (s.entries || []).forEach(function (en) {
          vol += App.Ranks.volumeOf(en.sets);
          sets += (en.sets || []).length;
        });
        const heat = App.Store.sessionsHeat([s]);
        const groups = App.Muscles.groupTotals(heat);
        const top = Object.keys(groups).sort(function (a, b) { return groups[b] - groups[a]; })[0];

        return U.h('tr', [
          U.h('td', [U.h('div', { style: { fontWeight: '560' },
            text: s.name || 'Session' })]),
          U.h('td.u-nowrap', [
            U.h('div', { text: U.fmtDate(s.date) }),
            U.h('.u-xs.u-muted', { text: U.relDate(s.date) })
          ]),
          U.h('td.num', { text: U.compact(vol) + ' ' + units }),
          U.h('td.num', { text: String(sets) }),
          U.h('td.num', { text: s.durationSec ? U.dur(s.durationSec) : '—' }),
          U.h('td', [top ? U.h('span.chip', { text: App.Muscles.GROUPS[top].name }) : '—']),
          U.h('td.shrink', [C.heatStrip(heat)])
        ]);
      }))
    ]);
    return U.h('.table-wrap', [tbl]);
  }

  /** Consecutive days ending today (or yesterday) with a logged session. */
  function streak(sessions) {
    if (!sessions.length) return 0;
    const days = new Set(sessions.map(function (s) { return s.date; }));
    let n = 0;
    const d = new Date();
    /* allow the streak to survive "not yet trained today" */
    if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
    for (;;) {
      const key = d.toISOString().slice(0, 10);
      if (!days.has(key)) break;
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /* ---------------------------------------------------------------------------
     START A WORKOUT
     ------------------------------------------------------------------------ */

  function startWorkout() {
    const workouts = App.Store.allWorkouts();
    if (!workouts.length) {
      U.toast('No workouts yet', 'Create one first — redirecting you now.');
      App.Shell.navigate('workouts');
      return;
    }
    U.modal({
      title: 'Start a workout',
      body: function (body) {
        body.appendChild(U.h('.stack-sm', workouts.map(function (w) {
          const st = App.Store.workoutStats(w);
          const split = App.Store.suggestSplit(w);
          return U.h('.ex-row', { role: 'button', tabindex: '0', onclick: function () {
            location.hash = '#/workouts/run/' + w.id;
            document.querySelectorAll('.modal-root').forEach(function (m) { m.remove(); });
          } }, [
            U.h('.ex-thumb', { html: U.icon('list') }),
            U.h('div', { style: { minWidth: 0 } }, [
              U.h('.ex-name', { text: w.name }),
              U.h('.ex-meta', [
                U.h('span', { text: (w.items || []).length + ' exercises' }),
                U.h('span', { text: st.sets + ' sets' }),
                U.h('span', { text: '~' + U.dur(st.estDurationSec) }),
                split ? U.h('span', { text: split.label }) : null
              ])
            ]),
            C.heatStrip(st.heat)
          ]);
        })));
      },
      actions: [{ label: 'Close' }]
    });
  }

  App.Pages = App.Pages || {};
  App.Pages.home = { render: render, onDataChange: onDataChange };
})(window.App = window.App || {});
