'use strict';

/**
 * Split-Flap (Solari) Anzeige — reine Logik + Browser-DOM.
 * Pure Funktionen laufen auch in Node (Tests); DOM-Code nur im Browser.
 * Darstellung erfolgt über FlapRenderer (render3d.js, Three.js/WebGL).
 */

const CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789°%/.:-';
const DIGITS = '0123456789';

/** Zeit-Module nutzen DIGITS (9→0 ist ein einziger Flip), Datum/Wetter/Messenger CHARSET. */
const ROW_CHARSETS = {
  time: DIGITS,
  date: CHARSET,
  weather: CHARSET,
  messenger: CHARSET,
  timer: DIGITS,
  stopwatch: DIGITS,
};

/** Anzahl Zeit-Fallblätter (HH + MM). Doppelpunkt ist statisch, kein Modul. */
const TIME_MODULES = 4;

/** Länge einer Messenger-Fallblattzeile (Label + GRP/EIN-Zählwerte). */
const MESSENGER_ROW_LEN = 24;

/** Lokaler Helper mit ungelesenen Nachrichten aus Signal und WhatsApp. */
const MESSENGER_URL = 'http://127.0.0.1:8787/counts';

/** Standard-Konfiguration (ohne config.js / CLOCK_CONFIG). */
const DEFAULT_CONFIG = {
  messenger: false,
  city: {
    name: 'DÜSSELDORF',
    latitude: 51.2277,
    longitude: 6.7735,
    timezone: 'Europe/Berlin',
  },
};

/**
 * resolveConfig(raw) -> vollständiges Konfigurationsobjekt.
 * Ungültige oder fehlende Felder fallen auf DEFAULT_CONFIG zurück.
 * city.name wird in Großbuchstaben verwendet.
 */
function resolveConfig(raw) {
  const cfg = {
    messenger: DEFAULT_CONFIG.messenger,
    city: {
      name: DEFAULT_CONFIG.city.name,
      latitude: DEFAULT_CONFIG.city.latitude,
      longitude: DEFAULT_CONFIG.city.longitude,
      timezone: DEFAULT_CONFIG.city.timezone,
    },
  };
  if (!raw || typeof raw !== 'object') return cfg;
  if (typeof raw.messenger === 'boolean') cfg.messenger = raw.messenger;
  const c = raw.city;
  if (c && typeof c === 'object') {
    if (typeof c.name === 'string' && c.name.trim() !== '') {
      cfg.city.name = c.name.trim().toUpperCase();
    }
    if (isFiniteNumber(c.latitude)) cfg.city.latitude = c.latitude;
    if (isFiniteNumber(c.longitude)) cfg.city.longitude = c.longitude;
    if (typeof c.timezone === 'string' && c.timezone.trim() !== '') {
      cfg.city.timezone = c.timezone.trim();
    }
  }
  return cfg;
}

/**
 * buildRenderLayout(config) -> Zeilenliste für FlapRenderer.init.
 * Ohne Messenger (config.messenger false) entfallen signal/whatsapp.
 */
function buildRenderLayout(config) {
  const messenger = !!(config && config.messenger);
  const rows = [
    { id: 'time', length: 4, charset: ROW_CHARSETS.time, scale: 1.0 },
    { id: 'date', length: 14, charset: ROW_CHARSETS.date, scale: 0.22 },
    { id: 'weather', length: 27, charset: ROW_CHARSETS.weather, scale: 0.2 },
  ];
  if (messenger) {
    rows.push({ id: 'signal', length: 24, charset: ROW_CHARSETS.messenger, scale: 0.2 });
    rows.push({ id: 'whatsapp', length: 24, charset: ROW_CHARSETS.messenger, scale: 0.2 });
  }
  rows.push({ id: 'timer', length: 6, charset: ROW_CHARSETS.timer, scale: 0.22 });
  rows.push({ id: 'stopwatch', length: 6, charset: ROW_CHARSETS.stopwatch, scale: 0.22 });
  return rows;
}

