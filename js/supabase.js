/* =============================================================================
   supabase.js — minimal Supabase client over fetch

   Deliberately dependency-free: no CDN script, no bundler. The app only needs
   PostgREST (select/upsert/delete + rpc) and GoTrue (sign-up / sign-in /
   refresh), which is a small enough surface to own outright. That keeps the
   app a pure file-system drop-in and keeps it working offline.
   ============================================================================= */
(function (App) {
  'use strict';

  function SupabaseError(message, status, body) {
    const e = new Error(message);
    e.name = 'SupabaseError';
    e.status = status;
    e.body = body;
    return e;
  }

  /**
   * @param {string} url      https://xxxx.supabase.co
   * @param {string} key      publishable / anon key
   * @param {Object} opts     { writeKey, accessToken }
   */
  /* Refresh this far ahead of expiry rather than waiting for the deadline. */
  const SKEW_MS = 120000;

  function createClient(url, key, opts) {
    opts = opts || {};
    const base = String(url || '').replace(/\/+$/, '');
    let accessToken = opts.accessToken || null;
    let refreshToken = opts.refreshToken || null;
    let expiresAt = Number(opts.expiresAt) || 0;
    let refreshing = null;
    let writeKey = opts.writeKey || null;
    /* Called whenever the tokens change so the caller can persist them.
       Supabase ROTATES the refresh token on every use: the old one is dead the
       moment a refresh succeeds. Keeping the new pair only in memory meant the
       next cold start replayed a spent token, the refresh failed, and the user
       was told to sign in again — for no reason other than that we forgot to
       write it down. */
    let onSession = typeof opts.onSession === 'function' ? opts.onSession : null;

    function headers(extra) {
      const h = Object.assign({
        apikey: key,
        Authorization: 'Bearer ' + (accessToken || key),
        'Content-Type': 'application/json'
      }, extra || {});
      /* Personal projects gate writes on this header (see sql/user-schema.sql). */
      if (writeKey) h['x-gym-write-key'] = writeKey;
      return h;
    }

    function request(path, init, timeoutMs) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 20000) : null;

      return fetch(base + path, Object.assign({ signal: ctrl ? ctrl.signal : undefined }, init))
        .then(function (res) {
          if (timer) clearTimeout(timer);
          const ct = res.headers.get('content-type') || '';
          const parse = ct.indexOf('application/json') >= 0
            ? res.json().catch(function () { return null; })
            : res.text().catch(function () { return null; });

          return parse.then(function (body) {
            if (!res.ok) {
              /* PostgREST reports in message/details/hint with a machine code;
                 GoTrue reports in `msg`. Reading only PostgREST's shape is how
                 an expired session turned into a bare "HTTP 400" with nothing
                 to act on, and how a missing function looked like a generic
                 failure rather than "re-run the schema". */
              let msg = (body && (body.message || body.msg || body.error_description ||
                (typeof body.error === 'string' ? body.error : null))) ||
                ('HTTP ' + res.status);
              if (body && body.details && body.details !== msg) msg += ' — ' + body.details;
              if (body && body.hint) msg += ' (' + body.hint + ')';
              if (body && body.code) msg += ' [' + body.code + ']';
              throw SupabaseError(msg, res.status, body);
            }
            return body;
          });
        })
        .catch(function (err) {
          if (timer) clearTimeout(timer);
          if (err.name === 'AbortError') throw SupabaseError('Request timed out', 0, null);
          if (err.name === 'SupabaseError') throw err;
          /* fetch() rejects with a bare TypeError for DNS/CORS/offline. */
          throw SupabaseError(
            'Could not reach ' + base + ' — check the URL, your connection, and that the project is not paused.',
            0, null);
        });
    }

    /* --- PostgREST -------------------------------------------------------- */

    function from(table) {
      return {
        select: function (columns, query) {
          const q = new URLSearchParams();
          q.set('select', columns || '*');
          for (const k in (query || {})) q.set(k, query[k]);
          return request('/rest/v1/' + table + '?' + q.toString(), {
            method: 'GET', headers: headers()
          });
        },
        upsert: function (rows, onConflict) {
          const q = onConflict ? '?on_conflict=' + encodeURIComponent(onConflict) : '';
          return request('/rest/v1/' + table + q, {
            method: 'POST',
            headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
            body: JSON.stringify(Array.isArray(rows) ? rows : [rows])
          });
        },
        insert: function (rows) {
          return request('/rest/v1/' + table, {
            method: 'POST',
            headers: headers({ Prefer: 'return=representation' }),
            body: JSON.stringify(Array.isArray(rows) ? rows : [rows])
          });
        },
        update: function (patch, query) {
          const q = new URLSearchParams();
          for (const k in (query || {})) q.set(k, query[k]);
          return request('/rest/v1/' + table + '?' + q.toString(), {
            method: 'PATCH',
            headers: headers({ Prefer: 'return=minimal' }),
            body: JSON.stringify(patch)
          });
        },
        remove: function (query) {
          const q = new URLSearchParams();
          for (const k in (query || {})) q.set(k, query[k]);
          return request('/rest/v1/' + table + '?' + q.toString(), {
            method: 'DELETE', headers: headers({ Prefer: 'return=minimal' })
          });
        }
      };
    }

    function rpc(fn, args) {
      return request('/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(args || {})
      });
    }

    /* --- GoTrue ----------------------------------------------------------- */

    const auth = {
      signUp: function (email, password, meta) {
        return request('/auth/v1/signup', {
          method: 'POST',
          headers: { apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password, data: meta || {} })
        }).then(function (r) {
          if (r && r.access_token) setSession(r);
          return r;
        });
      },
      signIn: function (email, password) {
        return request('/auth/v1/token?grant_type=password', {
          method: 'POST',
          headers: { apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password })
        }).then(function (r) { setSession(r); return r; });
      },
      refresh: function () {
        if (!refreshToken) return Promise.reject(SupabaseError('No refresh token', 0, null));
        return request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: { apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken })
        }).then(function (r) { setSession(r); return r; });
      },
      signOut: function () {
        const token = accessToken;
        accessToken = null; refreshToken = null; expiresAt = 0;
        if (onSession) { try { onSession(null); } catch (e) {} }
        if (!token) return Promise.resolve();
        return request('/auth/v1/logout', {
          method: 'POST',
          headers: { apikey: key, Authorization: 'Bearer ' + token }
        }).catch(function () { /* local sign-out is what matters */ });
      },
      user: function () {
        if (!accessToken) return Promise.resolve(null);
        return request('/auth/v1/user', { method: 'GET', headers: headers() })
          .catch(function () { return null; });
      },
      resetPassword: function (email, redirectTo) {
        return request('/auth/v1/recover', {
          method: 'POST',
          headers: { apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, gotrue_meta_security: {},
            redirect_to: redirectTo || location.href })
        });
      }
    };

    function setSession(r) {
      if (!r) return;
      const before = accessToken + '|' + refreshToken;
      if (r.access_token) accessToken = r.access_token;
      if (r.refresh_token) refreshToken = r.refresh_token;
      /* Expiry lets us refresh BEFORE a request fails rather than after. */
      if (r.expires_at) expiresAt = Number(r.expires_at) * 1000;
      else if (r.expires_in) expiresAt = Date.now() + Number(r.expires_in) * 1000;
      if (onSession && before !== accessToken + '|' + refreshToken) {
        try { onSession(sessionObj()); } catch (e) { /* persistence is best-effort */ }
      }
    }

    function sessionObj() {
      return { accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt };
    }

    /**
     * Refresh if the access token is spent or nearly so. Reusing one in-flight
     * promise keeps a burst of parallel calls from firing several refreshes,
     * which would rotate the token repeatedly and invalidate each other.
     */
    function ensureFresh() {
      if (!refreshToken) return Promise.resolve(false);
      if (expiresAt && Date.now() < expiresAt - SKEW_MS) return Promise.resolve(false);
      if (refreshing) return refreshing;
      refreshing = auth.refresh()
        .then(function () { return true; })
        .catch(function (e) {
          /* Only a genuinely rejected token means the session is over. A network
             blip must not sign anybody out. */
          if (isDeadToken(e)) { accessToken = null; refreshToken = null; expiresAt = 0;
            if (onSession) { try { onSession(null); } catch (x) {} } }
          throw e;
        })
        .then(function (v) { refreshing = null; return v; },
              function (e) { refreshing = null; throw e; });
      return refreshing;
    }

    /** Did the server actively reject the token, as opposed to failing to answer? */
    function isDeadToken(err) {
      if (!err) return false;
      if (err.status === 0) return false;              /* offline / timeout */
      const b = err.body || {};
      const code = String(b.error_code || b.error || '').toLowerCase();
      if (code.indexOf('refresh_token') >= 0 || code === 'invalid_grant') return true;
      return (err.status === 400 || err.status === 401) &&
        /invalid|revoked|expired|not found/i.test(err.message || '');
    }

    /**
     * Run fn, refreshing the session once and retrying if it looks like the
     * access token is the problem. A stale token shows up as a 401 from
     * PostgREST but as a 400 from GoTrue, so matching only on 401 left the
     * user staring at an unexplained 400 until they signed out and in again.
     */
    function authProblem(err) {
      if (!err) return false;
      if (err.status === 401) return true;
      if (err.status === 403 && /jwt|token/i.test(err.message || '')) return true;
      return err.status === 400 && /jwt|token|expired|session/i.test(err.message || '');
    }

    function withRetry(fn) {
      /* Renew first when the token is already known to be spent, so the common
         case is a clean call rather than a failure followed by a repair. */
      return ensureFresh().catch(function () { /* fall through and let fn fail */ })
        .then(fn)
        .catch(function (err) {
          if (!authProblem(err) || !refreshToken) throw err;
          return auth.refresh().then(fn).catch(function (e) {
            if (!isDeadToken(e)) throw e;   /* offline: keep the session */
            throw SupabaseError('Your session has expired. Sign in again.',
              e.status || 401, e.body);
          });
        });
    }

    return {
      url: base,
      key: key,
      from: from,
      rpc: rpc,
      auth: auth,
      withRetry: withRetry,
      authProblem: authProblem,
      request: request,
      setWriteKey: function (k) { writeKey = k; },
      getWriteKey: function () { return writeKey; },
      setSession: setSession,
      ensureFresh: ensureFresh,
      isDeadToken: isDeadToken,
      onSession: function (fn) { onSession = typeof fn === 'function' ? fn : null; },
      session: sessionObj,
      hasSession: function () { return !!accessToken; }
    };
  }

  /** Sanity-check a project URL before we try to use it. */
  function validUrl(u) {
    return /^https:\/\/[a-z0-9-]+\.supabase\.(co|in|net)\/?$/i.test(String(u || '').trim());
  }

  /** Publishable (sb_publishable_…) and legacy JWT anon keys are both fine. */
  function validKey(k) {
    k = String(k || '').trim();
    return /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k) || /^eyJ[A-Za-z0-9._-]{20,}$/.test(k);
  }

  /** Project ref from a Supabase URL, for display and dashboard deep links. */
  function projectRef(u) {
    const m = /^https:\/\/([a-z0-9-]+)\.supabase\./i.exec(String(u || '').trim());
    return m ? m[1] : null;
  }

  App.Supabase = {
    createClient: createClient,
    validUrl: validUrl,
    validKey: validKey,
    projectRef: projectRef
  };
})(window.App = window.App || {});
