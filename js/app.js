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

  const VERSION = '0.7.0';

  /* Six static, six animated. All derive their colour from the active scheme
     and mode, so they never fight the theme. */
  const BACKGROUNDS = [
    { id: 'plain',    name: 'None',     live: false },
    { id: 'mesh',     name: 'Mesh',     live: false },
    { id: 'grid',     name: 'Grid',     live: false },
    { id: 'glow',     name: 'Glow',     live: false },
    { id: 'strata',   name: 'Strata',   live: false },
    { id: 'skyline',  name: 'Skyline',  live: false },
    { id: 'circuit',  name: 'Circuit',  live: false },
    { id: 'aurora',   name: 'Aurora',   live: true },
    { id: 'orbs',     name: 'Orbs',     live: true },
    { id: 'pulse',    name: 'Pulse',    live: true },
    { id: 'tide',     name: 'Tide',     live: true },
    { id: 'neon',     name: 'Neon City', live: true },
    { id: 'hologrid', name: 'Hologrid', live: true },
    { id: 'custom', name: 'Your picture' },
    { id: 'css', name: 'Your CSS' }
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

  /* ---------------------------------------------------------------------------
     MOTION BUDGET

     An animated background is pure fill rate: every frame repaints a
     viewport-sized layer for each element that moves. A phone from five years
     ago has a fraction of the fill rate of a current one, so six moving layers
     that are free on a desk are not free on a Galaxy J1.

     `auto` therefore asks the device what it is. `deviceMemory` and
     `hardwareConcurrency` are crude, but they are the only budget signals a
     browser actually offers, and they are honest in the direction that matters:
     a phone reporting 2GB or four cores is genuinely a phone that will struggle.
     Anything that does not answer at all is old enough that the guess should be
     the cautious one. The choice is overridable, because a guess about someone
     else's hardware should never be the last word on it.
     ------------------------------------------------------------------------ */
  function resolveMotion(pref) {
    if (pref === 'full' || pref === 'low' || pref === 'off') return pref;
    try {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off';
    } catch (e) { /* pre-matchMedia is itself a signal */ }
    const mem = navigator.deviceMemory;
    const cores = navigator.hardwareConcurrency;
    if ((mem !== undefined && mem <= 2) || (cores !== undefined && cores <= 4)) return 'low';
    if (mem === undefined && cores === undefined) return 'low';
    return 'full';
  }

  /**
   * Paint the two wallpapers that are not built in: a picture, gif or video of
   * the user's own, and a stylesheet they wrote themselves.
   *
   * The media element is created only for `custom`, and torn down the moment
   * the background changes — a paused 4K video held in a detached node still
   * costs memory, and this app runs on phones.
   */
  /* Bumped on every call. The wallpaper is fetched asynchronously, so two
     calls in quick succession — saving a setting emits a change, which paints
     again — would both resolve and both insert. Only the newest token is
     allowed to put anything on screen. */
  let bgToken = 0;

  function applyCustomBackground(settings) {
    const host = U.$('.bg-fx');
    if (!host) return;
    const bg = settings.background;
    const token = ++bgToken;

    U.$$('.bg-custom', host).forEach(function (n) { n.remove(); });
    const oldCss = document.getElementById('bgCustomCss');
    if (oldCss) oldCss.remove();

    if (bg === 'css') {
      /* Scoped to the layer host by a wrapper rule, so the worst a mistake can
         do is make the background ugly — it cannot reach the app's own chrome
         and lock somebody out of the setting that would undo it. */
      const style = document.createElement('style');
      style.id = 'bgCustomCss';
      style.textContent = '[data-bg="css"] .bg-fx {' + (settings.customCss || '') + '}';
      document.head.appendChild(style);
      return;
    }

    if (bg !== 'custom') return;

    App.Store.getWallpaper().then(function (rec) {
      if (token !== bgToken) return;
      if (!rec || !rec.data) return;
      if (App.Store.getSettings().background !== 'custom') return;
      U.$$('.bg-custom', host).forEach(function (n) { n.remove(); });
      const fit = settings.customFit || 'cover';
      const el = rec.type && rec.type.indexOf('video') === 0
        ? U.h('video.bg-custom', {
          src: rec.data, autoplay: true, loop: true, muted: true,
          playsinline: true, 'aria-hidden': 'true'
        })
        : U.h('img.bg-custom', { src: rec.data, alt: '', 'aria-hidden': 'true' });
      el.style.objectFit = fit === 'tile' ? 'none' : fit;
      if (fit === 'tile' && el.tagName === 'IMG') {
        /* A tiled still is a background-image, not an <img> — an <img> can only
           ever be one copy of itself. */
        const tile = U.h('i.bg-custom');
        tile.style.backgroundImage = 'url(' + JSON.stringify(rec.data) + ')';
        tile.style.backgroundRepeat = 'repeat';
        host.insertBefore(tile, host.firstChild);
        return;
      }
      if (el.tagName === 'VIDEO') el.muted = true;
      host.insertBefore(el, host.firstChild);
    }).catch(function () { /* a wallpaper is decoration; never a failure */ });
  }

  function applyTheme(settings) {
    const root = document.documentElement;
    root.setAttribute('data-mode', settings.mode || 'dark');
    root.setAttribute('data-scheme', settings.scheme || 'ember');
    root.setAttribute('data-bg', settings.background || 'plain');
    root.setAttribute('data-bgmotion', resolveMotion(settings.bgMotion));
    root.style.setProperty('--custom-dim',
      String(Math.max(0, Math.min(90, Number(settings.customDim) || 0)) / 100));
    applyCustomBackground(settings);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content',
        getComputedStyle(root).getPropertyValue('--bg').trim() || '#0f1216');
    }
  }

  /* Frames spent animating a background nobody can see are frames stolen from
     whatever the device does next. Browsers throttle a hidden tab, but a
     web-to-app shell is not a tab and does not reliably get that treatment. */
  function watchVisibility() {
    function sync() {
      const root = document.documentElement;
      if (document.visibilityState === 'hidden') root.setAttribute('data-bgpaused', '');
      else root.removeAttribute('data-bgpaused');
    }
    document.addEventListener('visibilitychange', sync);
    sync();
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
   * Host for the decorative background. Eight real elements rather than the
   * two available pseudo-elements, so a background can move several layers
   * independently and each one can be promoted to its own compositor layer.
   * Layers a background does not claim paint nothing and are never promoted.
   *
   * Eight rather than six because the city needs a lit-window layer per depth
   * band — each has to travel with the towers it belongs to, or the lights
   * slide off their own buildings — plus a horizon glow on top of that.
   */
  function buildBackground() {
    const fx = U.h('.bg-fx', { 'aria-hidden': 'true' }, [
      U.h('i.bg-l1'), U.h('i.bg-l2'), U.h('i.bg-l3'), U.h('i.bg-l4'),
      U.h('i.bg-l5'), U.h('i.bg-l6'), U.h('i.bg-l7'), U.h('i.bg-l8')
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
    watchVisibility();

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
            'directly from the file system.'),
          /* A version that will not start is the one case where an update is
             most likely to be the fix, so the check has to survive the failure
             that made it necessary. */
          U.h('button.btn.btn-primary', {
            type: 'button', html: U.icon('refresh') + '<span>Check for an update</span>',
            onclick: function () { App.Update.autoCheck(true); }
          })
        ]));
        /* The automatic check is bound here as well as on the happy path — it
           is idempotent, and a boot that died before reaching it would
           otherwise never look for the release that fixes it. */
        try { App.Update.boot(); } catch (e) { /* nothing left to fall back to */ }
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
    resolveMotion: resolveMotion,
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
