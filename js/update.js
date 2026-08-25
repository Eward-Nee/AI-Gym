/* =============================================================================
   update.js — in-app version check, and safe reload

   Two halves:

   1. CHECK. Ask GitHub what the latest release is; fall back to the deployed
      version.json on our own origin. The fallback matters because a build can
      be live on Pages before anyone tags a release, and because the GitHub API
      is rate-limited for unauthenticated callers.

   2. RESUME. A reload must never cost the user work in progress. Pages register
      a snapshot provider; the snapshot is written to IndexedDB continuously and
      restored on the next boot, so an update taken mid-workout comes back with
      the same sets ticked and the clock still running from the original start.
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U;

  const REPO = 'Eward-Nee/AI-Gym';
  const RELEASES_API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  const RELEASES_PAGE = 'https://github.com/' + REPO + '/releases';
  const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   /* at most four times a day */
  const RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;  /* stale snapshots are dropped */

  let snapshotProvider = null;
  let pending = null;      /* the version we found, if newer */

  /* ---------------------------------------------------------------------------
     VERSION COMPARISON
     ------------------------------------------------------------------------ */

  function parse(v) {
    return String(v || '').trim().replace(/^v/i, '').split('.')
      .map(function (n) { return parseInt(n, 10) || 0; });
  }

  /** > 0 when a is newer than b. */
  function compare(a, b) {
    const x = parse(a), y = parse(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  function isNewer(remote) { return compare(remote, App.VERSION) > 0; }

  /* ---------------------------------------------------------------------------
     CHECK
     ------------------------------------------------------------------------ */

  function fetchJson(url, timeoutMs) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000) : null;
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
      .then(function (r) {
        if (t) clearTimeout(t);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function (e) { if (t) clearTimeout(t); throw e; });
  }

  /** Latest published GitHub release, or null when there are none. */
  function checkGithub() {
    return fetchJson(RELEASES_API).then(function (r) {
      if (!r || !r.tag_name) return null;
      return { version: String(r.tag_name).replace(/^v/i, ''), source: 'github',
        notes: r.body || '', url: r.html_url || RELEASES_PAGE };
    });
  }

  /** The version.json sitting next to this build. */
  function checkDeployed() {
    return fetchJson('version.json?t=' + Date.now()).then(function (r) {
      if (!r || !r.version) return null;
      return { version: String(r.version), source: 'deployed', notes: r.notes || '',
        url: RELEASES_PAGE };
    });
  }

  /**
   * @param {boolean} force  ignore the interval (used by the manual button)
   * @returns {Promise<null|{version, source, notes, url}>} newer release, if any
   */
  function check(force) {
    return App.DB.getMeta('update.lastCheck', 0).then(function (last) {
      if (!force && Date.now() - (last || 0) < CHECK_INTERVAL_MS) return null;
      if (!navigator.onLine) return null;

      return checkGithub()
        .catch(function () { return null; })
        .then(function (gh) { return gh || checkDeployed().catch(function () { return null; }); })
        .then(function (found) {
          App.DB.setMeta('update.lastCheck', Date.now());
          if (!found || !isNewer(found.version)) return null;
          return App.DB.getMeta('update.skipped', null).then(function (skipped) {
            /* Respect "Later" until a version newer than the skipped one appears. */
            if (skipped && compare(found.version, skipped) <= 0 && !force) return null;
            pending = found;
            return found;
          });
        });
    }).catch(function () { return null; });
  }

  /* ---------------------------------------------------------------------------
     RESUME SNAPSHOTS
     ------------------------------------------------------------------------ */

  /**
   * Register what to preserve across a reload.
   * @param {function(): Object|null} fn  returns a serialisable snapshot
   */
  function registerSnapshot(fn) { snapshotProvider = fn; }
  function clearSnapshot() {
    snapshotProvider = null;
    return App.DB.setMeta('resume', null);
  }

  /** Persist the current snapshot. Cheap enough to call on every edit. */
  function saveSnapshot() {
    if (!snapshotProvider) return Promise.resolve();
    let snap = null;
    try { snap = snapshotProvider(); } catch (e) { return Promise.resolve(); }
    if (!snap) return Promise.resolve();
    return App.DB.setMeta('resume', {
      hash: location.hash, at: Date.now(), version: App.VERSION, data: snap
    });
  }

  /** The snapshot from before the last reload, if it is still fresh. */
  function takeSnapshot() {
    return App.DB.getMeta('resume', null).then(function (r) {
      if (!r || !r.data) return null;
      if (Date.now() - (r.at || 0) > RESUME_MAX_AGE_MS) {
        App.DB.setMeta('resume', null);
        return null;
      }
      return r;
    }).catch(function () { return null; });
  }

  /* A snapshot is also taken whenever the app is backgrounded or closed, so an
     OS-initiated kill is survivable, not just our own reload. */
  function bindLifecycle() {
    ['pagehide', 'beforeunload'].forEach(function (evt) {
      window.addEventListener(evt, function () { saveSnapshot(); });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveSnapshot();
    });
  }

  /* ---------------------------------------------------------------------------
     APPLY
     ------------------------------------------------------------------------ */

  /**
   * Pull every same-origin asset through the network and into the HTTP cache.
   *
   * Busting the document URL alone was not enough, and this is exactly why the
   * update button looked inert: the app's code is the twenty script and
   * stylesheet files that index.html references by unchanging relative paths.
   * Reloading `index.html?u=<now>` fetched a fresh document and then served
   * every one of those from cache, so the app came back running the very
   * version it had been asked to leave. It only appeared to work once those
   * cache entries aged out on their own, several attempts later.
   *
   * `cache: 'reload'` is the cure: it skips the cache on the way out and writes
   * what it receives back into the cache, so the reload that follows parses the
   * new files.
   */
  function refreshAssets() {
    /* Nothing to defeat on file://, where fetch is not usable anyway. */
    if (typeof fetch !== 'function' || location.protocol === 'file:') {
      return Promise.resolve(0);
    }

    const urls = [];
    const seen = Object.create(null);

    function want(raw) {
      if (!raw) return;
      let abs;
      try { abs = new URL(raw, location.href); } catch (e) { return; }
      if (abs.origin !== location.origin) return;
      abs.hash = '';
      if (seen[abs.href]) return;
      seen[abs.href] = true;
      urls.push(abs.href);
    }

    const nodes = document.querySelectorAll('script[src], link[rel="stylesheet"][href]');
    Array.prototype.forEach.call(nodes, function (el) {
      want(el.getAttribute('src') || el.getAttribute('href'));
    });
    want('version.json');

    let ok = 0;
    return Promise.all(urls.map(function (u) {
      return fetch(u, { cache: 'reload' })
        .then(function (r) { if (r.ok) ok++; })
        /* One unreachable asset must not strand the user on the old version. */
        .catch(function () {});
    })).then(function () { return ok; });
  }

  /**
   * Snapshot, refresh the code, then reload against a fresh URL. The
   * cache-busting query handles the document; refreshAssets() handles
   * everything the document pulls in. The hash rides along so the user lands
   * back on the same screen.
   */
  function apply() {
    const target = pending ? pending.version : null;

    return saveSnapshot().then(function () {
      return App.DB.setMeta('update.skipped', null);
    }).then(function () {
      /* Remember what should come back, so an update that does not take can be
         reported instead of passed off as a success. */
      return App.DB.setMeta('update.expecting', target);
    }).catch(function () {}).then(function () {
      return refreshAssets().catch(function () { return 0; });
    }).then(function () {
      const base = location.origin + location.pathname;
      location.replace(base + '?u=' + Date.now() + (location.hash || ''));
    });
  }

  /**
   * Report on the update requested before the last reload.
   *
   * Coming back on the old version is the failure the user actually saw, and
   * saying nothing about it is what made the button look like it did nothing.
   * If the code is still stale, say so and name the one thing that always
   * works — a hard refresh, which bypasses the cache for the whole page.
   */
  function verifyApplied() {
    return App.DB.getMeta('update.expecting', null).then(function (want) {
      if (!want) return null;
      return App.DB.setMeta('update.expecting', null).then(function () {
        if (compare(want, App.VERSION) <= 0) {
          U.toast('Updated', 'Now on ' + App.VERSION + '.', 'good');
          return null;
        }

        const mac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
        U.modal({
          title: 'The update did not take',
          body: function (body) {
            body.appendChild(U.h('.callout.is-warn', [
              U.h('.callout-bar'),
              U.h('div', [
                U.h('div', [U.h('strong', 'Still on ' + App.VERSION + ', not ' + want + '.')]),
                U.h('.u-xs.u-muted', { style: { marginTop: '4px' },
                  text: 'The browser served the old code from its cache. Nothing is ' +
                    'wrong with your data — only the app files are stale.' })
              ])
            ]));
            body.appendChild(U.h('p.u-sm',
              'A hard refresh bypasses the cache for the whole page and always works:'));
            body.appendChild(U.h('ul.u-sm', { style: { paddingLeft: '18px' } }, [
              U.h('li', mac ? 'Mac: ⌘ + Shift + R' : 'Windows / Linux: Ctrl + Shift + R'),
              U.h('li', 'Phone: reload from the browser menu')
            ]));
          },
          actions: [
            { label: 'Dismiss' },
            { label: 'Try again', kind: 'primary', onClick: function (close) {
              close();
              pending = { version: want, source: 'retry', notes: '', url: RELEASES_PAGE };
              setTimeout(apply, 200);
            } }
          ]
        });
        return null;
      });
    }).catch(function () { return null; });
  }

  function skip(version) {
    return App.DB.setMeta('update.skipped', version);
  }

  /* ---------------------------------------------------------------------------
     PROMPT
     ------------------------------------------------------------------------ */

  function prompt(found) {
    const busy = !!snapshotProvider;
    U.modal({
      title: 'Update available',
      body: function (body) {
        body.appendChild(U.h('.row', [
          U.h('.rank-medal', { style: { '--rank-color': 'var(--accent)', width: '46px',
            height: '46px', fontSize: 'var(--fs-sm)' }, text: 'v' + found.version }),
          U.h('div', [
            U.h('div', { style: { fontWeight: '620' },
              text: 'AI-Gym ' + found.version + ' is out' }),
            U.h('.u-xs.u-muted', { text: 'You are on ' + App.VERSION +
              (found.source === 'github' ? ' · from GitHub releases' : ' · from the live build') })
          ])
        ]));

        if (found.notes) {
          body.appendChild(U.h('.callout', [
            U.h('.callout-bar'),
            U.h('div.u-sm', { text: String(found.notes).slice(0, 400) })
          ]));
        }

        body.appendChild(U.h('.callout' + (busy ? '.is-good' : ''), [
          U.h('.callout-bar'),
          U.h('div', [
            U.h('strong', busy ? 'Your session is safe. ' : 'Nothing will be lost. '),
            busy
              ? 'You are mid-workout — the sets you have ticked, the weights you have ' +
                'entered and the elapsed time are all saved and restored after the update.'
              : 'Updating just reloads the app. All your data lives on this device and ' +
                'is untouched.'
          ])
        ]));
      },
      actions: [
        { label: 'Later', onClick: function (close) { skip(found.version); close(); } },
        { label: 'Update now', kind: 'primary', onClick: function (close) {
          close();
          U.toast('Updating…', 'Reloading with the new version.');
          setTimeout(apply, 250);
        } }
      ]
    });
  }

  /* ---------------------------------------------------------------------------
     BOOT
     ------------------------------------------------------------------------ */

  /* ---------------------------------------------------------------------------
     PROJECT SCHEMA
     A new app version can expect columns the user's own Supabase project does
     not have yet. Checking the app version alone would leave them with an app
     that cannot write to its own database, which is exactly the failure this
     section exists to prevent.
     ------------------------------------------------------------------------ */

  function checkSchema() {
    if (!App.Sync || !App.Sync.enabled()) return Promise.resolve(null);
    return App.Sync.checkPersonalSchema().then(function (st) {
      return (st && st.needsUpdate) ? st : null;
    }).catch(function () { return null; });
  }

  /**
   * Offer to bring the project up to date. From v2 the project can migrate
   * itself through gym_migrate(); before that the first step is unavoidably a
   * copy-paste, because adding a column is DDL and a publishable key cannot run
   * DDL. Either way the user ends up with a working project.
   */
  function promptSchema(st) {
    const ref = App.Supabase.projectRef(App.Sync.cfg.personal.url);
    const sqlUrl = 'https://supabase.com/dashboard/project/' + (ref || '_') + '/sql/new';

    U.modal({
      title: 'Your Supabase project needs updating',
      body: function (body, close) {
        body.appendChild(U.h('.callout.is-warn', [
          U.h('.callout-bar'),
          U.h('div', [
            U.h('div', [U.h('strong', 'Project is on schema v' + st.current + ', ' +
              'this version needs v' + st.required + '.')]),
            U.h('.u-xs.u-muted', { style: { marginTop: '4px' },
              text: 'Until it is updated the app keeps working and still uploads — ' +
                'it just leaves out the newer columns.' })
          ])
        ]));

        const result = U.h('div');

        if (st.canSelfMigrate) {
          body.appendChild(U.h('p.u-sm',
            'This project can update itself. Nothing is dropped — the migration only ' +
            'adds what is missing.'));
          body.appendChild(U.h('button.btn.btn-primary', {
            type: 'button', html: U.icon('zap') + '<span>Update my project now</span>',
            onclick: function () {
              const btn = this;
              btn.disabled = true;
              btn.innerHTML = '<i class="spinner"></i><span>Updating…</span>';
              App.Sync.migratePersonal().then(function (r) {
                U.clear(result);
                result.appendChild(U.h('.callout.is-good', [
                  U.h('.callout-bar'),
                  U.h('div', [U.h('strong', 'Updated. '),
                    'Now on schema v' + (r.schema ? r.schema.current : st.required) + '.'])
                ]));
                btn.remove();
                U.toast('Project updated', 'Schema is up to date.', 'good');
              }).catch(function (e) {
                btn.disabled = false;
                btn.innerHTML = U.icon('zap') + '<span>Try again</span>';
                U.clear(result);
                result.appendChild(manualBlock(e.message));
              });
            }
          }));
          body.appendChild(result);
        } else {
          body.appendChild(manualBlock(null));
        }

        function manualBlock(why) {
          const wrap = U.h('.stack', { style: { marginTop: '12px' } });
          if (why) {
            wrap.appendChild(U.h('.callout.is-bad', [
              U.h('.callout-bar'),
              U.h('div', [U.h('strong', 'Automatic update failed. '), why,
                ' Run it by hand instead:'])
            ]));
          } else {
            wrap.appendChild(U.h('p.u-sm',
              'This project predates the self-update hook, so this one has to be run by ' +
              'hand. It is the last time — from the next version the app can do it itself.'));
          }
          wrap.appendChild(App.C.linkRow(sqlUrl, {
            label: ref ? 'SQL editor for ' + ref : 'Supabase SQL editor',
            primary: true,
            hint: 'Open this, paste the script below, press Run, then come back and ' +
              'press Re-check.'
          }));
          wrap.appendChild(sqlBlock());
          wrap.appendChild(U.h('button.btn.btn-block', {
            type: 'button', html: U.icon('refresh') + '<span>Re-check</span>',
            onclick: function () {
              const b = this;
              b.disabled = true;
              App.Sync.checkPersonalSchema().then(function (s2) {
                b.disabled = false;
                if (s2 && !s2.needsUpdate) {
                  U.toast('Project updated', 'Now on schema v' + s2.current + '.', 'good');
                  close();
                } else {
                  U.toast('Still on v' + (s2 ? s2.current : '?'),
                    'Make sure the script ran without errors.', 'bad');
                }
              });
            }
          }));
          return wrap;
        }

        /**
         * The script is ~15 000 characters. Nobody reads it on a phone, and
         * showing it inline turned this dialog into a wall of SQL. Copy is the
         * action that matters, so that stays in front; the text itself is
         * behind a disclosure for anyone who wants to check it first.
         */
        function sqlBlock() {
          const pre = U.h('pre', { text: 'Loading…' });
          const copyBtn = U.h('button.btn.btn-block', {
            type: 'button', html: U.icon('copy') + '<span>Copy the update script</span>',
            onclick: function () {
              U.copyOrShow(pre.textContent, {
                label: 'Paste it into the Supabase SQL editor and press Run.',
                title: 'Copy the update SQL' });
            }
          });

          const details = U.h('details.code-details', [
            U.h('summary', 'Show the script'),
            U.h('.code', [pre])
          ]);

          fetch('sql/user-schema.sql')
            .then(function (r) { return r.text(); })
            .then(function (t) { pre.textContent = t; })
            .catch(function () {
              pre.textContent = 'Could not load sql/user-schema.sql from here.\n' +
                'Open it from the app folder and paste the whole file.';
            });

          return U.h('.stack-sm', [copyBtn, details]);
        }
      },
      actions: [{ label: 'Later' }]
    });
  }

  /** Never rejects: an update check must not be able to break start-up. */
  function boot() {
    bindLifecycle();

    /* Settle the previous update before looking for the next one, otherwise a
       failed update is immediately re-offered with no explanation of why the
       last attempt changed nothing. */
    verifyApplied();

    /* Give the app a moment to settle before spending network on this. */
    setTimeout(function () {
      check(false)
        .then(function (found) {
          if (found) { prompt(found); return null; }
          /* No app update pending — is the project itself behind? */
          return checkSchema().then(function (st) { if (st) promptSchema(st); });
        })
        .catch(function () {});
    }, 4000);
  }

  App.Update = {
    VERSION_URL: RELEASES_PAGE,
    check: check,
    checkSchema: checkSchema,
    prompt: prompt,
    promptSchema: promptSchema,
    apply: apply,
    refreshAssets: refreshAssets,
    verifyApplied: verifyApplied,
    skip: skip,
    compare: compare,
    isNewer: isNewer,
    boot: boot,
    registerSnapshot: registerSnapshot,
    clearSnapshot: clearSnapshot,
    saveSnapshot: saveSnapshot,
    takeSnapshot: takeSnapshot,
    get pending() { return pending; }
  };
})(window.App = window.App || {});
