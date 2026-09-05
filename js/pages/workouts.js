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
  /* Which program the list is narrowed to. null means "not chosen yet", and
     resolves to the first program — a program is what you are following, so
     it is what the list opens on. 'all' is every workout, and it is the last
     chip, not the first: it is the escape hatch, not the default. Page state,
     not a setting: it is a way of looking, not a fact. */
  let programFilter = null;

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

    let workouts = App.Store.allWorkouts();
    const programs = App.Store.allPrograms();
    /* A deleted program, or none chosen yet: open on the first program. With
       no programs at all there is nothing to narrow to. */
    if (programFilter !== 'all' && !(programFilter && App.Store.getProgram(programFilter))) {
      programFilter = programs.length ? programs[0].id : 'all';
    }
    const chosen = programFilter !== 'all' ? App.Store.getProgram(programFilter) : null;

    /* THE PROGRAM SELECTOR. With a program chosen, the list is that program's
       sessions, grouped by phase, and nothing else — the twelve sessions a
       generator writes would otherwise bury the three you built by hand. */
    if (programs.length) {
      root.appendChild(U.h('.card', { style: { padding: 'var(--sp-3) var(--sp-4)' } }, [
        U.h('.row.row-wrap', [
          U.h('span.u-xs.u-muted', 'Showing'),
          U.h('.tag-row', programs.map(function (pg) {
            return U.h('button.chip.chip-btn' + (chosen && chosen.id === pg.id ? '.chip-accent' : ''), {
              type: 'button', text: pg.name,
              onclick: function () { programFilter = pg.id; draw(); }
            });
          }).concat([
            U.h('button.chip.chip-btn' + (!chosen ? '.chip-accent' : ''), {
              type: 'button', text: 'All workouts',
              onclick: function () { programFilter = 'all'; draw(); }
            })
          ]))
        ])
      ]));
    }

    if (chosen) {
      const live = App.Programs.activePhase(chosen);
      (chosen.phases || []).forEach(function (ph, i) {
        const ids = ph.workoutIds || [];
        const list = ids.map(function (id) { return App.Store.getWorkout(id); }).filter(Boolean);
        const on = live && live.index === i && !live.complete;
        root.appendChild(U.h('.sec-head', { style: { marginTop: i ? '18px' : '4px' } }, [
          U.h('h2', ph.name),
          on ? U.h('span.chip.chip-accent', 'This phase') : null,
          U.h('.spacer'),
          U.h('span.u-xs.u-muted', list.length + ' session' + (list.length === 1 ? '' : 's'))
        ]));
        if (!list.length) {
          root.appendChild(U.h('p.u-sm.u-muted', 'No sessions in this phase yet.'));
          return;
        }
        const grid = U.h('.wo-list');
        list.forEach(function (w) { grid.appendChild(workoutCard(w)); });
        root.appendChild(grid);
      });
      root.appendChild(programsCard());
      root.appendChild(progressReport());
      return;
    }

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

    root.appendChild(programsCard());
    root.appendChild(progressReport());
  }

  /* ===========================================================================
     PROGRAMS

     A workout is one session. A program is the rotation: phases that step
     forward on a schedule, so "what am I doing this week" has an answer that
     does not depend on anybody remembering where they were.
     ======================================================================== */

  function programsCard() {
    const P = App.Programs;
    const programs = App.Store.allPrograms();
    const body = U.h('.stack');

    programs.forEach(function (pg) { body.appendChild(programRow(pg)); });

    if (!programs.length) {
      body.appendChild(U.h('.empty', [
        U.h('div', { html: U.icon('calendar') || U.icon('list') }),
        U.h('.empty-title', 'No program yet'),
        U.h('p', 'A program rotates between phases — a block of heavier, lower-rep ' +
          'work, a block of more sets at moderate weight, a lighter week — and tells ' +
          'you which one you are in today. Point it at a workout you already do and ' +
          'it will write the rest.')
      ]));
    }

    return U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Programs'),
          U.h('.card-sub', 'A rotation of phases, on a schedule you set.')
        ]),
        U.h('.spacer'),
        U.h('button.btn.btn-sm', {
          type: 'button', html: U.icon('plus') + '<span>New program</span>',
          onclick: function () { customProgramDialog(null); }
        }),
        U.h('button.btn.btn-primary.btn-sm', {
          type: 'button', html: U.icon('play') + '<span>Generate</span>',
          onclick: function () { generateDialog(); }
        })
      ]),
      body
    ]);
  }

  /* ---------------------------------------------------------------------------
     A PROGRAM BUILT BY HAND

     Phases you name, each holding sessions you already have. The same dialog
     edits an existing program, generated or not — a generated program is only
     a program somebody else wrote first.
     ------------------------------------------------------------------------ */
  function customProgramDialog(existing) {
    const workouts = App.Store.allWorkouts();
    const draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      name: 'My program', rotateEvery: 4, rotateUnit: 'weeks', repeat: true,
      startDate: U.today(),
      phases: [{ id: U.uid('ph'), name: 'Phase 1', blockId: 'hypertrophy', workoutIds: [] }]
    };

    const nameEl = U.h('input.input', { value: draft.name, placeholder: 'Program name',
      oninput: function () { draft.name = this.value; } });
    const everyEl = U.h('input.input.input-num', { type: 'number', min: '1', max: '52',
      value: draft.rotateEvery || 4, inputmode: 'numeric',
      onchange: function () { draft.rotateEvery = Math.max(1, Number(this.value) || 4); } });
    const unitEl = U.h('select.select', { onchange: function () { draft.rotateUnit = this.value; } }, [
      U.h('option', { value: 'days', selected: draft.rotateUnit === 'days' }, 'days'),
      U.h('option', { value: 'weeks', selected: !draft.rotateUnit || draft.rotateUnit === 'weeks' }, 'weeks'),
      U.h('option', { value: 'months', selected: draft.rotateUnit === 'months' }, 'months')
    ]);
    const startEl = U.h('input.input', { type: 'date', value: draft.startDate || U.today(),
      onchange: function () { draft.startDate = this.value || U.today(); } });
    const repeatEl = U.h('input', { type: 'checkbox', checked: draft.repeat !== false,
      onchange: function () { draft.repeat = this.checked; } });

    const phasesWrap = U.h('.stack');
    function paintPhases() {
      U.clear(phasesWrap);
      draft.phases.forEach(function (ph, i) {
        const chips = U.h('.tag-row', workouts.map(function (w) {
          const on = (ph.workoutIds || []).indexOf(w.id) >= 0;
          return U.h('button.chip.chip-btn' + (on ? '.chip-accent' : ''), {
            type: 'button', text: w.name,
            onclick: function () {
              const ids = ph.workoutIds = ph.workoutIds || [];
              const k = ids.indexOf(w.id);
              if (k >= 0) ids.splice(k, 1); else ids.push(w.id);
              this.classList.toggle('chip-accent', k < 0);
            }
          });
        }));
        phasesWrap.appendChild(U.h('.wo-block', [
          U.h('.row', [
            U.h('input.input.input-sm', { value: ph.name, placeholder: 'Phase name',
              oninput: function () { ph.name = this.value; } }),
            U.h('select.select.input-sm', { style: { width: 'auto' },
              onchange: function () { ph.blockId = this.value; } },
              Object.keys(App.Programs.BLOCKS).map(function (b) {
                return U.h('option', { value: b, selected: ph.blockId === b },
                  App.Programs.BLOCKS[b].name);
              })),
            U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
              type: 'button', html: U.icon('x'), 'aria-label': 'Remove phase',
              onclick: function () { draft.phases.splice(i, 1); paintPhases(); }
            })
          ]),
          U.h('.u-xs.u-muted', { style: { margin: '6px 0' } },
            'Sessions in this phase — the block sets how they progress week to week.'),
          workouts.length ? chips : U.h('p.u-sm.u-muted', 'No sessions to choose from yet.')
        ]));
      });
    }
    paintPhases();

    U.modal({
      title: existing ? 'Edit program' : 'New program',
      wide: true,
      body: function (b) {
        b.appendChild(U.h('.stack', [
          U.h('.grid.grid-2', [
            U.h('.field', [U.h('label.label', 'Name'), nameEl]),
            U.h('.field', [U.h('label.label', 'Started on'), startEl])
          ]),
          U.h('.field', [U.h('label.label', 'Move to the next phase every'),
            U.h('.row', [everyEl, unitEl])]),
          U.h('label.switch', { style: { alignItems: 'flex-start' } }, [
            repeatEl, U.h('i.switch-track'),
            U.h('div', [
              U.h('div', { style: { fontWeight: '560' } }, 'Permanent'),
              U.h('.u-xs.u-muted', 'Loops back to the first phase after the last. Off, ' +
                'it runs the phases once, then finishes and writes its report.')
            ])
          ]),
          U.h('.field', [U.h('label.label', 'Phases'), phasesWrap,
            U.h('button.btn.btn-sm', { type: 'button', text: 'Add a phase',
              style: { marginTop: '8px' },
              onclick: function () {
                draft.phases.push({ id: U.uid('ph'), name: 'Phase ' + (draft.phases.length + 1),
                  blockId: 'hypertrophy', workoutIds: [] });
                paintPhases();
              } })])
        ]));
      },
      actions: [
        { label: 'Cancel' },
        { label: existing ? 'Save' : 'Create', kind: 'primary', onClick: function (close) {
          if (!draft.phases.length) {
            U.toast('No phases', 'A program needs at least one phase.', 'bad');
            return;
          }
          App.Store.saveProgram(draft).then(function (pg) {
            close();
            U.toast(existing ? 'Saved' : 'Program created', pg.name, 'good');
          });
        } }
      ]
    });
  }

  /* ---------------------------------------------------------------------------
     THE REPORT — did you keep to it?
     ------------------------------------------------------------------------ */
  function reportDialog(pg) {
    const r = App.Programs.report(pg);
    U.modal({
      title: pg.name + ' — report',
      wide: true,
      body: function (b) {
        b.appendChild(U.h('.stack', [
          U.h('.grid.grid-2', [
            C.statTile('Kept to it', Math.round(r.adherence * 100) + '%', r.verdict),
            C.statTile(r.complete ? 'Finished' : 'In progress',
              r.rows.filter(function (x) { return x.started; }).length + ' / ' + r.rows.length,
              'phases started')
          ]),
          U.h('.table-wrap', [U.h('table.tbl', [
            U.h('thead', [U.h('tr', [
              U.h('th', 'Phase'), U.h('th.num', 'Sessions'), U.h('th.num', 'Load'), U.h('th', 'Reading')
            ])]),
            U.h('tbody', r.rows.map(function (x) {
              const pct = Math.round(x.adherence * 100);
              return U.h('tr', [
                U.h('td', [U.h('div', { style: { fontWeight: '560' }, text: x.name }),
                  U.h('.u-xs.u-muted', { text: x.from + ' → ' + x.to })]),
                U.h('td.num', { text: x.started
                  ? x.done + ' of ' + x.expectedSoFar + (x.expectedSoFar !== x.expected ? ' so far' : '')
                  : '—' }),
                U.h('td.num', { text: x.gainPct === null ? '—'
                  : (x.gainPct >= 0 ? '+' : '') + U.num(x.gainPct, 1) + '%' +
                    (x.askedPct ? ' of +' + x.askedPct + '%' : '') }),
                U.h('td', [U.h('span.badge' + (pct >= 90 ? '.badge-good' : pct < 50 && x.started ? '.badge-bad' : ''),
                  { text: !x.started ? 'Not yet' : pct >= 90 ? 'On plan' : pct >= 60 ? 'Nearly' : 'Behind' })])
              ]);
            }))
          ])]),
          U.h('p.u-xs.u-muted', 'Sessions counts what was logged from this phase inside its own ' +
            'dates. Load is how the estimated one-rep max moved across the phase, averaged ' +
            'over the movements it saw more than once, against what the progression asked for.')
        ]));
      },
      actions: [{ label: 'Close' }]
    });
  }

  function programRow(pg) {
    const P = App.Programs;
    const live = P.activePhase(pg);
    const phases = pg.phases || [];

    const chips = U.h('.tag-row', phases.map(function (ph, i) {
      const on = live && live.index === i && !live.complete;
      return U.h('span.chip' + (on ? '.chip-accent' : ''), {
        text: ph.name + ' · ' + (ph.workoutIds || []).length + ' session' +
          ((ph.workoutIds || []).length === 1 ? '' : 's')
      });
    }));

    const runRow = U.h('.tag-row');
    if (live && !live.complete) {
      ((live.phase || {}).workoutIds || []).forEach(function (id) {
        const w = App.Store.getWorkout(id);
        if (!w) return;
        runRow.appendChild(U.h('button.chip.chip-btn', {
          type: 'button', text: w.name.split(' · ').pop(),
          onclick: function () { App.Shell.navigate('workouts/run/' + w.id); }
        }));
      });
    }

    let status;
    if (!live) status = 'No phases';
    else if (live.complete) status = 'Finished — ran once, ' + phases.length + ' phase' +
      (phases.length === 1 ? '' : 's') + '. See the report.';
    else status = live.phase.name + ' · week ' + (live.week + 1) + ' · day ' + live.dayOfPhase +
      ' of ' + live.periodDays + ' · ' + live.daysLeft + ' left, then ' +
      (live.next ? live.next.name : 'done') + (pg.repeat === false ? ' · runs once' : ' · permanent');

    return U.h('.wo-block', [
      U.h('.row.row-wrap', [
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('div', { style: { fontWeight: '620' }, text: pg.name }),
          U.h('.u-xs.u-muted', { text: status })
        ]),
        U.h('.spacer'),
        U.h('button.btn.btn-sm', { type: 'button', text: 'Show',
          onclick: function () { programFilter = pg.id; draw(); window.scrollTo(0, 0); } }),
        U.h('button.btn.btn-sm', { type: 'button', text: 'Report',
          onclick: function () { reportDialog(pg); } }),
        U.h('button.btn.btn-sm', { type: 'button', text: 'Edit',
          onclick: function () { customProgramDialog(pg); } }),
        U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
          type: 'button', 'aria-label': 'Delete program', html: U.icon('trash'),
          onclick: function () { removeProgram(pg); }
        })
      ]),
      chips,
      runRow.childNodes.length
        ? U.h('div', [U.h('.label', { style: { marginTop: '10px' } }, 'This phase'), runRow])
        : null,
      pg.warnings && pg.warnings.length
        ? U.h('.sci-note', { style: { marginTop: '10px' } }, [
          U.h('.sci-note-title', 'What your equipment could not cover'),
          U.h('p.u-sm.u-muted', { text: pg.warnings.join(' ') })
        ])
        : null
    ]);
  }

  function removeProgram(pg) {
    U.confirm({
      title: 'Delete "' + pg.name + '"?',
      message: 'The workouts it generated are kept — only the rotation goes.',
      confirmLabel: 'Delete the program', danger: true
    }).then(function (ok) {
      if (!ok) return;
      App.Store.deleteProgram(pg.id).then(function () {
        U.toast('Deleted', pg.name);
      });
    });
  }

  /** Change how often a program steps to its next phase. */
  function scheduleDialog(pg) {
    const every = U.h('input.input.input-num', {
      type: 'number', min: '1', max: '52', value: pg.rotateEvery || 4, inputmode: 'numeric'
    });
    const unit = U.h('select.select', {}, [
      U.h('option', { value: 'days', selected: pg.rotateUnit === 'days' }, 'days'),
      U.h('option', { value: 'weeks', selected: pg.rotateUnit !== 'days' && pg.rotateUnit !== 'months' }, 'weeks'),
      U.h('option', { value: 'months', selected: pg.rotateUnit === 'months' }, 'months')
    ]);
    const start = U.h('input.input', { type: 'date', value: pg.startDate || U.today() });

    U.modal({
      title: 'Rotation',
      body: function (b) {
        b.appendChild(U.h('.stack', [
          U.h('p.u-sm.u-muted', 'Which phase is live is worked out from the start date ' +
            'and this period, so missing a week costs a week of the phase and nothing ' +
            'has to be repaired.'),
          U.h('.field', [U.h('label.label', 'Move to the next phase every'),
            U.h('.row', [every, unit])]),
          U.h('.field', [U.h('label.label', 'Started on'), start])
        ]));
      },
      actions: [
        { label: 'Cancel' },
        { label: 'Save', kind: 'primary', onClick: function (close) {
          App.Store.saveProgram(Object.assign({}, pg, {
            rotateEvery: Math.max(1, Number(every.value) || 4),
            rotateUnit: unit.value,
            startDate: start.value || U.today()
          })).then(function () { close(); U.toast('Saved', pg.name, 'good'); });
        } }
      ]
    });
  }

  /* ---------------------------------------------------------------------------
     THE GENERATOR DIALOG
     ------------------------------------------------------------------------ */

  function generateDialog() {
    const P = App.Programs;
    const s = App.Store.getSettings();
    const programs = App.Store.allPrograms();

    const nameEl = U.h('input.input', { value: 'My program', placeholder: 'Program name' });
    /* Based on a PROGRAM, not a session. A session is one day; the movements
       and loads worth carrying forward are the whole rotation's. From scratch,
       the seeds are everything the lifter has ever logged, which is exactly
       the set of movements their weights are known for. */
    const baseEl = U.h('select.select', {},
      [U.h('option', { value: '' }, 'From scratch — using everything you have logged')].concat(
        programs.map(function (pg) {
          return U.h('option', { value: pg.id }, pg.name);
        })));
    const repeatEl = U.h('input', { type: 'checkbox', checked: false });
    const daysEl = U.h('select.select', {}, [2, 3, 4, 5, 6].map(function (d) {
      return U.h('option', { value: String(d), selected: d === 4 }, d + ' days a week');
    }));
    const splitEl = U.h('select.select', {},
      [U.h('option', { value: '' }, 'Choose for me')].concat(
        Object.keys(P.SPLITS).map(function (k) {
          return U.h('option', { value: k }, P.SPLITS[k].name);
        })));
    const everyEl = U.h('input.input.input-num', {
      type: 'number', min: '1', max: '52', value: '4', inputmode: 'numeric' });
    const unitEl = U.h('select.select', {}, [
      U.h('option', { value: 'days' }, 'days'),
      U.h('option', { value: 'weeks', selected: true }, 'weeks'),
      U.h('option', { value: 'months' }, 'months')
    ]);

    const blockBoxes = ['hypertrophy', 'strength', 'metabolite', 'deload'].map(function (id) {
      const on = id !== 'metabolite';
      const cb = U.h('input', { type: 'checkbox', checked: on });
      return { id: id, cb: cb, el: U.h('label.switch', { style: { alignItems: 'flex-start' } }, [
        cb, U.h('i.switch-track'),
        U.h('div', [
          U.h('div', { style: { fontWeight: '560' }, text: P.BLOCKS[id].name }),
          U.h('.u-xs.u-muted', { text: P.BLOCKS[id].hint })
        ])]) };
    });

    const equipWrap = U.h('.tag-row');
    const chosen = Object.create(null);
    const startKit = (s.equipment && s.equipment.length)
      ? s.equipment : P.KITS.commercial.equip;
    startKit.forEach(function (k) { chosen[k] = true; });
    if (s.allowBodyweight === false) delete chosen.bodyweight;

    Object.keys(App.Equipment).forEach(function (k) {
      const chip = U.h('button.chip.chip-btn' + (chosen[k] ? '.chip-accent' : ''), {
        type: 'button', text: App.Equipment[k],
        onclick: function () {
          if (chosen[k]) delete chosen[k]; else chosen[k] = true;
          this.classList.toggle('chip-accent', !!chosen[k]);
        }
      });
      equipWrap.appendChild(chip);
    });

    const presetRow = U.h('.tag-row', Object.keys(P.KITS).map(function (kid) {
      return U.h('button.chip.chip-btn', {
        type: 'button', text: P.KITS[kid].name,
        onclick: function () {
          Object.keys(chosen).forEach(function (k) { delete chosen[k]; });
          P.KITS[kid].equip.forEach(function (k) { chosen[k] = true; });
          U.$('.chip-btn', equipWrap).forEach(function (c, i) {
            const key = Object.keys(App.Equipment)[i];
            c.classList.toggle('chip-accent', !!chosen[key]);
          });
        }
      });
    }));

    U.modal({
      title: 'Generate a program',
      wide: true,
      body: function (b) {
        b.appendChild(U.h('.stack', [
          U.h('p.u-sm.u-muted', 'Volume being equal, no split and no periodisation ' +
            'model has been shown to out-grow another. What a rotation buys you is ' +
            'variety, a reason to change the load, and a lighter week before you need ' +
            'one — not a bigger number at the end.'),
          U.h('.grid.grid-2', [
            U.h('.field', [U.h('label.label', 'Name'), nameEl]),
            U.h('.field', [U.h('label.label', 'Base it on'), baseEl,
              U.h('.hint', 'Its movements are preferred wherever they fit.')])
          ]),
          U.h('.grid.grid-2', [
            U.h('.field', [U.h('label.label', 'Training days'), daysEl]),
            U.h('.field', [U.h('label.label', 'Split'), splitEl])
          ]),
          U.h('.field', [U.h('label.label', 'Move to the next phase every'),
            U.h('.row', [everyEl, unitEl])]),
          U.h('label.switch', { style: { alignItems: 'flex-start' } }, [
            repeatEl, U.h('i.switch-track'),
            U.h('div', [
              U.h('div', { style: { fontWeight: '560' } }, 'Permanent'),
              U.h('.u-xs.u-muted', 'Loops back to the first phase after the last. Off, it ' +
                'runs the phases once, finishes, and writes a report on whether you kept to it.')
            ])
          ]),
          U.h('.field', [U.h('label.label', 'Phases'),
            U.h('.stack-sm', blockBoxes.map(function (x) { return x.el; }))]),
          s.homeUnits && s.homeUnits.length ? U.h('.hint', 'Your home units from the Control Panel — ' +
            s.homeUnits.map(function (id) {
              const u = App.Programs.UNITS.find(function (x) { return x.id === id; });
              return u ? u.name : id;
            }).join(', ') + ' — add their stations to whatever you tick below.') : null,
          U.h('.field', [
            U.h('label.label', 'Equipment you can use'),
            presetRow,
            equipWrap,
            U.h('.hint', 'Bodyweight is a chip like any other — turn it off and no ' +
              'press-up or pull-up is ever picked for you.')
          ])
        ]));
      },
      actions: [
        { label: 'Cancel' },
        { label: 'Generate', kind: 'primary', onClick: function (close) {
          const kit = Object.keys(chosen);
          if (!kit.length) {
            U.toast('No equipment', 'Pick at least one thing to train with.', 'bad');
            return;
          }
          const blocks = blockBoxes.filter(function (x) { return x.cb.checked; })
            .map(function (x) { return x.id; });
          if (!blocks.length) {
            U.toast('No phases', 'A program needs at least one phase.', 'bad');
            return;
          }
          const plan = App.Programs.generate({
            name: nameEl.value || 'My program',
            base: baseEl.value ? App.Store.getProgram(baseEl.value) : null,
            units: s.homeUnits || [],
            repeat: repeatEl.checked,
            daysPerWeek: Number(daysEl.value) || 4,
            splitId: splitEl.value || null,
            kit: kit,
            blocks: blocks,
            rotateEvery: Math.max(1, Number(everyEl.value) || 4),
            rotateUnit: unitEl.value,
            settings: s
          });
          plan.program.warnings = plan.warnings;
          close();
          previewDialog(plan, kit);
        } }
      ]
    });
  }

  /** What it wrote, before anything is saved. */
  function previewDialog(plan, kit) {
    const byPhase = U.h('.stack');
    plan.program.phases.forEach(function (ph) {
      const days = U.h('.stack-sm');
      ph.workoutKeys.forEach(function (key) {
        const w = plan.workouts.find(function (x) { return x._key === key; });
        if (!w) return;
        days.appendChild(U.h('.wo-block', [
          U.h('div', { style: { fontWeight: '560' }, text: w.name.split(' · ').pop() }),
          U.h('.u-xs.u-muted', {
            text: w.items.map(function (it) {
              const ex = App.Store.getExercise(it.exerciseId);
              return (ex ? ex.name : it.exerciseId) + ' ' + it.sets.length + '×' +
                it.sets[0].reps;
            }).join(' · ')
          })
        ]));
      });
      byPhase.appendChild(U.h('div', [
        U.h('.label', { style: { marginTop: '10px' }, text: ph.name + ' — ' + ph.hint }),
        days
      ]));
    });

    U.modal({
      title: plan.program.name,
      wide: true,
      body: function (b) {
        b.appendChild(U.h('.stack', [
          U.h('p.u-sm.u-muted', App.Programs.SPLITS[plan.program.splitId].name + ' · ' +
            plan.program.daysPerWeek + ' days a week · one phase every ' +
            plan.program.rotateEvery + ' ' + plan.program.rotateUnit +
            (plan.program.repeat === false ? ' · runs once' : ' · permanent') +
            '. Weights come from your own logged best for each movement; a movement ' +
            'you have never done borrows from the closest one you have, scaled for how ' +
            'it is loaded, and anything with no near relative in your log is left blank. ' +
            'Each week into a phase the load steps up on the plan, and a hypertrophy ' +
            'phase adds a set from its third week.'),
          plan.warnings.length ? U.h('.sci-note', [
            U.h('.sci-note-title', 'What your equipment could not cover'),
            U.h('p.u-sm.u-muted', { text: plan.warnings.join(' ') })
          ]) : null,
          byPhase
        ]));
      },
      actions: [
        { label: 'Discard' },
        { label: 'Save the program', kind: 'primary', onClick: function (close) {
          App.Store.saveGenerated(plan).then(function (pg) {
            /* Remember the kit, so the next generate starts where this one did. */
            App.Store.saveSettings({
              equipment: kit,
              allowBodyweight: kit.indexOf('bodyweight') >= 0
            });
            close();
            U.toast('Program saved', pg.name + ' · ' + plan.workouts.length +
              ' workouts written', 'good');
            draw();
          });
        } }
      ]
    });
  }

  function workoutCard(w) {
    const st = App.Store.workoutStats(w);
    const split = App.Store.suggestSplit(w);
    const units = App.Store.getSettings().units;
    const figWrap = U.h('.anat-wrap');
    App.Anatomy.reserve(figWrap, { compact: true });
    setTimeout(function () {
      App.Anatomy.render(figWrap, st.heat, { compact: true, legend: false, max: 100 });
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

    /**
     * More sets for one muscle than a single session can use.
     *
     * Past about eleven sets for one muscle in one day, another set stops
     * producing a difference large enough for the research to detect. That is
     * worth SAYING, and it is not worth deducting: every set logged is counted
     * in full, and this note is advice about how to spend the next one.
     */
    function stackedNote(stacked) {
      if (!stacked || !stacked.length) return null;
      const top = stacked.slice(0, 3);
      return U.h('.sci-note', { style: { marginTop: '14px' } }, [
        U.h('.sci-note-title', { text: 'A lot for one day' }),
        U.h('p.u-sm.u-muted', { text: top.map(function (m) {
          return m.name + ' (' + U.num(m.sets, 1) + ' sets)';
        }).join(', ') + '. Past roughly ' + App.Science.SESSION_PUOS +
          ' sets for one muscle in a day, the trials stop being able to show ' +
          'that another one adds more — so the same work spread over two days ' +
          'is likely to go further. Every set you log still counts in full.' })
      ]);
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
        C.muscleList(st.heat, 10, { absolute: true }),
        stackedNote(st.stacked)
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

    /* -------------------------------------------------------------------------
       THE PLAN IS A STARTING POINT, THE LOG IS THE MEMORY

       A session opens with WHAT YOU ACTUALLY DID LAST TIME — the same weights,
       the same reps, and the same NUMBER of sets — falling back to the plan only
       for a movement that has never been logged. The plan's own sets and reps
       are therefore what the workout looked like on day one and nothing more;
       they are never rewritten by a session, and never need to be, because the
       log already remembers.

       Only one thing still belongs to the plan: WHICH MOVEMENTS are in it.
       Adding or dropping an exercise is a change to the workout itself rather
       than to one day of it, so that — and only that — is offered back to the
       template when the session is finished.

       Previously the set COUNT came from the plan even though the weights came
       from the log, so a fourth set added last week quietly disappeared this
       week while its weights were still being carried forward.
       ---------------------------------------------------------------------- */
    const previous = App.Store.allSessions().find(function (s) { return s.workoutId === w.id; });
    const previousHeat = previous ? App.Store.sessionsHeat([previous]) : null;

    /* A session that belongs to a PROGRAM opens with the plan as this week of
       the phase asks for it — the load stepped up, a set added — because that
       schedule is the whole point of being in a program. A plan weight that is
       still blank falls back to what was lifted last time, so a program written
       before any history still opens with a number. */
    const prog = App.Programs.progressionFor(w.id);

    function openingSets(it) {
      const prev = previous && (previous.entries || [])
        .find(function (e) { return e.exerciseId === it.exerciseId; });
      if (prog) {
        const ex = App.Store.getExercise(it.exerciseId);
        const planned = App.Programs.progressSets(it, ex, prog);
        return planned.map(function (s, i) {
          const fallback = prev && prev.sets && prev.sets[Math.min(i, prev.sets.length - 1)];
          return {
            weight: s.weight > 0 ? s.weight : Number(fallback && fallback.weight) || 0,
            reps: s.reps || Number(fallback && fallback.reps) || 0,
            done: false
          };
        });
      }
      const source = (prev && prev.sets && prev.sets.length) ? prev.sets : (it.sets || []);
      return source.map(function (s) {
        return { weight: Number(s.weight) || 0, reps: Number(s.reps) || 0, done: false };
      });
    }

    const session = resume ? resume.session : {
      workoutId: w.id,
      name: w.name,
      date: U.today(),
      entries: (w.items || []).map(function (it) {
        return { exerciseId: it.exerciseId, sets: openingSets(it), note: '' };
      })
    };

    if (!resume && prog) {
      U.toast(prog.program.name, prog.label, 'good');
    } else if (!resume && previous) {
      U.toast('Picked up from last time',
        'Sets, reps and weights are what you did on ' + U.fmtDate(previous.date) + '.');
    }

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
    /* The furthest entry (by plan position) that has had a set ticked done.
       A tick only drives the rest countdown when it reaches this far or
       further — see the done-button handler below for why. */
    let furthestEntryIdx = -1;
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

    /**
     * How the movements in this session differ from the plan it came from.
     * Compared against every entry on screen, not only the ones with a ticked
     * set: adding a movement and getting through none of it is still a
     * statement about what the workout should contain, and the dialog asks
     * before acting on it either way.
     */
    function templateDiff() {
      const planIds = (w.items || []).map(function (it) { return it.exerciseId; });
      const nowIds = session.entries.map(function (en) { return en.exerciseId; });
      return {
        added: nowIds.filter(function (id) { return planIds.indexOf(id) < 0; }),
        removed: planIds.filter(function (id) { return nowIds.indexOf(id) < 0; })
      };
    }

    function nameOf(id) {
      const ex = App.Store.getExercise(id);
      return ex ? ex.name : 'a deleted movement';
    }

    /** Write the session's MOVEMENT LIST back to the plan. Sets are untouched. */
    function applyToTemplate() {
      const items = session.entries.map(function (en) {
        const existing = (w.items || []).find(function (it) {
          return it.exerciseId === en.exerciseId;
        });
        /* Keep an existing item whole — its rest values and planned sets are
           the user's, and this is not the place to overwrite them. */
        if (existing) return existing;
        return {
          exerciseId: en.exerciseId,
          sets: en.sets.map(function (s) {
            return { weight: s.weight, reps: s.reps };
          })
        };
      });
      return App.Store.saveWorkout(Object.assign({}, w, { items: items }));
    }

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
        publishNow();
        return askAboutTemplate();
      }).then(function () {
        /* Back to the workout list, not the report. Finishing a session is
           not a request to go and read analysis — the next thing a person
           does at the end of a workout is put the phone away, and if they do
           want the numbers the report is one tap away in the nav. */
        App.Shell.navigate('workouts');
      });
    }

    /**
     * Get the session off this device the moment it is finished.
     *
     * Two separate things, and both are wanted: the session ROW goes to your
     * own project so the log survives the phone, and the public STATS row goes
     * to the hub so a friend opening your card sees the workout you just did
     * rather than the one before it. Waiting for the next scheduled push meant
     * a friend could be looking at day-old numbers while you were still in the
     * gym.
     *
     * Failures are deliberately quiet. The write is already queued in the
     * outbox and the normal sync will carry it; a red toast because the gym
     * wifi is bad would be alarming about nothing.
     */
    function publishNow() {
      const s = App.Store.getSettings();
      if (s.autoPublish === false) return;
      try {
        if (App.Sync.enabled()) App.Sync.schedulePush();
        if (App.Sync.signedIn()) App.Sync.publishStats();
      } catch (e) { /* the outbox still has it */ }
    }

    /**
     * Offered only when the movement list actually changed. A dialog that
     * appears after every session to report that nothing is different is a tap
     * to dismiss and nothing else.
     */
    function askAboutTemplate() {
      const diff = templateDiff();
      if (!diff.added.length && !diff.removed.length) return Promise.resolve();

      const parts = [];
      if (diff.added.length) {
        parts.push('Add ' + diff.added.map(nameOf).join(', '));
      }
      if (diff.removed.length) {
        parts.push('Remove ' + diff.removed.map(nameOf).join(', '));
      }

      return U.confirm({
        title: 'Update "' + w.name + '"?',
        message: parts.join('. ') + '. Your sets, reps and weights stay out of ' +
          'the plan either way — next time this workout opens with what you ' +
          'actually did today.',
        confirmLabel: 'Update the plan',
        cancelLabel: 'Leave it as it is'
      }).then(function (ok) {
        if (!ok) return;
        return applyToTemplate().then(function () {
          U.toast('Plan updated', w.name, 'good');
        });
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
      App.Anatomy.render(heatWrap, heat, { compact: true, legend: false, max: 100,
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

    /* Rest after a set: the plan's between-SET value while the exercise still
       has sets left, its between-EXERCISE value once the set just ticked was
       the last of them — so finishing a movement hands you the longer rest
       before the next one, never the short one meant for its own next set.
       (It used to always return the between-set value, regardless.)

       Looked up BY MOVEMENT, not by position. The runner's list and the plan's
       list stop lining up the moment an exercise is added, dropped or moved,
       and an index into the plan then hands back the rest interval belonging to
       whatever movement happens to sit at that slot. */
    function restFor(ei) {
      const en = session.entries[ei];
      const it = en && (w.items || []).find(function (x) {
        return x.exerciseId === en.exerciseId;
      });
      const finished = en && en.sets && en.sets.length > 0 &&
        en.sets.every(function (s) { return s.done; });
      if (finished) {
        return (it && it.restAfter) || App.Store.getSettings().restBetweenExercises;
      }
      return (it && it.restSets) || App.Store.getSettings().restDefault;
    }

    /** The most recent logged sets for a movement, so a new row is not blank. */
    function lastSetsFor(exerciseId, count) {
      const prevSession = App.Store.allSessions().find(function (s2) {
        return (s2.entries || []).some(function (e) { return e.exerciseId === exerciseId; });
      });
      const prevEntry = prevSession && prevSession.entries
        .find(function (e) { return e.exerciseId === exerciseId; });
      /* However many sets it was done in last time, not a fixed three. */
      const n = (prevEntry && prevEntry.sets && prevEntry.sets.length) || count;
      const out = [];
      for (let i = 0; i < n; i++) {
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
        /* Every later index just shifted down a slot, so the pointer no
           longer names the entry it used to. The next tick sets it fresh. */
        furthestEntryIdx = -1;
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
          /* What this movement says you can do, as of today. It is what turns
             a weight and a rep count into "that was two short of failure",
             which is the one thing about a set that a log cannot see and the
             growth research cares most about. */
          const reference = App.Store.referenceOneRM(en.exerciseId);

          en.sets.forEach(function (st, si) {
            const oneCell = U.h('span');
            const rirCell = U.h('span.set-rir');
            const e1rmCell = U.h('span.u-xs.u-muted.u-center.set-est',
              [oneCell, rirCell]);

            /* The estimate is the entire reason the weight and rep boxes sit
               next to each other, so it has to move as they are typed — not
               when the set is finally ticked. */
            function syncE1rm() {
              if (!st.weight || !st.reps) {
                oneCell.textContent = '—';
                rirCell.textContent = '';
                return;
              }
              oneCell.textContent = U.num(App.Ranks.e1rm(st.weight, st.reps, ex), 0);

              const load = Number(st.weight) *
                App.Ranks.loadFactor(ex, App.Store.getSettings()) +
                (ex && ex.equipment === 'bodyweight'
                  ? Number(App.Store.getSettings().bodyweight) || 0 : 0);
              const near = App.Science.proximity(load, st.reps, reference, ex);
              /* Rounded to whole reps and capped at "5+": the between-person
                 spread at these loads is two to four reps, so a decimal here
                 would be a precision the curve does not have. */
              if (!near) { rirCell.textContent = ''; return; }
              const rir = Math.round(near.rir);
              rirCell.textContent = 'RIR ' + (rir >= 5 ? '5+' : rir);
              rirCell.classList.toggle('is-hard', rir <= 1);
              rirCell.classList.toggle('is-easy', rir >= 4);
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
                  /* The rest countdown follows the workout forward. Ticking a
                     set for an exercise you have already moved past — catching
                     up on logging, or finishing everything before going back
                     to record it — must not reset or shorten whatever rest is
                     actually running now. That would charge training time for
                     admin the lifter did late, not for effort. */
                  if (st.done && ei >= furthestEntryIdx) {
                    furthestEntryIdx = ei;
                    restLeft = restFor(ei);
                  }
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
        prog ? U.h('span.chip', { text: prog.label, title: prog.program.name }) : null,
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

  /** The rest-timer tone, at the loudness set in the Control Panel. */
  function beep() { App.Sound.play(); }

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


      /* --- ONE LINE PER WORKOUT, THEN THEIR MEAN, THEN THE LINES ARE TAKEN
         AWAY AGAIN. Every exercise is indexed to its first value WITHIN THE
         WORKOUT it belongs to, each workout gets its own curve from those,
         and the headline is the mean of the curves. The workout lines are
         not drawn on the headline chart — six of them over one another is
         noise — but each is shown on its own underneath, on a shared scale,
         so a programme that is stalling can be told apart from one that is
         carrying the average. --- */
      const lines = workoutLines(sessions);
      const usable = lines.filter(function (l) { return l.points.length >= 2; });
      if (!usable.length) {
        body.appendChild(U.h('.empty', [
          U.h('div', { html: U.icon('chart') }),
          U.h('.empty-title', 'Not enough history yet'),
          U.h('p', 'Progress is measured per workout, so run the same workout at least ' +
            'twice in this period to get its curve and the average across all of them.')
        ]));
        return;
      }
      const avgSeries = meanLine(usable);
      const fit = avgSeries.length >= 2 ? App.Charts.regress(avgSeries.map(function (p) {
        return { x: p.x, y: p.y };
      })) : null;

      const chartEl = U.h('div');
      body.appendChild(U.h('.sec-head', [
        U.h('h2', 'Average progress across every workout'),
        U.h('.spacer'),
        fit ? slopeChip(fit) : null
      ]));
      body.appendChild(U.h('.card-sub', { style: { marginBottom: '8px' } },
        'The mean of ' + usable.length + ' workout curve' + (usable.length === 1 ? '' : 's') +
        ' — each exercise indexed to its first session of that workout, so every ' +
        'lift counts equally.'));
      body.appendChild(chartEl);

      /* FORECAST, 60 days beyond the last point.

         A straight line through the past is only a forecast while the past is
         going somewhere. When the trend is flat or falling, carrying it on
         says "you will keep getting weaker" — and a person looking at this
         chart is training, which is the one thing a regression on old
         sessions cannot see. So the projection has two shapes:

           rising trend    the least-squares line, as before
           flat or falling the TRAINING RESPONSE: the slide stops, the number
                           holds for about two weeks (nothing changes faster
                           than that — the first weeks of a block are learning
                           the loads), then growth resumes along a saturating
                           curve to a modest +6 index points over the horizon,
                           which is an ordinary intermediate's two months

         The band says how sure this is: narrow near today, wider with every
         week out, and wider still when the fit was poor. */
      const DAY = 86400000;
      const series = [{ name: 'Average of all workouts', accent: true, area: true, points: avgSeries }];
      const bands = [];
      let forecastKind = null;
      if (fit && fit.n >= 3) {
        const last = avgSeries[avgSeries.length - 1];
        const horizon = 60 * DAY;
        const perMonth = fit.slope * DAY * 30;
        const rising = perMonth >= 1;
        forecastKind = rising ? 'trend' : 'response';
        const LAG = 14, TAU = 26, GAIN = 6;
        const fc = [];
        const band = [];
        for (let i = 0; i <= 12; i++) {
          const x = last.x + (horizon * i) / 12;
          const days = (x - last.x) / DAY;
          let y;
          if (rising) {
            y = fit.at(x);
          } else {
            const t = Math.max(0, days - LAG);
            y = last.y + GAIN * (1 - Math.exp(-t / TAU));
          }
          fc.push({ x: x, y: y });
          /* widen with distance, as a projection should */
          const spread = (fit.se || Math.abs(y) * 0.03) * (1 + i * 0.25);
          band.push({ x: x, lo: y - spread, hi: y + spread });
        }
        series.push({ name: rising ? 'Forecast (60d)' : 'Expected with training (60d)',
          dash: true, dots: false, points: fc });
        bands.push({ points: band });
      }

      setTimeout(function () {
        App.Charts.line(chartEl, {
          xType: 'date', height: 240, series: series, bands: bands,
          yFormat: function (v) { return U.num(v, 0) + '%'; }
        });
        if (fit) {
          chartEl.appendChild(U.h('.u-xs.u-muted', { style: { marginTop: '8px' },
            text: 'Least-squares fit over ' + fit.n + ' points · r² = ' +
              U.num(fit.r2, 2) + (fit.r2 < 0.3
                ? ' — a weak fit, so treat the projection as a rough direction only.'
                : '') }));
          if (forecastKind === 'response') {
            chartEl.appendChild(U.h('.u-xs.u-muted', { style: { marginTop: '4px' },
              text: 'The trend so far is ' + (fit.slope < 0 ? 'falling' : 'flat') +
                '. A straight line would carry that on, but you are training now, ' +
                'so the projection assumes the slide stops, holds for about two ' +
                'weeks, and then growth resumes — a modest +6% over the two months.' }));
          }
        }
      }, 0);

      /* --- each workout on its own, on one shared scale --- */
      let lo = Infinity, hi = -Infinity;
      usable.forEach(function (l) {
        l.points.forEach(function (p) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); });
      });
      body.appendChild(U.h('.sec-head', { style: { marginTop: '28px' } }, [
        U.h('h2', 'Per workout'),
        U.h('.spacer'),
        U.h('span.u-xs.u-muted', 'Same scale on every chart')
      ]));
      const wgrid = U.h('.grid.grid-2', { style: { marginTop: '14px' } });
      usable.forEach(function (l) {
        const wfit = App.Charts.regress(l.points.map(function (p) {
          return { x: p.x, y: p.y };
        }));
        const cell = U.h('.card', { style: { padding: 'var(--sp-4)' } }, [
          U.h('.card-head', { style: { marginBottom: '8px' } }, [
            U.h('div', { style: { minWidth: 0 } }, [
              U.h('div', { class: 'u-truncate', style: { fontWeight: '600' }, text: l.name }),
              U.h('.u-xs.u-muted', { text: l.sessions + ' session' +
                (l.sessions === 1 ? '' : 's') + ' · ' + l.exercises + ' exercise' +
                (l.exercises === 1 ? '' : 's') })
            ]),
            U.h('.spacer'),
            wfit ? slopeChip(wfit) : null
          ])
        ]);
        const c = U.h('div');
        cell.appendChild(c);
        wgrid.appendChild(cell);
        setTimeout(function () {
          App.Charts.line(c, {
            xType: 'date', height: 150, legend: false, yMin: lo, yMax: hi,
            yFormat: function (v) { return U.num(v, 0) + '%'; },
            series: [{ name: l.name, accent: true, area: true, points: l.points }]
          });
        }, 0);
      });
      body.appendChild(wgrid);
      lines.filter(function (l) { return l.points.length < 2; }).forEach(function (l) {
        body.appendChild(U.h('.u-xs.u-muted', { style: { marginTop: '8px' },
          text: l.name + ' has only one session in this period, so it has no curve yet ' +
            'and is left out of the average.' }));
      });

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

  /** "+3.2% / month" as a chip, tinted when the direction is up. */
  function slopeChip(fit) {
    return U.h('span.chip' + (fit.slope > 0 ? '.chip-accent' : ''), {
      text: (fit.slope >= 0 ? '+' : '') + U.num(fit.slope * 86400000 * 30, 1) + '% / month'
    });
  }

  /**
   * One curve per workout. Sessions are grouped by the workout they were run
   * from (ad-hoc sessions form a group of their own), and within a group each
   * session's value is the mean, across its exercises, of that exercise's
   * estimated 1RM as a percentage of its FIRST value in the group. Indexing
   * per workout matters: a bench press that lives in two programmes is
   * baselined in each, so a heavier day in one does not read as a jump in the
   * other. Multiple sessions on one day collapse to their mean.
   */
  function workoutLines(sessions) {
    const groups = Object.create(null);
    const order = [];
    sessions.forEach(function (s) {
      const key = s.workoutId || '_adhoc';
      if (!groups[key]) {
        const w = s.workoutId ? App.Store.getWorkout(s.workoutId) : null;
        groups[key] = {
          id: key,
          name: (w && w.name) || (s.workoutId && s.name) || 'Unplanned sessions',
          list: []
        };
        order.push(key);
      }
      groups[key].list.push(s);
    });

    return order.map(function (key) {
      const g = groups[key];
      const baseline = Object.create(null);
      const byDay = Object.create(null);
      const seen = Object.create(null);
      g.list.forEach(function (s) {
        const ratios = [];
        (s.entries || []).forEach(function (en) {
          const one = App.Ranks.bestE1RM(en.sets, App.Store.getExercise(en.exerciseId));
          if (!one) return;
          if (!baseline[en.exerciseId]) baseline[en.exerciseId] = one;
          seen[en.exerciseId] = true;
          ratios.push((one / baseline[en.exerciseId]) * 100);
        });
        if (!ratios.length) return;
        const mean = ratios.reduce(function (a, b) { return a + b; }, 0) / ratios.length;
        const x = new Date(s.date + 'T12:00:00').getTime();
        (byDay[x] = byDay[x] || []).push(mean);
      });
      const points = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; })
        .map(function (x) {
          const arr = byDay[x];
          return { x: x, y: arr.reduce(function (a, b) { return a + b; }, 0) / arr.length };
        });
      return { id: g.id, name: g.name, sessions: g.list.length,
        exercises: Object.keys(seen).length, points: points };
    });
  }

  /**
   * The mean of several curves that were not sampled on the same days. Every
   * date any curve has a point on becomes a date on the mean; each curve
   * contributes its value there, interpolated between its own neighbours,
   * and only while the date lies inside that curve's own span — a workout
   * that was not being run yet, or has been dropped, does not get a value
   * invented for it.
   */
  function meanLine(lines) {
    const xs = Object.create(null);
    lines.forEach(function (l) { l.points.forEach(function (p) { xs[p.x] = true; }); });
    return Object.keys(xs).map(Number).sort(function (a, b) { return a - b; })
      .map(function (x) {
        const vals = [];
        lines.forEach(function (l) {
          const p = l.points;
          if (x < p[0].x || x > p[p.length - 1].x) return;
          for (let i = 0; i < p.length; i++) {
            if (p[i].x === x) { vals.push(p[i].y); return; }
            if (p[i].x > x) {
              const a = p[i - 1], b = p[i];
              vals.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
              return;
            }
          }
        });
        if (!vals.length) return null;
        return { x: x, y: vals.reduce(function (a, b) { return a + b; }, 0) / vals.length };
      }).filter(Boolean);
  }

  App.Pages = App.Pages || {};
  App.Pages.workouts = { render: render, onDataChange: onDataChange };
})(window.App = window.App || {});
