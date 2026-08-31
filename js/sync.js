/* =============================================================================
   sync.js — cloud orchestration

   Three storage tiers, in priority order:
     1. IndexedDB          always authoritative for the current device, works
                           offline, never expires, needs no account
     2. Personal Supabase  the user's own project; a full mirror of tier 1
     3. Hub Supabase       accounts, friendships, and cached stats only

   Nothing here is required for the app to function. If neither cloud is
   configured every call short-circuits and local storage carries on alone.
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U;

  /* The shared hub this build ships against. Both values are public by design:
     the URL is a hostname and the publishable key is meant to be shipped in a
     client. All real protection lives in the hub's RLS policies. */
  const HUB_DEFAULT = {
    url: 'https://uuljnonlnobsxfutruqq.supabase.co',
    key: 'sb_publishable_c6NHpP6KTrrWqhoJaIJgXQ_ReRz5pXw'
  };

  const TABLES = {
    exercises: 'gym_exercises',
    workouts: 'gym_workouts',
    sessions: 'gym_sessions'
  };

  /* The personal-project schema this build expects. Bumping this is what makes
     the app offer a migration. */
  const REQUIRED_SCHEMA = 2;

  /* Columns added after v1. If the project has not been migrated yet these do
     not exist, and PostgREST rejects the whole batch rather than ignoring
     them — so the upload is retried without them instead of failing outright.
     They are informational: encrypted rows are recognised by their payload
     shape, not by this flag, so dropping it costs nothing but the marker. */
  const OPTIONAL_COLUMNS = ['encrypted'];

  /**
   * Upsert, and if the project is on an older schema than this build, strip the
   * column it complained about and try again. Uploading is the first thing a
   * user does after connecting; making it fail on a cosmetic column would be a
   * bad trade.
   */
  function upsertTolerant(table, rows, dropped) {
    dropped = dropped || [];
    return personal.from(table).upsert(rows, 'id').catch(function (err) {
      const m = /Could not find the '([^']+)' column/i.exec(err.message || '');
      const col = m && m[1];
      if (!col || dropped.indexOf(col) >= 0 || OPTIONAL_COLUMNS.indexOf(col) < 0) throw err;
      console.warn('[sync] project is missing "' + col + '" — retrying without it');
      const slim = rows.map(function (r) {
        const c = Object.assign({}, r);
        delete c[col];
        return c;
      });
      schemaOutdated = true;
      return upsertTolerant(table, slim, dropped.concat(col));
    });
  }

  let schemaOutdated = false;

  const cfg = {
    personal: { url: '', key: '', writeKey: '', verifiedAt: null, schemaVersion: 0 },
    hub: { url: HUB_DEFAULT.url, key: HUB_DEFAULT.key, enabled: true },
    account: null,          /* {id, email, handle, display_name} */
    lastPush: null,
    lastPull: null,
    keepaliveDate: null
  };

  let personal = null;      /* client */
  let hub = null;           /* client */
  let pushTimer = null;
  let busy = false;

  const listeners = [];
  function onStatus(fn) { listeners.push(fn); return function () {
    const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }
  function emitStatus() {
    const s = status();
    listeners.forEach(function (f) { try { f(s); } catch (e) { console.error(e); } });
    App.Store.emit('sync', s);
  }

  /* ---------------------------------------------------------------------------
     CONFIG
     ------------------------------------------------------------------------ */

  function load() {
    return Promise.all([
      App.DB.getMeta('sync.personal', null),
      App.DB.getMeta('sync.hub', null),
      App.DB.getMeta('sync.account', null),
      App.DB.getMeta('sync.session', null),
      App.DB.getMeta('sync.marks', null)
    ]).then(function (r) {
      if (r[0]) Object.assign(cfg.personal, r[0]);
      if (r[1]) Object.assign(cfg.hub, r[1]);
      cfg.account = r[2] || null;
      const session = r[3] || null;
      if (r[4]) Object.assign(cfg, r[4]);

      if (cfg.personal.url && cfg.personal.key) buildPersonal();
      if (cfg.hub.enabled && cfg.hub.url && cfg.hub.key) buildHub(session);
      emitStatus();
    });
  }

  function buildPersonal() {
    personal = App.Supabase.createClient(cfg.personal.url, cfg.personal.key, {
      writeKey: cfg.personal.writeKey || null
    });
    return personal;
  }

  function buildHub(session) {
    hub = App.Supabase.createClient(cfg.hub.url, cfg.hub.key, {
      accessToken: session ? session.accessToken : null,
      refreshToken: session ? session.refreshToken : null,
      expiresAt: session ? session.expiresAt : 0,
      /* Write the tokens down every time they rotate. Without this the stored
         refresh token goes stale the first time it is used and the next cold
         start looks like an expired session. */
      onSession: function (next) {
        App.DB.setMeta('sync.session', next).catch(function () {});
        if (!next) {
          /* The server rejected the token outright — that is a real sign-out,
             and it is the only thing besides the button that ends a session. */
          cfg.account = null;
          saveAccount().catch(function () {});
          emitStatus();
        }
      }
    });
    return hub;
  }

  function savePersonalCfg() { return App.DB.setMeta('sync.personal', cfg.personal); }
  function saveHubCfg() { return App.DB.setMeta('sync.hub', cfg.hub); }
  function saveAccount() { return App.DB.setMeta('sync.account', cfg.account); }
  function saveSession() {
    return App.DB.setMeta('sync.session', hub ? hub.session() : null);
  }
  function saveMarks() {
    return App.DB.setMeta('sync.marks', {
      lastPush: cfg.lastPush, lastPull: cfg.lastPull, keepaliveDate: cfg.keepaliveDate
    });
  }

  function enabled() { return !!(personal && cfg.personal.url && cfg.personal.key); }
  function signedIn() { return !!(hub && hub.hasSession() && cfg.account); }

  function status() {
    return {
      local: App.DB.backend,
      personal: {
        configured: !!(cfg.personal.url && cfg.personal.key),
        verified: !!cfg.personal.verifiedAt,
        canWrite: !!cfg.personal.writeKey,
        url: cfg.personal.url,
        ref: App.Supabase.projectRef(cfg.personal.url)
      },
      hub: {
        enabled: !!cfg.hub.enabled,
        signedIn: signedIn(),
        account: cfg.account
      },
      lastPush: cfg.lastPush,
      lastPull: cfg.lastPull,
      busy: busy
    };
  }

  /* ---------------------------------------------------------------------------
     PERSONAL PROJECT — connect, verify, claim write key
     ------------------------------------------------------------------------ */

  /**
   * Verify a personal project: reachable, schema installed, and writable.
   * Claims the one-time write key on first success.
   */
  function testPersonal(url, key) {
    const client = App.Supabase.createClient(url, key, {
      writeKey: cfg.personal.writeKey || null
    });
    const report = { url: url, steps: [] };

    function step(name, ok, detail) {
      report.steps.push({ name: name, ok: ok, detail: detail });
      return ok;
    }

    return client.rpc('gym_ping', {})
      .then(function (info) {
        step('Reached the project', true, App.Supabase.projectRef(url));
        step('Schema installed', true, 'version ' + (info.schema_version || 1));
        report.info = info;
        report.claimed = !!info.write_key_claimed;
        return info;
      })
      .catch(function (err) {
        if (err.status === 404 || /gym_ping/.test(err.message || '')) {
          step('Reached the project', true, App.Supabase.projectRef(url));
          step('Schema installed', false,
            'The setup SQL has not been run in this project yet.');
        } else if (err.status === 401 || err.status === 403) {
          step('Reached the project', false, 'The key was rejected. Check the publishable key.');
        } else {
          step('Reached the project', false, err.message);
        }
        throw Object.assign(err, { report: report });
      })
      .then(function () {
        /* Claim the write key once; a re-test on an already-claimed project
           just reuses whatever we stored locally. */
        if (cfg.personal.writeKey) {
          step('Write access', true, 'Using the key already stored on this device.');
          return cfg.personal.writeKey;
        }
        return client.rpc('gym_claim_write_key', {})
          .then(function (k) {
            const wk = typeof k === 'string' ? k : (k && k[0]) || null;
            step('Write access', !!wk, wk ? 'Write key claimed for this device.' : 'No key returned.');
            return wk;
          })
          .catch(function (err) {
            /* An already-claimed key means this is an EXISTING project being
               reconnected — a completely normal thing to do on a new device,
               so it must not block the connection. Reading works immediately;
               writing needs the key back, which sign-in restores from the hub
               automatically, and which can otherwise be rotated. */
            if (/already claimed/i.test(err.message || '')) {
              report.readOnly = true;
              step('Write access', true,
                'This project is already set up. Connecting read-only for now — ' +
                'sign in to your account and the write key comes back with it.');
            } else {
              step('Write access', false, err.message);
            }
            return null;
          });
      })
      .then(function (wk) {
        report.writeKey = wk;
        report.ok = report.steps.every(function (s) { return s.ok; });
        return report;
      })
      .catch(function (err) {
        report.ok = false;
        report.error = err.message;
        return report;
      });
  }

  /** Persist a verified personal project. */
  function connectPersonal(url, key, writeKey, info) {
    cfg.personal.url = String(url).replace(/\/+$/, '');
    cfg.personal.key = String(key).trim();
    if (writeKey) cfg.personal.writeKey = writeKey;
    cfg.personal.verifiedAt = new Date().toISOString();
    cfg.personal.schemaVersion = (info && info.schema_version) || 1;
    buildPersonal();
    return savePersonalCfg().then(function () {
      emitStatus();
      /* Register it with the hub now rather than waiting for the next sign-in,
         so the credentials are stored (encrypted) the moment they exist. */
      if (signedIn()) return publishConnection().catch(function () {});
    }).then(function () {
      return cfg.personal;
    });
  }

  function disconnectPersonal() {
    cfg.personal = { url: '', key: '', writeKey: '', verifiedAt: null, schemaVersion: 0 };
    personal = null;
    return savePersonalCfg().then(function () {
      return App.DB.clear('outbox');
    }).then(emitStatus);
  }

  /* ---------------------------------------------------------------------------
     SCHEMA VERSION
     ------------------------------------------------------------------------ */

  /** What version is the connected project on, and is it behind this build? */
  function checkPersonalSchema() {
    if (!enabled()) return Promise.resolve(null);
    return personal.rpc('gym_ping', {}).then(function (info) {
      const current = (info && info.schema_version) || 1;
      cfg.personal.schemaVersion = current;
      return savePersonalCfg().then(function () {
        return {
          current: current,
          required: REQUIRED_SCHEMA,
          needsUpdate: current < REQUIRED_SCHEMA,
          /* gym_migrate() only exists from v2, so a v1 project cannot migrate
             itself — that first step has to be a copy-paste. */
          canSelfMigrate: current >= 2
        };
      });
    }).catch(function () { return null; });
  }

  /**
   * Ask the project to migrate itself. Only possible from v2 onward, because
   * the function doing the work did not exist before then.
   */
  function migratePersonal() {
    if (!enabled()) return Promise.reject(new Error('No personal project connected.'));
    return personal.rpc('gym_migrate', {}).then(function (rows) {
      const r = Array.isArray(rows) ? rows[0] : rows;
      schemaOutdated = false;
      return checkPersonalSchema().then(function (st) {
        return { from: r && r.from_version, to: r && r.to_version,
          applied: (r && r.applied) || [], schema: st };
      });
    });
  }

  function schemaNeedsAttention() { return schemaOutdated; }

  /* ---------------------------------------------------------------------------
     PUSH / PULL
     ------------------------------------------------------------------------ */

  function toRow(table, rec) {
    const base = { id: rec.id, data: rec, updated_at: rec.updatedAt || new Date().toISOString(),
      deleted: false, encrypted: false };
    if (table === 'exercises') {
      return Object.assign(base, { name: rec.name, equipment: rec.equipment,
        pattern: rec.pattern, muscles: rec.muscles || {} });
    }
    if (table === 'workouts') {
      return Object.assign(base, { name: rec.name, item_count: (rec.items || []).length });
    }
    return Object.assign(base, {
      workout_id: rec.workoutId || null,
      name: rec.name || '',
      date: rec.date,
      volume: App.Ranks ? sessionVolume(rec) : 0,
      duration_sec: rec.durationSec || 0
    });
  }

  /**
   * Seal the detail payload before it leaves the device. Only `data` is
   * encrypted; the promoted columns stay readable because the database sorts
   * and filters on them and a friend's app needs them for comparisons.
   */
  function encodeRows(table, records) {
    const rows = records.map(function (r) { return toRow(table, r); });
    if (!App.Crypto || !App.Crypto.hasKey()) return Promise.resolve(rows);
    return Promise.all(rows.map(function (row) {
      return App.Crypto.seal(row.data).then(function (sealed) {
        if (typeof sealed === 'string') { row.data = { enc: sealed }; row.encrypted = true; }
        return row;
      });
    }));
  }

  /** Reverse of encodeRows: unwrap `{enc: "..."}` back into the record. */
  function decodeRow(row) {
    const d = row && row.data;
    if (!d || typeof d !== 'object' || !d.enc) {
      return Promise.resolve(Object.assign({}, d, { id: row.id, updatedAt: row.updated_at }));
    }
    if (!App.Crypto || !App.Crypto.hasKey()) return Promise.resolve(null);
    return App.Crypto.open(d.enc).then(function (rec) {
      if (!rec) return null;
      return Object.assign({}, rec, { id: row.id, updatedAt: row.updated_at });
    });
  }

  function sessionVolume(s) {
    let v = 0;
    (s.entries || []).forEach(function (en) { v += App.Ranks.volumeOf(en.sets); });
    return Math.round(v);
  }

  /** Full upload of everything held locally. Used by first-time migration. */
  function pushAll(onProgress) {
    if (!enabled()) return Promise.reject(new Error('No personal project connected.'));
    if (!cfg.personal.writeKey) {
      return Promise.reject(new Error('No write key for this project — re-run Test connection.'));
    }
    busy = true; emitStatus();

    const jobs = [
      ['exercises', App.Store.allExercises()],
      ['workouts', App.Store.allWorkouts()],
      ['sessions', App.Store.allSessions()]
    ];
    let done = 0;
    const total = jobs.reduce(function (a, j) { return a + j[1].length; }, 0);
    const summary = { total: total, uploaded: 0, tables: {} };

    return jobs.reduce(function (chain, job) {
      return chain.then(function () {
        const table = TABLES[job[0]];
        if (!job[1].length) { summary.tables[job[0]] = 0; return; }
        return encodeRows(job[0], job[1]).then(function (rows) {
          /* Chunked so a large history does not blow the request size limit. */
          const CHUNK = 200;
          let i = 0;
          function next() {
            if (i >= rows.length) return Promise.resolve();
            const slice = rows.slice(i, i + CHUNK);
            i += CHUNK;
            return upsertTolerant(table, slice).then(function () {
              done += slice.length;
              summary.uploaded += slice.length;
              if (onProgress) onProgress(done, total, job[0]);
              return next();
            });
          }
          return next().then(function () { summary.tables[job[0]] = rows.length; });
        });
      });
    }, Promise.resolve())
      .then(function () { return pushProfile(); })
      .then(function () {
        return App.DB.clear('outbox');
      })
      .then(function () {
        cfg.lastPush = new Date().toISOString();
        return saveMarks();
      })
      .then(function () {
        busy = false; emitStatus();
        return summary;
      })
      .catch(function (err) {
        busy = false; emitStatus();
        throw err;
      });
  }

  /** Incremental push of everything in the outbox. */
  function pushPending() {
    if (!enabled() || !cfg.personal.writeKey) return Promise.resolve({ uploaded: 0 });
    return App.DB.getAll('outbox').then(function (queue) {
      if (!queue.length) return { uploaded: 0 };
      busy = true; emitStatus();

      const byTable = {};
      queue.forEach(function (q) { (byTable[q.table] = byTable[q.table] || []).push(q); });

      return Object.keys(byTable).reduce(function (chain, key) {
        return chain.then(function () {
          const table = TABLES[key];
          const items = byTable[key];
          const live = [], gone = [];

          items.forEach(function (q) {
            if (q.deleted) { gone.push(q.rowId); return; }
            const rec = findLocal(key, q.rowId);
            if (rec) live.push(rec); else gone.push(q.rowId);
          });

          let p = Promise.resolve();
          if (live.length) p = p.then(function () {
            return encodeRows(key, live).then(function (rows) {
              return upsertTolerant(table, rows);
            });
          });
          if (gone.length) {
            p = p.then(function () {
              return personal.from(table).update({ deleted: true,
                updated_at: new Date().toISOString() },
                { id: 'in.(' + gone.map(function (x) { return '"' + x + '"'; }).join(',') + ')' });
            });
          }
          return p;
        });
      }, Promise.resolve())
        .then(function () { return App.DB.clear('outbox'); })
        .then(function () {
          cfg.lastPush = new Date().toISOString();
          return saveMarks();
        })
        .then(function () {
          busy = false; emitStatus();
          return { uploaded: queue.length };
        })
        .catch(function (err) {
          busy = false; emitStatus();
          console.warn('[sync] push failed, keeping outbox', err.message);
          throw err;
        });
    });
  }

  function findLocal(kind, id) {
    if (kind === 'exercises') return App.Store.getExercise(id);
    if (kind === 'workouts') return App.Store.getWorkout(id);
    return App.Store.allSessions().find(function (s) { return s.id === id; }) || null;
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushPending().catch(function () { /* stays queued for the next attempt */ });
    }, 2500);
  }

  /**
   * Pull the cloud copy down. `mode`:
   *   'merge'   keep whichever side has the newer updated_at (default)
   *   'replace' cloud wins outright
   */
  function pull(mode) {
    if (!enabled()) return Promise.reject(new Error('No personal project connected.'));
    busy = true; emitStatus();

    return Promise.all(Object.keys(TABLES).map(function (kind) {
      return personal.from(TABLES[kind]).select('id,data,updated_at,deleted', { deleted: 'is.false' })
        .then(function (rows) { return { kind: kind, rows: rows || [] }; });
    })).then(function (sets) {
      /* Rows this device cannot decrypt are counted and skipped rather than
         written back as nulls — that happens when the data key has not been
         recovered yet, and the right answer is to tell the user, not to
         overwrite good local data with garbage. */
      let undecryptable = 0;
      return Promise.all(sets.map(function (set) {
        return Promise.all(set.rows.map(decodeRow)).then(function (recs) {
          set.decoded = recs.filter(function (r) {
            if (!r) { undecryptable++; return false; }
            return true;
          });
          return set;
        });
      })).then(function (decoded) { return applyPull(decoded, undecryptable); });

      function applyPull(sets, undecryptable) {
      const summary = {};
      const jobs = [];
      sets.forEach(function (set) {
        const incoming = set.decoded;
        const localList = set.kind === 'exercises' ? App.Store.allExercises()
          : set.kind === 'workouts' ? App.Store.allWorkouts()
          : App.Store.allSessions();

        const localById = Object.create(null);
        localList.forEach(function (r) { localById[r.id] = r; });

        const winners = [];
        incoming.forEach(function (rec) {
          const mine = localById[rec.id];
          if (!mine || mode === 'replace') { winners.push(rec); return; }
          const a = new Date(rec.updatedAt || 0).getTime();
          const b = new Date(mine.updatedAt || 0).getTime();
          if (a > b) winners.push(rec);
        });

        summary[set.kind] = { fetched: incoming.length, applied: winners.length };
        if (winners.length) jobs.push(App.DB.putMany(set.kind, winners));
      });

      summary.undecryptable = undecryptable;
      return Promise.all(jobs).then(function () { return summary; });
      }
    }).then(function (summary) {
      cfg.lastPull = new Date().toISOString();
      return saveMarks().then(function () { return summary; });
    }).then(function (summary) {
      return App.Store.load().then(function () {
        busy = false; emitStatus();
        return summary;
      });
    }).catch(function (err) {
      busy = false; emitStatus();
      throw err;
    });
  }

  /** Push the profile row + rank so friends can see it without a full read. */
  function pushProfile() {
    if (!enabled() || !cfg.personal.writeKey) return Promise.resolve();
    const s = App.Store.getSettings();
    const r = App.Store.rank();
    return personal.from('gym_profile').upsert([{
      id: 1,
      display_name: s.name || null,
      handle: (cfg.account && cfg.account.handle) || s.handle || null,
      bodyweight: s.bodyweight || null,
      units: s.units,
      rank_id: r.rank.id,
      rank_points: r.points,
      stats: publicStats(r),
      updated_at: new Date().toISOString()
    }], 'id').catch(function (e) {
      console.warn('[sync] profile push failed', e.message);
    });
  }

  /** The small, non-sensitive roll-up shared with friends. */
  function publicStats(r) {
    r = r || App.Store.rank();
    const sessions = App.Store.allSessions();
    const last28 = App.Store.sessionsBetween(U.daysAgo(28), U.today());
    return {
      rank: r.rank.id,
      points: r.points,
      indices: r.indices,
      sessions: sessions.length,
      sessions28: last28.length,
      volume28: Math.round(r.recentVolume),
      totalVolume: Math.round(sessions.reduce(function (a, s) { return a + sessionVolume(s); }, 0)),
      heat: App.Store.sessionsHeat(last28),
      groups: r.groupVolume,
      top: r.scored.slice(0, 8).map(function (s) {
        return { name: s.name, e1rm: Math.round(s.e1rm), score: Math.round(s.score) };
      }),
      lastSession: sessions.length ? sessions[0].date : null,
      updatedAt: new Date().toISOString()
    };
  }

  /* ---------------------------------------------------------------------------
     HUB — account, friends, shared stats
     ------------------------------------------------------------------------ */

  function hubClient() {
    if (!hub) buildHub(null);
    return hub;
  }

  function signUp(email, password, displayName) {
    const c = hubClient();
    return c.auth.signUp(email, password, { display_name: displayName || '' })
      .then(function (r) {
        /* Projects with email confirmation on return no session yet. */
        if (!r.access_token) return { needsConfirmation: true, user: r };
        return afterAuth(password);
      });
  }

  function signIn(email, password) {
    return hubClient().auth.signIn(email, password).then(function () {
      return afterAuth(password);
    });
  }

  /**
   * Recover or publish this account's data key.
   *
   * The key is wrapped with the account password and stored in the hub so a
   * second device can get it back. The password itself is never stored and the
   * hub only ever holds ciphertext — which also means a forgotten password
   * cannot be recovered by anyone, us included.
   */
  function syncDataKey(password) {
    if (!App.Crypto || !App.Crypto.available() || !password) return Promise.resolve();
    return hub.withRetry(function () {
      return hub.from('user_keys').select('*', { user_id: 'eq.' + cfg.account.id });
    }).then(function (rows) {
      const stored = rows && rows[0];
      if (stored) {
        /* Adopt the account's existing key so this device can read what the
           others wrote. Generating a new one here would strand the old data. */
        return App.Crypto.unwrapDataKey(stored, password)
          .then(function (key) { return App.Crypto.adoptKey(key); })
          .then(function () { return { recovered: true }; })
          .catch(function () {
            console.warn('[sync] could not unwrap the stored key with this password');
            return { recovered: false, mismatch: true };
          });
      }
      /* First device for this account: publish the local key, wrapped. */
      const key = App.Crypto.getKey();
      if (!key) return { recovered: false };
      return App.Crypto.wrapDataKey(key, password).then(function (w) {
        return hub.withRetry(function () {
          return hub.from('user_keys').upsert([{
            user_id: cfg.account.id, salt: w.salt, wrapped: w.wrapped,
            iterations: w.iterations, updated_at: new Date().toISOString()
          }], 'user_id');
        });
      }).then(function () { return { published: true }; });
    }).catch(function (e) {
      console.warn('[sync] key escrow failed', e.message);
      return { error: e.message };
    });
  }

  function afterAuth(password) {
    return hub.auth.user().then(function (u) {
      if (!u) throw new Error('Sign-in did not return an account.');
      return hub.from('profiles').select('*', { id: 'eq.' + u.id }).then(function (rows) {
        const p = (rows && rows[0]) || null;
        cfg.account = {
          id: u.id,
          email: u.email,
          handle: p ? p.handle : null,
          display_name: p ? p.display_name : null,
          avatar_emoji: p ? p.avatar_emoji : '💪'
        };
        return Promise.all([saveAccount(), saveSession()]);
      });
    }).then(function () {
      emitStatus();
      return syncDataKey(password);
    }).then(function () {
      /* If this account already has a project registered, adopt it — that is
         what makes signing in on a new device restore the connection instead
         of asking for the keys again. */
      return adoptStoredConnection();
    }).then(function () {
      return publishConnection().catch(function () {});
    }).then(function () {
      emitStatus();
      return cfg.account;
    });
  }

  /**
   * Pull this account's own connection record out of the hub and connect with
   * it. Credentials come back encrypted, so this only works once the data key
   * has been recovered.
   */
  function adoptStoredConnection() {
    if (!signedIn()) return Promise.resolve(null);
    if (cfg.personal.url && cfg.personal.key && cfg.personal.verifiedAt) {
      return Promise.resolve(null);           /* already connected on this device */
    }
    return hub.withRetry(function () {
      return hub.rpc('get_friend_connection', { friend: cfg.account.id });
    }).then(function (rows) {
      const conn = rows && rows[0];
      if (!conn || !conn.supabase_url) return null;

      return Promise.all([
        conn.encrypted ? App.Crypto.openText(conn.anon_key) : conn.anon_key,
        conn.encrypted && conn.write_key ? App.Crypto.openText(conn.write_key)
                                         : (conn.write_key || null)
      ]).then(function (v) {
        const anon = v[0], wk = v[1];
        if (!anon) {
          console.warn('[sync] stored connection could not be decrypted');
          return null;
        }
        cfg.personal.url = conn.supabase_url;
        cfg.personal.key = anon;
        if (wk) cfg.personal.writeKey = wk;
        cfg.personal.schemaVersion = conn.schema_version || 1;
        buildPersonal();
        /* Confirm it actually answers before claiming to be connected. */
        return personal.rpc('gym_ping', {}).then(function (info) {
          cfg.personal.verifiedAt = new Date().toISOString();
          cfg.personal.schemaVersion = (info && info.schema_version) || 1;
          return savePersonalCfg().then(function () {
            emitStatus();
            return { url: conn.supabase_url, restored: true, canWrite: !!wk };
          });
        }).catch(function (e) {
          console.warn('[sync] stored project did not answer', e.message);
          return null;
        });
      });
    }).catch(function () { return null; });
  }

  /**
   * Keep the hub session valid for as long as the app is open.
   *
   * Access tokens last an hour. Left alone, a phone that sits on a bench between
   * sets comes back to a dead token and the app used to present that as "sign in
   * again" — which is why the app appeared to log itself out at random. Nothing
   * here can end a session: only an explicit sign-out, or the server actively
   * rejecting the refresh token, does that.
   */
  let refreshTimer = null;
  function keepSessionAlive() {
    if (!hub || !hub.session().refreshToken) return Promise.resolve(false);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (hub) hub.ensureFresh().catch(function () {});
    }, 10 * 60 * 1000);
    /* And on the way back from a locked screen, where timers are throttled. */
    if (!keepSessionAlive.bound) {
      keepSessionAlive.bound = true;
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && hub) hub.ensureFresh().catch(function () {});
      });
    }
    return hub.ensureFresh().catch(function () { return false; });
  }

  function signOut() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    const c = hubClient();
    return c.auth.signOut().then(function () {
      cfg.account = null;
      buildHub(null);
      return Promise.all([saveAccount(), saveSession()]);
    }).then(emitStatus);
  }

  /** Tell the hub where this account's personal project is. */
  function publishConnection() {
    if (!signedIn() || !cfg.personal.url) return Promise.resolve();
    /* Make sure the key exists before deciding. Publishing plaintext because
       the key had not finished loading is exactly how an unencrypted anon key
       ends up sitting in the hub. */
    const ready = (App.Crypto && App.Crypto.available() && !App.Crypto.hasKey())
      ? App.Crypto.loadOrCreate() : Promise.resolve();

    return ready.then(function () {
    const canEncrypt = !!(App.Crypto && App.Crypto.hasKey());
    return Promise.all([
      canEncrypt ? App.Crypto.sealText(cfg.personal.key) : cfg.personal.key,
      canEncrypt && cfg.personal.writeKey ? App.Crypto.sealText(cfg.personal.writeKey)
                                          : (cfg.personal.writeKey || null)
    ]).then(function (v) {
      return hub.withRetry(function () {
        return hub.from('connections').upsert([{
          user_id: cfg.account.id,
          supabase_url: cfg.personal.url,
          anon_key: v[0],
          write_key: v[1],
          encrypted: canEncrypt,
          schema_version: cfg.personal.schemaVersion || 1,
          verified_at: cfg.personal.verifiedAt,
          updated_at: new Date().toISOString()
        }], 'user_id');
      });
    });
    });
  }

  /**
   * Re-publish the stored connection if it is sitting in the hub unencrypted.
   * Rows written by a build that predates encryption, or written before the key
   * had loaded, stay in the clear until something rewrites them — this is that
   * something.
   */
  function reencryptConnection() {
    if (!signedIn() || !cfg.personal.url) return Promise.resolve(null);
    if (!App.Crypto || !App.Crypto.available()) return Promise.resolve(null);
    return hub.withRetry(function () {
      return hub.from('connections').select('user_id,encrypted',
        { user_id: 'eq.' + cfg.account.id });
    }).then(function (rows) {
      const row = rows && rows[0];
      if (!row || row.encrypted) return null;
      console.info('[sync] connection stored unencrypted — re-publishing sealed');
      return publishConnection().then(function () { return { reencrypted: true }; });
    }).catch(function () { return null; });
  }

  /** Publish rank + roll-up so friends' VS screens work without a deep read. */
  function publishStats() {
    if (!signedIn()) return Promise.resolve();
    const r = App.Store.rank();
    const payload = publicStats(r);
    return hub.withRetry(function () {
      return hub.from('shared_stats').upsert([{
        user_id: cfg.account.id, payload: payload, updated_at: new Date().toISOString()
      }], 'user_id');
    }).then(function () {
      return hub.from('profiles').update({
        rank_id: r.rank.id, rank_points: r.points, updated_at: new Date().toISOString()
      }, { id: 'eq.' + cfg.account.id });
    }).catch(function (e) {
      console.warn('[sync] stats publish failed', e.message);
    });
  }

  function searchProfiles(q) {
    if (!signedIn()) return Promise.reject(new Error('Sign in to search for friends.'));
    const term = App.U.bareHandle(q) || String(q || '').trim();
    return hub.withRetry(function () { return hub.rpc('search_profiles', { q: term }); });
  }

  function listFriends() {
    if (!signedIn()) return Promise.resolve([]);
    return hub.withRetry(function () { return hub.rpc('list_friends', {}); });
  }

  /* Handles are shown with an @ everywhere in the app, and people paste what
     they see. The hub stores them bare — its own format check is
     `^[a-z0-9_]{3,24}$` — so an @ that reached it would simply match nobody and
     come back as "no account with that handle". Strip it here rather than at
     each call site, so no future caller can reintroduce the same dead end. */
  function requestFriend(handle) {
    const target = App.U.bareHandle(handle);
    return hub.withRetry(function () {
      return hub.rpc('request_friend', { target_handle: target });
    });
  }

  function respondFriend(id, accept) {
    return hub.withRetry(function () {
      return hub.rpc('respond_friend', { request_id: id, accept: !!accept });
    });
  }

  function removeFriend(id) {
    return hub.withRetry(function () { return hub.rpc('remove_friend', { other: id }); });
  }

  /* --- invites -------------------------------------------------------------
     A code is generated by one side, handed over out of band, and redeemed by
     the other. Redeeming IS the acceptance: holding the code is the consent, so
     there is no second approval step to chase. */

  function createInvite(label) {
    return hub.withRetry(function () {
      return hub.rpc('create_invite', { label: label || null });
    }).then(function (rows) { return (rows && rows[0]) || null; });
  }

  function redeemInvite(code) {
    return hub.withRetry(function () {
      return hub.rpc('redeem_invite', { invite_code: String(code || '').trim().toUpperCase() });
    }).then(function (rows) { return (rows && rows[0]) || null; });
  }

  function myInvites() {
    if (!signedIn()) return Promise.resolve([]);
    return hub.withRetry(function () { return hub.rpc('my_invites', {}); });
  }

  function revokeInvite(code) {
    return hub.withRetry(function () { return hub.rpc('revoke_invite', { invite_code: code }); });
  }

  function leaderboard() {
    if (!signedIn()) return Promise.resolve([]);
    return hub.withRetry(function () { return hub.rpc('friend_leaderboard', {}); });
  }

  /**
   * Deep read of a friend's own project. The hub hands over the connection
   * only when the friendship is accepted, and the key it hands over is
   * read-only against their data (writes need the write key, which never
   * leaves their device).
   */
  function readFriendData(friendId, opts) {
    opts = opts || {};
    if (!signedIn()) return Promise.reject(new Error('Sign in first.'));
    return hub.withRetry(function () {
      return hub.rpc('get_friend_connection', { friend: friendId });
    }).then(function (rows) {
      const conn = rows && rows[0];
      if (!conn) throw new Error('That friend has not linked a Supabase project yet.');
      if (conn.encrypted) {
        /* Their credentials are sealed with THEIR key, which we do not hold, so
           the comparison uses the summary they chose to publish instead. */
        throw new Error('That project is end-to-end encrypted, so only the summary ' +
          'they publish is readable.');
      }
      const c = App.Supabase.createClient(conn.supabase_url, conn.anon_key, {});
      const since = opts.since || U.daysAgo(180);
      return Promise.all([
        c.from('gym_public_summary').select('*').catch(function () { return []; }),
        c.from('gym_sessions').select('id,date,volume,duration_sec,data',
          { deleted: 'is.false', date: 'gte.' + since, order: 'date.desc', limit: '400' })
      ]).then(function (r) {
        return {
          profile: (r[0] && r[0][0]) || null,
          sessions: (r[1] || []).map(function (row) {
            return Object.assign({}, row.data, { id: row.id, date: row.date });
          }),
          handle: conn.handle,
          displayName: conn.display_name
        };
      });
    });
  }

  /* ---------------------------------------------------------------------------
     KEEPALIVE — once per calendar day, per device
     ------------------------------------------------------------------------ */

  /**
   * Free Supabase projects are paused after a stretch with no activity. On the
   * first app open of each day we make one real write to each project.
   *
   * The hub call is guarded server-side too: whichever user opens the app first
   * that day performs the write, and everyone else gets ran = false, so the hub
   * is touched exactly once per day no matter how many people are using it.
   */
  function runKeepalive() {
    const day = U.today();
    if (cfg.keepaliveDate === day) return Promise.resolve({ skipped: true });

    const jobs = [];
    if (enabled()) {
      jobs.push(personal.rpc('gym_keepalive', {}).then(function (r) {
        const row = Array.isArray(r) ? r[0] : r;
        return { target: 'personal', ran: !!(row && row.ran) };
      }).catch(function (e) {
        return { target: 'personal', error: e.message };
      }));
    }
    if (hub && cfg.hub.enabled) {
      jobs.push(hub.rpc('hub_keepalive', {}).then(function (r) {
        const row = Array.isArray(r) ? r[0] : r;
        return { target: 'hub', ran: !!(row && row.ran) };
      }).catch(function (e) {
        return { target: 'hub', error: e.message };
      }));
    }
    if (!jobs.length) return Promise.resolve({ skipped: true });

    return Promise.all(jobs).then(function (results) {
      cfg.keepaliveDate = day;
      return saveMarks().then(function () {
        console.info('[sync] keepalive', results);
        return { results: results };
      });
    });
  }

  /* ---------------------------------------------------------------------------
     BOOT
     ------------------------------------------------------------------------ */

  /**
   * The network half of start-up. Split from load() so the UI can paint with
   * the correct signed-in state before any of this is attempted.
   * Never rejects — the cloud is optional.
   */
  function start() {
    if (!navigator.onLine) return Promise.resolve();
    /* Renew the session up front so the first cloud call of the day is not the
       one that discovers the token expired overnight. */
    return keepSessionAlive()
      .then(function () { return runKeepalive(); })
      .then(function () { return checkPersonalSchema(); })
      .then(function () { return reencryptConnection(); })
      .then(function () { return pushPending().catch(function () {}); })
      .then(function () { if (signedIn()) return publishStats(); })
      .catch(function (e) { console.warn('[sync] start', e.message); });
  }

  /** Load + start, for callers that want both. */
  function boot() {
    return load().then(start).catch(function (e) {
      console.warn('[sync] boot failed', e.message);
    });
  }

  /* ---------------------------------------------------------------------------
     STAYING AWAKE WITHOUT BEING ASKED

     A free Supabase project is paused after a stretch with nothing touching
     it, and the write that prevents that is one call a day. Hanging it off
     start() alone left three ways to miss a day, all of them ordinary:

       * OPENED OFFLINE. start() returns immediately when there is no network,
         so the day's write never happened — not even once the signal came
         back ten minutes later.
       * NEVER RELOADED. In a web-to-app wrapper the page stays in memory for
         days. start() runs once, on the first launch, and a week of daily use
         after that is a week of the app never asking again.
       * LEFT OPEN OVER MIDNIGHT. The guard is per calendar day, so a page that
         was already running when the day turned over is a page that has
         already done "today".

     So the same call is now made on every way back in: returning to the
     foreground, regaining a network, and a slow timer behind both. It is free
     to call — runKeepalive() returns immediately once the day is done — which
     is exactly what makes it safe to call this often.
     ------------------------------------------------------------------------ */

  const WAKE_AFTER_MS = 5 * 60 * 1000;      /* away this long counts as a return */
  const WAKE_EVERY_MS = 3 * 60 * 60 * 1000; /* backstop for a page never hidden */
  let hiddenAt = 0;

  /** Everything the first cloud call of a day needs, in order, never throwing. */
  function wake() {
    if (!navigator.onLine) return Promise.resolve(false);
    if (!enabled() && !(hub && cfg.hub.enabled)) return Promise.resolve(false);
    return keepSessionAlive()
      .then(function () { return runKeepalive(); })
      .then(function () { return pushPending().catch(function () {}); })
      .then(function () { return true; })
      .catch(function (e) {
        console.warn('[sync] wake', e.message);
        return false;
      });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (!hiddenAt || Date.now() - hiddenAt < WAKE_AFTER_MS) return;
    hiddenAt = 0;
    wake();
  });

  setInterval(function () { if (!document.hidden) wake(); }, WAKE_EVERY_MS);

  window.addEventListener('online', function () {
    if (enabled()) schedulePush();
    wake();
  });

  App.Sync = {
    HUB_DEFAULT: HUB_DEFAULT,
    cfg: cfg,
    load: load, start: start, boot: boot, wake: wake,
    status: status, onStatus: onStatus, enabled: enabled, signedIn: signedIn,

    testPersonal: testPersonal, connectPersonal: connectPersonal,
    disconnectPersonal: disconnectPersonal,
    pushAll: pushAll, pushPending: pushPending, schedulePush: schedulePush,
    pull: pull, pushProfile: pushProfile, publicStats: publicStats,

    signUp: signUp, signIn: signIn, signOut: signOut,
    publishConnection: publishConnection, publishStats: publishStats,
    searchProfiles: searchProfiles, listFriends: listFriends,
    requestFriend: requestFriend, respondFriend: respondFriend, removeFriend: removeFriend,
    leaderboard: leaderboard, readFriendData: readFriendData,
    REQUIRED_SCHEMA: REQUIRED_SCHEMA,
    checkPersonalSchema: checkPersonalSchema, migratePersonal: migratePersonal,
    schemaNeedsAttention: schemaNeedsAttention,
    reencryptConnection: reencryptConnection,
    keepSessionAlive: keepSessionAlive,
    createInvite: createInvite, redeemInvite: redeemInvite,
    myInvites: myInvites, revokeInvite: revokeInvite,
    adoptStoredConnection: adoptStoredConnection, syncDataKey: syncDataKey,

    runKeepalive: runKeepalive,
    setHub: function (url, key, on) {
      cfg.hub.url = url || HUB_DEFAULT.url;
      cfg.hub.key = key || HUB_DEFAULT.key;
      cfg.hub.enabled = on !== false;
      buildHub(hub ? hub.session() : null);
      return saveHubCfg().then(emitStatus);
    }
  };
})(window.App = window.App || {});
