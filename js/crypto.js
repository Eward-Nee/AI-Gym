/* =============================================================================
   crypto.js — client-side encryption for anything that leaves the device

   THREAT MODEL
   ------------
   The thing being defended against is someone reading the databases: whoever
   runs the hub, anyone who obtains a friend's publishable key, or anyone who
   ends up with a backup. It is NOT a defence against someone who already
   controls your device or your browser.

   DESIGN
   ------
   * One random 256-bit AES-GCM **data key** per account, generated on this
     device and never sent anywhere in the clear.
   * The data key is WRAPPED with a key derived from the account password
     (PBKDF2-SHA256, 310k iterations, per-user random salt) and the wrapped blob
     is stored in the hub. Signing in on a new device and entering the password
     unwraps it — the server only ever sees ciphertext, so it cannot read your
     data even though it hosts the wrapped key.
   * Every record is encrypted with a fresh random 96-bit IV. GCM gives
     authentication as well as secrecy, so tampering is detected rather than
     silently decrypted into garbage.

   WHAT IS AND IS NOT ENCRYPTED
   ----------------------------
   Encrypted: the detailed payloads (exercises, workouts, sessions) in your own
   project, and the connection credentials held in the hub.

   Deliberately NOT encrypted: the aggregate stats you publish for friends, and
   the promoted columns your own project indexes on (date, volume, name). The
   aggregates are the thing you are explicitly choosing to share — encrypting
   them would break the feature they exist for — and the promoted columns have
   to stay readable for the database to sort and filter on them.
   ============================================================================= */
