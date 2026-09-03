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
    /* How much of an animated background actually moves. 'auto' asks the
       device; see App.Shell.resolveMotion(). */
    bgMotion: 'auto',          /* auto | full | low | off */
    units: 'kg',               /* kg | lb */
    bodyweight: 80,
    name: '',
    handle: '',
    restDefault: 90,           /* seconds between sets */
    /* How a logged dumbbell/kettlebell weight is read: 'per-hand' means the
       number is one implement and both are in use, so the body moved double.
       A per-exercise `loadMode` overrides it; see App.Ranks.loadMode(). */
    dumbbellLoad: 'per-hand',  /* per-hand | total */
    restBetweenExercises: 150,
    /* The rest-timer tone and how loud it is (0–100). See App.Sound. */
    restSound: 'chime',
    restVolume: 60,
    /* Hard sets per muscle per week the heat figures are scored against.
       Twelve is the middle of the range the dose-response meta-regressions
       find useful returns in, and it is a setting because those same papers
       find the returns continue past it rather than stopping there. */
    weeklySets: 12,
    /* Muscle-group ordering for "group by muscle group" in the builder. Off by
       default, in which case groups follow the taxonomy's own `order`.
       See App.Muscles.orderGroups(). */
    groupOrder: {
      enabled: false,
      general: ['chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'neck'],
      templates: []
    },
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
      sortWorkouts();
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
        /* Carried through: a movement whose pattern badly misestimates its
           record ships with the right one, and dropping it here would put the
           bad estimate back. */
        wr: e.wr || null,
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
          image: null, notes: '', wr: e.wr || null, builtin: true, favorite: false,
          createdAt: now, updatedAt: now
        };
      });

      /* A record corrected in a later version has to reach devices that seeded
         the movement before it existed, or those installs keep scoring against
         the old estimate for good. Only untouched built-ins are backfilled: a
         record the user set themselves is theirs and is left alone. */
      const seedById = Object.create(null);
      seeds.forEach(function (e) { if (e.wr) seedById[e.id] = e.wr; });

      const backfilled = state.exercises.filter(function (ex) {
        return ex.builtin && !ex.wr && seedById[ex.id];
      }).map(function (ex) {
        ex.wr = Object.assign({}, seedById[ex.id]);
        ex.updatedAt = now;
        return ex;
      });

      if (!fresh.length && !backfilled.length) return 0;
      state.exercises = state.exercises.concat(fresh);
      return App.DB.putMany('exercises', fresh.concat(backfilled)).then(function () {
        if (fresh.length) {
          console.info('[store] added ' + fresh.length + ' new built-in exercises');
        }
        if (backfilled.length) {
          console.info('[store] applied corrected world records to ' +
            backfilled.length + ' built-in exercises');
        }
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

  /** The whole id -> exercise index, for scoring a batch of sessions at once. */
  function exerciseMap() { return state.exerciseById; }

  function saveExercise(ex) {
    const now = new Date().toISOString();
    const rec = Object.assign({
      id: ex.id || U.uid('ex'),
      name: '',
      equipment: 'other',
      pattern: 'other',
      unilateral: false,
      /* null = follow the account default for paired equipment */
      loadMode: null,            /* null | 'per-hand' | 'total' */
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
    sortWorkouts();

    return App.DB.put('workouts', rec).then(function () {
      queueSync('workouts', rec);
      emit('workouts');
      emit('change');
      return rec;
    });
  }

  /* ---------------------------------------------------------------------------
     WORKOUT ORDER

     The list used to come out in whatever order IndexedDB handed the records
     back, which is insertion order and so effectively "oldest first" forever.
     The workout you actually run on a Monday should be the one you can reach
     first, and that is a decision only the person training can make.

     `order` is a plain integer per workout. Records written before this exist
     without one, so they are sorted by creation date and fall in behind
     anything explicitly placed, rather than jumping to the front on a nullish
     comparison.
     ------------------------------------------------------------------------ */

  function sortWorkouts() {
    state.workouts.sort(function (a, b) {
      const ao = typeof a.order === 'number' ? a.order : Infinity;
      const bo = typeof b.order === 'number' ? b.order : Infinity;
      if (ao !== bo) return ao - bo;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    return state.workouts;
  }

  /**
   * Persist a new order for the whole list, given the ids in their new order.
   *
   * Every workout is renumbered from zero rather than only the ones that moved.
   * A partial renumber leaves the untouched records carrying stale — or absent —
   * numbers, and the next reorder then has to reason about two orderings at
   * once. Rewriting all of them is a handful of small records and makes the
   * stored order match what is on screen exactly.
   */
  function reorderWorkouts(ids) {
    const byId = Object.create(null);
    state.workouts.forEach(function (w) { byId[w.id] = w; });

    const ordered = ids.map(function (id) { return byId[id]; }).filter(Boolean);
    state.workouts.forEach(function (w) { if (ordered.indexOf(w) < 0) ordered.push(w); });

    const now = new Date().toISOString();
    const changed = [];
    ordered.forEach(function (w, i) {
      if (w.order === i) return;
      w.order = i;
      w.updatedAt = now;
      changed.push(w);
    });

    state.workouts = ordered;
    if (!changed.length) return Promise.resolve(state.workouts);

    return Promise.all(changed.map(function (w) {
      return App.DB.put('workouts', w).then(function () { queueSync('workouts', w); });
    })).then(function () {
      emit('workouts');
      emit('change');
      return state.workouts;
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

  /* ---------------------------------------------------------------------------
     HEAT — AN ABSOLUTE SCALE, NOT A RELATIVE ONE

     Heat used to be normalised so that whatever muscle got the most work read
     100%. That answers "which muscle did I train hardest", which sounds useful
     and is not: it moves under you. Train nothing but calves and your calves
     read 100%. Add one heavy squat day and the same calf work drops to 30% —
     the calves did not change, the comparison did. Nothing could be read across
     two figures, because no two figures were on the same scale.

     Heat is now measured against a fixed requirement: **how much work a muscle
     needs in order to grow**, for a person of this bodyweight. 100% means "this
     muscle got the training it needs". Below is under-trained, above is more
     than the minimum. That number means the same thing on every figure in the
     app, this week and next.

     The unit is the HARD SET, which is how training volume is actually
     prescribed, and the requirement is twelve of them a week per muscle — the
     middle of the range the dose-response meta-regressions put the useful
     returns in. It is a setting, because those same papers find the returns
     carry on past twelve rather than stopping there.

     WHAT MAKES A SET HARD is no longer decided here. It is decided in
     App.Science, against the published curves, and this file's job is to point
     those curves at the log. Three things go into it:

       * HOW CLOSE TO FAILURE IT WAS. The one thing a volume count cannot see,
         and the one thing the growth literature is clearest about: strength
         gains are flat across a wide band of reps-in-reserve, growth is not.
         Nothing has to be typed in for this. The reps-to-failure curve says
         how many reps the load allowed, the log says how many were done, and
         the difference is the reps left in reserve.

       * HOW LONG THE SET WAS. Only at the ends now. A set of twenty taken near
         failure grows a muscle about as well as a set of eight, so the old
         three-to-fifteen band — a strength heuristic wearing a growth hat — is
         gone. Singles and thirty-rep sets still count for less.

       * WHERE IT SAT IN THE SESSION. The eleventh set for one muscle in one
         session is the point past which another one buys nothing detectable,
         so late sets are discounted. This is the entire frequency model, and
         it is deliberately indirect: see App.Science for why training a muscle
         on more days is worth something without being worth anything in
         itself.

     A set is scored against the lifter's OWN best, not against a world record.
     "Near failure" is a statement about this person on this movement, and the
     record only ever entered the old formula as a stand-in for the thing that
     actually mattered.
     ------------------------------------------------------------------------ */

  /** Hard sets a muscle needs per week, when the setting says nothing. */
  const HARD_SETS_PER_WEEK = App.Science.WEEKLY_SETS;

  /** Ceiling on a reported percentage, so "well past the requirement" is still
      a readable number rather than a runaway one. */
  const HEAT_MAX = 150;

  /** The weekly requirement in force — the setting, or the default. */
  function weeklyTarget() {
    const n = Number(state.settings && state.settings.weeklySets);
    return n >= 4 && n <= 40 ? n : HARD_SETS_PER_WEEK;
  }

  /* --- the lifter's own yardstick ------------------------------------------
     Proximity to failure is relative to what THIS person can lift, so every
     movement needs a reference 1RM: the best estimate the log had produced for
     it BY THE DAY OF THE SET.

     By that day, not ever. Judging a set from two years ago against today's
     best would read the whole of someone's early training as easy sets a long
     way from failure, when at the time they were maximal. A running best is
     what the lifter actually knew about themselves at the time, and it is the
     only reading that keeps a two-year figure comparable with a one-week one.

     The first set of a new movement is therefore its own reference, and reads
     as a set to failure — which is the right default, since there is no
     evidence yet that anything heavier was possible. It stops reading that way
     the moment it is beaten.

     Built as one pass over the log, in date order, and dropped on any change.
     ------------------------------------------------------------------------ */

  let refIndex = null;

  /**
   * What the body actually moved, from what was written down: a per-hand
   * dumbbell entry is half of it, and a bodyweight movement carries the
   * athlete as well as any added plate.
   */
  function systemLoad(weight, ex) {
    const load = (Number(weight) || 0) * App.Ranks.loadFactor(ex, state.settings);
    return ex && ex.equipment === 'bodyweight'
      ? load + Math.max(30, Number(state.settings.bodyweight) || 80)
      : load;
  }

  /** The inverse — a system load written back in the units the log uses. */
  function loggedLoad(load, ex) {
    const bw = ex && ex.equipment === 'bodyweight'
      ? Math.max(30, Number(state.settings.bodyweight) || 80) : 0;
    return Math.max(0, (Number(load) || 0) - bw) /
      App.Ranks.loadFactor(ex, state.settings);
  }

  /**
   * The best 1RM an entry is evidence for, in SYSTEM load.
   *
   * System load, not logged weight, because that is what proximity to failure
   * is measured in. Comparing a doubled dumbbell load against a reference
   * built from the single written-down number would put every dumbbell set at
   * twice its real fraction of a max, and read all of them as failure.
   */
  function entryOneRM(en, ex) {
    let best = 0;
    (en.sets || []).forEach(function (st) {
      if (st.done === false) return;
      best = Math.max(best, App.Ranks.e1rm(systemLoad(st.weight, ex), st.reps, ex));
    });
    return best;
  }

  function buildRefIndex() {
    refIndex = Object.create(null);
    const byDay = Object.create(null);

    state.sessions.forEach(function (s) {
      (s.entries || []).forEach(function (en) {
        const one = entryOneRM(en, getExercise(en.exerciseId));
        if (!(one > 0)) return;
        const day = s.date || '9999-99-99';
        const k = en.exerciseId;
        const m = byDay[k] || (byDay[k] = Object.create(null));
        if (one > (m[day] || 0)) m[day] = one;
      });
    });

    for (const k in byDay) {
      const days = Object.keys(byDay[k]).sort();
      let run = 0;
      refIndex[k] = days.map(function (d) {
        run = Math.max(run, byDay[k][d]);
        return { date: d, best: run };
      });
    }
  }

  /**
   * The best estimated 1RM for a movement as at `date` — or ever, when no date
   * is given, which is what a plan that has not happened yet should be judged
   * against.
   */
  function referenceOneRM(exerciseId, date) {
    if (!refIndex) buildRefIndex();
    const rows = refIndex[exerciseId];
    if (!rows || !rows.length) return 0;
    if (!date) return rows[rows.length - 1].best;

    let lo = 0, hi = rows.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].date <= date) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    /* A set predating every record can only be the very first one logged, and
       its own session is in the index, so this is the empty-log case. */
    return found < 0 ? 0 : rows[found].best;
  }

  on('change', function () { refIndex = null; });
  on('ready', function () { refIndex = null; });

  /**
   * How many reps were left in the tank.
   *
   * Two sources, and the stronger one wins. Coming up short of the reps the
   * plan asked for is not an estimate at all — it is a set that could not be
   * finished, which is the clearest evidence of failure there is. Only when
   * there is no plan to fall short of, or the plan was met, does the curve get
   * consulted.
   */
  function estimateRIR(plannedReps, load, reps, ex, date) {
    if (plannedReps > 0 && reps < plannedReps) return 0;

    /* An unloaded set still trains the muscle, and there is nothing to judge
       its heaviness by. Assume the ordinary working set rather than either
       extreme. */
    if (load <= 0) return 2.5;

    const near = App.Science.proximity(load, reps, referenceOneRM(ex.id, date), ex);
    return near ? near.rir : 2.5;
  }

  /**
   * One set's contribution, in hard-set equivalents, before its share of each
   * muscle and before its position in the session are applied.
   *
   * @param {Object} set          {weight, reps}
   * @param {number} plannedReps  reps the plan asked for, or 0 if unknown
   * @param {Object} ex           the exercise
   * @param {string} [date]       the day it was logged, for the reference 1RM
   * @returns {number} usually 0.6 - 1.25
   */
  function setStimulus(set, plannedReps, ex, date) {
    const reps = Number(set.reps) || 0;
    if (reps <= 0) return 0;

    const rir = estimateRIR(plannedReps, systemLoad(set.weight, ex), reps, ex, date);
    return App.Science.repFactor(reps) * App.Science.effortFactor(rir);
  }

  /**
   * The planned reps for each exercise of a session, from the workout it was
   * run from — the baseline the failure reading is measured against.
   */
  function planFor(session) {
    if (!session || !session.workoutId) return null;
    const w = getWorkout(session.workoutId);
    if (!w) return null;
    const map = Object.create(null);
    (w.items || []).forEach(function (it) { map[it.exerciseId] = it.sets || []; });
    return map;
  }

  /**
   * Hard-set equivalents per muscle across a list of sessions.
   *
   * Raw and credited totals are kept apart. They differ by exactly the
   * per-session saturation, which is what makes the gap between them readable
   * as "work you stacked into one day and were not paid for".
   *
   * @param {Array} groups  [{entries, plan, date}] — one group per session
   * @returns {Object} muscleId -> {raw, credited, sessions}
   */
  function volumeFrom(groups) {
    const acc = Object.create(null);

    function cell(m) {
      return acc[m] || (acc[m] = { raw: 0, credited: 0, sessions: 0 });
    }

    groups.forEach(function (g) {
      /* Sets accumulate WITHIN a session, because that is the window the
         per-session ceiling applies to. A new group starts everything back at
         zero, which is precisely why spreading the work pays. */
      const inSession = Object.create(null);

      (g.entries || []).forEach(function (en) {
        const ex = getExercise(en.exerciseId);
        if (!ex || !ex.muscles) return;

        /* Shares are renormalised against the exercise's OWN prime mover, so a
           set of bench is one hard set for the chest and a fraction of one for
           the triceps. Taken as raw shares of a hundred, a set would only ever
           be worth 0.35 of a hard set to anything, and no amount of realistic
           training would reach the requirement. */
        let top = 0;
        for (const m in ex.muscles) top = Math.max(top, Number(ex.muscles[m]) || 0);
        if (top <= 0) return;

        const plan = g.plan && g.plan[en.exerciseId];
        (en.sets || []).forEach(function (st, i) {
          if (st.done === false) return;
          const planned = plan && plan[i] ? Number(plan[i].reps) || 0 : 0;
          const stim = setStimulus(st, planned, ex, g.date);
          if (!stim) return;
          for (const m in ex.muscles) {
            const share = Math.min(1, (Number(ex.muscles[m]) || 0) / top);
            const add = stim * share;
            if (add <= 0) continue;
            const have = inSession[m] || 0;
            const c = cell(m);
            c.raw += add;
            c.credited += App.Science.marginalCredit(have, add);
            inSession[m] = have + add;
          }
        });
      });

      for (const m in inSession) {
        if (inSession[m] >= App.Science.SESSION_TOUCH) cell(m).sessions++;
      }
    });

    return acc;
  }

  /**
   * @param {Array}  groups  [{entries, plan, date}]
   * @param {Object} opts    {weeks} — the window the requirement is scaled to
   */
  function heatFrom(groups, opts) {
    const acc = volumeFrom(groups);

    /* THE REQUIREMENT IS WEEKLY, AND SO IS THE ANSWER.
       Scaling the target by the length of the selected RANGE was wrong in the
       way that matters: pick 90 days, train hard for a fortnight, and the work
       is divided by thirteen weeks — so a genuinely hard chest week reports 3%
       and the figure looks like you have done nothing. The range is a filter on
       what to look at, not a claim about how long you were training.

       Dividing by the weeks that actually CONTAIN training gives the rate
       instead: "in a week you train, this muscle gets X% of what it needs".
       That number stays put whether you are looking at a month or a year, which
       is the whole point of an absolute scale. */
    const weeks = Math.max(1, Number(opts && opts.weeks) || 1);
    const target = weeklyTarget() * weeks;

    const out = Object.create(null);
    for (const k in acc) {
      const v = Math.round((acc[k].credited / target) * 1000) / 10;
      if (v >= 0.5) out[k] = Math.min(HEAT_MAX, v);
    }
    return out;
  }

  /**
   * The weekly picture behind the figure, per muscle, for the report.
   *
   * Everything is a WEEKLY RATE, for the same reason heat is: the range is a
   * filter on what to look at, not a claim about how long you trained. `sets`
   * is what got credited, `raw` is what was performed, and `wasted` is the
   * difference the per-session ceiling took.
   *
   * @param {Array} sessions
   * @returns {Array} [{id, name, group, sets, raw, wasted, sessions, perSession}]
   */
  function muscleVolume(sessions) {
    const acc = volumeFrom((sessions || []).map(function (s) {
      return { entries: s.entries, plan: planFor(s), date: s.date };
    }));
    const weeks = trainingWeeks(sessions);

    const out = [];
    for (const id in acc) {
      const m = App.Muscles.BY_ID[id];
      const c = acc[id];
      out.push({
        id: id,
        name: m ? m.name : id,
        group: m ? m.group : 'other',
        sets: c.credited / weeks,
        raw: c.raw / weeks,
        wasted: Math.max(0, (c.raw - c.credited) / weeks),
        sessions: c.sessions / weeks,
        perSession: c.sessions ? c.raw / c.sessions : 0
      });
    }
    return out.sort(function (a, b) { return b.sets - a.sets; });
  }

  /**
   * Heat for a workout as PLANNED. No failure bonus — nothing has happened yet,
   * so there is no shortfall to read anything into.
   */
  function workoutHeat(workout) {
    return heatFrom([{
      entries: (workout.items || []).map(function (it) {
        return { exerciseId: it.exerciseId, sets: it.sets };
      }),
      plan: null
    }], { weeks: 1 });
  }

  /**
   * How many weeks of training these sessions represent.
   *
   * Measured from the SPAN between the first and last session, not from the
   * length of the selected range: a three-month view of someone who started a
   * fortnight ago should report their actual weekly rate, not average it across
   * ten weeks they were not training in.
   *
   * Span rather than a count of distinct calendar weeks, because a fortnight of
   * training that happens to straddle a Monday touches three calendar weeks and
   * would be divided by three — understating the rate by a third for no reason
   * but where the boundaries fell.
   *
   * Rounded UP to whole weeks, which is the fencepost: four weekly sessions sit
   * three weeks apart end to end but represent four weeks of training, and
   * dividing by the bare span would overstate the rate by a third. A session
   * with no date, which is the live one in the runner, counts as the week in
   * progress.
   */
  function trainingWeeks(sessions) {
    let lo = null, hi = null;
    (sessions || []).forEach(function (s) {
      if (!s || !s.date) return;
      if (lo === null || s.date < lo) lo = s.date;
      if (hi === null || s.date > hi) hi = s.date;
    });
    if (lo === null) return 1;
    const days = Math.round(
      (new Date(hi + 'T12:00:00') - new Date(lo + 'T12:00:00')) / 86400000) + 1;
    return Math.max(1, Math.ceil(days / 7));
  }

  /**
   * Heat across logged sessions, as a share of a week's requirement.
   * @param {Array} sessions
   */
  function sessionsHeat(sessions) {
    return heatFrom((sessions || []).map(function (s) {
      return { entries: s.entries, plan: planFor(s), date: s.date };
    }), { weeks: trainingWeeks(sessions) });
  }

  /** Volume-weighted work for a single entry — still used for duration maths. */
  function itemWork(it) {
    let w = 0;
    (it.sets || []).forEach(function (s) {
      const reps = Number(s.reps) || 0;
      const load = Number(s.weight) || 0;
      w += reps * (load > 0 ? load : 12);   /* unloaded sets get a nominal load */
    });
    return w || 1;
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
        best = Math.max(best, App.Ranks.e1rm(wgt, rp, ex));
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
      stacked: overStacked(workout),
      chains: chainSplit(workout)
    };
  }

  /**
   * Muscles this plan asks to do more in one session than one session can use.
   *
   * Worth saying before the session rather than after it: the fix — move half
   * of it to another day — is free while the plan is still being written, and
   * costs a redone workout afterwards.
   */
  function overStacked(workout) {
    const acc = volumeFrom([{
      entries: (workout.items || []).map(function (it) {
        return { exerciseId: it.exerciseId, sets: it.sets };
      }),
      plan: null
    }]);

    const out = [];
    for (const id in acc) {
      if (acc[id].raw <= App.Science.SESSION_PUOS) continue;
      const m = App.Muscles.BY_ID[id];
      out.push({
        id: id,
        name: m ? m.name : id,
        sets: acc[id].raw,
        lost: acc[id].raw - acc[id].credited
      });
    }
    return out.sort(function (a, b) { return b.lost - a.lost; });
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
          e1rm: App.Ranks.bestE1RM(en.sets, getExercise(en.exerciseId)),
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
        const one = App.Ranks.bestE1RM(en.sets, getExercise(en.exerciseId));
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
      bodyweight: state.settings.bodyweight,
      settings: state.settings
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

    allExercises: allExercises, getExercise: getExercise, exerciseMap: exerciseMap,
    saveExercise: saveExercise, deleteExercise: deleteExercise,

    allWorkouts: allWorkouts, getWorkout: getWorkout,
    saveWorkout: saveWorkout, deleteWorkout: deleteWorkout,
    reorderWorkouts: reorderWorkouts,

    allSessions: allSessions, sessionsBetween: sessionsBetween,
    saveSession: saveSession, deleteSession: deleteSession,

    allFriends: allFriends, saveFriend: saveFriend, deleteFriend: deleteFriend,

    exerciseHeat: exerciseHeat, workoutHeat: workoutHeat, sessionsHeat: sessionsHeat,
    trainingWeeks: trainingWeeks, muscleVolume: muscleVolume,
    weeklyTarget: weeklyTarget, referenceOneRM: referenceOneRM,
    systemLoad: systemLoad, loggedLoad: loggedLoad,
    HEAT_MAX: HEAT_MAX, HARD_SETS_PER_WEEK: HARD_SETS_PER_WEEK,
    workoutStats: workoutStats, chainSplit: chainSplit, suggestSplit: suggestSplit,
    exerciseHistory: exerciseHistory, personalRecords: personalRecords, rank: rank,

    exportAll: exportAll, importAll: importAll, resetData: resetData,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
})(window.App = window.App || {});
