/* =============================================================================
   components.js — shared UI pieces used by more than one page
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U;

  /* ---------------------------------------------------------------------------
     SMALL BUILDING BLOCKS
     ------------------------------------------------------------------------ */

  function statTile(label, value, unit, delta) {
    return U.h('.stat-tile', [
      U.h('.stat', [
        U.h('.stat-label', { text: label }),
        U.h('.stat-value.is-sm', [
          String(value),
          unit ? U.h('span.stat-unit', { text: unit }) : null
        ]),
        delta ? U.h('.stat-delta.is-' + delta.dir, { text: delta.text }) : null
      ])
    ]);
  }

  /** Compact 6-cell heat preview for dense list rows. */
  function heatStrip(muscles) {
    const groups = App.Muscles.groupTotals(muscles || {});
    const order = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];
    let max = 0;
    order.forEach(function (g) { max = Math.max(max, groups[g] || 0); });
    const wrap = U.h('.heat-strip', { title: order.map(function (g) {
      return App.Muscles.GROUPS[g].name + ' ' + Math.round(groups[g] || 0) + '%';
    }).join('  ·  ') });
    order.forEach(function (g) {
      const v = groups[g] || 0;
      wrap.appendChild(U.h('i.heat-cell', {
        style: { background: max ? App.Anatomy.heatColor(v / max) : 'var(--anat-idle)' }
      }));
    });
    return wrap;
  }

  /** Ranked muscle list with bars — the text companion to the figure. */
  function muscleList(heat, limit) {
    const rows = Object.keys(heat || {})
      .map(function (k) { return { id: k, v: heat[k] }; })
      .sort(function (a, b) { return b.v - a.v; })
      .slice(0, limit || 10);

    if (!rows.length) return U.h('.empty', [U.h('p', 'No muscle data yet.')]);

    const max = rows[0].v || 1;
    const list = U.h('.mlist');
    rows.forEach(function (r) {
      list.appendChild(U.h('.mlist-row', [
        U.h('span.mlist-name', { text: App.Muscles.label(r.id, true) }),
        U.h('span.mlist-pct', { text: U.num(r.v, 0) + '%' }),
        U.h('span.mlist-bar', [
          U.h('i.mlist-fill', {
            style: { width: ((r.v / max) * 100) + '%',
              background: App.Anatomy.heatColor(r.v / max) }
          })
        ])
      ]));
    });
    return list;
  }

  /** Rank medal + progress bar, expressed against world-record percentages. */
  function rankCard(r, opts) {
    opts = opts || {};
    const next = r.next;
    const prevColor = (App.Ranks.RANKS[App.Ranks.RANKS.indexOf(r.rank) - 1] || r.rank).color;

    return U.h('.stack', { style: { '--rank-color': r.rank.color, '--rank-color-prev': prevColor } }, [
      U.h('.rank-card', [
        U.h('.rank-medal' + (opts.large ? '.is-lg' : ''), { text: App.Ranks.initials(r.rank) }),
        U.h('div', { style: { minWidth: '0', flex: '1' } }, [
          U.h('.rank-tier', { text: 'Rank ' + (App.Ranks.RANKS.indexOf(r.rank) + 1) + ' of 8' }),
          U.h('.rank-name', { text: r.rank.name + (r.rank.elite ? ' · Elite' : '') }),
          U.h('.u-xs.u-muted', {
            text: next
              ? '+' + U.num(r.toNext, 1) + '% of world record needed for ' + next.name
              : 'Top rank reached'
          })
        ]),
        opts.hidePoints ? null : U.h('div', { style: { textAlign: 'right' } }, [
          U.h('.stat-value.is-sm', { text: U.num(r.floor, 1) + '%' }),
          U.h('.stat-label', 'of WR')
        ])
      ]),
      U.h('.rank-bar', [
        U.h('i.rank-fill', { style: { width: (r.progress * 100).toFixed(1) + '%' } })
      ]),
      U.h('.rank-scale', [
        U.h('span', { text: r.rank.name + ' · ' + r.rank.wr + '%' }),
        U.h('span', { text: next ? next.name + ' · ' + next.wr + '%' : 'Max' })
      ]),
      opts.showLadder === false ? null : rankLadder(r),
      opts.showExplainer === false ? null : wrExplainer(r),
      opts.showIndices === false ? null : U.h('.grid.grid-4', { style: { marginTop: '4px' } }, [
        statTile('Best lift', r.indices.strength, '% WR'),
        statTile('Consistency', r.indices.consistency, '/100'),
        statTile('Volume', r.indices.volume, '/100'),
        statTile('Balance', r.indices.balance, '/100')
      ])
    ]);
  }

  /** Explains what the average is made of, and what is dragging it down. */
  function wrExplainer(r) {
    if (!r.breadth) {
      return U.h('.callout', [
        U.h('.callout-bar'),
        U.h('div', [U.h('strong', 'Nothing scored yet.'),
          ' Log a working set and every movement gets measured against the world ' +
          'record for your bodyweight.'])
      ]);
    }
    return U.h('.stack-sm', [
      U.h('.callout', [
        U.h('.callout-bar'),
        U.h('div', [
          U.h('div', [
            U.h('strong', 'Your rank is the average across all ' + r.breadth +
              ' movements you train: '),
            U.num(r.average, 1), '% of world record.'
          ]),
          r.weakest ? U.h('.u-xs.u-muted', { style: { marginTop: '4px' },
            text: 'Pulling it down hardest: ' + r.weakest.name + ' at ' +
              U.num(r.weakest.score, 1) + '%.' }) : null
        ])
      ]),
      r.breadthCapped ? U.h('.callout.is-warn', [
        U.h('.callout-bar'),
        U.h('div', [
          U.h('strong', 'Held below Platinum: not enough movements. '),
          'The top two ranks need at least ' + r.breadthNeeded +
          ' scored movements so a single heavy lift cannot average its way to the top. ' +
          'You have ' + r.breadth + '.'
        ])
      ]) : null
    ]);
  }

  function rankLadder(r) {
    const idx = App.Ranks.RANKS.indexOf(r.rank);
    const bar = U.h("div.rank-ladder", { title: App.Ranks.RANKS.map(function (x) {
      return x.name + " " + x.wr + "% WR"; }).join("  ·  ") });
    App.Ranks.RANKS.forEach(function (x, i) {
      bar.appendChild(U.h("i.rank-step" + (i <= idx ? ".is-done" : ""), {
        style: { "--rank-color": x.color }
      }));
    });
    return bar;
  }

  /* ---------------------------------------------------------------------------
     EXTERNAL LINK
     ------------------------------------------------------------------------ */

  /**
   * A link out of the app: shows the full URL, an Open button that tries to
   * reach the real browser, and a Copy button. The URL is always visible and
   * always copyable because in a web-to-app shell "Open" may still land back
   * inside the shell — the copy route is the guaranteed one.
   *
   * linkRow(url, { label, hint, primary })
   */
  function linkRow(url, opts) {
    opts = opts || {};
    const urlEl = U.h('.link-url', { text: url, title: url, tabindex: '0', role: 'textbox',
      'aria-readonly': 'true' });

    /* Tapping the URL itself selects it, for manual copy on stubborn devices. */
    urlEl.addEventListener('click', function () {
      const range = document.createRange();
      range.selectNodeContents(urlEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    return U.h('.link-row', [
      opts.label ? U.h('.link-label', { text: opts.label }) : null,
      urlEl,
      U.h('.link-actions', [
        U.h('button.btn.btn-sm' + (opts.primary ? '.btn-primary' : ''), {
          type: 'button', html: U.icon('link') + '<span>Open</span>',
          onclick: function () {
            const ok = U.openExternal(url);
            if (!ok) {
              U.toast('Could not open a browser', 'Use Copy and paste it into your browser.', 'bad');
            }
          }
        }),
        U.h('button.btn.btn-sm', {
          type: 'button', html: U.icon('copy') + '<span>Copy link</span>',
          onclick: function () {
            U.copyOrShow(url, { label: 'Link copied — paste it into your browser.',
              title: 'Copy this link' });
          }
        })
      ]),
      opts.hint ? U.h('.hint', { text: opts.hint }) : null
    ]);
  }

  /* ---------------------------------------------------------------------------
     ANATOMY PANEL
     ------------------------------------------------------------------------ */

  /**
   * Figure + ranked list, the app's standard "how hard did this work me" panel.
   * Side by side where there is room; stacked below ~760px so the figures keep
   * a usable width instead of being crushed into the leftover column.
   */
  function heatPanel(heat, opts) {
    opts = opts || {};
    const fig = U.h('.anat-wrap');
    const wrap = U.h('.heat-panel' + (opts.stack ? '.is-stacked' : ''), [
      fig,
      opts.list === false ? null : U.h('.heat-panel-list', [
        U.h('.label', { text: opts.listLabel || 'Muscle load' }),
        muscleList(heat, opts.limit || 9)
      ])
    ]);
    /* render after the node exists so measurements are correct */
    setTimeout(function () {
      App.Anatomy.render(fig, heat, { compact: opts.compact, legend: opts.legend });
    }, 0);
    return wrap;
  }

  /* ---------------------------------------------------------------------------
     EXERCISE PICKER
     ------------------------------------------------------------------------ */

  /**
   * pickExercise({multi, onPick(exOrArray), allowCreate})
   * Filterable list with a "create new" shortcut, used by the workout builder.
   */
  function pickExercise(opts) {
    opts = opts || {};
    const selected = new Set();
    let query = '', group = 'all', equip = 'all';

    const listEl = U.h('.stack-sm.list-scroll');
    const countEl = U.h('.u-xs.u-muted');

    function matches(ex) {
      if (query) {
        const q = query.toLowerCase();
        if (ex.name.toLowerCase().indexOf(q) < 0 &&
            String(ex.equipment).toLowerCase().indexOf(q) < 0) return false;
      }
      if (equip !== 'all' && ex.equipment !== equip) return false;
      if (group !== 'all') {
        const groups = App.Muscles.groupTotals(ex.muscles);
        if (!groups[group] || groups[group] < 15) return false;
      }
      return true;
    }

    function draw() {
      const all = App.Store.allExercises().filter(matches)
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      U.clear(listEl);
      countEl.textContent = all.length + ' of ' + App.Store.allExercises().length;

      if (!all.length) {
        listEl.appendChild(U.h('.empty', [
          U.h('p', 'No movement matches those filters.')
        ]));
        return;
      }
      all.slice(0, 300).forEach(function (ex) {
        const row = U.h('.ex-row' + (selected.has(ex.id) ? '.is-sel' : ''), {
          dataset: { id: ex.id }, tabindex: '0', role: 'button'
        }, [
          exThumb(ex),
          U.h('div', { style: { minWidth: 0 } }, [
            U.h('.ex-name', { text: ex.name }),
            U.h('.ex-meta', [
              U.h('span', { text: App.Equipment[ex.equipment] || ex.equipment }),
              U.h('span', { text: topMuscleLabel(ex) })
            ])
          ]),
          heatStrip(ex.muscles)
        ]);
        function choose() {
          if (opts.multi) {
            if (selected.has(ex.id)) selected.delete(ex.id); else selected.add(ex.id);
            row.classList.toggle('is-sel', selected.has(ex.id));
            updateFoot();
          } else {
            m.close();
            opts.onPick(ex);
          }
        }
        row.addEventListener('click', choose);
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
        });
        listEl.appendChild(row);
      });
      if (all.length > 300) {
        listEl.appendChild(U.h('.u-xs.u-muted.u-center', {
          style: { padding: '10px' },
          text: 'Showing the first 300 — refine the search to narrow it down.'
        }));
      }
    }

    const groupSel = U.h('select.select.input-sm', {
      onchange: function () { group = this.value; draw(); }
    }, [U.h('option', { value: 'all' }, 'All muscle groups')].concat(
      Object.keys(App.Muscles.GROUPS).map(function (g) {
        return U.h('option', { value: g }, App.Muscles.GROUPS[g].name);
      })
    ));

    const equipSel = U.h('select.select.input-sm', {
      onchange: function () { equip = this.value; draw(); }
    }, [U.h('option', { value: 'all' }, 'All equipment')].concat(
      Object.keys(App.Equipment).map(function (k) {
        return U.h('option', { value: k }, App.Equipment[k]);
      })
    ));

    const searchInput = U.h('input.input', {
      type: 'search', placeholder: 'Search movements…', autocomplete: 'off',
      oninput: U.debounce(function () { query = this.value; draw(); }, 140)
    });

    let footInfo = null;
    function updateFoot() {
      if (footInfo) footInfo.textContent = selected.size + ' selected';
    }

    const m = U.modal({
      title: opts.title || (opts.multi ? 'Add exercises' : 'Choose an exercise'),
      wide: true,
      body: function (body) {
        body.appendChild(U.h('.stack', [
          U.h('.search', { html: U.icon('search') }),
          U.h('.row.row-wrap', [groupSel, equipSel, U.h('.spacer'), countEl])
        ]));
        body.firstChild.firstChild.appendChild(searchInput);
        body.appendChild(listEl);

        if (opts.allowCreate !== false) {
          body.appendChild(U.h('button.btn.btn-block', {
            type: 'button',
            html: U.icon('plus') + '<span>Create a new exercise</span>',
            onclick: function () {
              editExercise(null, function (ex) {
                if (opts.multi) { selected.add(ex.id); draw(); updateFoot(); }
                else { m.close(); opts.onPick(ex); }
              });
            }
          }));
        }
        draw();
      },
      actions: opts.multi ? [
        { label: 'Cancel' },
        { label: 'Add selected', kind: 'primary', onClick: function (close) {
          const list = App.Store.allExercises().filter(function (e) { return selected.has(e.id); });
          close();
          opts.onPick(list);
        } }
      ] : null
    });

    if (opts.multi) {
      footInfo = U.h('.u-xs.u-muted', { style: { marginRight: 'auto', alignSelf: 'center' } });
      const foot = m.root.querySelector('.modal-foot');
      if (foot) foot.insertBefore(footInfo, foot.firstChild);
      updateFoot();
    }
    return m;
  }

  function topMuscleLabel(ex) {
    const keys = Object.keys(ex.muscles || {});
    if (!keys.length) return '—';
    keys.sort(function (a, b) { return ex.muscles[b] - ex.muscles[a]; });
    return App.Muscles.label(keys[0]) + ' ' + Math.round(ex.muscles[keys[0]]) + '%';
  }

  function exThumb(ex) {
    if (ex.image) {
      return U.h('.ex-thumb', [U.h('img', { src: ex.image, alt: '', loading: 'lazy' })]);
    }
    return U.h('.ex-thumb', { html: U.icon('dumbbell') });
  }

  /* ---------------------------------------------------------------------------
     EXERCISE EDITOR
     ------------------------------------------------------------------------ */

  /**
   * editExercise(exercise|null, onSaved)
   * Muscle percentages are edited as raw weights and normalised on save, so the
   * numbers never have to add to exactly 100 while you are typing.
   */
  function editExercise(ex, onSaved) {
    const isNew = !ex;
    const settings = App.Store.getSettings();
    const draft = Object.assign({
      name: '', equipment: 'barbell', pattern: 'other', unilateral: false,
      muscles: {}, image: null, notes: '', wr: null
    }, ex || {});
    draft.muscles = Object.assign({}, draft.muscles);
    draft.wr = draft.wr ? Object.assign({}, draft.wr) : null;

    /* Ranks are scored against a world record, so every exercise needs one.
       The field is pre-filled from the movement pattern and re-fills whenever
       the pattern or equipment changes — until the value is edited by hand,
       after which it is left alone. */
    let wrTouched = !!(draft.wr && Number(draft.wr.value) > 0);

    const figWrap = U.h('.anat-wrap');
    const sumEl = U.h('.u-xs.u-muted');

    function redrawFigure() {
      App.Anatomy.render(figWrap, App.Muscles.normalise(draft.muscles),
        { compact: true, legend: false, interactive: false });
      const total = Object.keys(draft.muscles)
        .reduce(function (a, k) { return a + (Number(draft.muscles[k]) || 0); }, 0);
      sumEl.textContent = total ? 'Raw total ' + U.num(total, 0) +
        ' — normalised to 100% on save' : 'Add at least one muscle';
    }

    const nameInput = U.h('input.input', {
      value: draft.name, placeholder: 'e.g. Incline Dumbbell Press',
      oninput: function () { draft.name = this.value; }
    });

    const equipSel = U.h('select.select', {
      onchange: function () { draft.equipment = this.value; refillWr(); }
    }, Object.keys(App.Equipment).map(function (k) {
      return U.h('option', { value: k, selected: draft.equipment === k }, App.Equipment[k]);
    }));

    const PATTERNS = ['horizontal-push', 'incline-push', 'vertical-push', 'horizontal-pull',
      'vertical-pull', 'squat', 'hinge', 'lunge', 'olympic', 'carry', 'core',
      'chest-isolation', 'back-isolation', 'shoulder-isolation', 'biceps-isolation',
      'triceps-isolation', 'forearm-isolation', 'quad-isolation', 'ham-isolation',
      'glute-isolation', 'leg-isolation', 'calf-isolation', 'neck-isolation', 'other'];

    const patternSel = U.h('select.select', {
      onchange: function () { draft.pattern = this.value; refillWr(); }
    }, PATTERNS.map(function (p) {
      return U.h('option', { value: p, selected: draft.pattern === p },
        p.replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }));
    }));

    /* --- world record ------------------------------------------------- */

    const wrInput = U.h('input.input.input-num', {
      type: 'number', min: '0', step: '0.5', inputmode: 'decimal',
      oninput: function () { wrTouched = true; syncWrHint(); }
    });
    const wrBwInput = U.h('input.input.input-num', {
      type: 'number', min: '30', max: '400', step: '0.5', inputmode: 'decimal',
      value: (draft.wr && draft.wr.bodyweight) || settings.bodyweight || 80,
      oninput: syncWrHint
    });
    const wrHint = U.h('.hint');

    function suggestedWr() {
      return App.Ranks.worldRecord(draft.pattern, Number(wrBwInput.value) || settings.bodyweight,
        draft.equipment === 'bodyweight');
    }
    function refillWr() {
      if (wrTouched) { syncWrHint(); return; }
      wrInput.value = Math.round(suggestedWr());
      syncWrHint();
    }
    function syncWrHint() {
      const isBw = draft.equipment === 'bodyweight';
      const v = Number(wrInput.value) || 0;
      wrHint.textContent = (isBw
        ? 'For a bodyweight movement this is the TOTAL load — the athlete plus any added weight. '
        : 'The heaviest single rep anyone has done at that bodyweight. ') +
        (v > 0
          ? 'Scaled to your ' + settings.bodyweight + ' ' + settings.units + ': ' +
            Math.round(App.Ranks.exerciseRecord(
              { pattern: draft.pattern, equipment: draft.equipment,
                wr: { value: v, bodyweight: Number(wrBwInput.value) || settings.bodyweight } },
              settings.bodyweight)) + ' ' + settings.units + '.'
          : 'Required — this is what your rank is measured against.');
    }
    if (draft.wr && Number(draft.wr.value) > 0) wrInput.value = draft.wr.value;
    else wrInput.value = Math.round(suggestedWr());

    /* --- image --- */
    const imgPreview = U.h('.ex-thumb', { style: { width: '64px', height: '64px' } });
    function drawImg() {
      U.clear(imgPreview);
      if (draft.image) imgPreview.appendChild(U.h('img', { src: draft.image, alt: '' }));
      else imgPreview.innerHTML = U.icon('image');
    }
    drawImg();

    /* --- muscle rows --- */
    const musclesWrap = U.h('.stack-sm');

    function drawMuscles() {
      U.clear(musclesWrap);
      const ids = Object.keys(draft.muscles);
      if (!ids.length) {
        musclesWrap.appendChild(U.h('.u-xs.u-muted', 'No muscles assigned yet.'));
      }
      ids.forEach(function (id) {
        musclesWrap.appendChild(U.h('.row', [
          U.h('span.u-sm', { style: { flex: '1', minWidth: 0 },
            class: 'u-truncate', text: App.Muscles.label(id, true) }),
          U.h('input.input.input-sm.input-num', {
            type: 'number', min: '0', max: '100', step: '1',
            value: draft.muscles[id], style: { width: '76px' },
            oninput: function () {
              draft.muscles[id] = Number(this.value) || 0;
              redrawFigure();
            }
          }),
          U.h('button.btn.btn-ghost.btn-icon.btn-sm', {
            type: 'button', 'aria-label': 'Remove', html: U.icon('x'),
            onclick: function () { delete draft.muscles[id]; drawMuscles(); redrawFigure(); }
          })
        ]));
      });
    }

    const addMuscleSel = U.h('select.select.input-sm', {
      onchange: function () {
        if (!this.value) return;
        draft.muscles[this.value] = draft.muscles[this.value] || 10;
        this.value = '';
        drawMuscles(); redrawFigure();
      }
    }, [U.h('option', { value: '' }, '+ Add a muscle')].concat(
      Object.keys(App.Muscles.GROUPS).map(function (g) {
        return U.h('optgroup', { label: App.Muscles.GROUPS[g].name },
          App.Muscles.MUSCLES.filter(function (m) { return m.group === g; })
            .map(function (m) { return U.h('option', { value: m.id }, m.name); }));
      })
    ));

    U.modal({
      title: isNew ? 'New exercise' : 'Edit exercise',
      wide: true,
      body: function (body) {
        body.appendChild(U.h('.grid.grid-2', [
          U.h('.field', [U.h('label.label', 'Name'), nameInput]),
          U.h('.field', [U.h('label.label', 'Equipment'), equipSel])
        ]));
        body.appendChild(U.h('.grid.grid-2', [
          U.h('.field', [U.h('label.label', 'Movement pattern'), patternSel,
            U.h('.hint', 'Drives push / pull grouping and strength standards.')]),
          U.h('.field', [
            U.h('label.label', 'Options'),
            U.h('label.switch', [
              U.h('input', { type: 'checkbox', checked: draft.unilateral,
                onchange: function () { draft.unilateral = this.checked; } }),
              U.h('i.switch-track'),
              U.h('span.u-sm', 'One side at a time')
            ])
          ])
        ]));

        body.appendChild(U.h('.field', [
          U.h('label.label', 'World record 1RM'),
          U.h('.grid.grid-2', [
            U.h('.row', [
              wrInput,
              U.h('span.u-sm.u-muted', { text: settings.units })
            ]),
            U.h('.row', [
              U.h('span.u-sm.u-muted.u-nowrap', 'at bodyweight'),
              wrBwInput,
              U.h('span.u-sm.u-muted', { text: settings.units })
            ])
          ]),
          wrHint
        ]));

        body.appendChild(U.h('.field', [
          U.h('label.label', 'Image or GIF'),
          U.h('.row', [
            imgPreview,
            U.h('button.btn.btn-sm', {
              type: 'button', html: U.icon('upload') + '<span>Upload</span>',
              onclick: function () {
                U.readFile('image/*').then(function (f) {
                  return U.shrinkImage(f.data, 360);
                }).then(function (small) {
                  draft.image = small; drawImg();
                }).catch(function () {});
              }
            }),
            draft.image ? U.h('button.btn.btn-sm.btn-ghost', {
              type: 'button', text: 'Remove',
              onclick: function () { draft.image = null; drawImg(); this.remove(); }
            }) : null
          ]),
          U.h('.hint', 'Stored on this device and synced to your own Supabase. ' +
            'Large images are resized automatically.')
        ]));

        body.appendChild(U.h('.editor-split', [
          U.h('div', { style: { minWidth: 0 } }, [
            U.h('.label', { style: { marginBottom: '8px' } }, 'Muscle involvement'),
            musclesWrap,
            U.h('.row.row-wrap', { style: { marginTop: '10px' } },
              [addMuscleSel, U.h('.spacer'), sumEl])
          ]),
          U.h('div', { style: { minWidth: 0 } }, [
            U.h('.label', { style: { marginBottom: '8px' } }, 'Preview'),
            figWrap
          ])
        ]));

        body.appendChild(U.h('.field', [
          U.h('label.label', 'Notes'),
          U.h('textarea.textarea', {
            placeholder: 'Cues, setup, machine number…', value: draft.notes,
            oninput: function () { draft.notes = this.value; }
          })
        ]));

        drawMuscles();
        redrawFigure();
        syncWrHint();
      },
      actions: [
        { label: 'Cancel' },
        { label: isNew ? 'Create exercise' : 'Save changes', kind: 'primary',
          onClick: function (close) {
            if (!draft.name.trim()) { U.toast('Name required', 'Give the exercise a name.', 'bad'); return; }
            if (!Object.keys(draft.muscles).length) {
              U.toast('Muscles required', 'Assign at least one muscle.', 'bad'); return;
            }
            const wrValue = Number(wrInput.value) || 0;
            if (wrValue <= 0) {
              U.toast('World record required',
                'Ranks are scored against it, so every exercise needs one.', 'bad');
              wrInput.focus();
              return;
            }
            draft.wr = {
              value: wrValue,
              bodyweight: Number(wrBwInput.value) || settings.bodyweight || 80,
              units: settings.units
            };
            draft.name = draft.name.trim();
            App.Store.saveExercise(draft).then(function (saved) {
              close();
              U.toast(isNew ? 'Exercise created' : 'Exercise saved', saved.name, 'good');
              if (onSaved) onSaved(saved);
            });
          } }
      ]
    });
  }

  /* ---------------------------------------------------------------------------
     DATE RANGE PICKER
     ------------------------------------------------------------------------ */

  const RANGES = [
    { id: '7', label: '7d', days: 7 },
    { id: '30', label: '30d', days: 30 },
    { id: '90', label: '90d', days: 90 },
    { id: '180', label: '6m', days: 180 },
    { id: '365', label: '1y', days: 365 },
    { id: 'all', label: 'All', days: 3650 }
  ];

  function rangePicker(value, onChange) {
    const group = U.h('.btn-group', { role: 'group', 'aria-label': 'Time range' });
    RANGES.forEach(function (r) {
      group.appendChild(U.h('button.btn.btn-sm' + (r.id === value ? '.is-active' : ''), {
        type: 'button', text: r.label, dataset: { range: r.id },
        onclick: function () {
          group.querySelectorAll('.btn').forEach(function (b) { b.classList.remove('is-active'); });
          this.classList.add('is-active');
          onChange(r);
        }
      }));
    });
    return group;
  }

  function rangeById(id) {
    return RANGES.find(function (r) { return r.id === id; }) || RANGES[1];
  }

  App.C = {
    statTile: statTile,
    heatStrip: heatStrip,
    muscleList: muscleList,
    rankCard: rankCard,
    rankLadder: rankLadder,
    linkRow: linkRow,
    heatPanel: heatPanel,
    pickExercise: pickExercise,
    editExercise: editExercise,
    exThumb: exThumb,
    topMuscleLabel: topMuscleLabel,
    rangePicker: rangePicker,
    rangeById: rangeById,
    RANGES: RANGES
  };
})(window.App = window.App || {});
