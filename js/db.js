/* =============================================================================
   db.js — local persistence

   IndexedDB is the primary store (large, structured, never expires). Some
   browsers block IndexedDB on file:// origins and in hardened private modes, so
   a localStorage-backed shim with the same async API takes over transparently.
   Everything above this file is storage-agnostic.
   ============================================================================= */
(function (App) {
  'use strict';

  const DB_NAME = 'ai-gym';
  const DB_VERSION = 1;

  /* store name -> keyPath. `meta` is a plain key/value bag. */
  const STORES = {
    exercises: 'id',
    workouts: 'id',
    sessions: 'id',
    friends: 'id',
    meta: 'key',
    outbox: 'id'     /* pending writes queued while offline */
  };

  let dbp = null;      /* Promise<IDBDatabase> */
  let backend = 'idb'; /* 'idb' | 'ls' */

  /* ---------------------------------------------------------------------------
     IndexedDB
     ------------------------------------------------------------------------ */

  function openIDB() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window) || !window.indexedDB) {
        reject(new Error('no indexedDB'));
        return;
      }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }

      /* Private-mode / file:// failures sometimes never fire any event. */
      const guard = setTimeout(function () { reject(new Error('indexedDB timeout')); }, 4000);

      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        Object.keys(STORES).forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            const s = db.createObjectStore(name, { keyPath: STORES[name] });
            if (name === 'sessions') s.createIndex('date', 'date');
            if (name === 'sessions') s.createIndex('workoutId', 'workoutId');
          }
        });
      };
      req.onsuccess = function () { clearTimeout(guard); resolve(req.result); };
      req.onerror = function () { clearTimeout(guard); reject(req.error || new Error('indexedDB error')); };
      req.onblocked = function () { clearTimeout(guard); reject(new Error('indexedDB blocked')); };
    });
  }

  function tx(store, mode) {
    return dbp.then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /* ---------------------------------------------------------------------------
     localStorage shim — same surface, synchronous under the hood
     ------------------------------------------------------------------------ */

  const LS = {
    key: function (store) { return 'ai-gym:' + store; },
    read: function (store) {
      try { return JSON.parse(localStorage.getItem(LS.key(store)) || '[]'); }
      catch (e) { return []; }
    },
    write: function (store, rows) {
      try { localStorage.setItem(LS.key(store), JSON.stringify(rows)); }
      catch (e) { console.warn('[db] localStorage full', e); }
    }
  };

  /* ---------------------------------------------------------------------------
     Public API — all methods return promises regardless of backend
     ------------------------------------------------------------------------ */

  function init() {
    if (dbp) return dbp;
    dbp = openIDB().catch(function (err) {
      console.warn('[db] IndexedDB unavailable (' + err.message + '), falling back to localStorage');
      backend = 'ls';
      return null;
    });
    return dbp;
  }

  function getAll(store) {
    if (backend === 'ls') return Promise.resolve(LS.read(store));
    return tx(store, 'readonly').then(function (s) { return wrap(s.getAll()); })
      .catch(function () { backend = 'ls'; return LS.read(store); });
  }

  function get(store, key) {
    if (backend === 'ls') {
      const kp = STORES[store];
      return Promise.resolve(LS.read(store).find(function (r) { return r[kp] === key; }) || null);
    }
    return tx(store, 'readonly').then(function (s) { return wrap(s.get(key)); })
      .then(function (r) { return r || null; })
      .catch(function () {
        const kp = STORES[store];
        return LS.read(store).find(function (r) { return r[kp] === key; }) || null;
      });
  }

  function put(store, value) {
    if (backend === 'ls') {
      const kp = STORES[store];
      const rows = LS.read(store);
      const i = rows.findIndex(function (r) { return r[kp] === value[kp]; });
      if (i >= 0) rows[i] = value; else rows.push(value);
      LS.write(store, rows);
      return Promise.resolve(value);
    }
    return tx(store, 'readwrite').then(function (s) { return wrap(s.put(value)); })
      .then(function () { return value; });
  }

  function putMany(store, values) {
    if (!values.length) return Promise.resolve(0);
    if (backend === 'ls') {
      const kp = STORES[store];
      const rows = LS.read(store);
      const index = new Map(rows.map(function (r, i) { return [r[kp], i]; }));
      values.forEach(function (v) {
        if (index.has(v[kp])) rows[index.get(v[kp])] = v; else rows.push(v);
      });
      LS.write(store, rows);
      return Promise.resolve(values.length);
    }
    return dbp.then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(store, 'readwrite');
        const s = t.objectStore(store);
        values.forEach(function (v) { s.put(v); });
        t.oncomplete = function () { resolve(values.length); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function remove(store, key) {
    if (backend === 'ls') {
      const kp = STORES[store];
      LS.write(store, LS.read(store).filter(function (r) { return r[kp] !== key; }));
      return Promise.resolve();
    }
    return tx(store, 'readwrite').then(function (s) { return wrap(s.delete(key)); });
  }

  function clear(store) {
    if (backend === 'ls') { LS.write(store, []); return Promise.resolve(); }
    return tx(store, 'readwrite').then(function (s) { return wrap(s.clear()); });
  }

  function clearAll() {
    return Promise.all(Object.keys(STORES).map(function (s) { return clear(s); }));
  }

  /* --- meta helpers (settings, sync bookkeeping) --------------------------- */

  function getMeta(key, fallback) {
    return get('meta', key).then(function (row) {
      return row && 'value' in row ? row.value : fallback;
    });
  }

  function setMeta(key, value) {
    return put('meta', { key: key, value: value });
  }

  /* --- diagnostics --------------------------------------------------------- */

  function stats() {
    return Promise.all(Object.keys(STORES).map(function (s) {
      return getAll(s).then(function (rows) { return [s, rows.length]; });
    })).then(function (pairs) {
      const o = { backend: backend };
      pairs.forEach(function (p) { o[p[0]] = p[1]; });
      return o;
    });
  }

  /** Approximate on-disk usage, when the browser exposes it. */
  function usage() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        return { used: e.usage || 0, quota: e.quota || 0 };
      }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  /** Ask the browser not to evict our data (best effort — never rejects). */
  function persist() {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist().catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  App.DB = {
    init: init,
    getAll: getAll,
    get: get,
    put: put,
    putMany: putMany,
    remove: remove,
    clear: clear,
    clearAll: clearAll,
    getMeta: getMeta,
    setMeta: setMeta,
    stats: stats,
    usage: usage,
    persist: persist,
    stores: Object.keys(STORES),
    get backend() { return backend; }
  };
})(window.App = window.App || {});
