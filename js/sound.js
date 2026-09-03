/* =============================================================================
   sound.js — the rest-timer tone

   One place that knows how to make a noise, so the timer and the Control
   Panel's "play it" button produce the very same sound at the very same
   loudness. Everything is synthesised with WebAudio: no audio files to ship,
   nothing to cache, and the tone follows the volume setting exactly.

   LOUDNESS is a 0–100 setting mapped onto gain with a square curve, because
   hearing is roughly logarithmic and a linear slider spends its whole top half
   sounding the same. 60 lands close to the loudness the app always had.

   AUDIO CONTEXTS START SUSPENDED on iOS and in most web-to-app shells until a
   user gesture has touched one. The rest timer fires without a gesture, so the
   context is created and resumed on the first tap anywhere, and the same
   context is reused rather than opened fresh per tone — a fresh context is
   exactly what those shells refuse.
   ============================================================================= */
(function (App) {
  'use strict';

  /* Every option the Control Panel offers. `off` is honoured by play(). */
  const KINDS = [
    { id: 'chime',  name: 'Chime',       hint: 'Two rising notes.' },
    { id: 'beep',   name: 'Beep',        hint: 'The plain single tone.' },
    { id: 'bell',   name: 'Bell',        hint: 'One struck note that rings out.' },
    { id: 'triple', name: 'Triple beep', hint: 'Three short pips — hard to miss.' },
    { id: 'buzz',   name: 'Buzz',        hint: 'A low, rough alarm.' },
    { id: 'off',    name: 'Silent',      hint: 'No sound at all.' }
  ];

  let ctx = null;

  function context() {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { ctx = new Ctx(); } catch (e) { ctx = null; }
    return ctx;
  }

  /** Wake the context on the first gesture so a later timer can be heard. */
  function unlock() {
    const c = context();
    if (c && c.state === 'suspended') { try { c.resume(); } catch (e) { /* ignore */ } }
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, unlock, { passive: true, capture: true });
  });

  /** 0–100 -> peak gain. Square curve so the slider feels even. */
  function gainFor(volume) {
    const v = Math.max(0, Math.min(100, Number(volume) || 0)) / 100;
    return 0.42 * v * v;
  }

  /**
   * One enveloped note. `type` is the oscillator wave, `freq` in Hz, `at` and
   * `dur` in seconds from now, `peak` the gain to reach. Attack is a fixed
   * 15ms so nothing clicks; the release is exponential so it rings rather
   * than stops.
   */
  function note(c, opts) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, c.currentTime + opts.at);
    if (opts.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(opts.slideTo,
        c.currentTime + opts.at + opts.dur);
    }
    osc.connect(g); g.connect(c.destination);
    const t0 = c.currentTime + opts.at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.peak), t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  /** The recipes. Each returns the total length in seconds. */
  const RECIPES = {
    beep: function (c, peak) {
      note(c, { freq: 880, at: 0, dur: 0.35, peak: peak });
      return 0.4;
    },
    chime: function (c, peak) {
      note(c, { freq: 880, at: 0, dur: 0.32, peak: peak });
      note(c, { freq: 1318.5, at: 0.18, dur: 0.55, peak: peak });
      return 0.8;
    },
    bell: function (c, peak) {
      note(c, { type: 'triangle', freq: 1046.5, at: 0, dur: 1.2, peak: peak });
      note(c, { type: 'sine', freq: 2093, at: 0, dur: 0.6, peak: peak * 0.35 });
      note(c, { type: 'sine', freq: 3135.9, at: 0, dur: 0.3, peak: peak * 0.15 });
      return 1.3;
    },
    triple: function (c, peak) {
      [0, 0.22, 0.44].forEach(function (at) {
        note(c, { type: 'square', freq: 1174.7, at: at, dur: 0.12, peak: peak * 0.55 });
      });
      return 0.7;
    },
    buzz: function (c, peak) {
      [0, 0.3].forEach(function (at) {
        note(c, { type: 'sawtooth', freq: 180, at: at, dur: 0.22, peak: peak * 0.6 });
        note(c, { type: 'square', freq: 90, at: at, dur: 0.22, peak: peak * 0.3 });
      });
      return 0.6;
    }
  };

  /**
   * Play a tone. Falls back to the saved setting for anything not given, so
   * the timer calls play() with no arguments and the settings preview calls
   * play(kind, volume) with the values it is about to save. Silently does
   * nothing when audio is blocked — a tone is a nicety, never a failure.
   */
  function play(kind, volume) {
    try {
      const s = (App.Store && App.Store.getSettings) ? App.Store.getSettings() : {};
      kind = kind || s.restSound || 'chime';
      if (volume === undefined || volume === null) volume = s.restVolume;
      if (volume === undefined || volume === null) volume = 60;
      if (kind === 'off') return false;
      const recipe = RECIPES[kind] || RECIPES.chime;
      const c = context();
      if (!c) return false;
      if (c.state === 'suspended') { try { c.resume(); } catch (e) { /* ignore */ } }
      const peak = gainFor(volume);
      if (peak <= 0) return false;
      recipe(c, peak);
      return true;
    } catch (e) { return false; }
  }

  App.Sound = { KINDS: KINDS, play: play, unlock: unlock };
})(window.App = window.App || {});
