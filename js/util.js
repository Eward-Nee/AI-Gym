/* =============================================================================
   util.js — DOM helpers, formatting, icons, toasts, modals
   ============================================================================= */
(function (App) {
  'use strict';

  /* ---------------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------------ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** h('div.card', {onclick}, [children]) — terse element factory. */
  function h(spec, attrs, children) {
    const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
    const el = document.createElement(m[1] || 'div');
    (m[2] || '').split(/(?=[.#])/).forEach(function (t) {
      if (!t) return;
      if (t[0] === '.') el.classList.add(t.slice(1));
      else el.id = t.slice(1);
    });
    if (attrs && (attrs.nodeType || typeof attrs === 'string' || Array.isArray(attrs))) {
      children = attrs; attrs = null;
    }
    for (const k in (attrs || {})) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else el.setAttribute(k, v === true ? '' : v);
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    if (children === null || children === undefined) return el;
    if (Array.isArray(children)) { children.forEach(function (c) { append(el, c); }); return el; }
    el.appendChild(children.nodeType ? children : document.createTextNode(String(children)));
    return el;
  }

  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Delegated listener: on(root, 'click', '.btn', handler). */
  function on(root, type, sel, fn) {
    root.addEventListener(type, function (e) {
      const t = e.target.closest ? e.target.closest(sel) : null;
      if (t && root.contains(t)) fn.call(t, e, t);
    });
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 220);
    };
  }

  /* ---------------------------------------------------------------------------
     FORMAT
     ------------------------------------------------------------------------ */

  function num(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    const d = dp === undefined ? (Math.abs(v) >= 100 ? 0 : 1) : dp;
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function compact(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(v));
  }

  function pct(v, dp) { return num(v, dp === undefined ? 0 : dp) + '%'; }

  /** Seconds -> "1:30" / "45s". */
  function dur(s) {
    s = Math.round(s || 0);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return m + ':' + String(r).padStart(2, '0');
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  function fmtDate(iso, style) {
    if (!iso) return '—';
    const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(d)) return '—';
    if (style === 'short') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (style === 'long') return d.toLocaleDateString(undefined,
      { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function relDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    const days = Math.round((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    if (days < 30) return Math.floor(days / 7) + 'w ago';
    if (days < 365) return Math.floor(days / 30) + 'mo ago';
    return Math.floor(days / 365) + 'y ago';
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  function uid(prefix) {
    return (prefix || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /* ---------------------------------------------------------------------------
     ICONS — 20x20 stroke set, currentColor
     ------------------------------------------------------------------------ */

  const PATHS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-6h5v6"/>',
    dumbbell: '<path d="M6.5 8v8M3.5 10v4M17.5 8v8M20.5 10v4M6.5 12h11"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3.5 3L20 7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    play: '<path d="M6 4l14 8-14 8z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 5.2a3.5 3.5 0 0 1 0 6.6M18.5 20a6.5 6.5 0 0 0-3-5.5"/>',
    cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.6A3.7 3.7 0 0 0 7 19z"/>',
    db: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5.5H4.5A2.5 2.5 0 0 0 7 10M17 5.5h2.5A2.5 2.5 0 0 1 17 10"/><path d="M9.5 20h5M12 14v6"/>',
    flame: '<path d="M12 22c4 0 7-2.7 7-6.5 0-4.5-4.5-6-4.5-10.5C11 7 12 8.5 12 10c0-2-1.5-3.5-3-4.5.5 3-4 4-4 10C5 19.3 8 22 12 22z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    download: '<path d="M12 3v12"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/>',
    upload: '<path d="M12 20V8"/><path d="m7.5 12 4.5-4.5L16.5 12"/><path d="M4 4h16"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4v5h-5"/>',
    link: '<path d="M10 13a4.5 4.5 0 0 0 6.4.4l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11.4 5.6"/><path d="M14 11a4.5 4.5 0 0 0-6.4-.4L5 13.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17.5h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    grip: '<path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-6 6-2-2-5 5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    save: '<path d="M5 4h11l4 4v12H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>'
  };

  /**
   * Inline icon. Always carries width/height so an unstyled call site gets a
   * sane intrinsic size instead of the SVG default replaced-element box; any
   * CSS rule (.btn svg, .nav-ico, …) still overrides these attributes.
   */
  function icon(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" width="18" height="18" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + (PATHS[name] || '') + '</svg>';
  }

  /* ---------------------------------------------------------------------------
     TOASTS
     ------------------------------------------------------------------------ */

  let toastRoot = null;

  function toast(title, msg, kind) {
    if (!toastRoot) {
      toastRoot = h('.toasts', { role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastRoot);
    }
    const el = h('.toast' + (kind ? '.is-' + kind : ''), [
      h('.toast-bar'),
      h('div', [
        h('.toast-title', { text: title }),
        msg ? h('.toast-msg', { text: msg }) : null
      ])
    ]);
    toastRoot.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 200);
    }, kind === 'bad' ? 6000 : 3400);
    return el;
  }

  /* ---------------------------------------------------------------------------
     MODAL
     ------------------------------------------------------------------------ */

  /**
   * modal({title, body, actions:[{label, kind, onClick(close)}], wide})
   * `body` may be a node or a function(bodyEl) for imperative building.
   */
  function modal(opts) {
    const root = h('.modal-root', { role: 'dialog', 'aria-modal': 'true' });
    const body = h('.modal-body');

    function close() {
      root.style.animation = 'fade 140ms var(--ease) reverse';
      setTimeout(function () { root.remove(); }, 130);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    const foot = h('.modal-foot');
    (opts.actions || []).forEach(function (a) {
      foot.appendChild(h('button.btn' + (a.kind ? '.btn-' + a.kind : ''), {
        type: 'button',
        onclick: function () { a.onClick ? a.onClick(close, root) : close(); }
      }, a.label));
    });

    const box = h('.modal' + (opts.wide ? '.is-wide' : ''), [
      h('.modal-head', [
        h('h2', { text: opts.title || '' }),
        h('.spacer'),
        h('button.btn.btn-ghost.btn-icon.btn-sm', {
          type: 'button', 'aria-label': 'Close', html: icon('x'), onclick: close
        })
      ]),
      body,
      (opts.actions || []).length ? foot : null
    ]);

    if (typeof opts.body === 'function') opts.body(body, close);
    else if (opts.body) append(body, opts.body);

    root.appendChild(box);
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);

    const focusable = box.querySelector('input, select, textarea, button.btn-primary');
    if (focusable) setTimeout(function () { focusable.focus(); }, 60);

    return { root: root, body: body, close: close };
  }

  function confirm(opts) {
    return new Promise(function (resolve) {
      modal({
        title: opts.title || 'Are you sure?',
        body: h('p.u-sm', { text: opts.message || '' }),
        actions: [
          { label: opts.cancelLabel || 'Cancel', onClick: function (c) { c(); resolve(false); } },
          { label: opts.confirmLabel || 'Confirm', kind: opts.danger ? 'danger' : 'primary',
            onClick: function (c) { c(); resolve(true); } }
        ]
      });
    });
  }

  /* ---------------------------------------------------------------------------
     CLIPBOARD / FILE
     ------------------------------------------------------------------------ */

  /* ---------------------------------------------------------------------------
     CLIPBOARD

     Copy fails in a lot of real-world mobile contexts: the async Clipboard API
     needs a secure context and a live user gesture, execCommand is deprecated
     and disabled in some webviews, and iOS ignores selection on a plain
     readonly textarea. So every method is tried in turn and the caller is told
     which one worked; copyOrShow() falls back to putting the text on screen,
     pre-selected, so there is always a way to get it.
     ------------------------------------------------------------------------ */

  /** Async Clipboard API. */
  function copyViaAsyncApi(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return Promise.reject(new Error('no async clipboard'));
    }
    return navigator.clipboard.writeText(text).then(function () { return 'clipboard-api'; });
  }

  /** ClipboardItem — some webviews expose write() but not writeText(). */
  function copyViaClipboardItem(text) {
    if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') {
      return Promise.reject(new Error('no ClipboardItem'));
    }
    const item = new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }) });
    return navigator.clipboard.write([item]).then(function () { return 'clipboard-item'; });
  }

  /** Legacy execCommand on a textarea. */
  function copyViaTextarea(text) {
    return new Promise(function (resolve, reject) {
      const ta = h('textarea', {
        readonly: true,
        style: { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px',
          padding: '0', border: 'none', outline: 'none', boxShadow: 'none',
          background: 'transparent', opacity: '0', fontSize: '16px' }
      });
      ta.value = text;
      document.body.appendChild(ta);
      try {
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        ok ? resolve('execCommand') : reject(new Error('execCommand returned false'));
      } catch (e) { reject(e); }
      finally { ta.remove(); }
    });
  }

  /**
   * iOS/Safari webview variant: a readonly textarea will not take a selection,
   * so the text goes into a contenteditable node and is selected via a Range.
   */
  function copyViaRange(text) {
    return new Promise(function (resolve, reject) {
      const box = h('div', {
        contenteditable: 'true',
        style: { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px',
          opacity: '0', overflow: 'hidden', whiteSpace: 'pre', fontSize: '16px',
          webkitUserSelect: 'text', userSelect: 'text' }
      });
      box.textContent = text;
      document.body.appendChild(box);
      try {
        const range = document.createRange();
        range.selectNodeContents(box);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const ok = document.execCommand('copy');
        sel.removeAllRanges();
        ok ? resolve('range') : reject(new Error('execCommand returned false'));
      } catch (e) { reject(e); }
      finally { box.remove(); }
    });
  }

  /**
   * Try every strategy in order. Resolves with the name of whichever worked,
   * rejects only when all of them fail.
   */
  function copy(text) {
    text = String(text === null || text === undefined ? '' : text);
    const methods = [copyViaAsyncApi, copyViaClipboardItem, copyViaRange, copyViaTextarea];
    let i = 0;
    function next(lastErr) {
      if (i >= methods.length) {
        return Promise.reject(lastErr || new Error('every copy method failed'));
      }
      const fn = methods[i++];
      let attempt;
      try { attempt = fn(text); } catch (e) { return next(e); }
      return Promise.resolve(attempt).catch(next);
    }
    return next(null);
  }

  /**
   * Copy, and if nothing worked put the text on screen pre-selected so it can
   * be copied by hand. Always resolves — the user always ends up with a route
   * to the text.
   */
  function copyOrShow(text, opts) {
    opts = opts || {};
    return copy(text).then(function (method) {
      if (opts.quiet !== true) {
        toast('Copied', opts.label || 'Copied to the clipboard.', 'good');
      }
      return { ok: true, method: method };
    }).catch(function () {
      showManualCopy(text, opts);
      return { ok: false, method: null };
    });
  }

  /** Last resort: a selectable field with select-all, plus Share where offered. */
  function showManualCopy(text, opts) {
    opts = opts || {};
    const isLong = String(text).length > 120;
    const field = isLong
      ? h('textarea.textarea', { readonly: true, rows: '8',
          style: { fontFamily: 'var(--font-mono)', fontSize: '12px' } })
      : h('input.input', { readonly: true, style: { fontFamily: 'var(--font-mono)' } });
    field.value = text;

    function selectAll() {
      field.focus();
      field.select();
      try { field.setSelectionRange(0, String(text).length); } catch (e) { /* ignore */ }
    }

    modal({
      title: opts.title || 'Copy this',
      body: function (body) {
        body.appendChild(h('p.u-sm.u-muted',
          'Automatic copying was blocked here. Tap the box to select it all, then ' +
          'use your keyboard or long-press menu to copy.'));
        body.appendChild(field);
        field.addEventListener('click', selectAll);
        field.addEventListener('focus', selectAll);
        setTimeout(selectAll, 120);
      },
      actions: [
        navigator.share ? { label: 'Share…', onClick: function (close) {
          navigator.share({ text: text }).then(close).catch(function () {});
        } } : null,
        { label: 'Select all', onClick: function () { selectAll(); } },
        { label: 'Done', kind: 'primary' }
      ].filter(Boolean)
    });
  }

  /* ---------------------------------------------------------------------------
     EXTERNAL LINKS

     The app is commonly wrapped as a web-to-app shell, where a normal anchor
     opens inside the shell's own webview and traps the user. These try the
     routes most likely to hand off to the real browser; none is guaranteed,
     which is exactly why every external link in the UI is paired with a
     copy-URL button.
     ------------------------------------------------------------------------ */

  function openExternal(url) {
    url = String(url || '');
    if (!/^https?:\/\//i.test(url)) return false;

    /* 1. Cordova / Capacitor style shells honour the _system target. */
    try {
      const sys = window.open(url, '_system');
      if (sys) return true;
    } catch (e) { /* fall through */ }

    /* 2. A real anchor click carries rel=external, which several shells use as
          the signal to break out. */
    try {
      const a = h('a', { href: url, target: '_blank', rel: 'noopener noreferrer external' });
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); }, 1000);
      return true;
    } catch (e) { /* fall through */ }

    /* 3. Plain window.open. */
    try {
      const w = window.open(url, '_blank', 'noopener,noreferrer');
      if (w) { w.opener = null; return true; }
    } catch (e) { /* fall through */ }

    return false;
  }

  /** Android intent URL — hands the link to the system chooser. */
  function androidIntentUrl(url) {
    const m = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(url);
    if (!m) return null;
    return 'intent://' + m[1] + (m[2] || '') +
      '#Intent;scheme=https;action=android.intent.action.VIEW;end';
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function readFile(accept) {
    return new Promise(function (resolve, reject) {
      const input = h('input', { type: 'file', accept: accept || '', style: { display: 'none' } });
      input.onchange = function () {
        const f = input.files[0];
        if (!f) { reject(new Error('no file')); return; }
        const fr = new FileReader();
        fr.onload = function () { resolve({ name: f.name, type: f.type, data: fr.result }); };
        fr.onerror = function () { reject(fr.error); };
        if (/^image\//.test(f.type)) fr.readAsDataURL(f);
        else fr.readAsText(f);
      };
      document.body.appendChild(input);
      input.click();
      setTimeout(function () { input.remove(); }, 1000);
    });
  }

  /** Downscale a data-URL image so exercise art stays small enough to sync. */
  function shrinkImage(dataUrl, maxPx) {
    maxPx = maxPx || 320;
    return new Promise(function (resolve) {
      /* Animated GIFs lose their animation when redrawn, so pass them through. */
      if (/^data:image\/gif/.test(dataUrl)) { resolve(dataUrl); return; }
      const img = new Image();
      img.onload = function () {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        if (scale === 1 && dataUrl.length < 200000) { resolve(dataUrl); return; }
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/webp', 0.82));
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  /* ---------------------------------------------------------------------------
     WINDOWED LIST

     Long lists used to be truncated — the exercise list stopped at 400 rows and
     the picker at 300 — which quietly hid whatever came after, usually the
     user's own additions, and made a filter the only way to reach them. That is
     backwards: filtering narrows a list you can already see.

     The truncation existed to keep the DOM small, so this solves that directly
     instead. Only the rows near the viewport exist; spacers above and below
     stand in for the rest, so the scrollbar still describes the whole list.
     Rendering cost is flat no matter how many items there are.

     Rows MUST be a fixed height for the arithmetic to hold — see .ex-list in
     css/app.css, which pins it.
     ------------------------------------------------------------------------ */

  /**
   * @param {Element}  scroller  the scrolling container; is emptied
   * @param {Array}    items
   * @param {number}   rowH      row height in px, including its bottom margin
   * @param {Function} build     (item, index) -> Element
   * @param {Object}   opts      {overscan, scrollTo:<index to reveal>}
   * @returns {Object} {refresh, scrollToIndex}
   */
  function virtualList(scroller, items, rowH, build, opts) {
    opts = opts || {};
    const overscan = opts.overscan == null ? 6 : opts.overscan;

    /* Every filter change re-runs this on the SAME element. Without dropping
       the previous listener each rebuild would leave another one attached,
       still holding the old item array, and they would all fight over the
       window on the next scroll. */
    if (scroller.__vlist) {
      scroller.removeEventListener('scroll', scroller.__vlist);
      scroller.__vlist = null;
    }

    clear(scroller);
    const topPad = h('i.list-pad');
    const rows = h('div');
    const botPad = h('i.list-pad');
    scroller.appendChild(topPad);
    scroller.appendChild(rows);
    scroller.appendChild(botPad);

    let first = -1, last = -1, pending = 0;

    function paint() {
      const top = scroller.scrollTop;
      const height = scroller.clientHeight || 400;
      const a = Math.max(0, Math.floor(top / rowH) - overscan);
      const b = Math.min(items.length, Math.ceil((top + height) / rowH) + overscan);
      if (a === first && b === last) return;
      first = a; last = b;
      clear(rows);
      for (let i = a; i < b; i++) rows.appendChild(build(items[i], i));
      topPad.style.height = (a * rowH) + 'px';
      botPad.style.height = ((items.length - b) * rowH) + 'px';
    }

    function onScroll() {
      /* One paint per frame; scroll fires far more often than that. */
      if (pending) return;
      pending = requestAnimationFrame(function () { pending = 0; paint(); });
    }

    scroller.__vlist = onScroll;
    scroller.addEventListener('scroll', onScroll, { passive: true });
    paint();

    function scrollToIndex(i) {
      if (i < 0) return;
      const y = i * rowH;
      const view = scroller.clientHeight;
      if (y >= scroller.scrollTop && y <= scroller.scrollTop + view - rowH) return;
      scroller.scrollTop = Math.max(0, y - view / 2);
      paint();
    }
    if (opts.scrollTo != null) scrollToIndex(opts.scrollTo);

    return {
      /* Force a repaint of the current window, e.g. after a row's data changed. */
      refresh: function () { first = -1; last = -1; paint(); },
      scrollToIndex: scrollToIndex
    };
  }

  App.U = {
    $: $, $$: $$, h: h, append: append, clear: clear, esc: esc, on: on, debounce: debounce,
    num: num, compact: compact, pct: pct, dur: dur,
    today: today, fmtDate: fmtDate, relDate: relDate, daysAgo: daysAgo,
    uid: uid, slug: slug,
    icon: icon, toast: toast, modal: modal, confirm: confirm,
    copy: copy, copyOrShow: copyOrShow, showManualCopy: showManualCopy,
    openExternal: openExternal, androidIntentUrl: androidIntentUrl,
    download: download, readFile: readFile, shrinkImage: shrinkImage,
    virtualList: virtualList
  };
})(window.App = window.App || {});
