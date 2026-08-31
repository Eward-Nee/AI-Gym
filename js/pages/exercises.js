/* =============================================================================
   pages/exercises.js — the exercise list: browse, filter, add, edit, remove
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

  /* ---------------------------------------------------------------------------
     REVEALING A MOVEMENT

     Creating an exercise used to leave you wherever you were, with the new
     movement somewhere in a list of nearly five hundred. This brings the
     library up with the search already holding the exact name, which is both
     the fastest way to see what was just made and the state you would have had
     to type out by hand otherwise.

     The group and equipment filters are cleared as well. Prefilling the search
     but leaving a filter in place that excludes the very movement being
     revealed would produce an empty list, which is the opposite of the point.
     ------------------------------------------------------------------------ */
  function reveal(ex) {
    view.query = ex ? ex.name : '';
    view.group = 'all';
    view.equip = 'all';
    view.selected = ex ? ex.id : null;

    if (/^#\/exercises/.test(location.hash || '')) {
      if (root && root.isConnected) draw();
    } else {
      App.Shell.navigate('exercises');
    }
  }

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
        onclick: function () { C.editExercise(null); }
      })
    ]);

    el.appendChild(filterBar());
    el.appendChild(U.h('.grid.grid-main', [listCard(), detailCard()]));
  }

  /* ---------------------------------------------------------------------------
     FILTERS
     ------------------------------------------------------------------------ */

  let searchEl = null;

  function filterBar() {
    const search = U.h('input.input', {
      type: 'search', placeholder: 'Search by name or equipment…',
      value: view.query, autocomplete: 'off',
      oninput: U.debounce(function () { view.query = this.value; redrawList(); }, 140)
    });
    searchEl = search;

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

     Every movement is listed, always. The old cap of 400 meant a library that
     had grown past it silently hid the newest entries — the ones most likely to
     be the user's own — and the only way to reach them was to filter, which is
     backwards: filtering is for narrowing a list you can already see.

     Rendering 500+ rows outright is what the cap was avoiding, so instead the
     list is windowed: only the rows near the viewport exist as DOM, with spacer
     elements standing in for the rest so the scrollbar stays honest. Scrolling
     swaps the window. Cost is flat no matter how large the library gets.
     ------------------------------------------------------------------------ */

  let listBody = null;

  function listCard() {
    listBody = U.h('.list-scroll.ex-list');
    const card = U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Exercises'),
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
      const total = App.Store.allExercises().length;
      counter.textContent = (list.length === total
        ? total + ' movements'
        : list.length + ' of ' + total + ' movements') +
        (view.onlyMine ? ' \u00b7 custom only' : '');
    }

    if (!list.length) {
      U.clear(listBody);
      listBody.appendChild(U.h('.empty', [
        U.h('div', { html: U.icon('search') }),
        U.h('.empty-title', 'Nothing matches'),
        U.h('p', 'Try clearing a filter, or create the movement yourself.'),
        U.h('button.btn.btn-sm', { type: 'button', text: 'Create it',
          onclick: function () { C.editExercise({ name: view.query }); } })
      ]));
      return;
    }

    const usage = usageMap();
    /* Reveal the selection if it is outside the window \u2014 a deep link or a
       freshly created movement must not land on an apparently empty list. */
    const sel = view.selected
      ? list.findIndex(function (x) { return x.id === view.selected; }) : -1;

    U.virtualList(listBody, list, U.rowStride(listBody), function (ex) {
      return exRow(ex, usage);
    }, { scrollTo: sel >= 0 ? sel : null });
  }

  function exRow(ex, usage) {
    const u = usage[ex.id];
    return U.h('.ex-row' + (view.selected === ex.id ? '.is-sel' : ''), {
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
          /* Whether a movement is one limb or two is the difference between two
             different exercises with the same name, and it decides how the
             weight is scored — so it belongs on the row, not only in the
             detail panel two taps away. */
          ex.unilateral ? U.h('span.badge', { text: 'unilateral',
            title: 'One limb at a time' }) : null,
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
  }

  function select(id) {
    view.selected = id;
    U.$$('.ex-row', root).forEach(function (r) {
      r.classList.toggle('is-sel', r.dataset.id === id);
    });
    redrawDetail();

    /* Once the detail panel stacks under the list it is off-screen, so a tap
       would look like nothing happened. Bring it into view on narrow layouts;
       side by side on desktop it is already visible, so leave the scroll alone.
       The offset is computed rather than left to scroll-margin so the panel
       always clears the sticky topbar whatever height it currently is. */
    if (window.matchMedia('(max-width: 1100px)').matches && detailEl) {
      requestAnimationFrame(function () {
        const bar = document.querySelector('.topbar');
        const offset = (bar ? bar.getBoundingClientRect().height : 0) + 8;
        const y = window.scrollY + detailEl.getBoundingClientRect().top - offset;
        window.scrollTo(0, Math.max(0, Math.round(y)));
      });
    }
  }

  /* ---------------------------------------------------------------------------
     DETAIL
     ------------------------------------------------------------------------ */

  let detailEl = null;

  function detailCard() {
    detailEl = U.h('.stack', { 'data-scroll-target': '' });
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
    App.Anatomy.reserve(figWrap, { compact: false });
    setTimeout(function () { App.Anatomy.render(figWrap, heat, { compact: false }); }, 0);

    detailEl.appendChild(U.h('.card', [
      U.h('.card-head', [
        C.exThumb(ex),
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('h2', { class: 'u-truncate', text: ex.name }),
          U.h('.card-sub', { text: (App.Equipment[ex.equipment] || ex.equipment) + ' · ' +
            String(ex.pattern).replace(/-/g, ' ') +
            /* "unilateral" on its own is jargon to most people reading it, and
               it is the one word here that changes how a logged weight is
               scored — so it says what it means. */
            (ex.unilateral
              ? ' · unilateral (one limb at a time)'
              : ' · bilateral (both limbs together)') })
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
          U.h('p', 'Once you train this movement, its estimated 1RM curve and its ' +
            'own load-to-reps table appear here.')
        ])
      ]));
    }

    const reps = repsCard(ex, units);
    if (reps) detailEl.appendChild(reps);
  }

  /* ---------------------------------------------------------------------------
     LOAD AND REPS

     The reps-to-failure curve, pointed at one movement and one lifter. It
     answers the question people actually plan in — "what do I put on the bar
     for eights?" — and it answers it with this movement's own curve, which is
     the part the classic percentage chart on the gym wall gets wrong.

     A leg press allows thirteen reps at 80% of a max where the general case
     allows eight. Handed the same chart, someone picking a weight for tens
     picks one they will finish four reps short of failure on, and wonders why
     their legs are not growing.

     The spread is shown because it is large and real: between two people with
     the same one-rep max, reps at the same load differ by an SD of two and a
     half at 80% and over four at 60%. The table is a starting point to be
     corrected by what actually happens, and it says so.
     ------------------------------------------------------------------------ */

  const REP_TARGETS = [1, 3, 5, 8, 10, 12, 15, 20, 25, 30];

  function repsCard(ex, units) {
    const reference = App.Store.referenceOneRM(ex.id);
    if (!(reference > 0)) return null;

    const profile = App.Science.profileFor(ex);
    const step = ex.equipment === 'bodyweight' ? 0 :
      (App.Store.getSettings().units === 'lb' ? 5 : 2.5);

    return U.h('.card', [
      U.h('.card-head', [U.h('div', [
        U.h('h2', 'Load and reps'),
        U.h('.card-sub', 'What each rep target costs on this movement, from ' +
          'your best estimated max of ' + U.num(App.Store.loggedLoad(reference, ex), 0) +
          ' ' + units + (ex.equipment === 'bodyweight' ? ' of system load' : '') +
          '. Built on the ' + (profile.id === 'legs'
            ? 'leg-press curve, which allows markedly more reps at the same ' +
              'fraction of a max than the general one'
            : 'general reps-to-failure curve') + '.')
      ])]),
      U.h('.table-wrap', [U.h('table.tbl', [
        U.h('thead', [U.h('tr', [
          U.h('th.num', 'Reps'),
          U.h('th.num', '% of max'),
          U.h('th.num', 'Load'),
          U.h('th', 'Expect')
        ])]),
        U.h('tbody', REP_TARGETS.map(function (r) {
          const pct = App.Science.percentForReps(r, profile);
          const raw = App.Store.loggedLoad(reference * pct / 100, ex);
          /* Rounded to something loadable, but never above the max itself —
             a single prescribed at 245 against a 244 max reads as an error. */
          const load = step
            ? Math.min(Math.round(raw / step) * step, App.Store.loggedLoad(reference, ex))
            : raw;
          const sd = App.Science.repsSD(pct);
          const lo = Math.max(1, Math.round(r - sd));
          const hi = Math.round(r + sd);
          return U.h('tr', [
            U.h('td.num', { text: String(r) }),
            U.h('td.num.u-muted', { text: U.num(pct, 0) + '%' }),
            U.h('td.num', { style: { fontWeight: '560' },
              text: load > 0 ? U.num(load, step >= 1 ? 0 : 1) + ' ' + units : 'bodyweight' }),
            U.h('td.u-sm.u-muted', { text: lo + '–' + hi + ' reps' })
          ]);
        }))
      ])]),
      U.h('p.u-xs.u-muted', { style: { marginTop: '10px' },
        text: 'The last column is the spread between people with the same max, ' +
          'not a margin of error in the load. Where your own sets land inside ' +
          'it is worth more than the table — log a set to failure and the ' +
          'estimate moves with you.' })
    ]);
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
        /* The search is almost always still holding the name of the thing that
           has just been deleted — most often because creating it put the name
           there in the first place. Leaving it would answer the delete with an
           empty list and a filter the user never typed, which reads as the
           whole library having disappeared. */
        clearSearch();
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

  function clearSearch() {
    view.query = '';
    if (searchEl && searchEl.isConnected) searchEl.value = '';
  }

  App.Pages = App.Pages || {};
  App.Pages.exercises = { render: render, onDataChange: onDataChange, reveal: reveal };
})(window.App = window.App || {});
