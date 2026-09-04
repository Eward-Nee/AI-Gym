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
      variety: opts.variety || 0
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
        sc -= 0.8 * ((opts.phaseUsed && opts.phaseUsed[ex.id]) || 0);
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
    const ref = App.Store.referenceOneRM ? App.Store.referenceOneRM(ex.id) : 0;
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
   *   base          a workout to seed the movement choices from, or null
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

    const pick = normalise({
      kit: opts.kit,
      excluded: opts.excluded,
      variety: opts.variety,
      seeds: (((opts.base || {}).items) || []).map(function (it) {
        return App.Store.getExercise(it.exerciseId);
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
        allowBodyweight: !!pick.kit.bodyweight,
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
    const idx = elapsed < 0 ? 0 : Math.floor(elapsed / per) % phases.length;
    const intoPeriod = elapsed < 0 ? 0 : elapsed % per;
    return {
      index: idx,
      phase: phases[idx],
      dayOfPhase: intoPeriod + 1,
      daysLeft: per - intoPeriod,
      periodDays: per,
      next: phases[(idx + 1) % phases.length]
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
    periodDays: periodDays
  };
})(window.App = window.App || {});
