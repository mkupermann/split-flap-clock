'use strict';

/**
 * Fallblattuhr-Klang: Klack (Stimmen) und Standuhr-Schlag.
 * Klassisches Script, globales Objekt FlapSound.
 * Reine Funktionen zusätzlich per module.exports (Node-Tests).
 */
(function (global) {
  // ---------------------------------------------------------------------------
  // Reine Funktionen
  // ---------------------------------------------------------------------------

  /**
   * isSecondModule(rowId, index) -> true für Sekundenstellen von Timer und Stoppuhr.
   * Index bezieht sich auf die Ziffernstellen 0-7 von "HH:MM:SS"
   * inkl. Doppelpunkt-Positionen 2 und 5:
   *   0=H 1=H 2=: 3=M 4=M 5=: 6=S 7=S
   * true nur für rowId 'timer'|'stopwatch' und index 6|7.
   */
  function isSecondModule(rowId, index) {
    if (rowId !== 'timer' && rowId !== 'stopwatch') return false;
    return index === 6 || index === 7;
  }

  /**
   * shouldChime(prevDate, nowDate) -> null | { type:'hour', strikes:n } | { type:'half' }.
   * Löst genau einmal aus, wenn zwischen prev (exkl.) und now (inkl.) die
   * Minute 00 bzw. 30 erreicht wurde. strikes = Stunde im 12h-Format (0 und 12 -> 12).
   */
  function shouldChime(prevDate, nowDate) {
    try {
      if (!prevDate || !nowDate) return null;
      if (!(prevDate instanceof Date) || !(nowDate instanceof Date)) return null;
      var t0 = prevDate.getTime();
      var t1 = nowDate.getTime();
      if (!isFinite(t0) || !isFinite(t1)) return null;
      if (t1 <= t0) return null;

      // Späteste :00-/:30-Grenze in (t0, t1] suchen (Stunden von prev bis now)
      var latest = null;
      var startH = new Date(t0);
      startH.setMinutes(0, 0, 0);
      var endH = new Date(t1);
      endH.setMinutes(0, 0, 0);
      var d = new Date(startH.getTime());
      var guard = 0;
      while (d.getTime() <= endH.getTime() && guard < 100000) {
        var hourStart = d.getTime();
        var halfStart = hourStart + 30 * 60 * 1000;
        // chronologisch: :00 dann :30 — spätester Treffer gewinnt (genau einmal)
        if (hourStart > t0 && hourStart <= t1) latest = hourStart;
        if (halfStart > t0 && halfStart <= t1) latest = halfStart;
        d = new Date(hourStart + 3600 * 1000);
        guard++;
      }
      if (latest === null) return null;

      var hd = new Date(latest);
      if (hd.getMinutes() === 0) {
        var h = hd.getHours() % 12;
        if (h === 0) h = 12;
        return { type: 'hour', strikes: h };
      }
      return { type: 'half' };
    } catch (e) {
      return null;
    }
  }

  /**
   * chimePlan(event) -> Array von Schlägen { t: Sekunden-Offset, note:'STRIKE' }.
   * volle Stunde: n Schläge im Abstand ~2,2 s, erster bei t=0.
   * halbe Stunde: genau 1 Schlag bei t=0. Keine Melodie.
   */
  function chimePlan(event) {
    if (!event || typeof event !== 'object') return [];
    if (event.type === 'half') return [{ t: 0, note: 'STRIKE' }];
    if (event.type === 'hour') {
      var n = Math.floor(Number(event.strikes));
      if (!isFinite(n) || n < 1) return [];
      if (n > 12) n = 12;
      var plan = [];
      for (var i = 0; i < n; i++) {
        plan.push({ t: i * 2.2, note: 'STRIKE' });
      }
      return plan;
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Audio-Zustand
  // ---------------------------------------------------------------------------

  var _ctx = null;
  var _master = null; // DynamicsCompressor
  var _dry = null; // Klack-Trockenbus
  var _bellBus = null; // Glocke -> Hall + Trocken
  var _wet = null; // Convolver-Ausgang
  var _clackOn = false;
  var _chimeOn = true;
  var _activeClacks = 0;
  var MAX_CLACKS = 12;
  var STRIKE_F0 = 164.81; // E3

  function ensureCtx() {
    if (_ctx) return _ctx;
    var g = global;
    if (!g) return null;
    var AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return null;
    try {
      _ctx = new AC();
    } catch (e) {
      _ctx = null;
      return null;
    }
    try {
      _master = _ctx.createDynamicsCompressor();
      if (_master.threshold) _master.threshold.value = -18;
      if (_master.ratio) _master.ratio.value = 6;
      if (_master.connect) _master.connect(_ctx.destination);

      _dry = _ctx.createGain();
      if (_dry.gain) _dry.gain.value = 1;
      if (_dry.connect) _dry.connect(_master);

      _bellBus = _ctx.createGain();
      if (_bellBus.gain) _bellBus.gain.value = 0.45;
      if (_bellBus.connect) {
        _bellBus.connect(_master);
        // leichter Hall
        if (_ctx.createConvolver) {
          _wet = _ctx.createConvolver();
          _wet.buffer = makeImpulseResponse(_ctx, 2.5, 2.2);
          var wetGain = _ctx.createGain();
          if (wetGain.gain) wetGain.gain.value = 0.22;
          _bellBus.connect(_wet);
          _wet.connect(wetGain);
          wetGain.connect(_master);
        }
      }
    } catch (e) {
      /* Ketten-Aufbau scheitert still */
    }
    return _ctx;
  }

  /** Abklingendes Rauschen als Hall-Impulsantwort. */
  function makeImpulseResponse(context, seconds, decay) {
    var rate = context.sampleRate || 48000;
    var len = Math.max(1, Math.floor(rate * seconds));
    var buf = context.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var data = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function resumeIfSuspended() {
    if (!_ctx) return;
    try {
      if (_ctx.state === 'suspended' && typeof _ctx.resume === 'function') {
        var p = _ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // Klack (Stimmen) — synthetisch, mechanisch
  // ---------------------------------------------------------------------------

  var CLACK_PARAMS = {
    hour: { freq: 210, gain: 0.22, noiseMs: 5, resDur: 0.14 },
    minute: { freq: 520, gain: 0.16, noiseMs: 4, resDur: 0.09 },
    other: { freq: 600, gain: 0.07, noiseMs: 3, resDur: 0.05 },
  };

  function playClackVoice(kind) {
    var context = ensureCtx();
    if (!context) return;
    if (_activeClacks >= MAX_CLACKS) return;
    var p = CLACK_PARAMS[kind] || CLACK_PARAMS.other;
    _activeClacks++;

    var now = context.currentTime;
    // ±5 % Tonhöhe, ±10 % Lautstärke
    var pitchVar = 1 + (Math.random() * 0.1 - 0.05);
    var gainVar = 1 + (Math.random() * 0.2 - 0.1);
    var endAt = now + Math.max(p.noiseMs / 1000, p.resDur) + 0.02;

    try {
      // Transient: gefiltertes Rauschen (3–8 ms)
      var noiseMs = p.noiseMs;
      if (noiseMs < 3) noiseMs = 3;
      if (noiseMs > 8) noiseMs = 8;
      var nLen = Math.max(1, Math.floor(context.sampleRate * (noiseMs / 1000)));
      var buf = context.createBuffer(1, nLen, context.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < nLen; i++) {
        var t = i / nLen;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3);
      }
      var nSrc = context.createBufferSource();
      nSrc.buffer = buf;
      var nFilter = context.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.value = p.freq * 4 * pitchVar;
      nFilter.Q.value = 0.8;
      var nGain = context.createGain();
      nGain.gain.value = p.gain * 0.7 * gainVar;
      nSrc.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(_dry);
      nSrc.start(now);
      nSrc.stop(endAt);

      // Resonanz: gedämpfter Sinus
      var osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = p.freq * pitchVar;
      var oGain = context.createGain();
      oGain.gain.setValueAtTime(0.0001, now);
      oGain.gain.exponentialRampToValueAtTime(p.gain * gainVar, now + 0.002);
      oGain.gain.exponentialRampToValueAtTime(0.0001, now + p.resDur);
      osc.connect(oGain);
      oGain.connect(_dry);
      osc.start(now);
      osc.stop(now + p.resDur + 0.02);
    } catch (e) {
      _activeClacks--;
      return;
    }

    var releaseMs = Math.ceil((endAt - now) * 1000) + 20;
    setTimeout(function () {
      _activeClacks = Math.max(0, _activeClacks - 1);
    }, releaseMs);
  }

  /**
   * clack(kind) — kind = 'hour'|'minute'|'other'|'second'.
   * 'second' tut nichts (keine Audio-Knoten).
   */
  function clack(kind) {
    if (kind === 'second') return;
    if (!_clackOn) return;
    var context = ensureCtx();
    if (!context) return;
    resumeIfSuspended();
    playClackVoice(kind);
  }

  // ---------------------------------------------------------------------------
  // Standuhr-Schlag — additiv, Glockenteiltöne + Hall
  // ---------------------------------------------------------------------------

  function scheduleStrike(t0) {
    var context = ensureCtx();
    if (!context || !_bellBus) return;
    // Teiltöne 0.5, 1, 1.2, 1.5, 2, 2.5, 3 — tiefe länger (~4–6 s)
    var ratios = [0.5, 1, 1.2, 1.5, 2, 2.5, 3];
    var decays = [6.0, 5.0, 4.5, 4.0, 3.0, 2.2, 1.8];
    var levels = [0.5, 1.0, 0.45, 0.35, 0.25, 0.18, 0.12];
    var base = 0.18;
    for (var i = 0; i < ratios.length; i++) {
      try {
        var osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = STRIKE_F0 * ratios[i];
        var g = context.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, base * levels[i]), t0 + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + decays[i]);
        osc.connect(g);
        g.connect(_bellBus);
        osc.start(t0);
        osc.stop(t0 + decays[i] + 0.05);
      } catch (e) {
        /* Teilton überspringen */
      }
    }
  }

  /**
   * chime(hour24, minute) — spielt den Schlag gemäß chimePlan.
   * minute 0 -> Stundenschlag, minute 30 -> halber Schlag, sonst nichts.
   */
  function chime(hour24, minute) {
    if (!_chimeOn) return;
    var h = Math.floor(Number(hour24));
    var m = Math.floor(Number(minute));
    if (!isFinite(h) || !isFinite(m)) return;
    var event;
    if (m === 0) {
      var s = h % 12;
      if (s === 0) s = 12;
      event = { type: 'hour', strikes: s };
    } else if (m === 30) {
      event = { type: 'half' };
    } else {
      return;
    }
    var plan = chimePlan(event);
    if (!plan.length) return;
    var context = ensureCtx();
    if (!context) return;
    resumeIfSuspended();
    var t0 = context.currentTime + 0.05;
    for (var i = 0; i < plan.length; i++) {
      scheduleStrike(t0 + plan[i].t);
    }
  }

  // ---------------------------------------------------------------------------
  // Öffentliche Schnittstelle
  // ---------------------------------------------------------------------------

  function init() {
    var context = ensureCtx();
    if (!context) return null;
    resumeIfSuspended();
    // Bei suspended: beim ersten pointerdown/keydown resume()
    var g = global;
    if (g && g.document && !g.document._flapSoundResumeHooked) {
      g.document._flapSoundResumeHooked = true;
      var onResume = function () {
        resumeIfSuspended();
      };
      try {
        g.document.addEventListener('pointerdown', onResume, { once: true });
        g.document.addEventListener('keydown', onResume, { once: true });
      } catch (e) {
        try {
          g.document.addEventListener('pointerdown', onResume);
          g.document.addEventListener('keydown', onResume);
        } catch (e2) {
          /* ignore */
        }
      }
    }
    return context;
  }

  function setClackEnabled(on) {
    _clackOn = !!on;
  }

  function setChimeEnabled(on) {
    _chimeOn = !!on;
  }

  function isClackEnabled() {
    return _clackOn;
  }

  function isChimeEnabled() {
    return _chimeOn;
  }

  var FlapSound = {
    init: init,
    clack: clack,
    chime: chime,
    shouldChime: shouldChime,
    chimePlan: chimePlan,
    isSecondModule: isSecondModule,
    setClackEnabled: setClackEnabled,
    setChimeEnabled: setChimeEnabled,
    isClackEnabled: isClackEnabled,
    isChimeEnabled: isChimeEnabled,
  };

  if (global) {
    global.FlapSound = FlapSound;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      shouldChime: shouldChime,
      chimePlan: chimePlan,
      isSecondModule: isSecondModule,
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
