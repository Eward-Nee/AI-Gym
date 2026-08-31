/* =============================================================================
   science.js — the training-science layer

   Everything above this file used to carry its own folk wisdom: a 1RM formula
   from 1985, a "3 to 15 reps is the productive band" rule of thumb, and a
   weekly set target with no notion of how those sets were spread. This file
   replaces the folklore with the published dose-response curves, in one place,
   with the numbers they came from written down next to them.

   Four questions, four answers, and the sources for each.

   ---------------------------------------------------------------------------
   1. HOW MANY REPS CAN YOU DO AT A GIVEN FRACTION OF YOUR 1RM?

   Nuzzo, Pinto, Nosaka & Steele (2024), *Maximal Number of Repetitions at
   Percentages of the One Repetition Maximum*, Sports Medicine 54:303-321 —
   a meta-regression of 952 reps-to-failure tests by 7,289 people across 269
   studies, fitted with natural cubic splines.

   Two findings matter here, and both contradict what the app was doing:

     * PEOPLE DO MORE REPS THAN THE CLASSIC TABLES SAY. About 8 reps at 80%,
       15 at 70%, 5 at 90%. Epley and Brzycki were fitted to far smaller
       samples and, read backwards, they turn a long set into a 1RM that is too
       high — badly so past twenty reps, where Brzycki's linear denominator
       runs off a cliff. A set of thirty used to be scored as a 3.6x one-rep
       max. It is closer to 1.85x.

     * THE CURVE IS NOT THE SAME FOR EVERY MOVEMENT. The leg press allows
       markedly more reps than the bench press at every load: 13.1 vs 8.8 at
       80% 1RM, 19.0 vs 14.1 at 70%. The bench sits on top of the general
       model, so the paper publishes one general table plus a leg-press one,
       and so does this file.

   The spread between people is real and worth showing rather than hiding: the
   SD of reps at 80% 1RM is 2.51, rising to 4.36 at 60%.

   ---------------------------------------------------------------------------
   2. HOW CLOSE TO FAILURE DOES A SET HAVE TO BE?

   Robinson, Pelland, Remmert, Refalo, Jukic, Steele & Zourdos (2024),
   *Exploring the Dose-Response Relationship Between Estimated Resistance
   Training Proximity to Failure, Strength Gain, and Muscle Hypertrophy*,
   Sports Medicine 54:2209-2231.

   Strength gains are flat across a wide band of reps-in-reserve. Growth is
   not: it rises as sets end closer to failure, and the earlier meta-analysis
   from the same group (Refalo et al. 2023) puts the drop-off past roughly
   four or five reps in reserve.

   Which is why this file estimates RIR rather than asking for it. Given the
   curve above and a reference 1RM, a set's load says what its rep ceiling was,
   and the reps actually done say how far short of it the set stopped.

   ---------------------------------------------------------------------------
   3. HOW MUCH VOLUME, AND HOW MUCH OF IT IN ONE SESSION?

   Pelland, Remmert, Robinson, Hinson & Zourdos (2025), *The Resistance
   Training Dose Response*, Sports Medicine — 67 studies, 2,058 participants.
   Hypertrophy keeps rising with weekly sets (posterior probability of a
   positive slope: 100%) with diminishing returns, at roughly 0.24% extra
   growth per additional set around twelve weekly sets.

   Remmert et al. (2025), *Is There Too Much of a Good Thing?* — the same
   question asked per session. The point past which another set in the SAME
   session no longer buys a detectable difference is about ELEVEN fractional
   sets for hypertrophy.

   ---------------------------------------------------------------------------
   4. SO HOW OFTEN SHOULD A MUSCLE BE TRAINED?

   This is the question people ask, and the honest answer is that frequency is
   not a requirement in its own right.

   Schoenfeld, Grgic & Krieger (2019), *How many times per week should a muscle
   be trained to maximize muscle hypertrophy?*, J Sports Sci 37:1286-1295, and
   the Pelland 2025 dose-response above, agree: with weekly volume held equal,
   frequency has no clear independent effect on growth. It does have one on
   strength, with diminishing returns. Schoenfeld's earlier 2016 meta-analysis
   found twice a week beating once, and the reason is visible in point 3 rather
   than in frequency itself — a week's volume crammed into one session runs
   past the per-session ceiling, and the sets past it stop paying.

   So this file does NOT hand out a frequency target and score you against it.
   It applies the per-session saturation the research actually found, and lets
   the frequency recommendation fall out of it: spread the volume, because the
   eleventh set of a session is worth a third of the first, and the same set on
   another day is worth all of it.
   ============================================================================= */
