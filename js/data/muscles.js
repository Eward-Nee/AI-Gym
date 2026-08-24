/* =============================================================================
   muscles.js — canonical muscle taxonomy
   Every exercise, chart and anatomy figure references these ids.
   `view` tells the anatomy renderer which figure the region is drawn on.
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

  /* id, name (anatomical), short (UI label), group, view (front | back | both) */
  const MUSCLES = [
    /* ---- neck / traps ---------------------------------------------------- */
    { id: 'sternocleidomastoid', name: 'Sternocleidomastoid', short: 'Neck (front)', group: 'neck', view: 'front' },
    { id: 'splenius',   name: 'Splenius / neck extensors', short: 'Neck (back)', group: 'neck', view: 'back' },
    { id: 'trap_upper', name: 'Trapezius (upper)',  short: 'Upper traps', group: 'back', view: 'both' },
    { id: 'trap_mid',   name: 'Trapezius (middle)', short: 'Mid traps',   group: 'back', view: 'back' },
    { id: 'trap_lower', name: 'Trapezius (lower)',  short: 'Lower traps', group: 'back', view: 'back' },

    /* ---- shoulders ------------------------------------------------------- */
    { id: 'delt_front',   name: 'Deltoid (anterior)',  short: 'Front delt', group: 'shoulders', view: 'front' },
    { id: 'delt_side',    name: 'Deltoid (lateral)',   short: 'Side delt',  group: 'shoulders', view: 'both' },
    { id: 'delt_rear',    name: 'Deltoid (posterior)', short: 'Rear delt',  group: 'shoulders', view: 'back' },
    { id: 'rotator_cuff', name: 'Infraspinatus / teres minor', short: 'Rotator cuff', group: 'shoulders', view: 'back' },

    /* ---- chest ----------------------------------------------------------- */
    { id: 'pec_upper', name: 'Pectoralis major (clavicular)', short: 'Upper chest', group: 'chest', view: 'front' },
    { id: 'pec_mid',   name: 'Pectoralis major (sternal)',    short: 'Mid chest',   group: 'chest', view: 'front' },
    { id: 'pec_lower', name: 'Pectoralis major (abdominal)',  short: 'Lower chest', group: 'chest', view: 'front' },
    { id: 'serratus',  name: 'Serratus anterior',             short: 'Serratus',    group: 'chest', view: 'front' },

    /* ---- back ------------------------------------------------------------ */
    { id: 'lat',         name: 'Latissimus dorsi', short: 'Lats',        group: 'back', view: 'back' },
    { id: 'teres_major', name: 'Teres major',      short: 'Teres major', group: 'back', view: 'back' },
    { id: 'rhomboid',    name: 'Rhomboids',        short: 'Rhomboids',   group: 'back', view: 'back' },
    { id: 'erector',     name: 'Erector spinae',   short: 'Lower back',  group: 'back', view: 'back' },

    /* ---- arms ------------------------------------------------------------ */
    { id: 'biceps',       name: 'Biceps brachii', short: 'Biceps', group: 'arms', view: 'front' },
    { id: 'brachialis',   name: 'Brachialis / brachioradialis', short: 'Brachialis', group: 'arms', view: 'front' },
    { id: 'triceps_long', name: 'Triceps (long head)', short: 'Triceps long', group: 'arms', view: 'back' },
    { id: 'triceps_lat',  name: 'Triceps (lateral / medial)', short: 'Triceps lat.', group: 'arms', view: 'back' },
    { id: 'forearm_flex', name: 'Forearm flexors',   short: 'Forearm flex', group: 'arms', view: 'front' },
    { id: 'forearm_ext',  name: 'Forearm extensors', short: 'Forearm ext.', group: 'arms', view: 'back' },

    /* ---- core ------------------------------------------------------------ */
    { id: 'abs_upper', name: 'Rectus abdominis (upper)', short: 'Upper abs', group: 'core', view: 'front' },
    { id: 'abs_lower', name: 'Rectus abdominis (lower)', short: 'Lower abs', group: 'core', view: 'front' },
    { id: 'oblique',   name: 'External obliques',        short: 'Obliques',  group: 'core', view: 'front' },

    /* ---- legs ------------------------------------------------------------ */
    { id: 'glute_max',    name: 'Gluteus maximus',  short: 'Glutes',       group: 'legs', view: 'back' },
    { id: 'glute_med',    name: 'Gluteus medius',   short: 'Glute medius', group: 'legs', view: 'back' },
    { id: 'quad_rectus',  name: 'Rectus femoris',   short: 'Quad (mid)',   group: 'legs', view: 'front' },
    { id: 'quad_lateral', name: 'Vastus lateralis', short: 'Quad (outer)', group: 'legs', view: 'front' },
    { id: 'quad_medial',  name: 'Vastus medialis',  short: 'Quad (inner)', group: 'legs', view: 'front' },
    { id: 'adductor',     name: 'Adductor group',   short: 'Adductors',    group: 'legs', view: 'front' },
    { id: 'hip_flexor',   name: 'Iliopsoas / TFL',  short: 'Hip flexors',  group: 'legs', view: 'front' },
    { id: 'ham_biceps',   name: 'Biceps femoris',   short: 'Ham (outer)',  group: 'legs', view: 'back' },
    { id: 'ham_semi',     name: 'Semitendinosus / semimembranosus', short: 'Ham (inner)', group: 'legs', view: 'back' },
    { id: 'calf_gastro',  name: 'Gastrocnemius',    short: 'Calves',       group: 'legs', view: 'back' },
    { id: 'calf_soleus',  name: 'Soleus',           short: 'Soleus',       group: 'legs', view: 'back' },
    { id: 'tibialis',     name: 'Tibialis anterior',short: 'Shins',        group: 'legs', view: 'front' }
  ];

  const BY_ID = Object.create(null);
  MUSCLES.forEach(function (m) { BY_ID[m.id] = m; });

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

  App.Muscles = {
    GROUPS: GROUPS,
    MUSCLES: MUSCLES,
    BY_ID: BY_ID,
    ids: MUSCLES.map(function (m) { return m.id; }),
    groupTotals: groupTotals,
    label: label,
    normalise: normalise
  };
})(window.App = window.App || {});