/**
 * weatherUrl(city) -> Open-Meteo-URL mit den Koordinaten und URL-kodierter Zeitzone.
 */
function weatherUrl(city) {
  const c = city && typeof city === 'object' ? city : DEFAULT_CONFIG.city;
  const lat = isFiniteNumber(c.latitude) ? c.latitude : DEFAULT_CONFIG.city.latitude;
  const lon = isFiniteNumber(c.longitude) ? c.longitude : DEFAULT_CONFIG.city.longitude;
  const tz =
    typeof c.timezone === 'string' && c.timezone.trim() !== ''
      ? c.timezone.trim()
      : DEFAULT_CONFIG.city.timezone;
  return (
    'https://api.open-meteo.com/v1/forecast?latitude=' +
    lat +
    '&longitude=' +
    lon +
    '&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=' +
    encodeURIComponent(tz)
  );
}

const WEEKDAY_DE = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];
const MONTH_DE = ['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'];

function isFiniteNumber(v) {
  return typeof v === 'number' && isFinite(v);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** formatTime(new Date(2026,9,23,9,5,7)) -> "09:05" */
function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--';
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return hh + ':' + mm;
}

/** formatDate(new Date(2026,9,23)) -> "FR 23 OKT 2026" */
function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-- -- --- ----';
  const wd = WEEKDAY_DE[date.getDay()];
  const dd = pad2(date.getDate());
  const mon = MONTH_DE[date.getMonth()];
  const year = date.getFullYear();
  return wd + ' ' + dd + ' ' + mon + ' ' + year;
}

/** WMO-Code -> deutscher Kurztext, max. 10 Zeichen. Unbekannt -> "--" */
function weatherCodeToText(code) {
  if (typeof code !== 'number' || !isFinite(code)) return '--';
  if (code === 0) return 'KLAR';
  if (code === 1) return 'HEITER';
  if (code === 2) return 'BEWÖLKT';
  if (code === 3) return 'BEWÖLKT';
  if (code === 45 || code === 48) return 'NEBEL';
  if (code >= 51 && code <= 57) return 'NIESEL';
  if (code >= 61 && code <= 67) return 'REGEN';
  if (code >= 71 && code <= 77) return 'SCHNEE';
  if (code >= 80 && code <= 82) return 'SCHAUER';
  if (code === 85 || code === 86) return 'SCHNEESCH.';
  if (code >= 95 && code <= 99) return 'GEWITTER';
  return '--';
}

/**
 * formatWeather(apiJson) -> { temp, text, wind, humidity }
 * Open-Meteo `current`: temperature_2m, weather_code, wind_speed_10m, relative_humidity_2m.
 * Wirft nie; fehlende/ungültige Felder -> "--".
 */
function formatWeather(apiJson) {
  const out = { temp: '--', text: '--', wind: '--', humidity: '--' };
  try {
    if (!apiJson || typeof apiJson !== 'object') return out;
    const cur = apiJson.current;
    if (!cur || typeof cur !== 'object') return out;

    if (isFiniteNumber(cur.temperature_2m)) {
      out.temp = Math.round(cur.temperature_2m) + '°C';
    }
    if (isFiniteNumber(cur.weather_code)) {
      out.text = weatherCodeToText(cur.weather_code);
    }
    if (isFiniteNumber(cur.wind_speed_10m)) {
      out.wind = Math.round(cur.wind_speed_10m) + ' KM/H';
    }
    if (isFiniteNumber(cur.relative_humidity_2m)) {
      out.humidity = Math.round(cur.relative_humidity_2m) + '%';
    }
    return out;
  } catch (e) {
    return out;
  }
}

/** Zählwert für Messenger-Zeile: nicht-negativ, max. 9999. */
function clampMessengerCount(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 0) return 0;
  return v > 9999 ? 9999 : v;
}

/**
 * formatMessengerRow(label, counts) -> String mit genau MESSENGER_ROW_LEN (24) Zeichen.
 * ok:true: label.padEnd(9) + "GRP" + group.padStart(4) + " EIN" + direct.padStart(4).
 * Zahlen > 9999 werden als 9999 dargestellt.
 * ok:false oder counts undefined: (label.padEnd(9) + "KEINE DATEN").padEnd(24).
 */
