/* =============================================================================
   ranks.js — strength scoring and the 8-tier rank ladder

   Points (0–3200) blend four indices so a rank reflects an athlete, not a
   single lift:

     strength    60%   estimated 1RM vs. bodyweight-relative standards
     consistency 18%   sessions logged in the last 28 days
     volume      12%   28-day tonnage, log-scaled
     balance     10%   how evenly the seven muscle groups are trained

   The top tier is deliberately hard to reach: Diamond additionally requires
   breadth (enough distinct movements) and a floor on the WEAKEST trained group,
   so it means "elite across everything you do" rather than one huge lift.
   ============================================================================= */
(function (App) {
  'use strict';

  const RANKS = [
    { id: 'wood',     name: 'Wood',     min: 0,    color: '#8a6242' },
    { id: 'stone',    name: 'Stone',    min: 320,  color: '#8d9299' },
    { id: 'bronze',   name: 'Bronze',   min: 660,  color: '#c1793a' },
    { id: 'iron',     name: 'Iron',     min: 1020, color: '#6b7480' },
    { id: 'silver',   name: 'Silver',   min: 1400, color: '#b9c2cc' },
    { id: 'gold',     name: 'Gold',     min: 1800, color: '#e0b23c' },
    { id: 'platinum', name: 'Platinum', min: 2250, color: '#63d3c4' },
    { id: 'diamond',  name: 'Diamond',  min: 2750, color: '#7fc4f5', elite: true }
  ];

  const MAX_POINTS = 3200;

  /* Elite 1RM expressed as a multiple of bodyweight, by movement pattern.
     Compound patterns carry real-world standards; isolation patterns are set
     lower so an arm day cannot inflate a rank. */
  const ELITE_MULT = {
    'horizontal-push': 1.50,
    'incline-push': 1.25,
    'vertical-push': 1.00,
    'vertical-pull': 1.60,
    'horizontal-pull': 1.40,
    'squat': 2.00,
    'hinge': 2.40,
    'lunge': 1.10,
    'olympic': 1.35,
    'carry': 1.20,
    'core': 0.60,
    'chest-isolation': 0.55,
    'back-isolation': 0.50,
    'shoulder-isolation': 0.35,
    'biceps-isolation': 0.55,
    'triceps-isolation': 0.60,
    'forearm-isolation': 0.45,
    'quad-isolation': 1.00,
    'ham-isolation': 0.80,
    'glute-isolation': 0.55,
    'leg-isolation': 0.90,
    'calf-isolation': 1.60,
    'neck-isolation': 0.30
  };

  const DEFAULT_MULT = 0.80;

  /* ---------------------------------------------------------------------------
     1RM ESTIMATION
     ------------------------------------------------------------------------ */

  /**
   * Estimated one-rep max. Epley is used up to 10 reps; beyond that it drifts
   * high, so the Brzycki/Epley average keeps long sets honest.
   */
  function e1rm(weight, reps) {
    weight = Number(weight) || 0;
    reps = Math.max(1, Math.round(Number(reps) || 0));
    if (!weight || !reps) return 0;
    if (reps === 1) return weight;
    const epley = weight * (1 + reps / 30);
    if (reps <= 10) return epley;
    const brzycki = weight * (36 / (37 - Math.min(reps, 36)));
    return (epley + brzycki) / 2;
  }

  /** Best estimated 1RM across a set list. */
  function bestE1RM(sets) {
    let best = 0;
    (sets || []).forEach(function (s) {
      if (s.done === false) return;
      best = Math.max(best, e1rm(s.weight, s.reps));
    });
    return best;
  }

  function volumeOf(sets) {
    let v = 0;
    (sets || []).forEach(function (s) {
      if (s.done === false) return;
      v += (Number(s.weight) || 0) * (Number(s.reps) || 0);
    });
    return v;
  }

  /* ---------------------------------------------------------------------------
     PER-EXERCISE STRENGTH SCORE
     ------------------------------------------------------------------------ */

  /**
   * 0–100 (soft-capped at 115) score for one movement.
   * Bodyweight movements with no external load fall back to a rep-count curve,
   * because "18 strict pull-ups" is a strength signal even with no plates.
   */
  function strengthScore(exercise, best, bodyweight) {
    const bw = Number(bodyweight) || 80;
    const mult = ELITE_MULT[exercise && exercise.pattern] || DEFAULT_MULT;

    if (!best || !best.e1rm) {
      const reps = best && best.reps ? best.reps : 0;
      if (!reps) return 0;
      /* 25 clean bodyweight reps ~ elite for a bodyweight movement */
      return Math.min(100, (reps / 25) * 100);
    }

    let load = best.e1rm;
    /* Loaded bodyweight movements move the athlete too — count it. */
    if (exercise && exercise.equipment === 'bodyweight') load += bw;

    const ratio = (load / bw) / mult;
    return Math.max(0, Math.min(115, ratio * 100));
  }

  /* ---------------------------------------------------------------------------
     INDICES
     ------------------------------------------------------------------------ */

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /** Shannon evenness across the seven coarse groups, 0..100. */
  function balanceIndex(groupVolume) {
    const keys = Object.keys(App.Muscles.GROUPS);
    const vals = keys.map(function (k) { return groupVolume[k] || 0; });
    const total = vals.reduce(function (a, b) { return a + b; }, 0);
    if (!total) return 0;
    let hSum = 0;
    vals.forEach(function (v) {
      if (v <= 0) return;
      const p = v / total;
      hSum -= p * Math.log(p);
    });
    return clamp01(hSum / Math.log(keys.length)) * 100;
  }

  /**
   * Full rank computation.
   * @param {Object} input
   *   sessions    logged sessions (each with .date and .entries[{exerciseId, sets}])
   *   exercises   Map or object of id -> exercise
   *   bodyweight  kg
   *   windowDays  activity window, default 28
   */
  function compute(input) {
    const sessions = input.sessions || [];
    const exMap = input.exercises || {};
    const bw = Number(input.bodyweight) || 80;
    const win = input.windowDays || 28;
    const since = Date.now() - win * 86400000;

    /* --- best lift per exercise (all time) + recency weighting --- */
    const bestByEx = Object.create(null);
    const seenDays = Object.create(null);
    const groupVolume = Object.create(null);
    let recentVolume = 0, recentSessions = 0;

    sessions.forEach(function (s) {
      const t = new Date(s.date + (s.date.length === 10 ? 'T12:00:00' : '')).getTime();
      const isRecent = t >= since;
      if (isRecent) { seenDays[s.date] = 1; }

      (s.entries || []).forEach(function (en) {
        const ex = exMap[en.exerciseId];
        const one = bestE1RM(en.sets);
        const vol = volumeOf(en.sets);
        let reps = 0;
        (en.sets || []).forEach(function (st) {
          if (st.done !== false) reps = Math.max(reps, Number(st.reps) || 0);
        });

        const cur = bestByEx[en.exerciseId] ||
          (bestByEx[en.exerciseId] = { e1rm: 0, reps: 0, sessions: 0, lastDate: null });
        cur.e1rm = Math.max(cur.e1rm, one);
        cur.reps = Math.max(cur.reps, reps);
        cur.sessions++;
        if (!cur.lastDate || s.date > cur.lastDate) cur.lastDate = s.date;

        if (isRecent) {
          recentVolume += vol;
          if (ex && ex.muscles) {
            for (const m in ex.muscles) {
              const g = (App.Muscles.BY_ID[m] || {}).group;
              if (!g) continue;
              groupVolume[g] = (groupVolume[g] || 0) + vol * (ex.muscles[m] / 100);
            }
          }
        }
      });
    });
    recentSessions = Object.keys(seenDays).length;

    /* --- per-exercise scores --- */
    const scored = [];
    for (const id in bestByEx) {
      const ex = exMap[id];
      if (!ex) continue;
      const sc = strengthScore(ex, bestByEx[id], bw);
      if (sc <= 0) continue;
      scored.push({
        exerciseId: id,
        name: ex.name,
        pattern: ex.pattern,
        score: sc,
        e1rm: bestByEx[id].e1rm,
        sessions: bestByEx[id].sessions,
        lastDate: bestByEx[id].lastDate
      });
    }
    scored.sort(function (a, b) { return b.score - a.score; });

    /* Strength index: mean of the best 10 movements, so breadth is rewarded but
       a single novelty lift cannot carry the whole rank. */
    const top = scored.slice(0, 10);
    const strengthIdx = top.length
      ? Math.min(100, top.reduce(function (a, s) { return a + s.score; }, 0) / Math.max(6, top.length))
      : 0;

    const consistencyIdx = clamp01(recentSessions / 12) * 100;
    const volumeIdx = recentVolume > 0
      ? clamp01(Math.log10(1 + recentVolume) / Math.log10(1 + 120000)) * 100
      : 0;
    const balanceIdx = balanceIndex(groupVolume);

    const composite =
      0.60 * strengthIdx +
      0.18 * consistencyIdx +
      0.12 * volumeIdx +
      0.10 * balanceIdx;

    let points = Math.round((composite / 100) * MAX_POINTS);

    /* --- Diamond gate: elite must mean elite everywhere --- */
    const breadth = scored.length;
    const trainedGroups = Object.keys(groupVolume).filter(function (g) { return groupVolume[g] > 0; });
    const weakest = trainedGroups.length
      ? Math.min.apply(null, trainedGroups.map(function (g) {
          const inGroup = scored.filter(function (s) {
            const ex = exMap[s.exerciseId];
            if (!ex || !ex.muscles) return false;
            return Object.keys(ex.muscles).some(function (m) {
              return (App.Muscles.BY_ID[m] || {}).group === g && ex.muscles[m] >= 20;
            });
          });
          if (!inGroup.length) return 0;
          return Math.max.apply(null, inGroup.map(function (s) { return s.score; }));
        }))
      : 0;

    const eliteGate = breadth >= 12 && weakest >= 70 && trainedGroups.length >= 5;
    const diamondMin = RANKS[RANKS.length - 1].min;
    if (points >= diamondMin && !eliteGate) points = diamondMin - 1;

    const rank = rankFor(points);
    const next = RANKS[RANKS.indexOf(rank) + 1] || null;
    const span = next ? next.min - rank.min : MAX_POINTS - rank.min;
    const progress = span > 0 ? clamp01((points - rank.min) / span) : 1;

    return {
      points: points,
      max: MAX_POINTS,
      rank: rank,
      next: next,
      progress: progress,
      toNext: next ? Math.max(0, next.min - points) : 0,
      indices: {
        strength: Math.round(strengthIdx),
        consistency: Math.round(consistencyIdx),
        volume: Math.round(volumeIdx),
        balance: Math.round(balanceIdx)
      },
      scored: scored,
      breadth: breadth,
      weakestGroupScore: Math.round(weakest),
      eliteGate: eliteGate,
      recentSessions: recentSessions,
      recentVolume: recentVolume,
      groupVolume: groupVolume
    };
  }

  function rankFor(points) {
    let r = RANKS[0];
    RANKS.forEach(function (x) { if (points >= x.min) r = x; });
    return r;
  }

  /** Short initials used inside the medal chip. */
  function initials(rank) {
    return rank.name.slice(0, 2).toUpperCase();
  }

  App.Ranks = {
    RANKS: RANKS,
    MAX_POINTS: MAX_POINTS,
    ELITE_MULT: ELITE_MULT,
    e1rm: e1rm,
    bestE1RM: bestE1RM,
    volumeOf: volumeOf,
    strengthScore: strengthScore,
    compute: compute,
    rankFor: rankFor,
    initials: initials
  };
})(window.App = window.App || {});
