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
      root.appendChild(U.h('.grid.grid-auto', workouts.map(workoutCard)));
    }

    root.appendChild(progressReport());
  }

  function workoutCard(w) {
    const st = App.Store.workoutStats(w);
    const split = App.Store.suggestSplit(w);
    const units = App.Store.getSettings().units;
    const figWrap = U.h('.anat-wrap');
    setTimeout(function () {
      App.Anatomy.render(figWrap, st.heat, { compact: true, legend: false, interactive: false });
    }, 0);

    return U.h('.card', [
      U.h('.card-head', [
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
              type: 'number', min: '0', step: '5', value: it.restSets,
              'aria-label': 'Rest between sets',
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
          U.h('span.u-xs.u-muted', 'Rest after exercise'),
          U.h('input.input.input-sm.input-num', {
            type: 'number', min: '0', step: '15', value: it.restAfter,
            style: { width: '80px' }, 'aria-label': 'Rest after this exercise',
            oninput: function () { it.restAfter = Number(this.value) || 0; scheduleRefresh(); }
          })
        ]));
      }

      const block = U.h('.wo-block', { draggable: 'true', dataset: { id: it.id } }, [
        U.h('.wo-block-head', [
          U.h('span.wo-grip', { html: U.icon('grip'), title: 'Drag to reorder' }),
          C.exThumb(ex || {}),
          U.h('div', { style: { minWidth: 0, flex: 1 } }, [
            U.h('.ex-name', { text: ex ? ex.name : 'Missing exercise' }),
            U.h('.ex-meta', [
              U.h('span', { text: ex ? (App.Equipment[ex.equipment] || ex.equipment) : '' }),
              U.h('span', { text: ex ? C.topMuscleLabel(ex) : '' })
            ])
          ]),
          ex ? C.heatStrip(ex.muscles) : null,
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
            type: 'button', 'aria-label': 'Remove exercise', html: U.icon('trash'),
            onclick: function () {
              draft.items = draft.items.filter(function (x) { return x.id !== it.id; });
              refreshItems(); scheduleRefresh();
            }
          })
        ]),
        U.h('.wo-block-body', [setsWrap])
      ]);

      drawSets();
      wireDrag(block, it);
      return block;
    }

    function moveItem(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= draft.items.length) return;
      const tmp = draft.items[i];
      draft.items[i] = draft.items[j];
      draft.items[j] = tmp;
      grouping = 'none';
      refreshItems(); scheduleRefresh();
    }

    let dragId = null;
    function wireDrag(block, it) {
      block.addEventListener('dragstart', function (e) {
        dragId = it.id;
        block.classList.add('is-drag');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', it.id); } catch (err) { /* Safari */ }
      });
      block.addEventListener('dragend', function () {
        block.classList.remove('is-drag'); dragId = null;
      });
      block.addEventListener('dragover', function (e) {
        if (!dragId || dragId === it.id) return;
        e.preventDefault();
        block.classList.add('is-over');
      });
      block.addEventListener('dragleave', function () { block.classList.remove('is-over'); });
      block.addEventListener('drop', function (e) {
        e.preventDefault();
        block.classList.remove('is-over');
        if (!dragId || dragId === it.id) return;
        const from = draft.items.findIndex(function (x) { return x.id === dragId; });
        const to = draft.items.findIndex(function (x) { return x.id === it.id; });
        if (from < 0 || to < 0) return;
        draft.items.splice(to, 0, draft.items.splice(from, 1)[0]);
        grouping = 'none';
        refreshItems(); scheduleRefresh();
      });
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
          U.h('select.select', {
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

    items.forEach(function (it) {
      const ex = App.Store.getExercise(it.exerciseId);
      let key = 'Other';
      if (ex) {
        if (mode === 'chain') {
          const split = App.Store.chainSplit({ items: [it] });
          key = Object.keys(split).sort(function (a, b) { return split[b] - split[a]; })[0];
          key = { push: 'Push', pull: 'Pull', legs: 'Legs', core: 'Core' }[key] || 'Other';
        } else if (mode === 'group') {
          const g = App.Muscles.groupTotals(ex.muscles);
          const top = Object.keys(g).sort(function (a, b) { return g[b] - g[a]; })[0];
          key = top ? App.Muscles.GROUPS[top].name : 'Other';
        } else {
          key = String(ex.pattern).replace(/-/g, ' ')
            .replace(/^./, function (c) { return c.toUpperCase(); });
        }
      }
      (buckets[key] = buckets[key] || []).push(it);
    });

    return Object.keys(buckets).sort().map(function (k) {
      return { label: k, items: buckets[k] };
    });
  }

  /* ===========================================================================
     RUNNER — log a session
     ======================================================================== */

  function drawRunner() {
    const w = App.Store.getWorkout(currentId);
    if (!w) { App.Shell.navigate('workouts'); return; }

    const startedAt = Date.now();
    const units = App.Store.getSettings().units;

    /* Prefill from the plan, and from the last time this workout was done. */
    const previous = App.Store.allSessions().find(function (s) { return s.workoutId === w.id; });
    const session = {
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
            if (ok) { stop(); App.Shell.navigate('workouts'); }
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
      App.Anatomy.render(heatWrap, heat, { compact: true, legend: false, interactive: false });

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

    const listWrap = U.h('.stack');
    session.entries.forEach(function (en, ei) {
      const ex = App.Store.getExercise(en.exerciseId);
      const item = (w.items || [])[ei] || {};
      const setsWrap = U.h('.stack-sm');

      en.sets.forEach(function (s, si) {
        const row = U.h('.set-grid', [
          U.h('span.set-idx', { text: String(si + 1) }),
          U.h('input.input.input-sm.input-num', {
            type: 'number', min: '0', step: '0.5', value: s.weight,
            'aria-label': 'Weight', oninput: function () { s.weight = Number(this.value) || 0; }
          }),
          U.h('input.input.input-sm.input-num', {
            type: 'number', min: '0', step: '1', value: s.reps,
            'aria-label': 'Reps', oninput: function () { s.reps = Number(this.value) || 0; }
          }),
          U.h('span.u-xs.u-muted.u-center', {
            text: s.weight && s.reps ? U.num(App.Ranks.e1rm(s.weight, s.reps), 0) : '—'
          }),
          U.h('button.btn.btn-sm', {
            type: 'button', html: U.icon('check'), 'aria-label': 'Mark set ' + (si + 1) + ' done',
            onclick: function () {
              s.done = !s.done;
              this.classList.toggle('btn-primary', s.done);
              row.style.opacity = s.done ? '1' : '';
              if (s.done) {
                restLeft = item.restSets || App.Store.getSettings().restDefault;
              }
              const cell = row.children[3];
              cell.textContent = s.weight && s.reps
                ? U.num(App.Ranks.e1rm(s.weight, s.reps), 0) : '—';
              refreshSummary();
            }
          })
        ]);
        setsWrap.appendChild(row);
      });

      listWrap.appendChild(U.h('.wo-block', [
        U.h('.wo-block-head', [
          C.exThumb(ex || {}),
          U.h('div', { style: { minWidth: 0, flex: 1 } }, [
            U.h('.ex-name', { text: ex ? ex.name : 'Missing exercise' }),
            U.h('.ex-meta', [U.h('span', { text: 'Rest ' + U.dur(item.restSets || 0) })])
          ])
        ]),
        U.h('.wo-block-body', [
          U.h('.set-grid', [
            U.h('span.label', ''), U.h('span.label', 'Weight'), U.h('span.label', 'Reps'),
            U.h('span.label', 'e1RM'), U.h('span.label', '')
          ]),
          setsWrap
        ])
      ]));
    });

    root.appendChild(U.h('.card', [
      U.h('.row.row-wrap', [
        U.h('.stat', [U.h('.stat-label', 'Elapsed'), timerEl]),
        restEl,
        U.h('.spacer'),
        U.h('.field', { style: { width: '160px' } }, [
          U.h('label.label', 'Date'),
          U.h('input.input.input-sm', { type: 'date', value: session.date,
            onchange: function () { session.date = this.value; } })
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