function formatMessengerRow(label, counts) {
  const lab = String(label == null ? '' : label).padEnd(9);
  if (!counts || counts.ok === false) {
    return (lab + 'KEINE DATEN').padEnd(MESSENGER_ROW_LEN);
  }
  const g = clampMessengerCount(counts.group);
  const d = clampMessengerCount(counts.direct);
  return lab + 'GRP' + String(g).padStart(4) + ' EIN' + String(d).padStart(4);
}

/**
 * flapSequence(from, to, charset) -> Array von Zeichen, die das Modul durchläuft.
 * Nur vorwärts durch charset, mit Wrap-around, endet auf `to`.
 * from === to -> []. Unbekannte Zeichen -> [].
 */
function flapSequence(from, to, charset) {
  if (typeof from !== 'string' || typeof to !== 'string') return [];
  if (from === to) return [];
  const cs = typeof charset === 'string' ? charset : CHARSET;
  if (cs.length === 0) return [];
  const fromIdx = cs.indexOf(from);
  const toIdx = cs.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return [];

  const seq = [];
  let i = fromIdx;
  // max Länge begrenzen (sichere Schleife)
  const max = cs.length;
  for (let n = 0; n < max; n++) {
    i = (i + 1) % cs.length;
    seq.push(cs[i]);
    if (i === toIdx) break;
  }
  return seq;
}

/**
 * retarget(currentChar, newTarget, charset) -> Array der noch zu laufenden Zeichen.
 * Wird genutzt, wenn ein neues Ziel während einer laufenden Animation eintrifft:
 * die Restsequenz wird ab dem aktuell sichtbaren Zeichen ersetzt (keine Warteschlange).
 * Identisch zu flapSequence (bewusst als eigener Name für die Modul-Logik).
 */
function retarget(currentChar, newTarget, charset) {
  return flapSequence(currentChar, newTarget, charset);
}

// ---------------------------------------------------------------------------
// Timer / Stoppuhr — reine Funktionen
// ---------------------------------------------------------------------------

/**
 * formatDuration(ms, mode) -> "HH:MM:SS"
 * mode 'ceil' (Countdown rundet auf) | 'floor' (Stoppuhr rundet ab), Standard 'floor'.
 * Negative Werte -> "00:00:00"; > 99:59:59 -> "99:59:59".
 */
