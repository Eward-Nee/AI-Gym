#!/usr/bin/env node
/* =============================================================================
   gen-exercises.js — builds js/data/exercises.js

   The seed library is expressed as base movements plus variant matrices
   (equipment x angle x grip x stance). Each base carries an anatomically
   weighted muscle map; variants shift that map rather than restating it, which
   keeps ~400 exercises internally consistent instead of hand-typed and drifting.

   Run:  node tools/gen-exercises.js
   ============================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const out = [];
const seen = new Set();

/* --- helpers -------------------------------------------------------------- */

function slug(s) {
  return s.toLowerCase()
    .replace(/[()'".]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Merge weight deltas into a base map, drop <=0, renormalise to 100. */
function shift(base, delta) {
  const m = Object.assign({}, base);
  for (const k in (delta || {})) m[k] = (m[k] || 0) + delta[k];
  let sum = 0;
  for (const k in m) { if (m[k] <= 0) delete m[k]; else sum += m[k]; }
  const norm = {};
  for (const k in m) {
    const v = Math.round((m[k] / sum) * 1000) / 10;
    if (v >= 0.5) norm[k] = v;
  }
  return norm;
}

function add(name, equipment, pattern, muscles, extra) {
  const id = slug(name);
  if (seen.has(id)) return;
  seen.add(id);
  out.push(Object.assign({
    id: id,
    name: name,
    equipment: equipment,
    pattern: pattern,
    muscles: muscles,
    builtin: true
  }, extra || {}));
}

/* --- equipment vocabulary ------------------------------------------------- */

const EQUIP = {
  barbell:    { label: 'Barbell',        prefix: 'Barbell' },
  dumbbell:   { label: 'Dumbbell',       prefix: 'Dumbbell' },
  smith:      { label: 'Smith machine',  prefix: 'Smith Machine' },
  machine:    { label: 'Machine',        prefix: 'Machine' },
  cable:      { label: 'Cable',          prefix: 'Cable' },
  bodyweight: { label: 'Bodyweight',     prefix: '' },
  kettlebell: { label: 'Kettlebell',     prefix: 'Kettlebell' },
  ezbar:      { label: 'EZ bar',         prefix: 'EZ Bar' },
  trapbar:    { label: 'Trap bar',       prefix: 'Trap Bar' },
  landmine:   { label: 'Landmine',       prefix: 'Landmine' },
  band:       { label: 'Resistance band',prefix: 'Band' },
  sled:       { label: 'Sled',           prefix: 'Sled' },
  plate:      { label: 'Weight plate',   prefix: 'Plate' },
  ball:       { label: 'Medicine ball',  prefix: 'Medicine Ball' },
  suspension: { label: 'Suspension trainer', prefix: 'Suspension' },
  other:      { label: 'Other',          prefix: '' }
};

/* Equipment tweaks applied on top of every base map. */
const EQUIP_SHIFT = {
  dumbbell:   { delt_front: 2, rotator_cuff: 2 },
  smith:      { rotator_cuff: -2, erector: -3, oblique: -2 },
  machine:    { erector: -4, oblique: -3, rotator_cuff: -2 },
  cable:      { rotator_cuff: 1 },
  kettlebell: { forearm_flex: 3, oblique: 2 },
  bodyweight: { abs_upper: 2, abs_lower: 1 },
  band:       { rotator_cuff: 1 },
  suspension: { abs_upper: 4, abs_lower: 3, oblique: 2 },
  landmine:   { oblique: 3, delt_front: 2 },
  trapbar:    { quad_rectus: 4, quad_lateral: 3, erector: -3 }
};

/* =============================================================================
   CHEST
   ============================================================================= */

const BENCH = { pec_mid: 34, pec_lower: 13, pec_upper: 8, delt_front: 17,
                triceps_lat: 15, triceps_long: 11, serratus: 2 };

const BENCH_ANGLE = {
  Flat:     {},
  Incline:  { pec_upper: 22, pec_lower: -11, pec_mid: -8, delt_front: 6 },
  Decline:  { pec_lower: 16, pec_upper: -7, delt_front: -6 }
};

['barbell', 'dumbbell', 'smith', 'machine'].forEach(function (eq) {
  Object.keys(BENCH_ANGLE).forEach(function (angle) {
    const label = angle === 'Flat' ? '' : angle + ' ';
    const name = (EQUIP[eq].prefix + ' ' + label + 'Bench Press').trim();
    add(name, eq, angle === 'Incline' ? 'incline-push' : 'horizontal-push',
        shift(shift(BENCH, BENCH_ANGLE[angle]), EQUIP_SHIFT[eq]));
  });
});

add('Close-Grip Bench Press', 'barbell', 'horizontal-push',
    shift(BENCH, { triceps_lat: 14, triceps_long: 12, pec_mid: -12, pec_upper: -3 }));
add('Wide-Grip Bench Press', 'barbell', 'horizontal-push',
    shift(BENCH, { pec_mid: 10, triceps_lat: -7, triceps_long: -5 }));
add('Reverse-Grip Bench Press', 'barbell', 'incline-push',
    shift(BENCH, { pec_upper: 16, triceps_lat: 4, pec_lower: -8 }));
add('Floor Press', 'barbell', 'horizontal-push',
    shift(BENCH, { triceps_lat: 8, triceps_long: 6, pec_mid: -8 }));
add('Dumbbell Floor Press', 'dumbbell', 'horizontal-push',
    shift(BENCH, { triceps_lat: 7, triceps_long: 6, pec_mid: -7 }));
add('Board Press', 'barbell', 'horizontal-push',
    shift(BENCH, { triceps_lat: 10, triceps_long: 8, pec_mid: -10 }));
add('Spoto Press', 'barbell', 'horizontal-push', shift(BENCH, { pec_mid: 4 }));
add('Pin Press', 'barbell', 'horizontal-push',
    shift(BENCH, { triceps_lat: 9, triceps_long: 7, pec_mid: -8 }));
add('Larsen Press', 'barbell', 'horizontal-push', shift(BENCH, { pec_mid: 3, quad_rectus: -1 }));
add('Dumbbell Squeeze Press', 'dumbbell', 'horizontal-push',
    shift(BENCH, { pec_mid: 12, pec_lower: 4, triceps_lat: -6 }));
add('Guillotine Press', 'barbell', 'horizontal-push',
    shift(BENCH, { pec_upper: 12, pec_mid: 6, triceps_lat: -8 }));

/* --- presses on a machine / cable ----------------------------------------- */
add('Hammer Strength Chest Press', 'machine', 'horizontal-push',
    shift(BENCH, { pec_mid: 6, erector: -2 }));
add('Seated Machine Chest Press', 'machine', 'horizontal-push', shift(BENCH, { pec_mid: 4 }));
add('Incline Hammer Strength Press', 'machine', 'incline-push',
    shift(shift(BENCH, BENCH_ANGLE.Incline), { pec_upper: 4 }));
add('Cable Chest Press', 'cable', 'horizontal-push', shift(BENCH, { serratus: 4, pec_mid: 2 }));
add('Incline Cable Press', 'cable', 'incline-push', shift(BENCH, BENCH_ANGLE.Incline));
add('Decline Cable Press', 'cable', 'horizontal-push', shift(BENCH, BENCH_ANGLE.Decline));
add('Landmine Press', 'landmine', 'incline-push',
    shift(BENCH, { pec_upper: 14, delt_front: 10, serratus: 6, pec_lower: -10, pec_mid: -8 }));
add('Landmine Chest Press', 'landmine', 'horizontal-push',
    shift(BENCH, { pec_upper: 8, serratus: 5 }));

/* --- flyes ---------------------------------------------------------------- */
const FLY = { pec_mid: 52, pec_lower: 16, pec_upper: 12, delt_front: 12, biceps: 4, serratus: 4 };
const FLY_ANGLE = {
  '':         {},
  'Incline ': { pec_upper: 22, pec_lower: -12, pec_mid: -10 },
  'Decline ': { pec_lower: 16, pec_upper: -8 }
};
['dumbbell', 'cable', 'machine'].forEach(function (eq) {
  Object.keys(FLY_ANGLE).forEach(function (angle) {
    const base = eq === 'machine' ? 'Pec Deck' : 'Fly';
    if (eq === 'machine' && angle === 'Decline ') return;
    const name = (EQUIP[eq].prefix + ' ' + angle + base).trim();
    add(name, eq, 'chest-isolation', shift(shift(FLY, FLY_ANGLE[angle]), EQUIP_SHIFT[eq]));
  });
});
add('Cable Crossover (High to Low)', 'cable', 'chest-isolation',
    shift(FLY, { pec_lower: 18, pec_upper: -8 }));
add('Cable Crossover (Low to High)', 'cable', 'chest-isolation',
    shift(FLY, { pec_upper: 20, pec_lower: -10 }));
add('Standing Cable Fly', 'cable', 'chest-isolation', shift(FLY, { abs_upper: 4, oblique: 3 }));
add('Svend Press', 'plate', 'chest-isolation',
    shift(FLY, { pec_mid: 14, delt_front: 6, biceps: -4 }));

/* --- push-ups & dips ------------------------------------------------------ */
const PUSHUP = { pec_mid: 30, pec_lower: 10, pec_upper: 8, delt_front: 16, triceps_lat: 14,
                 triceps_long: 10, serratus: 6, abs_upper: 4, abs_lower: 2 };
add('Push-Up', 'bodyweight', 'horizontal-push', shift(PUSHUP, {}));
add('Wide-Grip Push-Up', 'bodyweight', 'horizontal-push', shift(PUSHUP, { pec_mid: 8, triceps_lat: -6 }));
add('Diamond Push-Up', 'bodyweight', 'horizontal-push',
    shift(PUSHUP, { triceps_lat: 14, triceps_long: 10, pec_mid: -12 }));
add('Decline Push-Up', 'bodyweight', 'incline-push',
    shift(PUSHUP, { pec_upper: 12, delt_front: 6, pec_lower: -6 }));
add('Incline Push-Up', 'bodyweight', 'horizontal-push', shift(PUSHUP, { pec_lower: 8, pec_upper: -4 }));
add('Archer Push-Up', 'bodyweight', 'horizontal-push',
    shift(PUSHUP, { pec_mid: 8, oblique: 4 }), { unilateral: true });
add('Pseudo Planche Push-Up', 'bodyweight', 'horizontal-push',
    shift(PUSHUP, { delt_front: 14, serratus: 6, abs_upper: 4 }));
add('Deficit Push-Up', 'bodyweight', 'horizontal-push', shift(PUSHUP, { pec_mid: 8 }));
add('Plyometric Push-Up', 'bodyweight', 'horizontal-push', shift(PUSHUP, { pec_mid: 4, triceps_lat: 4 }));
add('Ring Push-Up', 'suspension', 'horizontal-push', shift(PUSHUP, EQUIP_SHIFT.suspension));
add('Suspension Chest Press', 'suspension', 'horizontal-push', shift(PUSHUP, EQUIP_SHIFT.suspension));
add('Banded Push-Up', 'band', 'horizontal-push', shift(PUSHUP, { triceps_lat: 4 }));

const DIP = { pec_lower: 26, pec_mid: 16, triceps_lat: 20, triceps_long: 16, delt_front: 14,
              serratus: 5, trap_lower: 3 };
add('Chest Dip', 'bodyweight', 'vertical-push', shift(DIP, { pec_lower: 8, triceps_lat: -6 }));
add('Triceps Dip', 'bodyweight', 'vertical-push',
    shift(DIP, { triceps_lat: 12, triceps_long: 10, pec_lower: -14, pec_mid: -8 }));
add('Machine Assisted Dip', 'machine', 'vertical-push', shift(DIP, {}));
add('Weighted Dip', 'bodyweight', 'vertical-push', shift(DIP, { triceps_lat: 3 }));
add('Bench Dip', 'bodyweight', 'vertical-push',
    shift(DIP, { triceps_lat: 14, triceps_long: 12, pec_lower: -14, pec_mid: -10 }));
add('Ring Dip', 'suspension', 'vertical-push', shift(DIP, { rotator_cuff: 6, serratus: 4 }));

add('Dumbbell Pullover', 'dumbbell', 'chest-isolation',
    { pec_mid: 26, pec_lower: 10, lat: 30, teres_major: 8, triceps_long: 14, serratus: 8, abs_upper: 4 });
add('Barbell Pullover', 'barbell', 'chest-isolation',
    { pec_mid: 24, pec_lower: 9, lat: 32, teres_major: 8, triceps_long: 15, serratus: 8, abs_upper: 4 });
add('Cable Pullover', 'cable', 'back-isolation',
    { lat: 44, teres_major: 12, pec_mid: 14, triceps_long: 16, serratus: 8, abs_upper: 6 });

/* =============================================================================
   BACK — vertical pull
   ============================================================================= */

const PULLUP = { lat: 40, teres_major: 10, trap_mid: 8, trap_lower: 6, rhomboid: 7,
                 biceps: 12, brachialis: 8, forearm_flex: 5, delt_rear: 4 };
const GRIP = {
  '':                  {},
  'Wide-Grip ':        { lat: 8, biceps: -5, brachialis: -3 },
  'Close-Grip ':       { biceps: 6, brachialis: 4, lat: -6 },
  'Neutral-Grip ':     { brachialis: 8, biceps: 2, lat: -4 },
  'Reverse-Grip ':     { biceps: 10, lat: -6, brachialis: 2 }
};

Object.keys(GRIP).forEach(function (g) {
  add(g + 'Pull-Up', 'bodyweight', 'vertical-pull', shift(PULLUP, GRIP[g]));
});
add('Chin-Up', 'bodyweight', 'vertical-pull', shift(PULLUP, GRIP['Reverse-Grip ']));
add('Weighted Pull-Up', 'bodyweight', 'vertical-pull', shift(PULLUP, {}));
add('Assisted Pull-Up', 'machine', 'vertical-pull', shift(PULLUP, {}));
add('Band-Assisted Pull-Up', 'band', 'vertical-pull', shift(PULLUP, {}));
add('Commando Pull-Up', 'bodyweight', 'vertical-pull', shift(PULLUP, { oblique: 8, biceps: 4 }));
add('Archer Pull-Up', 'bodyweight', 'vertical-pull',
    shift(PULLUP, { lat: 6, oblique: 5 }), { unilateral: true });
add('Ring Pull-Up', 'suspension', 'vertical-pull', shift(PULLUP, { rotator_cuff: 5, biceps: 3 }));
add('Muscle-Up', 'bodyweight', 'vertical-pull',
    shift(PULLUP, { triceps_lat: 12, triceps_long: 8, delt_front: 6, abs_upper: 5 }));

Object.keys(GRIP).forEach(function (g) {
  add(g + 'Lat Pulldown', 'cable', 'vertical-pull', shift(PULLUP, GRIP[g]));
});
add('Behind-the-Neck Lat Pulldown', 'cable', 'vertical-pull',
    shift(PULLUP, { trap_mid: 6, rhomboid: 5, rotator_cuff: 4, biceps: -4 }));
add('Single-Arm Lat Pulldown', 'cable', 'vertical-pull',
    shift(PULLUP, { oblique: 6, lat: 4 }), { unilateral: true });
add('Kneeling Lat Pulldown', 'cable', 'vertical-pull', shift(PULLUP, { abs_upper: 4 }));
add('Machine Pulldown', 'machine', 'vertical-pull', shift(PULLUP, EQUIP_SHIFT.machine));
add('Straight-Arm Pulldown', 'cable', 'back-isolation',
    { lat: 48, teres_major: 14, triceps_long: 16, delt_rear: 8, abs_upper: 8, trap_lower: 6 });
add('Rope Straight-Arm Pulldown', 'cable', 'back-isolation',
    { lat: 46, teres_major: 14, triceps_long: 15, delt_rear: 9, abs_upper: 8, trap_lower: 8 });

/* =============================================================================
   BACK — horizontal pull (rows)
   ============================================================================= */

const ROW = { lat: 28, rhomboid: 16, trap_mid: 15, trap_lower: 7, delt_rear: 10,
              teres_major: 7, biceps: 9, brachialis: 4, erector: 4 };

add('Barbell Bent-Over Row', 'barbell', 'horizontal-pull', shift(ROW, { erector: 8, ham_biceps: 3 }));
add('Pendlay Row', 'barbell', 'horizontal-pull', shift(ROW, { erector: 8, trap_mid: 5 }));
add('Yates Row', 'barbell', 'horizontal-pull', shift(ROW, { lat: 8, biceps: 4, erector: 4 }));
add('Underhand Barbell Row', 'barbell', 'horizontal-pull', shift(ROW, { lat: 8, biceps: 8, delt_rear: -5 }));
add('Seal Row', 'barbell', 'horizontal-pull', shift(ROW, { erector: -4, rhomboid: 6, trap_mid: 5 }));
add('Chest-Supported Row', 'dumbbell', 'horizontal-pull', shift(ROW, { erector: -4, rhomboid: 7, trap_mid: 5 }));
add('T-Bar Row', 'barbell', 'horizontal-pull', shift(ROW, { lat: 6, trap_mid: 4, erector: 5 }));
add('Chest-Supported T-Bar Row', 'machine', 'horizontal-pull', shift(ROW, { rhomboid: 8, erector: -5 }));
add('Meadows Row', 'landmine', 'horizontal-pull',
    shift(ROW, { lat: 8, oblique: 5, erector: 3 }), { unilateral: true });
add('Landmine Row', 'landmine', 'horizontal-pull', shift(ROW, { lat: 6, erector: 4 }));
add('Dumbbell Row', 'dumbbell', 'horizontal-pull',
    shift(ROW, { lat: 8, oblique: 4 }), { unilateral: true });
add('Dumbbell Bent-Over Row', 'dumbbell', 'horizontal-pull', shift(ROW, { erector: 6 }));
add('Incline Dumbbell Row', 'dumbbell', 'horizontal-pull', shift(ROW, { rhomboid: 8, trap_mid: 6, erector: -5 }));
add('Kroc Row', 'dumbbell', 'horizontal-pull',
    shift(ROW, { lat: 8, forearm_flex: 6, oblique: 5 }), { unilateral: true });
add('Seated Cable Row', 'cable', 'horizontal-pull', shift(ROW, { rhomboid: 6, trap_mid: 4 }));
add('Wide-Grip Seated Cable Row', 'cable', 'horizontal-pull',
    shift(ROW, { delt_rear: 8, rhomboid: 8, lat: -6 }));
add('Single-Arm Cable Row', 'cable', 'horizontal-pull',
    shift(ROW, { oblique: 6, lat: 4 }), { unilateral: true });
add('Standing Cable Row', 'cable', 'horizontal-pull', shift(ROW, { erector: 6, abs_upper: 4 }));
add('Machine Seated Row', 'machine', 'horizontal-pull', shift(ROW, EQUIP_SHIFT.machine));
add('Hammer Strength Row', 'machine', 'horizontal-pull', shift(ROW, { lat: 6, erector: -4 }));
add('Smith Machine Row', 'smith', 'horizontal-pull', shift(ROW, EQUIP_SHIFT.smith));
add('Inverted Row', 'bodyweight', 'horizontal-pull',
    shift(ROW, { rhomboid: 6, abs_upper: 6, glute_max: 3 }));
add('Ring Row', 'suspension', 'horizontal-pull', shift(ROW, { rhomboid: 6, abs_upper: 7 }));
add('Suspension Row', 'suspension', 'horizontal-pull', shift(ROW, { rhomboid: 6, abs_upper: 7 }));
add('Kettlebell Row', 'kettlebell', 'horizontal-pull',
    shift(ROW, { forearm_flex: 5 }), { unilateral: true });
add('Band Row', 'band', 'horizontal-pull', shift(ROW, {}));
add('Renegade Row', 'dumbbell', 'horizontal-pull',
    shift(ROW, { abs_upper: 12, oblique: 10, delt_front: 5 }), { unilateral: true });

/* --- rear delt / upper back detail ---------------------------------------- */
const FACEPULL = { delt_rear: 34, trap_mid: 18, rhomboid: 14, rotator_cuff: 18,
                   trap_lower: 8, trap_upper: 4, biceps: 4 };
add('Face Pull', 'cable', 'back-isolation', FACEPULL);
add('Band Face Pull', 'band', 'back-isolation', shift(FACEPULL, {}));
add('Rope Face Pull', 'cable', 'back-isolation', shift(FACEPULL, { rotator_cuff: 4 }));
add('Reverse Pec Deck', 'machine', 'back-isolation',
    { delt_rear: 46, rhomboid: 18, trap_mid: 20, rotator_cuff: 10, trap_lower: 6 });
add('Bent-Over Dumbbell Reverse Fly', 'dumbbell', 'back-isolation',
    { delt_rear: 44, rhomboid: 18, trap_mid: 18, rotator_cuff: 8, erector: 6, trap_lower: 6 });
add('Cable Reverse Fly', 'cable', 'back-isolation',
    { delt_rear: 46, rhomboid: 17, trap_mid: 18, rotator_cuff: 11, trap_lower: 8 });
add('Prone Incline Reverse Fly', 'dumbbell', 'back-isolation',
    { delt_rear: 45, rhomboid: 20, trap_mid: 20, rotator_cuff: 9, trap_lower: 6 });
add('Band Pull-Apart', 'band', 'back-isolation',
    { delt_rear: 36, rhomboid: 24, trap_mid: 24, rotator_cuff: 10, trap_lower: 6 });
add('Scapular Pull-Up', 'bodyweight', 'back-isolation',
    { trap_lower: 30, trap_mid: 22, rhomboid: 20, lat: 18, forearm_flex: 10 });
add('Prone Y Raise', 'dumbbell', 'back-isolation',
    { trap_lower: 34, trap_mid: 22, delt_rear: 18, rhomboid: 16, rotator_cuff: 10 });
add('Cable External Rotation', 'cable', 'back-isolation',
    { rotator_cuff: 62, delt_rear: 20, trap_mid: 12, rhomboid: 6 });
add('Dumbbell External Rotation', 'dumbbell', 'back-isolation',
    { rotator_cuff: 64, delt_rear: 19, trap_mid: 11, rhomboid: 6 });
add('Cuban Press', 'dumbbell', 'back-isolation',
    { rotator_cuff: 34, delt_side: 20, delt_rear: 16, trap_upper: 14, trap_mid: 10, delt_front: 6 });

/* --- shrugs --------------------------------------------------------------- */
const SHRUG = { trap_upper: 62, trap_mid: 16, forearm_flex: 12, delt_side: 5, splenius: 5 };
['barbell', 'dumbbell', 'smith', 'cable', 'trapbar', 'machine', 'kettlebell'].forEach(function (eq) {
  add((EQUIP[eq].prefix + ' Shrug').trim(), eq, 'back-isolation', shift(SHRUG, EQUIP_SHIFT[eq]));
});
add('Behind-the-Back Barbell Shrug', 'barbell', 'back-isolation', shift(SHRUG, { trap_mid: 8 }));
add('Incline Dumbbell Shrug', 'dumbbell', 'back-isolation',
    { trap_mid: 34, trap_lower: 24, trap_upper: 24, rhomboid: 12, forearm_flex: 6 });
add('Overhead Shrug', 'barbell', 'back-isolation',
    { trap_upper: 44, trap_mid: 18, trap_lower: 16, delt_side: 12, rotator_cuff: 10 });

/* =============================================================================
   DEADLIFTS / HINGE
   ============================================================================= */

const DEADLIFT = { erector: 20, glute_max: 20, ham_biceps: 15, ham_semi: 12, quad_rectus: 7,
                   quad_lateral: 6, trap_upper: 6, lat: 6, forearm_flex: 5, adductor: 3 };

add('Barbell Deadlift', 'barbell', 'hinge', DEADLIFT);
add('Conventional Deadlift', 'barbell', 'hinge', shift(DEADLIFT, {}));
add('Sumo Deadlift', 'barbell', 'hinge',
    shift(DEADLIFT, { adductor: 12, quad_rectus: 6, quad_lateral: 5, glute_med: 6, erector: -6, ham_biceps: -4 }));
add('Trap Bar Deadlift', 'trapbar', 'hinge',
    shift(DEADLIFT, { quad_rectus: 8, quad_lateral: 7, erector: -5, ham_biceps: -3 }));
add('Deficit Deadlift', 'barbell', 'hinge', shift(DEADLIFT, { quad_rectus: 5, erector: 4 }));
add('Rack Pull', 'barbell', 'hinge',
    shift(DEADLIFT, { erector: 8, trap_upper: 8, glute_max: 4, quad_rectus: -6, quad_lateral: -5 }));
add('Block Pull', 'barbell', 'hinge', shift(DEADLIFT, { erector: 6, trap_upper: 5, quad_rectus: -4 }));
add('Snatch-Grip Deadlift', 'barbell', 'hinge',
    shift(DEADLIFT, { trap_upper: 10, trap_mid: 8, erector: 5, forearm_flex: 5 }));
add('Romanian Deadlift', 'barbell', 'hinge',
    { ham_biceps: 26, ham_semi: 22, glute_max: 22, erector: 16, forearm_flex: 6, lat: 5, adductor: 3 });
add('Dumbbell Romanian Deadlift', 'dumbbell', 'hinge',
    { ham_biceps: 26, ham_semi: 22, glute_max: 21, erector: 15, forearm_flex: 7, lat: 5, adductor: 4 });
add('Single-Leg Romanian Deadlift', 'dumbbell', 'hinge',
    { ham_biceps: 25, ham_semi: 21, glute_max: 22, glute_med: 10, erector: 12, oblique: 6, forearm_flex: 4 },
    { unilateral: true });
add('Stiff-Leg Deadlift', 'barbell', 'hinge',
    { ham_biceps: 28, ham_semi: 24, glute_max: 18, erector: 18, forearm_flex: 6, lat: 6 });
add('Good Morning', 'barbell', 'hinge',
    { ham_biceps: 26, ham_semi: 22, erector: 26, glute_max: 20, adductor: 6 });
add('Seated Good Morning', 'barbell', 'hinge',
    { erector: 40, ham_biceps: 18, ham_semi: 15, glute_max: 17, trap_mid: 10 });
add('Kettlebell Swing', 'kettlebell', 'hinge',
    { glute_max: 30, ham_biceps: 20, ham_semi: 17, erector: 16, delt_front: 6, abs_upper: 6, forearm_flex: 5 });
add('Kettlebell Deadlift', 'kettlebell', 'hinge', shift(DEADLIFT, EQUIP_SHIFT.kettlebell));
add('Cable Pull-Through', 'cable', 'hinge',
    { glute_max: 38, ham_biceps: 22, ham_semi: 18, erector: 14, abs_upper: 8 });
add('Back Extension', 'bodyweight', 'hinge',
    { erector: 40, glute_max: 26, ham_biceps: 17, ham_semi: 14, trap_lower: 3 });
add('45-Degree Back Extension', 'bodyweight', 'hinge',
    { erector: 36, glute_max: 28, ham_biceps: 18, ham_semi: 15, trap_lower: 3 });
add('Reverse Hyperextension', 'machine', 'hinge',
    { glute_max: 36, ham_biceps: 22, ham_semi: 18, erector: 24 });
add('Nordic Hamstring Curl', 'bodyweight', 'hinge',
    { ham_biceps: 38, ham_semi: 34, calf_gastro: 10, glute_max: 10, erector: 8 });
add('Glute-Ham Raise', 'bodyweight', 'hinge',
    { ham_biceps: 34, ham_semi: 30, glute_max: 16, erector: 14, calf_gastro: 6 });

/* =============================================================================
   SHOULDERS
   ============================================================================= */

const OHP = { delt_front: 34, delt_side: 22, triceps_lat: 16, triceps_long: 11,
              trap_upper: 8, pec_upper: 5, abs_upper: 4 };

['barbell', 'dumbbell', 'smith', 'machine'].forEach(function (eq) {
  add((EQUIP[eq].prefix + ' Overhead Press').trim(), eq, 'vertical-push',
      shift(OHP, EQUIP_SHIFT[eq]));
  add((EQUIP[eq].prefix + ' Seated Shoulder Press').trim(), eq, 'vertical-push',
      shift(shift(OHP, { abs_upper: -3, erector: -2 }), EQUIP_SHIFT[eq]));
});
add('Standing Military Press', 'barbell', 'vertical-push',
    shift(OHP, { abs_upper: 5, erector: 4, glute_max: 3 }));
add('Push Press', 'barbell', 'vertical-push',
    shift(OHP, { quad_rectus: 8, quad_lateral: 6, glute_max: 6, calf_gastro: 4, triceps_lat: -4 }));
add('Push Jerk', 'barbell', 'vertical-push',
    shift(OHP, { quad_rectus: 10, quad_lateral: 8, glute_max: 7, calf_gastro: 5, triceps_lat: -5 }));
add('Behind-the-Neck Press', 'barbell', 'vertical-push',
    shift(OHP, { delt_side: 12, rotator_cuff: 6, delt_front: -10 }));
add('Arnold Press', 'dumbbell', 'vertical-push',
    shift(OHP, { delt_side: 10, rotator_cuff: 6, delt_front: -4 }));
add('Z Press', 'barbell', 'vertical-push',
    shift(OHP, { abs_upper: 10, erector: 8, oblique: 5 }));
add('Single-Arm Dumbbell Press', 'dumbbell', 'vertical-push',
    shift(OHP, { oblique: 10, abs_upper: 5 }), { unilateral: true });
add('Kettlebell Overhead Press', 'kettlebell', 'vertical-push', shift(OHP, EQUIP_SHIFT.kettlebell));
add('Bottoms-Up Kettlebell Press', 'kettlebell', 'vertical-push',
    shift(OHP, { forearm_flex: 14, rotator_cuff: 8 }));
add('Landmine Shoulder Press', 'landmine', 'vertical-push',
    shift(OHP, { pec_upper: 10, oblique: 5, delt_side: -6 }));
add('Pike Push-Up', 'bodyweight', 'vertical-push',
    shift(OHP, { triceps_lat: 8, serratus: 6, abs_upper: 4 }));
add('Handstand Push-Up', 'bodyweight', 'vertical-push',
    shift(OHP, { triceps_lat: 10, triceps_long: 6, abs_upper: 6, serratus: 5 }));
add('Cable Overhead Press', 'cable', 'vertical-push', shift(OHP, {}));
add('Band Overhead Press', 'band', 'vertical-push', shift(OHP, {}));

/* --- lateral raises ------------------------------------------------------- */
const LATRAISE = { delt_side: 62, delt_front: 14, trap_upper: 12, rotator_cuff: 8, delt_rear: 4 };
['dumbbell', 'cable', 'machine', 'band', 'kettlebell'].forEach(function (eq) {
  add((EQUIP[eq].prefix + ' Lateral Raise').trim(), eq, 'shoulder-isolation',
      shift(LATRAISE, EQUIP_SHIFT[eq]));
});
add('Seated Dumbbell Lateral Raise', 'dumbbell', 'shoulder-isolation',
    shift(LATRAISE, { trap_upper: -4, delt_side: 4 }));
add('Leaning Cable Lateral Raise', 'cable', 'shoulder-isolation',
    shift(LATRAISE, { delt_side: 8, trap_upper: -4 }), { unilateral: true });
add('Lu Raise', 'dumbbell', 'shoulder-isolation',
    shift(LATRAISE, { trap_upper: 14, delt_side: -6, rotator_cuff: 4 }));
add('Incline Lateral Raise', 'dumbbell', 'shoulder-isolation', shift(LATRAISE, { delt_side: 6 }));
add('Partial Lateral Raise', 'dumbbell', 'shoulder-isolation', shift(LATRAISE, { delt_side: 4 }));
add('Plate Lateral Raise', 'plate', 'shoulder-isolation', shift(LATRAISE, {}));

const FRONTRAISE = { delt_front: 60, pec_upper: 14, delt_side: 12, trap_upper: 8, biceps: 6 };
['dumbbell', 'cable', 'barbell', 'plate', 'band'].forEach(function (eq) {
  add((EQUIP[eq].prefix + ' Front Raise').trim(), eq, 'shoulder-isolation',
      shift(FRONTRAISE, EQUIP_SHIFT[eq]));
});
add('Incline Front Raise', 'dumbbell', 'shoulder-isolation', shift(FRONTRAISE, { delt_front: 6 }));

const UPRIGHT = { delt_side: 36, trap_upper: 26, delt_front: 14, biceps: 10, brachialis: 8, rotator_cuff: 6 };
['barbell', 'dumbbell', 'cable', 'smith', 'ezbar'].forEach(function (eq) {
  add((EQUIP[eq].prefix + ' Upright Row').trim(), eq, 'shoulder-isolation',
      shift(UPRIGHT, EQUIP_SHIFT[eq]));
});
add('Wide-Grip Upright Row', 'barbell', 'shoulder-isolation',
    shift(UPRIGHT, { delt_side: 10, trap_upper: -6, biceps: -4 }));

/* =============================================================================
   ARMS — biceps
   ============================================================================= */

const CURL = { biceps: 56, brachialis: 24, forearm_flex: 14, delt_front: 6 };

['barbell', 'dumbbell', 'ezbar', 'cable', 'machine', 'band', 'kettlebell'].forEach(function (eq) {
  add((EQUIP[eq].prefix + ' Curl').trim(), eq, 'biceps-isolation', shift(CURL, EQUIP_SHIFT[eq]));
});
add('Bicep Curl', 'dumbbell', 'biceps-isolation', shift(CURL, {}));
add('Alternating Dumbbell Curl', 'dumbbell', 'biceps-isolation', shift(CURL, {}), { unilateral: true });
add('Hammer Curl', 'dumbbell', 'biceps-isolation',
    { brachialis: 46, biceps: 32, forearm_flex: 18, delt_front: 4 });
add('Cross-Body Hammer Curl', 'dumbbell', 'biceps-isolation',
    { brachialis: 48, biceps: 30, forearm_flex: 18, delt_front: 4 });
add('Rope Hammer Curl', 'cable', 'biceps-isolation',
    { brachialis: 45, biceps: 32, forearm_flex: 19, delt_front: 4 });
add('Preacher Curl', 'ezbar', 'biceps-isolation',
    { biceps: 62, brachialis: 26, forearm_flex: 12 });
add('Dumbbell Preacher Curl', 'dumbbell', 'biceps-isolation',
    { biceps: 61, brachialis: 26, forearm_flex: 13 });
add('Machine Preacher Curl', 'machine', 'biceps-isolation',
    { biceps: 64, brachialis: 24, forearm_flex: 12 });
add('Incline Dumbbell Curl', 'dumbbell', 'biceps-isolation',
    { biceps: 66, brachialis: 20, forearm_flex: 11, delt_front: 3 });
add('Spider Curl', 'ezbar', 'biceps-isolation',
    { biceps: 64, brachialis: 24, forearm_flex: 12 });
add('Concentration Curl', 'dumbbell', 'biceps-isolation',
    { biceps: 66, brachialis: 22, forearm_flex: 12 }, { unilateral: true });
add('Drag Curl', 'barbell', 'biceps-isolation',
    { biceps: 58, brachialis: 24, forearm_flex: 12, delt_rear: 6 });
add('21s Curl', 'barbell', 'biceps-isolation', shift(CURL, {}));
add('Zottman Curl', 'dumbbell', 'biceps-isolation',
    { biceps: 40, brachialis: 26, forearm_flex: 17, forearm_ext: 17 });
add('Reverse Curl', 'ezbar', 'biceps-isolation',
    { brachialis: 44, forearm_ext: 28, biceps: 20, forearm_flex: 8 });
add('Reverse Cable Curl', 'cable', 'biceps-isolation',
    { brachialis: 43, forearm_ext: 29, biceps: 20, forearm_flex: 8 });
add('Bayesian Cable Curl', 'cable', 'biceps-isolation',
    { biceps: 66, brachialis: 21, forearm_flex: 13 });
add('High Cable Curl', 'cable', 'biceps-isolation',
    { biceps: 64, brachialis: 22, forearm_flex: 11, delt_front: 3 });
add('Chin-Up Curl', 'bodyweight', 'biceps-isolation',
    { biceps: 40, brachialis: 20, lat: 24, forearm_flex: 10, teres_major: 6 });
add('Suspension Curl', 'suspension', 'biceps-isolation',
    { biceps: 52, brachialis: 22, forearm_flex: 14, abs_upper: 12 });

/* =============================================================================
   ARMS — triceps
   ============================================================================= */

const PUSHDOWN = { triceps_lat: 48, triceps_long: 34, forearm_ext: 10, delt_rear: 4, abs_upper: 4 };
add('Cable Triceps Pushdown', 'cable', 'triceps-isolation', PUSHDOWN);
add('Rope Pushdown', 'cable', 'triceps-isolation', shift(PUSHDOWN, { triceps_lat: 6 }));
add('V-Bar Pushdown', 'cable', 'triceps-isolation', shift(PUSHDOWN, { triceps_lat: 4 }));
add('Straight-Bar Pushdown', 'cable', 'triceps-isolation', shift(PUSHDOWN, {}));
add('Reverse-Grip Pushdown', 'cable', 'triceps-isolation',
    shift(PUSHDOWN, { triceps_lat: 8, forearm_ext: 4 }));
add('Single-Arm Pushdown', 'cable', 'triceps-isolation',
    shift(PUSHDOWN, {}), { unilateral: true });
add('Overhead Cable Triceps Extension', 'cable', 'triceps-isolation',
    { triceps_long: 54, triceps_lat: 30, forearm_ext: 8, abs_upper: 8 });
add('Overhead Dumbbell Triceps Extension', 'dumbbell', 'triceps-isolation',
    { triceps_long: 55, triceps_lat: 29, forearm_ext: 8, abs_upper: 8 });
add('Single-Arm Overhead Extension', 'dumbbell', 'triceps-isolation',
    { triceps_long: 56, triceps_lat: 28, forearm_ext: 8, oblique: 8 }, { unilateral: true });
add('EZ Bar Skull Crusher', 'ezbar', 'triceps-isolation',
    { triceps_long: 44, triceps_lat: 42, forearm_ext: 8, pec_mid: 6 });
add('Barbell Skull Crusher', 'barbell', 'triceps-isolation',
    { triceps_long: 43, triceps_lat: 43, forearm_ext: 8, pec_mid: 6 });
add('Dumbbell Skull Crusher', 'dumbbell', 'triceps-isolation',
    { triceps_long: 44, triceps_lat: 41, forearm_ext: 9, pec_mid: 6 });
add('Incline Skull Crusher', 'ezbar', 'triceps-isolation',
    { triceps_long: 50, triceps_lat: 38, forearm_ext: 7, pec_mid: 5 });
add('JM Press', 'barbell', 'triceps-isolation',
    { triceps_lat: 44, triceps_long: 34, pec_mid: 12, delt_front: 10 });
add('Tate Press', 'dumbbell', 'triceps-isolation',
    { triceps_lat: 50, triceps_long: 34, pec_mid: 10, delt_front: 6 });
add('Dumbbell Kickback', 'dumbbell', 'triceps-isolation',
    { triceps_lat: 46, triceps_long: 38, delt_rear: 10, forearm_ext: 6 });
add('Cable Kickback', 'cable', 'triceps-isolation',
    { triceps_lat: 46, triceps_long: 38, delt_rear: 10, forearm_ext: 6 });
add('Machine Triceps Extension', 'machine', 'triceps-isolation',
    { triceps_lat: 50, triceps_long: 36, forearm_ext: 14 });
add('Band Pushdown', 'band', 'triceps-isolation', shift(PUSHDOWN, {}));
add('Suspension Triceps Extension', 'suspension', 'triceps-isolation',
    { triceps_long: 42, triceps_lat: 34, abs_upper: 14, delt_front: 10 });
add('Close-Grip Push-Up', 'bodyweight', 'triceps-isolation',
    { triceps_lat: 36, triceps_long: 26, pec_mid: 20, delt_front: 12, abs_upper: 6 });
add('California Press', 'barbell', 'triceps-isolation',
    { triceps_lat: 38, triceps_long: 30, pec_mid: 18, delt_front: 14 });

/* --- forearms ------------------------------------------------------------- */
add('Barbell Wrist Curl', 'barbell', 'forearm-isolation', { forearm_flex: 84, biceps: 8, brachialis: 8 });
add('Dumbbell Wrist Curl', 'dumbbell', 'forearm-isolation', { forearm_flex: 84, biceps: 8, brachialis: 8 });
add('Cable Wrist Curl', 'cable', 'forearm-isolation', { forearm_flex: 85, biceps: 7, brachialis: 8 });
add('Behind-the-Back Wrist Curl', 'barbell', 'forearm-isolation', { forearm_flex: 88, brachialis: 12 });
add('Reverse Wrist Curl', 'barbell', 'forearm-isolation', { forearm_ext: 86, brachialis: 14 });
add('Dumbbell Reverse Wrist Curl', 'dumbbell', 'forearm-isolation', { forearm_ext: 86, brachialis: 14 });
add('Wrist Roller', 'other', 'forearm-isolation', { forearm_flex: 46, forearm_ext: 42, delt_front: 12 });
add('Farmer Carry', 'dumbbell', 'carry',
    { forearm_flex: 26, trap_upper: 22, erector: 14, oblique: 12, abs_upper: 10, quad_rectus: 8, calf_gastro: 8 });
add('Suitcase Carry', 'dumbbell', 'carry',
    { oblique: 30, forearm_flex: 22, erector: 16, trap_upper: 14, abs_upper: 10, glute_med: 8 },
    { unilateral: true });
add('Overhead Carry', 'kettlebell', 'carry',
    { delt_side: 26, delt_front: 18, abs_upper: 18, oblique: 14, trap_upper: 14, erector: 10 });
add('Plate Pinch Carry', 'plate', 'carry', { forearm_flex: 74, trap_upper: 14, oblique: 12 });
add('Dead Hang', 'bodyweight', 'carry',
    { forearm_flex: 46, lat: 20, trap_upper: 16, abs_upper: 10, rhomboid: 8 });

/* =============================================================================
   LEGS — squat pattern
   ============================================================================= */

const SQUAT = { quad_rectus: 22, quad_lateral: 20, quad_medial: 14, glute_max: 20,
                adductor: 8, ham_biceps: 6, erector: 6, abs_upper: 2, calf_soleus: 2 };

add('Barbell Back Squat', 'barbell', 'squat', SQUAT);
add('High-Bar Back Squat', 'barbell', 'squat', shift(SQUAT, { quad_rectus: 5, quad_lateral: 4, glute_max: -4 }));
add('Low-Bar Back Squat', 'barbell', 'squat',
    shift(SQUAT, { glute_max: 8, ham_biceps: 5, erector: 5, quad_rectus: -6, quad_lateral: -5 }));
add('Front Squat', 'barbell', 'squat',
    shift(SQUAT, { quad_rectus: 10, quad_lateral: 8, quad_medial: 5, abs_upper: 6, erector: 3, glute_max: -8 }));
add('Zercher Squat', 'barbell', 'squat',
    shift(SQUAT, { quad_rectus: 6, abs_upper: 8, erector: 6, biceps: 5, glute_max: -4 }));
add('Goblet Squat', 'dumbbell', 'squat',
    shift(SQUAT, { quad_rectus: 6, abs_upper: 6, delt_front: 4, erector: -2 }));
add('Kettlebell Goblet Squat', 'kettlebell', 'squat',
    shift(SQUAT, { quad_rectus: 6, abs_upper: 6, delt_front: 4 }));
add('Smith Machine Squat', 'smith', 'squat', shift(SQUAT, EQUIP_SHIFT.smith));
add('Hack Squat', 'machine', 'squat',
    shift(SQUAT, { quad_rectus: 10, quad_lateral: 10, quad_medial: 6, erector: -5, glute_max: -8 }));
add('Barbell Hack Squat', 'barbell', 'squat',
    shift(SQUAT, { quad_lateral: 8, quad_medial: 5, forearm_flex: 5, glute_max: -6 }));
add('Pendulum Squat', 'machine', 'squat',
    shift(SQUAT, { quad_rectus: 10, quad_lateral: 9, quad_medial: 6, erector: -5 }));
add('Belt Squat', 'machine', 'squat',
    shift(SQUAT, { quad_rectus: 8, quad_lateral: 6, erector: -6 }));
add('Box Squat', 'barbell', 'squat', shift(SQUAT, { glute_max: 8, ham_biceps: 4, quad_rectus: -4 }));
add('Pause Squat', 'barbell', 'squat', shift(SQUAT, { quad_rectus: 4, abs_upper: 2 }));
add('Bodyweight Squat', 'bodyweight', 'squat', shift(SQUAT, { abs_upper: 2 }));
add('Jump Squat', 'bodyweight', 'squat',
    shift(SQUAT, { calf_gastro: 10, quad_rectus: 4, glute_max: 2 }));
add('Sissy Squat', 'bodyweight', 'squat',
    { quad_rectus: 34, quad_lateral: 28, quad_medial: 22, hip_flexor: 10, abs_upper: 6 });
add('Pistol Squat', 'bodyweight', 'squat',
    shift(SQUAT, { glute_med: 10, abs_upper: 6, oblique: 5 }), { unilateral: true });
add('Overhead Squat', 'barbell', 'squat',
    shift(SQUAT, { delt_side: 10, trap_upper: 6, abs_upper: 6, rotator_cuff: 5, glute_max: -6 }));
add('Split Squat', 'dumbbell', 'lunge',
    { quad_rectus: 24, quad_lateral: 20, quad_medial: 14, glute_max: 22, glute_med: 8, ham_biceps: 6, adductor: 6 },
    { unilateral: true });
add('Bulgarian Split Squat', 'dumbbell', 'lunge',
    { quad_rectus: 22, quad_lateral: 19, quad_medial: 13, glute_max: 26, glute_med: 9, ham_biceps: 7, adductor: 4 },
    { unilateral: true });
add('Barbell Bulgarian Split Squat', 'barbell', 'lunge',
    { quad_rectus: 22, quad_lateral: 19, quad_medial: 13, glute_max: 26, glute_med: 9, ham_biceps: 7, adductor: 4 },
    { unilateral: true });
add('Smith Machine Split Squat', 'smith', 'lunge',
    { quad_rectus: 25, quad_lateral: 21, quad_medial: 15, glute_max: 24, glute_med: 7, ham_biceps: 8 },
    { unilateral: true });

const LUNGE = { quad_rectus: 22, quad_lateral: 18, quad_medial: 12, glute_max: 24,
                glute_med: 10, ham_biceps: 8, adductor: 6 };
[['Walking Lunge', 'dumbbell'], ['Barbell Lunge', 'barbell'], ['Reverse Lunge', 'dumbbell'],
 ['Forward Lunge', 'dumbbell'], ['Lateral Lunge', 'dumbbell'], ['Curtsy Lunge', 'dumbbell'],
 ['Deficit Reverse Lunge', 'dumbbell'], ['Kettlebell Lunge', 'kettlebell'],
 ['Smith Machine Lunge', 'smith'], ['Bodyweight Lunge', 'bodyweight']].forEach(function (p) {
  let d = {};
  if (/Reverse|Curtsy/.test(p[0])) d = { glute_max: 8, quad_rectus: -5 };
  if (/Lateral/.test(p[0])) d = { adductor: 16, glute_med: 10, quad_rectus: -6 };
  add(p[0], p[1], 'lunge', shift(LUNGE, d), { unilateral: true });
});

add('Step-Up', 'dumbbell', 'lunge',
    { quad_rectus: 24, quad_lateral: 20, quad_medial: 13, glute_max: 24, glute_med: 9, ham_biceps: 7, calf_gastro: 3 },
    { unilateral: true });
add('Barbell Step-Up', 'barbell', 'lunge',
    { quad_rectus: 24, quad_lateral: 20, quad_medial: 13, glute_max: 24, glute_med: 9, ham_biceps: 7, calf_gastro: 3 },
    { unilateral: true });
add('Lateral Step-Up', 'dumbbell', 'lunge',
    { quad_rectus: 22, quad_lateral: 19, quad_medial: 12, glute_max: 20, glute_med: 18, adductor: 6, ham_biceps: 3 },
    { unilateral: true });
add('Box Step-Down', 'bodyweight', 'lunge',
    { quad_rectus: 26, quad_lateral: 22, quad_medial: 16, glute_max: 20, glute_med: 12, ham_biceps: 4 },
    { unilateral: true });

/* --- leg press & machines ------------------------------------------------- */
const LEGPRESS = { quad_rectus: 26, quad_lateral: 24, quad_medial: 16, glute_max: 20,
                   adductor: 8, ham_biceps: 6 };
add('Leg Press', 'machine', 'squat', LEGPRESS);
add('45-Degree Leg Press', 'machine', 'squat', shift(LEGPRESS, {}));
add('Horizontal Leg Press', 'machine', 'squat', shift(LEGPRESS, { quad_rectus: 4 }));
add('Single-Leg Press', 'machine', 'squat',
    shift(LEGPRESS, { glute_med: 8, oblique: 4 }), { unilateral: true });
add('High-Foot Leg Press', 'machine', 'squat',
    shift(LEGPRESS, { glute_max: 12, ham_biceps: 8, quad_rectus: -8, quad_lateral: -7 }));
add('Narrow-Stance Leg Press', 'machine', 'squat',
    shift(LEGPRESS, { quad_lateral: 8, quad_rectus: 4, adductor: -4 }));
add('Wide-Stance Leg Press', 'machine', 'squat',
    shift(LEGPRESS, { adductor: 12, glute_max: 6, quad_lateral: -6 }));

add('Leg Extension', 'machine', 'quad-isolation',
    { quad_rectus: 32, quad_lateral: 30, quad_medial: 30, hip_flexor: 8 });
add('Single-Leg Extension', 'machine', 'quad-isolation',
    { quad_rectus: 32, quad_lateral: 30, quad_medial: 30, hip_flexor: 8 }, { unilateral: true });
add('Reverse Nordic Curl', 'bodyweight', 'quad-isolation',
    { quad_rectus: 34, quad_lateral: 26, quad_medial: 24, hip_flexor: 10, abs_upper: 6 });

add('Lying Leg Curl', 'machine', 'ham-isolation',
    { ham_biceps: 42, ham_semi: 40, calf_gastro: 12, glute_max: 6 });
add('Seated Leg Curl', 'machine', 'ham-isolation',
    { ham_biceps: 43, ham_semi: 41, calf_gastro: 10, glute_max: 6 });
add('Standing Leg Curl', 'machine', 'ham-isolation',
    { ham_biceps: 42, ham_semi: 40, calf_gastro: 12, glute_max: 6 }, { unilateral: true });
add('Single-Leg Lying Curl', 'machine', 'ham-isolation',
    { ham_biceps: 42, ham_semi: 40, calf_gastro: 12, glute_max: 6 }, { unilateral: true });
add('Cable Leg Curl', 'cable', 'ham-isolation',
    { ham_biceps: 42, ham_semi: 40, calf_gastro: 12, glute_max: 6 }, { unilateral: true });
add('Swiss Ball Leg Curl', 'ball', 'ham-isolation',
    { ham_biceps: 34, ham_semi: 32, glute_max: 18, abs_lower: 10, erector: 6 });
add('Slider Leg Curl', 'other', 'ham-isolation',
    { ham_biceps: 34, ham_semi: 32, glute_max: 18, abs_lower: 10, erector: 6 });

/* --- glutes --------------------------------------------------------------- */
add('Barbell Hip Thrust', 'barbell', 'hinge',
    { glute_max: 48, ham_biceps: 18, ham_semi: 14, quad_rectus: 10, adductor: 6, erector: 4 });
add('Smith Machine Hip Thrust', 'smith', 'hinge',
    { glute_max: 50, ham_biceps: 18, ham_semi: 14, quad_rectus: 10, erector: 4, adductor: 4 });
add('Machine Hip Thrust', 'machine', 'hinge',
    { glute_max: 52, ham_biceps: 17, ham_semi: 14, quad_rectus: 10, erector: 3, adductor: 4 });
add('Single-Leg Hip Thrust', 'bodyweight', 'hinge',
    { glute_max: 46, glute_med: 14, ham_biceps: 16, ham_semi: 12, quad_rectus: 8, oblique: 4 },
    { unilateral: true });
add('Glute Bridge', 'bodyweight', 'hinge',
    { glute_max: 50, ham_biceps: 20, ham_semi: 16, erector: 8, quad_rectus: 6 });
add('Barbell Glute Bridge', 'barbell', 'hinge',
    { glute_max: 52, ham_biceps: 19, ham_semi: 15, erector: 8, quad_rectus: 6 });
add('Frog Pump', 'bodyweight', 'hinge',
    { glute_max: 56, adductor: 16, ham_biceps: 14, ham_semi: 10, erector: 4 });
add('Cable Kickback', 'cable', 'glute-isolation',
    { glute_max: 58, ham_biceps: 20, ham_semi: 14, erector: 8 }, { unilateral: true });
add('Machine Glute Kickback', 'machine', 'glute-isolation',
    { glute_max: 60, ham_biceps: 20, ham_semi: 14, erector: 6 }, { unilateral: true });
add('Donkey Kick', 'bodyweight', 'glute-isolation',
    { glute_max: 56, ham_biceps: 18, ham_semi: 14, erector: 12 }, { unilateral: true });
add('Fire Hydrant', 'bodyweight', 'glute-isolation',
    { glute_med: 52, glute_max: 30, oblique: 10, erector: 8 }, { unilateral: true });
add('Hip Abduction Machine', 'machine', 'glute-isolation',
    { glute_med: 58, glute_max: 30, oblique: 6, erector: 6 });
add('Cable Hip Abduction', 'cable', 'glute-isolation',
    { glute_med: 60, glute_max: 28, oblique: 6, erector: 6 }, { unilateral: true });
add('Banded Lateral Walk', 'band', 'glute-isolation',
    { glute_med: 56, glute_max: 26, quad_lateral: 10, adductor: 8 });
add('Clamshell', 'band', 'glute-isolation', { glute_med: 64, glute_max: 26, oblique: 10 });
add('Hip Adduction Machine', 'machine', 'leg-isolation',
    { adductor: 74, glute_med: 12, quad_medial: 14 });
add('Cable Hip Adduction', 'cable', 'leg-isolation',
    { adductor: 72, glute_med: 12, quad_medial: 16 }, { unilateral: true });
add('Copenhagen Plank', 'bodyweight', 'leg-isolation',
    { adductor: 52, oblique: 24, abs_upper: 14, glute_med: 10 }, { unilateral: true });

/* --- calves --------------------------------------------------------------- */
add('Standing Calf Raise', 'machine', 'calf-isolation',
    { calf_gastro: 66, calf_soleus: 26, tibialis: 4, quad_rectus: 4 });
add('Barbell Standing Calf Raise', 'barbell', 'calf-isolation',
    { calf_gastro: 66, calf_soleus: 26, tibialis: 4, erector: 4 });
add('Smith Machine Calf Raise', 'smith', 'calf-isolation',
    { calf_gastro: 67, calf_soleus: 27, tibialis: 6 });
add('Dumbbell Calf Raise', 'dumbbell', 'calf-isolation',
    { calf_gastro: 64, calf_soleus: 26, tibialis: 4, forearm_flex: 6 });
add('Seated Calf Raise', 'machine', 'calf-isolation',
    { calf_soleus: 64, calf_gastro: 30, tibialis: 6 });
add('Leg Press Calf Raise', 'machine', 'calf-isolation',
    { calf_gastro: 62, calf_soleus: 32, tibialis: 6 });
add('Single-Leg Calf Raise', 'bodyweight', 'calf-isolation',
    { calf_gastro: 64, calf_soleus: 28, tibialis: 4, glute_med: 4 }, { unilateral: true });
add('Donkey Calf Raise', 'machine', 'calf-isolation',
    { calf_gastro: 68, calf_soleus: 26, tibialis: 6 });
add('Tibialis Raise', 'bodyweight', 'calf-isolation', { tibialis: 84, calf_soleus: 10, calf_gastro: 6 });
add('Farmer Walk on Toes', 'dumbbell', 'calf-isolation',
    { calf_gastro: 44, calf_soleus: 24, forearm_flex: 16, trap_upper: 10, abs_upper: 6 });

/* --- sled / conditioning -------------------------------------------------- */
add('Sled Push', 'sled', 'squat',
    { quad_rectus: 24, quad_lateral: 20, glute_max: 20, calf_gastro: 12, calf_soleus: 8, abs_upper: 8, delt_front: 8 });
add('Sled Drag', 'sled', 'squat',
    { quad_rectus: 22, quad_lateral: 18, glute_max: 22, ham_biceps: 12, calf_gastro: 10, trap_mid: 8, forearm_flex: 8 });
add('Backward Sled Drag', 'sled', 'squat',
    { quad_rectus: 32, quad_lateral: 26, quad_medial: 18, calf_gastro: 10, glute_max: 8, tibialis: 6 });

/* =============================================================================
   CORE
   ============================================================================= */

add('Plank', 'bodyweight', 'core',
    { abs_upper: 32, abs_lower: 26, oblique: 20, erector: 10, delt_front: 6, serratus: 6 });
add('Side Plank', 'bodyweight', 'core',
    { oblique: 52, abs_upper: 16, abs_lower: 12, glute_med: 12, delt_side: 8 }, { unilateral: true });
add('Weighted Plank', 'plate', 'core',
    { abs_upper: 32, abs_lower: 26, oblique: 20, erector: 10, delt_front: 6, serratus: 6 });
add('RKC Plank', 'bodyweight', 'core',
    { abs_upper: 34, abs_lower: 28, oblique: 20, glute_max: 10, erector: 8 });
add('Long-Lever Plank', 'bodyweight', 'core',
    { abs_upper: 34, abs_lower: 28, oblique: 18, serratus: 10, delt_front: 10 });
add('Crunch', 'bodyweight', 'core', { abs_upper: 58, abs_lower: 24, oblique: 14, hip_flexor: 4 });
add('Cable Crunch', 'cable', 'core', { abs_upper: 56, abs_lower: 24, oblique: 14, hip_flexor: 6 });
add('Machine Crunch', 'machine', 'core', { abs_upper: 58, abs_lower: 24, oblique: 14, hip_flexor: 4 });
add('Weighted Crunch', 'plate', 'core', { abs_upper: 58, abs_lower: 24, oblique: 14, hip_flexor: 4 });
add('Reverse Crunch', 'bodyweight', 'core', { abs_lower: 56, abs_upper: 22, oblique: 14, hip_flexor: 8 });
add('Bicycle Crunch', 'bodyweight', 'core', { oblique: 38, abs_upper: 28, abs_lower: 24, hip_flexor: 10 });
add('Sit-Up', 'bodyweight', 'core', { abs_upper: 46, abs_lower: 22, hip_flexor: 20, oblique: 12 });
add('Decline Sit-Up', 'bodyweight', 'core', { abs_upper: 46, abs_lower: 24, hip_flexor: 18, oblique: 12 });
add('V-Up', 'bodyweight', 'core', { abs_upper: 38, abs_lower: 34, hip_flexor: 16, oblique: 12 });
add('Hollow Body Hold', 'bodyweight', 'core', { abs_upper: 36, abs_lower: 36, hip_flexor: 14, oblique: 14 });
add('Hanging Leg Raise', 'bodyweight', 'core',
    { abs_lower: 44, abs_upper: 18, hip_flexor: 18, oblique: 10, forearm_flex: 10 });
add('Hanging Knee Raise', 'bodyweight', 'core',
    { abs_lower: 42, abs_upper: 18, hip_flexor: 20, oblique: 10, forearm_flex: 10 });
add('Captain Chair Leg Raise', 'machine', 'core',
    { abs_lower: 46, abs_upper: 18, hip_flexor: 22, oblique: 14 });
add('Lying Leg Raise', 'bodyweight', 'core', { abs_lower: 50, abs_upper: 20, hip_flexor: 20, oblique: 10 });
add('Toes to Bar', 'bodyweight', 'core',
    { abs_lower: 38, abs_upper: 20, hip_flexor: 16, lat: 12, forearm_flex: 8, oblique: 6 });
add('Dragon Flag', 'bodyweight', 'core',
    { abs_lower: 40, abs_upper: 30, oblique: 14, erector: 10, lat: 6 });
add('Ab Wheel Rollout', 'other', 'core',
    { abs_upper: 36, abs_lower: 30, oblique: 12, lat: 12, erector: 6, serratus: 4 });
add('Barbell Rollout', 'barbell', 'core',
    { abs_upper: 36, abs_lower: 30, oblique: 12, lat: 12, erector: 6, serratus: 4 });
add('Russian Twist', 'plate', 'core', { oblique: 56, abs_upper: 22, abs_lower: 14, hip_flexor: 8 });
add('Cable Woodchop', 'cable', 'core', { oblique: 52, abs_upper: 20, abs_lower: 12, delt_front: 8, glute_med: 8 });
add('Landmine Twist', 'landmine', 'core', { oblique: 50, abs_upper: 20, abs_lower: 12, delt_front: 10, glute_med: 8 });
add('Pallof Press', 'cable', 'core', { oblique: 48, abs_upper: 24, abs_lower: 14, delt_front: 8, glute_med: 6 });
add('Band Pallof Press', 'band', 'core', { oblique: 48, abs_upper: 24, abs_lower: 14, delt_front: 8, glute_med: 6 });
add('Dead Bug', 'bodyweight', 'core', { abs_lower: 40, abs_upper: 30, oblique: 18, hip_flexor: 12 });
add('Bird Dog', 'bodyweight', 'core', { erector: 34, glute_max: 22, abs_upper: 18, oblique: 16, delt_front: 10 });
add('Mountain Climber', 'bodyweight', 'core',
    { abs_lower: 32, abs_upper: 22, oblique: 18, hip_flexor: 16, delt_front: 12 });
add('Hanging Windshield Wiper', 'bodyweight', 'core',
    { oblique: 46, abs_lower: 26, abs_upper: 14, lat: 8, forearm_flex: 6 });
add('Side Bend', 'dumbbell', 'core', { oblique: 66, erector: 18, abs_upper: 10, trap_upper: 6 },
    { unilateral: true });
add('Cable Side Bend', 'cable', 'core', { oblique: 66, erector: 18, abs_upper: 10, trap_upper: 6 },
    { unilateral: true });
add('Medicine Ball Slam', 'ball', 'core',
    { abs_upper: 28, abs_lower: 20, lat: 20, oblique: 14, delt_front: 10, triceps_long: 8 });
add('Medicine Ball Rotational Throw', 'ball', 'core',
    { oblique: 48, abs_upper: 18, glute_med: 12, delt_front: 12, quad_rectus: 10 });
add('Stir the Pot', 'ball', 'core', { abs_upper: 34, abs_lower: 26, oblique: 22, serratus: 10, delt_front: 8 });
add('L-Sit', 'bodyweight', 'core',
    { abs_lower: 36, abs_upper: 22, hip_flexor: 18, quad_rectus: 12, triceps_lat: 12 });
add('Suspension Fallout', 'suspension', 'core',
    { abs_upper: 36, abs_lower: 28, oblique: 14, lat: 12, delt_front: 10 });

/* --- neck ----------------------------------------------------------------- */
add('Neck Curl', 'plate', 'neck-isolation', { sternocleidomastoid: 88, trap_upper: 12 });
add('Neck Extension', 'plate', 'neck-isolation', { splenius: 84, trap_upper: 16 });
add('Neck Harness Extension', 'other', 'neck-isolation', { splenius: 82, trap_upper: 18 });
add('Lateral Neck Raise', 'plate', 'neck-isolation',
    { sternocleidomastoid: 60, splenius: 24, trap_upper: 16 }, { unilateral: true });
add('Band Neck Extension', 'band', 'neck-isolation', { splenius: 84, trap_upper: 16 });

/* =============================================================================
   OLYMPIC / FULL BODY
   ============================================================================= */

add('Power Clean', 'barbell', 'olympic',
    { quad_rectus: 16, quad_lateral: 13, glute_max: 18, ham_biceps: 12, erector: 12,
      trap_upper: 13, calf_gastro: 6, delt_side: 5, forearm_flex: 5 });
add('Hang Clean', 'barbell', 'olympic',
    { quad_rectus: 14, quad_lateral: 12, glute_max: 18, ham_biceps: 14, erector: 13,
      trap_upper: 15, calf_gastro: 6, delt_side: 4, forearm_flex: 4 });
add('Clean and Jerk', 'barbell', 'olympic',
    { quad_rectus: 15, quad_lateral: 12, glute_max: 16, ham_biceps: 10, erector: 11,
      trap_upper: 11, delt_front: 10, triceps_lat: 7, calf_gastro: 8 });
add('Power Snatch', 'barbell', 'olympic',
    { quad_rectus: 14, quad_lateral: 11, glute_max: 16, ham_biceps: 12, erector: 12,
      trap_upper: 15, delt_side: 8, calf_gastro: 7, forearm_flex: 5 });
add('Hang Snatch', 'barbell', 'olympic',
    { quad_rectus: 12, quad_lateral: 10, glute_max: 16, ham_biceps: 14, erector: 13,
      trap_upper: 16, delt_side: 8, calf_gastro: 6, forearm_flex: 5 });
add('High Pull', 'barbell', 'olympic',
    { trap_upper: 26, delt_side: 16, erector: 14, glute_max: 12, ham_biceps: 10,
      quad_rectus: 8, forearm_flex: 8, biceps: 6 });
add('Clean Pull', 'barbell', 'olympic',
    { erector: 20, glute_max: 18, ham_biceps: 16, trap_upper: 18, quad_rectus: 12,
      quad_lateral: 8, forearm_flex: 8 });
add('Thruster', 'barbell', 'olympic',
    { quad_rectus: 18, quad_lateral: 14, glute_max: 16, delt_front: 18, triceps_lat: 12,
      delt_side: 10, abs_upper: 6, erector: 6 });
add('Dumbbell Thruster', 'dumbbell', 'olympic',
    { quad_rectus: 18, quad_lateral: 14, glute_max: 16, delt_front: 18, triceps_lat: 12,
      delt_side: 10, abs_upper: 6, erector: 6 });
add('Burpee', 'bodyweight', 'olympic',
    { quad_rectus: 16, glute_max: 14, pec_mid: 14, triceps_lat: 12, delt_front: 12,
      abs_upper: 12, calf_gastro: 10, quad_lateral: 10 });
add('Kettlebell Clean', 'kettlebell', 'olympic',
    { glute_max: 22, ham_biceps: 16, erector: 14, trap_upper: 14, forearm_flex: 12,
      quad_rectus: 12, delt_front: 10 });
add('Kettlebell Snatch', 'kettlebell', 'olympic',
    { glute_max: 20, ham_biceps: 15, erector: 13, trap_upper: 13, delt_side: 13,
      forearm_flex: 12, quad_rectus: 8, delt_front: 6 });
add('Turkish Get-Up', 'kettlebell', 'olympic',
    { oblique: 20, abs_upper: 18, delt_side: 16, glute_max: 14, quad_rectus: 12,
      trap_upper: 10, rotator_cuff: 10 }, { unilateral: true });
add('Bear Crawl', 'bodyweight', 'core',
    { abs_upper: 22, oblique: 18, delt_front: 16, serratus: 12, quad_rectus: 12,
      triceps_lat: 10, trap_upper: 10 });

/* =============================================================================
   WRITE OUT
   ============================================================================= */

out.sort(function (a, b) { return a.name.localeCompare(b.name); });

/* sanity: every muscle id must exist in the taxonomy */
const musclesSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'data', 'muscles.js'), 'utf8');
const known = new Set((musclesSrc.match(/id: '([a-z_]+)'/g) || [])
  .map(function (s) { return s.slice(5, -1); }));
const bad = new Set();
out.forEach(function (e) {
  Object.keys(e.muscles).forEach(function (m) { if (!known.has(m)) bad.add(m); });
});
if (bad.size) {
  console.error('Unknown muscle ids: ' + [...bad].join(', '));
  process.exit(1);
}

const body = out.map(function (e) {
  const m = Object.keys(e.muscles).sort(function (a, b) { return e.muscles[b] - e.muscles[a]; })
    .map(function (k) { return k + ':' + e.muscles[k]; }).join(', ');
  return '  { id: ' + JSON.stringify(e.id) +
         ', name: ' + JSON.stringify(e.name) +
         ', equipment: ' + JSON.stringify(e.equipment) +
         ', pattern: ' + JSON.stringify(e.pattern) +
         (e.unilateral ? ', unilateral: true' : '') +
         ', muscles: { ' + m + ' } }';
}).join(',\n');

const file =
'/* =============================================================================\n' +
'   exercises.js — built-in exercise library (' + out.length + ' movements)\n' +
'   GENERATED by tools/gen-exercises.js — edit that file and re-run, do not hand\n' +
'   edit this one. User-created and user-edited exercises live in IndexedDB and\n' +
'   override these by id.\n' +
'   ============================================================================= */\n' +
'(function (App) {\n' +
"  'use strict';\n\n" +
'  const EQUIPMENT = ' + JSON.stringify(Object.keys(EQUIP).reduce(function (a, k) {
    a[k] = EQUIP[k].label; return a;
  }, {}), null, 2).replace(/\n/g, '\n  ') + ';\n\n' +
'  const EXERCISES = [\n' + body + '\n  ];\n\n' +
'  App.SeedExercises = EXERCISES;\n' +
'  App.Equipment = EQUIPMENT;\n' +
'})(window.App = window.App || {});\n';

fs.writeFileSync(path.join(__dirname, '..', 'js', 'data', 'exercises.js'), file);
console.log('Wrote ' + out.length + ' exercises to js/data/exercises.js');

/* quick distribution report */
const byGroup = {};
out.forEach(function (e) {
  const top = Object.keys(e.muscles).sort(function (a, b) { return e.muscles[b] - e.muscles[a]; })[0];
  byGroup[top] = (byGroup[top] || 0) + 1;
});
console.log('Primary-muscle distribution:', JSON.stringify(byGroup, null, 1));
