'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  CHARSET,
  DIGITS,
  ROW_CHARSETS,
  TIME_MODULES,
  MESSENGER_ROW_LEN,
  MESSENGER_URL,
  DEFAULT_CONFIG,
  resolveConfig,
  buildRenderLayout,
  weatherUrl,
  formatTime,
  formatDate,
  weatherCodeToText,
  formatWeather,
  formatMessengerRow,
  flapSequence,
  retarget,
  formatDuration,
  adjustPreset,
  countdownRemaining,
  stopwatchElapsed,
  parseMode,
} = require('./app.js');

// AK 1 (angepasst: HH:MM ohne Sekunden)
test('AK1: formatTime führende Nullen, 24h HH:MM', () => {
  assert.strictEqual(formatTime(new Date(2026, 9, 23, 9, 5, 7)), '09:05');
});

// AK 2
test('AK2: formatDate deutsche Kürzel mit führenden Nullen', () => {
  assert.strictEqual(formatDate(new Date(2026, 9, 23)), 'FR 23 OKT 2026');
  assert.strictEqual(formatDate(new Date(2026, 2, 1)), 'SO 01 MÄR 2026');
});

// AK 3
test('AK3: weatherCodeToText Mapping und Länge ≤ 10', () => {
  assert.strictEqual(weatherCodeToText(0), 'KLAR');
  assert.strictEqual(weatherCodeToText(63), 'REGEN');
  assert.strictEqual(weatherCodeToText(95), 'GEWITTER');
  assert.strictEqual(weatherCodeToText(999), '--');

  const samples = [
    0, 1, 2, 3, 45, 48, 51, 55, 57, 61, 65, 67, 71, 75, 77, 80, 82, 85, 86, 95, 96, 99, 999, -1, 42,
  ];
  for (const c of samples) {
    const t = weatherCodeToText(c);
    assert.ok(typeof t === 'string', 'string for code ' + c);
    assert.ok(t.length <= 10, `code ${c}: "${t}" length ${t.length} > 10`);
    assert.strictEqual(t, t.toUpperCase(), `code ${c}: "${t}" not uppercase`);
  }
});

// AK 4
test('AK4: formatWeather rundet Temperatur/Vind und behält Minus', () => {
  const r = formatWeather({
    current: {
      temperature_2m: -2.6,
      weather_code: 3,
      wind_speed_10m: 14.7,
      relative_humidity_2m: 81,
    },
  });
  assert.strictEqual(r.temp, '-3°C');
  assert.strictEqual(r.text, 'BEWÖLKT');
  assert.strictEqual(r.wind, '15 KM/H');
  assert.strictEqual(r.humidity, '81%');
});

// AK 5
test('AK5: flapSequence vorwärts mit Wrap-around, leer bei Gleichheit', () => {
  assert.deepStrictEqual(flapSequence('A', 'C', CHARSET), ['B', 'C']);
  assert.deepStrictEqual(flapSequence('A', 'A', CHARSET), []);

  const wrap = flapSequence('-', ' ', CHARSET);
  assert.ok(Array.isArray(wrap) && wrap.length > 0, 'wrap sequence not empty');
  assert.strictEqual(wrap[wrap.length - 1], ' ', 'ends on space');
  // "-" ist letztes Zeichen in CHARSET, erster Schritt muss wrappen
  assert.strictEqual(wrap[0], ' ', 'first step wraps to space');
  assert.strictEqual(CHARSET.indexOf('-'), CHARSET.length - 1, '"-" is last charset char');
});

// AK 6
test('AK6: formatWeather wirft nicht bei fehlendem/ungültigem Objekt', () => {
  const inputs = [null, undefined, 0, '', 'x', [], {}, { current: null }, { current: 'x' }, { current: {} }];
  for (const input of inputs) {
    assert.doesNotThrow(() => formatWeather(input), 'threw for ' + JSON.stringify(input));
    const r = formatWeather(input);
    assert.strictEqual(typeof r, 'object');
    assert.ok(String(r.temp).includes('--'), 'temp has -- for ' + JSON.stringify(input));
    assert.ok(String(r.text).includes('--'), 'text has -- for ' + JSON.stringify(input));
    assert.ok(String(r.wind).includes('--'), 'wind has -- for ' + JSON.stringify(input));
    assert.ok(String(r.humidity).includes('--'), 'humidity has -- for ' + JSON.stringify(input));
  }
});

