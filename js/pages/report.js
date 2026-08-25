/* =============================================================================
   pages/report.js — analysis, personal records, rankings, and friend VS
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U, C = App.C;

  let root = null;
  let tab = 'overview';
  const view = { range: '90', metric: 'volume' };
  let friendCache = null;

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'records', label: 'Records' },
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
      tab === 'overview' || tab === 'records'
        ? C.rangePicker(view.range, function (r) { view.range = r.id; draw(); })
        : null
    ]));

    if (tab === 'overview') drawOverview();
    else if (tab === 'records') drawRecords();
    else if (tab === 'ranks') drawRanks();
    else drawVS();
  }

  function rangeSessions() {
    const range = C.rangeById(view.range);
    return App.Store.sessionsBetween(U.daysAgo(range.days), U.today())
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

    /* --- volume over time --- */
    const volEl = U.h('div');
    root.appendChild(U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Training load'),
          U.h('.card-sub', 'Volume per session, with the trend line through it.')
        ]),
        U.h('.spacer'),
        U.h('select.select.input-sm', {
          style: { width: 'auto' },
          onchange: function () { view.metric = this.value; draw(); }
        }, [
          U.h('option', { value: 'volume', selected: view.metric === 'volume' }, 'Volume'),
          U.h('option', { value: 'sets', selected: view.metric === 'sets' }, 'Sets'),
          U.h('option', { value: 'reps', selected: view.metric === 'reps' }, 'Reps'),
          U.h('option', { value: 'duration', selected: view.metric === 'duration' }, 'Duration')
        ])
      ]),
      volEl
    ]));

    const points = sessions.map(function (s) {
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

    /* --- muscle distribution --- */
    const heat = App.Store.sessionsHeat(sessions);
    const groups = App.Muscles.groupTotals(heat);

    root.appendChild(U.h('.grid.grid-main', [
      U.h('.card', [
        U.h('.card-head', [
          U.h('div', [
            U.h('h2', 'Where the work landed'),
            U.h('.card-sub', 'Normalised so the hardest-worked muscle reads 100%.')
          ])
        ]),
        C.heatPanel(heat, { limit: 12 })
      ]),
      U.h('.stack', [
        U.h('.card', [
          U.h('.card-head', [U.h('h2', 'By muscle group')]),
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
          U.h('td', [C.heatStrip(App.Store.sessionsHeat([s]))]),
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
     RANKS
     ======================================================================== */

  function drawRanks() {
    const r = App.Store.rank();

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
            U.h('td.num.u-muted', { text: U.num(s.record, 0) + ' ' + units }),
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
                U.h('.u-xs.u-muted', { text: '@' + row.handle })
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
        App.Anatomy.render(a, mineHeat, { compact: true });
        App.Anatomy.render(b, theirHeat, { compact: true });
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
