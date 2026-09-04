/* =============================================================================
   programs.js — training programs, and the generator that writes one

   A WORKOUT is a single session's plan. A PROGRAM is a rotation of them: a
   list of phases, each holding a few workouts, that the app steps through on
   a schedule the lifter sets — every N days, weeks or months.

   WHY A PROGRAM IS PHASES RATHER THAN A CALENDAR
   ----------------------------------------------
   A dated calendar goes wrong the first week somebody misses a Tuesday. A
   phase is a *period*, and which phase is live is a pure function of the
   start date, the period and today — so a missed session moves nothing and
   there is nothing to repair. Skipping a week costs a week of that phase and
   the rotation carries on.

   WHAT THE GENERATOR IS FOR
   -------------------------
   Given one workout somebody already does, their equipment, and how many days
   a week they train, it writes a whole program: which days train what, what
   the sets and reps are in each phase, and which movements stand in for the
   ones they cannot do. Everything it uses is in the training literature and
   the specifics are noted at each decision below rather than in one lump.

   THE ONE THING THE EVIDENCE DOES NOT SAY
   ---------------------------------------
   That any of this beats any other version of it. Volume-equated, split
   structure has no independent effect on hypertrophy (Schoenfeld/Grgic/Krieger
   2019), and linear versus undulating periodisation is a wash (pooled SMD
   -0.02, 13 studies). What the phases buy is variety, fatigue management and a
   reason to change the load — not a bigger number at the end. The UI says so,
   because a generator that implies otherwise is selling something.
   ============================================================================= */
