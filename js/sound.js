/* =============================================================================
   sound.js — the rest-timer tone

   One place that knows how to make a noise, so the timer and the Control
   Panel's "play it" button produce the very same sound at the very same
   loudness. Everything is synthesised with WebAudio: no audio files to ship,
   nothing to cache, and the tone follows the volume setting exactly.

   LOUDNESS is a 0–100 setting mapped onto gain with a power curve, because
   hearing is roughly logarithmic and a linear slider spends its whole top half
   sounding the same. 100 is FULL SCALE: every note runs through one master
   gain and a limiter, so the notes of a chord can stack to well past 1.0 and
   come out loud rather than clipped. The first version peaked at 0.42 and was
   inaudible on a gym floor even at 100. Waveforms are triangle and square
   rather than sine for the same reason — a pure sine carries no harmonics and
   sounds far quieter than its level.

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
    { id: 'chime',  name: 'Chime',       hint: 'Two rising notes, played twice.' },
    { id: 'beep',   name: 'Beep',        hint: 'A plain tone, played twice.' },
    { id: 'bell',   name: 'Bell',        hint: 'A struck note that rings out, twice.' },
    { id: 'triple', name: 'Triple beep', hint: 'Three sharp pips, twice — hard to miss.' },
    { id: 'buzz',   name: 'Buzz',        hint: 'A low, rough alarm, three pulses.' },
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

  /** 0–100 -> master gain. Power curve so the slider feels even; 100 = 1.0. */
  function gainFor(volume) {
    const v = Math.max(0, Math.min(100, Number(volume) || 0)) / 100;
    return Math.pow(v, 1.4);
  }

  /**
   * The output chain for one tone: master gain (the volume setting) into a
   * limiter into the speaker. The limiter is what lets the recipes push hard.
   */
  function bus(c, master) {
    const g = c.createGain();
    g.gain.value = master;
    let out = g;
    if (c.createDynamicsCompressor) {
      const lim = c.createDynamicsCompressor();
      lim.threshold.value = -8;
      lim.knee.value = 4;
      lim.ratio.value = 16;
      lim.attack.value = 0.002;
      lim.release.value = 0.12;
      g.connect(lim);
      out = lim;
    }
    out.connect(c.destination);
    return g;
  }

  /**
   * One enveloped note into the bus. `type` is the oscillator wave, `freq` in
   * Hz, `at` and `dur` in seconds from now, `peak` the amplitude to reach
   * (1.0 is full scale before the master gain). Attack is a fixed 12ms so
   * nothing clicks; the level holds for just over half the note and then rings
   * down exponentially, so it stops rather than fades away unheard.
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
    osc.connect(g); g.connect(opts.bus);
    const t0 = c.currentTime + opts.at;
    g.gain.setValueAtTime(0.0001, t0);
    const peak = Math.max(0.0002, opts.peak);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    /* Hold at full level for most of the note, then let it ring down. A
       decay that starts at once spends most of the note near silence. */
    g.gain.setValueAtTime(peak, t0 + opts.dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  /** The recipes. Each is played twice over so it is not missed. */
  const RECIPES = {
    beep: function (c, b) {
      [0, 0.5].forEach(function (at) {
        note(c, { bus: b, type: 'triangle', freq: 880, at: at, dur: 0.4, peak: 1 });
        note(c, { bus: b, type: 'sine', freq: 1760, at: at, dur: 0.3, peak: 0.35 });
      });
      return 1.0;
    },
    chime: function (c, b) {
      [0, 0.9].forEach(function (at) {
        note(c, { bus: b, type: 'triangle', freq: 880, at: at, dur: 0.36, peak: 1 });
        note(c, { bus: b, type: 'triangle', freq: 1318.5, at: at + 0.2, dur: 0.6, peak: 1 });
        note(c, { bus: b, type: 'sine', freq: 2637, at: at + 0.2, dur: 0.4, peak: 0.3 });
      });
      return 1.8;
    },
    bell: function (c, b) {
      [0, 1.1].forEach(function (at) {
        note(c, { bus: b, type: 'triangle', freq: 1046.5, at: at, dur: 1.3, peak: 1 });
        note(c, { bus: b, type: 'square', freq: 1046.5, at: at, dur: 0.25, peak: 0.4 });
        note(c, { bus: b, type: 'sine', freq: 2093, at: at, dur: 0.7, peak: 0.5 });
        note(c, { bus: b, type: 'sine', freq: 3135.9, at: at, dur: 0.35, peak: 0.25 });
      });
      return 2.4;
    },
    triple: function (c, b) {
      [0, 0.24, 0.48, 1.0, 1.24, 1.48].forEach(function (at) {
        note(c, { bus: b, type: 'square', freq: 1174.7, at: at, dur: 0.14, peak: 0.9 });
        note(c, { bus: b, type: 'triangle', freq: 2349.3, at: at, dur: 0.12, peak: 0.4 });
      });
      return 1.7;
    },
    buzz: function (c, b) {
      [0, 0.32, 0.64].forEach(function (at) {
        note(c, { bus: b, type: 'sawtooth', freq: 180, at: at, dur: 0.26, peak: 1 });
        note(c, { bus: b, type: 'square', freq: 90, at: at, dur: 0.26, peak: 0.6 });
        note(c, { bus: b, type: 'sawtooth', freq: 362, at: at, dur: 0.2, peak: 0.4 });
      });
      return 0.95;
    }
  };

  /** A buzz in the hand alongside the tone, where the device has one. */
  function vibrate() {
    try {
      if (navigator.vibrate) navigator.vibrate([220, 90, 220, 90, 320]);
    } catch (e) { /* ignore */ }
  }

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
      const master = gainFor(volume);
      if (master <= 0) return false;
      vibrate();
      recipe(c, bus(c, master));
      return true;
    } catch (e) { return false; }
  }

  App.Sound = { KINDS: KINDS, play: play, unlock: unlock };
})(window.App = window.App || {});