(function (App) {
  'use strict';

  const subtle = (window.crypto && window.crypto.subtle) || null;
  const PBKDF2_ITERATIONS = 310000;
  const PREFIX = 'enc.v1:';          /* marks a value as ciphertext */

  function available() { return !!subtle; }

  /* ---------------------------------------------------------------------------
     ENCODING
     ------------------------------------------------------------------------ */

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function toB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function fromB64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    return window.crypto.getRandomValues(new Uint8Array(n));
  }

  /* ---------------------------------------------------------------------------
     KEYS
     ------------------------------------------------------------------------ */

  /** A fresh random data key, extractable so it can be wrapped and stored. */
  function generateDataKey() {
    return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true,
      ['encrypt', 'decrypt']);
  }

  function importDataKey(raw) {
    return subtle.importKey('raw', raw, { name: 'AES-GCM' }, true,
      ['encrypt', 'decrypt']);
  }

  function exportDataKey(key) {
    return subtle.exportKey('raw', key);
  }

  /** PBKDF2(password, salt) -> an AES-GCM key used only to wrap the data key. */
  function deriveWrappingKey(password, saltB64) {
    const salt = fromB64(saltB64);
    return subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' },
      false, ['deriveKey'])
      .then(function (base) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  function newSalt() { return toB64(randomBytes(16)); }

  /* ---------------------------------------------------------------------------
     CORE
     ------------------------------------------------------------------------ */

  /** Encrypt a string. Returns "enc.v1:<iv>.<ciphertext>", both base64. */
  function encryptString(key, plaintext) {
    const iv = randomBytes(12);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plaintext))
      .then(function (ct) { return PREFIX + toB64(iv) + '.' + toB64(ct); });
  }

  function decryptString(key, blob) {
    if (!isEncrypted(blob)) return Promise.resolve(blob);
    const parts = blob.slice(PREFIX.length).split('.');
    if (parts.length !== 2) return Promise.reject(new Error('malformed ciphertext'));
    const iv = fromB64(parts[0]);
    const ct = fromB64(parts[1]);
    return subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct)
      .then(function (buf) { return dec.decode(buf); });
  }

  /** Was this value produced by encryptString? */
  function isEncrypted(v) {
    return typeof v === 'string' && v.indexOf(PREFIX) === 0;
  }

  function encryptJSON(key, obj) {
    return encryptString(key, JSON.stringify(obj));
  }

  function decryptJSON(key, blob) {
    if (!isEncrypted(blob)) return Promise.resolve(blob);
    return decryptString(key, blob).then(function (s) {
      try { return JSON.parse(s); } catch (e) { return null; }
    });
  }

  /* ---------------------------------------------------------------------------
     WRAPPING — how the data key travels to another device
     ------------------------------------------------------------------------ */

  /**
   * Wrap the data key with the account password.
   * @returns {Promise<{salt, wrapped, iterations}>} safe to store server-side
   */
  function wrapDataKey(dataKey, password) {
    const salt = newSalt();
    return Promise.all([exportDataKey(dataKey), deriveWrappingKey(password, salt)])
      .then(function (r) {
        const raw = r[0], wrapKey = r[1];
        const iv = randomBytes(12);
        return subtle.encrypt({ name: 'AES-GCM', iv: iv }, wrapKey, raw)
          .then(function (ct) {
            return { salt: salt, iterations: PBKDF2_ITERATIONS,
              wrapped: toB64(iv) + '.' + toB64(ct) };
          });
      });
  }

  /** Recover the data key from the wrapped blob and the account password. */
  function unwrapDataKey(record, password) {
    if (!record || !record.wrapped || !record.salt) {
      return Promise.reject(new Error('no wrapped key'));
    }
    const parts = String(record.wrapped).split('.');
    if (parts.length !== 2) return Promise.reject(new Error('malformed wrapped key'));
    return deriveWrappingKey(password, record.salt).then(function (wrapKey) {
      return subtle.decrypt({ name: 'AES-GCM', iv: fromB64(parts[0]) }, wrapKey,
        fromB64(parts[1]));
    }).then(importDataKey);
  }

  /* ---------------------------------------------------------------------------
     SESSION KEY — the data key held for this device
     ------------------------------------------------------------------------ */

  let dataKey = null;

  function setKey(k) { dataKey = k; }
  function getKey() { return dataKey; }
  function hasKey() { return !!dataKey; }
  function forget() { dataKey = null; }

  /** Load the stored data key, or make one if this device has never had one. */
  function loadOrCreate() {
    if (!available()) return Promise.resolve(null);
    return App.DB.getMeta('crypto.key', null).then(function (rawB64) {
      if (rawB64) return importDataKey(fromB64(rawB64)).then(function (k) {
        dataKey = k; return k;
      });
      return generateDataKey().then(function (k) {
        dataKey = k;
        return exportDataKey(k).then(function (raw) {
          return App.DB.setMeta('crypto.key', toB64(raw));
        }).then(function () { return k; });
      });
    }).catch(function (e) {
      console.warn('[crypto] key init failed', e.message);
      return null;
    });
  }

  /** Replace this device's data key (after recovering one from the hub). */
  function adoptKey(key) {
    dataKey = key;
    return exportDataKey(key).then(function (raw) {
      return App.DB.setMeta('crypto.key', toB64(raw));
    });
  }

  /* ---------------------------------------------------------------------------
     CONVENIENCE — no-ops when crypto is unavailable, so the app still runs
     ------------------------------------------------------------------------ */

  function seal(obj) {
    if (!dataKey || !available()) return Promise.resolve(obj);
    return encryptJSON(dataKey, obj).catch(function () { return obj; });
  }

  function open(blob) {
    if (!isEncrypted(blob)) return Promise.resolve(blob);
    if (!dataKey || !available()) return Promise.resolve(null);
    return decryptJSON(dataKey, blob).catch(function () { return null; });
  }

  function sealText(text) {
    if (!dataKey || !available() || text == null) return Promise.resolve(text);
    return encryptString(dataKey, String(text)).catch(function () { return text; });
  }

  function openText(blob) {
    if (!isEncrypted(blob)) return Promise.resolve(blob);
    if (!dataKey || !available()) return Promise.resolve(null);
    return decryptString(dataKey, blob).catch(function () { return null; });
  }

  /** A short fingerprint of the active key, for the diagnostics panel. */
  function fingerprint() {
    if (!dataKey) return Promise.resolve(null);
    return exportDataKey(dataKey)
      .then(function (raw) { return subtle.digest('SHA-256', raw); })
      .then(function (h) { return toB64(h).replace(/[^A-Za-z0-9]/g, '').slice(0, 12); })
      .catch(function () { return null; });
  }

  App.Crypto = {
    available: available,
    PREFIX: PREFIX,
    isEncrypted: isEncrypted,
    loadOrCreate: loadOrCreate,
    adoptKey: adoptKey,
    setKey: setKey, getKey: getKey, hasKey: hasKey, forget: forget,
    wrapDataKey: wrapDataKey, unwrapDataKey: unwrapDataKey,
    seal: seal, open: open, sealText: sealText, openText: openText,
    encryptJSON: encryptJSON, decryptJSON: decryptJSON,
    fingerprint: fingerprint,
    toB64: toB64, fromB64: fromB64
  };
})(window.App = window.App || {});