function formatDuration(ms, mode) {
  if (!isFiniteNumber(ms) || ms <= 0) return '00:00:00';
  const round = mode === 'ceil' ? Math.ceil : Math.floor;
  let total = round(ms / 1000);
  if (!isFiniteNumber(total) || total < 0) return '00:00:00';
  const maxSec = 99 * 3600 + 59 * 60 + 59;
  if (total > maxSec) total = maxSec;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

/** Modularer Wrap für 0..mod-1 (auch bei negativen Werten). */
function wrapMod(value, mod) {
  return ((value % mod) + mod) % mod;
}

/**
 * adjustPreset({h, m}, field, delta) -> neues {h, m}.
 * h in 0..99, m in 0..59, jeweils mit Wrap-around
 * (m 59 +1 -> 0 ohne Übertrag auf h; h 0 -1 -> 99).
 */
function adjustPreset(preset, field, delta) {
  const src = preset && typeof preset === 'object' ? preset : {};
  const out = {
    h: isFiniteNumber(src.h) ? Math.round(src.h) : 0,
    m: isFiniteNumber(src.m) ? Math.round(src.m) : 0,
  };
  const d = isFiniteNumber(delta) ? Math.round(delta) : 0;
  if (field === 'h') {
    out.h = wrapMod(out.h + d, 100);
  } else if (field === 'm') {
    out.m = wrapMod(out.m + d, 60);
  }
  return out;
}

/**
 * countdownRemaining(state, now) -> ms.
 * state = { running, endAt, remainingMs }.
 * Läuft: endAt - now, min 0. Pausiert: remainingMs.
 */
function countdownRemaining(state, now) {
  const s = state && typeof state === 'object' ? state : {};
  if (s.running) {
    const end = isFiniteNumber(s.endAt) ? s.endAt : 0;
    const t = isFiniteNumber(now) ? now : 0;
    return Math.max(0, end - t);
  }
  return isFiniteNumber(s.remainingMs) ? Math.max(0, s.remainingMs) : 0;
}

/**
 * stopwatchElapsed(state, now) -> ms.
 * state = { running, startedAt, accumulatedMs }.
 * Läuft: accumulatedMs + (now - startedAt). Pausiert: accumulatedMs.
 */
function stopwatchElapsed(state, now) {
  const s = state && typeof state === 'object' ? state : {};
  if (s.running) {
    const started = isFiniteNumber(s.startedAt) ? s.startedAt : 0;
    const acc = isFiniteNumber(s.accumulatedMs) ? s.accumulatedMs : 0;
    const t = isFiniteNumber(now) ? now : 0;
    return Math.max(0, acc + (t - started));
  }
  return isFiniteNumber(s.accumulatedMs) ? Math.max(0, s.accumulatedMs) : 0;
}

/**
 * parseMode(search) -> 'screensaver' wenn URL-Parameter screensaver=1, sonst 'normal'.
 */
function parseMode(search) {
  const s = String(search == null ? '' : search);
  const q = s.charAt(0) === '?' ? s.slice(1) : s;
  if (!q) return 'normal';
  const parts = q.split('&');
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    const key = eq === -1 ? parts[i] : parts[i].slice(0, eq);
    const val = eq === -1 ? '' : parts[i].slice(eq + 1);
    if (key === 'screensaver' && val === '1') return 'screensaver';
  }
  return 'normal';
}