// AK 7
test('AK7: require("./app.js") ohne DOM-Zugriff in Node', () => {
  assert.doesNotThrow(() => {
    // frisch laden, wie `node -e "require('./app.js')"`
    const resolved = require.resolve('./app.js');
    delete require.cache[resolved];
    require('./app.js');
  });
  const mod = require('./app.js');
  assert.strictEqual(typeof mod.formatTime, 'function');
  assert.strictEqual(typeof mod.flapSequence, 'function');
});

// AK 8 (ersetzt: ehemals CSS 3D-Flip-Prüfung) — jetzt 3D-Canvas-Struktur
test('AK8: index.html + style.css Struktur (Canvas, Scripts, WebGL-Hinweis)', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(html, /style\.css/);
  assert.match(html, /render3d\.js/);
  assert.match(html, /app\.js/);

  // Vollbild-Canvas
  assert.match(html, /<canvas\b/i);
  assert.match(css, /#stage/);
  assert.match(css, /width:\s*100vw/);
  assert.match(css, /height:\s*100vh/);

  // WebGL-Fallback-Hinweis
  assert.match(html, /WebGL nicht verfügbar/);
  assert.match(css, /webgl-error/);
});

// --- Neue Akzeptanzkriterien ---

// Kriterium 2: DIGITS, flapSequence 9→0, retarget
test('NEU2: DIGITS, flapSequence("9","0")=["0"], retarget("3","5")=["4","5"]', () => {
  assert.strictEqual(DIGITS, '0123456789');
  assert.deepStrictEqual(flapSequence('9', '0', DIGITS), ['0']);
  assert.deepStrictEqual(retarget('3', '5', DIGITS), ['4', '5']);
  // retarget ist identisch zu flapSequence
  assert.deepStrictEqual(retarget('A', 'C', CHARSET), flapSequence('A', 'C', CHARSET));
});

// Kriterium 3: ROW_CHARSETS, DOM-Code verwendet sie
test('NEU3: ROW_CHARSETS time=DIGITS, date/weather=CHARSET, DOM nutzt sie', () => {
  assert.strictEqual(ROW_CHARSETS.time, DIGITS);
  assert.strictEqual(ROW_CHARSETS.date, CHARSET);
  assert.strictEqual(ROW_CHARSETS.weather, CHARSET);

  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(src, /ROW_CHARSETS\.time/);
  assert.match(src, /ROW_CHARSETS\.date/);
  assert.match(src, /ROW_CHARSETS\.weather/);
});

// Kriterium 4: keine Warteschlange (kein Feld queue)
test('NEU4: app.js enthält kein Feld queue', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.ok(!/\bqueue\b/.test(src), 'app.js darf "queue" nicht enthalten');
});

// Kriterium 5: genau 4 Zeit-Module, keine Sekunden
test('NEU5: TIME_MODULES=4, keine Sekunden-Module', () => {
  assert.strictEqual(TIME_MODULES, 4);
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.ok(!src.includes('timeS'), 'keine timeS-Gruppe');
  assert.doesNotMatch(src, /slice\(6,\s*8\)/, 'keine Sekunden-Slice');
  assert.doesNotMatch(src, /colon2/, 'kein zweiter Doppelpunkt für Sekunden');
});

// Kriterium 6 (ersetzt: ehemals font-size-CSS) — jetzt Layout/Scale in app.js + render3d.js
test('NEU6: Zeit-Zeile hat höchste scale, Layout in app.js und render3d.js', () => {
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const r3d = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');

  // Zeit-Zeile scale 1.0, andere kleiner
  assert.match(app, /id:\s*'time',\s*length:\s*4,\s*charset:\s*ROW_CHARSETS\.time,\s*scale:\s*1(\.0)?/);
  assert.match(app, /id:\s*'date'.*scale:\s*0\./);
  assert.match(app, /id:\s*'weather'.*scale:\s*0\./);

  // layoutRows implementiert Mindesthöhe 0.40 für die Zeit-Zeile
  assert.match(r3d, /0\.42/);
  assert.match(r3d, /layoutRows/);
});

