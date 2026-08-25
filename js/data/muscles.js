/* =============================================================================
   muscles.js — canonical muscle taxonomy

   Every exercise, chart and anatomy figure references these ids.

   Naming is deliberately GYM language, not clinical language: the label a
   lifter would use out loud is the one that appears in the app, with the
   anatomical term kept alongside for anyone who wants it. "Teardrop" is more
   useful on a training screen than "vastus medialis obliquus".

   `view` tells the anatomy renderer which figure a region is drawn on.
   `group` is the coarse bucket used for push/pull grouping and reports.
   ============================================================================= */
(function (App) {
  'use strict';

  /* group -> display name + push/pull/legs/core classification */
  const GROUPS = {
    chest:     { name: 'Chest',     chain: 'push', order: 1 },
    back:      { name: 'Back',      chain: 'pull', order: 2 },
    shoulders: { name: 'Shoulders', chain: 'push', order: 3 },
    arms:      { name: 'Arms',      chain: 'both', order: 4 },
    legs:      { name: 'Legs',      chain: 'legs', order: 5 },
    core:      { name: 'Core',      chain: 'core', order: 6 },
    neck:      { name: 'Neck',      chain: 'pull', order: 7 }
  };

  /* id, name (long label), short (compact UI label), group,
     view (front | back | both), and optionally:
       parts   this id is a COMPOSITE — the finer regions it covers
       hidden  kept for data written before a split, not offered when authoring */
  const MUSCLES = [
    /* ---- neck / traps ---------------------------------------------------- */
    { id: 'sternocleidomastoid', name: 'Neck flexors (SCM)', short: 'Neck (front)', group: 'neck', view: 'front' },
    { id: 'splenius',   name: 'Neck extensors',      short: 'Neck (back)', group: 'neck', view: 'back' },
    { id: 'trap_upper', name: 'Upper traps',         short: 'Upper traps', group: 'back', view: 'both' },
    { id: 'trap_mid',   name: 'Mid traps',           short: 'Mid traps',   group: 'back', view: 'back' },
    { id: 'trap_lower', name: 'Lower traps',         short: 'Lower traps', group: 'back', view: 'back' },

    /* ---- shoulders ------------------------------------------------------- */
    { id: 'delt_front',   name: 'Front delts',       short: 'Front delt', group: 'shoulders', view: 'front' },
    { id: 'delt_side',    name: 'Side delts',        short: 'Side delt',  group: 'shoulders', view: 'both' },
    { id: 'delt_rear',    name: 'Rear delts',        short: 'Rear delt',  group: 'shoulders', view: 'back' },
    { id: 'rotator_cuff', name: 'Rotator cuff',      short: 'Rotator cuff', group: 'shoulders', view: 'back' },

    /* ---- chest ----------------------------------------------------------- */
    { id: 'pec_upper', name: 'Upper chest',  short: 'Upper chest', group: 'chest', view: 'front' },
    { id: 'pec_mid',   name: 'Mid chest',    short: 'Mid chest',   group: 'chest', view: 'front' },
    { id: 'pec_lower', name: 'Lower chest',  short: 'Lower chest', group: 'chest', view: 'front' },
    { id: 'serratus',  name: 'Serratus',     short: 'Serratus',    group: 'chest', view: 'front' },

    /* ---- back ------------------------------------------------------------ */
    { id: 'lat',         name: 'Lats',            short: 'Lats',        group: 'back', view: 'back' },
    { id: 'teres_major', name: 'Teres major',     short: 'Teres major', group: 'back', view: 'back' },
    { id: 'rhomboid',    name: 'Rhomboids',       short: 'Rhomboids',   group: 'back', view: 'back' },
    { id: 'erector',     name: 'Lower back',      short: 'Lower back',  group: 'back', view: 'back' },

    /* ---- arms ------------------------------------------------------------
       Split by head, because they are trained apart: an incline curl is a long
       head movement and a preacher curl is a short head movement, and a chart
       that cannot tell them apart cannot show that. */
    { id: 'biceps',      name: 'Biceps (both heads)', short: 'Biceps', group: 'arms', view: 'front',
      parts: ['biceps_long', 'biceps_short'] },
    { id: 'biceps_long',  name: 'Biceps long head (outer)',  short: 'Biceps long',  group: 'arms', view: 'front' },
    { id: 'biceps_short', name: 'Biceps short head (inner)', short: 'Biceps short', group: 'arms', view: 'front' },
    { id: 'brachialis',      name: 'Brachialis',      short: 'Brachialis', group: 'arms', view: 'front' },
    { id: 'brachioradialis', name: 'Brachioradialis', short: 'Brachiorad.', group: 'arms', view: 'both' },

    { id: 'triceps_long', name: 'Triceps long head',    short: 'Triceps long', group: 'arms', view: 'back' },
    { id: 'triceps_lat',  name: 'Triceps lateral head', short: 'Triceps lat.', group: 'arms', view: 'back' },
    { id: 'triceps_med',  name: 'Triceps medial head',  short: 'Triceps med.', group: 'arms', view: 'back' },

    { id: 'forearm_flex', name: 'Forearm flexors',   short: 'Forearm flex', group: 'arms', view: 'both' },
    { id: 'forearm_ext',  name: 'Forearm extensors', short: 'Forearm ext.', group: 'arms', view: 'back' },
    { id: 'pronator',     name: 'Pronators / supinators', short: 'Pronators', group: 'arms', view: 'front' },

    /* ---- core ------------------------------------------------------------ */
    { id: 'abs_upper', name: 'Upper abs', short: 'Upper abs', group: 'core', view: 'front' },
    { id: 'abs_lower', name: 'Lower abs', short: 'Lower abs', group: 'core', view: 'front' },
    { id: 'oblique',   name: 'Obliques',  short: 'Obliques',  group: 'core', view: 'front' },

    /* ---- legs ------------------------------------------------------------ */
    { id: 'glute_max',    name: 'Glutes',              short: 'Glutes',       group: 'legs', view: 'back' },
    { id: 'glute_med',    name: 'Glute medius',        short: 'Glute medius', group: 'legs', view: 'back' },
    { id: 'quad_rectus',  name: 'Rectus femoris',      short: 'Quad (mid)',   group: 'legs', view: 'front' },
    { id: 'quad_lateral', name: 'Outer quad (sweep)',  short: 'Quad (outer)', group: 'legs', view: 'front' },
    { id: 'quad_medial',  name: 'Teardrop (VMO)',      short: 'Quad (inner)', group: 'legs', view: 'front' },
    { id: 'adductor',     name: 'Adductors',           short: 'Adductors',    group: 'legs', view: 'front' },
    { id: 'hip_flexor',   name: 'Hip flexors',         short: 'Hip flexors',  group: 'legs', view: 'front' },
    { id: 'ham_biceps',   name: 'Hamstring (outer)',   short: 'Ham (outer)',  group: 'legs', view: 'back' },
    { id: 'ham_semi',     name: 'Hamstring (inner)',   short: 'Ham (inner)',  group: 'legs', view: 'back' },
    { id: 'calf_gastro',  name: 'Calves (gastroc)',    short: 'Calves',       group: 'legs', view: 'both' },
    { id: 'calf_soleus',  name: 'Soleus',              short: 'Soleus',       group: 'legs', view: 'back' },
    { id: 'tibialis',     name: 'Shins',               short: 'Shins',        group: 'legs', view: 'front' }
  ];

  const BY_ID = Object.create(null);
  MUSCLES.forEach(function (m) { BY_ID[m.id] = m; });

  /**
   * Composite id -> the finer regions it stands for.
   *
   * Built from the taxonomy rather than written out twice, so a composite can
   * never drift from the parts it claims to cover.
   */
  const PARTS = Object.create(null);
  MUSCLES.forEach(function (m) { if (m.parts) PARTS[m.id] = m.parts; });

  /**
   * Rewrite a {muscleId: pct} map onto the ids the anatomy figures draw.
   *
   * Exercises written before a muscle was split still name the composite — most
   * of the built-in library says `biceps`, not `biceps_long`. Without this the
   * figure would simply find no region for that id and quietly draw nothing,
   * which is the "I selected a muscle and it did not light up" bug.
   *
   * Each part receives the FULL value rather than a share of it. The number is
   * a proportion of the session's workload attributable to that muscle; both
   * heads of a biceps genuinely take that load, so halving it would understate
   * the work. Totals are computed from the unexpanded map, so nothing is
   * double-counted anywhere it matters.
   */
  function expand(map) {
    const out = Object.create(null);
    for (const id in map) {
      const v = Number(map[id]) || 0;
      if (!v) continue;
      const parts = PARTS[id];
      if (parts) {
        parts.forEach(function (p) { out[p] = Math.max(out[p] || 0, v); });
      } else {
        out[id] = Math.max(out[id] || 0, v);
      }
    }
    return out;
  }

  /** Coarse group totals from a fine-grained {muscleId: pct} map. */
  function groupTotals(map) {
    const out = Object.create(null);
    for (const id in map) {
      const m = BY_ID[id];
      if (!m) continue;
      out[m.group] = (out[m.group] || 0) + map[id];
    }
    return out;
  }

  /** Human label for a muscle id, falling back to the raw id. */
  function label(id, longForm) {
    const m = BY_ID[id];
    if (!m) return id;
    return longForm ? m.name : m.short;
  }

  /** Normalise a {muscleId: pct} map so the values sum to 100. */
  function normalise(map) {
    let sum = 0;
    for (const k in map) sum += Number(map[k]) || 0;
    if (!sum) return {};
    const out = {};
    for (const k in map) {
      const v = Math.round(((Number(map[k]) || 0) / sum) * 1000) / 10;
      if (v > 0) out[k] = v;
    }
    return out;
  }

  /* ---------------------------------------------------------------------------
     GROUP ORDERING

     Which muscle group comes first in a grouped workout is a training decision,
     not a display detail: someone running a push day wants chest ahead of
     triceps, and on an arms day they may want exactly the opposite. So the
     order is configurable, with templates for the splits a person actually runs.

     A template applies only when the groups trained are EXACTLY its groups —
     not a superset, not a subset. That is what makes a "Push" template safe to
     define: it orders a real push day and stays out of the way of a full-body
     session that merely happens to include chest. Anything unmatched falls back
     to the general order, and with the feature off everything falls back to the
     taxonomy's own `order`.
     ------------------------------------------------------------------------ */

  const DEFAULT_ORDER = Object.keys(GROUPS).sort(function (a, b) {
    return GROUPS[a].order - GROUPS[b].order;
  });

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const seen = Object.create(null);
    a.forEach(function (x) { seen[x] = true; });
    return b.every(function (x) { return seen[x]; });
  }

  /**
   * The template whose groups exactly match the ones trained, if any.
   *
   * @param {string[]} groupIds   the groups primarily trained
   * @param {Object[]} templates  [{id, name, groups:[...]}]
   * @returns {Object|null}
   */
  function matchTemplate(groupIds, templates) {
    const present = (groupIds || []).filter(function (g) { return GROUPS[g]; });
    if (!present.length) return null;
    return (templates || []).find(function (t) {
      return t && Array.isArray(t.groups) && t.groups.length && sameSet(present, t.groups);
    }) || null;
  }

  /**
   * Order the groups trained, honouring the user's configuration when enabled.
   *
   * @param {string[]} groupIds  groups primarily trained, in any order
   * @param {Object}   [config]  settings.groupOrder
   * @returns {string[]} the same groups, ordered
   */
  function orderGroups(groupIds, config) {
    const present = (groupIds || []).filter(function (g) { return GROUPS[g]; });

    let order = DEFAULT_ORDER;
    if (config && config.enabled) {
      const tpl = matchTemplate(present, config.templates);
      if (tpl) order = tpl.groups;
      else if (Array.isArray(config.general) && config.general.length) order = config.general;
    }

    const rank = Object.create(null);
    order.forEach(function (g, i) { rank[g] = i; });

    /* A group the order never mentions still has to land somewhere, so it sorts
       after everything named, in taxonomy order. */
    return present.slice().sort(function (a, b) {
      const ra = rank[a] == null ? order.length + GROUPS[a].order : rank[a];
      const rb = rank[b] == null ? order.length + GROUPS[b].order : rank[b];
      return ra - rb;
    });
  }

  App.Muscles = {
    GROUPS: GROUPS,
    MUSCLES: MUSCLES,
    BY_ID: BY_ID,
    PARTS: PARTS,
    DEFAULT_GROUP_ORDER: DEFAULT_ORDER,
    ids: MUSCLES.map(function (m) { return m.id; }),
    groupTotals: groupTotals,
    expand: expand,
    label: label,
    normalise: normalise,
    orderGroups: orderGroups,
    matchTemplate: matchTemplate
  };
})(window.App = window.App || {});
