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
   * Snapshot, then reload against a fresh URL. The cache-busting query is what
   * makes a host with an aggressive edge cache (GitHub Pages) hand over the new
   * document rather than the one it already has; the hash rides along so the
   * user lands back on the same screen.
   */
  function apply() {
    return saveSnapshot().then(function () {
      return App.DB.setMeta('update.skipped', null);
    }).catch(function () {}).then(function () {
      const base = location.origin + location.pathname;
      location.replace(base + '?u=' + Date.now() + (location.hash || ''));
    });
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

  /** Never rejects: an update check must not be able to break start-up. */
  function boot() {
    bindLifecycle();
    /* Give the app a moment to settle before spending network on this. */
    setTimeout(function () {
      check(false).then(function (found) { if (found) prompt(found); })
        .catch(function () {});
    }, 4000);
  }

  App.Update = {
    VERSION_URL: RELEASES_PAGE,
    check: check,
    prompt: prompt,
    apply: apply,
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