// Kriterium 7 (ersetzt: ehemals --clock-h CSS) — jetzt Viewport-Fit in layoutRows
test('NEU7: layoutRows passt in alle Viewports, Zeit ≥ 40 % Höhe', () => {
  const { layoutRows, DEFAULT_LAYOUT } = require('./render3d.js');
  for (const [w, h] of [
    [1920, 1080],
    [1366, 768],
    [2560, 1440],
  ]) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    const time = rows.find((r) => r.id === 'time');
    assert.ok(time.height >= 0.4, `time.height ${time.height} @${w}x${h}`);
    for (const r of rows) {
      assert.ok(r.box.left >= 0 && r.box.right <= 1, r.id + ' horizontal im Viewport');
      assert.ok(r.box.top >= 0 && r.box.bottom <= 1, r.id + ' vertikal im Viewport');
    }
  }
});

// --- Messenger-Akzeptanzkriterien ---

// AK 6: formatMessengerRow
test('MSG6: formatMessengerRow Länge 24, Zahlenformat, 9999-Clamp, KEINE DATEN', () => {
  assert.strictEqual(MESSENGER_ROW_LEN, 24);

  const ok = formatMessengerRow('SIGNAL', { ok: true, group: 3, direct: 12 });
  assert.strictEqual(ok, 'SIGNAL   GRP   3 EIN  12');
  assert.strictEqual(ok.length, MESSENGER_ROW_LEN);

  const wa = formatMessengerRow('WHATSAPP', { ok: true, group: 0, direct: 5 });
  assert.strictEqual(wa, 'WHATSAPP GRP   0 EIN   5');
  assert.strictEqual(wa.length, MESSENGER_ROW_LEN);

  const big = formatMessengerRow('SIGNAL', { ok: true, group: 12345, direct: 99999 });
  assert.strictEqual(big, 'SIGNAL   GRP9999 EIN9999');
  assert.strictEqual(big.length, MESSENGER_ROW_LEN);

  const fail = formatMessengerRow('SIGNAL', { ok: false, group: 0, direct: 0 });
  assert.strictEqual(fail, 'SIGNAL   KEINE DATEN    ');
  assert.strictEqual(fail.length, MESSENGER_ROW_LEN);

  const none = formatMessengerRow('WHATSAPP', undefined);
  assert.strictEqual(none, 'WHATSAPP KEINE DATEN    ');
  assert.strictEqual(none.length, MESSENGER_ROW_LEN);
});

