/* =============================================================================
   app.js — shell, router, theme
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U;

  const ROUTES = [
    { id: 'home',      title: 'Home',          sub: 'Today at a glance',      icon: 'home' },
    { id: 'exercises', title: 'Exercises',     sub: 'Every movement you train',  icon: 'dumbbell' },
    { id: 'workouts',  title: 'Workouts',      sub: 'Plans and progression',  icon: 'list' },
    { id: 'report',    title: 'Report',        sub: 'Analysis and rankings',  icon: 'chart' },
    { id: 'settings',  title: 'Control Panel', sub: 'Account, sync, theme',   icon: 'settings' }
  ];

  const VERSION = '0.5.2';

  /* Four static, four animated. All derive their colour from the active scheme
     and mode, so they never fight the theme. */
  const BACKGROUNDS = [
    { id: 'plain',  name: 'None',    live: false },
    { id: 'mesh',   name: 'Mesh',    live: false },
    { id: 'grid',   name: 'Grid',    live: false },
    { id: 'glow',   name: 'Glow',    live: false },
    { id: 'strata', name: 'Strata',  live: false },
    { id: 'aurora', name: 'Aurora',  live: true },
    { id: 'orbs',   name: 'Orbs',    live: true },
    { id: 'pulse',  name: 'Pulse',   live: true },
    { id: 'tide',   name: 'Tide',    live: true }
  ];

  const SCHEMES = [
    { id: 'ember',    name: 'Ember' },
    { id: 'flux',     name: 'Flux' },
    { id: 'verdant',  name: 'Verdant' },
    { id: 'violet',   name: 'Violet' },
    { id: 'rose',     name: 'Rose' },
    { id: 'amber',    name: 'Amber' },
    { id: 'ice',      name: 'Ice' },
    { id: 'crimson',  name: 'Crimson' }
  ];

  let current = null;
  let mainEl = null;

  /* ---------------------------------------------------------------------------
     THEME
     ------------------------------------------------------------------------ */

  function applyTheme(settings) {
    const root = document.documentElement;
    root.setAttribute('data-mode', settings.mode || 'dark');
    root.setAttribute('data-scheme', settings.scheme || 'ember');
    root.setAttribute('data-bg', settings.background || 'plain');

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content',
        getComputedStyle(root).getPropertyValue('--bg').trim() || '#0f1216');
    }
  }

  /* ---------------------------------------------------------------------------
     ROUTER
     ------------------------------------------------------------------------ */

  function parseHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const [id, ...rest] = raw.split('/');
    const route = ROUTES.find(function (r) { return r.id === id; }) || ROUTES[0];
    return { route: route, params: rest };
  }

  function navigate(path) {
    location.hash = '#/' + String(path).replace(/^#?\/?/, '');
  }

  function render() {
    const { route, params } = parseHash();
    current = route.id;

    U.$$('.nav-link').forEach(function (a) {
      a.classList.toggle('is-active', a.dataset.route === route.id);
      if (a.dataset.route === route.id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    U.$('#pageTitle').textContent = route.title;
    U.$('#pageSub').textContent = route.sub;
    document.title = route.title + ' · AI-Gym';

    const page = App.Pages[route.id];
    U.clear(mainEl);
    if (!page) {
      mainEl.appendChild(U.h('.empty', [U.h('p', 'This page is not available.')]));
      return;
    }
    try {
      page.render(mainEl, params);
    } catch (err) {
      console.error('[app] page render failed', err);
      mainEl.appendChild(U.h('.card', [
        U.h('.empty', [
          U.h('.empty-title', 'Something went wrong rendering this page'),
          U.h('p.u-mono.u-xs', { text: err.message })
        ])
      ]));
    }
    mainEl.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------------------
     SHELL
     ------------------------------------------------------------------------ */

  /**
   * Host for the decorative background. Three real elements rather than the two
   * available pseudo-elements, so a background can move several layers
   * independently and each one can be promoted to its own compositor layer.
   */
  function buildBackground() {
    const fx = U.h('.bg-fx', { 'aria-hidden': 'true' }, [
      U.h('i.bg-l1'), U.h('i.bg-l2'), U.h('i.bg-l3'),
      U.h('i.bg-l4'), U.h('i.bg-l5'), U.h('i.bg-l6')
    ]);
    document.body.appendChild(fx);
  }

  function buildShell() {
    buildBackground();
    const nav = U.h('nav.nav', { 'aria-label': 'Main' }, [
      U.h('.brand', [
        U.h('.brand-mark', 'AG'),
        U.h('div', [
          U.h('.brand-name', 'AI-Gym'),
          U.h('.brand-sub', 'Training log')
        ])
      ]),
      U.h('ul.nav-list', ROUTES.map(function (r) {
        return U.h('li', [
          U.h('a.nav-link', {
            href: '#/' + r.id,
            dataset: { route: r.id },
            html: U.icon(r.icon, 'nav-ico') + '<span>' + U.esc(r.title) + '</span>'
          })
        ]);
      })),
      U.h('.nav-foot', [
        U.h('.nav-status#syncStatus', [
          U.h('i.dot'),
          U.h('span', 'Local only')
        ])
      ])
    ]);

    const topbar = U.h('header.topbar', [
      U.h('div', [
        U.h('h1#pageTitle', 'Home'),
        U.h('.topbar-sub#pageSub', '')
      ]),
      U.h('.topbar-actions#topActions')
    ]);

    mainEl = U.h('.page#pageRoot');

    const app = U.h('.app', [
      nav,
      U.h('.main', [topbar, mainEl])
    ]);

    document.body.appendChild(app);
  }

  function updateSyncBadge() {
    const el = U.$('#syncStatus');
    if (!el) return;
    const s = App.Sync.status();
    const dot = el.querySelector('.dot');
    const label = el.querySelector('span');

    dot.className = 'dot';
    if (s.busy) { dot.classList.add('is-on'); label.textContent = 'Syncing…'; return; }
    if (s.personal.configured && s.personal.verified) {
      dot.classList.add('is-on');
      label.textContent = s.hub.signedIn ? 'Cloud + friends' : 'Cloud synced';
    } else if (s.personal.configured) {
      dot.classList.add('is-err');
      label.textContent = 'Setup incomplete';
    } else {
      dot.classList.add('is-off');
      label.textContent = 'Local only';
    }
  }

  /* ---------------------------------------------------------------------------
     BOOT
     ------------------------------------------------------------------------ */

  function boot() {
    buildShell();

    App.Store.load()
      .then(function () {
        applyTheme(App.Store.getSettings());
        App.Store.on('settings', applyTheme);
        App.Store.on('sync', updateSyncBadge);
        App.Store.on('change', function () {
          /* Re-render the active page when data changes underneath it. */
          const page = App.Pages[current];
          if (page && page.onDataChange) page.onDataChange();
        });

        window.addEventListener('hashchange', render);
        if (!location.hash) location.hash = '#/home';

        /* Read the stored session and project config BEFORE the first paint.
           This is local-only and fast; the network half runs afterwards. Doing
           it in the other order meant a refresh landing directly on the Control
           Panel rendered before the account was known and reported the user as
           signed out — correct a moment later, but only if they navigated. */
        /* The data key must exist before anything is encrypted or decrypted. */
        return App.Crypto.loadOrCreate().then(function () { return App.Sync.load(); });
      })
      .then(function () {
        render();
        return App.Sync.start();
      })
      .then(function () {
        updateSyncBadge();
        /* Best-effort: ask the browser to keep our data through storage pressure. */
        App.DB.persist();
        App.Update.boot();
        return maybeFirstRun();
      })
      .catch(function (err) {
        console.error('[app] boot failed', err);
        document.body.appendChild(U.h('.card', {
          style: { margin: '40px auto', maxWidth: '520px' }
        }, [
          U.h('h2', 'AI-Gym could not start'),
          U.h('p.u-sm.u-muted', { text: err.message }),
          U.h('p.u-sm.u-muted', 'Try opening the app through a local server rather than ' +
            'directly from the file system.')
        ]));
      });
  }

  function maybeFirstRun() {
    const s = App.Store.getSettings();
    if (!s.firstRun) return;
    App.Store.saveSettings({ firstRun: false });
    U.toast('Welcome to AI-Gym',
      App.Store.allExercises().length + ' exercises loaded and ready. Everything works offline.',
      'good');
  }

  App.VERSION = VERSION;

  App.Shell = {
    ROUTES: ROUTES,
    SCHEMES: SCHEMES,
    BACKGROUNDS: BACKGROUNDS,
    VERSION: VERSION,
    navigate: navigate,
    render: render,
    applyTheme: applyTheme,
    updateSyncBadge: updateSyncBadge,
    topActions: function () { return U.$('#topActions'); },
    setTopActions: function (nodes) {
      const el = U.$('#topActions');
      U.clear(el);
      (Array.isArray(nodes) ? nodes : [nodes]).forEach(function (n) { if (n) el.appendChild(n); });
    }
  };

  App.Pages = App.Pages || {};

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.App = window.App || {});
