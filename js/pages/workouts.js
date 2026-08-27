/* =============================================================================
   pages/workouts.js — plans, the builder, the session runner, and the
   progression report that sits underneath them.

   Routes:  #/workouts            list
            #/workouts/edit/:id   builder
            #/workouts/run/:id    log a session
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U, C = App.C;

  let root = null;
  let mode = 'list';
  let currentId = null;
  const report = { range: '90', picks: [] };

  function render(el, params) {
    root = el;
    mode = (params && params[0]) || 'list';
    currentId = (params && params[1]) || null;
    draw();
  }

  function onDataChange() {
    /* The runner owns unsaved input, so never blow it away underneath the user. */
    if (mode === 'run') return;
    if (root && root.isConnected) draw();
  }

  function draw() {
    U.clear(root);
    if (mode === 'edit') return drawBuilder();
    if (mode === 'run') return drawRunner();
    drawList();
  }

  /* ===========================================================================
     LIST
     ======================================================================== */

  function drawList() {
    App.Shell.setTopActions([
      U.h('button.btn.btn-primary.btn-sm', {
        type: 'button', html: U.icon('plus') + '<span>New workout</span>',
        onclick: createWorkout
      })
    ]);

    const workouts = App.Store.allWorkouts();

    if (!workouts.length) {
      root.appendChild(U.h('.card', [
        U.h('.empty', [
          U.h('div', { html: U.icon('list') }),
          U.h('.empty-title', 'No workouts yet'),
          U.h('p', 'A workout is a list of movements with their sets, reps, load and ' +
            'rest. Build one and the app will show you exactly which muscles it trains ' +
            'before you ever lift.'),
          U.h('button.btn.btn-primary', { type: 'button', text: 'Create your first workout',
            onclick: createWorkout })
        ])
      ]));
    } else {
      /* One column, not the auto grid it used to be. Reordering by dragging
         only means anything if the list has a single axis to reorder along;
         in a wrapping two-column grid "above" and "before" stop being the same
         thing and the gesture has no honest answer. Phone-first, this was
         already one column at every width that matters. */
      const grid = U.h('.wo-list');
      workouts.forEach(function (w) { grid.appendChild(workoutCard(w)); });
      root.appendChild(grid);

      U.dragList(grid, {
        onReorder: function (from, to) {
          const ids = U.$$('[data-drag-item]', grid).map(function (n) { return n.dataset.id; });
          U.moveIn(ids, from, to);
          App.Store.reorderWorkouts(ids).then(function () {
            U.toast('Reordered', 'Your workout order is saved.');
          });
        }
      });
    }

    root.appendChild(progressReport());
  }

  function workoutCard(w) {
    const st = App.Store.workoutStats(w);
    const split = App.Store.suggestSplit(w);
    const units = App.Store.getSettings().units;
    const figWrap = U.h('.anat-wrap');
    App.Anatomy.reserve(figWrap, { compact: true });
    setTimeout(function () {
      App.Anatomy.render(figWrap, st.heat, { compact: true, legend: false });
    }, 0);

    return U.h('.card', { 'data-drag-item': '', dataset: { id: w.id } }, [
      U.h('.card-head', [
        U.h('span.wo-grip', { html: U.icon('grip'), 'data-grip': '', role: 'button',
          title: 'Drag to reorder', 'aria-label': 'Drag to reorder ' + w.name }),
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('h2', { class: 'u-truncate', text: w.name }),
          U.h('.card-sub', { text: (w.items || []).length + ' exercises · ' + st.sets +
            ' sets · ~' + U.dur(st.estDurationSec) })
        ]),
        U.h('.spacer'),
        split ? U.h('span.chip.chip-accent', { text: split.label }) : null
      ]),
      figWrap,
      U.h('.grid.grid-2', { style: { marginTop: '14px' } }, [
        C.statTile('Planned volume', U.compact(st.volume), units),
        C.statTile('Top est. 1RM', st.topE1RM ? U.num(st.topE1RM, 0) : '—', units)
      ]),
      U.h('.row', { style: { marginTop: '14px' } }, [
        U.h('button.btn.btn-primary.btn-sm', {
          type: 'button', html: U.icon('play') + '<span>Start</span>',
          onclick: function () { App.Shell.navigate('workouts/run/' + w.id); }
        }),
        U.h('button.btn.btn-sm', {
          type: 'button', html: U.icon('edit') + '<span>Edit</span>',
          onclick: function () { App.Shell.navigate('workouts/edit/' + w.id); }
        }),
        U.h('.spacer'),
        U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
          type: 'button', 'aria-label': 'Duplicate', title: 'Duplicate', html: U.icon('copy'),
          onclick: function () { duplicate(w); }
        }),
        U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
          type: 'button', 'aria-label': 'Delete', title: 'Delete', html: U.icon('trash'),
          onclick: function () { removeWorkout(w); }
        })
      ])
    ]);
  }

  function createWorkout() {
    App.Store.saveWorkout({ name: 'New workout', items: [] }).then(function (w) {
      App.Shell.navigate('workouts/edit/' + w.id);
    });
  }

  function duplicate(w) {
    const copy = JSON.parse(JSON.stringify(w));
    delete copy.id;
    copy.name = w.name + ' (copy)';
    copy.items = (copy.items || []).map(function (it) { return Object.assign({}, it, { id: undefined }); });
    App.Store.saveWorkout(copy).then(function () { U.toast('Duplicated', copy.name); });
  }

  function removeWorkout(w) {
    U.confirm({
      title: 'Delete "' + w.name + '"?',
      message: 'Sessions you already logged from this workout are kept.',
      confirmLabel: 'Delete', danger: true
    }).then(function (ok) {
      if (ok) App.Store.deleteWorkout(w.id).then(function () { U.toast('Deleted', w.name); });
    });
  }

  /* ===========================================================================
     BUILDER
     ======================================================================== */

  function drawBuilder() {
    const w = App.Store.getWorkout(currentId);
    if (!w) { App.Shell.navigate('workouts'); return; }

    const draft = JSON.parse(JSON.stringify(w));
    let grouping = 'none';

    App.Shell.setTopActions([
      U.h('button.btn.btn-sm', { type: 'button', text: 'Back to list',
        onclick: function () { App.Shell.navigate('workouts'); } }),
      U.h('button.btn.btn-primary.btn-sm', {
        type: 'button', html: U.icon('save') + '<span>Save</span>',
        onclick: save
      })
    ]);

    const itemsWrap = U.h('div');
    const statsWrap = U.h('.stack');

    function save() {
      App.Store.saveWorkout(draft).then(function () {
        U.toast('Saved', draft.name, 'good');
        App.Shell.navigate('workouts');
      });
    }

    function refreshStats() {
      U.clear(statsWrap);
      const st = App.Store.workoutStats(draft);
      const split = App.Store.suggestSplit(draft);
      const units = App.Store.getSettings().units;

      const figWrap = U.h('.anat-wrap');
      setTimeout(function () { App.Anatomy.render(figWrap, st.heat, { compact: false }); }, 0);

      statsWrap.appendChild(U.h('.card', [
        U.h('.card-head', [
          U.h('div', [
            U.h('h2', 'What this trains'),
            U.h('.card-sub', split ? split.label + ' · ' + st.chains.push + '% push / ' +
              st.chains.pull + '% pull / ' + st.chains.legs + '% legs' : 'Add exercises to see')
          ])
        ]),
        figWrap,
        U.h('.label', { style: { marginTop: '12px' } }, 'Muscle load'),
        C.muscleList(st.heat, 10)
      ]));

      statsWrap.appendChild(U.h('.card', [
        U.h('.card-head', [U.h('h2', 'Session estimate')]),
        U.h('.grid.grid-2', [
          C.statTile('Total volume', U.compact(st.volume), units),
          C.statTile('Working sets', st.sets, ''),
          C.statTile('Total reps', st.reps, ''),
          C.statTile('Duration', U.dur(st.estDurationSec), '')
        ]),
        st.perExercise.length ? U.h('div', { style: { marginTop: '14px' } }, [
          U.h('.label', { style: { marginBottom: '8px' } }, 'Estimated 1RM per movement'),
          U.h('.table-wrap', [U.h('table.tbl', [
            U.h('tbody', st.perExercise
              .filter(function (p) { return p.e1rm > 0; })
              .sort(function (a, b) { return b.e1rm - a.e1rm; })
              .map(function (p) {
                return U.h('tr', [
                  U.h('td', { class: 'u-truncate', text: p.exercise.name }),
                  U.h('td.num', { text: U.num(p.e1rm, 0) + ' ' + units }),
                  U.h('td.num.u-muted', { text: U.compact(p.volume) })
                ]);
              }))
          ])])
        ]) : null
      ]));
    }

    function refreshItems() {
      U.clear(itemsWrap);
      if (!draft.items.length) {
        itemsWrap.appendChild(U.h('.empty', [
          U.h('div', { html: U.icon('dumbbell') }),
          U.h('.empty-title', 'No exercises yet'),
          U.h('p', 'Add movements, then set the load, sets, reps and rest for each.')
        ]));
        return;
      }

      const groups = groupItems(draft.items, grouping);
      groups.forEach(function (g) {
        if (g.label) itemsWrap.appendChild(U.h('.group-head', [U.h('span', { text: g.label })]));
        g.items.forEach(function (it) { itemsWrap.appendChild(itemBlock(it)); });
      });

      U.dragList(itemsWrap, { onReorder: reorderItems });
    }

    /**
     * Reordering is resolved through the ids in the DOM, not through the two
     * indices the drag reports.
     *
     * Under "group by muscle group" the blocks on screen are in a different
     * order from `draft.items`, so index 3 on screen is not item 3 in the plan.
     * Reading the ids back in the order they now appear sidesteps that
     * entirely, and works the same whether grouping is on or off.
     *
     * The grouping is then switched off, because a plan that has been ordered
     * by hand and then re-sorted by a rule is not the plan that was just built.
     */
    function reorderItems(from, to) {
      const ids = U.$$('[data-drag-item]', itemsWrap).map(function (n) { return n.dataset.id; });
      U.moveIn(ids, from, to);

      const byId = Object.create(null);
      draft.items.forEach(function (it) { byId[it.id] = it; });
      const next = ids.map(function (id) { return byId[id]; }).filter(Boolean);
      /* Never lose an item to a stale id: keep anything the DOM did not name. */
      draft.items.forEach(function (it) { if (next.indexOf(it) < 0) next.push(it); });
      draft.items = next;

      setGrouping('none');
      refreshItems();
      scheduleRefresh();
    }

    function setGrouping(v) {
      grouping = v;
      const sel = U.$('#woGrouping');
      if (sel) sel.value = v;
    }

    function itemBlock(it) {
      const ex = App.Store.getExercise(it.exerciseId);
      const idx = draft.items.indexOf(it);

      const setsWrap = U.h('.stack-sm');

      function drawSets() {
        U.clear(setsWrap);
        setsWrap.appendChild(U.h('.set-grid', [
          U.h('span.label', ''),
          U.h('span.label', 'Weight'),
          U.h('span.label', 'Reps'),
          U.h('span.label', 'Rest (s)'),
          U.h('span.label', '')
        ]));

        it.sets.forEach(function (s, i) {
          setsWrap.appendChild(U.h('.set-grid', [
            U.h('span.set-idx', { text: String(i + 1) }),
            U.h('input.input.input-sm.input-num', {
              type: 'number', min: '0', step: '0.5', value: s.weight,
              'aria-label': 'Set ' + (i + 1) + ' weight',
              oninput: function () { s.weight = Number(this.value) || 0; scheduleRefresh(); }
            }),
            U.h('input.input.input-sm.input-num', {
              type: 'number', min: '0', step: '1', value: s.reps,
              'aria-label': 'Set ' + (i + 1) + ' reps',
              oninput: function () { s.reps = Number(this.value) || 0; scheduleRefresh(); }
            }),
            i === 0 ? U.h('input.input.input-sm.input-num', {
              type: 'number', min: '0', step: '5', value: it.restSets, inputmode: 'numeric',
              'aria-label': 'Rest between sets, in seconds',
              title: 'Seconds of rest between sets',
              oninput: function () { it.restSets = Number(this.value) || 0; scheduleRefresh(); }
            }) : U.h('span.u-xs.u-muted.u-center', { text: '↑' }),
            U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
              type: 'button', 'aria-label': 'Remove set', html: U.icon('x'),
              onclick: function () {
                if (it.sets.length <= 1) return;
                it.sets.splice(i, 1); drawSets(); scheduleRefresh();
              }
            })
          ]));
        });

        setsWrap.appendChild(U.h('.row', { style: { marginTop: '8px' } }, [
          U.h('button.btn.btn-sm', {
            type: 'button', html: U.icon('plus') + '<span>Add set</span>',
            onclick: function () {
              const last = it.sets[it.sets.length - 1] || { weight: 0, reps: 8 };
              it.sets.push({ weight: last.weight, reps: last.reps });
              drawSets(); scheduleRefresh();
            }
          }),
          U.h('.spacer'),
          U.h('span.u-xs.u-muted', 'Rest after exercise (s)'),
          U.h('input.input.input-sm.input-num', {
            type: 'number', min: '0', step: '15', value: it.restAfter, inputmode: 'numeric',
            style: { width: '80px' },
            'aria-label': 'Rest after this exercise, in seconds',
            title: 'Seconds of rest before the next exercise',
            oninput: function () { it.restAfter = Number(this.value) || 0; scheduleRefresh(); }
          })
        ]));
      }

      const block = U.h('.wo-block', { 'data-drag-item': '', dataset: { id: it.id } }, [
        /* Floats, not flex: the controls sit in the top-right corner and the
           name flows beside the thumbnail and then WRAPS UNDER them, so a long
           exercise name uses the full width of the block instead of being
           squeezed into whatever the buttons leave behind. Floated elements
           have to precede the flowing content in the DOM. */
        U.h('.wo-block-head.is-editable', [
          U.h('.wo-block-actions', [
            U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
              type: 'button', 'aria-label': 'Move up', title: 'Move up', html: U.icon('chevron'),
              style: { transform: 'rotate(-90deg)' },
              onclick: function () { moveItem(idx, -1); }
            }),
            U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
              type: 'button', 'aria-label': 'Move down', title: 'Move down', html: U.icon('chevron'),
              style: { transform: 'rotate(90deg)' },
              onclick: function () { moveItem(idx, 1); }
            }),
            U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
              type: 'button', 'aria-label': 'Remove exercise', title: 'Remove', html: U.icon('trash'),
              onclick: function () {
                draft.items = draft.items.filter(function (x) { return x.id !== it.id; });
                refreshItems(); scheduleRefresh();
              }
            })
          ]),
          U.h('span.wo-grip', { html: U.icon('grip'), 'data-grip': '',
            title: 'Drag to reorder', 'aria-label': 'Drag to reorder', role: 'button' }),
          C.exThumb(ex || {}),
          U.h('.wo-block-title', [
            U.h('.ex-name', { text: ex ? ex.name : 'Missing exercise' }),
            U.h('.ex-meta', [
              U.h('span', { text: ex ? (App.Equipment[ex.equipment] || ex.equipment) : '' }),
              U.h('span', { text: ex ? C.topMuscleLabel(ex) : '' }),
              ex ? C.heatStrip(ex.muscles) : null
            ])
          ])
        ]),
        U.h('.wo-block-body', [setsWrap])
      ]);

      drawSets();
      return block;
    }

    /* The up / down buttons stay. They are the keyboard and accessibility route
       to the same result, and they are what you want for a single nudge. */
    function moveItem(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= draft.items.length) return;
      const tmp = draft.items[i];
      draft.items[i] = draft.items[j];
      draft.items[j] = tmp;
      setGrouping('none');
      refreshItems(); scheduleRefresh();
    }

    const scheduleRefresh = U.debounce(refreshStats, 220);

    /* --- page layout --- */
    root.appendChild(U.h('.card', [
      U.h('.grid.grid-2', [
        U.h('.field', [
          U.h('label.label', 'Workout name'),
          U.h('input.input', { value: draft.name,
            oninput: function () { draft.name = this.value; } })
        ]),
        U.h('.field', [
          U.h('label.label', 'Smart grouping'),
          /* The id is what lets a hand reorder switch this back to "Keep my
             order" — otherwise the control keeps claiming a grouping that the
             list has just stopped obeying. */
          U.h('select.select#woGrouping', {
            onchange: function () { grouping = this.value; refreshItems(); }
          }, [
            U.h('option', { value: 'none' }, 'Keep my order'),
            U.h('option', { value: 'chain' }, 'Group by push / pull / legs / core'),
            U.h('option', { value: 'group' }, 'Group by muscle group'),
            U.h('option', { value: 'pattern' }, 'Group by movement pattern')
          ]),
          U.h('.hint', 'Grouping only reorders the view — press Save to keep it.')
        ])
      ])
    ]));

    root.appendChild(U.h('.grid.grid-main', [
      U.h('.card', [
        U.h('.card-head', [
          U.h('h2', 'Exercises'),
          U.h('.spacer'),
          U.h('button.btn.btn-sm', {
            type: 'button', html: U.icon('plus') + '<span>Add exercises</span>',
            onclick: function () {
              C.pickExercise({ multi: true, onPick: function (list) {
                list.forEach(function (ex) {
                  draft.items.push({
                    id: U.uid('it'), exerciseId: ex.id,
                    sets: [{ weight: 0, reps: 8 }, { weight: 0, reps: 8 }, { weight: 0, reps: 8 }],
                    restSets: App.Store.getSettings().restDefault,
                    restAfter: App.Store.getSettings().restBetweenExercises,
                    note: ''
                  });
                });
                refreshItems(); refreshStats();
              } });
            }
          })
        ]),
        itemsWrap
      ]),
      statsWrap
    ]));

    root.appendChild(U.h('.card', [
      U.h('.field', [
        U.h('label.label', 'Notes'),
        U.h('textarea.textarea', { value: draft.notes || '',
          placeholder: 'Warm-up, progression scheme, anything worth remembering.',
          oninput: function () { draft.notes = this.value; } })
      ])
    ]));

    refreshItems();
    refreshStats();
  }

  /** Reorders a copy of the item list for display. */
  function groupItems(items, mode) {
    if (mode === 'none') return [{ label: null, items: items }];
    const buckets = Object.create(null);
    /* For muscle-group mode the bucket key is the group id, so the configured
       order can be applied to it; the display name is resolved on the way out. */
    const byGroupId = mode === 'group';

    items.forEach(function (it) {
      const ex = App.Store.getExercise(it.exerciseId);
      let key = byGroupId ? '' : 'Other';
      if (ex) {
        if (mode === 'chain') {
          const split = App.Store.chainSplit({ items: [it] });
          key = Object.keys(split).sort(function (a, b) { return split[b] - split[a]; })[0];
          key = { push: 'Push', pull: 'Pull', legs: 'Legs', core: 'Core' }[key] || 'Other';
        } else if (byGroupId) {
          const g = App.Muscles.groupTotals(ex.muscles);
          key = Object.keys(g).sort(function (a, b) { return g[b] - g[a]; })[0] || '';
        } else {
          key = String(ex.pattern).replace(/-/g, ' ')
            .replace(/^./, function (c) { return c.toUpperCase(); });
        }
      }
      (buckets[key] = buckets[key] || []).push(it);
    });

    if (!byGroupId) {
      return Object.keys(buckets).sort().map(function (k) {
        return { label: k, items: buckets[k] };
      });
    }

    /* Muscle groups follow the user's configured order — a matching template
       if the day's groups are exactly one, the general order otherwise. */
    const keys = Object.keys(buckets);
    const known = keys.filter(function (k) { return k && App.Muscles.GROUPS[k]; });
    const ordered = App.Muscles.orderGroups(known, App.Store.getSettings().groupOrder);
    const rest = keys.filter(function (k) { return ordered.indexOf(k) < 0; });

    return ordered.concat(rest).map(function (k) {
      return {
        label: (App.Muscles.GROUPS[k] && App.Muscles.GROUPS[k].name) || 'Other',
        items: buckets[k]
      };
    });
  }

  /* ===========================================================================
     RUNNER — log a session
     ======================================================================== */

  /**
   * The runner has to survive a reload — an update taken mid-session must not
   * cost the user their sets. The live state is snapshotted to IndexedDB on
   * every edit, so this first looks for one belonging to this workout and, if
   * it is there, resumes from it instead of starting fresh.
   */
  function drawRunner() {
    const w = App.Store.getWorkout(currentId);
    if (!w) { App.Shell.navigate('workouts'); return; }

    U.clear(root);
    root.appendChild(U.h('.card', [
      U.h('.row', [U.h('.spinner'), U.h('span.u-sm.u-muted', 'Loading session…')])
    ]));

    App.Update.takeSnapshot().then(function (snap) {
      const resume = snap && snap.data && snap.data.kind === 'runner' &&
        snap.data.workoutId === w.id ? snap.data : null;
      U.clear(root);
      buildRunner(w, resume);
    });
  }

  function buildRunner(w, resume) {
    /* Resuming keeps the ORIGINAL start time, so the elapsed clock carries on
       rather than restarting from zero. */
    const startedAt = resume ? resume.startedAt : Date.now();
    const units = App.Store.getSettings().units;

    /* Prefill from the plan, and from the last time this workout was done. */
    const previous = App.Store.allSessions().find(function (s) { return s.workoutId === w.id; });
    const previousHeat = previous ? App.Store.sessionsHeat([previous]) : null;
    const session = resume ? resume.session : {
      workoutId: w.id,
      name: w.name,
      date: U.today(),
      entries: (w.items || []).map(function (it) {
        const prev = previous && (previous.entries || [])
          .find(function (e) { return e.exerciseId === it.exerciseId; });
        return {
          exerciseId: it.exerciseId,
          sets: it.sets.map(function (s, i) {
            const p = prev && prev.sets[i];
            return { weight: (p ? p.weight : s.weight) || 0,
                     reps: (p ? p.reps : s.reps) || 0, done: false };
          }),
          note: ''
        };
      })
    };

    /* Snapshot on every edit. Debounced because ticking through a set of ten
       should not mean ten writes. */
    App.Update.registerSnapshot(function () {
      return { kind: 'runner', workoutId: w.id, startedAt: startedAt, session: session };
    });
    const persist = U.debounce(function () { App.Update.saveSnapshot(); }, 400);

    if (resume) {
      const done = session.entries.reduce(function (a, en) {
        return a + en.sets.filter(function (s) { return s.done; }).length; }, 0);
      U.toast('Session restored', done + ' set' + (done === 1 ? '' : 's') +
        ' already logged · ' + U.dur(Math.round((Date.now() - startedAt) / 1000)) +
        ' elapsed', 'good');
    }

    let restTimer = null, restLeft = 0;
    const timerEl = U.h('.stat-value.is-sm', { text: '0:00' });
    const restEl = U.h('span.chip', { text: 'Rest —' });

    const tick = setInterval(function () {
      const s = Math.round((Date.now() - startedAt) / 1000);
      timerEl.textContent = U.dur(s);
      if (restLeft > 0) {
        restLeft--;
        restEl.textContent = 'Rest ' + U.dur(restLeft);
        restEl.classList.add('chip-accent');
        if (restLeft === 0) {
          restEl.textContent = 'Rest done';
          restEl.classList.remove('chip-accent');
          beep();
        }
      }
    }, 1000);

    /* Stop the interval when the user leaves this page. */
    const stop = function () { clearInterval(tick); };
    window.addEventListener('hashchange', stop, { once: true });

    App.Shell.setTopActions([
      U.h('button.btn.btn-sm', { type: 'button', text: 'Discard',
        onclick: function () {
          U.confirm({ title: 'Discard this session?', message: 'Nothing will be saved.',
            confirmLabel: 'Discard', danger: true }).then(function (ok) {
            if (ok) { stop(); App.Update.clearSnapshot(); App.Shell.navigate('workouts'); }
          });
        } }),
      U.h('button.btn.btn-primary.btn-sm', {
        type: 'button', html: U.icon('check') + '<span>Finish</span>',
        onclick: finish
      })
    ]);

    function finish() {
      const done = session.entries.map(function (en) {
        return Object.assign({}, en, {
          sets: en.sets.filter(function (s) { return s.done; })
        });
      }).filter(function (en) { return en.sets.length; });

      if (!done.length) {
        U.toast('Nothing logged', 'Tick at least one set before finishing.', 'bad');
        return;
      }
      stop();
      App.Update.clearSnapshot();
      App.Store.saveSession(Object.assign({}, session, {
        entries: done,
        endedAt: new Date().toISOString(),
        durationSec: Math.round((Date.now() - startedAt) / 1000)
      })).then(function () {
        let vol = 0;
        done.forEach(function (en) { vol += App.Ranks.volumeOf(en.sets); });
        U.toast('Session saved', U.compact(vol) + ' ' + units + ' of volume', 'good');
        if (App.Sync.signedIn()) App.Sync.publishStats();
        App.Shell.navigate('report');
      });
    }

    const heatWrap = U.h('.anat-wrap');
    const summaryWrap = U.h('.stack');

    function refreshSummary() {
      const live = { entries: session.entries.map(function (en) {
        return { exerciseId: en.exerciseId,
          sets: en.sets.filter(function (s) { return s.done; }) };
      }) };
      const heat = App.Store.sessionsHeat([live]);
      /* Measured against the last time this workout was run, so tapping a
         muscle answers "am I hitting it harder than last time?" */
      App.Anatomy.render(heatWrap, heat, { compact: true, legend: false,
        compare: previousHeat });

      let vol = 0, sets = 0;
      live.entries.forEach(function (en) {
        vol += App.Ranks.volumeOf(en.sets);
        sets += en.sets.length;
      });
      U.clear(summaryWrap);
      summaryWrap.appendChild(U.h('.grid.grid-2', [
        C.statTile('Volume', U.compact(vol), units),
        C.statTile('Sets done', sets, '')
      ]));
    }

    /* ---------------------------------------------------------------------
       The session is EDITABLE while it runs. A plan is a starting point, not a
       contract: sets get added when a lift feels light, dropped when it does
       not, and whole exercises get swapped because a rack was busy. Locking the
       runner to the plan meant the log stopped matching the training.

       Everything below rebuilds from `session.entries`, so adding or removing
       anything is a mutation followed by a redraw.
       ------------------------------------------------------------------ */
    const listWrap = U.h('.stack');

    /* Rest between sets: the plan's value for a planned exercise, the account
       default for one added mid-session. */
    function restFor(ei) {
      const it = (w.items || [])[ei];
      return (it && it.restSets) || App.Store.getSettings().restDefault;
    }

    /** The most recent logged sets for a movement, so a new row is not blank. */
    function lastSetsFor(exerciseId, count) {
      const prevSession = App.Store.allSessions().find(function (s2) {
        return (s2.entries || []).some(function (e) { return e.exerciseId === exerciseId; });
      });
      const prevEntry = prevSession && prevSession.entries
        .find(function (e) { return e.exerciseId === exerciseId; });
      const out = [];
      for (let i = 0; i < count; i++) {
        const pr = prevEntry && prevEntry.sets[i];
        out.push({ weight: (pr && pr.weight) || 0, reps: (pr && pr.reps) || 0, done: false });
      }
      return out;
    }

    function addExercise() {
      C.pickExercise({ multi: true, onPick: function (list) {
        list.forEach(function (ex) {
          session.entries.push({
            exerciseId: ex.id,
            sets: lastSetsFor(ex.id, 3),
            note: '', added: true
          });
        });
        drawList(); refreshSummary(); persist();
      } });
    }

    function removeExercise(ei) {
      const en = session.entries[ei];
      const ex = App.Store.getExercise(en.exerciseId);
      const logged = en.sets.filter(function (st) { return st.done; }).length;
      const go = function () {
        session.entries.splice(ei, 1);
        drawList(); refreshSummary(); persist();
      };
      /* Only interrupt when there is something to lose. */
      if (!logged) { go(); return; }
      U.confirm({
        title: 'Remove ' + (ex ? ex.name : 'this exercise') + '?',
        message: logged + ' logged set' + (logged === 1 ? '' : 's') +
          ' will be dropped from this session.',
        confirmLabel: 'Remove', danger: true
      }).then(function (ok) { if (ok) go(); });
    }

    function drawList() {
      U.clear(listWrap);

      session.entries.forEach(function (en, ei) {
        const ex = App.Store.getExercise(en.exerciseId);
        const setsWrap = U.h('.stack-sm');

        function drawSets() {
          U.clear(setsWrap);
          en.sets.forEach(function (st, si) {
            const e1rmCell = U.h('span.u-xs.u-muted.u-center');

            /* The estimate is the entire reason the weight and rep boxes sit
               next to each other, so it has to move as they are typed — not
               when the set is finally ticked. */
            function syncE1rm() {
              e1rmCell.textContent = st.weight && st.reps
                ? U.num(App.Ranks.e1rm(st.weight, st.reps), 0) : '—';
            }
            syncE1rm();

            const row = U.h('.set-grid.set-grid-run', [
              U.h('span.set-idx', { text: String(si + 1) }),
              U.h('input.input.input-sm.input-num', {
                type: 'number', min: '0', step: '0.5', inputmode: 'decimal', value: st.weight,
                'aria-label': 'Weight for set ' + (si + 1),
                oninput: function () {
                  st.weight = Number(this.value) || 0;
                  syncE1rm();
                  if (st.done) refreshSummary();
                  persist();
                }
              }),
              U.h('input.input.input-sm.input-num', {
                type: 'number', min: '0', step: '1', inputmode: 'numeric', value: st.reps,
                'aria-label': 'Reps for set ' + (si + 1),
                oninput: function () {
                  st.reps = Number(this.value) || 0;
                  syncE1rm();
                  if (st.done) refreshSummary();
                  persist();
                }
              }),
              e1rmCell,
              U.h('button.btn.btn-sm' + (st.done ? '.btn-primary' : ''), {
                type: 'button', html: U.icon('check'),
                'aria-label': 'Mark set ' + (si + 1) + ' done',
                onclick: function () {
                  st.done = !st.done;
                  this.classList.toggle('btn-primary', st.done);
                  row.classList.toggle('is-done', st.done);
                  if (st.done) restLeft = restFor(ei);
                  syncE1rm();
                  refreshSummary();
                  persist();
                }
              }),
              U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
                type: 'button', html: U.icon('x'),
                'aria-label': 'Remove set ' + (si + 1),
                onclick: function () {
                  en.sets.splice(si, 1);
                  drawSets();
                  refreshSummary();
                  persist();
                }
              })
            ]);
            if (st.done) row.classList.add('is-done');
            setsWrap.appendChild(row);
          });

          setsWrap.appendChild(U.h('button.btn.btn-sm.btn-block.btn-ghost', {
            type: 'button', html: U.icon('plus') + '<span>Add set</span>',
            onclick: function () {
              /* Carry the last set forward: the next one is nearly always the
                 same weight, and retyping it on a phone is a chore. */
              const last = en.sets[en.sets.length - 1];
              en.sets.push({ weight: last ? last.weight : 0,
                             reps: last ? last.reps : 0, done: false });
              drawSets();
              persist();
            }
          }));
        }

        drawSets();

        listWrap.appendChild(U.h('.wo-block', [
          U.h('.wo-block-head', [
            C.exThumb(ex || {}),
            /* Actions first in source order: they float right and the name
               wraps beneath them rather than colliding with them. */
            U.h('.wo-block-actions', [
              U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
                type: 'button', html: U.icon('trash'),
                'aria-label': 'Remove ' + (ex ? ex.name : 'exercise') + ' from this session',
                onclick: function () { removeExercise(ei); }
              })
            ]),
            U.h('.wo-block-title', [
              U.h('.ex-name', { text: ex ? ex.name : 'Missing exercise' }),
              U.h('.ex-meta', [
                U.h('span', { text: 'Rest ' + U.dur(restFor(ei)) }),
                en.added ? U.h('span', { text: 'added' }) : null
              ])
            ])
          ]),
          U.h('.wo-block-body', [
            U.h('.set-grid.set-grid-run', [
              U.h('span.label', ''), U.h('span.label', 'Weight'), U.h('span.label', 'Reps'),
              U.h('span.label', 'e1RM'), U.h('span.label', ''), U.h('span.label', '')
            ]),
            setsWrap
          ])
        ]));
      });

      if (!session.entries.length) {
        listWrap.appendChild(U.h('.empty', [
          U.h('.empty-title', 'Nothing in this session yet'),
          U.h('p', 'Add a movement to start logging.')
        ]));
      }

      listWrap.appendChild(U.h('button.btn.btn-block', {
        type: 'button', html: U.icon('plus') + '<span>Add an exercise</span>',
        onclick: addExercise
      }));
    }

    drawList();

    root.appendChild(U.h('.card', [
      U.h('.row.row-wrap', [
        U.h('.stat', [U.h('.stat-label', 'Elapsed'), timerEl]),
        restEl,
        U.h('.spacer'),
        U.h('.field', { style: { width: '160px' } }, [
          U.h('label.label', 'Date'),
          U.h('input.input.input-sm', { type: 'date', value: session.date,
            onchange: function () { session.date = this.value; persist(); } })
        ])
      ])
    ]));

    root.appendChild(U.h('.grid.grid-main', [
      U.h('.card', [
        U.h('.card-head', [U.h('h2', { text: w.name })]),
        listWrap
      ]),
      U.h('.stack', [
        U.h('.card', [
          U.h('.card-head', [U.h('h2', 'Live')]),
          heatWrap,
          summaryWrap
        ])
      ])
    ]));

    refreshSummary();
  }

  /** Short tone at the end of a rest period; silently ignored if blocked. */
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
      setTimeout(function () { ctx.close(); }, 600);
    } catch (e) { /* audio is a nicety, never a failure */ }
  }

  /* ===========================================================================
     PROGRESS REPORT (under the workout list)
     ======================================================================== */

  function progressReport() {
    const wrap = U.h('.card');
    const body = U.h('div');
    const pickWrap = U.h('.tag-row');

    function redraw() {
      U.clear(body);
      const range = C.rangeById(report.range);
      const from = U.daysAgo(range.days);
      const sessions = App.Store.sessionsBetween(from, U.today())
        .slice().sort(function (a, b) { return a.date.localeCompare(b.date); });

      if (sessions.length < 2) {
        body.appendChild(U.h('.empty', [
          U.h('div', { html: U.icon('chart') }),
          U.h('.empty-title', 'Not enough history yet'),
          U.h('p', 'Log at least two sessions in this period and you will get an average ' +
            'strength curve, per-exercise progression, and a forecast.')
        ]));
        return;
      }

      /* --- average across all exercises, indexed to the first session --- */
      const avgSeries = averageIndex(sessions);
      const fit = App.Charts.regress(avgSeries.map(function (p, i) {
        return { x: p.x, y: p.y };
      }));

      const chartEl = U.h('div');
      body.appendChild(U.h('.sec-head', [
        U.h('h2', 'Average progress across every exercise'),
        U.h('.spacer'),
        fit ? U.h('span.chip' + (fit.slope > 0 ? '.chip-accent' : ''), {
          text: (fit.slope >= 0 ? '+' : '') +
            U.num(fit.slope * 86400000 * 30, 1) + '% / month'
        }) : null
      ]));
      body.appendChild(chartEl);

      /* forecast 60 days beyond the last point */
      const series = [{ name: 'Average index', accent: true, area: true, points: avgSeries }];
      const bands = [];
      if (fit && fit.n >= 3) {
        const lastX = avgSeries[avgSeries.length - 1].x;
        const horizon = 60 * 86400000;
        const fc = [];
        const band = [];
        for (let i = 0; i <= 6; i++) {
          const x = lastX + (horizon * i) / 6;
          const y = fit.at(x);
          fc.push({ x: x, y: y });
          /* widen with distance, as a projection should */
          const spread = fit.se * (1 + i * 0.5) || Math.abs(y) * 0.04 * (1 + i);
          band.push({ x: x, lo: y - spread, hi: y + spread });
        }
        series.push({ name: 'Forecast (60d)', dash: true, dots: false, points: fc });
        bands.push({ points: band });
      }

      setTimeout(function () {
        App.Charts.line(chartEl, {
          xType: 'date', height: 240, series: series, bands: bands,
          yFormat: function (v) { return U.num(v, 0) + '%'; }
        });
        if (fit) {
          chartEl.appendChild(U.h('.u-xs.u-muted', { style: { marginTop: '8px' },
            text: 'Least-squares fit over ' + fit.n + ' sessions · r² = ' +
              U.num(fit.r2, 2) + (fit.r2 < 0.3
                ? ' — a weak fit, so treat the projection as a rough direction only.'
                : '') }));
        }
      }, 0);

      /* --- chosen exercises --- */
      body.appendChild(U.h('.sec-head', { style: { marginTop: '28px' } }, [
        U.h('h2', 'Tracked movements'),
        U.h('.spacer'),
        U.h('button.btn.btn-sm', {
          type: 'button', html: U.icon('plus') + '<span>Track a movement</span>',
          onclick: function () {
            C.pickExercise({ onPick: function (ex) {
              if (report.picks.indexOf(ex.id) < 0) report.picks.push(ex.id);
              if (report.picks.length > 6) report.picks.shift();
              redraw();
            } });
          }
        })
      ]));

      const picks = report.picks.length ? report.picks : autoPicks(sessions);
      body.appendChild(pickChips(picks, redraw));

      const grid = U.h('.grid.grid-2', { style: { marginTop: '14px' } });
      picks.forEach(function (id) {
        const ex = App.Store.getExercise(id);
        if (!ex) return;
        const hist = App.Store.exerciseHistory(id, from);
        const cell = U.h('.card', { style: { padding: 'var(--sp-4)' } }, [
          U.h('.card-head', { style: { marginBottom: '8px' } }, [
            U.h('div', { style: { minWidth: 0 } }, [
              U.h('div', { class: 'u-truncate', style: { fontWeight: '600' }, text: ex.name }),
              U.h('.u-xs.u-muted', { text: hist.length + ' sessions in range' })
            ])
          ])
        ]);
        const c = U.h('div');
        cell.appendChild(c);
        grid.appendChild(cell);
        setTimeout(function () {
          App.Charts.line(c, {
            xType: 'date', height: 150, legend: false,
            yFormat: function (v) { return U.compact(v); },
            series: [{ name: 'e1RM', accent: true,
              points: hist.map(function (p) {
                return { x: new Date(p.date + 'T12:00:00').getTime(), y: p.e1rm };
              }) }]
          });
        }, 0);
      });
      body.appendChild(grid);
    }

    wrap.appendChild(U.h('.card-head', [
      U.h('div', [
        U.h('h2', 'Progress report'),
        U.h('.card-sub', 'How every workout you have logged is trending.')
      ]),
      U.h('.spacer'),
      C.rangePicker(report.range, function (r) { report.range = r.id; redraw(); })
    ]));
    wrap.appendChild(pickWrap);
    wrap.appendChild(body);
    setTimeout(redraw, 0);
    return wrap;
  }

  function pickChips(picks, redraw) {
    const row = U.h('.tag-row');
    picks.forEach(function (id) {
      const ex = App.Store.getExercise(id);
      if (!ex) return;
      row.appendChild(U.h('span.chip.chip-btn', [
        ex.name,
        report.picks.length ? U.h('span.chip-x', {
          html: U.icon('x'), role: 'button', 'aria-label': 'Stop tracking ' + ex.name,
          onclick: function () {
            report.picks = report.picks.filter(function (x) { return x !== id; });
            redraw();
          }
        }) : null
      ]));
    });
    if (!report.picks.length) {
      row.appendChild(U.h('span.u-xs.u-muted',
        'Auto-selected: your three strongest and three weakest tracked lifts.'));
    }
    return row;
  }

  /** Top 3 and bottom 3 by strength score, per the spec's "top 3 / low 3". */
  function autoPicks(sessions) {
    const r = App.Store.rank();
    const scored = r.scored.filter(function (s) {
      return App.Store.exerciseHistory(s.exerciseId).length >= 2;
    });
    if (scored.length <= 6) return scored.map(function (s) { return s.exerciseId; });
    const top = scored.slice(0, 3).map(function (s) { return s.exerciseId; });
    const low = scored.slice(-3).map(function (s) { return s.exerciseId; });
    return top.concat(low);
  }

  /**
   * A single "how am I doing" curve: each session's mean estimated 1RM per
   * exercise, expressed as a percentage of that exercise's first value in the
   * range. Indexing this way lets a 200 kg squat and a 20 kg curl contribute
   * equally instead of the heaviest lift dominating the shape.
   */
  function averageIndex(sessions) {
    const baseline = Object.create(null);
    const out = [];

    sessions.forEach(function (s) {
      const ratios = [];
      (s.entries || []).forEach(function (en) {
        const one = App.Ranks.bestE1RM(en.sets);
        if (!one) return;
        if (!baseline[en.exerciseId]) { baseline[en.exerciseId] = one; }
        ratios.push((one / baseline[en.exerciseId]) * 100);
      });
      if (!ratios.length) return;
      const mean = ratios.reduce(function (a, b) { return a + b; }, 0) / ratios.length;
      out.push({ x: new Date(s.date + 'T12:00:00').getTime(), y: mean });
    });

    /* Collapse multiple sessions on one day into their mean. */
    const byDay = Object.create(null);
    out.forEach(function (p) {
      (byDay[p.x] = byDay[p.x] || []).push(p.y);
    });
    return Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; })
      .map(function (x) {
        const arr = byDay[x];
        return { x: x, y: arr.reduce(function (a, b) { return a + b; }, 0) / arr.length };
      });
  }

  App.Pages = App.Pages || {};
  App.Pages.workouts = { render: render, onDataChange: onDataChange };
})(window.App = window.App || {});
