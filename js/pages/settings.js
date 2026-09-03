/* =============================================================================
   pages/settings.js — Control Panel

   Sections: profile · appearance · your Supabase (setup wizard) · account ·
             friends · data management · diagnostics
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U, C = App.C;
  let root = null;

  let unbindSync = null;

  function render(el) {
    root = el;
    if (unbindSync) unbindSync();
    /* Sign-in, sign-out and auto-connect all resolve asynchronously. Without
       this the panel keeps showing whatever was true when it first painted. */
    unbindSync = App.Store.on('sync', function () {
      if (root && root.isConnected && !document.querySelector('.modal-root')) draw();
    });
    draw();
  }
  function onDataChange() { /* rebuilt on demand; avoid clobbering form input */ }

  function draw() {
    U.clear(root);
    App.Shell.setTopActions([
      U.h('span.chip', { text: 'v' + App.VERSION })
    ]);
    root.appendChild(profileCard());
    root.appendChild(exercisesCard());
    root.appendChild(appearanceCard());
    /* Account comes before the project section: linking a Supabase project
       requires one, so asking for it first is the honest order. */
    root.appendChild(accountCard());
    root.appendChild(supabaseCard());
    root.appendChild(friendsCard());
    root.appendChild(dataCard());
    root.appendChild(diagnosticsCard());
    root.appendChild(aboutCard());
  }

  function aboutCard() {
    const status = U.h('.u-xs.u-muted');
    return U.h('.card', [
      U.h('.row.row-wrap', [
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('div', { style: { fontWeight: '620' }, text: 'AI-Gym ' + App.VERSION }),
          U.h('.u-xs.u-muted', 'Offline-first training log. Your data stays on this ' +
            'device unless you link a project.'),
          /* The button beside this is a convenience, not the mechanism. Saying
             so stops it reading as the only way an update is ever found. */
          U.h('.u-xs.u-muted', 'Checked automatically every time you open the app. ' +
            'This button asks now.'),
          status
        ]),
        U.h('.spacer'),
        U.h('button.btn.btn-sm', {
          type: 'button', html: U.icon('refresh') + '<span>Check for updates</span>',
          onclick: function () {
            const btn = this;
            btn.disabled = true;
            status.textContent = 'Checking…';
            App.Update.check(true).then(function (found) {
              if (found) { btn.disabled = false; status.textContent = '';
                App.Update.prompt(found); return; }
              /* An up-to-date app can still be pointing at an out-of-date
                 project, which is the failure that actually blocks uploads. */
              return App.Update.checkSchema().then(function (st) {
                btn.disabled = false;
                if (st) { status.textContent = ''; App.Update.promptSchema(st); }
                else status.textContent = 'App and project are both up to date.';
              });
            }).catch(function (e) {
              btn.disabled = false;
              status.textContent = 'Could not check: ' + e.message;
            });
          }
        })
      ]),
      U.h('div', { style: { marginTop: '14px' } }, [
        C.linkRow(App.Update.VERSION_URL, {
          label: 'Releases on GitHub',
          hint: 'Opens outside the app where possible; otherwise copy the link.'
        })
      ])
    ]);
  }

  /* ===========================================================================
     PROFILE
     ======================================================================== */

  /** "90" -> "90 seconds (1:30)." — the unit, spelled out. */
  function secondsHint(v) {
    v = Math.max(0, Math.round(Number(v) || 0));
    if (!v) return 'No rest — the timer is skipped.';
    return v + ' seconds' + (v >= 60 ? ' (' + U.dur(v) + ')' : '') + '.';
  }

  function soundHintFor(id) {
    const k = App.Sound.KINDS.find(function (x) { return x.id === id; });
    return k ? k.hint : '';
  }

  /** "60" -> "60% — plays when a rest runs out." */
  function volumeHintFor(v) {
    v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    if (!v) return 'Muted — the timer will end silently.';
    return v + '% — plays when a rest runs out.';
  }

  function profileCard() {
    const s = App.Store.getSettings();
    const restSetHint = U.h('.hint', { text: secondsHint(s.restDefault) });
    const weeklyHint = U.h('.hint', { text: weeklySetsHint(s.weeklySets) });
    const restExHint = U.h('.hint', { text: secondsHint(s.restBetweenExercises) });
    const sound = s.restSound || 'chime';
    const volume = s.restVolume === undefined ? 60 : s.restVolume;
    const soundHint = U.h('.hint', { text: soundHintFor(sound) });
    const volumeHint = U.h('.hint', { text: volumeHintFor(volume) });
    return U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Profile'),
          U.h('.card-sub', 'Used for strength standards and for what friends see.')
        ])
      ]),
      U.h('.grid.grid-3', [
        U.h('.field', [
          U.h('label.label', 'Display name'),
          U.h('input.input', { value: s.name, placeholder: 'Your name',
            onchange: function () { App.Store.saveSettings({ name: this.value }); } })
        ]),
        U.h('.field', [
          U.h('label.label', 'Bodyweight'),
          U.h('input.input.input-num', { type: 'number', min: '20', max: '400', step: '0.5',
            value: s.bodyweight,
            onchange: function () {
              App.Store.saveSettings({ bodyweight: Number(this.value) || 80 });
              U.toast('Saved', 'Strength scores recalculated.');
            } }),
          U.h('.hint', 'Rank scores are relative to bodyweight.')
        ]),
        U.h('.field', [
          U.h('label.label', 'Units'),
          U.h('select.select', {
            onchange: function () { App.Store.saveSettings({ units: this.value }); }
          }, [
            U.h('option', { value: 'kg', selected: s.units === 'kg' }, 'Kilograms (kg)'),
            U.h('option', { value: 'lb', selected: s.units === 'lb' }, 'Pounds (lb)')
          ])
        ])
      ]),
      /* BOTH OF THESE ARE SECONDS, and neither field said so. "90" with no unit
         reads as a minute and a half or as an hour and a half depending on what
         the reader brought with them, and the rest timer that follows is then
         wrong by a factor of sixty. The unit is now in the label, beside the
         field, and restated underneath as a clock value. */
      U.h('.grid.grid-2', [
        U.h('.field', [
          U.h('label.label', 'Default rest between sets (seconds)'),
          U.h('.row', [
            U.h('input.input.input-num', { type: 'number', min: '0', step: '5',
              value: s.restDefault, inputmode: 'numeric',
              onchange: function () {
                const v = Number(this.value) || 90;
                App.Store.saveSettings({ restDefault: v });
                restSetHint.textContent = secondsHint(v);
              } }),
            U.h('span.u-sm.u-muted', 'sec')
          ]),
          restSetHint
        ]),
        U.h('.field', [
          U.h('label.label', 'Default rest between exercises (seconds)'),
          U.h('.row', [
            U.h('input.input.input-num', { type: 'number', min: '0', step: '15',
              value: s.restBetweenExercises, inputmode: 'numeric',
              onchange: function () {
                const v = Number(this.value) || 150;
                App.Store.saveSettings({ restBetweenExercises: v });
                restExHint.textContent = secondsHint(v);
              } }),
            U.h('span.u-sm.u-muted', 'sec')
          ]),
          restExHint
        ])
      ]),
      /* THE TONE THAT ENDS A REST, AND HOW LOUD IT IS. The timer used to play
         one fixed beep at one fixed level, which was too quiet on a gym floor
         and too much in a quiet room. Both are now settings, and the play
         button lets them be judged before a rest depends on them. */
      U.h('.grid.grid-2', [
        U.h('.field', [
          U.h('label.label', 'Rest timer sound'),
          U.h('.row', [
            U.h('select.select', {
              onchange: function () {
                App.Store.saveSettings({ restSound: this.value });
                soundHint.textContent = soundHintFor(this.value);
                App.Sound.play(this.value);
              }
            }, App.Sound.KINDS.map(function (k) {
              return U.h('option', { value: k.id, selected: sound === k.id }, k.name);
            })),
            U.h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Play the rest sound',
              html: U.icon('play') + '<span>Play</span>',
              onclick: function () {
                const s2 = App.Store.getSettings();
                if (s2.restSound === 'off') { U.toast('Silent', 'Pick a sound to hear it.'); return; }
                if (!App.Sound.play()) {
                  U.toast('No sound', 'This device blocked audio. Tap again after ' +
                    'unmuting.', 'bad');
                }
              } })
          ]),
          soundHint
        ]),
        U.h('.field', [
          U.h('label.label', 'Loudness'),
          U.h('.row', [
            U.h('input.range', { type: 'range', min: '0', max: '100', step: '5',
              value: volume, 'aria-label': 'Rest sound loudness',
              oninput: function () { volumeHint.textContent = volumeHintFor(this.value); },
              onchange: function () {
                const v = Math.max(0, Math.min(100, Number(this.value) || 0));
                App.Store.saveSettings({ restVolume: v });
                volumeHint.textContent = volumeHintFor(v);
                App.Sound.play(undefined, v);
              } })
          ]),
          volumeHint
        ])
      ]),
      /* THE ONE NUMBER THE HEAT FIGURES ARE SCORED AGAINST.
         It is a setting rather than a constant because the dose-response
         research does not find a ceiling: size keeps rising with weekly sets,
         with diminishing returns, as far out as the data goes. Twelve is the
         middle of the range where the returns are still clearly worth having,
         and someone running a higher-volume programme is not wrong — their
         figures should just be scored against what they are actually doing. */
      U.h('.grid.grid-2', [
        U.h('.field', [
          U.h('label.label', 'Weekly hard sets per muscle'),
          U.h('.row', [
            U.h('input.input.input-num', { type: 'number', min: '4', max: '40', step: '1',
              value: s.weeklySets, inputmode: 'numeric',
              onchange: function () {
                const v = Math.min(40, Math.max(4, Number(this.value) || 12));
                this.value = v;
                App.Store.saveSettings({ weeklySets: v });
                weeklyHint.textContent = weeklySetsHint(v);
                U.toast('Saved', 'Heat figures rescored.');
              } }),
            U.h('span.u-sm.u-muted', 'sets')
          ]),
          weeklyHint
        ])
      ])
    ]);
  }

  /**
   * What a weekly set target means, in the words of the evidence behind it.
   * Ten to twenty is where the meta-regressions put returns that are still
   * clearly worth having; below and above that the sentence should change,
   * because the number has stopped meaning the same thing.
   */
  function weeklySetsHint(v) {
    if (v < 8) return v + ' sets a week per muscle — below where the dose-response ' +
      'research finds most of the growth. Fine as a maintenance target.';
    if (v <= 20) return v + ' sets a week per muscle, which is inside the range ' +
      'the volume meta-regressions find worth training in.';
    return v + ' sets a week per muscle — past this the returns per set are small, ' +
      'and no single session can absorb more than about eleven of them.';
  }

  /* ===========================================================================
     EXERCISES
     ======================================================================== */

  /**
   * The account-wide reading of a dumbbell weight.
   *
   * A pair of 40s is logged as 40, not 80 — that is simply how people write it
   * down. Taken literally it made every two-dumbbell movement score as half the
   * strength it represented, so the app needs to be told which convention the
   * number follows. Per-hand is the default because it is what nearly everyone
   * does; an individual exercise can still disagree, from its own editor.
   */
  function exercisesCard() {
    const s = App.Store.getSettings();
    const counts = App.Store.allExercises().reduce(function (a, ex) {
      if (App.Ranks.pairedEquipment(ex.equipment)) {
        a.paired++;
        if (ex.loadMode === 'per-hand' || ex.loadMode === 'total') a.overridden++;
      }
      return a;
    }, { paired: 0, overridden: 0 });

    return U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Exercises'),
          U.h('.card-sub', 'Defaults applied to every movement that does not ' +
            'override them itself.')
        ])
      ]),
      U.h('.field', [
        U.h('label.label', 'Dumbbell and kettlebell weights are logged as'),
        U.h('select.select', {
          onchange: function () {
            App.Store.saveSettings({ dumbbellLoad: this.value });
            U.toast('Saved', 'Strength scores recalculated.');
            draw();
          }
        }, [
          U.h('option', { value: 'per-hand', selected: s.dumbbellLoad !== 'total' },
            App.Ranks.LOAD_LABELS['per-hand'] + ' \u2014 the weight of ONE dumbbell'),
          U.h('option', { value: 'total', selected: s.dumbbellLoad === 'total' },
            App.Ranks.LOAD_LABELS.total + ' \u2014 both dumbbells added together')
        ]),
        U.h('.hint', s.dumbbellLoad === 'total'
          ? 'Double arm / leg: for a pair of 40s you write down 80, and it counts ' +
            'as 80 of work exactly as written.'
          : 'Single arm / leg: for a pair of 40s you write down 40. That counts as ' +
            '80 of work, and world records are shown per side. Unilateral ' +
            'movements \u2014 one limb at a time \u2014 are never doubled, because ' +
            'there is only one implement to start with.'),
        U.h('.u-xs.u-muted', { text: counts.paired + ' movement' +
          (counts.paired === 1 ? '' : 's') + ' use paired equipment' +
          (counts.overridden
            ? ', ' + counts.overridden + ' with their own setting'
            : '') + '.' })
      ]),
      groupOrderField(s)
    ]);
  }

  /* ---------------------------------------------------------------------------
     MUSCLE-GROUP ORDER

     "Group by muscle group" in the workout builder listed its groups
     alphabetically — arms, back, chest, core, legs — which is not an order
     anybody trains in. The order can now be stated once, with templates for the
     specific splits the user runs.

     A template applies only when the day's groups are EXACTLY its groups, which
     is what keeps a Push template from reordering a full-body session that
     merely happens to include chest. Everything else uses the general order.
     ------------------------------------------------------------------------ */

  function groupOrderConfig(s) {
    const raw = (s && s.groupOrder) || {};
    return {
      enabled: !!raw.enabled,
      general: Array.isArray(raw.general) && raw.general.length
        ? raw.general.slice()
        : App.Muscles.DEFAULT_GROUP_ORDER.slice(),
      templates: Array.isArray(raw.templates) ? raw.templates.slice() : []
    };
  }

  /**
   * @param {Object}  cfg
   * @param {boolean} [redraw]  rebuild the page — needed when the card's shape
   *                            changes (toggled on/off, a template added or
   *                            removed), but not for a reorder, where redrawing
   *                            would replace the button under the user's finger
   *                            and drop focus between clicks.
   */
  function saveGroupOrder(cfg, redraw) {
    App.Store.saveSettings({ groupOrder: cfg });
    if (redraw !== false) draw();
  }

  /**
   * A reorderable list of muscle groups.
   *
   * @param {string[]} order     the groups to show, in their current order
   * @param {Function} onChange  (nextOrder) -> void
   */
  function orderEditor(order, onChange) {
    const list = order.slice();

    function move(i, delta) {
      const j = i + delta;
      if (j < 0 || j >= list.length) return;
      const copy = list.slice();
      const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
      /* The row that moved is named so the caller can put focus back on it
         after the repaint — otherwise a keyboard user loses their place on
         every single press, and a run of moves means re-tabbing each time. */
      onChange(copy, { group: list[i], dir: delta });
    }

    return U.h('.group-order', { dataset: { order: '' } }, list.map(function (g, i) {
      const name = (App.Muscles.GROUPS[g] || {}).name || g;
      return U.h('.group-order-row', { dataset: { group: g } }, [
        U.h('span.group-order-n', { text: String(i + 1) }),
        U.h('span', { style: { flex: '1', minWidth: 0 }, text: name }),
        U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
          type: 'button', 'aria-label': 'Move ' + name + ' up',
          dataset: { dir: 'up' },
          disabled: i === 0, html: U.icon('chevron', 'ico-up'),
          onclick: function () { move(i, -1); }
        }),
        U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
          type: 'button', 'aria-label': 'Move ' + name + ' down',
          dataset: { dir: 'down' },
          disabled: i === list.length - 1, html: U.icon('chevron', 'ico-down'),
          onclick: function () { move(i, 1); }
        })
      ]);
    }));
  }

  /** Put focus back on the same control of the row that just moved. */
  function refocusMoved(wrap, moved) {
    if (!moved || !moved.group) return;
    const row = wrap.querySelector('.group-order-row[data-group="' + moved.group + '"]');
    if (!row) return;
    const btn = row.querySelector('button[data-dir="' + (moved.dir < 0 ? 'up' : 'down') + '"]');
    /* At either end that button is disabled, so fall back to the other one
       rather than dropping focus to the body. */
    const target = btn && !btn.disabled ? btn : row.querySelector('button:not([disabled])');
    if (target) target.focus();
  }

  function groupOrderField(s) {
    const cfg = groupOrderConfig(s);
    const body = U.h('.stack');

    if (cfg.enabled) {
      body.appendChild(U.h('.label', { style: { marginTop: '14px' } }, 'General order'));
      body.appendChild(U.h('.hint',
        'Used whenever the day does not match a template exactly.'));

      /* Swapped in place on every move so the arrows stay put and keyboard
         focus survives a run of clicks. */
      const generalWrap = U.h('div');
      function paintGeneral(moved) {
        U.clear(generalWrap);
        generalWrap.appendChild(orderEditor(cfg.general, function (next, m) {
          cfg.general = next;
          saveGroupOrder(cfg, false);
          paintGeneral(m);
        }));
        refocusMoved(generalWrap, moved);
      }
      paintGeneral(null);
      body.appendChild(generalWrap);

      body.appendChild(U.h('.row', { style: { marginTop: '18px', alignItems: 'center' } }, [
        U.h('.label', { style: { margin: '0', flex: '1' } }, 'Templates'),
        U.h('button.btn.btn-sm', {
          type: 'button', html: U.icon('plus') + '<span>Add</span>',
          onclick: function () { editTemplate(cfg, null); }
        })
      ]));
      body.appendChild(U.h('.hint',
        'A template is followed only when the groups trained that day are ' +
        'exactly the ones it lists — no more, no fewer.'));

      if (!cfg.templates.length) {
        body.appendChild(U.h('.u-xs.u-muted', { style: { marginTop: '8px' },
          text: 'No templates yet, so everything uses the general order.' }));
      } else {
        cfg.templates.forEach(function (t, i) {
          body.appendChild(U.h('.tpl-row', [
            U.h('div', { style: { flex: '1', minWidth: 0 } }, [
              U.h('.ex-name', { text: t.name || 'Untitled' }),
              U.h('.ex-meta', [
                U.h('span', { text: (t.groups || []).map(function (g) {
                  return (App.Muscles.GROUPS[g] || {}).name || g;
                }).join(' → ') || 'no groups' })
              ])
            ]),
            U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
              type: 'button', 'aria-label': 'Edit ' + (t.name || 'template'),
              html: U.icon('edit'),
              onclick: function () { editTemplate(cfg, i); }
            }),
            U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
              type: 'button', 'aria-label': 'Delete ' + (t.name || 'template'),
              html: U.icon('trash'),
              onclick: function () {
                U.confirm({
                  title: 'Delete "' + (t.name || 'Untitled') + '"?',
                  message: 'Days matching it will fall back to the general order.',
                  confirmLabel: 'Delete', danger: true
                }).then(function (ok) {
                  if (!ok) return;
                  cfg.templates.splice(i, 1);
                  saveGroupOrder(cfg);
                });
              }
            })
          ]));
        });
      }
    }

    return U.h('.field', { style: { marginTop: '18px' } }, [
      U.h('label.switch', [
        U.h('input', {
          type: 'checkbox', checked: cfg.enabled,
          onchange: function () { cfg.enabled = this.checked; saveGroupOrder(cfg); }
        }),
        U.h('i.switch-track'),
        U.h('span', 'Set my own muscle-group order')
      ]),
      U.h('.hint', cfg.enabled
        ? 'Applied wherever a workout is grouped by muscle group.'
        : 'Off — grouped workouts follow chest, back, shoulders, arms, legs, core, neck.'),
      body
    ]);
  }

  /** Add or edit one template. */
  function editTemplate(cfg, index) {
    const existing = index == null ? null : cfg.templates[index];
    const draft = {
      id: (existing && existing.id) || U.uid(),
      name: (existing && existing.name) || '',
      groups: (existing && Array.isArray(existing.groups)) ? existing.groups.slice() : []
    };

    const nameInput = U.h('input.input', {
      type: 'text', placeholder: 'Push day', value: draft.name, maxlength: '40'
    });
    const orderWrap = U.h('div');
    const warn = U.h('.hint');

    function redrawOrder(moved) {
      U.clear(orderWrap);
      if (!draft.groups.length) {
        orderWrap.appendChild(U.h('.u-xs.u-muted',
          'Tick the groups this day trains, then arrange them.'));
      } else {
        orderWrap.appendChild(orderEditor(draft.groups, function (next, m) {
          draft.groups = next;
          redrawOrder(m);
        }));
        refocusMoved(orderWrap, moved);
      }

      /* Two templates covering the same set is not an error, but only the first
         can ever win, so say so rather than letting the second look active. */
      const clash = cfg.templates.some(function (t, i) {
        return i !== index && App.Muscles.matchTemplate(draft.groups, [t]);
      });
      warn.textContent = clash
        ? 'Another template already covers exactly these groups, and it is matched first.'
        : '';
    }

    const picks = U.h('.group-picks', App.Muscles.DEFAULT_GROUP_ORDER.map(function (g) {
      return U.h('label.switch', [
        U.h('input', {
          type: 'checkbox', checked: draft.groups.indexOf(g) >= 0,
          onchange: function () {
            if (this.checked) {
              if (draft.groups.indexOf(g) < 0) draft.groups.push(g);
            } else {
              draft.groups = draft.groups.filter(function (x) { return x !== g; });
            }
            redrawOrder();
          }
        }),
        U.h('i.switch-track'),
        U.h('span.u-xs', (App.Muscles.GROUPS[g] || {}).name || g)
      ]);
    }));

    redrawOrder();

    U.modal({
      title: index == null ? 'New template' : 'Edit template',
      body: U.h('.stack', [
        U.h('.field', [U.h('label.label', 'Name'), nameInput]),
        U.h('.field', [
          U.h('label.label', 'Groups this day trains'),
          picks
        ]),
        U.h('.field', [U.h('label.label', 'Order'), orderWrap, warn])
      ]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save', kind: 'primary',
          onClick: function (close) {
            if (!draft.groups.length) {
              U.toast('Not saved', 'A template needs at least one muscle group.');
              return;
            }
            draft.name = nameInput.value.trim() || 'Untitled';
            if (index == null) cfg.templates.push(draft);
            else cfg.templates[index] = draft;
            close();
            saveGroupOrder(cfg);
          }
        }
      ]
    });
  }

  /* ===========================================================================
     APPEARANCE
     ======================================================================== */

  function appearanceCard() {
    const s = App.Store.getSettings();

    const modes = [
      { id: 'light', label: 'Light', icon: 'sun' },
      { id: 'dark', label: 'Dark', icon: 'moon' },
      { id: 'amoled', label: 'AMOLED', icon: 'moon' }
    ];

    const modeGrid = U.h('.mode-grid', modes.map(function (m) {
      return U.h('button.mode-opt' + (s.mode === m.id ? '.is-active' : ''), {
        type: 'button', dataset: { mode: m.id },
        onclick: function () {
          App.Store.saveSettings({ mode: m.id });
          U.$$('.mode-opt', root).forEach(function (b) {
            b.classList.toggle('is-active', b.dataset.mode === m.id);
          });
        }
      }, [
        U.h('i.mode-swatch', { style: {
          background: m.id === 'light' ? '#f6f7f9' : m.id === 'dark' ? '#171c23' : '#000',
          borderColor: m.id === 'light' ? '#c3cad6' : '#2b3039'
        } }),
        U.h('span', { html: U.icon(m.icon) + ' ' + U.esc(m.label) })
      ]);
    }));

    const schemeGrid = U.h('.scheme-grid', App.Shell.SCHEMES.map(function (sc) {
      return U.h('button.scheme-opt' + (s.scheme === sc.id ? '.is-active' : ''), {
        type: 'button', dataset: { scheme: sc.id },
        onclick: function () {
          App.Store.saveSettings({ scheme: sc.id });
          U.$$('.scheme-opt', root).forEach(function (b) {
            b.classList.toggle('is-active', b.dataset.scheme === sc.id);
          });
        }
      }, [
        U.h('i.scheme-ramp', { dataset: { scheme: sc.id } }),
        U.h('span.scheme-name', { text: sc.name })
      ]);
    }));

    /* Paint each swatch with its OWN scheme's ramp rather than the active one.
       The probe has to be read through --c1..--c5, not --heat-*: a custom
       property whose value contains var() is resolved on the element that
       declares it, so --heat-* inherited from <html> would still carry the
       currently selected scheme's colours. */
    setTimeout(function () {
      const reversed = App.Store.getSettings().mode === 'light';
      U.$$('.scheme-ramp', schemeGrid).forEach(function (el) {
        const probe = document.createElement('div');
        probe.setAttribute('data-scheme', el.dataset.scheme);
        probe.style.display = 'none';
        document.body.appendChild(probe);
        const cs = getComputedStyle(probe);
        let stops = [1, 2, 3, 4, 5].map(function (i) {
          return cs.getPropertyValue('--c' + i).trim();
        });
        probe.remove();
        if (reversed) stops.reverse();
        el.style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
      });
    }, 0);

    /* --- backgrounds -------------------------------------------------- */
    const bgGrid = U.h('.bg-grid', App.Shell.BACKGROUNDS.map(function (b) {
      return U.h('button.scheme-opt' + (s.background === b.id ? '.is-active' : ''), {
        type: 'button', dataset: { bg: b.id },
        'aria-label': b.name + (b.live ? ' (animated)' : ''),
        onclick: function () {
          App.Store.saveSettings({ background: b.id });
          U.$$('[data-bg]', bgGrid).forEach(function (n) {
            n.classList.toggle('is-active', n.dataset.bg === b.id);
          });
        }
      }, [
        U.h('i.bg-swatch', { dataset: { preview: b.id } },
          b.live ? [U.h('span.bg-live', 'LIVE')] : []),
        U.h('span.scheme-name', { text: b.name })
      ]);
    }));

    return U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Appearance'),
          U.h('.card-sub', 'The colour scheme also sets the heat gradient used by every ' +
            'graph and the anatomy figures.')
        ])
      ]),
      U.h('.field', [U.h('label.label', 'Mode'), modeGrid,
        U.h('.hint', 'AMOLED pushes the background to true black so unlit pixels stay off.')]),
      U.h('.field', { style: { marginTop: '20px' } },
        [U.h('label.label', 'Colour scheme'), schemeGrid]),
      U.h('.field', { style: { marginTop: '20px' } }, [
        U.h('label.label', 'Background'),
        bgGrid,
        U.h('.hint', 'Six static and six animated, including a sci-fi skyline and a ' +
          'cyberpunk board. Every one is built from the colour scheme above, so it ' +
          'follows your scheme and your light / dark mode. Animated backgrounds hold ' +
          'still if your device asks for reduced motion.')
      ]),
      motionField()
    ]);
  }

  /* ---------------------------------------------------------------------------
     BACKGROUND MOTION

     An animated background is fill rate and nothing else: each moving layer
     repaints a viewport-sized area every frame. Six of them are free on a
     desktop and are not free on a phone from five years ago, so how many are
     allowed to move is a budget rather than a fixed part of the design.

     Auto reads the device, which is the right default; the manual settings are
     here because a guess about somebody else's hardware should not be the last
     word on it, in either direction.
     ------------------------------------------------------------------------ */

  function motionField() {
    const s = App.Store.getSettings();
    const hint = U.h('.hint');

    const OPTIONS = [
      ['auto', 'Automatic — match the device'],
      ['full', 'Full — every layer moves'],
      ['low',  'Light — fewer layers move, and slower'],
      ['off',  'Still — animated backgrounds hold their pose']
    ];

    function describe(v) {
      const resolved = App.Shell.resolveMotion(v === 'auto' ? undefined : v);
      const named = { full: 'full motion', low: 'light motion', off: 'held still' }[resolved];
      return (v === 'auto'
        ? 'This device is being given ' + named + '. '
        : 'Animated backgrounds run at ' + named + '. ') +
        'Lowering this does not change how a background looks — the layers that ' +
        'stop moving stay exactly where they are, so the picture is the same one ' +
        'with less to repaint.';
    }
    hint.textContent = describe(s.bgMotion || 'auto');

    return U.h('.field', { style: { marginTop: '20px' } }, [
      U.h('label.label', 'Background motion'),
      U.h('select.select', {
        onchange: function () {
          App.Store.saveSettings({ bgMotion: this.value });
          hint.textContent = describe(this.value);
        }
      }, OPTIONS.map(function (o) {
        return U.h('option', { value: o[0], selected: (s.bgMotion || 'auto') === o[0] }, o[1]);
      })),
      hint
    ]);
  }

  /* ===========================================================================
     YOUR SUPABASE — the setup wizard
     ======================================================================== */

  function supabaseCard() {
    const st = App.Sync.status();
    const card = U.h('.card');
    const body = U.h('div');

    card.appendChild(U.h('.card-head', [
      U.h('div', [
        U.h('h2', 'Your Supabase project'),
        U.h('.card-sub', 'Optional. Local storage already keeps everything forever on ' +
          'this device — a project adds backup, multi-device sync and friend sharing.')
      ]),
      U.h('.spacer'),
      st.personal.verified
        ? U.h('span.chip.chip-accent', { text: 'Connected · ' + st.personal.ref })
        : U.h('span.chip', 'Not connected')
    ]));
    card.appendChild(body);

    /* An account is required first: the project's URL and key are registered
       against it in the hub, which is what lets a friend find your data at all.
       Linking a project with nowhere to publish it would be a dead end. */
    if (!st.hub.signedIn && !st.personal.verified) {
      body.appendChild(U.h('.empty', [
        U.h('div', { html: U.icon('users') }),
        U.h('.empty-title', 'Create an account first'),
        U.h('p', 'Linking your own Supabase project needs an account, because the ' +
          'project address is registered against it so friends can find your data. ' +
          'Everything else in the app already works without one.'),
        U.h('button.btn.btn-primary.btn-sm', {
          type: 'button', html: U.icon('users') + '<span>Go to Account</span>',
          onclick: function () {
            const acct = U.$('#accountCard', root);
            if (!acct) return;
            const bar = document.querySelector('.topbar');
            const offset = (bar ? bar.getBoundingClientRect().height : 0) + 10;
            window.scrollTo(0, Math.max(0,
              Math.round(window.scrollY + acct.getBoundingClientRect().top - offset)));
            const input = acct.querySelector('input[type="email"]');
            if (input) setTimeout(function () { input.focus(); }, 250);
          }
        })
      ]));
      return card;
    }

    if (st.personal.verified) drawConnected(body, st);
    else drawWizard(body);

    return card;
  }

  function drawConnected(body, st) {
    U.clear(body);
    body.appendChild(U.h('.callout.is-good', [
      U.h('.callout-bar'),
      U.h('div', [
        U.h('div', [U.h('strong', 'Connected to '), st.personal.url]),
        U.h('.u-xs.u-muted', { text: 'Last upload ' +
          (st.lastPush ? U.relDate(st.lastPush) : 'never') + ' · last download ' +
          (st.lastPull ? U.relDate(st.lastPull) : 'never') +
          (st.personal.canWrite ? ' · write access held' : ' · READ ONLY on this device') })
      ])
    ]));

    const schemaNote = U.h('div', { style: { marginTop: '12px' } });
    body.appendChild(schemaNote);
    App.Sync.checkPersonalSchema().then(function (sc) {
      if (!sc || !sc.needsUpdate) return;
      U.clear(schemaNote);
      schemaNote.appendChild(U.h('.callout.is-warn', [
        U.h('.callout-bar'),
        U.h('div', [
          U.h('div', [U.h('strong', 'This project needs updating. '),
            'It is on schema v' + sc.current + '; this version expects v' + sc.required +
            '. Uploads still work, minus the newer columns.']),
          U.h('button.btn.btn-sm', { style: { marginTop: '8px' },
            type: 'button', html: U.icon('zap') + '<span>Update project</span>',
            onclick: function () { App.Update.promptSchema(sc); } })
        ])
      ]));
    });

    body.appendChild(U.h('.row.row-wrap', { style: { marginTop: '16px' } }, [
      U.h('button.btn.btn-primary.btn-sm', {
        type: 'button', html: U.icon('upload') + '<span>Upload everything now</span>',
        onclick: function () { runUpload(this); }
      }),
      U.h('button.btn.btn-sm', {
        type: 'button', html: U.icon('download') + '<span>Download from cloud</span>',
        onclick: function () { runDownload(); }
      }),
      U.h('button.btn.btn-sm', {
        type: 'button', html: U.icon('refresh') + '<span>Re-test</span>',
        onclick: function () { draw(); }
      }),
      U.h('.spacer'),
      U.h('button.btn.btn-sm.btn-danger', {
        type: 'button', text: 'Disconnect',
        onclick: function () {
          U.confirm({ title: 'Disconnect this project?',
            message: 'Your local data stays exactly where it is. The cloud copy is left ' +
              'untouched and you can reconnect any time.',
            confirmLabel: 'Disconnect', danger: true }).then(function (ok) {
            if (ok) App.Sync.disconnectPersonal().then(function () {
              U.toast('Disconnected', 'Running local-only again.');
              draw();
            });
          });
        }
      })
    ]));

    body.appendChild(U.h('div', { style: { marginTop: '16px' } }, [
      C.linkRow('https://supabase.com/dashboard/project/' + st.personal.ref, {
        label: 'Your project dashboard',
        hint: 'Opens outside the app where possible; otherwise copy the link.'
      })
    ]));
  }

  function runUpload(btn) {
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="spinner"></i><span>Uploading…</span>';
    btn.disabled = true;
    App.Sync.pushAll(function (done, total) {
      btn.innerHTML = '<i class="spinner"></i><span>' + done + ' / ' + total + '</span>';
    }).then(function (sum) {
      U.toast('Upload complete',
        sum.uploaded + ' records synced to your project.', 'good');
      btn.innerHTML = original; btn.disabled = false;
      draw();
    }).catch(function (err) {
      U.toast('Upload failed', err.message, 'bad');
      btn.innerHTML = original; btn.disabled = false;
    });
  }

  function runDownload() {
    U.confirm({
      title: 'Download from the cloud?',
      message: 'Records that are newer in the cloud will replace the copies on this ' +
        'device. Anything newer here is kept.',
      confirmLabel: 'Download'
    }).then(function (ok) {
      if (!ok) return;
      App.Sync.pull('merge').then(function (sum) {
        const n = Object.keys(sum).reduce(function (a, k) { return a + sum[k].applied; }, 0);
        U.toast('Download complete', n + ' records updated locally.', 'good');
        draw();
      }).catch(function (err) {
        U.toast('Download failed', err.message, 'bad');
      });
    });
  }

  /* --- the wizard ---------------------------------------------------------- */

  function drawWizard(body) {
    U.clear(body);
    const state = { url: App.Sync.cfg.personal.url || '', key: App.Sync.cfg.personal.key || '' };
    const resultWrap = U.h('div');

    /* The SQL-editor link is rebuilt whenever the project URL changes, so once
       a URL is entered it points straight at that project instead of the
       generic project picker. */
    const sqlLinkWrap = U.h('div');

    function sqlEditorUrl() {
      const ref = App.Supabase.projectRef(state.url);
      return 'https://supabase.com/dashboard/project/' + (ref || '_') + '/sql/new';
    }
    function refreshSqlLink() {
      const ref = App.Supabase.projectRef(state.url);
      U.clear(sqlLinkWrap);
      sqlLinkWrap.appendChild(C.linkRow(sqlEditorUrl(), {
        label: ref ? 'SQL editor for ' + ref : 'Supabase SQL editor',
        primary: true,
        hint: ref
          ? 'Opens a new query in your project. If Open lands back inside the app, ' +
            'copy the link and paste it into your browser.'
          : 'Enter your project URL below and this becomes a direct link. Otherwise it ' +
            'opens the project picker: Dashboard → your project → SQL Editor → New query.'
      }));
    }

    const urlInput = U.h('input.input', {
      placeholder: 'https://your-project.supabase.co', value: state.url, spellcheck: 'false',
      inputmode: 'url', autocapitalize: 'none',
      oninput: function () { state.url = this.value.trim(); refreshSqlLink(); }
    });
    const keyInput = U.h('input.input', {
      placeholder: 'sb_publishable_… (or the legacy anon key)', value: state.key,
      spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none',
      oninput: function () { state.key = this.value.trim(); }
    });

    body.appendChild(U.h('.steps', [
      /* 1 */
      U.h('.step', [
        U.h('.step-num', '1'),
        U.h('div', [
          U.h('.step-title', 'Create a free Supabase project'),
          U.h('.step-body', [
            U.h('p', 'One project per person. The free tier is plenty — a lifetime of ' +
              'training history is a few megabytes.'),
            C.linkRow('https://supabase.com/dashboard/projects', {
              label: 'Supabase dashboard',
              hint: 'Opens outside the app where possible. If it opens in here instead, ' +
                'use Copy link and paste it into your browser.'
            })
          ])
        ])
      ]),

      /* 2 — the link comes before the SQL, so there is somewhere to paste it */
      U.h('.step', [
        U.h('.step-num', '2'),
        U.h('div', [
          U.h('.step-title', 'Open the SQL editor, then run the setup script'),
          U.h('.step-body', [
            U.h('p', 'Path: Supabase dashboard → your project → SQL Editor → New query. ' +
              'The link below goes straight there.'),
            sqlLinkWrap,
            U.h('p', 'Paste the whole script and press Run. It creates the tables, the ' +
              'security rules and the daily keep-alive. Safe to run more than once.'),
            sqlBlock()
          ])
        ])
      ]),

      /* 3 */
      U.h('.step', [
        U.h('.step-num', '3'),
        U.h('div', [
          U.h('.step-title', 'Paste your project details'),
          U.h('.step-body', [
            U.h('p', 'Both values are on Project Settings → API. The publishable key is ' +
              'designed to be public — the SQL you just ran is what stops anyone using it ' +
              'to change your data.'),
            U.h('.grid.grid-2', [
              U.h('.field', [U.h('label.label', 'Project URL'), urlInput]),
              U.h('.field', [U.h('label.label', 'Publishable / anon key'), keyInput])
            ])
          ])
        ])
      ]),

      /* 4 */
      U.h('.step', [
        U.h('.step-num', '4'),
        U.h('div', [
          U.h('.step-title', 'Test the connection'),
          U.h('.step-body', [
            U.h('p', 'This checks the project is reachable, confirms the schema is ' +
              'installed, and claims this device\'s write key. If it passes, you can ' +
              'upload everything already stored here.'),
            U.h('button.btn.btn-primary', {
              type: 'button', html: U.icon('zap') + '<span>Test connection</span>',
              onclick: function () { runTest(this, state, resultWrap); }
            }),
            resultWrap
          ])
        ])
      ])
    ]));

    refreshSqlLink();
  }

  function sqlBlock() {
    const wrap = U.h('.code.is-tall');
    const pre = U.h('pre', { text: 'Loading sql/user-schema.sql…' });

    wrap.appendChild(U.h('.code-head', [
      U.h('span', 'sql/user-schema.sql'),
      U.h('.spacer'),
      U.h('button.btn.btn-sm.btn-ghost', {
        type: 'button', html: U.icon('copy') + '<span>Copy</span>',
        onclick: function () {
          U.copyOrShow(pre.textContent, {
            label: 'Paste it into the Supabase SQL editor.',
            title: 'Copy the setup SQL'
          });
        }
      }),
      U.h('button.btn.btn-sm.btn-ghost', {
        type: 'button', html: U.icon('download') + '<span>Download</span>',
        onclick: function () {
          U.download('ai-gym-user-schema.sql', pre.textContent, 'text/plain');
        }
      })
    ]));
    wrap.appendChild(pre);

    fetch('sql/user-schema.sql')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) { pre.textContent = t; })
      .catch(function () {
        pre.textContent =
          'Could not load sql/user-schema.sql from this page.\n\n' +
          'Open the file directly from the app folder:\n' +
          '  AI-Gym/sql/user-schema.sql\n\n' +
          'Copy its whole contents into the Supabase SQL editor and run it.\n' +
          '(This usually happens when the app is opened straight from the file\n' +
          'system instead of through a local server.)';
      });

    return wrap;
  }

  function runTest(btn, state, resultWrap) {
    if (!App.Supabase.validUrl(state.url)) {
      U.toast('Check the URL', 'It should look like https://abcd1234.supabase.co', 'bad');
      return;
    }
    if (!App.Supabase.validKey(state.key)) {
      U.toast('Check the key', 'Paste the publishable (or anon) key from Project Settings → API.', 'bad');
      return;
    }

    const original = btn.innerHTML;
    btn.innerHTML = '<i class="spinner"></i><span>Testing…</span>';
    btn.disabled = true;
    U.clear(resultWrap);

    App.Sync.testPersonal(state.url, state.key).then(function (report) {
      btn.innerHTML = original; btn.disabled = false;

      resultWrap.appendChild(U.h('.stack-sm', { style: { marginTop: '14px' } },
        report.steps.map(function (s) {
          return U.h('.callout' + (s.ok ? '.is-good' : '.is-bad'), [
            U.h('.callout-bar'),
            U.h('div', [
              U.h('div', [U.h('strong', s.ok ? '✓ ' : '✕ '), s.name]),
              s.detail ? U.h('.u-xs.u-muted', { text: s.detail }) : null
            ])
          ]);
        })));

      if (!report.ok) {
        resultWrap.appendChild(U.h('.callout.is-warn', { style: { marginTop: '10px' } }, [
          U.h('.callout-bar'),
          U.h('div', 'Fix the failing step above and test again. The most common cause is ' +
            'the setup SQL not having been run in this project yet.')
        ]));
        return;
      }

      App.Sync.connectPersonal(state.url, state.key, report.writeKey, report.info)
        .then(function () {
          U.toast('Connected', 'Your project is ready.', 'good');
          offerMigration(resultWrap);
        });
    }).catch(function (err) {
      btn.innerHTML = original; btn.disabled = false;
      resultWrap.appendChild(U.h('.callout.is-bad', { style: { marginTop: '14px' } }, [
        U.h('.callout-bar'), U.h('div', { text: err.message })
      ]));
    });
  }

  /** Step 5: the "test passed, now fill the tables" flow the spec asks for. */
  function offerMigration(resultWrap) {
    const counts = {
      exercises: App.Store.allExercises().length,
      workouts: App.Store.allWorkouts().length,
      sessions: App.Store.allSessions().length
    };
    const total = counts.exercises + counts.workouts + counts.sessions;

    const btn = U.h('button.btn.btn-primary', {
      type: 'button', html: U.icon('upload') + '<span>Upload ' + total + ' records</span>',
      onclick: function () { runUpload(this); }
    });

    resultWrap.appendChild(U.h('.callout.is-good', { style: { marginTop: '14px' } }, [
      U.h('.callout-bar'),
      U.h('div', [
        U.h('div', [U.h('strong', 'Connected.'),
          ' Everything on this device can go up now: ' +
          counts.exercises + ' exercises, ' + counts.workouts + ' workouts, ' +
          counts.sessions + ' sessions.']),
        U.h('div', { style: { marginTop: '10px' } }, [btn])
      ])
    ]));
  }

  /* ===========================================================================
     ACCOUNT (hub)
     ======================================================================== */

  function accountCard() {
    const st = App.Sync.status();
    const card = U.h('.card#accountCard');
    const body = U.h('div');

    card.appendChild(U.h('.card-head', [
      U.h('div', [
        U.h('h2', 'Account'),
        U.h('.card-sub', 'Only needed for friends. Everything else works without one.')
      ]),
      U.h('.spacer'),
      st.hub.signedIn
        ? U.h('span.chip.chip-accent', { text: U.handle(st.hub.account.handle) || '@…' })
        : U.h('span.chip', 'Signed out')
    ]));
    card.appendChild(body);

    if (st.hub.signedIn) {
      body.appendChild(U.h('.row.row-wrap', [
        U.h('div', [
          U.h('div', { style: { fontWeight: '600' },
            text: st.hub.account.display_name || st.hub.account.handle }),
          U.h('.u-xs.u-muted', { text: st.hub.account.email })
        ]),
        U.h('.spacer'),
        U.h('button.btn.btn-sm', {
          type: 'button', html: U.icon('cloud') + '<span>Publish my stats</span>',
          onclick: function () {
            App.Sync.publishStats().then(function () {
              U.toast('Published', 'Friends can see your latest rank.', 'good');
            });
          }
        }),
        U.h('button.btn.btn-sm', {
          type: 'button', text: 'Sign out',
          onclick: function () { App.Sync.signOut().then(draw); }
        })
      ]));

      /* WHAT THE HANDLE IS FOR.
         It was displayed as a chip in the corner and never explained, so there
         was nothing to tell anyone that it is the thing you hand out — the one
         piece of the account another person needs in order to reach you. Saying
         so, and putting a Copy button next to it, is the difference between a
         label and an instruction. */
      body.appendChild(U.h('.field', { style: { marginTop: '16px' } }, [
        U.h('label.label', 'Your handle'),
        U.h('.row.row-wrap', [
          U.h('span.chip.chip-accent', { style: { fontSize: 'var(--fs-md)' },
            text: U.handle(st.hub.account.handle) }),
          U.h('button.btn.btn-sm', {
            type: 'button', html: U.icon('copy') + '<span>Copy handle</span>',
            onclick: function () {
              U.copyOrShow(U.handle(st.hub.account.handle), {
                title: 'Your handle',
                label: 'Give this to whoever wants to add you.'
              });
            }
          })
        ]),
        U.h('.hint', 'This is how other people find you. Give it to someone and they ' +
          'search for it under Friends to send you a request, which then shows up ' +
          'here for you to accept. It always starts with @.')
      ]));

      if (!st.personal.verified) {
        body.appendChild(U.h('.callout.is-warn', { style: { marginTop: '14px' } }, [
          U.h('.callout-bar'),
          U.h('div', 'You are signed in but have no Supabase project connected, so ' +
            'friends cannot read your training data yet. Complete the section above.')
        ]));
      }
      return card;
    }

    const form = { email: '', password: '', name: '', mode: 'signin' };
    const msg = U.h('div');

    function submit(btn) {
      if (!form.email || !form.password) {
        U.toast('Missing details', 'Email and password are both required.', 'bad');
        return;
      }
      const original = btn.innerHTML;
      btn.innerHTML = '<i class="spinner"></i><span>Working…</span>';
      btn.disabled = true;

      const p = form.mode === 'signup'
        ? App.Sync.signUp(form.email, form.password, form.name)
        : App.Sync.signIn(form.email, form.password);

      p.then(function (r) {
        btn.innerHTML = original; btn.disabled = false;
        if (r && r.needsConfirmation) {
          U.clear(msg);
          msg.appendChild(U.h('.callout.is-good', [
            U.h('.callout-bar'),
            U.h('div', 'Account created. Check your email for the confirmation link, ' +
              'then sign in here.')
          ]));
          return;
        }
        U.toast('Signed in', 'Welcome back.', 'good');
        draw();
      }).catch(function (err) {
        btn.innerHTML = original; btn.disabled = false;
        U.clear(msg);
        msg.appendChild(U.h('.callout.is-bad', [
          U.h('.callout-bar'), U.h('div', { text: err.message })
        ]));
      });
    }

    body.appendChild(U.h('.btn-group', { style: { marginBottom: '16px' } }, [
      U.h('button.btn.btn-sm.is-active', { type: 'button', text: 'Sign in',
        onclick: function () {
          form.mode = 'signin';
          this.classList.add('is-active');
          this.nextSibling.classList.remove('is-active');
          U.$('#nameField', body).classList.add('u-hide');
        } }),
      U.h('button.btn.btn-sm', { type: 'button', text: 'Create account',
        onclick: function () {
          form.mode = 'signup';
          this.classList.add('is-active');
          this.previousSibling.classList.remove('is-active');
          U.$('#nameField', body).classList.remove('u-hide');
        } })
    ]));

    body.appendChild(U.h('.grid.grid-3', [
      U.h('.field#nameField.u-hide', [
        U.h('label.label', 'Display name'),
        U.h('input.input', { oninput: function () { form.name = this.value; } })
      ]),
      U.h('.field', [
        U.h('label.label', 'Email'),
        U.h('input.input', { type: 'email', autocomplete: 'email',
          oninput: function () { form.email = this.value.trim(); } })
      ]),
      U.h('.field', [
        U.h('label.label', 'Password'),
        U.h('input.input', { type: 'password', autocomplete: 'current-password',
          oninput: function () { form.password = this.value; },
          onkeydown: function (e) {
            if (e.key === 'Enter') submit(U.$('#authBtn', body));
          } })
      ])
    ]));

    body.appendChild(U.h('.row', { style: { marginTop: '14px' } }, [
      U.h('button.btn.btn-primary#authBtn', {
        type: 'button', html: U.icon('users') + '<span>Continue</span>',
        onclick: function () { submit(this); }
      }),
      U.h('.spacer'),
      U.h('span.u-xs.u-muted', { text: 'Hub: ' +
        App.Supabase.projectRef(App.Sync.cfg.hub.url) })
    ]));
    body.appendChild(msg);

    return card;
  }

  /* ===========================================================================
     FRIENDS
     ======================================================================== */

  function friendsCard() {
    const card = U.h('.card');
    const body = U.h('div');

    card.appendChild(U.h('.card-head', [
      U.h('div', [
        U.h('h2', 'Friends'),
        U.h('.card-sub', 'Accepting a friend lets their app read your training data ' +
          '— never write to it.')
      ])
    ]));
    card.appendChild(body);

    if (!App.Sync.signedIn()) {
      body.appendChild(U.h('.empty', [
        U.h('div', { html: U.icon('users') }),
        U.h('.empty-title', 'Sign in first'),
        U.h('p', 'Friends need an account so the two apps can find each other.')
      ]));
      return card;
    }

    /* --- invite codes ---------------------------------------------------
       A handle request needs you to know their handle and lands as an
       unsolicited prompt. An invite goes the other way: you generate a code,
       hand it over however you like, and redeeming it IS the acceptance. */
    const inviteOut = U.h('div');

    body.appendChild(U.h('.grid.grid-2', [
      U.h('.field', [
        U.h('label.label', 'Invite someone'),
        U.h('button.btn.btn-primary.btn-block', {
          type: 'button', html: U.icon('plus') + '<span>Create invite code</span>',
          onclick: function () {
            const btn = this;
            btn.disabled = true;
            App.Sync.createInvite(null).then(function (inv) {
              btn.disabled = false;
              U.clear(inviteOut);
              if (!inv) { U.toast('Could not create invite', '', 'bad'); return; }
              inviteOut.appendChild(U.h('.callout.is-good', { style: { marginTop: '10px' } }, [
                U.h('.callout-bar'),
                U.h('div', { style: { minWidth: 0 } }, [
                  U.h('div', [U.h('strong', 'Send them this code')]),
                  U.h('.link-url', { style: { marginTop: '6px', fontSize: 'var(--fs-lg)',
                    letterSpacing: '0.08em', textAlign: 'center' }, text: inv.code }),
                  U.h('.row', { style: { marginTop: '8px' } }, [
                    U.h('button.btn.btn-sm', {
                      type: 'button', html: U.icon('copy') + '<span>Copy code</span>',
                      onclick: function () {
                        U.copyOrShow(inv.code, { label: 'Send it to whoever you are inviting.',
                          title: 'Your invite code' });
                      }
                    }),
                    navigator.share ? U.h('button.btn.btn-sm', {
                      type: 'button', html: U.icon('link') + '<span>Share</span>',
                      onclick: function () {
                        navigator.share({ title: 'AI-Gym invite',
                          text: 'Add me on AI-Gym with this code: ' + inv.code })
                          .catch(function () {});
                      }
                    }) : null
                  ]),
                  U.h('.u-xs.u-muted', { style: { marginTop: '6px' },
                    text: 'Single use, expires ' + U.fmtDate(inv.expires_at) +
                      '. Only someone holding it can complete the link, and redeeming ' +
                      'it accepts automatically.' })
                ])
              ]));
            }).catch(function (e) {
              btn.disabled = false;
              U.toast('Could not create invite', e.message, 'bad');
            });
          }
        })
      ]),
      U.h('.field', [
        U.h('label.label', 'Redeem a code'),
        (function () {
          const codeInput = U.h('input.input', {
            placeholder: 'ABCD-EFGH-JKLM', spellcheck: 'false', autocapitalize: 'characters',
            style: { textTransform: 'uppercase', letterSpacing: '0.06em' }
          });
          const wrap = U.h('.stack-sm', [
            codeInput,
            U.h('button.btn.btn-block', {
              type: 'button', html: U.icon('check') + '<span>Redeem &amp; connect</span>',
              onclick: function () {
                const code = codeInput.value.trim();
                if (!code) return;
                const btn = this;
                btn.disabled = true;
                App.Sync.redeemInvite(code).then(function (r) {
                  btn.disabled = false;
                  codeInput.value = '';
                  U.toast('Connected', 'You and ' +
                    ((r && (r.friend_name || r.friend_handle)) || 'they') +
                    ' are now friends.', 'good');
                  draw();
                }).catch(function (e) {
                  btn.disabled = false;
                  U.toast('Could not redeem', e.message, 'bad');
                });
              }
            })
          ]);
          return wrap;
        })()
      ])
    ]));
    body.appendChild(inviteOut);

    /* --- FINDING SOMEONE BY HANDLE --------------------------------------------
       The old field was a bare text box and a Send button: you had to know the
       handle exactly, spell it right, and find out you had not only after the
       request failed. It is now a search — the @ is part of the furniture
       rather than something to remember to type, and matches appear as you go.

       Five results, sorted alphabetically. The hub sorts by rank points, which
       is the wrong order for picking a person out of a list: someone scanning
       for a name they already know wants it where the alphabet says it is, not
       wherever their bench press put them. */
    const handleInput = U.h('input.input', {
      placeholder: 'their handle', spellcheck: 'false',
      autocomplete: 'off', autocapitalize: 'none',
      'aria-label': 'Search for a handle'
    });
    const results = U.h('.handle-results');
    const searchNote = U.h('.hint', 'Type at least two characters. The @ is added for you.');

    /* The @ is a fixed prefix drawn beside the field, and anything typed is
       forced into the shape the hub will actually accept, so a pasted
       "@Eward " or "eward!" cannot become a lookup that silently finds nobody. */
    handleInput.addEventListener('input', function () {
      const clean = U.bareHandle(this.value);
      if (this.value !== clean) this.value = clean;
      runSearch(clean);
    });
    handleInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); sendTo(U.bareHandle(this.value)); }
    });

    function sendTo(bare, btn) {
      if (!bare) return;
      if (btn) btn.disabled = true;
      App.Sync.requestFriend(bare).then(function (res) {
        if (btn) btn.disabled = false;
        handleInput.value = '';
        U.clear(results);
        U.toast(res === 'accepted' ? 'Friends!' :
          res === 'already_friends' ? 'Already connected' : 'Request sent',
          U.handle(bare), 'good');
        loadList();
      }).catch(function (err) {
        if (btn) btn.disabled = false;
        U.toast('Could not send', err.message, 'bad');
      });
    }

    const runSearch = U.debounce(function (q) {
      U.clear(results);
      if (!q || q.length < 2) return;
      results.appendChild(U.h('.row', [U.h('.spinner'),
        U.h('span.u-xs.u-muted', 'Searching…')]));

      App.Sync.searchProfiles(q).then(function (rows) {
        U.clear(results);
        const list = (rows || [])
          .filter(function (r) { return r.relation !== 'self'; })
          .sort(function (a, b) { return String(a.handle).localeCompare(String(b.handle)); })
          .slice(0, 5);

        if (!list.length) {
          results.appendChild(U.h('.u-xs.u-muted', { style: { padding: '8px 2px' },
            text: 'No account matches ' + U.handle(q) + '.' }));
          return;
        }
        list.forEach(function (r) { results.appendChild(searchRow(r)); });
      }).catch(function (err) {
        U.clear(results);
        results.appendChild(U.h('.u-xs.u-muted', { text: 'Search failed: ' + err.message }));
      });
    }, 260);

    function searchRow(r) {
      const rk = App.Ranks.RANKS.find(function (x) { return x.id === r.rank_id; })
        || App.Ranks.RANKS[0];
      const already = { friend: 'Already friends', outgoing: 'Request sent',
        incoming: 'They asked you' }[r.relation];
      return U.h('.ex-row', [
        U.h('.ex-thumb', { style: { fontSize: '20px' }, text: r.avatar_emoji || '💪' }),
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('.ex-name', { text: U.handle(r.handle) }),
          U.h('.ex-meta', [
            r.display_name ? U.h('span', { text: r.display_name }) : null,
            U.h('span', { style: { color: rk.color }, text: rk.name })
          ])
        ]),
        already
          ? U.h('span.chip', { text: already })
          : U.h('button.btn.btn-primary.btn-sm', {
              type: 'button', html: U.icon('plus') + '<span>Add</span>',
              onclick: function () { sendTo(r.handle, this); }
            })
      ]);
    }

    body.appendChild(U.h('.field', { style: { marginTop: '18px' } }, [
      U.h('label.label', 'Find someone by handle'),
      U.h('.row.row-wrap', [
        U.h('.handle-field', { style: { flex: 1, minWidth: '220px' } }, [
          U.h('span.handle-at', '@'), handleInput
        ]),
        U.h('button.btn.btn-primary.btn-sm', {
          type: 'button', style: { alignSelf: 'center' },
          html: U.icon('plus') + '<span>Send request</span>',
          onclick: function () { sendTo(U.bareHandle(handleInput.value), this); }
        })
      ]),
      searchNote,
      results
    ]));

    /* --- INCOMING REQUESTS ----------------------------------------------------
       These used to be a heading part-way down a list you had to already be
       scrolling. A request is the one thing here that is waiting on YOU, so it
       gets its own block above everything else, with the sender named and the
       Accept button in reach. */
    const requestsWrap = U.h('div');
    body.insertBefore(requestsWrap, body.firstChild);

    function drawRequests(incoming) {
      U.clear(requestsWrap);
      if (!incoming || !incoming.length) return;
      requestsWrap.appendChild(U.h('.callout.is-good', { style: { marginBottom: '16px' } }, [
        U.h('.callout-bar'),
        U.h('div', { style: { minWidth: 0, width: '100%' } }, [
          U.h('.row', [
            U.h('strong', { text: incoming.length + ' friend request' +
              (incoming.length === 1 ? '' : 's') + ' waiting for you' }),
            U.h('.spacer'),
            U.h('span.chip.chip-accent', { text: String(incoming.length) })
          ]),
          U.h('.stack-sm', { style: { marginTop: '10px' } },
            incoming.map(function (f) { return requestRow(f); }))
        ])
      ]));
    }

    function requestRow(f) {
      return U.h('.ex-row', [
        U.h('.ex-thumb', { style: { fontSize: '20px' }, text: f.avatar_emoji || '💪' }),
        U.h('div', { style: { minWidth: 0 } }, [
          U.h('.ex-name', { text: U.handle(f.handle) }),
          U.h('.ex-meta', [
            U.h('span', { text: f.display_name || 'wants to be friends' }),
            U.h('span', 'sent you a request')
          ])
        ]),
        U.h('.row', { style: { gap: '6px' } }, [
          U.h('button.btn.btn-primary.btn-sm', {
            type: 'button', html: U.icon('check') + '<span>Accept</span>',
            onclick: function () {
              const btn = this;
              btn.disabled = true;
              /* respond_friend keys off the friendship row, not the account. */
              App.Sync.respondFriend(f.friendship_id, true).then(function () {
                U.toast('Connected', U.handle(f.handle), 'good');
                loadList();
              }).catch(function (e) {
                btn.disabled = false;
                U.toast('Failed', e.message, 'bad');
              });
            }
          }),
          U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
            type: 'button', 'aria-label': 'Decline', title: 'Decline', html: U.icon('x'),
            onclick: function () {
              App.Sync.respondFriend(f.friendship_id, false)
                .then(function () { U.toast('Declined', U.handle(f.handle)); loadList(); })
                .catch(function (e) { U.toast('Failed', e.message, 'bad'); });
            }
          })
        ])
      ]);
    }

    const listWrap = U.h('div', { style: { marginTop: '18px' } });
    body.appendChild(listWrap);

    function loadList() {
      U.clear(listWrap);
      listWrap.appendChild(U.h('.row', [U.h('.spinner'),
        U.h('span.u-sm.u-muted', 'Loading…')]));

      App.Sync.listFriends().then(function (rows) {
        U.clear(listWrap);
        const incomingAll = (rows || []).filter(function (r) {
          return r.status === 'pending' && r.direction === 'incoming'; });
        drawRequests(incomingAll);

        if (!rows || !rows.length) {
          listWrap.appendChild(U.h('.empty', [
            U.h('p', 'No friends yet. Share your handle: '),
            U.h('span.chip.chip-accent', {
              text: U.handle(App.Sync.cfg.account.handle) })
          ]));
          return;
        }
        const outgoing = rows.filter(function (r) {
          return r.status === 'pending' && r.direction === 'outgoing'; });
        const accepted = rows.filter(function (r) { return r.status === 'accepted'; });

        if (accepted.length) {
          listWrap.appendChild(U.h('.group-head', [U.h('span', 'Connected')]));
          accepted.forEach(function (f) { listWrap.appendChild(friendRow(f, loadList, false)); });
        }
        if (outgoing.length) {
          listWrap.appendChild(U.h('.group-head', [U.h('span', 'Waiting on them')]));
          outgoing.forEach(function (f) { listWrap.appendChild(friendRow(f, loadList, false)); });
        }
      }).catch(function (err) {
        U.clear(listWrap);
        const missing = /does not exist|schema cache|PGRST202|PGRST203/i.test(err.message || '');
        const expired = /expired|jwt|sign in again/i.test(err.message || '');
        listWrap.appendChild(U.h('.callout.is-bad', [
          U.h('.callout-bar'),
          U.h('div', [
            U.h('div', [U.h('strong', 'Could not load friends. '), err.message]),
            expired ? U.h('button.btn.btn-sm', { style: { marginTop: '8px' },
              type: 'button', text: 'Sign in again',
              onclick: function () { App.Sync.signOut().then(draw); } }) : null,
            missing ? U.h('.u-xs.u-muted', { style: { marginTop: '6px' },
              text: 'That error means the hub is missing a function this version ' +
                'expects. Re-run sql/hub-schema.sql in the shared project — the ' +
                'current file drops changed functions before recreating them, which ' +
                'older copies did not, so a previous re-run may have failed silently.' })
              : null
          ])
        ]));
      });
    }
    loadList();

    return card;
  }

  function friendRow(f, reload, isIncoming) {
    const rk = App.Ranks.RANKS.find(function (x) { return x.id === f.rank_id; })
      || App.Ranks.RANKS[0];
    return U.h('.ex-row', [
      U.h('.ex-thumb', { style: { fontSize: '20px' }, text: f.avatar_emoji || '💪' }),
      U.h('div', { style: { minWidth: 0 } }, [
        U.h('.ex-name', { text: f.display_name || U.handle(f.handle) }),
        U.h('.ex-meta', [
          U.h('span', { text: U.handle(f.handle) }),
          U.h('span', { style: { color: rk.color }, text: rk.name }),
          U.h('span', { text: U.num(f.rank_points, 0) + ' pts' }),
          f.has_connection ? null : U.h('span', { text: 'no project linked' })
        ])
      ]),
      U.h('.row', { style: { gap: '6px' } }, [
        isIncoming ? U.h('button.btn.btn-primary.btn-sm', {
          type: 'button', text: 'Accept',
          onclick: function () {
            /* respond_friend keys off the friendship row, not the account. */
            App.Sync.respondFriend(f.friendship_id, true)
              .then(function () { U.toast('Connected', U.handle(f.handle), 'good'); reload(); })
              .catch(function (e) { U.toast('Failed', e.message, 'bad'); });
          }
        }) : null,
        U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
          type: 'button', 'aria-label': 'Remove', title: 'Remove', html: U.icon('trash'),
          onclick: function () {
            U.confirm({ title: 'Remove ' + U.handle(f.handle) + '?',
              message: 'They will no longer be able to read your training data.',
              confirmLabel: 'Remove', danger: true }).then(function (ok) {
              if (!ok) return;
              App.Sync.removeFriend(f.id).then(function () { reload(); });
            });
          }
        })
      ])
    ]);
  }

  /* ===========================================================================
     DATA
     ======================================================================== */

  function dataCard() {
    return U.h('.card', [
      U.h('.card-head', [
        U.h('div', [
          U.h('h2', 'Data'),
          U.h('.card-sub', 'Backups are plain JSON — yours to keep, move or inspect.')
        ])
      ]),
      U.h('.row.row-wrap', [
        U.h('button.btn.btn-sm', {
          type: 'button', html: U.icon('download') + '<span>Export backup</span>',
          onclick: function () {
            U.download('ai-gym-backup-' + U.today() + '.json',
              JSON.stringify(App.Store.exportAll(), null, 2));
            U.toast('Exported', 'Backup downloaded.');
          }
        }),
        U.h('button.btn.btn-sm', {
          type: 'button', html: U.icon('upload') + '<span>Import backup</span>',
          onclick: importBackup
        }),
        U.h('.spacer'),
        U.h('button.btn.btn-sm.btn-danger', {
          type: 'button', html: U.icon('trash') + '<span>Reset progress…</span>',
          onclick: resetDialog
        })
      ])
    ]);
  }

  function importBackup() {
    U.readFile('application/json,.json').then(function (f) {
      let data;
      try { data = JSON.parse(f.data); }
      catch (e) { U.toast('Not readable', 'That file is not valid JSON.', 'bad'); return; }

      U.modal({
        title: 'Import backup',
        body: U.h('.stack', [
          U.h('p.u-sm', { text: 'From ' + (data.exportedAt
            ? U.fmtDate(data.exportedAt, 'long') : 'an unknown date') + '.' }),
          U.h('p.u-sm.u-muted', { text: [
            (data.exercises || []).length + ' exercises',
            (data.workouts || []).length + ' workouts',
            (data.sessions || []).length + ' sessions'
          ].join(' · ') })
        ]),
        actions: [
          { label: 'Cancel' },
          { label: 'Merge', onClick: function (close) { doImport(data, 'merge', close); } },
          { label: 'Replace everything', kind: 'danger',
            onClick: function (close) { doImport(data, 'replace', close); } }
        ]
      });
    }).catch(function () {});
  }

  function doImport(data, mode, close) {
    App.Store.importAll(data, mode).then(function () {
      close();
      U.toast('Imported', 'Backup restored.', 'good');
      draw();
    }).catch(function (err) {
      U.toast('Import failed', err.message, 'bad');
    });
  }

  const RESET_PHRASE = 'Reset Progress Confirm';

  function resetDialog() {
    const opts = { keepLibrary: true, keepFriends: true, resetSettings: false };
    let confirmBtn = null;

    const phraseInput = U.h('input.input', {
      placeholder: RESET_PHRASE, spellcheck: 'false', autocapitalize: 'off',
      autocomplete: 'off', 'aria-label': 'Type ' + RESET_PHRASE + ' to confirm'
    });

    function phraseOk() {
      return phraseInput.value.trim() === RESET_PHRASE;
    }
    function sync() {
      if (!confirmBtn) return;
      confirmBtn.disabled = !phraseOk();
      confirmBtn.classList.toggle('is-disabled', !phraseOk());
    }
    phraseInput.addEventListener('input', sync);

    const m = U.modal({
      title: 'Reset progress',
      body: function (body) {
        body.appendChild(U.h('.callout.is-bad', [
          U.h('.callout-bar'),
          U.h('div', 'This clears data on THIS DEVICE and cannot be undone. If you have ' +
            'a Supabase project connected, the cloud copy is untouched — you can download ' +
            'it again afterwards.')
        ]));
        body.appendChild(U.h('.stack', [
          toggleRow('Keep the exercise library', 'Otherwise it is reset to the ' +
            App.SeedExercises.length + ' built-in movements.', opts, 'keepLibrary'),
          toggleRow('Keep friends', 'Locally cached friend list.', opts, 'keepFriends'),
          toggleRow('Also reset settings', 'Theme, units, bodyweight and rest defaults.',
            opts, 'resetSettings')
        ]));
        body.appendChild(U.h('p.u-sm.u-muted',
          'Workouts and every logged session are always removed.'));
        body.appendChild(U.h('.field', [
          U.h('label.label', ['Type ', U.h('code', { text: RESET_PHRASE }), ' to continue']),
          phraseInput,
          U.h('.hint', 'Exactly as shown, including capitals and spaces.')
        ]));
      },
      actions: [
        { label: 'Cancel' },
        { label: 'Reset progress', kind: 'danger', onClick: function (close) {
          if (!phraseOk()) {
            U.toast('Confirmation does not match', 'Type "' + RESET_PHRASE + '" exactly.', 'bad');
            phraseInput.focus();
            return;
          }
          App.Store.resetData(opts).then(function () {
            close();
            U.toast('Reset', 'Workouts and history cleared.', 'good');
            draw();
          });
        } }
      ]
    });

    confirmBtn = m.root.querySelector('.modal-foot .btn-danger');
    sync();
  }

  function toggleRow(title, hint, obj, key) {
    return U.h('label.switch', { style: { alignItems: 'flex-start' } }, [
      U.h('input', { type: 'checkbox', checked: obj[key],
        onchange: function () { obj[key] = this.checked; } }),
      U.h('i.switch-track'),
      U.h('div', [
        U.h('div', { style: { fontWeight: '560' }, text: title }),
        U.h('.u-xs.u-muted', { text: hint })
      ])
    ]);
  }

  /* ===========================================================================
     DIAGNOSTICS
     ======================================================================== */

  function diagnosticsCard() {
    const card = U.h('.card');
    const body = U.h('div');
    card.appendChild(U.h('.card-head', [
      U.h('div', [
        U.h('h2', 'Diagnostics'),
        U.h('.card-sub', 'What is stored where, and whether today’s keep-alive ran. ' +
          'It runs on its own — on opening the app, on coming back to it, and ' +
          'on regaining a network — so nothing here needs pressing.')
      ]),
      U.h('.spacer'),
      U.h('button.btn.btn-sm', {
        type: 'button', html: U.icon('refresh') + '<span>Run it now</span>',
        onclick: function () {
          const btn = this;
          btn.disabled = true;
          App.Sync.cfg.keepaliveDate = null;
          App.Sync.runKeepalive().then(function (r) {
            btn.disabled = false;
            U.toast('Keep-alive', r.skipped ? 'No projects configured.'
              : (r.results || []).map(function (x) {
                  return x.target + ': ' + (x.error ? x.error : x.ran ? 'ran' : 'already done today');
                }).join(' · '), r.skipped ? null : 'good');
            draw();
          }).catch(function (e) {
            btn.disabled = false;
            U.toast('Keep-alive failed', e.message, 'bad');
          });
        }
      })
    ]));
    card.appendChild(body);

    Promise.all([App.DB.stats(), App.DB.usage()]).then(function (r) {
      const st = r[0], usage = r[1];
      const sync = App.Sync.status();
      U.clear(body);
      body.appendChild(U.h('.table-wrap', [U.h('table.tbl', [
        U.h('tbody', [
          diagRow('App version', App.VERSION),
          diagRow('Encryption', App.Crypto.available()
            ? (App.Crypto.hasKey() ? 'AES-GCM-256 · key held on this device'
                                   : 'available, no key yet')
            : 'unavailable (needs a secure context)'),
          diagRow('Local storage engine', st.backend === 'idb'
            ? 'IndexedDB (recommended)' : 'localStorage fallback'),
          diagRow('Exercises', st.exercises + ' records'),
          diagRow('Workouts', st.workouts + ' records'),
          diagRow('Sessions', st.sessions + ' records'),
          diagRow('Pending uploads', st.outbox + ' queued'),
          usage ? diagRow('Disk used', U.compact(usage.used / 1024) + ' KB of ' +
            U.compact(usage.quota / 1048576) + ' MB') : null,
          diagRow('Personal project', sync.personal.configured
            ? (sync.personal.ref + (sync.personal.verified ? ' · verified' : ' · unverified'))
            : 'not connected'),
          diagRow('Write access', sync.personal.canWrite ? 'held on this device' : '—'),
          diagRow('Hub account', sync.hub.signedIn
            ? '@' + sync.hub.account.handle : 'signed out'),
          diagRow('Keep-alive last run', App.Sync.cfg.keepaliveDate || 'not yet today'),
          diagRow('Last upload', sync.lastPush ? U.fmtDate(sync.lastPush, 'long') : 'never'),
          diagRow('Last download', sync.lastPull ? U.fmtDate(sync.lastPull, 'long') : 'never')
        ].filter(Boolean))
      ])]));
    });

    return card;
  }

  function diagRow(k, v) {
    return U.h('tr', [
      U.h('td.u-muted', { text: k }),
      U.h('td.u-mono.u-sm', { text: String(v) })
    ]);
  }

  App.Pages = App.Pages || {};
  App.Pages.settings = { render: render, onDataChange: onDataChange };
})(window.App = window.App || {});
