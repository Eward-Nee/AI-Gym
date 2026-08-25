/* =============================================================================
   ranks.js — world-record strength scoring and the 8-tier rank ladder

   The scale is the world record for YOUR bodyweight, not a generic "elite"
   standard. Every movement scores as a percentage of what the best human alive
   at your weight can lift, and your rank is set by your WEAKEST trained
   movement — so a rank means "I am at least this good at everything I do",
   never "I have one big lift".

   Diamond is 99% of a world record in every exercise you train. It is meant to
   be effectively unreachable.

   Bodyweight scaling
   ------------------
   Absolute strength scales roughly with cross-sectional area, i.e. mass^(2/3),
   so a record ratio measured at one bodyweight cannot be applied flat to
   another. Records are stored as a 1RM-to-bodyweight ratio at an 80 kg
   reference and re-scaled allometrically, which is why a 60 kg lifter is held
   to a higher multiple than a 120 kg lifter for the same rank.
   ============================================================================= */
(function (App) {
  'use strict';

  /* `wr` is the percentage of a world record required in EVERY trained
     movement to hold the rank. */
  /* Stone starts at 30% and Platinum sits at 90% — "close to complete" — with
     the middle tiers spread evenly between them. The percentages look linear
     but the difficulty is not: closing 78% -> 90% of a world record is a far
     larger job than 30% -> 42%. */
  const RANKS = [
    { id: 'wood',     name: 'Wood',     wr: 0,  color: '#8a6242' },
    { id: 'stone',    name: 'Stone',    wr: 30, color: '#8d9299' },
    { id: 'bronze',   name: 'Bronze',   wr: 42, color: '#c1793a' },
    { id: 'iron',     name: 'Iron',     wr: 54, color: '#6b7480' },
    { id: 'silver',   name: 'Silver',   wr: 65, color: '#b9c2cc' },
    { id: 'gold',     name: 'Gold',     wr: 78, color: '#e0b23c' },
    { id: 'platinum', name: 'Platinum', wr: 90, color: '#63d3c4' },
    { id: 'diamond',  name: 'Diamond',  wr: 99, color: '#7fc4f5', elite: true }
  ];

  const MAX_POINTS = 3200;
  const REF_BW = 80;          /* kg — bodyweight the ratios below are quoted at */
  const ALLOMETRIC = 2 / 3;   /* strength ~ mass^(2/3) */

  /**
   * World-record 1RM as a multiple of bodyweight at REF_BW, per movement
   * pattern. `ext` is external load; `bw` is used for bodyweight-equipment
   * variants and covers the athlete's own mass as well as any added plates,
   * because a weighted dip and an overhead press are not the same feat even
   * though both are vertical pressing.
   */
  const WORLD_RECORD = {
    'horizontal-push':   { ext: 2.90, bw: 1.60 },
    'incline-push':      { ext: 2.30, bw: 1.55 },
    'vertical-push':     { ext: 1.80, bw: 3.40 },
    'horizontal-pull':   { ext: 2.40, bw: 1.90 },
    'vertical-pull':     { ext: 1.55, bw: 2.55 },
    'squat':             { ext: 4.20, bw: 1.60 },
    'hinge':             { ext: 4.80, bw: 2.10 },
    'lunge':             { ext: 2.20, bw: 1.50 },
    'olympic':           { ext: 2.60, bw: 1.60 },
    'carry':             { ext: 3.00, bw: 1.50 },
    'core':              { ext: 1.20, bw: 1.35 },
    'chest-isolation':   { ext: 1.10, bw: 1.45 },
    'back-isolation':    { ext: 1.00, bw: 1.40 },
    'shoulder-isolation':{ ext: 0.55, bw: 1.20 },
    'biceps-isolation':  { ext: 1.20, bw: 1.50 },
    'triceps-isolation': { ext: 1.30, bw: 1.55 },
    'forearm-isolation': { ext: 1.00, bw: 1.30 },
    'quad-isolation':    { ext: 2.20, bw: 1.40 },
    'ham-isolation':     { ext: 1.60, bw: 1.45 },
    'glute-isolation':   { ext: 1.20, bw: 1.40 },
    'leg-isolation':     { ext: 1.80, bw: 1.35 },
    'calf-isolation':    { ext: 3.50, bw: 1.80 },
    'neck-isolation':    { ext: 0.80, bw: 1.20 },
    'other':             { ext: 1.50, bw: 1.45 }
  };

  const DEFAULT_WR = { ext: 1.50, bw: 1.45 };

  /**
   * Patterns where moving your own bodyweight IS a max-strength feat, so an
   * unloaded set still counts toward the rank. A pull-up or a dip belongs here;
   * a plank does not, because holding a position is not a one-rep max and
   * crediting it with full bodyweight would let it outscore a real lift.
   */
  const BODYWEIGHT_MAX_EFFORT = {
    'vertical-pull': true,
    'vertical-push': true,
    'horizontal-push': true,
    'squat': true,
    'lunge': true,
    'hinge': true,
    'olympic': true
  };

  /**
   * Does this movement count toward the rank floor? It must either carry a
   * recorded external load, or be a bodyweight movement whose whole point is
   * maximal effort. Everything else is still scored and shown, just not allowed
   * to define the rank — otherwise one set of light face pulls would cap you at
   * Wood forever.
   */
  function isRankBearing(exercise, best) {
    if (best && best.e1rm > 0) return true;
    return !!(exercise && exercise.equipment === 'bodyweight' &&
      BODYWEIGHT_MAX_EFFORT[exercise.pattern]);
  }

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
     WORLD-RECORD SCALE
     ------------------------------------------------------------------------ */

  /** The record load for a pattern at a given bodyweight, in kg. */
  function worldRecord(pattern, bodyweight, isBodyweightMovement) {
    const rec = WORLD_RECORD[pattern] || DEFAULT_WR;
    const ratio = isBodyweightMovement ? rec.bw : rec.ext;
    const bw = Math.max(30, Number(bodyweight) || REF_BW);
    /* ratio is quoted at REF_BW; absolute record scales with mass^(2/3) */
    return ratio * REF_BW * Math.pow(bw / REF_BW, ALLOMETRIC);
  }

  /**
   * What fraction of the world record this lift represents, as a percentage.
   * Bodyweight movements count the athlete's own mass as load, which is what
   * makes an unweighted pull-up score at all.
   */
  function wrPercent(exercise, best, bodyweight) {
    const bw = Math.max(30, Number(bodyweight) || REF_BW);
    const isBw = !!(exercise && exercise.equipment === 'bodyweight');
    const pattern = (exercise && exercise.pattern) || 'other';

    let load = (best && best.e1rm) || 0;
    if (isBw) load += bw;

    if (!load) {
      /* No load recorded at all — fall back on reps, heavily discounted, so a
         rep-only entry can never carry a high rank. */
      const reps = (best && best.reps) || 0;
      if (!reps) return 0;
      return Math.min(20, (reps / 40) * 20);
    }

    const record = worldRecord(pattern, bw, isBw);
    if (!record) return 0;
    return Math.max(0, (load / record) * 100);
  }

  /** Backwards-compatible alias: the 0-100 score IS the world-record percent. */
  function strengthScore(exercise, best, bodyweight) {
    return wrPercent(exercise, best, bodyweight);
  }

  /* ---------------------------------------------------------------------------
     INDICES (context only — they no longer move the rank)
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

  /* ---------------------------------------------------------------------------
     RANK
     ------------------------------------------------------------------------ */

  /**
   * @param {Object} input
   *   sessions    logged sessions (each with .date and .entries[{exerciseId, sets}])
   *   exercises   Map or object of id -> exercise
   *   bodyweight  kg
   *   windowDays  activity window for the context indices, default 28
   */
  function compute(input) {
    const sessions = input.sessions || [];
    const exMap = input.exercises || {};
    const bw = Number(input.bodyweight) || REF_BW;
    const win = input.windowDays || 28;
    const since = Date.now() - win * 86400000;

    const bestByEx = Object.create(null);
    const seenDays = Object.create(null);
    const groupVolume = Object.create(null);
    let recentVolume = 0;

    sessions.forEach(function (s) {
      const t = new Date(s.date + (s.date.length === 10 ? 'T12:00:00' : '')).getTime();
      const isRecent = t >= since;
      if (isRecent) seenDays[s.date] = 1;

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
    const recentSessions = Object.keys(seenDays).length;

    /* --- score every trained movement against its world record --- */
    const scored = [];
    for (const id in bestByEx) {
      const ex = exMap[id];
      if (!ex) continue;
      const pct = wrPercent(ex, bestByEx[id], bw);
      if (pct <= 0) continue;
      scored.push({
        exerciseId: id,
        name: ex.name,
        pattern: ex.pattern,
        score: pct,                 /* % of world record */
        wrPercent: pct,
        record: worldRecord(ex.pattern || 'other', bw, ex.equipment === 'bodyweight'),
        e1rm: bestByEx[id].e1rm,
        sessions: bestByEx[id].sessions,
        lastDate: bestByEx[id].lastDate,
        rankBearing: isRankBearing(ex, bestByEx[id])
      });
    }
    scored.sort(function (a, b) { return b.score - a.score; });

    /* The rank is set by the weakest rank-bearing movement: "at least this good
       at everything you do". */
    const bearing = scored.filter(function (s) { return s.rankBearing; });
    const weakest = bearing.length ? bearing[bearing.length - 1] : null;
    const floor = weakest ? weakest.score : 0;

    const rank = rankFor(floor);
    const idx = RANKS.indexOf(rank);
    const next = RANKS[idx + 1] || null;
    const span = next ? next.wr - rank.wr : Math.max(1, 100 - rank.wr);
    const progress = span > 0 ? clamp01((floor - rank.wr) / span) : 1;

    /* Points exist for the progress bar and the friend leaderboard; they are a
       straight linear read of the same floor, so they can never disagree with
       the rank the way a blended score could. */
    const points = Math.round(clamp01(floor / RANKS[RANKS.length - 1].wr) * MAX_POINTS);

    return {
      points: points,
      max: MAX_POINTS,
      rank: rank,
      next: next,
      progress: progress,
      /* how many more percentage points of world record the weakest lift needs */
      toNext: next ? Math.max(0, Math.round((next.wr - floor) * 10) / 10) : 0,
      floor: Math.round(floor * 10) / 10,
      weakest: weakest,
      strongest: scored[0] || null,
      bodyweight: bw,
      indices: {
        strength: Math.round(scored.length ? scored[0].score : 0),
        consistency: Math.round(clamp01(recentSessions / 12) * 100),
        volume: recentVolume > 0
          ? Math.round(clamp01(Math.log10(1 + recentVolume) / Math.log10(1 + 120000)) * 100)
          : 0,
        balance: Math.round(balanceIndex(groupVolume))
      },
      scored: scored,
      rankBearing: bearing,
      breadth: bearing.length,
      weakestGroupScore: Math.round(floor),
      eliteGate: floor >= RANKS[RANKS.length - 1].wr,
      recentSessions: recentSessions,
      recentVolume: recentVolume,
      groupVolume: groupVolume
    };
  }

  /** Rank for a given world-record floor percentage. */
  function rankFor(wrFloor) {
    let r = RANKS[0];
    RANKS.forEach(function (x) { if (wrFloor >= x.wr) r = x; });
    return r;
  }

  /** Rank from stored points, for friends' cached values. */
  function rankForPoints(points) {
    const pct = (Number(points) || 0) / MAX_POINTS * RANKS[RANKS.length - 1].wr;
    return rankFor(pct);
  }

  /** Short initials used inside the medal chip. */
  function initials(rank) {
    return rank.name.slice(0, 2).toUpperCase();
  }

  App.Ranks = {
    RANKS: RANKS,
    MAX_POINTS: MAX_POINTS,
    WORLD_RECORD: WORLD_RECORD,
    REF_BW: REF_BW,
    e1rm: e1rm,
    bestE1RM: bestE1RM,
    volumeOf: volumeOf,
    worldRecord: worldRecord,
    wrPercent: wrPercent,
    isRankBearing: isRankBearing,
    strengthScore: strengthScore,
    compute: compute,
    rankFor: rankFor,
    rankForPoints: rankForPoints,
    initials: initials
  };
})(window.App = window.App || {});
