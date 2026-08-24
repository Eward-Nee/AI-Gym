/* =============================================================================
   pages/exercises.js — the movement library: browse, filter, add, edit, remove
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U, C = App.C;

  let root = null;
  const view = { query: '', group: 'all', equip: 'all', sort: 'name', onlyMine: false, selected: null };

  function render(el, params) {
    root = el;
    if (params && params[0]) view.selected = params[0];
    draw();
  }

  function onDataChange() { if (root && root.isConnected) draw(); }

  function draw() {
    const el = root;
    U.clear(el);

    App.Shell.setTopActions([
      U.h('button.btn.btn-sm', {
        type: 'button', html: U.icon('download') + '<span>Export</span>',
        onclick: exportLibrary
      }),
      U.h('button.btn.btn-primary.btn-sm', {
        type: 'button', html: U.icon('plus') + '<span>New exercise</span>',
        onclick: function () { C.editExercise(null, function (ex) { view.selected = ex.id; draw(); }); }
      })
    ]);

    el.appendChild(filterBar());
    el.appendChild(U.h('.grid.grid-main', [listCard(), detailCard()]));
  }

  /* ---------------------------------------------------------------------------
     FILTERS
     ------------------------------------------------------------------------ */

  function filterBar() {
    const search = U.h('input.input', {
      type: 'search', placeholder: 'Search by name or equipment…',
      value: view.query, autocomplete: 'off',
      oninput: U.debounce(function () { view.query = this.value; redrawList(); }, 140)
    });

    const searchWrap = U.h('.search', {
      style: { flex: '1', minWidth: '220px' }, html: U.icon('search')
    });
    searchWrap.appendChild(search);

    return U.h('.card', { style: { padding: 'var(--sp-4)' } }, [
      U.h('.row.row-wrap', [
        searchWrap,
        U.h('select.select.input-sm', {
          style: { width: 'auto' },
          onchange: function () { view.group = this.value; redrawList(); }
        }, [U.h('option', { value: 'all' }, 'All muscle groups')].concat(
          Object.keys(App.Muscles.GROUPS).map(function (g) {
            return U.h('option', { value: g, selected: view.group === g },
              App.Muscles.GROUPS[g].name);
          })
        )),
        U.h('select.select.input-sm', {
          style: { width: 'auto' },
          onchange: function () { view.equip = this.value; redrawList(); }
        }, [U.h('option', { value: 'all' }, 'All equipment')].concat(
          Object.keys(App.Equipment).map(function (k) {
            return U.h('option', { value: k, selected: view.equip === k }, App.Equipment[k]);
          })
        )),
        U.h('select.select.input-sm', {
          style: { width: 'auto' },
          onchange: function () { view.sort = this.value; redrawList(); }
        }, [
          U.h('option', { value: 'name', selected: view.sort === 'name' }, 'Sort: A–Z'),
          U.h('option', { value: 'recent', selected: view.sort === 'recent' }, 'Sort: recently used'),
          U.h('option', { value: 'volume', selected: view.sort === 'volume' }, 'Sort: most trained')
        ]),
        U.h('label.switch', [
          U.h('input', { type: 'checkbox', checked: view.onlyMine,
            onchange: function () { view.onlyMine = this.checked; redrawList(); } }),
          U.h('i.switch-track'),
          U.h('span.u-xs', 'Mine only')
        ])
      ])
    ]);
  }

  function matches(ex) {
    if (view.onlyMine && ex.builtin) return false;
    if (view.query) {
      const q = view.query.toLowerCase();
      if (ex.name.toLowerCase().indexOf(q) < 0 &&
          String(App.Equipment[ex.equipment] || '').toLowerCase().indexOf(q) < 0 &&
          String(ex.pattern).toLowerCase().indexOf(q) < 0) return false;
    }
    if (view.equip !== 'all' && ex.equipment !== view.equip) return false;
    if (view.group !== 'all') {
      const groups = App.Muscles.groupTotals(ex.muscles);
      if (!groups[view.group] || groups[view.group] < 15) return false;
    }
    return true;
  }

  function sortedList() {
    const usage = usageMap();
    const list = App.Store.allExercises().filter(matches);
    if (view.sort === 'recent') {
      list.sort(function (a, b) {
        const ua = usage[a.id], ub = usage[b.id];
        return (ub ? ub.last : '').localeCompare(ua ? ua.last : '') ||
          a.name.localeCompare(b.name);
      });
    } else if (view.sort === 'volume') {
      list.sort(function (a, b) {
        return ((usage[b.id] || {}).volume || 0) - ((usage[a.id] || {}).volume || 0) ||
          a.name.localeCompare(b.name);
      });
    } else {
      list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }
    return list;
  }

  function usageMap() {
    const m = Object.create(null);
    App.Store.allSessions().forEach(function (s) {
      (s.entries || []).forEach(function (en) {
        const r = m[en.exerciseId] || (m[en.exerciseId] = { volume: 0, sessions: 0, last: '' });
        r.volume += App.Ranks.volumeOf(en.sets);
        r.sessions++;
        if (s.date > r.last) r.last = s.date;
      });
    });
    return m;
  }

  /* ---------------------------------------------------------------------------
     LIST
     ------------------------------------------------------------------------ */

  let listBody = null;

  function listCard() {
    listBody = U.h('.stack-sm.list-scroll');
    const card = U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Movement library'),
          U.h('.card-sub#exCount', '')
        ])
      ]),
      listBody
    ]);
    setTimeout(redrawList, 0);
    return card;
  }

  function redrawList() {
    if (!listBody) return;
    const list = sortedList();
    const counter = U.$('#exCount');
    if (counter) {
      counter.textContent = list.length + ' of ' + App.Store.allExercises().length +
        ' movements' + (view.onlyMine ? ' · custom only' : '');
    }

    U.clear(listBody);
    if (!list.length) {
      listBody.appendChild(U.h('.empty', [
        U.h('div', { html: U.icon('search') }),
        U.h('.empty-title', 'Nothing matches'),
        U.h('p', 'Try clearing a filter, or create the movement yourself.'),
        U.h('button.btn.btn-sm', { type: 'button', text: 'Create it',
          onclick: function () { C.editExercise({ name: view.query }, function (ex) {
            view.selected = ex.id; draw(); }); } })
      ]));
      return;
    }

    const usage = usageMap();
    list.slice(0, 400).forEach(function (ex) {
      const u = usage[ex.id];
      const row = U.h('.ex-row' + (view.selected === ex.id ? '.is-sel' : ''), {
        dataset: { id: ex.id }, tabindex: '0', role: 'button',
        onclick: function () { select(ex.id); },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(ex.id); }
        }
      }, [
        C.exThumb(ex),
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('.ex-name', { text: ex.name }),
          U.h('.ex-meta', [
            U.h('span', { text: App.Equipment[ex.equipment] || ex.equipment }),
            U.h('span', { text: C.topMuscleLabel(ex) }),
            u ? U.h('span', { text: u.sessions + '× · ' + U.relDate(u.last) }) : null,
            ex.builtin ? null : U.h('span.badge', 'custom')
          ])
        ]),
        U.h('.row', { style: { gap: '8px' } }, [
          C.heatStrip(ex.muscles),
          U.h('.ex-actions', [
            U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
              type: 'button', 'aria-label': 'Edit ' + ex.name, html: U.icon('edit'),
              onclick: function (e) { e.stopPropagation(); C.editExercise(ex, function () { draw(); }); }
            }),
            U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
              type: 'button', 'aria-label': 'Delete ' + ex.name, html: U.icon('trash'),
              onclick: function (e) { e.stopPropagation(); removeExercise(ex); }
            })
          ])
        ])
      ]);
      listBody.appendChild(row);
    });

    if (list.length > 400) {
      listBody.appendChild(U.h('.u-xs.u-muted.u-center', { style: { padding: '12px' },
        text: 'Showing 400 of ' + list.length + ' — narrow the search to see the rest.' }));
    }
  }

  function select(id) {
    view.selected = id;
    U.$$('.ex-row', root).forEach(function (r) {
      r.classList.toggle('is-sel', r.dataset.id === id);
    });
    redrawDetail();
  }

  /* ---------------------------------------------------------------------------
     DETAIL
     ------------------------------------------------------------------------ */

  let detailEl = null;

  function detailCard() {
    detailEl = U.h('.stack');
    setTimeout(redrawDetail, 0);
    return detailEl;
  }

  function redrawDetail() {
    if (!detailEl) return;
    U.clear(detailEl);

    const ex = view.selected ? App.Store.getExercise(view.selected) : null;
    if (!ex) {
      detailEl.appendChild(U.h('.card', [
        U.h('.empty', [
          U.h('div', { html: U.icon('dumbbell') }),
          U.h('.empty-title', 'Pick a movement'),
          U.h('p', 'Select an exercise to see exactly which muscles it loads, ' +
            'and how hard each one works.')
        ])
      ]));
      return;
    }

    const heat = App.Store.exerciseHeat(ex);
    const hist = App.Store.exerciseHistory(ex.id);
    const units = App.Store.getSettings().units;

    const figWrap = U.h('.anat-wrap');
    setTimeout(function () { App.Anatomy.render(figWrap, heat, { compact: false }); }, 0);

    detailEl.appendChild(U.h('.card', [
      U.h('.card-head', [
        C.exThumb(ex),
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('h2', { class: 'u-truncate', text: ex.name }),
          U.h('.card-sub', { text: (App.Equipment[ex.equipment] || ex.equipment) + ' · ' +
            String(ex.pattern).replace(/-/g, ' ') + (ex.unilateral ? ' · unilateral' : '') })
        ]),
        U.h('.spacer'),
        U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
          type: 'button', 'aria-label': 'Edit', html: U.icon('edit'),
          onclick: function () { C.editExercise(ex, function () { draw(); }); }
        }),
        U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
          type: 'button', 'aria-label': 'Delete', html: U.icon('trash'),
          onclick: function () { removeExercise(ex); }
        })
      ]),
      figWrap,
      U.h('.label', { style: { marginTop: '14px' } }, 'Muscle involvement'),
      C.muscleList(heat, 12),
      ex.notes ? U.h('p.u-sm.u-muted', { style: { marginTop: '12px' }, text: ex.notes }) : null
    ]));

    if (hist.length) {
      const best = hist.reduce(function (a, b) { return b.e1rm > a.e1rm ? b : a; });
      const chartEl = U.h('.chart');
      detailEl.appendChild(U.h('.card', [
        U.h('.card-head', [U.h('h2', 'Your progress')]),
        U.h('.grid.grid-2', { style: { marginBottom: '12px' } }, [
          C.statTile('Best est. 1RM', U.num(best.e1rm, 0), units),
          C.statTile('Times trained', hist.length, '')
        ]),
        chartEl
      ]));
      setTimeout(function () {
        App.Charts.line(chartEl, {
          xType: 'date',
          height: 180,
          yFormat: function (v) { return U.compact(v) + units; },
          series: [{
            name: 'Est. 1RM', accent: true, area: true,
            points: hist.map(function (p) {
              return { x: new Date(p.date + 'T12:00:00').getTime(), y: p.e1rm };
            })
          }]
        });
      }, 0);
    } else {
      detailEl.appendChild(U.h('.card', [
        U.h('.empty', [
          U.h('.empty-title', 'Not logged yet'),
          U.h('p', 'Once you train this movement, its estimated 1RM curve appears here.')
        ])
      ]));
    }
  }

  /* ---------------------------------------------------------------------------
     ACTIONS
     ------------------------------------------------------------------------ */

  function removeExercise(ex) {
    const used = App.Store.allWorkouts().filter(function (w) {
      return (w.items || []).some(function (it) { return it.exerciseId === ex.id; });
    });
    U.confirm({
      title: 'Delete "' + ex.name + '"?',
      message: used.length
        ? 'It is used in ' + used.length + ' workout' + (used.length > 1 ? 's' : '') +
          ' and will be removed from ' + (used.length > 1 ? 'them' : 'it') +
          '. Logged history is kept.'
        : 'Logged history that references it is kept, but the movement disappears from the library.',
      confirmLabel: 'Delete',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      App.Store.deleteExercise(ex.id).then(function () {
        if (view.selected === ex.id) view.selected = null;
        U.toast('Deleted', ex.name);
        draw();
      });
    });
  }

  function exportLibrary() {
    const custom = App.Store.allExercises().filter(function (e) { return !e.builtin; });
    U.download('ai-gym-exercises-' + U.today() + '.json', JSON.stringify({
      format: 'ai-gym/exercises',
      exportedAt: new Date().toISOString(),
      exercises: custom.length ? custom : App.Store.allExercises()
    }, null, 2));
    U.toast('Exported', (custom.length || App.Store.allExercises().length) + ' exercises');
  }

  App.Pages = App.Pages || {};
  App.Pages.exercises = { render: render, onDataChange: onDataChange };
})(window.App = window.App || {});