// AK 7: zwei Messenger-Zeilen + MESSENGER_URL (angepasst: 3D-Renderer)
test('MSG7: app.js nutzt MESSENGER_URL und setzt signal/whatsapp über FlapRenderer', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

  assert.strictEqual(MESSENGER_URL, 'http://127.0.0.1:8787/counts');
  assert.match(src, /MESSENGER_URL/);
  assert.match(src, /fetch\(\s*MESSENGER_URL\s*\)/);

  // Zeilen-IDs im Layout und setText-Aufrufe
  assert.match(src, /id:\s*'signal'/);
  assert.match(src, /id:\s*'whatsapp'/);
  assert.match(src, /setText\(\s*'signal'/);
  assert.match(src, /setText\(\s*'whatsapp'/);
});

// AK 10: Uhr-starten.cmd
test('MSG10: Uhr-starten.cmd startet Helper und Chrome-Kiosk', () => {
  const cmd = fs.readFileSync(path.join(__dirname, 'Uhr-starten.cmd'), 'utf8');
  assert.match(cmd, /--kiosk/);
  assert.match(cmd, /--user-data-dir/);
  assert.match(cmd, /index\.html/);
  assert.match(cmd, /FallblattHelper/);
  assert.match(cmd, /npm start/);
  // AK 5 (Supervisor): cmd /k statt cmd /c, damit Fehler sichtbar bleiben
  assert.match(cmd, /cmd \/k/);
  assert.doesNotMatch(cmd, /cmd \/c/);
});

// --- Timer / Stoppuhr ---

// AK 1: formatDuration
test('AK1: formatDuration ceil/floor, negativ, über 99:59:59', () => {
  assert.strictEqual(formatDuration(3723000), '01:02:03');
  assert.strictEqual(formatDuration(1500, 'ceil'), '00:00:02');
  assert.strictEqual(formatDuration(1500), '00:00:01');
  assert.strictEqual(formatDuration(-5), '00:00:00');
  assert.strictEqual(formatDuration(400000000), '99:59:59');
});

// AK 2: adjustPreset
test('AK2: adjustPreset Wrap-around ohne Übertrag', () => {
  assert.deepStrictEqual(adjustPreset({ h: 0, m: 59 }, 'm', 1), { h: 0, m: 0 });
  assert.deepStrictEqual(adjustPreset({ h: 0, m: 0 }, 'h', -1), { h: 99, m: 0 });
  assert.deepStrictEqual(adjustPreset({ h: 1, m: 30 }, 'h', 1), { h: 2, m: 30 });
});

// AK 3: countdownRemaining
test('AK3: countdownRemaining läuft/pausiert, min 0', () => {
  assert.strictEqual(countdownRemaining({ running: true, endAt: 10000, remainingMs: 0 }, 4000), 6000);
  assert.strictEqual(countdownRemaining({ running: true, endAt: 10000 }, 12000), 0);
  assert.strictEqual(countdownRemaining({ running: false, remainingMs: 5000 }, 99999), 5000);
});

// AK 4: stopwatchElapsed
test('AK4: stopwatchElapsed läuft/pausiert', () => {
  assert.strictEqual(stopwatchElapsed({ running: true, startedAt: 1000, accumulatedMs: 500 }, 3000), 2500);
  assert.strictEqual(stopwatchElapsed({ running: false, startedAt: 0, accumulatedMs: 700 }, 9999), 700);
});

// AK 5: parseMode
test('AK5: parseMode screensaver=1 und normal', () => {
  assert.strictEqual(parseMode('?screensaver=1'), 'screensaver');
  assert.strictEqual(parseMode(''), 'normal');
  assert.strictEqual(parseMode('?x=1&screensaver=1'), 'screensaver');
});

// AK 6 (ersetzt: ehemals DOM-Button-IDs) — jetzt 3D-Steuerung in app.js
test('AK6: app.js verdrahtet FlapRenderer-Steuerelemente für Timer/Stoppuhr', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

  // 3D-Controls → Logik
  assert.match(src, /onControl\(/);
  assert.match(src, /timerHourUp/);
  assert.match(src, /timerHourDown/);
  assert.match(src, /timerMinUp/);
  assert.match(src, /timerMinDown/);
  assert.match(src, /timerStartPause/);
  assert.match(src, /timerReset/);
  assert.match(src, /swStartPause/);
  assert.match(src, /swReset/);

  // Zeilen für Timer/Stoppuhr
  assert.match(src, /setText\(\s*'timer'/);
  assert.match(src, /setText\(\s*'stopwatch'/);
  assert.match(src, /setBlink\(\s*'timer'/);

  // Tastenkürzel bleiben
  assert.match(src, /toggleTimer/);
  assert.match(src, /resetTimer/);
  assert.match(src, /toggleStopwatch/);
  assert.match(src, /resetStopwatch/);
});

// AK 7: Tastenkürzel + kein Klick-Vollbild, dblclick vorhanden
test('AK7: app.js T/R/Leertaste/Backspace, Vollbild nur F oder dblclick', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(src, /k === 't' \|\| k === 'T'/);
  assert.match(src, /k === 'r' \|\| k === 'R'/);
  assert.match(src, /k === ' ' \|\| k === 'Spacebar'/);
  assert.match(src, /Backspace/);
  // Vollbild nicht per einfachem Klick
  assert.doesNotMatch(src, /addEventListener\(\s*['"]click['"][\s\S]{0,200}toggleFullscreen/);
  assert.doesNotMatch(src, /addEventListener\(\s*['"]click['"][\s\S]{0,200}requestFullscreen/);
  // Vollbild per dblclick vorhanden
  assert.match(src, /addEventListener\(\s*['"]dblclick['"]/);
  assert.match(src, /toggleFullscreen/);
});

// AK 8: localStorage-Schlüssel und try/catch
test('AK8: localStorage "flap.timer"/"flap.stopwatch", Zugriff in try/catch', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(src, /flap\.timer/);
  assert.match(src, /flap\.stopwatch/);
  // Jeder localStorage-Zugriff steht in try/catch
  const accesses = [...src.matchAll(/localStorage\.(getItem|setItem)/g)];
  assert.ok(accesses.length >= 2, 'mind. 2 localStorage-Zugriffe');
  for (const a of accesses) {
    const before = src.slice(0, a.index);
    const after = src.slice(a.index);
    const tryIdx = before.lastIndexOf('try');
    const catchIdx = before.lastIndexOf('catch');
    assert.ok(tryIdx > catchIdx, 'localStorage-Zugriff außerhalb von try: ' + a[0]);
    assert.ok(after.includes('catch'), 'kein catch nach localStorage-Zugriff: ' + a[0]);
  }
});

// AK 9: alle bisherigen Tests laufen (indirekt: dieser Test existiert,
// die bisherigen Tests sind unverändert oberhalb und müssen grün bleiben).
// Zusätzlich: Exporte der neuen Funktionen vorhanden.
test('AK9: bisherige Exporte + neue Timer-Funktionen vorhanden', () => {
  assert.strictEqual(typeof formatTime, 'function');
  assert.strictEqual(typeof formatDate, 'function');
  assert.strictEqual(typeof formatWeather, 'function');
  assert.strictEqual(typeof formatMessengerRow, 'function');
  assert.strictEqual(typeof flapSequence, 'function');
  assert.strictEqual(typeof retarget, 'function');
  assert.strictEqual(typeof formatDuration, 'function');
  assert.strictEqual(typeof adjustPreset, 'function');
  assert.strictEqual(typeof countdownRemaining, 'function');
  assert.strictEqual(typeof stopwatchElapsed, 'function');
  assert.strictEqual(typeof parseMode, 'function');
});

// Klang: app.js verdrahtet FlapSound (S/G, Standuhr-Auslösung). Details in sound.test.js.
test('KLANG: app.js nutzt FlapSound für Klack und Stundenschlag', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(src, /FlapSound\.init/);
  assert.match(src, /FlapSound\.shouldChime/);
  assert.match(src, /FlapSound\.chime/);
  assert.match(src, /FlapSound\.setClackEnabled/);
  assert.match(src, /FlapSound\.setChimeEnabled/);
  assert.match(src, /k === 'g' \|\| k === 'G'/);
});

// --- Screensaver: Timer/Stoppuhr aus, init mit screensaver-Option ---

test('SS-AK3: app.js init mit screensaver-Option, setText timer/stopwatch im Screensaver übersprungen', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  // FlapRenderer.init mit screensaver- und cityLabel-Option
  assert.match(
    src,
    /FlapRenderer\.init\(\s*canvas\s*,\s*RENDER_LAYOUT\s*,\s*\{[\s\S]*?screensaver:\s*isScreensaver[\s\S]*?cityLabel:/,
    'init mit { screensaver: isScreensaver, cityLabel: ... }'
  );
  // updateTimerDisplay / updateSwDisplay kehren bei isScreensaver zurück
  assert.match(
    src,
    /function updateTimerDisplay\(\)\s*\{\s*if \(isScreensaver\) return;/,
    'updateTimerDisplay: if (isScreensaver) return'
  );
  assert.match(
    src,
    /function updateSwDisplay\(\)\s*\{\s*if \(isScreensaver\) return;/,
    'updateSwDisplay: if (isScreensaver) return'
  );
  // Kein Sekundentakt im Screensaver
  assert.match(
    src,
    /function initTimerStopwatch\(\)[\s\S]*?if \(isScreensaver\) return;/,
    'initTimerStopwatch: if (isScreensaver) return'
  );
  // setText für timer/stopwatch existiert weiter (Normalmodus)
  assert.match(src, /setText\(\s*'timer'/);
  assert.match(src, /setText\(\s*'stopwatch'/);
  // Standuhr bleibt aktiv: startClock wird unabhängig von isScreensaver aufgerufen
  assert.match(src, /startClock\(\)/);
});

// --- Optionale Konfiguration: resolveConfig / buildRenderLayout / weatherUrl ---

// AK 1: resolveConfig
test('CFG1: resolveConfig undefined -> Defaults (messenger false, Düsseldorf)', () => {
  const cfg = resolveConfig(undefined);
  assert.strictEqual(cfg.messenger, false);
  assert.strictEqual(cfg.city.name, 'DÜSSELDORF');
  assert.strictEqual(cfg.city.latitude, 51.2277);
  assert.strictEqual(cfg.city.longitude, 6.7735);
  assert.strictEqual(cfg.city.timezone, 'Europe/Berlin');
});

test('CFG1b: resolveConfig übernimmt Werte, name wird Großbuchstaben', () => {
  const cfg = resolveConfig({
    messenger: true,
    city: { name: 'Berlin', latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin' },
  });
  assert.strictEqual(cfg.messenger, true);
  assert.strictEqual(cfg.city.name, 'BERLIN');
  assert.strictEqual(cfg.city.latitude, 52.52);
  assert.strictEqual(cfg.city.longitude, 13.405);
  assert.strictEqual(cfg.city.timezone, 'Europe/Berlin');
});

test('CFG1c: resolveConfig ungültige latitude -> Default', () => {
  const cfg = resolveConfig({ messenger: true, city: { name: 'Berlin', latitude: 'x' } });
  assert.strictEqual(cfg.city.latitude, 51.2277);
  assert.strictEqual(cfg.city.name, 'BERLIN');
  assert.strictEqual(cfg.messenger, true);
});

test('CFG1d: resolveConfig fehlende/ungültige Felder -> Defaults', () => {
  const a = resolveConfig(null);
  assert.strictEqual(a.messenger, false);
  assert.strictEqual(a.city.name, 'DÜSSELDORF');
  const b = resolveConfig({ messenger: 'yes', city: { name: '', latitude: NaN, longitude: Infinity, timezone: '  ' } });
  assert.strictEqual(b.messenger, false);
  assert.strictEqual(b.city.name, 'DÜSSELDORF');
  assert.strictEqual(b.city.latitude, 51.2277);
  assert.strictEqual(b.city.longitude, 6.7735);
  assert.strictEqual(b.city.timezone, 'Europe/Berlin');
  assert.strictEqual(typeof DEFAULT_CONFIG, 'object');
});

// AK 2: buildRenderLayout
test('CFG2: buildRenderLayout messenger false -> keine signal/whatsapp-Zeilen', () => {
  const rows = buildRenderLayout(resolveConfig(undefined));
  const ids = rows.map((r) => r.id);
  assert.ok(!ids.includes('signal'), 'keine signal-Zeile');
  assert.ok(!ids.includes('whatsapp'), 'keine whatsapp-Zeile');
  assert.deepStrictEqual(ids, ['time', 'date', 'weather', 'timer', 'stopwatch']);
});

test('CFG2b: buildRenderLayout messenger true -> identisch zum bisherigen RENDER_LAYOUT', () => {
  const rows = buildRenderLayout({ messenger: true });
  const ids = rows.map((r) => r.id);
  assert.deepStrictEqual(ids, [
    'time',
    'date',
    'weather',
    'signal',
    'whatsapp',
    'timer',
    'stopwatch',
  ]);
  // Zeilen-Eigenschaften wie bisher
  const byId = {};
  for (const r of rows) byId[r.id] = r;
  assert.strictEqual(byId.time.length, 4);
  assert.strictEqual(byId.date.length, 14);
  assert.strictEqual(byId.weather.length, 27);
  assert.strictEqual(byId.signal.length, 24);
  assert.strictEqual(byId.whatsapp.length, 24);
  assert.strictEqual(byId.timer.length, 6);
  assert.strictEqual(byId.stopwatch.length, 6);
  assert.strictEqual(byId.signal.charset, ROW_CHARSETS.messenger);
  assert.strictEqual(byId.whatsapp.charset, ROW_CHARSETS.messenger);
  assert.strictEqual(byId.signal.scale, 0.2);
  assert.strictEqual(byId.whatsapp.scale, 0.2);
});

// AK 3: weatherUrl
test('CFG3: weatherUrl(Default-City) identisch zur bisherigen URL', () => {
  const expected =
    'https://api.open-meteo.com/v1/forecast?latitude=51.2277&longitude=6.7735&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=Europe%2FBerlin';
  assert.strictEqual(weatherUrl(DEFAULT_CONFIG.city), expected);
  assert.strictEqual(weatherUrl(resolveConfig(undefined).city), expected);
});

test('CFG3b: weatherUrl mit Berlin-Koordinaten', () => {
  const url = weatherUrl({ name: 'BERLIN', latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin' });
  assert.ok(url.includes('latitude=52.52'), 'latitude=52.52 in URL');
  assert.ok(url.includes('longitude=13.405'), 'longitude=13.405 in URL');
  assert.ok(url.includes('timezone=Europe%2FBerlin'), 'URL-kodierte Zeitzone');
});

// AK 5: Quelltext-Tests
test('CFG5: index.html lädt config.js vor app.js', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const cfgIdx = html.indexOf('config.js');
  const appIdx = html.indexOf('app.js');
  assert.ok(cfgIdx >= 0, 'config.js in index.html');
  assert.ok(appIdx >= 0, 'app.js in index.html');
  assert.ok(cfgIdx < appIdx, 'config.js vor app.js');
  assert.ok(html.includes('Split-Flap Clock'), 'Titel Split-Flap Clock');
});

test('CFG5b: .gitignore enthält config.js', () => {
  const gi = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8');
  assert.ok(gi.split(/\r?\n/).some((l) => l.trim() === 'config.js'), 'config.js in .gitignore');
});

test('CFG5c: Uhr-starten.cmd startet Helper nur bei vorhandenem helper\\package.json', () => {
  const cmd = fs.readFileSync(path.join(__dirname, 'Uhr-starten.cmd'), 'utf8');
  assert.match(cmd, /if exist "%~dp0helper\\package\.json"/);
  // timeout /t 3 nur innerhalb des exist-Blocks
  assert.match(cmd, /if exist "%~dp0helper\\package\.json" \([\s\S]*?timeout \/t 3/);
});

test('CFG5d: render3d.js enthält kein fest verdrahtetes makeLabel(\'city\', \'DÜSSELDORF\'', () => {
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  assert.doesNotMatch(src, /makeLabel\(\s*'city'\s*,\s*'DÜSSELDORF'/);
  assert.match(src, /makeLabel\(\s*'city'\s*,\s*_state\.cityLabel/);
});

// AK 6: npm test – Exporte vorhanden
test('CFG6: resolveConfig, buildRenderLayout, weatherUrl exportiert', () => {
  assert.strictEqual(typeof resolveConfig, 'function');
  assert.strictEqual(typeof buildRenderLayout, 'function');
  assert.strictEqual(typeof weatherUrl, 'function');
});

// AK 4: Ohne Messenger kein fetch auf 127.0.0.1, keine setText für signal/whatsapp
test('CFG4: ohne Messenger kein fetch auf 127.0.0.1 und kein setText signal/whatsapp', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  // loadMessenger und renderMessenger sind durch clockConfig.messenger geschützt
  assert.match(src, /function loadMessenger\(\)\s*\{\s*if \(!clockConfig\.messenger\) return;/);
  assert.match(src, /function renderMessenger\([^)]*\)\s*\{\s*if \(!clockConfig\.messenger\) return;/);
  // Init ruft loadMessenger nur bei clockConfig.messenger auf
  assert.match(src, /if \(clockConfig\.messenger\)\s*\{\s*loadMessenger\(\);/);
});