// ---------------------------------------------------------------------------
// Browser-DOM + FlapRenderer (3D)
// ---------------------------------------------------------------------------
if (typeof document !== 'undefined') {
  // Bildschirmschoner-Modus vor resolveConfig/buildRenderLayout ermitteln (einmalig).
  // Ist er aktiv, gilt clockConfig.messenger = false: keine signal/whatsapp-Zeilen,
  // loadMessenger/renderMessenger bleiben stumm.
  const isScreensaver = parseMode(window.location.search) === 'screensaver';
  const clockConfig = resolveConfig(
    typeof window !== 'undefined' ? window.CLOCK_CONFIG : undefined
  );
  if (isScreensaver) {
    clockConfig.messenger = false;
  }
  const WEATHER_URL = weatherUrl(clockConfig.city);
  const WEATHER_REFRESH_MS = 10 * 60 * 1000;
  const TIMER_KEY = 'flap.timer';
  const STOPWATCH_KEY = 'flap.stopwatch';
  const SOUND_KEY = 'flap.sound';
  const CHIME_KEY = 'flap.chime';

  /** Zeilen-Layout für FlapRenderer.init (ohne Messenger ohne signal/whatsapp). */
  const RENDER_LAYOUT = buildRenderLayout(clockConfig);

  let soundOn = false;
  let chimeOn = true;
  let audioCtx = null;
  let statusTimer = null;

  // ---- localStorage (jeder Zugriff in try/catch) ----
  function storageGetJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function storageSetJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* ignore */
    }
  }

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    return audioCtx;
  }

  /** Ein kurzer Doppelton (zwei Sinus-Töne) zu Zeitpunkt t0. */
  function beepAt(ctx, t0) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.11);
  }

  /** 3x kurzer Doppelton — unabhängig vom S-Sound-Schalter. */
  function playAlarm() {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(function () {});
    }
    const t0 = ctx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) {
      const base = t0 + i * 0.42;
      beepAt(ctx, base);
      beepAt(ctx, base + 0.13);
    }
  }

  // ---- Darstellung über FlapRenderer ----
  function renderTime(date) {
    const t = formatTime(date); // "HH:MM"
    FlapRenderer.setText('time', t);
  }

  function renderDate(date) {
    FlapRenderer.setText('date', formatDate(date));
  }

  function renderWeather(w, isError) {
    if (isError) {
      FlapRenderer.setText('weather', 'KEINE DATEN');
      return;
    }
    const parts = [w.temp, w.text, w.wind, w.humidity];
    FlapRenderer.setText('weather', parts.join('  '));
  }

  function renderMessenger(counts, isError) {
    if (!clockConfig.messenger) return;
    const signalCounts = isError ? undefined : counts && counts.signal;
    const whatsappCounts = isError ? undefined : counts && counts.whatsapp;
    FlapRenderer.setText('signal', formatMessengerRow('SIGNAL', signalCounts));
    FlapRenderer.setText('whatsapp', formatMessengerRow('WHATSAPP', whatsappCounts));
  }

  // ---- Takt: Aktualisierung zum Minutenwechsel, Prüfung jede Sekunde ----
  function startClock() {
    let prevDate = null;
    function tick() {
      const now = new Date();
      // Standuhr: genau einmal bei :00/:30 — kein Nachholen nach Seitenstart
      if (prevDate && chimeOn && typeof FlapSound !== 'undefined' && FlapSound.shouldChime) {
        const ev = FlapSound.shouldChime(prevDate, now);
        if (ev && FlapSound.chime) {
          if (ev.type === 'hour') {
            FlapSound.chime(ev.strikes, 0);
          } else if (ev.type === 'half') {
            FlapSound.chime(0, 30);
          }
        }
      }
      prevDate = now;
      renderTime(now);
      window.setTimeout(tick, 1000);
    }
    tick();
  }

  function startDateClock() {
    function tick() {
      renderDate(new Date());
      window.setTimeout(tick, 30 * 1000);
    }
    tick();
  }

  // ---- Wetter ----
  function loadWeather() {
    if (typeof fetch !== 'function') {
      renderWeather(null, true);
      return;
    }
    fetch(WEATHER_URL)
      .then(function (res) {
        if (!res || !res.ok) throw new Error('http ' + (res && res.status));
        return res.json();
      })
      .then(function (json) {
        const w = formatWeather(json);
        if (w.temp === '--' && w.text === '--' && w.wind === '--' && w.humidity === '--') {
          renderWeather(null, true);
        } else {
          renderWeather(w, false);
        }
      })
      .catch(function () {
        renderWeather(null, true);
      });
  }

  // ---- Messenger (Signal / WhatsApp) ----
  function loadMessenger() {
    if (!clockConfig.messenger) return;
    if (typeof fetch !== 'function') {
      renderMessenger(null, true);
      return;
    }
    fetch(MESSENGER_URL)
      .then(function (res) {
        if (!res || !res.ok) throw new Error('http ' + (res && res.status));
        return res.json();
      })
      .then(function (json) {
        renderMessenger(json, false);
      })
      .catch(function () {
        renderMessenger(null, true);
      });
  }

  // ---- Cursor ausblenden / Controls ein-/ausblenden ----
  function initCursor() {
    let timer = null;
    function show() {
      document.body.classList.remove('hide-cursor');
      if (typeof FlapRenderer !== 'undefined' && FlapRenderer.setControlsVisible) {
        FlapRenderer.setControlsVisible(true);
      }
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        document.body.classList.add('hide-cursor');
        if (typeof FlapRenderer !== 'undefined' && FlapRenderer.setControlsVisible) {
          FlapRenderer.setControlsVisible(false);
        }
      }, 3000);
    }
    document.addEventListener('mousemove', show);
    document.addEventListener('mousedown', show);
    document.addEventListener('keydown', show);
    show();
  }

  // ---- Fullscreen / Sound ----
  function toggleFullscreen() {
    const doc = document;
    const el = doc.documentElement;
    if (!doc.fullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(function () {});
      }
    } else if (doc.exitFullscreen) {
      doc.exitFullscreen().catch(function () {});
    }
  }

  function setHint() {
    const hint = document.getElementById('hint');
    if (hint) {
      hint.textContent =
        'S Sound ' +
        (soundOn ? 'AN' : 'AUS') +
        ' · G Standuhr ' +
        (chimeOn ? 'AN' : 'AUS') +
        ' · F Vollbild · T Timer · R Reset · Leertaste Stoppuhr';
    }
  }

  /** Kurze Statusanzeige beim Umschalten im Hinweistext unten rechts. */
  function flashStatus(text) {
    const hint = document.getElementById('hint');
    if (!hint) return;
    hint.textContent = text;
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(function () {
      statusTimer = null;
      setHint();
    }, 1500);
  }

  function syncSoundState() {
    if (typeof FlapSound === 'undefined') return;
    if (FlapSound.setClackEnabled) FlapSound.setClackEnabled(soundOn);
    if (FlapSound.setChimeEnabled) FlapSound.setChimeEnabled(chimeOn);
  }

  function toggleSound() {
    soundOn = !soundOn;
    storageSetJson(SOUND_KEY, soundOn);
    syncSoundState();
    if (soundOn) {
      if (typeof FlapSound !== 'undefined' && FlapSound.init) FlapSound.init();
      if (typeof FlapSound !== 'undefined' && FlapSound.clack) FlapSound.clack('minute');
    }
    flashStatus('SOUND ' + (soundOn ? 'AN' : 'AUS'));
  }

  function toggleChime() {
    chimeOn = !chimeOn;
    storageSetJson(CHIME_KEY, chimeOn);
    syncSoundState();
    flashStatus('STANDUHR ' + (chimeOn ? 'AN' : 'AUS'));
  }

  function restoreSoundState() {
    // Standard: Klack aus, Standuhr an
    const s = storageGetJson(SOUND_KEY);
    soundOn = s === true;
    const c = storageGetJson(CHIME_KEY);
    chimeOn = c !== false;
    syncSoundState();
  }

  // ---- Timer / Stoppuhr Zustand ----
  const DEFAULT_PRESET = { h: 0, m: 5 };

  const timerState = {
    preset: { h: DEFAULT_PRESET.h, m: DEFAULT_PRESET.m },
    running: false,
    endAt: null,
    remainingMs: DEFAULT_PRESET.h * 3600000 + DEFAULT_PRESET.m * 60000,
    finished: false,
  };

  const swState = {
    running: false,
    startedAt: 0,
    accumulatedMs: 0,
  };

  function presetToMs(p) {
    const h = p && isFiniteNumber(p.h) ? p.h : 0;
    const m = p && isFiniteNumber(p.m) ? p.m : 0;
    return h * 3600000 + m * 60000;
  }

  function saveTimerState() {
    storageSetJson(TIMER_KEY, {
      preset: timerState.preset,
      running: timerState.running,
      endAt: timerState.endAt,
      remainingMs: timerState.remainingMs,
      finished: timerState.finished,
    });
  }

  function saveSwState() {
    storageSetJson(STOPWATCH_KEY, {
      running: swState.running,
      startedAt: swState.startedAt,
      accumulatedMs: swState.accumulatedMs,
    });
  }

  function restoreTimerState() {
    const data = storageGetJson(TIMER_KEY);
    if (!data || typeof data !== 'object') return;
    if (data.preset && typeof data.preset === 'object') {
      timerState.preset = adjustPreset(data.preset, 'none', 0);
    }
    timerState.remainingMs = presetToMs(timerState.preset);
    if (isFiniteNumber(data.remainingMs) && data.remainingMs >= 0) {
      timerState.remainingMs = data.remainingMs;
    }
    timerState.running = !!data.running;
    timerState.endAt = isFiniteNumber(data.endAt) ? data.endAt : null;
    timerState.finished = false;
    if (timerState.running) {
      const rem = countdownRemaining(timerState, Date.now());
      if (rem <= 0) {
        timerState.running = false;
        timerState.remainingMs = 0;
        timerState.endAt = null;
      }
    }
  }

  function restoreSwState() {
    const data = storageGetJson(STOPWATCH_KEY);
    if (!data || typeof data !== 'object') return;
    swState.running = !!data.running;
    swState.startedAt = isFiniteNumber(data.startedAt) ? data.startedAt : 0;
    swState.accumulatedMs = isFiniteNumber(data.accumulatedMs) && data.accumulatedMs >= 0 ? data.accumulatedMs : 0;
    if (swState.running && !swState.startedAt) {
      swState.running = false;
    }
  }

  function updateTimerDisplay() {
    if (isScreensaver) return;
    const now = Date.now();
    if (timerState.running && countdownRemaining(timerState, now) <= 0) {
      timerState.running = false;
      timerState.remainingMs = 0;
      timerState.endAt = null;
      timerState.finished = true;
      saveTimerState();
      playAlarm();
      if (typeof FlapRenderer !== 'undefined' && FlapRenderer.setBlink) {
        FlapRenderer.setBlink('timer', true);
      }
    }
    const ms = timerState.running ? countdownRemaining(timerState, Date.now()) : timerState.remainingMs;
    const str = formatDuration(ms, 'ceil');
    FlapRenderer.setText('timer', str);
  }

  function updateSwDisplay() {
    if (isScreensaver) return;
    const elapsed = stopwatchElapsed(swState, Date.now());
    const str = formatDuration(elapsed, 'floor');
    FlapRenderer.setText('stopwatch', str);
  }

  function toggleTimer() {
    if (timerState.finished) return;
    if (timerState.running) {
      timerState.remainingMs = countdownRemaining(timerState, Date.now());
      timerState.running = false;
      timerState.endAt = null;
    } else {
      const ms = timerState.remainingMs > 0 ? timerState.remainingMs : presetToMs(timerState.preset);
      if (ms <= 0) return;
      timerState.remainingMs = ms;
      timerState.endAt = Date.now() + ms;
      timerState.running = true;
    }
    saveTimerState();
  }

  function resetTimer() {
    timerState.running = false;
    timerState.endAt = null;
    timerState.finished = false;
    timerState.remainingMs = presetToMs(timerState.preset);
    saveTimerState();
    if (typeof FlapRenderer !== 'undefined' && FlapRenderer.setBlink) {
      FlapRenderer.setBlink('timer', false);
    }
  }

  function toggleStopwatch() {
    if (swState.running) {
      swState.accumulatedMs = stopwatchElapsed(swState, Date.now());
      swState.running = false;
    } else {
      swState.startedAt = Date.now();
      swState.running = true;
    }
    saveSwState();
  }

  function resetStopwatch() {
    swState.running = false;
    swState.startedAt = 0;
    swState.accumulatedMs = 0;
    saveSwState();
  }

  function applyPresetDelta(field, delta) {
    if (timerState.running || timerState.finished) return;
    timerState.preset = adjustPreset(timerState.preset, field, delta);
    timerState.remainingMs = presetToMs(timerState.preset);
    saveTimerState();
    updateTimerDisplay();
  }

  /** 3D-Bedientasten → Timer/Stoppuhr-Logik. */
  let lastControlAt = 0;
  function handleControl(ev) {
    if (isScreensaver) return;
    if (!ev || !ev.control) return;
    lastControlAt = Date.now();
    switch (ev.control) {
      case 'timerHourUp':
        applyPresetDelta('h', 1);
        break;
      case 'timerHourDown':
        applyPresetDelta('h', -1);
        break;
      case 'timerMinUp':
        applyPresetDelta('m', 1);
        break;
      case 'timerMinDown':
        applyPresetDelta('m', -1);
        break;
      case 'timerStartPause':
        toggleTimer();
        updateTimerDisplay();
        break;
      case 'timerReset':
        resetTimer();
        updateTimerDisplay();
        break;
      case 'swStartPause':
        toggleStopwatch();
        updateSwDisplay();
        break;
      case 'swReset':
        resetStopwatch();
        updateSwDisplay();
        break;
    }
  }

  function initTimerStopwatch() {
    restoreTimerState();
    restoreSwState();

    if (typeof FlapRenderer !== 'undefined' && FlapRenderer.onControl) {
      FlapRenderer.onControl(handleControl);
    }

    // Screensaver: kein Sekundentakt, setText für timer/stopwatch entfällt,
    // localStorage-Zustand bleibt unverändert (läuft im Normalmodus weiter).
    if (isScreensaver) return;

    function tick() {
      updateTimerDisplay();
      updateSwDisplay();
      window.setTimeout(tick, 250);
    }
    tick();
  }

  function isControlTarget(el) {
    if (el && el.closest && el.closest('#timer, #stopwatch')) return true;
    // 3D-Bedienelement: kürzlich per Raycaster ausgelöst (Doppelklick nicht Vollbild)
    return Date.now() - lastControlAt < 400;
  }

  function initControls() {
    if (isScreensaver) return;
    document.addEventListener('keydown', function (e) {
      const k = e.key;
      if (k === 'f' || k === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (k === 's' || k === 'S') {
        e.preventDefault();
        toggleSound();
      } else if (k === 'g' || k === 'G') {
        e.preventDefault();
        toggleChime();
      } else if (k === 't' || k === 'T') {
        e.preventDefault();
        toggleTimer();
        updateTimerDisplay();
      } else if (k === 'r' || k === 'R') {
        e.preventDefault();
        resetTimer();
        updateTimerDisplay();
      } else if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        toggleStopwatch();
        updateSwDisplay();
      } else if (k === 'Backspace') {
        e.preventDefault();
        resetStopwatch();
        updateSwDisplay();
      }
    });
    // Vollbild nur per Taste F oder Doppelklick außerhalb der Bedienelemente
    document.addEventListener('dblclick', function (e) {
      if (isControlTarget(e.target)) return;
      toggleFullscreen();
    });
  }

  function showWebglError() {
    const el = document.getElementById('webgl-error');
    if (el) el.hidden = false;
  }

  function init() {
    // isScreensaver ist bereits oben ermittelt (einzige Berechnung)
    if (isScreensaver) {
      document.body.classList.add('screensaver');
      document.body.classList.add('hide-cursor');
    }

    if (typeof FlapSound !== 'undefined' && FlapSound.init) {
      FlapSound.init();
    }
    restoreSoundState();
    setHint();

    const canvas = document.getElementById('stage');
    let ok = false;
    try {
      ok = FlapRenderer.init(canvas, RENDER_LAYOUT, {
        screensaver: isScreensaver,
        cityLabel: clockConfig.city.name,
      });
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      showWebglError();
      return;
    }

    if (typeof FlapRenderer.setControlsVisible === 'function') {
      FlapRenderer.setControlsVisible(!isScreensaver);
    }

    if (!isScreensaver) {
      initCursor();
      initControls();
    }

    startClock();
    startDateClock();
    loadWeather();
    window.setInterval(function () {
      loadWeather();
    }, WEATHER_REFRESH_MS);
    if (clockConfig.messenger) {
      loadMessenger();
      window.setInterval(function () {
        loadMessenger();
      }, 30 * 1000);
    }
    initTimerStopwatch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

// ---------------------------------------------------------------------------
// Export für Node-Tests
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CHARSET: CHARSET,
    DIGITS: DIGITS,
    ROW_CHARSETS: ROW_CHARSETS,
    TIME_MODULES: TIME_MODULES,
    MESSENGER_ROW_LEN: MESSENGER_ROW_LEN,
    MESSENGER_URL: MESSENGER_URL,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    resolveConfig: resolveConfig,
    buildRenderLayout: buildRenderLayout,
    weatherUrl: weatherUrl,
    formatTime: formatTime,
    formatDate: formatDate,
    weatherCodeToText: weatherCodeToText,
    formatWeather: formatWeather,
    formatMessengerRow: formatMessengerRow,
    flapSequence: flapSequence,
    retarget: retarget,
    formatDuration: formatDuration,
    adjustPreset: adjustPreset,
    countdownRemaining: countdownRemaining,
    stopwatchElapsed: stopwatchElapsed,
    parseMode: parseMode,
  };
}