(function (App) {
  'use strict';

  const U = App.U;

  /* ---------------------------------------------------------------------------
     EQUIPMENT

     Presets, not a fixed taxonomy: the toggles are per equipment id, and a
     preset just ticks a set of them. `bodyweight` is deliberately its own
     opt-out rather than being folded into a preset — it is the second-largest
     class in the library (77 of 468 movements) and plenty of people simply
     will not do it.
     ------------------------------------------------------------------------ */

  const KITS = {
    commercial: {
      name: 'Commercial gym',
      hint: 'Everything: racks, machines, cables, dumbbells.',
      equip: ['barbell', 'dumbbell', 'smith', 'machine', 'cable', 'bodyweight',
        'kettlebell', 'ezbar', 'trapbar', 'landmine', 'band', 'sled', 'plate',
        'ball', 'suspension', 'other']
    },
    home_barbell: {
      name: 'Home gym with a barbell',
      hint: 'Barbell, plates, a bench, some dumbbells.',
      equip: ['barbell', 'ezbar', 'plate', 'bodyweight', 'band', 'dumbbell']
    },
    dumbbell: {
      name: 'Dumbbells only',
      hint: 'A pair of adjustable dumbbells and a bench.',
      equip: ['dumbbell', 'bodyweight', 'band']
    },
    machines: {
      name: 'Machines and cables',
      hint: 'A machine circuit gym, no free weights.',
      equip: ['machine', 'cable', 'smith', 'bodyweight']
    },
    minimal: {
      name: 'Minimal kit',
      hint: 'Dumbbells, a band, and the floor.',
      equip: ['dumbbell', 'band', 'bodyweight']
    },
    bodyweight: {
      name: 'Bodyweight only',
      hint: 'Nothing but you and a bar to hang from.',
      equip: ['bodyweight', 'suspension']
    }
  };

  /* ---------------------------------------------------------------------------
     MOVEMENT FAMILIES

     Two patterns in the same family are interchangeable at a reduced score;
     nothing crosses a family boundary on its own. FALLBACK is the ordered list
     of families to try when a family is EMPTY for the kit in hand — the case
     that matters is a vertical pull with no bodyweight, no cable and no
     machine, where the library has literally nothing to offer and the honest
     answer is rows plus lat isolation, said out loud.
     ------------------------------------------------------------------------ */

  const FAMILY = {
    'horizontal-push': 'push-h', 'incline-push': 'push-h',
    'vertical-push': 'push-v',
    'horizontal-pull': 'pull-h',
    'vertical-pull': 'pull-v',
    'squat': 'knee', 'lunge': 'knee',
    'hinge': 'hip',
    'chest-isolation': 'iso-chest',
    'back-isolation': 'iso-back',
    'shoulder-isolation': 'iso-shoulder',
    'biceps-isolation': 'iso-biceps',
    'triceps-isolation': 'iso-triceps',
    'forearm-isolation': 'iso-forearm',
    'quad-isolation': 'iso-quad', 'leg-isolation': 'iso-adductor',
    'ham-isolation': 'iso-ham', 'glute-isolation': 'iso-glute',
    'calf-isolation': 'iso-calf',
    'core': 'core', 'carry': 'carry', 'neck-isolation': 'iso-neck',
    'olympic': 'olympic'
  };

  const FAMILY_FALLBACK = {
    'push-v': ['push-h'],
    'push-h': ['push-v'],
    'pull-v': ['pull-h', 'iso-back'],
    'pull-h': ['pull-v'],
    'knee': ['hip'],
    'hip': ['knee', 'iso-ham', 'iso-glute'],
    'iso-ham': ['hip'],
    'iso-quad': ['knee'],
    'iso-glute': ['hip'],
    'iso-chest': ['push-h'],
    'iso-back': ['pull-h'],
    'iso-biceps': ['pull-v', 'pull-h'],
    'iso-triceps': ['push-h', 'push-v'],
    'iso-calf': [],
    'core': []
  };

  /* How the resistance is applied. Swapping within a class keeps how the set
     feels and how the load progresses. */
  const LOAD_CLASS = {
    barbell: 'free', dumbbell: 'free', ezbar: 'free', trapbar: 'free',
    kettlebell: 'free', plate: 'free', ball: 'free', landmine: 'free',
    machine: 'guided', smith: 'guided', sled: 'guided',
    cable: 'cable', band: 'elastic',
    bodyweight: 'bodyweight', suspension: 'bodyweight',
    other: 'other'
  };

  /* Can it be micro-loaded? Double progression needs a next plate to add;
     bodyweight and bands have none, which is why they get a wider rep range
     rather than a heavier target. */
  const LOADABLE = {
    barbell: 1, dumbbell: 1, ezbar: 1, trapbar: 1, kettlebell: 1, machine: 1,
    smith: 1, cable: 1, plate: 1, landmine: 1, sled: 1, ball: 1
  };

  /* ---------------------------------------------------------------------------
     PREFERRED MOVEMENTS

     What the generator reaches for first when it has a free choice. Popularity
     (StrengthLog's public ranking over 700k lifters) plus loadability, with
     three places where a direct trial disagrees with popularity and the trial
     wins:

       * overhead triceps work before pushdowns — Maeo 2023, +19.9% vs +13.5%
         over twelve weeks, long head the beneficiary
       * seated leg curl before lying — Maeo 2021, +14% vs +9%, load matched
       * an incline press slot whenever chest gets real volume — the library's
         own muscle maps have pec_upper at 8% of a flat bench and 27.5% of an
         incline, so the flat press alone does not cover it

     EMG amplitude is not a validated proxy for growth (Vigotsky 2022), so
     nothing here rests on an EMG ranking alone.
     ------------------------------------------------------------------------ */

  const PREFERRED = {
    'horizontal-push': ['barbell-bench-press', 'dumbbell-bench-press',
      'machine-bench-press', 'seated-machine-chest-press',
      'hammer-strength-chest-press', 'cable-chest-press',
      'smith-machine-bench-press', 'push-up', 'dumbbell-floor-press'],
    'incline-push': ['barbell-incline-bench-press', 'dumbbell-incline-bench-press',
      'machine-incline-bench-press', 'incline-hammer-strength-press',
      'smith-machine-incline-bench-press', 'incline-cable-press', 'landmine-press'],
    'vertical-push': ['barbell-overhead-press', 'dumbbell-overhead-press',
      'dumbbell-seated-shoulder-press', 'machine-seated-shoulder-press',
      'arnold-press', 'smith-machine-overhead-press', 'landmine-shoulder-press',
      'weighted-dip', 'chest-dip', 'pike-push-up'],
    'chest-isolation': ['cable-fly', 'machine-pec-deck', 'cable-crossover-low-to-high',
      'dumbbell-fly', 'cable-incline-fly', 'dumbbell-pullover'],
    'shoulder-isolation': ['dumbbell-lateral-raise', 'cable-lateral-raise',
      'machine-lateral-raise', 'leaning-cable-lateral-raise', 'incline-lateral-raise',
      'seated-dumbbell-lateral-raise'],
    'triceps-isolation': ['overhead-cable-triceps-extension',
      'overhead-dumbbell-triceps-extension', 'ez-bar-skull-crusher',
      'incline-skull-crusher', 'rope-pushdown', 'cable-triceps-pushdown',
      'machine-triceps-extension'],
    'vertical-pull': ['pull-up', 'lat-pulldown', 'weighted-pull-up', 'chin-up',
      'neutral-grip-pull-up', 'neutral-grip-lat-pulldown', 'machine-pulldown',
      'assisted-pull-up', 'close-grip-lat-pulldown'],
    'horizontal-pull': ['barbell-bent-over-row', 'seated-cable-row',
      'chest-supported-row', 'close-grip-seated-cable-row', 'dumbbell-row',
      'chest-supported-t-bar-row', 'machine-seated-row', 'hammer-strength-row',
      't-bar-row', 'pendlay-row', 'inverted-row'],
    'back-isolation': ['face-pull', 'rope-face-pull', 'reverse-pec-deck',
      'cable-reverse-fly', 'straight-arm-pulldown', 'barbell-shrug', 'dumbbell-shrug',
      'band-pull-apart'],
    'biceps-isolation': ['incline-dumbbell-curl', 'barbell-curl', 'ez-bar-curl',
      'dumbbell-curl', 'cable-curl', 'preacher-curl', 'hammer-curl',
      'bayesian-cable-curl'],
    'squat': ['barbell-back-squat', 'high-bar-back-squat', 'hack-squat', 'leg-press',
      '45-degree-leg-press', 'front-squat', 'pendulum-squat', 'smith-machine-squat',
      'goblet-squat', 'belt-squat'],
    'hinge': ['romanian-deadlift', 'barbell-deadlift', 'barbell-hip-thrust',
      'dumbbell-romanian-deadlift', 'trap-bar-deadlift', 'stiff-leg-deadlift',
      'machine-hip-thrust', 'cable-pull-through', 'good-morning',
      '45-degree-back-extension'],
    'lunge': ['bulgarian-split-squat', 'walking-lunge', 'reverse-lunge', 'split-squat',
      'step-up', 'barbell-bulgarian-split-squat', 'forward-lunge'],
    'ham-isolation': ['seated-leg-curl', 'lying-leg-curl', 'standing-leg-curl',
      'cable-leg-curl'],
    'quad-isolation': ['leg-extension', 'single-leg-extension'],
    'glute-isolation': ['hip-abduction-machine', 'cable-hip-abduction',
      'machine-glute-kickback', 'banded-lateral-walk'],
    'calf-isolation': ['standing-calf-raise', 'seated-calf-raise',
      'leg-press-calf-raise', 'smith-machine-calf-raise'],
    'core': ['hanging-leg-raise', 'cable-crunch', 'ab-wheel-rollout', 'pallof-press',
      'hanging-knee-raise', 'machine-crunch', 'weighted-crunch', 'plank']
  };

  /* ---------------------------------------------------------------------------
     THE DAYS

     A day is an ordered list of pattern slots — compounds first, isolation
     after, which is the one ordering rule the position stands agree on. The
     slot list is longer than any one day needs; how many get used comes from
     SLOTS_PER_DAY below, so the same template serves a two-day week and a
     six-day one without a second table.
     ------------------------------------------------------------------------ */

  const DAY_TEMPLATES = {
    'full-a': { name: 'Full body A', slots: ['squat', 'horizontal-push', 'horizontal-pull',
      'vertical-push', 'hinge', 'shoulder-isolation', 'core'] },
    'full-b': { name: 'Full body B', slots: ['hinge', 'vertical-push', 'vertical-pull',
      'lunge', 'incline-push', 'biceps-isolation', 'triceps-isolation'] },
    upper: { name: 'Upper', slots: ['horizontal-push', 'vertical-pull', 'vertical-push',
      'horizontal-pull', 'incline-push', 'shoulder-isolation', 'back-isolation',
      'biceps-isolation', 'triceps-isolation'] },
    lower: { name: 'Lower', slots: ['squat', 'hinge', 'lunge', 'ham-isolation',
      'quad-isolation', 'calf-isolation', 'glute-isolation', 'core'] },
    push: { name: 'Push', slots: ['horizontal-push', 'vertical-push', 'incline-push',
      'chest-isolation', 'shoulder-isolation', 'triceps-isolation'] },
    pull: { name: 'Pull', slots: ['vertical-pull', 'horizontal-pull', 'back-isolation',
      'biceps-isolation', 'forearm-isolation'] },
    legs: { name: 'Legs', slots: ['squat', 'hinge', 'lunge', 'ham-isolation',
      'quad-isolation', 'calf-isolation', 'core'] }
  };

  /* Volume-equated, which split you pick does not change the outcome — so
     these are chosen to land each muscle's weekly sets under what one session
     can use, and nothing more is claimed for them. */
  const SPLITS = {
    'full-body': { name: 'Full body', days: [2, 3], seq: ['full-a', 'full-b', 'full-a'] },
    'upper-lower': { name: 'Upper / lower', days: [4], seq: ['upper', 'lower', 'upper', 'lower'] },
    'upper-lower-5': { name: 'Upper / lower + full', days: [5], seq: ['upper', 'lower', 'upper', 'lower', 'full-a'] },
    'push-pull-legs': { name: 'Push / pull / legs', days: [3, 6], seq: ['push', 'pull', 'legs', 'push', 'pull', 'legs'] },
    'ppl-ul': { name: 'PPL + upper / lower', days: [5], seq: ['push', 'pull', 'legs', 'upper', 'lower'] }
  };

  /** Exercises per day, and sets per exercise, by how often you train. */
  const SLOTS_PER_DAY = { 2: 8, 3: 7, 4: 6, 5: 6, 6: 5 };

  /* ---------------------------------------------------------------------------
     THE BLOCKS

     Sets, reps and effort per phase. Loads are never hard-coded percentages:
     App.Science.loadForReps already knows this library's own rep curve — and
     shifts leg machines onto the leg-press curve — so the target weight is
     computed from the lifter's own reference 1RM and then discounted for the
     reps left in reserve.
     ------------------------------------------------------------------------ */

  const BLOCKS = {
    hypertrophy: {
      name: 'Hypertrophy', weeks: 4,
      hint: 'More sets, moderate weight, one or two reps left in the tank.',
      sets: 4, isoSets: 3, reps: 10, isoReps: 12, rir: 2, restSets: 105, restAfter: 150
    },
    strength: {
      name: 'Strength', weeks: 4,
      hint: 'Fewer, heavier sets on the big lifts, and long rests.',
      sets: 5, isoSets: 3, reps: 5, isoReps: 10, rir: 2, restSets: 210, restAfter: 240
    },
    metabolite: {
      name: 'High rep', weeks: 2,
      hint: 'Light and long, close to failure, short rests.',
      sets: 3, isoSets: 4, reps: 16, isoReps: 18, rir: 1, restSets: 70, restAfter: 100
    },
    deload: {
      name: 'Deload', weeks: 1,
      hint: 'Half the work, well short of failure, so the next block starts fresh.',
      sets: 2, isoSets: 2, reps: 8, isoReps: 12, rir: 5, restSets: 120, restAfter: 150,
      compoundsOnly: true
    }
  };

  /* A to-failure load, discounted for the reps you mean to leave. */
  const RIR_MULT = [1, 0.97, 0.94, 0.91, 0.88, 0.85];

  /* ---------------------------------------------------------------------------
     HOME UNITS AND THEIR STATIONS

     "Machine" and "cable" are honest equipment ids in a commercial gym, where
     the word covers thirty different machines. They are not honest for a home
     smith-machine unit, which has ONE pulley, ONE leg developer and no hack
     squat, and a generator that read "machine" off it would prescribe a
     pendulum squat to someone whose machine is a bench with a bar on rails.

     So a unit is described by its STATIONS, and a machine or cable exercise is
     only allowed off a unit when one of its stations can actually perform it.
     The regexes are over exercise ids — this library's ids are descriptive
     enough for that to be the right key.
     ------------------------------------------------------------------------ */

  const STATION_EQUIP = {
    smith: 'smith', freeBarbell: 'barbell', cable: 'cable', latPulldown: 'cable',
    lowRow: 'cable', cableCrossover: 'cable', pecDeck: 'machine',
    legDeveloper: 'machine', legPress: 'machine', preacherCurl: 'machine',
    dipStation: 'bodyweight', pullupBar: 'bodyweight'
  };

  const STATION_MATCH = {
    smith: /smith/,
    latPulldown: /pulldown|pull-down|lat-pull/,
    lowRow: /cable-row|seated-row|low-row|machine-row|cable-.*-row/,
    /* One pulley does not make a chest press or a fly; those need the crossover
       arms, which is a station of its own below. */
    cable: /^(?!.*(chest-press|fly|crossover))(?=.*(cable|rope|pushdown|face-pull|pull-through|woodchop|pallof|straight-arm|triceps-extension))/,
    cableCrossover: /crossover|cable-fly|cable-incline-fly|cable-chest/,
    pecDeck: /pec-deck|machine-fly|reverse-fly/,
    legDeveloper: /leg-extension|leg-curl/,
    legPress: /leg-press/,
    preacherCurl: /preacher/,
    dipStation: /dip/,
    pullupBar: /pull-up|chin-up|hanging|inverted-row/
  };

  /* The catalogue lives in js/data/units.js, loaded before this file. */
  const UNITS = (App.SeedUnits || []).slice();

  function unitById(id) {
    return UNITS.find(function (u) { return u.id === id; }) || null;
  }

  /** The equipment ids a set of units contributes. */
  function unitsEquipment(unitIds) {
    const out = Object.create(null);
    (unitIds || []).forEach(function (id) {
      const u = unitById(id);
      if (!u) return;
      (u.stations || []).forEach(function (st) {
        if (STATION_EQUIP[st]) out[STATION_EQUIP[st]] = true;
      });
    });
    return out;
  }

  /** The union of stations across the chosen units. */
  function unitsStations(unitIds) {
    const out = Object.create(null);
    (unitIds || []).forEach(function (id) {
      const u = unitById(id);
      if (u) (u.stations || []).forEach(function (st) { out[st] = true; });
    });
    return out;
  }

  /** Can one of these stations perform this exercise? */
  function stationAllows(ex, stations) {
    for (const st in stations) {
      const re = STATION_MATCH[st];
      if (re && re.test(ex.id)) return true;
    }
    return false;
  }

  const ISOLATION = /isolation$/;

  /* ---------------------------------------------------------------------------
     SCORING A SUBSTITUTE
     ------------------------------------------------------------------------ */

  function primeMover(ex) {
    let best = null, bv = -1;
    const m = ex.muscles || {};
    for (const k in m) if (m[k] > bv) { bv = m[k]; best = k; }
    return best;
  }

  function primeGroup(ex) {
    const t = App.Muscles.groupTotals(App.Muscles.expand(ex.muscles || {}));
    let best = null, bv = -1;
    for (const g in t) if (t[g] > bv) { bv = t[g]; best = g; }
    return best;
  }

  /** Cosine similarity of two expanded muscle maps, 0..1. */
  function muscleSim(a, b) {
    const A = App.Muscles.expand(a.muscles || {});
    const B = App.Muscles.expand(b.muscles || {});
    let dot = 0, na = 0, nb = 0;
    for (const k in A) { na += A[k] * A[k]; if (B[k]) dot += A[k] * B[k]; }
    for (const k in B) nb += B[k] * B[k];
    return (na && nb) ? dot / Math.sqrt(na * nb) : 0;
  }

  function inFallback(fromPattern, toPattern) {
    const chain = FAMILY_FALLBACK[FAMILY[fromPattern]] || [];
    return chain.indexOf(FAMILY[toPattern]) >= 0;
  }

  function allowed(ex, opts) {
    if (!ex) return false;
    if (!opts.kit[ex.equipment]) return false;
    if (opts.excluded && opts.excluded[ex.id]) return false;
    /* Machine, cable and smith work that is only available because of a home
       unit has to be something that unit can actually do. */
    if (opts.restrict && opts.restrict[ex.equipment] &&
        !stationAllows(ex, opts.stations || {})) return false;
    return true;
  }

  /**
   * How good a stand-in `cand` is for `target`, 0..1. Zero means "not a
   * substitute at all" — an unrelated pattern is never a swap, however much
   * muscle overlap the numbers happen to show.
   */
  function substitutionScore(target, cand, opts) {
    if (!target || !cand || cand.id === target.id) return 0;
    if (!allowed(cand, opts)) return 0;

    let s = 0;
    if (cand.pattern === target.pattern) s += 0.40;
    else if (FAMILY[cand.pattern] === FAMILY[target.pattern]) s += 0.30;
    else if (inFallback(target.pattern, cand.pattern)) s += 0.12;
    else return 0;

    if (primeMover(cand) === primeMover(target)) s += 0.15;
    else if (primeGroup(cand) === primeGroup(target)) s += 0.08;

    s += 0.25 * muscleSim(target, cand);

    if (!!cand.unilateral === !!target.unilateral) s += 0.08;

    if (cand.equipment === target.equipment) s += 0.12;
    else if (LOAD_CLASS[cand.equipment] === LOAD_CLASS[target.equipment]) s += 0.08;
    else if (!!LOADABLE[cand.equipment] === !!LOADABLE[target.equipment]) s += 0.04;

    const pref = (PREFERRED[cand.pattern] || []).indexOf(cand.id);
    if (pref >= 0) s += 0.10 - Math.min(0.06, pref * 0.01);

    return Math.min(1, s);
  }

  /**
   * The best available stand-in, or null when the honest answer is that there
   * is not one. 0.55 is the line below which the "substitute" is a different
   * exercise wearing the same pattern.
   */
  function substitute(target, opts) {
    opts = normalise(opts);
    let best = null, bs = 0;
    App.Store.allExercises().forEach(function (ex) {
      const sc = substitutionScore(target, ex, opts);
      if (sc > bs) { bs = sc; best = ex; }
    });
    return bs >= 0.55 ? best : null;
  }

  /* ---------------------------------------------------------------------------
     FILLING A SLOT
     ------------------------------------------------------------------------ */

  function normalise(opts) {
    opts = opts || {};
    /* A kit arrives as a KITS id, a list of equipment ids, or an already-built
       map. Only the last one passes through — a string is truthy and is not an
       array, which is how a preset id once made it all the way through as the
       kit itself and left every slot unfillable. */
    const kit = (opts.kit && typeof opts.kit === 'object' && !Array.isArray(opts.kit))
      ? opts.kit : kitMap(opts.kit);
    return {
      kit: kit,
      excluded: opts.excluded || {},
      seeds: opts.seeds || [],
      variety: opts.variety || 0,
      stations: opts.stations || null,
      restrict: opts.restrict || null
    };
  }

  /** ['barbell','cable'] or a KIT id -> { barbell: true, cable: true }. */
  function kitMap(list) {
    if (typeof list === 'string') list = (KITS[list] || KITS.commercial).equip;
    const out = Object.create(null);
    (list || KITS.commercial.equip).forEach(function (k) { out[k] = true; });
    return out;
  }

  /** Everything in the library with this pattern that the kit can do. */
  function candidatesFor(pattern, opts) {
    return App.Store.allExercises().filter(function (ex) {
      return ex.pattern === pattern && allowed(ex, opts);
    });
  }

  /**
   * Choose the movement for one slot.
   *
   * Order of preference, and the reasoning for it:
   *   1. something the lifter ALREADY does for this pattern — it is in their
   *      base workout, so it is a movement they own, can load, and will not
   *      have to look up
   *   2. the shortlist for the pattern, in order
   *   3. anything else in the pattern, most similar to what they already do
   *   4. the fallback families, with a warning, because a slot silently
   *      dropped reads as a bug
   */
  function pickForSlot(pattern, opts, used, warnings) {
    const seedIds = Object.create(null);
    opts.seeds.forEach(function (ex) { if (ex) seedIds[ex.id] = true; });

    function best(list, allowUsed) {
      let bestEx = null, bestScore = -1;
      list.forEach(function (ex) {
        if (!allowUsed && used[ex.id]) return;
        let sc = 0;
        if (seedIds[ex.id]) sc += 1.2;
        /* Already used on an earlier day of this phase. Not banned — on a
           four-day week the second upper day SHOULD be able to bench again if
           nothing else fits — but pushed down far enough that the next choice
           on the shortlist wins when there is one. Without this, upper/lower
           produced two identical upper days. */
        sc -= 1.5 * ((opts.phaseUsed && opts.phaseUsed[ex.id]) || 0);
        const pi = (PREFERRED[ex.pattern] || []).indexOf(ex.id);
        if (pi >= 0) sc += 1 - Math.min(0.9, pi * 0.08);
        let sim = 0;
        opts.seeds.forEach(function (s) { sim = Math.max(sim, muscleSim(s, ex)); });
        sc += 0.6 * sim;
        /* Variety pushes the choice down the shortlist rather than randomising
           it — the library has 49 biceps curls, most of them the same curl. */
        if (opts.variety) sc += opts.variety * (0.5 - Math.random());
        if (sc > bestScore) { bestScore = sc; bestEx = ex; }
      });
      return bestEx;
    }

    const direct = candidatesFor(pattern, opts);
    let pick = best(direct, false) || best(direct, true);
    if (pick) return pick;

    /* Nothing in the pattern. Try the family, then the declared fallbacks. */
    const fam = FAMILY[pattern];
    const sameFamily = App.Store.allExercises().filter(function (ex) {
      return FAMILY[ex.pattern] === fam && ex.pattern !== pattern && allowed(ex, opts);
    });
    pick = best(sameFamily, false) || best(sameFamily, true);
    if (pick) return pick;

    const chain = FAMILY_FALLBACK[fam] || [];
    for (let i = 0; i < chain.length; i++) {
      const alt = App.Store.allExercises().filter(function (ex) {
        return FAMILY[ex.pattern] === chain[i] && allowed(ex, opts);
      });
      pick = best(alt, false) || best(alt, true);
      if (pick) {
        warnings.push('Your equipment has no ' + patternLabel(pattern) +
          ', so ' + pick.name + ' stands in for it. That is a real gap, not a ' +
          'preference — see the note below.');
        return pick;
      }
    }
    warnings.push('Nothing in your equipment covers ' + patternLabel(pattern) +
      ', so that slot is empty.');
    return null;
  }

  function patternLabel(p) {
    return String(p).replace(/-/g, ' ');
  }

  /* ---------------------------------------------------------------------------
     PRESCRIBING SETS

     Weight comes from the lifter's own reference 1RM for that movement, run
     through the library's rep curve and then discounted for the reps they mean
     to leave in reserve. With no history there is no honest number, so the
     weight is left at zero for them to fill in — a made-up starting weight is
     the one thing a training app must not do.
     ------------------------------------------------------------------------ */

  /* How a known load carries across to a different way of loading. A stand-in
     for a barbell bench done with dumbbells is per hand and roughly 40% of
     the bar; a cable stack reads low against free weight; a guided machine
     reads about the same. These are starting points for a first session, and
     the log corrects them from the second. */
  const CLASS_FACTOR = {
    'free>free': 1, 'free>guided': 1.05, 'free>cable': 0.7, 'free>elastic': 0,
    'guided>free': 0.9, 'guided>guided': 1, 'guided>cable': 0.65,
    'cable>free': 1.2, 'cable>guided': 1.3, 'cable>cable': 1
  };

  /**
   * A reference 1RM for a movement the lifter has never logged, taken from
   * the closest movement they HAVE logged — closest by the same scoring the
   * substitution uses, so a dumbbell incline press borrows from the barbell
   * incline before it borrows from anything else. Returns 0 when nothing is
   * close enough to be an honest guess.
   */
  function inferOneRM(ex, seeds) {
    let best = null, bs = 0;
    (seeds || []).forEach(function (seed) {
      if (!seed || seed.id === ex.id) return;
      const ref = App.Store.referenceOneRM(seed.id);
      if (!(ref > 0)) return;
      const sc = substitutionScore(seed, ex, { kit: kitMap(null), excluded: {} });
      if (sc > bs) { bs = sc; best = { seed: seed, ref: ref }; }
    });
    /* The same line the substitution itself draws. Below it the "closest" movement
       is in a different pattern, and a press guessed from a different press was
       coming out a third too heavy. Blank is better than that. */
    if (!best || bs < 0.55) return 0;
    if (LOAD_CLASS[ex.equipment] === 'bodyweight') return 0;
    let f = CLASS_FACTOR[LOAD_CLASS[best.seed.equipment] + '>' + LOAD_CLASS[ex.equipment]];
    if (f === undefined) f = 0.8;
    /* A barbell load moved to a pair of dumbbells is per hand. */
    if (best.seed.equipment !== 'dumbbell' && ex.equipment === 'dumbbell') f *= 0.42;
    if (best.seed.equipment === 'dumbbell' && ex.equipment !== 'dumbbell') f *= 2.2;
    /* A little conservative: the first session of a new movement is for
       learning it, not for testing it. */
    return best.ref * f * 0.92;
  }

  function prescribe(ex, block, opts) {
    const iso = ISOLATION.test(ex.pattern || '');
    let sets = iso ? block.isoSets : block.sets;
    let reps = iso ? block.isoReps : block.reps;

    /* Nothing to micro-load: chase reps instead of plates. Capped, because
       the arithmetic taken literally prescribed seventeen pull-ups, and a
       target nobody can hit is not a prescription. */
    if (!LOADABLE[ex.equipment]) reps = Math.min(15, reps + 5);
    /* A band's resistance curve is wrong at the bottom, so its low-rep work is
       not the same exercise it is at ten. */
    if (LOAD_CLASS[ex.equipment] === 'elastic' && reps < 8) reps = 12;

    let weight = 0;
    let ref = App.Store.referenceOneRM ? App.Store.referenceOneRM(ex.id) : 0;
    if (!(ref > 0)) ref = inferOneRM(ex, opts.seeds);
    if (ref > 0) {
      const raw = App.Science.loadForReps(ref, reps, ex);
      const mult = RIR_MULT[Math.min(RIR_MULT.length - 1, Math.max(0, block.rir))];
      weight = Math.round(raw * mult * 2) / 2;
      /* A per-hand dumbbell entry is half of what the body moved. */
      if (ex.equipment === 'dumbbell' &&
          (opts.settings || {}).dumbbellLoad !== 'total') weight = Math.round(weight / 2 * 2) / 2;
    }

    const out = [];
    for (let i = 0; i < sets; i++) out.push({ weight: weight, reps: reps });
    return out;
  }

  /* ---------------------------------------------------------------------------
     THE GENERATOR
     ------------------------------------------------------------------------ */

  /** Which split fits this many days, preferring the ones with 2x frequency. */
  function splitFor(days, wanted) {
    if (wanted && SPLITS[wanted]) return wanted;
    if (days <= 3) return days === 3 ? 'full-body' : 'full-body';
    if (days === 4) return 'upper-lower';
    if (days === 5) return 'ppl-ul';
    return 'push-pull-legs';
  }

  /**
   * Write a whole program.
   *
   * @param {Object} opts
   *   base          a PROGRAM to seed movement choices and loads from, or null
   *   units         ids of home units (see UNITS); their stations feed the kit
   *   repeat        true for a permanent rotation, false to run once and report
   *   name          program name
   *   daysPerWeek   2..6
   *   splitId       optional, else chosen from daysPerWeek
   *   kit           equipment id list, or a KITS key
   *   excluded      { exerciseId: true }
   *   blocks        ordered block ids, default hypertrophy/strength/deload
   *   rotateEvery   number, rotateUnit 'days'|'weeks'|'months'
   *   variety       0..1
   * @returns {Object} { program, workouts, warnings } — nothing is saved
   */
  function generate(opts) {
    opts = opts || {};
    const days = Math.max(2, Math.min(6, Number(opts.daysPerWeek) || 4));
    const splitId = splitFor(days, opts.splitId);
    const split = SPLITS[splitId];
    const blockIds = (opts.blocks && opts.blocks.length)
      ? opts.blocks : ['hypertrophy', 'strength', 'deload'];
    const warnings = [];

    /* Seeds: every movement in the base program, once. */
    const seedIds = Object.create(null);
    (((opts.base || {}).phases) || []).forEach(function (ph) {
      (ph.workoutIds || []).forEach(function (wid) {
        const w = App.Store.getWorkout(wid);
        (w ? w.items : []).forEach(function (it) { seedIds[it.exerciseId] = true; });
      });
    });
    /* And, failing a base, everything the lifter has ever logged — that is
       what their weights are known for. */
    if (!Object.keys(seedIds).length) {
      App.Store.allSessions().forEach(function (s) {
        (s.entries || []).forEach(function (en) { seedIds[en.exerciseId] = true; });
      });
    }

    /* Home units add their stations' equipment to the kit — restricted to
       what the stations can do, unless the same equipment was ticked as
       generally available. */
    const baseKit = kitMap(opts.kit);
    const fromUnits = unitsEquipment(opts.units);
    const restrict = Object.create(null);
    for (const k in fromUnits) {
      if (!baseKit[k]) { baseKit[k] = true; restrict[k] = true; }
    }

    const pick = normalise({
      kit: baseKit,
      excluded: opts.excluded,
      variety: opts.variety,
      stations: unitsStations(opts.units),
      restrict: Object.keys(restrict).length ? restrict : null,
      seeds: Object.keys(seedIds).map(function (id) {
        return App.Store.getExercise(id);
      }).filter(Boolean)
    });
    pick.settings = opts.settings || (App.Store.getSettings ? App.Store.getSettings() : {});

    if (!pick.kit.bodyweight && !pick.kit.cable && !pick.kit.machine && !pick.kit.band) {
      warnings.push('With bodyweight off and no cable, machine or band, there is no ' +
        'vertical pull in the library that you can do. Rows and lat isolation ' +
        'cover as much of it as anything can, but the overhead pulling is genuinely ' +
        'missing rather than substituted.');
    }

    const perDay = SLOTS_PER_DAY[days] || 6;
    const seq = split.seq.slice(0, days);
    const workouts = [];
    const phases = [];

    blockIds.forEach(function (blockId, bi) {
      const block = BLOCKS[blockId] || BLOCKS.hypertrophy;
      const ids = [];

      /* Counts across the whole phase, so a repeated day template varies. */
      const phaseUsed = Object.create(null);

      seq.forEach(function (dayKey, di) {
        const tpl = DAY_TEMPLATES[dayKey];
        const used = Object.create(null);
        const items = [];
        /* A deload is the same movements with the accessories dropped, not a
           different workout — the point is less work, not new work. */
        const wanted = block.compoundsOnly
          ? tpl.slots.filter(function (p) { return !ISOLATION.test(p) && p !== 'core'; })
          : tpl.slots;

        wanted.slice(0, perDay).forEach(function (pattern) {
          /* Later blocks nudge the choice along the shortlist so a program is
             not the identical session for twelve weeks. */
          const slotOpts = Object.assign({}, pick, {
            variety: (pick.variety || 0) + (bi > 0 ? 0.25 * bi : 0),
            phaseUsed: phaseUsed
          });
          const ex = pickForSlot(pattern, slotOpts, used, warnings);
          if (!ex) return;
          used[ex.id] = true;
          phaseUsed[ex.id] = (phaseUsed[ex.id] || 0) + 1;
          items.push({
            exerciseId: ex.id,
            sets: prescribe(ex, block, pick),
            restSets: block.restSets,
            restAfter: block.restAfter,
            note: patternLabel(pattern) + (ex.unilateral ? ' · per side' : '')
          });
        });

        workouts.push({
          _key: blockId + ':' + di,
          name: (opts.name || 'Program') + ' · ' + block.name + ' · ' + tpl.name +
            (seq.filter(function (k) { return k === dayKey; }).length > 1
              ? ' ' + (seq.slice(0, di + 1).filter(function (k) { return k === dayKey; }).length)
              : ''),
          notes: block.hint,
          items: items
        });
        ids.push(blockId + ':' + di);
      });

      phases.push({
        id: U.uid('ph'),
        blockId: blockId,
        name: block.name,
        hint: block.hint,
        weeks: block.weeks,
        workoutKeys: ids
      });
    });

    /* De-duplicate the warnings: one missing pattern reported once per program,
       not once per day per block. */
    const seen = Object.create(null);
    const uniq = warnings.filter(function (w) {
      if (seen[w]) return false;
      seen[w] = true;
      return true;
    });

    return {
      program: {
        name: opts.name || 'Generated program',
        splitId: splitId,
        daysPerWeek: days,
        rotateEvery: Number(opts.rotateEvery) || 4,
        rotateUnit: opts.rotateUnit || 'weeks',
        startDate: opts.startDate || U.today(),
        kit: Object.keys(pick.kit),
        units: opts.units || [],
        allowBodyweight: !!pick.kit.bodyweight,
        repeat: opts.repeat !== false,
        phases: phases,
        generated: true
      },
      workouts: workouts,
      warnings: uniq
    };
  }

  /* ---------------------------------------------------------------------------
     ROTATION

     Which phase is live is a function of the calendar, not of anything the app
     has to keep up to date. Miss a week and the phase is a week further along,
     which is what actually happened.
     ------------------------------------------------------------------------ */

  function periodDays(program) {
    const n = Math.max(1, Number(program.rotateEvery) || 1);
    if (program.rotateUnit === 'days') return n;
    if (program.rotateUnit === 'months') return Math.round(n * 30.44);
    return n * 7;
  }

  /** How many whole periods have elapsed, and which phase that lands on. */
  function activePhase(program, dateISO) {
    const phases = (program && program.phases) || [];
    if (!phases.length) return null;
    const start = new Date((program.startDate || U.today()) + 'T12:00:00').getTime();
    const now = new Date((dateISO || U.today()) + 'T12:00:00').getTime();
    const per = periodDays(program);
    const elapsed = Math.floor((now - start) / 86400000);
    const total = per * phases.length;
    /* A program that is not permanent runs its phases once and is then
       finished — it does not wrap round to the first phase again. */
    if (program.repeat === false && elapsed >= total) {
      return {
        complete: true, index: phases.length - 1, phase: phases[phases.length - 1],
        dayOfPhase: per, daysLeft: 0, periodDays: per, week: Math.ceil(per / 7) - 1,
        next: null, cycle: 0
      };
    }
    const idx = elapsed < 0 ? 0 : Math.floor(elapsed / per) % phases.length;
    const intoPeriod = elapsed < 0 ? 0 : elapsed % per;
    return {
      complete: false,
      index: idx,
      phase: phases[idx],
      dayOfPhase: intoPeriod + 1,
      daysLeft: per - intoPeriod,
      periodDays: per,
      week: Math.floor(intoPeriod / 7),
      cycle: elapsed < 0 ? 0 : Math.floor(elapsed / total),
      next: phases[(idx + 1) % phases.length]
    };
  }

  /* ---------------------------------------------------------------------------
     PROGRESSION

     A phase is not the same session for four weeks. Each week into it the
     load goes up a step on anything that can be loaded, reps go up on
     anything that cannot, and a hypertrophy block adds a set from its third
     week. These are the ACSM's own numbers — 2-10% once the target reps are
     being beaten — at the cautious end, because a program that asks for too
     much in week three is one the lifter stops following in week three.
     ------------------------------------------------------------------------ */

  const PROGRESSION = {
    hypertrophy: { weightPct: 2.5, repsEvery: 0, setFromWeek: 2 },
    strength:    { weightPct: 2.5, repsEvery: 0, setFromWeek: 0 },
    metabolite:  { weightPct: 0,   repsEvery: 1, setFromWeek: 0 },
    deload:      { weightPct: 0,   repsEvery: 0, setFromWeek: 0 }
  };

  /** Which program and phase a workout belongs to, if any. */
  function membership(workoutId) {
    const programs = App.Store.allPrograms ? App.Store.allPrograms() : [];
    for (let i = 0; i < programs.length; i++) {
      const phases = programs[i].phases || [];
      for (let j = 0; j < phases.length; j++) {
        if ((phases[j].workoutIds || []).indexOf(workoutId) >= 0) {
          return { program: programs[i], phaseIndex: j, phase: phases[j] };
        }
      }
    }
    return null;
  }

  /**
   * What this week of the program asks for on top of the plan.
   * @returns {Object|null} {program, phase, week, weightMul, extraReps, extraSets, label}
   */
  function progressionFor(workoutId, dateISO) {
    const m = membership(workoutId);
    if (!m) return null;
    const live = activePhase(m.program, dateISO);
    /* Running a workout from a phase that is not the live one — allowed, and
       it simply gets the plan as written. */
    const inLive = live && live.index === m.phaseIndex && !live.complete;
    const week = inLive ? live.week : 0;
    const rule = PROGRESSION[m.phase.blockId] || PROGRESSION.hypertrophy;
    const weightMul = 1 + (rule.weightPct / 100) * week;
    const extraReps = rule.repsEvery ? Math.floor(week / rule.repsEvery) : 0;
    const extraSets = rule.setFromWeek && week >= rule.setFromWeek ? 1 : 0;
    const bits = [];
    if (week > 0 && rule.weightPct) bits.push('+' + Math.round((weightMul - 1) * 100) + '% load');
    if (extraReps) bits.push('+' + extraReps + ' rep' + (extraReps === 1 ? '' : 's'));
    if (extraSets) bits.push('+1 set');
    return {
      program: m.program, phase: m.phase, phaseIndex: m.phaseIndex, live: inLive,
      week: week, weightMul: weightMul, extraReps: extraReps, extraSets: extraSets,
      label: m.phase.name + ' · week ' + (week + 1) +
        (bits.length ? ' · ' + bits.join(', ') : ' · as planned')
    };
  }

  /** The plan's sets for one item, with this week's progression applied. */
  function progressSets(item, ex, prog) {
    const base = (item.sets || []).map(function (s) {
      return { weight: Number(s.weight) || 0, reps: Number(s.reps) || 0 };
    });
    if (!prog || !base.length) return base;
    const loadable = ex && LOADABLE[ex.equipment];
    const out = base.map(function (s) {
      const w = s.weight > 0 && loadable ? Math.round(s.weight * prog.weightMul * 2) / 2 : s.weight;
      /* Not loadable: the load step becomes reps instead. */
      const r = s.reps + prog.extraReps + (!loadable && prog.weightMul > 1
        ? Math.round((prog.weightMul - 1) * 40) : 0);
      return { weight: w, reps: r };
    });
    for (let i = 0; i < prog.extraSets; i++) out.push(Object.assign({}, out[out.length - 1]));
    return out;
  }

  /* ---------------------------------------------------------------------------
     THE REPORT

     Did you keep to it? Two questions per phase, and no more, because a
     program report that runs to a page is not read: how many of the planned
     sessions happened, and did the load move the way the plan asked. Both are
     read straight from the log against the phase's own window.
     ------------------------------------------------------------------------ */

  function report(program, dateISO) {
    const phases = program.phases || [];
    const per = periodDays(program);
    const start = new Date((program.startDate || U.today()) + 'T12:00:00').getTime();
    const now = new Date((dateISO || U.today()) + 'T12:00:00').getTime();
    const live = activePhase(program, dateISO);
    const total = per * phases.length;
    const elapsed = Math.floor((now - start) / 86400000);
    /* Report on the most recent cycle that has started. */
    const cycle = program.repeat === false ? 0
      : Math.max(0, Math.floor(Math.min(elapsed, total * 1000) / total));
    const sessions = App.Store.allSessions();

    const rows = phases.map(function (ph, i) {
      const from = start + (cycle * total + i * per) * 86400000;
      const to = from + per * 86400000;
      const ids = ph.workoutIds || [];
      const inWin = sessions.filter(function (s) {
        const t = new Date(s.date + 'T12:00:00').getTime();
        return ids.indexOf(s.workoutId) >= 0 && t >= from && t < to;
      });
      const daysRun = Math.max(0, Math.min(per, Math.floor((Math.min(now, to) - from) / 86400000) + 1));
      const expected = ids.length * (per / 7);
      const expectedSoFar = ids.length * (daysRun / 7);
      const started = now >= from;

      /* Load: first versus last e1RM per movement inside the window. */
      const firstBy = Object.create(null), lastBy = Object.create(null);
      inWin.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })
        .forEach(function (s) {
          (s.entries || []).forEach(function (en) {
            const one = App.Ranks.bestE1RM(en.sets, App.Store.getExercise(en.exerciseId));
            if (!one) return;
            if (!firstBy[en.exerciseId]) firstBy[en.exerciseId] = one;
            lastBy[en.exerciseId] = one;
          });
        });
      let gain = 0, n = 0;
      for (const id in firstBy) {
        if (firstBy[id] > 0 && lastBy[id]) { gain += (lastBy[id] / firstBy[id] - 1) * 100; n++; }
      }
      /* What the progression asked for over the phase. */
      const rule = PROGRESSION[ph.blockId] || PROGRESSION.hypertrophy;
      const asked = rule.weightPct * Math.max(0, Math.ceil(per / 7) - 1);

      return {
        name: ph.name, blockId: ph.blockId, started: started,
        from: new Date(from).toISOString().slice(0, 10),
        to: new Date(to - 1).toISOString().slice(0, 10),
        done: inWin.length,
        expected: Math.round(expected * 10) / 10,
        expectedSoFar: Math.round(expectedSoFar * 10) / 10,
        adherence: expectedSoFar > 0 ? Math.min(1, inWin.length / expectedSoFar) : 0,
        gainPct: n ? gain / n : null,
        askedPct: asked,
        movements: n
      };
    });

    const startedRows = rows.filter(function (r) { return r.started; });
    const adherence = startedRows.length
      ? startedRows.reduce(function (a, r) { return a + r.adherence; }, 0) / startedRows.length
      : 0;
    let verdict;
    if (!startedRows.length) verdict = 'Not started yet.';
    else if (adherence >= 0.9) verdict = 'You kept to it.';
    else if (adherence >= 0.7) verdict = 'Mostly kept to it — a session or two short.';
    else if (adherence >= 0.4) verdict = 'About half of the planned sessions happened.';
    else verdict = 'The plan and the log went separate ways.';

    return {
      complete: !!(live && live.complete),
      cycle: cycle,
      adherence: adherence,
      verdict: verdict,
      rows: rows
    };
  }

  App.Programs = {
    KITS: KITS,
    SPLITS: SPLITS,
    BLOCKS: BLOCKS,
    DAY_TEMPLATES: DAY_TEMPLATES,
    PREFERRED: PREFERRED,
    FAMILY: FAMILY,
    LOAD_CLASS: LOAD_CLASS,
    kitMap: kitMap,
    splitFor: splitFor,
    candidatesFor: candidatesFor,
    substitute: substitute,
    substitutionScore: substitutionScore,
    muscleSim: muscleSim,
    generate: generate,
    activePhase: activePhase,
    periodDays: periodDays,
    membership: membership,
    progressionFor: progressionFor,
    progressSets: progressSets,
    report: report,
    inferOneRM: inferOneRM,
    UNITS: UNITS,
    STATION_EQUIP: STATION_EQUIP,
    unitsEquipment: unitsEquipment,
    unitsStations: unitsStations,
    stationAllows: stationAllows
  };
})(window.App = window.App || {});
