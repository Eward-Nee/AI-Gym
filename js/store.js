/* =============================================================================
   store.js — domain layer

   Owns the in-memory model, persists through App.DB, and publishes change
   events so pages can re-render without knowing about storage. Everything the
   UI reads goes through here; nothing above this file talks to IndexedDB.
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U;

  const DEFAULT_SETTINGS = {
    mode: 'dark',              /* light | dark | amoled */
    scheme: 'ember',
    background: 'plain',       /* see App.Shell.BACKGROUNDS */
    units: 'kg',               /* kg | lb */
    bodyweight: 80,
    name: '',
    handle: '',
    restDefault: 90,           /* seconds between sets */
    restBetweenExercises: 150,
    autoSync: true,
    firstRun: true
  };

  const state = {
    ready: false,
    exercises: [],
    exerciseById: Object.create(null),
    workouts: [],
    sessions: [],
    friends: [],
    settings: Object.assign({}, DEFAULT_SETTINGS)
  };

  /* ---------------------------------------------------------------------------
     EVENTS
     ------------------------------------------------------------------------ */

  const listeners = Object.create(null);

  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
    return function () { off(evt, fn); };
  }
  function off(evt, fn) {
    listeners[evt] = (listeners[evt] || []).filter(function (f) { return f !== fn; });
  }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(function (f) {
      try { f(payload); } catch (e) { console.error('[store] listener error', e); }
    });
    if (evt !== '*') emit('*', { type: evt, payload: payload });
  }

  /* ---------------------------------------------------------------------------
     LOAD / SEED
     ------------------------------------------------------------------------ */

  function reindex() {
    state.exerciseById = Object.create(null);
    state.exercises.forEach(function (e) { state.exerciseById[e.id] = e; });
  }

  function load() {
    return App.DB.init().then(function () {
      return Promise.all([
        App.DB.getAll('exercises'),
        App.DB.getAll('workouts'),
        App.DB.getAll('sessions'),
        App.DB.getAll('friends'),
        App.DB.getMeta('settings', null)
      ]);
    }).then(function (r) {
      state.exercises = r[0] || [];
      state.workouts = r[1] || [];
      state.sessions = r[2] || [];
      state.friends = r[3] || [];
      state.settings = Object.assign({}, DEFAULT_SETTINGS, r[4] || {});

      if (!state.exercises.length) return seedExercises();
      return topUpSeedExercises();
    }).then(function () {
      state.sessions.sort(function (a, b) { return (a.date < b.date) ? 1 : -1; });
      reindex();
      state.ready = true;
      emit('ready');
      emit('change');
      return state;
    });
  }

  /** First-run population from the generated library. */
  function seedExercises() {
    const now = new Date().toISOString();
    const rows = (App.SeedExercises || []).map(function (e) {
      return {
        id: e.id,
        name: e.name,
        equipment: e.equipment,
        pattern: e.pattern,
        unilateral: !!e.unilateral,
        muscles: e.muscles,
        image: null,
        notes: '',
        builtin: true,
        favorite: false,
        createdAt: now,
        updatedAt: now
      };
    });
    state.exercises = rows;
    return App.DB.putMany('exercises', rows).then(function () {
      console.info('[store] seeded ' + rows.length + ' exercises');
    });
  }

  /**
   * Add built-in movements that shipped in a later version than the one that
   * first seeded this device. Only genuinely new ids are inserted — anything
   * already present is left exactly as it is, so an exercise the user edited or
   * deleted on purpose is never resurrected or overwritten by an update.
   */
  function topUpSeedExercises() {
    const seeds = App.SeedExercises || [];
    if (!seeds.length) return Promise.resolve(0);

    return App.DB.getMeta('seed.removed', []).then(function (removed) {
      const gone = new Set(removed || []);
      const have = new Set(state.exercises.map(function (e) { return e.id; }));
      const now = new Date().toISOString();

      const fresh = seeds.filter(function (e) {
        return !have.has(e.id) && !gone.has(e.id);
      }).map(function (e) {
        return {
          id: e.id, name: e.name, equipment: e.equipment, pattern: e.pattern,
          unilateral: !!e.unilateral, muscles: e.muscles,
          image: null, notes: '', wr: null, builtin: true, favorite: false,
          createdAt: now, updatedAt: now
        };
      });

      if (!fresh.length) return 0;
      state.exercises = state.exercises.concat(fresh);
      return App.DB.putMany('exercises', fresh).then(function () {
        console.info('[store] added ' + fresh.length + ' new built-in exercises');
        return fresh.length;
      });
    }).catch(function () { return 0; });
  }

  /* ---------------------------------------------------------------------------
     SETTINGS
     ------------------------------------------------------------------------ */

  function getSettings() { return state.settings; }

  function saveSettings(patch) {
    Object.assign(state.settings, patch);
    return App.DB.setMeta('settings', state.settings).then(function () {
      emit('settings', state.settings);
      emit('change');
      return state.settings;
    });
  }

  /* ---------------------------------------------------------------------------
     EXERCISES
     ------------------------------------------------------------------------ */

  function allExercises() { return state.exercises; }
  function getExercise(id) { return state.exerciseById[id] || null; }

  function saveExercise(ex) {
    const now = new Date().toISOString();
    const rec = Object.assign({
      id: ex.id || U.uid('ex'),
      name: '',
      equipment: 'other',
      pattern: 'other',
      unilateral: false,
      muscles: {},
      image: null,
      notes: '',
      /* {value, bodyweight, units} — overrides the pattern estimate when set */
      wr: null,
      builtin: false,
      favorite: false,
      createdAt: now
    }, ex, { updatedAt: now });

    rec.muscles = App.Muscles.normalise(rec.muscles);

    const i = state.exercises.findIndex(function (e) { return e.id === rec.id; });
    if (i >= 0) state.exercises[i] = rec; else state.exercises.push(rec);
    reindex();

    return App.DB.put('exercises', rec).then(function () {
      queueSync('exercises', rec);
      emit('exercises');
      emit('change');
      return rec;
    });
  }

  function deleteExercise(id) {
    const removed = state.exercises.find(function (e) { return e.id === id; });
    state.exercises = state.exercises.filter(function (e) { return e.id !== id; });
    reindex();

    /* Remember deleted built-ins so a later version does not put them back. */
    if (removed && removed.builtin) {
      App.DB.getMeta('seed.removed', []).then(function (list) {
        const set = new Set(list || []);
        set.add(id);
        return App.DB.setMeta('seed.removed', Array.from(set));
      }).catch(function () {});
    }

    /* Drop the movement from any workout that referenced it. */
    const touched = [];
    state.workouts.forEach(function (w) {
      const before = w.items.length;
      w.items = w.items.filter(function (it) { return it.exerciseId !== id; });
      if (w.items.length !== before) touched.push(w);
    });
    return App.DB.remove('exercises', id)
      .then(function () { return Promise.all(touched.map(function (w) { return saveWorkout(w); })); })
      .then(function () {
        queueSync('exercises', { id: id, _deleted: true });
        emit('exercises');
        emit('change');
      });
  }

  /* ---------------------------------------------------------------------------
     WORKOUTS
     ------------------------------------------------------------------------ */

  function allWorkouts() { return state.workouts; }
  function getWorkout(id) {
    return state.workouts.find(function (w) { return w.id === id; }) || null;
  }

  /**
   * A workout item:
   *   { id, exerciseId, sets:[{weight,reps}], restSets, restAfter, note, group }
   */
  function saveWorkout(w) {
    const now = new Date().toISOString();
    const rec = Object.assign({
      id: w.id || U.uid('wo'),
      name: 'Untitled workout',
      items: [],
      notes: '',
      color: null,
      createdAt: now
    }, w, { updatedAt: now });

    rec.items = (rec.items || []).map(function (it) {
      return Object.assign({
        id: it.id || U.uid('it'),
        exerciseId: it.exerciseId,
        sets: it.sets && it.sets.length ? it.sets : [{ weight: 0, reps: 8 }],
        restSets: it.restSets === undefined ? state.settings.restDefault : it.restSets,
        restAfter: it.restAfter === undefined ? state.settings.restBetweenExercises : it.restAfter,
        note: it.note || ''
      }, it);
    });

    const i = state.workouts.findIndex(function (x) { return x.id === rec.id; });
    if (i >= 0) state.workouts[i] = rec; else state.workouts.push(rec);

    return App.DB.put('workouts', rec).then(function () {
      queueSync('workouts', rec);
      emit('workouts');
      emit('change');
      return rec;
    });
  }

  function deleteWorkout(id) {
    state.workouts = state.workouts.filter(function (w) { return w.id !== id; });
    return App.DB.remove('workouts', id).then(function () {
      queueSync('workouts', { id: id, _deleted: true });
      emit('workouts');
      emit('change');
    });
  }

  /* ---------------------------------------------------------------------------
     SESSIONS (logged history)
     ------------------------------------------------------------------------ */

  function allSessions() { return state.sessions; }

  function sessionsBetween(fromISO, toISO) {
    return state.sessions.filter(function (s) {
      return (!fromISO || s.date >= fromISO) && (!toISO || s.date <= toISO);
    });
  }

  function saveSession(s) {
    const now = new Date().toISOString();
    const rec = Object.assign({
      id: s.id || U.uid('se'),
      workoutId: null,
      name: '',
      date: U.today(),
      startedAt: now,
      endedAt: null,
      durationSec: 0,
      entries: [],
      notes: '',
      createdAt: now
    }, s, { updatedAt: now });

    const i = state.sessions.findIndex(function (x) { return x.id === rec.id; });
    if (i >= 0) state.sessions[i] = rec; else state.sessions.push(rec);
    state.sessions.sort(function (a, b) { return (a.date < b.date) ? 1 : -1; });

    return App.DB.put('sessions', rec).then(function () {
      queueSync('sessions', rec);
      emit('sessions');
      emit('change');
      return rec;
    });
  }

  function deleteSession(id) {
    state.sessions = state.sessions.filter(function (s) { return s.id !== id; });
    return App.DB.remove('sessions', id).then(function () {
      queueSync('sessions', { id: id, _deleted: true });
      emit('sessions');
      emit('change');
    });
  }

  /* ---------------------------------------------------------------------------
     FRIENDS
     ------------------------------------------------------------------------ */

  function allFriends() { return state.friends; }

  function saveFriend(f) {
    const rec = Object.assign({ id: f.id || U.uid('fr'), addedAt: new Date().toISOString() }, f);
    const i = state.friends.findIndex(function (x) { return x.id === rec.id; });
    if (i >= 0) state.friends[i] = rec; else state.friends.push(rec);
    return App.DB.put('friends', rec).then(function () {
      emit('friends');
      emit('change');
      return rec;
    });
  }

  function deleteFriend(id) {
    state.friends = state.friends.filter(function (f) { return f.id !== id; });
    return App.DB.remove('friends', id).then(function () {
      emit('friends');
      emit('change');
    });
  }

  /* ---------------------------------------------------------------------------
     SYNC QUEUE — writes are recorded even when offline
     ------------------------------------------------------------------------ */

  function queueSync(table, row) {
    if (!App.Sync || !App.Sync.enabled()) return;
    App.DB.put('outbox', {
      id: table + ':' + row.id,
      table: table,
      rowId: row.id,
      deleted: !!row._deleted,
      at: Date.now()
    }).then(function () {
      if (state.settings.autoSync) App.Sync.schedulePush();
    });
  }

  /* ---------------------------------------------------------------------------
     DERIVED DATA
     ------------------------------------------------------------------------ */

  /** Heat map for a single exercise — just its muscle split. */
  function exerciseHeat(ex) {
    return (ex && ex.muscles) ? ex.muscles : {};
  }

  /**
   * Heat for a workout: each movement contributes its muscle split weighted by
   * the work it carries (sets x reps x weight, or sets x reps when unloaded),
   * so a 5x5 squat outweighs a single set of curls.
   */
  function workoutHeat(workout) {
    const heat = Object.create(null);
    let total = 0;
    (workout.items || []).forEach(function (it) {
      const ex = getExercise(it.exerciseId);
      if (!ex) return;
      const work = itemWork(it);
      total += work;
      for (const m in ex.muscles) {
        heat[m] = (heat[m] || 0) + work * (ex.muscles[m] / 100);
      }
    });
    return normaliseHeat(heat, total);
  }

  function itemWork(it) {
    let w = 0;
    (it.sets || []).forEach(function (s) {
      const reps = Number(s.reps) || 0;
      const load = Number(s.weight) || 0;
      w += reps * (load > 0 ? load : 12);   /* unloaded sets get a nominal load */
    });
    return w || 1;
  }

  /** Heat across a set of logged sessions. */
  function sessionsHeat(sessions) {
    const heat = Object.create(null);
    let total = 0;
    sessions.forEach(function (s) {
      (s.entries || []).forEach(function (en) {
        const ex = getExercise(en.exerciseId);
        if (!ex) return;
        const work = itemWork(en);
        total += work;
        for (const m in ex.muscles) {
          heat[m] = (heat[m] || 0) + work * (ex.muscles[m] / 100);
        }
      });
    });
    return normaliseHeat(heat, total);
  }

  /** Scale so the hardest-worked muscle reads 100. */
  function normaliseHeat(heat, total) {
    if (!total) return {};
    let max = 0;
    for (const k in heat) max = Math.max(max, heat[k]);
    if (!max) return {};
    const out = Object.create(null);
    for (const k in heat) {
      const v = Math.round((heat[k] / max) * 1000) / 10;
      if (v > 0.4) out[k] = v;
    }
    return out;
  }

  /* --- workout statistics --------------------------------------------------- */

  function workoutStats(workout) {
    let volume = 0, sets = 0, reps = 0, timeSec = 0, topE1RM = 0;
    const perExercise = [];

    (workout.items || []).forEach(function (it) {
      const ex = getExercise(it.exerciseId);
      let vol = 0, r = 0, best = 0;
      (it.sets || []).forEach(function (s) {
        const wgt = Number(s.weight) || 0, rp = Number(s.reps) || 0;
        vol += wgt * rp;
        r += rp;
        best = Math.max(best, App.Ranks.e1rm(wgt, rp));
        timeSec += (it.restSets || 0) + rp * 3.5;
      });
      timeSec += it.restAfter || 0;
      volume += vol; sets += (it.sets || []).length; reps += r;
      topE1RM = Math.max(topE1RM, best);
      if (ex) perExercise.push({ exercise: ex, volume: vol, sets: (it.sets || []).length,
        reps: r, e1rm: best });
    });

    const heat = workoutHeat(workout);
    const groups = App.Muscles.groupTotals(heat);

    return {
      volume: volume, sets: sets, reps: reps,
      estDurationSec: Math.round(timeSec),
      topE1RM: topE1RM,
      perExercise: perExercise,
      heat: heat,
      groups: groups,
      chains: chainSplit(workout)
    };
  }

  /** Push / pull / legs / core split by work share. */
  function chainSplit(workout) {
    const out = { push: 0, pull: 0, legs: 0, core: 0 };
    let total = 0;
    (workout.items || []).forEach(function (it) {
      const ex = getExercise(it.exerciseId);
      if (!ex) return;
      const work = itemWork(it);
      total += work;
      for (const m in ex.muscles) {
        const g = App.Muscles.BY_ID[m];
        if (!g) continue;
        const chain = App.Muscles.GROUPS[g.group].chain;
        const share = work * (ex.muscles[m] / 100);
        if (chain === 'both') { out.push += share / 2; out.pull += share / 2; }
        else if (out[chain] !== undefined) out[chain] += share;
      }
    });
    if (!total) return out;
    Object.keys(out).forEach(function (k) { out[k] = Math.round((out[k] / total) * 100); });
    return out;
  }

  /** Suggested grouping label for the smart push/pull feature. */
  function suggestSplit(workout) {
    const c = chainSplit(workout);
    const entries = Object.keys(c).map(function (k) { return [k, c[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    if (!entries[0] || !entries[0][1]) return null;
    const [top, topVal] = entries[0];
    const second = entries[1];
    if (topVal >= 55) {
      return { key: top, label: { push: 'Push day', pull: 'Pull day', legs: 'Leg day',
        core: 'Core day' }[top], confidence: topVal };
    }
    if (second && topVal + second[1] >= 75) {
      return { key: top + '+' + second[0], label: 'Upper / mixed', confidence: topVal + second[1] };
    }
    return { key: 'full', label: 'Full body', confidence: 100 };
  }

  /* --- history & progression ------------------------------------------------ */

  /** Per-session series for one exercise: best e1RM and total volume by date. */
  function exerciseHistory(exerciseId, fromISO) {
    const out = [];
    state.sessions.slice().reverse().forEach(function (s) {
      if (fromISO && s.date < fromISO) return;
      (s.entries || []).forEach(function (en) {
        if (en.exerciseId !== exerciseId) return;
        out.push({
          date: s.date,
          e1rm: App.Ranks.bestE1RM(en.sets),
          volume: App.Ranks.volumeOf(en.sets),
          sets: (en.sets || []).length,
          topWeight: Math.max.apply(null, [0].concat((en.sets || [])
            .map(function (x) { return Number(x.weight) || 0; })))
        });
      });
    });
    return out;
  }

  /** Personal records across every exercise ever logged. */
  function personalRecords() {
    const best = Object.create(null);
    state.sessions.forEach(function (s) {
      (s.entries || []).forEach(function (en) {
        const one = App.Ranks.bestE1RM(en.sets);
        if (!one) return;
        const cur = best[en.exerciseId];
        if (!cur || one > cur.e1rm) {
          best[en.exerciseId] = { exerciseId: en.exerciseId, e1rm: one, date: s.date };
        }
      });
    });
    return Object.keys(best).map(function (k) {
      const ex = getExercise(k);
      return Object.assign({ name: ex ? ex.name : k, exercise: ex }, best[k]);
    }).sort(function (a, b) { return b.e1rm - a.e1rm; });
  }

  function rank() {
    return App.Ranks.compute({
      sessions: state.sessions,
      exercises: state.exerciseById,
      bodyweight: state.settings.bodyweight
    });
  }

  /* --- data management ------------------------------------------------------ */

  function exportAll() {
    return {
      format: 'ai-gym/v1',
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      exercises: state.exercises,
      workouts: state.workouts,
      sessions: state.sessions,
      friends: state.friends
    };
  }

  function importAll(data, mode) {
    if (!data || data.format !== 'ai-gym/v1') {
      return Promise.reject(new Error('Unrecognised backup file.'));
    }
    const merge = mode === 'merge';
    const jobs = [];

    ['exercises', 'workouts', 'sessions', 'friends'].forEach(function (key) {
      const incoming = data[key] || [];
      if (merge) {
        const byId = Object.create(null);
        state[key].forEach(function (r) { byId[r.id] = r; });
        incoming.forEach(function (r) { byId[r.id] = r; });
        state[key] = Object.keys(byId).map(function (k) { return byId[k]; });
      } else {
        state[key] = incoming;
      }
      jobs.push(App.DB.clear(key).then(function () {
        return App.DB.putMany(key, state[key]);
      }));
    });

    if (data.settings) {
      state.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
      jobs.push(App.DB.setMeta('settings', state.settings));
    }

    return Promise.all(jobs).then(function () {
      state.sessions.sort(function (a, b) { return (a.date < b.date) ? 1 : -1; });
      reindex();
      emit('change');
      emit('ready');
    });
  }

  /** Wipe progress. `keepLibrary` retains the exercise catalogue. */
  function resetData(opts) {
    opts = opts || {};
    const jobs = [App.DB.clear('workouts'), App.DB.clear('sessions'), App.DB.clear('outbox')];
    state.workouts = []; state.sessions = [];

    if (!opts.keepFriends) { jobs.push(App.DB.clear('friends')); state.friends = []; }
    if (!opts.keepLibrary) {
      jobs.push(App.DB.clear('exercises').then(seedExercises));
    }
    if (opts.resetSettings) {
      state.settings = Object.assign({}, DEFAULT_SETTINGS);
      jobs.push(App.DB.setMeta('settings', state.settings));
    }
    return Promise.all(jobs).then(function () {
      reindex();
      emit('change');
      emit('ready');
    });
  }

  App.Store = {
    state: state,
    load: load,
    on: on, off: off, emit: emit,

    getSettings: getSettings, saveSettings: saveSettings,

    allExercises: allExercises, getExercise: getExercise,
    saveExercise: saveExercise, deleteExercise: deleteExercise,

    allWorkouts: allWorkouts, getWorkout: getWorkout,
    saveWorkout: saveWorkout, deleteWorkout: deleteWorkout,

    allSessions: allSessions, sessionsBetween: sessionsBetween,
    saveSession: saveSession, deleteSession: deleteSession,

    allFriends: allFriends, saveFriend: saveFriend, deleteFriend: deleteFriend,

    exerciseHeat: exerciseHeat, workoutHeat: workoutHeat, sessionsHeat: sessionsHeat,
    workoutStats: workoutStats, chainSplit: chainSplit, suggestSplit: suggestSplit,
    exerciseHistory: exerciseHistory, personalRecords: personalRecords, rank: rank,

    exportAll: exportAll, importAll: importAll, resetData: resetData,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
})(window.App = window.App || {});