(function (App) {
  'use strict';

  /* ---------------------------------------------------------------------------
     THE REPS ~ %1RM CURVE

     An anchor table rather than a formula. Nuzzo's model is a natural cubic
     spline; no closed form of it was published, and inventing one would be
     pretending to a precision the paper does not claim. The anchors below are
     read off the published estimates — 5 reps at 90%, 8 at 80%, about 12 at
     75%, 15 at 70% — and interpolated between, which reproduces the paper's
     table to well inside its own confidence intervals.

     Stored as reps -> %1RM, because that is the direction the app asks in:
     someone logs a set and wants to know what it was worth.
     ------------------------------------------------------------------------ */

  const GENERAL_CURVE = [
    /* reps, %1RM */
    [1, 100], [2, 97], [3, 94.5], [4, 92.2], [5, 90], [6, 86.7], [7, 83.3],
    [8, 80], [9, 78.4], [10, 77], [11, 75.7], [12, 74.5], [13, 73.2],
    [14, 71.6], [15, 70], [17, 67.4], [19, 64.9], [22, 61.5], [25, 58.5],
    [30, 54.5], [35, 51.2], [40, 48.2], [50, 43.5], [60, 39.8]
  ];

  /* The leg-press table, built to pass through the paper's two published
     estimates for it — 13.1 reps at 80% 1RM and 19.0 at 70% — and through the
     one point every curve has to pass through, a single at 100%.

     It is a second table rather than a constant offset on the first, because
     an offset cannot do the ends. Seven points of 1RM added to a five-rep set
     puts it at 97% of a max, which would make a 5RM leg press all but a
     single; the curves have to converge as the load approaches 1RM, and only
     separate tables do that. */
  const LEG_CURVE = [
    [1, 100], [2, 97.5], [3, 95.6], [4, 94], [5, 92.5], [6, 91], [7, 89.6],
    [8, 88.2], [10, 85.3], [12, 82], [14, 78.5], [16, 75], [19, 70],
    [22, 66], [26, 61.5], [30, 58], [36, 53.5], [42, 49.8], [50, 45.5],
    [60, 41]
  ];

  /* Past sixty reps the studies run out. Each curve is extended by a gentle
     decay from its last row rather than being cut off, so a set of a hundred
     bodyweight calf raises lands somewhere sane instead of on the last knot. */
  const TAIL_REPS = 60, TAIL_DECAY = 0.0045;

  /* ---------------------------------------------------------------------------
     WHICH CURVE A MOVEMENT USES

     The paper is explicit that the general table applies to everything except
     the two exercises it modelled separately, and that sex, age and training
     status barely move it. So there are exactly two profiles here, not a
     speculative one per pattern.

     'legs' is the leg-press curve. It is applied to the lower-body movements
     that share the leg press's character — supported, machine-guided, and
     limited by the muscle rather than by how long you can hold a bar on your
     back. A free-weight back squat is NOT one of those, and there are no
     grounds in the paper for moving it off the general curve, so it stays
     there.
     ------------------------------------------------------------------------ */

  const LEG_PATTERNS = {
    'quad-isolation': true,
    'ham-isolation': true,
    'glute-isolation': true,
    'leg-isolation': true,
    'calf-isolation': true
  };

  /* Squat and lunge patterns join the leg-press curve only when the implement
     takes the stabilising away — a hack squat or a sled leg press does, a
     barbell does not. */
  const SUPPORTED_EQUIPMENT = { machine: true, sled: true, smith: true };

  const PROFILES = {
    general: { id: 'general', label: 'General', curve: GENERAL_CURVE },
    legs: { id: 'legs', label: 'Leg press', curve: LEG_CURVE }
  };

  /**
   * The REPS ~ %1RM profile for a movement.
   * @param {Object} exercise
   * @returns {{id: string, label: string, curve: Array}}
   */
  function profileFor(exercise) {
    if (!exercise) return PROFILES.general;
    const p = exercise.pattern;
    if (LEG_PATTERNS[p]) return PROFILES.legs;
    if ((p === 'squat' || p === 'lunge') &&
        SUPPORTED_EQUIPMENT[exercise.equipment]) return PROFILES.legs;
    return PROFILES.general;
  }

  /**
   * What fraction of a 1RM a set of `reps` to failure represents, as a
   * percentage.
   *
   * @param {number} reps
   * @param {Object} [profile]  from profileFor(); defaults to general
   * @returns {number} 0-100
   */
  function percentForReps(reps, profile) {
    reps = Math.max(1, Number(reps) || 1);
    const curve = ((profile && profile.curve) || GENERAL_CURVE);
    const last = curve[curve.length - 1];
    if (reps >= TAIL_REPS) {
      return last[1] * Math.exp(-TAIL_DECAY * (reps - last[0]));
    }
    for (let i = 1; i < curve.length; i++) {
      if (reps <= curve[i][0]) {
        const a = curve[i - 1], b = curve[i];
        return a[1] + ((reps - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
      }
    }
    return last[1];
  }

  /**
   * The inverse: how many reps to failure a given fraction of a 1RM allows.
   *
   * Solved by walking the curve rather than inverting it, because the profile
   * offset is itself a function of reps and the closed form is not worth the
   * trouble for a table this small.
   *
   * @param {number} pct  percentage of 1RM
   * @param {Object} [profile]
   * @returns {number} reps, fractional
   */
  function repsAtPercent(pct, profile) {
    pct = Number(pct) || 0;
    if (pct >= 100) return 1;
    if (pct <= 0) return 200;
    let lo = 1, hi = 200;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (percentForReps(mid, profile) > pct) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /**
   * The between-person spread in reps at a given load, from the paper's linear
   * SD model: 2.51 reps at 80% 1RM, 4.36 at 60%.
   *
   * Shown rather than swallowed. Two people with the same 1RM genuinely differ
   * by a couple of reps at the same weight, and a rep target presented without
   * that is a false precision.
   */
  function repsSD(pct) {
    return Math.max(0.8, 2.51 + (80 - (Number(pct) || 0)) * 0.0925);
  }

  /* ---------------------------------------------------------------------------
     1RM ESTIMATION

     The same curve, read the other way. This is what replaces Epley/Brzycki.
     ------------------------------------------------------------------------ */

  /**
   * Estimated one-rep max from a set taken to (or near) failure.
   *
   * @param {number} weight    load on the body, in the log's own units
   * @param {number} reps
   * @param {Object} [exercise] picks the curve; omitted means the general one
   * @returns {number}
   */
  function e1rm(weight, reps, exercise) {
    weight = Number(weight) || 0;
    reps = Math.max(1, Math.round(Number(reps) || 0));
    if (!weight) return 0;
    if (reps === 1) return weight;
    const pct = percentForReps(reps, profileFor(exercise));
    return pct > 0 ? weight * (100 / pct) : weight;
  }

  /**
   * The load that should allow exactly `reps` to failure, given a 1RM. The
   * direction a lifter actually plans in: "I want eights, what do I put on?"
   */
  function loadForReps(oneRM, reps, exercise) {
    oneRM = Number(oneRM) || 0;
    if (!oneRM) return 0;
    return oneRM * percentForReps(reps, profileFor(exercise)) / 100;
  }

  /* ---------------------------------------------------------------------------
     PROXIMITY TO FAILURE
     ------------------------------------------------------------------------ */

  /**
   * Estimated reps in reserve for a logged set.
   *
   * `reference` is the lifter's best estimated 1RM for the movement, which is
   * the only honest yardstick available — a set is close to failure relative
   * to what THIS person can do, not to a world record.
   *
   * @returns {{rir: number, pct: number, ceiling: number, sd: number}|null}
   */
  function proximity(load, reps, reference, exercise) {
    load = Number(load) || 0;
    reps = Number(reps) || 0;
    reference = Number(reference) || 0;
    if (load <= 0 || reps <= 0 || reference <= 0) return null;
    const pct = Math.min(140, (load / reference) * 100);
    const ceiling = repsAtPercent(pct, profileFor(exercise));
    return {
      pct: pct,
      ceiling: ceiling,
      rir: Math.max(0, ceiling - reps),
      sd: repsSD(pct)
    };
  }

  /**
   * What a set is worth for growth, given how far short of failure it stopped.
   *
   * Centred so that a set with a couple of reps left — the ordinary working
   * set, which is what most logs are full of — scores 1.0. Failure earns more,
   * and stopping five or more short earns markedly less, which is where the
   * meta-regression puts the drop-off.
   *
   * @param {number} rir
   * @returns {number} roughly 0.7 - 1.25
   */
  function effortFactor(rir) {
    if (!(rir >= 0)) return 1;
    if (rir <= 0) return 1.25;
    if (rir >= 5) return 0.7;
    /* 0 -> 1.25, 2.5 -> 1.0, 5 -> 0.7 */
    return rir <= 2.5 ? 1.25 - 0.1 * rir : 1.0 - 0.12 * (rir - 2.5);
  }

  /**
   * What a set is worth for growth, given how long it was.
   *
   * Schoenfeld, Grgic & Krieger (2017), *Strength and Hypertrophy Adaptations
   * Between Low- vs. High-Load Resistance Training*, JSCR 31:3508-3523: taken
   * near failure, growth is much the same anywhere above roughly 30% of 1RM.
   * The old three-to-fifteen band was a strength heuristic wearing a growth
   * hat, and it docked a hard set of twenty for no reason the evidence
   * supports.
   *
   * What survives is the bottom end. Singles and doubles are a strength
   * stimulus with little time under load, and very long sets are limited by
   * breathing and burn before the muscle is, so both taper.
   */
  function repFactor(reps) {
    reps = Number(reps) || 0;
    if (reps <= 0) return 0;
    if (reps < 5) return 0.7 + 0.075 * (reps - 1);
    if (reps <= 30) return 1;
    return Math.max(0.8, 1 - (reps - 30) * 0.008);
  }

  /* ---------------------------------------------------------------------------
     VOLUME: PER WEEK, AND PER SESSION
     ------------------------------------------------------------------------ */

  /** The weekly hard-set target the figures are scored against, per muscle. */
  const WEEKLY_SETS = 12;

  /** Where another set in the same session stops buying anything detectable. */
  const SESSION_PUOS = 11;

  /** Below this a session is not counted as having trained the muscle at all. */
  const SESSION_TOUCH = 0.5;

  /**
   * What the n-th hard set for one muscle in ONE session is worth.
   *
   * Full credit early, then a decline that has the eleventh set — the point of
   * undetectable superiority — worth about a third of the first, with a floor
   * rather than a zero, because "no longer detectably better" is not "worth
   * nothing".
   *
   * This is the whole of the app's frequency model. Nothing rewards training a
   * muscle on more days directly; a second day is simply a second session's
   * worth of full-credit sets, which is exactly the mechanism the volume-
   * equated frequency trials keep finding.
   *
   * @param {number} n  1-based position within the session, may be fractional
   */
  function sessionMarginal(n) {
    if (n <= 6) return 1;
    return Math.max(0.25, 1 - 0.13 * (n - 6));
  }

  /**
   * The integral of the above: what `x` hard sets for one muscle in a single
   * session are worth in total.
   *
   * Integrated rather than summed because a set's contribution is fractional —
   * a bench press is one set for the chest and a third of one for the triceps
   * — so the "n-th set" is rarely a whole number.
   */
  function sessionCredit(x) {
    x = Math.max(0, Number(x) || 0);
    if (x <= 6) return x;
    /* Linear stretch from 6 up to where the floor bites, then flat rate. */
    const knee = 6 + (1 - 0.25) / 0.13;            /* ~11.77 sets */
    const hi = Math.min(x, knee);
    let out = 6 + (hi - 6) - 0.13 * (hi - 6) * (hi - 6) / 2;
    if (x > knee) out += (x - knee) * 0.25;
    return out;
  }

  /**
   * Credit for adding `add` more fractional sets on top of `have` already
   * done for that muscle in the same session.
   */
  function marginalCredit(have, add) {
    return sessionCredit(have + add) - sessionCredit(have);
  }

  /* ---------------------------------------------------------------------------
     THE PLAIN-LANGUAGE READINGS

     Used by the report so the numbers arrive with the sentence that makes them
     mean something.
     ------------------------------------------------------------------------ */

  /** How a week's set count for one muscle reads against the evidence. */
  function volumeVerdict(sets, target) {
    target = target || WEEKLY_SETS;
    if (sets < 1) return { key: 'none', label: 'Untrained', tone: 'low' };
    if (sets < target * 0.5) return { key: 'low', label: 'Below the range', tone: 'low' };
    if (sets < target * 0.85) return { key: 'near', label: 'Approaching', tone: 'mid' };
    if (sets <= target * 1.8) return { key: 'in', label: 'In the range', tone: 'good' };
    return { key: 'high', label: 'Past the useful range', tone: 'mid' };
  }

  /**
   * How the spread of that volume reads. The verdict is about SPREAD, not
   * about a frequency target — the only thing that costs you is stacking more
   * into one session than a session can use.
   */
  function spreadVerdict(setsPerSession) {
    if (!(setsPerSession > 0)) return { key: 'none', label: '—', tone: 'low' };
    if (setsPerSession <= 6) return { key: 'clean', label: 'Every set counts', tone: 'good' };
    if (setsPerSession <= SESSION_PUOS) {
      return { key: 'taper', label: 'Late sets discounted', tone: 'mid' };
    }
    return { key: 'stacked', label: 'Split it over more days', tone: 'low' };
  }

  App.Science = {
    /* curve */
    profileFor: profileFor,
    percentForReps: percentForReps,
    repsAtPercent: repsAtPercent,
    repsSD: repsSD,
    e1rm: e1rm,
    loadForReps: loadForReps,
    PROFILES: PROFILES,
    GENERAL_CURVE: GENERAL_CURVE,
    LEG_CURVE: LEG_CURVE,

    /* effort */
    proximity: proximity,
    effortFactor: effortFactor,
    repFactor: repFactor,

    /* volume */
    WEEKLY_SETS: WEEKLY_SETS,
    SESSION_PUOS: SESSION_PUOS,
    SESSION_TOUCH: SESSION_TOUCH,
    sessionMarginal: sessionMarginal,
    sessionCredit: sessionCredit,
    marginalCredit: marginalCredit,

    /* readings */
    volumeVerdict: volumeVerdict,
    spreadVerdict: spreadVerdict
  };
})(window.App = window.App || {});
