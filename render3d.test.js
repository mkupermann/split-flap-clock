'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  flipAngle,
  layoutRows,
  flapSequence,
  createModulePlan,
  glyphBaselineY,
  labelTextureSize,
  flipDurationFor,
  stepDurationFor,
  shadowMapSizeFor,
  sceneSpec,
  playImpactClack,
  CONTROL_NAMES,
  DEFAULT_LAYOUT,
  FlapRenderer,
  FLIP_MS_BIG,
  FLIP_MS_SMALL,
  FLIP_IMPACT,
  CAMERA_TILT_DEG,
  THICKNESS_RATIO,
  FRAME_OVERHANG,
} = require('./render3d.js');

// --- AK3: flipAngle ---
test('AK3: flipAngle Start/Ende, beschleunigter Fall, Überschwingen ≤ 0.08', () => {
  assert.strictEqual(flipAngle(0, 120), 0);
  assert.strictEqual(flipAngle(120, 120), Math.PI);
  assert.ok(flipAngle(60, 120) < Math.PI / 2, 'halbe Zeit < halber Winkel (ease-in)');

  let max = 0;
  for (let t = 0; t <= 120; t++) {
    const a = flipAngle(t, 120);
    if (a > max) max = a;
  }
  assert.ok(max >= Math.PI, 'Maximum ≥ PI');
  assert.ok(max <= Math.PI + 0.08, 'Maximum ≤ PI + 0.08, war ' + max);

  // Monotoner Anstieg bis Aufprall (0..0.82*120)
  let prev = -1;
  for (let t = 0; t <= 98; t++) {
    const a = flipAngle(t, 120);
    assert.ok(a >= prev, 'monoton steigend bei t=' + t);
    prev = a;
  }
});

test('AK3b: flipAngle Endwert exakt PI auch bei anderen Dauern', () => {
  for (const d of [80, 100, 110, 130, 140, 200]) {
    assert.strictEqual(flipAngle(d, d), Math.PI, 'duration ' + d);
    assert.strictEqual(flipAngle(0, d), 0);
    assert.ok(flipAngle(d / 2, d) < Math.PI / 2, 'ease-in d=' + d);
    let max = 0;
    for (let t = 0; t <= d; t++) max = Math.max(max, flipAngle(t, d));
    assert.ok(max <= Math.PI + 0.08, 'overshoot d=' + d + ' max=' + max);
    assert.ok(max >= Math.PI, 'erreicht PI d=' + d);
  }
});

// --- AK4: layoutRows ---
const VIEWPORTS = [
  [1920, 1080],
  [1366, 768],
  [2560, 1440],
];

test('AK4: layoutRows passt in 1920x1080, 1366x768, 2560x1440', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    assert.strictEqual(rows.length, DEFAULT_LAYOUT.length, 'Anzahl Zeilen ' + w + 'x' + h);

    // 1) vollständig innerhalb 0..1
    for (const r of rows) {
      assert.ok(r.box.left >= 0, r.id + ' left ' + r.box.left + ' @' + w);
      assert.ok(r.box.top >= 0, r.id + ' top ' + r.box.top + ' @' + w);
      assert.ok(r.box.right <= 1, r.id + ' right ' + r.box.right + ' @' + w);
      assert.ok(r.box.bottom <= 1, r.id + ' bottom ' + r.box.bottom + ' @' + w);
      assert.ok(r.box.right > r.box.left, r.id + ' width > 0');
      assert.ok(r.box.bottom > r.box.top, r.id + ' height > 0');
    }

    // 2) keine Überlappung
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i].box;
        const b = rows[j].box;
        const overlap =
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        assert.ok(!overlap, rows[i].id + ' überlappt ' + rows[j].id + ' @' + w + 'x' + h);
      }
    }

    // 3) Zeit-Zeile ≥ 0.40 der Viewport-Höhe
    const time = rows.find((r) => r.id === 'time');
    assert.ok(time, 'time-Zeile vorhanden');
    assert.ok(
      time.height >= 0.4,
      'time.height=' + time.height + ' ≥ 0.40 @' + w + 'x' + h
    );
  }
});

test('AK4b: layoutRows Zeit-Zeile ist die höchste Zeile', () => {
  const rows = layoutRows(1920, 1080, DEFAULT_LAYOUT);
  const time = rows.find((r) => r.id === 'time');
  for (const r of rows) {
    if (r.id === 'time') continue;
    assert.ok(time.height >= r.height, 'time ≥ ' + r.id);
  }
});

// --- AK5: require ohne THREE/document ---
test('AK5: render3d.js lädt in Node ohne THREE und document', () => {
  assert.doesNotThrow(() => {
    const resolved = require.resolve('./render3d.js');
    delete require.cache[resolved];
    require('./render3d.js');
  });
  const mod = require('./render3d.js');
  assert.strictEqual(typeof mod.flipAngle, 'function');
  assert.strictEqual(typeof mod.layoutRows, 'function');
  assert.strictEqual(typeof mod.FlapRenderer, 'object');
  assert.strictEqual(typeof mod.FlapRenderer.init, 'function');
  assert.strictEqual(typeof mod.FlapRenderer.setText, 'function');
  assert.strictEqual(typeof mod.FlapRenderer.setBlink, 'function');
  assert.strictEqual(typeof mod.FlapRenderer.onControl, 'function');
  assert.strictEqual(typeof mod.FlapRenderer.setControlsVisible, 'function');
});

// --- AK6: Quelltext: PCFSoftShadowMap, ACESFilmicToneMapping, MeshPhysicalMaterial, Raycaster, Math.min(..., 2) ---
test('AK6: rendersettings und Raycaster im Quelltext', () => {
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  assert.match(src, /PCFSoftShadowMap/);
  assert.match(src, /ACESFilmicToneMapping/);
  assert.match(src, /MeshPhysicalMaterial/);
  assert.match(src, /Raycaster/);
  assert.match(src, /Math\.min\([^)]*,\s*2\)/);
});

// --- AK7: Render-Loop nur bei Aktivität ---
test('AK7: requestAnimationFrame nur unter Aktivitätsbedingung', () => {
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  const rafCalls = [...src.matchAll(/requestAnimationFrame\s*\(/g)];
  assert.ok(rafCalls.length >= 1, 'requestAnimationFrame vorhanden');

  for (const m of rafCalls) {
    // Kontext vor dem Aufruf: mind. 800 Zeichen zurück
    const start = Math.max(0, m.index - 800);
    const ctx = src.slice(start, m.index + 80);
    assert.ok(
      /activity\s*>\s*0|activity\s*>|loopRunning|needRender/.test(ctx),
      'rAF ohne Aktivitätsprüfung bei Index ' + m.index + ': ...' + ctx.slice(-120)
    );
  }

  // Kein bedingungsloser Dauerloop: kein "requestAnimationFrame" am Ende einer Funktion ohne Guard
  // Explizit: tick() ruft rAF nur auf wenn activity > 0 || active
  assert.match(src, /if\s*\(\s*_state\.activity\s*>\s*0\s*\|\|\s*active\s*\)/);
});

// --- AK8: onControl acht Namen + app.js Verdrahtung ---
test('AK8: acht control-Namen in render3d.js und Verdrahtung in app.js', () => {
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

  const expected = [
    'timerHourUp',
    'timerHourDown',
    'timerMinUp',
    'timerMinDown',
    'timerStartPause',
    'timerReset',
    'swStartPause',
    'swReset',
  ];
  for (const name of expected) {
    assert.ok(src.includes("'" + name + "'" + '') || src.includes('"' + name + '"') || src.includes(name),
      'control-Name fehlt in render3d.js: ' + name);
    assert.ok(app.includes(name), 'control-Name nicht verdrahtet in app.js: ' + name);
  }
  assert.deepStrictEqual(CONTROL_NAMES, expected);
  assert.match(src, /onControl/);
  assert.match(app, /onControl/);
});

// --- Zusätzlich: Exports stabil ---
test('Exports: flipAngle, layoutRows, CONTROL_NAMES, DEFAULT_LAYOUT', () => {
  assert.strictEqual(typeof flipAngle, 'function');
  assert.strictEqual(typeof layoutRows, 'function');
  assert.strictEqual(typeof flapSequence, 'function');
  assert.ok(Array.isArray(CONTROL_NAMES) && CONTROL_NAMES.length === 8);
  assert.ok(Array.isArray(DEFAULT_LAYOUT) && DEFAULT_LAYOUT.length === 7);
  const ids = DEFAULT_LAYOUT.map((r) => r.id);
  for (const id of ['time', 'date', 'weather', 'signal', 'whatsapp', 'timer', 'stopwatch']) {
    assert.ok(ids.includes(id), 'Zeile ' + id + ' im DEFAULT_LAYOUT');
  }
});

test('flapSequence: nur vorwärts wie app.js', () => {
  assert.deepStrictEqual(flapSequence('A', 'C', 'ABC'), ['B', 'C']);
  assert.deepStrictEqual(flapSequence('A', 'A', 'ABC'), []);
  assert.deepStrictEqual(flapSequence('9', '0', '0123456789'), ['0']);
});

// --- AK1: three.min.js ---
test('AK1: vendor/three.min.js > 500 KB, enthält "160"', () => {
  const p = path.join(__dirname, 'vendor', 'three.min.js');
  assert.ok(fs.existsSync(p), 'vendor/three.min.js existiert');
  const stat = fs.statSync(p);
  assert.ok(stat.size > 500 * 1024, 'Dateigröße ' + stat.size + ' > 500 KB');
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(content.includes('160'), 'Versionskennung "160" vorhanden');
});

// --- AK2: index.html Script-Reihenfolge + canvas ---
test('AK2: index.html lädt three, render3d, app in dieser Reihenfolge als klassische Scripts + canvas', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  const iThree = html.indexOf('vendor/three.min.js');
  const iRender = html.indexOf('render3d.js');
  const iApp = html.indexOf('app.js');
  assert.ok(iThree !== -1, 'vendor/three.min.js geladen');
  assert.ok(iRender !== -1, 'render3d.js geladen');
  assert.ok(iApp !== -1, 'app.js geladen');
  assert.ok(iThree < iRender, 'three vor render3d');
  assert.ok(iRender < iApp, 'render3d vor app');

  // klassische Scripts: kein type="module"
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  assert.ok(scriptTags.length >= 3, 'mind. 3 Script-Tags');
  for (const tag of scriptTags) {
    assert.ok(!/type\s*=\s*["']module["']/.test(tag), 'kein type=module: ' + tag);
    assert.ok(!/type\s*=\s*["']module["']/.test(html), 'kein type=module im Dokument');
  }

  // canvas vorhanden
  assert.match(html, /<canvas\b/i);
});

// --- Fix1 AK1: kein Textur-Klonen pro Modul ---
test('Fix1-AK1: kein atlas.texture.clone() / Textur-Klonen pro Modul', () => {
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  assert.ok(!/\.texture\.clone\s*\(/.test(src), 'kein .texture.clone() im Quelltext');
  assert.ok(!/atlas\.texture\.clone/.test(src), 'kein atlas.texture.clone');
  // makeGlyphTexture mit clone() muss entfernt sein
  assert.ok(!/makeGlyphTexture/.test(src) || !/clone/.test(src.split('makeGlyphTexture')[1] || ''), 'kein Clonen in makeGlyphTexture');
});

// --- Fix1 AK4: erster setText erzeugt keine Sequenz ---
test('Fix1-AK4: createModulePlan first=true → instant, keine Sequenz', () => {
  const plan = createModulePlan(' ', 'A', DEFAULT_LAYOUT[1].charset, { first: true });
  assert.strictEqual(plan.instant, true, 'instant bei first');
  assert.strictEqual(plan.char, 'A', 'char = target');
  assert.deepStrictEqual(plan.seq, [], 'seq leer');

  // zweiter setText mit Änderung erzeugt Sequenz
  const plan2 = createModulePlan('A', 'C', 'ABCDEF', { first: false, isTime: true });
  assert.strictEqual(plan2.instant, false, 'Animation bei Änderung');
  assert.deepStrictEqual(plan2.seq, ['B', 'C']);

  // gleicher Text: instant, leer
  const plan3 = createModulePlan('A', 'A', 'ABCDEF', { first: false });
  assert.strictEqual(plan3.instant, true);
  assert.deepStrictEqual(plan3.seq, []);
});

// --- Fix1 AK5: layoutRows inkl. Tastenhöhe, Timer/Stoppuhr nebeneinander ---
test('Fix1-AK5: layoutRows mit buttonBox, keine Überlappung, 0..1', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    const bb = rows.buttonBox;
    assert.ok(bb, 'buttonBox vorhanden @' + w + 'x' + h);
    assert.ok(bb.left >= 0, 'buttonBox.left >= 0');
    assert.ok(bb.top >= 0, 'buttonBox.top >= 0');
    assert.ok(bb.right <= 1, 'buttonBox.right <= 1');
    assert.ok(bb.bottom <= 1, 'buttonBox.bottom <= 1');
    assert.ok(bb.right > bb.left, 'buttonBox Breite > 0');
    assert.ok(bb.bottom > bb.top, 'buttonBox Höhe > 0');

    for (const r of rows) {
      const a = r.box;
      assert.ok(a.left >= 0, r.id + ' left >= 0');
      assert.ok(a.top >= 0, r.id + ' top >= 0');
      assert.ok(a.right <= 1, r.id + ' right <= 1');
      assert.ok(a.bottom <= 1, r.id + ' bottom <= 1');
      // keine Überlappung mit Tastenreihe
      const overlapBtn =
        a.left < bb.right && a.right > bb.left && a.top < bb.bottom && a.bottom > bb.top;
      assert.ok(!overlapBtn, r.id + ' überlappt Tastenreihe @' + w + 'x' + h);
    }

    // Timer und Stoppuhr nebeneinander (gleiches Band, keine Überlappung)
    const t = rows.find((r) => r.id === 'timer');
    const s = rows.find((r) => r.id === 'stopwatch');
    assert.ok(t && s, 'timer/stopwatch vorhanden');
    assert.ok(Math.abs(t.box.top - s.box.top) < 1e-6, 'gleiche Band-Oberkante');
    assert.ok(Math.abs(t.box.bottom - s.box.bottom) < 1e-6, 'gleiche Band-Unterkante');
    assert.ok(t.box.right <= s.box.left + 1e-9, 'timer links von stopwatch');

    // Zeit-Zeile >= 0.40
    const time = rows.find((r) => r.id === 'time');
    assert.ok(time.height >= 0.4, 'time.height >= 0.40');
  }
});

// --- Runde 2 ---

function boxesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function allBoxes(rows) {
  const list = [];
  for (const r of rows) list.push(Object.assign({ id: r.id }, r.box));
  if (rows.timerLabel) list.push(Object.assign({ id: 'timerLabel' }, rows.timerLabel));
  if (rows.stopwatchLabel) list.push(Object.assign({ id: 'stopwatchLabel' }, rows.stopwatchLabel));
  if (rows.cityLabel) list.push(Object.assign({ id: 'cityLabel' }, rows.cityLabel));
  if (rows.buttons) {
    for (const k of Object.keys(rows.buttons)) {
      list.push(Object.assign({ id: k }, rows.buttons[k]));
    }
  }
  if (rows.hintBox) list.push(Object.assign({ id: 'hintBox' }, rows.hintBox));
  return list;
}

// --- AK1: Timer/Stoppuhr bündig zur Uhrzeit, gleiche y, getrennt ---
test('R2-AK1: timer/stopwatch gleiche y, bündig zur time-Zeile, links/rechts der Mitte', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    const time = rows.find((r) => r.id === 'time');
    const timer = rows.find((r) => r.id === 'timer');
    const sw = rows.find((r) => r.id === 'stopwatch');
    assert.ok(time && timer && sw, 'Zeilen vorhanden @' + w + 'x' + h);

    // gleiche y-Position (±0,005)
    assert.ok(
      Math.abs(timer.box.top - sw.box.top) <= 0.005,
      'timer.y === stopwatch.y @' + w + ': ' + timer.box.top + ' vs ' + sw.box.top
    );
    assert.ok(
      Math.abs(timer.box.bottom - sw.box.bottom) <= 0.005,
      'gleiche Unterkante @' + w
    );
    // identische Modulgröße
    assert.ok(
      Math.abs(timer.moduleW - sw.moduleW) <= 1e-6,
      'identische Modulbreite @' + w
    );
    assert.ok(
      Math.abs(timer.moduleH - sw.moduleH) <= 1e-6,
      'identische Modulhöhe @' + w
    );

    // Timer links der Mitte, Stoppuhr rechts davon
    assert.ok(timer.box.right < 0.5, 'timer.x+timer.w < 0.5 @' + w + ': ' + timer.box.right);
    assert.ok(sw.box.left > 0.5, '0.5 < stopwatch.x @' + w + ': ' + sw.box.left);

    // Timer linke Kante = linke Kante time (±0,005)
    assert.ok(
      Math.abs(timer.box.left - time.box.left) <= 0.005,
      'Timer links bündig zu time @' + w + ': ' + timer.box.left + ' vs ' + time.box.left
    );
    // Stoppuhr rechte Kante = rechte Kante time (±0,005)
    assert.ok(
      Math.abs(sw.box.right - time.box.right) <= 0.005,
      'Stoppuhr rechts bündig zu time @' + w + ': ' + sw.box.right + ' vs ' + time.box.right
    );
  }
});

// --- AK2: Pfeiltasten über/unter den Modulpaaren ---
test('R2-AK2: ▲/▼-Tasten zentriert über Stunden-/Minuten-Paar, ▲ oben ▼ unten', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    const timer = rows.find((r) => r.id === 'timer');
    const btns = rows.buttons;
    assert.ok(btns, 'buttons vorhanden @' + w);
    for (const name of ['timerHourUp', 'timerHourDown', 'timerMinUp', 'timerMinDown']) {
      assert.ok(btns[name], name + ' vorhanden');
    }

    const mw = timer.moduleW;
    const mc = timer.moduleCenters;
    const hourPair = [mc[0] - mw / 2, mc[1] + mw / 2];
    const minPair = [mc[2] - mw / 2, mc[3] + mw / 2];

    for (const name of ['timerHourUp', 'timerHourDown', 'timerMinUp', 'timerMinDown']) {
      const b = btns[name];
      const cx = (b.left + b.right) / 2;
      const pair = name.indexOf('Hour') >= 0 ? hourPair : minPair;
      assert.ok(
        cx >= pair[0] && cx <= pair[1],
        name + ' x-Mitte ' + cx + ' im Paar [' + pair[0] + ',' + pair[1] + '] @' + w
      );
    }

    // ▲ oberhalb, ▼ unterhalb der Timer-Anzeige
    assert.ok(
      btns.timerHourUp.bottom <= timer.box.top + 1e-9,
      '▲ über der Timer-Anzeige @' + w
    );
    assert.ok(
      btns.timerMinUp.bottom <= timer.box.top + 1e-9,
      '▲ Min über der Timer-Anzeige @' + w
    );
    assert.ok(
      btns.timerHourDown.top >= timer.box.bottom - 1e-9,
      '▼ unter der Timer-Anzeige @' + w
    );
    assert.ok(
      btns.timerMinDown.top >= timer.box.bottom - 1e-9,
      '▼ Min unter der Timer-Anzeige @' + w
    );
  }
});

// --- AK3: START/PAUSE und RESET unter der jeweiligen Anzeige ---
test('R2-AK3: START/PAUSE und RESET horizontal in der Anzeige und darunter', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    const timer = rows.find((r) => r.id === 'timer');
    const sw = rows.find((r) => r.id === 'stopwatch');
    const btns = rows.buttons;
    const checks = [
      ['timerStartPause', timer],
      ['timerReset', timer],
      ['swStartPause', sw],
      ['swReset', sw],
    ];
    for (const [name, disp] of checks) {
      const b = btns[name];
      assert.ok(b, name + ' vorhanden @' + w);
      assert.ok(
        b.left >= disp.box.left - 1e-9 && b.right <= disp.box.right + 1e-9,
        name + ' horizontal in ' + disp.id + ' @' + w + ': ' + JSON.stringify(b)
      );
      assert.ok(
        b.top >= disp.box.bottom - 1e-9,
        name + ' unter ' + disp.id + ' @' + w
      );
    }
  }
});

// --- AK4: Labels TIMER, STOPPUHR, DÜSSELDORF ---
test('R2-AK4: Labels TIMER/STOPPUHR/DÜSSELDORF vorhanden und über der Zeile', () => {
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  assert.ok(src.includes("'TIMER'"), 'TIMER im Quelltext');
  assert.ok(src.includes("'STOPPUHR'"), 'STOPPUHR im Quelltext');
  assert.ok(src.includes("'DÜSSELDORF'"), 'DÜSSELDORF im Quelltext');

  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    const timer = rows.find((r) => r.id === 'timer');
    const sw = rows.find((r) => r.id === 'stopwatch');
    const weather = rows.find((r) => r.id === 'weather');

    assert.ok(rows.timerLabel, 'timerLabel @' + w);
    assert.ok(rows.stopwatchLabel, 'stopwatchLabel @' + w);
    assert.ok(rows.cityLabel, 'cityLabel @' + w);

    // Labels liegen über der jeweiligen Zeile (kleineres y = weiter oben)
    assert.ok(
      rows.timerLabel.bottom <= timer.box.top + 1e-9,
      'timerLabel über timer @' + w
    );
    assert.ok(
      rows.stopwatchLabel.bottom <= sw.box.top + 1e-9,
      'stopwatchLabel über stopwatch @' + w
    );
    assert.ok(
      rows.cityLabel.bottom <= weather.box.top + 1e-9,
      'cityLabel über weather @' + w
    );
  }
});

// --- AK5: Doppelpunkt der Uhrzeit mittig in der Lücke ---
test('R2-AK5: Doppelpunkt-Mitte in der Lücke zwischen Modul 2 und 3 (±2 %)', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    const time = rows.find((r) => r.id === 'time');
    assert.ok(time.colonCenters && time.colonCenters.length === 1, 'ein Doppelpunkt @' + w);
    const colX = time.colonCenters[0];
    const gapL = time.moduleCenters[1] + time.moduleW / 2;
    const gapR = time.moduleCenters[2] - time.moduleW / 2;
    const gapMid = (gapL + gapR) / 2;
    const gapW = gapR - gapL;
    assert.ok(gapW > 0, 'Lückenbreite > 0 @' + w);
    assert.ok(
      Math.abs(colX - gapMid) <= 0.02 * gapW,
      'Doppelpunkt ' + colX + ' bei Lückenmitte ' + gapMid + ' (Tol ' + 0.02 * gapW + ') @' + w
    );
  }
});

// --- AK6: gemeinsame Baseline für alle Glyphen ---
test('R2-AK6: glyphBaselineY liefert für O und Ö dieselbe Baseline', () => {
  assert.strictEqual(typeof glyphBaselineY, 'function', 'glyphBaselineY exportiert');
  const cell = 128;
  const cap = { ascent: 90, descent: 6 };
  const yO = glyphBaselineY('O', cell, cap);
  const yOE = glyphBaselineY('Ö', cell, cap);
  assert.strictEqual(yO, yOE, 'O und Ö gleiche Baseline');
  // auch für andere Zeichen konstant
  assert.strictEqual(glyphBaselineY('H', cell, cap), yO);
  assert.strictEqual(glyphBaselineY('Ä', cell, cap), yO);
  // Baseline liegt unterhalb der Zellmitte (Cap zentriert)
  assert.ok(yO > cell / 2, 'Baseline unter Zellmitte bei descent > 0');
  // FlapRenderer stellt die Funktion ebenfalls bereit
  assert.strictEqual(typeof FlapRenderer.glyphBaselineY, 'function');
});

// --- Keine Überlappung, unterste Box ≤ 97 % ---
test('R2: keine Box überlappt eine andere, unterste Box ≤ 97 % Höhe', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    const boxes = allBoxes(rows);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        assert.ok(
          !boxesOverlap(boxes[i], boxes[j]),
          boxes[i].id + ' überlappt ' + boxes[j].id + ' @' + w + 'x' + h
        );
      }
    }
    let maxBottom = 0;
    for (const b of boxes) {
      if (b.id === 'hintBox') continue; // Hinweis liegt im freien Rand unter der Tastenreihe
      if (b.bottom > maxBottom) maxBottom = b.bottom;
    }
    assert.ok(maxBottom <= 0.97, 'unterste Box endet bei ' + maxBottom + ' ≤ 0.97 @' + w);
  }
});

// --- Runde 3 ---

// --- AK1: Doppelpunkte Timer/Stoppuhr: 2 je Uhr, Mitte in Lücke ---
// Runde 4: ersetzt "Höhe ≥ 12 % Modulhöhe" / "Breite ≥ 40 % Lückenbreite"
// durch quadratische Punkte (w/h 0,95–1,05), Kante = 0,09 × Modulhöhe.
test('R3-AK1: Timer/Stoppuhr je 2 Doppelpunkte, Mitte in Lücke (±5 %), quadratische Punkte 0,09×Modulhöhe', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    for (const id of ['timer', 'stopwatch']) {
      const r = rows.find((x) => x.id === id);
      assert.ok(r, id + ' vorhanden @' + w);
      assert.ok(r.colonBoxes && r.colonBoxes.length === 2, id + ': 2 Doppelpunkte @' + w + ' (ist ' + (r.colonBoxes || []).length + ')');
      assert.ok(r.colonCenters && r.colonCenters.length === 2, id + ': 2 colonCenters @' + w);
      for (let i = 0; i < 2; i++) {
        const cb = r.colonBoxes[i];
        const gapW = cb.gapWidth;
        assert.ok(gapW > 0, id + '[' + i + '] Lückenbreite > 0 @' + w);
        const off = Math.abs(cb.cx - cb.gapMid);
        assert.ok(
          off <= 0.05 * gapW,
          id + '[' + i + '] cx=' + cb.cx + ' bei gapMid=' + cb.gapMid + ' (Tol ' + 0.05 * gapW + ') @' + w
        );
        // Neue Regel (Runde 4): quadratisch, Kante = 0,09 × Modulhöhe (±0,5 % relativ)
        assert.ok(cb.dots && cb.dots.length === 2, id + '[' + i + '] 2 Punkte @' + w);
        for (const d of cb.dots) {
          const ratio = (d.w * w) / (d.h * h);
          assert.ok(
            ratio >= 0.95 && ratio <= 1.05,
            id + '[' + i + '] w/h=' + ratio + ' in [0,95;1,05] @' + w
          );
          assert.ok(
            Math.abs(d.h - 0.09 * r.height) / (0.09 * r.height) <= 0.005,
            id + '[' + i + '] Höhe=' + d.h + ' = 0,09×Modulhöhe=' + 0.09 * r.height + ' (±0,5 %) @' + w
          );
        }
      }
    }
  }
});

// --- AK2: labelTextureSize ---
test('R3-AK2: labelTextureSize(labelWidthPx, dpr) ≥ Labelbreite in Bildschirmpixeln', () => {
  assert.strictEqual(typeof labelTextureSize, 'function', 'labelTextureSize exportiert');
  // Mindestens die Bildschirmpixel-Breite
  assert.ok(labelTextureSize(300, 1) >= 300, 'dpr=1: 300 → ' + labelTextureSize(300, 1));
  assert.ok(labelTextureSize(300, 2) >= 300, 'dpr=2: 300 → ' + labelTextureSize(300, 2));
  // Skaliert mit dpr (Canvas-Pixel ≥ Bildschirmpixel × dpr)
  assert.ok(labelTextureSize(300, 2) >= 300 * 2, 'dpr=2 skaliert: ' + labelTextureSize(300, 2));
  assert.ok(labelTextureSize(256, 1.5) >= 256 * 1.5, 'dpr=1.5 skaliert: ' + labelTextureSize(256, 1.5));
  // Kleinste Eingaben
  assert.ok(labelTextureSize(1, 1) >= 1);
  assert.ok(labelTextureSize(64, 2) >= 64);
  // FlapRenderer stellt die Funktion ebenfalls bereit
  assert.strictEqual(typeof FlapRenderer.labelTextureSize, 'function');
});

// --- AK3: Hinweis-Box überlappt keine andere Box ---
test('R3-AK3: hintBox überlappt keine andere Box (1920x1080 und 1366x768)', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    assert.ok(rows.hintBox, 'hintBox vorhanden @' + w + 'x' + h);
    const hb = rows.hintBox;
    assert.ok(hb.left >= 0 && hb.right <= 1, 'hintBox horizontal in 0..1 @' + w);
    assert.ok(hb.top >= 0 && hb.bottom <= 1, 'hintBox vertikal in 0..1 @' + w);
    assert.ok(hb.right > hb.left, 'hintBox Breite > 0 @' + w);
    assert.ok(hb.bottom > hb.top, 'hintBox Höhe > 0 @' + w);

    const boxes = allBoxes(rows);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        assert.ok(
          !boxesOverlap(boxes[i], boxes[j]),
          boxes[i].id + ' überlappt ' + boxes[j].id + ' @' + w + 'x' + h
        );
      }
    }
    // Hinweis liegt unterhalb der Tastenreihe
    assert.ok(
      hb.top >= rows.buttonBox.bottom - 1e-9,
      'hintBox unter buttonBox @' + w + ': ' + hb.top + ' ≥ ' + rows.buttonBox.bottom
    );
  }
});

// --- AK4: R2-Layoutregeln bestehen weiter (R2-AK1 bis R2-AK6) ---
test('R3-AK4: R2-Layoutregeln (R2-AK1 bis R2-AK6) bleiben erfüllt', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    const time = rows.find((r) => r.id === 'time');
    const timer = rows.find((r) => r.id === 'timer');
    const sw = rows.find((r) => r.id === 'stopwatch');

    // R2-AK1: gleiche y, bündig zur time, links/rechts der Mitte
    assert.ok(Math.abs(timer.box.top - sw.box.top) <= 0.005, 'R2-AK1 gleiche y @' + w);
    assert.ok(Math.abs(timer.box.left - time.box.left) <= 0.005, 'R2-AK1 Timer bündig links @' + w);
    assert.ok(Math.abs(sw.box.right - time.box.right) <= 0.005, 'R2-AK1 SW bündig rechts @' + w);
    assert.ok(timer.box.right < 0.5, 'R2-AK1 timer rechts < 0.5 @' + w);
    assert.ok(sw.box.left > 0.5, 'R2-AK1 sw links > 0.5 @' + w);

    // R2-AK5: Doppelpunkt der Uhrzeit mittig in der Lücke
    assert.ok(time.colonCenters && time.colonCenters.length === 1, 'R2-AK5 ein time-colon @' + w);
    const gapL = time.moduleCenters[1] + time.moduleW / 2;
    const gapR = time.moduleCenters[2] - time.moduleW / 2;
    const gapMid = (gapL + gapR) / 2;
    const gapW = gapR - gapL;
    assert.ok(Math.abs(time.colonCenters[0] - gapMid) <= 0.02 * gapW, 'R2-AK5 time-colon mittig @' + w);
  }
  // R2-AK6: glyphBaselineY
  const yO = glyphBaselineY('O', 128, { ascent: 90, descent: 6 });
  const yOE = glyphBaselineY('Ö', 128, { ascent: 90, descent: 6 });
  assert.strictEqual(yO, yOE, 'R2-AK6 gleiche Baseline');
});

// --- Runde 4: Doppelpunkte als quadratische Punkte ---

// AK1: Für Uhrzeit, Timer und Stoppuhr (3 Viewports): jeder Doppelpunkt-Quader
// hat w/h zwischen 0,95 und 1,05 und h = 0,09 × Modulhöhe (±0,005 relativ).
test('R4-AK1: time/timer/stopwatch — Doppelpunkt-Quader quadratisch (w/h 0,95–1,05), h = 0,09×Modulhöhe', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    for (const id of ['time', 'timer', 'stopwatch']) {
      const r = rows.find((x) => x.id === id);
      assert.ok(r, id + ' vorhanden @' + w + 'x' + h);
      assert.ok(r.colonBoxes && r.colonBoxes.length >= 1, id + ': colonBoxes vorhanden @' + w);
      for (let i = 0; i < r.colonBoxes.length; i++) {
        const cb = r.colonBoxes[i];
        assert.ok(cb.dots && cb.dots.length === 2, id + '[' + i + '] 2 Punkte @' + w);
        for (let j = 0; j < cb.dots.length; j++) {
          const d = cb.dots[j];
          // w/h in Pixeln: (d.w * W) / (d.h * H)
          const ratio = (d.w * w) / (d.h * h);
          assert.ok(
            ratio >= 0.95 && ratio <= 1.05,
            id + '[' + i + '].dot' + j + ' w/h=' + ratio + ' in [0,95;1,05] @' + w + 'x' + h
          );
          // h = 0,09 × Modulhöhe (±0,5 % relativ)
          const rel = Math.abs(d.h - 0.09 * r.height) / (0.09 * r.height);
          assert.ok(
            rel <= 0.005,
            id + '[' + i + '].dot' + j + ' h=' + d.h + ' vs 0,09×modH=' + 0.09 * r.height +
              ' (rel ' + rel + ') @' + w + 'x' + h
          );
        }
      }
    }
  }
});

// AK2: Punktmitten liegen bei Achse ± 0,18 × Modulhöhe (±0,01).
test('R4-AK2: Punktmitten bei Achse ± 0,18×Modulhöhe (±0,01)', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    for (const id of ['time', 'timer', 'stopwatch']) {
      const r = rows.find((x) => x.id === id);
      assert.ok(r, id + ' vorhanden @' + w);
      for (let i = 0; i < r.colonBoxes.length; i++) {
        const cb = r.colonBoxes[i];
        assert.ok(cb.dots && cb.dots.length === 2, id + '[' + i + '] 2 Punkte @' + w);
        // Ein Punkt über, ein Punkt unter der Achse
        const dys = cb.dots.map((d) => d.cy - cb.cy).sort((a, b) => a - b);
        assert.ok(dys[0] < 0 && dys[1] > 0, id + '[' + i + '] Punkte über/unter der Achse @' + w);
        for (let j = 0; j < 2; j++) {
          const off = Math.abs(cb.dots[j].cy - cb.cy) / r.height;
          assert.ok(
            Math.abs(off - 0.18) <= 0.01,
            id + '[' + i + '].dot' + j + ' |dy|/modH=' + off + ' ≈ 0,18 (±0,01) @' + w + 'x' + h
          );
        }
      }
    }
  }
});

// AK3: Punktmitte horizontal in der Lückenmitte (±5 % der Lückenbreite).
test('R4-AK3: Punktmitte horizontal in der Lückenmitte (±5 % der Lückenbreite)', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    for (const id of ['time', 'timer', 'stopwatch']) {
      const r = rows.find((x) => x.id === id);
      assert.ok(r, id + ' vorhanden @' + w);
      for (let i = 0; i < r.colonBoxes.length; i++) {
        const cb = r.colonBoxes[i];
        const gapW = cb.gapWidth;
        assert.ok(gapW > 0, id + '[' + i + '] Lückenbreite > 0 @' + w);
        for (let j = 0; j < cb.dots.length; j++) {
          const d = cb.dots[j];
          const off = Math.abs(d.cx - cb.gapMid);
          assert.ok(
            off <= 0.05 * gapW,
            id + '[' + i + '].dot' + j + ' cx=' + d.cx + ' bei gapMid=' + cb.gapMid +
              ' (Tol ' + 0.05 * gapW + ') @' + w
          );
        }
        // Punktmitte exakt in der Lückenmitte: cb.cx selbst auch
        assert.ok(Math.abs(cb.cx - cb.gapMid) <= 0.05 * gapW, id + '[' + i + '] cx mittig @' + w);
      }
    }
  }
});

// AK4: Alle Layoutkriterien aus Runde 2 und 3 bestehen weiter (außer den
// ersetzten Doppelpunkt-Größenregeln) — hier gegen die neuen Punkte geprüft.
test('R4-AK4: R2-/R3-Layoutregeln bleiben erfüllt (Timer links, SW rechts, gleiche Höhe)', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    const time = rows.find((r) => r.id === 'time');
    const timer = rows.find((r) => r.id === 'timer');
    const sw = rows.find((r) => r.id === 'stopwatch');

    // R2-AK1 / R3-AK4: gleiche y, bündig zur time, links/rechts der Mitte
    assert.ok(Math.abs(timer.box.top - sw.box.top) <= 0.005, 'R2-AK1 gleiche y @' + w);
    assert.ok(Math.abs(timer.box.bottom - sw.box.bottom) <= 0.005, 'R2-AK1 gleiche Unterkante @' + w);
    assert.ok(Math.abs(timer.moduleW - sw.moduleW) <= 1e-6, 'R2-AK1 identische Modulbreite @' + w);
    assert.ok(Math.abs(timer.moduleH - sw.moduleH) <= 1e-6, 'R2-AK1 identische Modulhöhe @' + w);
    assert.ok(Math.abs(timer.box.left - time.box.left) <= 0.005, 'R2-AK1 Timer bündig links @' + w);
    assert.ok(Math.abs(sw.box.right - time.box.right) <= 0.005, 'R2-AK1 SW bündig rechts @' + w);
    assert.ok(timer.box.right < 0.5, 'R2-AK1 timer rechts < 0.5 @' + w);
    assert.ok(sw.box.left > 0.5, 'R2-AK1 sw links > 0.5 @' + w);

    // R2-AK5: Doppelpunkt der Uhrzeit mittig in der Lücke
    assert.ok(time.colonCenters && time.colonCenters.length === 1, 'R2-AK5 ein time-colon @' + w);
    const gapL = time.moduleCenters[1] + time.moduleW / 2;
    const gapR = time.moduleCenters[2] - time.moduleW / 2;
    const gapMid = (gapL + gapR) / 2;
    const gapW = gapR - gapL;
    assert.ok(Math.abs(time.colonCenters[0] - gapMid) <= 0.02 * gapW, 'R2-AK5 time-colon mittig @' + w);

    // Lückenbreite: Punktbreite + beidseitig Luft ≥ 1 Punktbreite
    // (d.h. Lückenbreite ≥ 2 × Punktbreite)
    for (const id of ['time', 'timer', 'stopwatch']) {
      const r = rows.find((x) => x.id === id);
      for (const cb of r.colonBoxes) {
        for (const d of cb.dots) {
          assert.ok(
            cb.gapWidth * w >= 2 * d.w * w - 1e-9,
            id + ': Lückenbreite ' + cb.gapWidth * w + ' ≥ 2×Punktbreite ' + 2 * d.w * w + ' @' + w
          );
        }
      }
    }
  }
  // R2-AK6: glyphBaselineY
  const yO = glyphBaselineY('O', 128, { ascent: 90, descent: 6 });
  const yOE = glyphBaselineY('Ö', 128, { ascent: 90, descent: 6 });
  assert.strictEqual(yO, yOE, 'R2-AK6 gleiche Baseline');
});

// --- Runde 5 ---

// AK1: FLIP_MS_BIG/SMALL, flipDurationFor, kein Drift
test('R5-AK1: FLIP_MS_BIG=340, FLIP_MS_SMALL=220, flipDurationFor ohne Drift', () => {
  assert.strictEqual(FLIP_MS_BIG, 340, 'FLIP_MS_BIG === 340');
  assert.strictEqual(FLIP_MS_SMALL, 220, 'FLIP_MS_SMALL === 220');
  assert.strictEqual(typeof flipDurationFor, 'function', 'flipDurationFor exportiert');
  assert.strictEqual(flipDurationFor(340, 0), 306, 'flipDurationFor(340,0) === 306');
  assert.strictEqual(flipDurationFor(340, 1), 374, 'flipDurationFor(340,1) === 374');
  // 1000 aufeinanderfolgende Aufrufe mit rnd=1: immer 374, kein Drift
  let v = 340;
  for (let i = 0; i < 1000; i++) {
    v = flipDurationFor(340, 1);
  }
  assert.strictEqual(v, 374, '1000× flipDurationFor(340,1) driftet nicht: ' + v);
  // Auch immer vom festen Basiswert, nicht vom letzten Ergebnis
  assert.strictEqual(flipDurationFor(220, 0), 198);
  assert.strictEqual(flipDurationFor(220, 1), 242);
  // stepDurationFor: >8 Schritte → 0,6 × Basis
  assert.strictEqual(stepDurationFor(220, 9, 1), Math.round(220 * 0.6 * 1.1), '9 Schritte → 0.6×');
  assert.strictEqual(stepDurationFor(220, 8, 1), 242, '8 Schritte → volle Basis');
});

// AK2: Klack beim Aufschlag (Fortschritt ≥ FLIP_IMPACT), genau einmal
test('R5-AK2: clack beim Aufschlag, nicht vorher, genau einmal', () => {
  assert.ok(FLIP_IMPACT > 0 && FLIP_IMPACT < 1, 'FLIP_IMPACT in (0,1)');
  const mod = { rowId: 'time', index: 0, _impactFired: false };
  const stub = {
    calls: [],
    clack(kind) {
      this.calls.push(kind);
    },
  };
  const dur = 340;
  // Fortschritt < FLIP_IMPACT: kein clack
  for (let t = 0; t < FLIP_IMPACT * dur - 1; t += 10) {
    const fired = playImpactClack(mod, t, dur, stub);
    assert.strictEqual(fired, false, 'kein clack bei t=' + t);
  }
  assert.strictEqual(stub.calls.length, 0, 'kein clack vor FLIP_IMPACT');
  // Fortschritt ≥ FLIP_IMPACT: genau einmal
  const tImpact = Math.ceil(FLIP_IMPACT * dur);
  assert.strictEqual(playImpactClack(mod, tImpact, dur, stub), true, 'clack bei Impact');
  assert.strictEqual(stub.calls.length, 1, 'genau ein clack');
  assert.strictEqual(stub.calls[0], 'hour', 'kind=hour für time-Modul 0');
  // Danach nicht noch einmal
  assert.strictEqual(playImpactClack(mod, tImpact + 50, dur, stub), false);
  assert.strictEqual(playImpactClack(mod, dur, dur, stub), false);
  assert.strictEqual(stub.calls.length, 1, 'weiterhin genau ein clack');
  // Neuer Flip: _impactFired zurücksetzen
  mod._impactFired = false;
  assert.strictEqual(playImpactClack(mod, tImpact, dur, stub), true, 'neuer Flip klackt wieder');
  assert.strictEqual(stub.calls.length, 2);
});

// AK3: Szene — Stapelkanten, Blattdicke, Rahmen/Fenster
test('R5-AK3: Szene hat Stapelkanten ≥3, Blattdicke ≥1 %, Rahmen/Fenster', () => {
  const spec = sceneSpec();
  assert.ok(spec.stackEdgeCountTop >= 3, 'stackEdgeCountTop ≥ 3: ' + spec.stackEdgeCountTop);
  assert.ok(spec.stackEdgeCountBottom >= 3, 'stackEdgeCountBottom ≥ 3: ' + spec.stackEdgeCountBottom);
  assert.ok(spec.stackEdgeCount >= 3, 'stackEdgeCount ≥ 3: ' + spec.stackEdgeCount);
  assert.ok(
    spec.leafThicknessRatio >= 0.01,
    'leafThicknessRatio ≥ 1 %: ' + spec.leafThicknessRatio
  );
  assert.strictEqual(THICKNESS_RATIO >= 0.01, true, 'THICKNESS_RATIO ≥ 1 %');
  assert.ok(spec.hasFrame, 'Rahmen-/Fenstergeometrie vorhanden');
  assert.ok(spec.frameDepthRatio > 0, 'frameDepthRatio > 0');
  assert.ok(spec.frameBevel, 'Fase am Rahmen');
  // Quelltext: Frame-Geometrie und Stapelkanten implementiert
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  assert.match(src, /moduleFrame/, 'moduleFrame im Quelltext');
  assert.match(src, /createModuleFrameGeometry/, 'createModuleFrameGeometry im Quelltext');
  assert.match(src, /STACK_EDGE_COUNT/, 'STACK_EDGE_COUNT im Quelltext');
});

// AK4: Shadow-Map-Größe 4096 bei 1920, 2048 bei 1366
test('R5-AK4: shadowMapSizeFor(1920)=4096, (1366)=2048', () => {
  assert.strictEqual(shadowMapSizeFor(1920), 4096, '1920 → 4096');
  assert.strictEqual(shadowMapSizeFor(1600), 4096, '1600 → 4096');
  assert.strictEqual(shadowMapSizeFor(1366), 2048, '1366 → 2048');
  assert.strictEqual(shadowMapSizeFor(800), 2048, '800 → 2048');
});

// AK5: Kamera-Neigung zwischen 4° und 6°
test('R5-AK5: CAMERA_TILT_DEG zwischen 4 und 6', () => {
  assert.ok(CAMERA_TILT_DEG >= 4 && CAMERA_TILT_DEG <= 6, 'Tilt ' + CAMERA_TILT_DEG + '° in [4,6]');
  const spec = sceneSpec();
  assert.ok(
    spec.cameraTiltDeg >= 4 && spec.cameraTiltDeg <= 6,
    'sceneSpec.cameraTiltDeg ' + spec.cameraTiltDeg + ' in [4,6]'
  );
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  assert.match(src, /CAMERA_TILT_DEG/, 'CAMERA_TILT_DEG im Quelltext');
});

// AK6: Layoutkriterien Runde 2–4 bestehen weiterhin (in den R2–R4-Tests oben).
test('R5-AK6: Layout-Tests R2–R4 unverändert, Dauern aus FLIP_MS_*', () => {
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    assert.strictEqual(rows.length, DEFAULT_LAYOUT.length, 'Zeilen @' + w + 'x' + h);
    const time = rows.find((r) => r.id === 'time');
    assert.ok(time.height >= 0.4, 'time.height ≥ 0.4 @' + w);
  }
  assert.strictEqual(flipDurationFor(FLIP_MS_BIG, 0), 306);
  assert.strictEqual(flipDurationFor(FLIP_MS_SMALL, 1), 242);
});

// AK7: check-render.js schreibt render-1920-flip.png und behält (a)–(f)
test('R5-AK7: check-render.js freezeFlip-Screenshot und bisherige Prüfungen', () => {
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'check-render.js'), 'utf8');
  assert.match(src, /render-1920-flip\.png/, 'Screenshot-Name render-1920-flip.png');
  assert.match(src, /freezeFlip/, 'freezeFlip in check-render.js');
  for (const tag of ['(a)', '(b)', '(c)', '(d)', '(e)', '(f)']) {
    assert.ok(src.includes(tag), 'Prüfung ' + tag + ' in check-render.js');
  }
  assert.match(src, /shadowMapSize/, 'shadowMapSize in check-render.js');
  assert.match(src, /cameraTiltDeg/, 'cameraTiltDeg in check-render.js');
});

// AK8: Exporte stabil, flipAngle-Kurve beibehalten
test('R5-AK8: Exporte stabil, flipAngle-Kurve beibehalten', () => {
  assert.strictEqual(typeof flipAngle, 'function');
  assert.strictEqual(typeof flipDurationFor, 'function');
  assert.strictEqual(typeof playImpactClack, 'function');
  assert.strictEqual(typeof shadowMapSizeFor, 'function');
  assert.strictEqual(typeof sceneSpec, 'function');
  // flipAngle-Kurve (Schwerkraft + Nachfedern) beibehalten
  assert.strictEqual(flipAngle(0, 340), 0);
  assert.strictEqual(flipAngle(340, 340), Math.PI);
  assert.ok(flipAngle(170, 340) < Math.PI / 2, 'ease-in beibehalten');
  let max = 0;
  for (let t = 0; t <= 340; t++) max = Math.max(max, flipAngle(t, 340));
  assert.ok(max <= Math.PI + 0.08, 'Überschwingen ≤ 0.08');
  // Exports aus Runde 1–4 unverändert
  assert.strictEqual(typeof FlapRenderer, 'object');
  assert.strictEqual(typeof FlapRenderer.init, 'function');
  assert.strictEqual(typeof FlapRenderer.setText, 'function');
  assert.ok(Array.isArray(CONTROL_NAMES) && CONTROL_NAMES.length === 8);
  assert.ok(Array.isArray(DEFAULT_LAYOUT) && DEFAULT_LAYOUT.length === 7);
});

// --- Realismus R1: Rahmen-Überstand deckt nicht Datumszeile / Bildrand ---

test('R1-AK1: layoutRows Zeilenabstände ≥ FRAME_OVERHANG×(h1+h2)+0,006, padY ≥ FRAME_OVERHANG×h+0,015', () => {
  assert.strictEqual(FRAME_OVERHANG, 0.04, 'FRAME_OVERHANG = 0,04');
  for (const [w, h] of VIEWPORTS) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT);
    // oberste Zeile: top ≥ FRAME_OVERHANG × h + 0,015
    const sorted = [...rows].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
    const top = sorted[0];
    const topNeed = FRAME_OVERHANG * top.height + 0.015;
    assert.ok(
      top.box.top + 1e-12 >= topNeed,
      'oberste Zeile ' + top.id + ' top=' + top.box.top + ' ≥ ' + topNeed + ' @' + w + 'x' + h
    );
    // Abstand jeder Zeile zur nächsten (vertikal untereinander)
    for (let i = 0; i < sorted.length; i++) {
      for (let j = 0; j < sorted.length; j++) {
        if (i === j) continue;
        const a = sorted[i];
        const b = sorted[j];
        // b liegt unter a (eigentliches Intervall, keine Überlappung)
        if (!(b.box.top >= a.box.bottom - 1e-12)) continue;
        const gap = b.box.top - a.box.bottom;
        const need = FRAME_OVERHANG * (a.height + b.height) + 0.006;
        assert.ok(
          gap + 1e-12 >= need,
          'Abstand ' + a.id + '→' + b.id + ' gap=' + gap + ' ≥ ' + need + ' @' + w + 'x' + h
        );
      }
    }
  }
});

test('R1-AK1b: FRAME_OVERHANG exportiert und in createModuleFrameGeometry verwendet', () => {
  assert.strictEqual(typeof FRAME_OVERHANG, 'number');
  assert.strictEqual(FRAME_OVERHANG, 0.04);
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  assert.match(src, /FRAME_OVERHANG/, 'FRAME_OVERHANG im Quelltext');
  assert.match(
    src,
    /1 \+ 2 \* FRAME_OVERHANG/,
    'Rahmen-Außenmaß aus FRAME_OVERHANG (1 + 2×)'
  );
});

test('R1-AK2/3: check-render.js enthält (g) Rahmen-Boxen und (h) Datums-Pixel', () => {
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'check-render.js'), 'utf8');
  assert.ok(src.includes('(g)'), '(g) in check-render.js');
  assert.ok(src.includes('(h)'), '(h) in check-render.js');
  assert.match(src, /FRAME_OVERHANG/, 'FRAME_OVERHANG in check-render.js');
});

// --- Screensaver: Timer/Stoppuhr aus, Inhalt zentriert ---

test('SS-AK1: layoutRows screensaver:true — keine timer/stopwatch/Labels/Tasten, 1920x1080 und 1366x768', () => {
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    const rows = layoutRows(w, h, DEFAULT_LAYOUT, { screensaver: true });
    const ids = rows.map((r) => r.id);
    assert.ok(!ids.includes('timer'), 'keine timer-Zeile @' + w + 'x' + h);
    assert.ok(!ids.includes('stopwatch'), 'keine stopwatch-Zeile @' + w + 'x' + h);
    assert.ok(!('timerLabel' in rows), 'kein timerLabel @' + w + 'x' + h);
    assert.ok(!('stopwatchLabel' in rows), 'kein stopwatchLabel @' + w + 'x' + h);
    assert.ok(!('buttons' in rows), 'keine Tasten @' + w + 'x' + h);
    assert.ok(!('buttonBox' in rows), 'kein buttonBox @' + w + 'x' + h);
    assert.ok(!('hintBox' in rows), 'kein hintBox @' + w + 'x' + h);
    // Pflicht-Zeilen vorhanden
    for (const need of ['time', 'date', 'weather', 'signal', 'whatsapp']) {
      assert.ok(ids.includes(need), 'Zeile ' + need + ' vorhanden @' + w + 'x' + h);
    }
    assert.ok(rows.cityLabel, 'cityLabel vorhanden @' + w + 'x' + h);
    // Vertikale Zentrierung ±0,03
    const boxes = rows.map((r) => r.box);
    if (rows.cityLabel) boxes.push(rows.cityLabel);
    let top = Infinity;
    let bottom = -Infinity;
    for (const b of boxes) {
      if (b.top < top) top = b.top;
      if (b.bottom > bottom) bottom = b.bottom;
    }
    const topGap = top;
    const bottomGap = 1 - bottom;
    assert.ok(
      Math.abs(topGap - bottomGap) <= 0.03,
      'zentriert @' + w + 'x' + h + ': topGap=' + topGap + ' bottomGap=' + bottomGap
    );
    // FRAME_OVERHANG-Regeln
    const sorted = [...rows].sort((a, b) => a.box.top - b.box.top);
    const topRow = sorted[0];
    const topNeed = FRAME_OVERHANG * topRow.height + 0.015;
    assert.ok(
      topRow.box.top + 1e-12 >= topNeed,
      'padY @' + w + 'x' + h + ': top=' + topRow.box.top + ' ≥ ' + topNeed
    );
    for (let i = 0; i < sorted.length; i++) {
      for (let j = 0; j < sorted.length; j++) {
        if (i === j) continue;
        const a = sorted[i];
        const b = sorted[j];
        if (!(b.box.top >= a.box.bottom - 1e-12)) continue;
        const gap = b.box.top - a.box.bottom;
        const need = FRAME_OVERHANG * (a.height + b.height) + 0.006;
        assert.ok(
          gap + 1e-12 >= need,
          'Abstand ' + a.id + '→' + b.id + ' @' + w + 'x' + h + ': ' + gap + ' ≥ ' + need
        );
      }
    }
    // Boxen innerhalb 0..1
    for (const r of rows) {
      assert.ok(r.box.left >= 0, r.id + ' left @' + w + 'x' + h);
      assert.ok(r.box.right <= 1, r.id + ' right @' + w + 'x' + h);
      assert.ok(r.box.top >= 0, r.id + ' top @' + w + 'x' + h);
      assert.ok(r.box.bottom <= 1, r.id + ' bottom @' + w + 'x' + h);
    }
  }
});

test('SS-AK2: layoutRows ohne Option identisch zu bisherigem Ergebnis (Normalmodus unverändert)', () => {
  for (const [w, h] of VIEWPORTS) {
    const a = layoutRows(w, h, DEFAULT_LAYOUT);
    const b = layoutRows(w, h, DEFAULT_LAYOUT, { screensaver: false });
    // Zeilen-Boxen identisch
    assert.strictEqual(a.length, b.length, 'Länge @' + w + 'x' + h);
    for (let i = 0; i < a.length; i++) {
      assert.deepStrictEqual(a[i].box, b[i].box, 'box[' + i + '] @' + w + 'x' + h);
      assert.strictEqual(a[i].id, b[i].id, 'id[' + i + '] @' + w + 'x' + h);
      assert.strictEqual(a[i].height, b[i].height, 'height[' + i + '] @' + w + 'x' + h);
    }
    // Extra-Boxen identisch
    assert.deepStrictEqual(a.buttons, b.buttons, 'buttons @' + w + 'x' + h);
    assert.deepStrictEqual(a.timerLabel, b.timerLabel, 'timerLabel @' + w + 'x' + h);
    assert.deepStrictEqual(a.stopwatchLabel, b.stopwatchLabel, 'stopwatchLabel @' + w + 'x' + h);
    assert.deepStrictEqual(a.cityLabel, b.cityLabel, 'cityLabel @' + w + 'x' + h);
    assert.deepStrictEqual(a.buttonBox, b.buttonBox, 'buttonBox @' + w + 'x' + h);
    assert.deepStrictEqual(a.hintBox, b.hintBox, 'hintBox @' + w + 'x' + h);
    // Normalmodus hat Timer/Stoppuhr/Tasten
    const ids = a.map((r) => r.id);
    assert.ok(ids.includes('timer'), 'timer im Normalmodus @' + w + 'x' + h);
    assert.ok(ids.includes('stopwatch'), 'stopwatch im Normalmodus @' + w + 'x' + h);
    assert.ok(a.buttons, 'buttons im Normalmodus @' + w + 'x' + h);
    assert.ok(a.hintBox, 'hintBox im Normalmodus @' + w + 'x' + h);
  }
});

test('SS-AK3: FlapRenderer.init akzeptiert Option screensaver, buildRows ohne timer/stopwatch', () => {
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  assert.match(src, /init:\s*function\s*\(canvas,\s*layout,\s*options\)/, 'init mit options');
  assert.match(src, /options && options\.screensaver/, 'options.screensaver ausgewertet');
  assert.match(src, /=== 'timer'/, 'timer wird gefiltert');
  assert.match(src, /=== 'stopwatch'/, 'stopwatch wird gefiltert');
  // FlapRenderer.init exportiert
  assert.strictEqual(typeof FlapRenderer.init, 'function');
});

test('SS-AK4: check-render.js Screensaver-Lauf render-1920-saver.png und Prüfung (i)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'check-render.js'), 'utf8');
  assert.ok(src.includes('render-1920-saver.png'), 'render-1920-saver.png in check-render.js');
  assert.match(src, /screensaver=1/, 'screensaver=1 in check-render.js');
  assert.ok(src.includes('(i)'), '(i) in check-render.js');
  assert.match(src, /evaluateSaver/, 'evaluateSaver in check-render.js');
  assert.match(src, /FRAME_OVERHANG/, 'FRAME_OVERHANG in check-render.js');
});

// --- Optionale Konfiguration: cityLabel und layoutRows ohne Messenger-Zeilen ---

test('CFG-cityLabel: FlapRenderer.init akzeptiert Option cityLabel, Default DÜSSELDORF', () => {
  const src = fs.readFileSync(path.join(__dirname, 'render3d.js'), 'utf8');
  assert.match(src, /options && typeof options\.cityLabel === 'string'/, 'options.cityLabel ausgewertet');
  assert.match(src, /makeLabel\(\s*'city'\s*,\s*_state\.cityLabel/, 'makeLabel city nutzt _state.cityLabel');
  assert.doesNotMatch(src, /makeLabel\(\s*'city'\s*,\s*'DÜSSELDORF'/, 'kein fest verdrahtetes DÜSSELDORF');
  assert.match(src, /cityLabel:\s*'DÜSSELDORF'/, 'Default DÜSSELDORF');
});

// AK 4: layoutRows ohne Messenger-Zeilen
const LAYOUT_NO_MSG = [
  { id: 'time', length: 4, charset: DEFAULT_LAYOUT[0].charset, scale: 1.0 },
  { id: 'date', length: 14, charset: DEFAULT_LAYOUT[1].charset, scale: 0.22 },
  { id: 'weather', length: 27, charset: DEFAULT_LAYOUT[2].charset, scale: 0.2 },
  { id: 'timer', length: 6, charset: DEFAULT_LAYOUT[5].charset, scale: 0.22 },
  { id: 'stopwatch', length: 6, charset: DEFAULT_LAYOUT[6].charset, scale: 0.22 },
];

function frameGapOk(rows, w, h) {
  const sorted = [...rows].sort((a, b) => a.box.top - b.box.top);
  const topRow = sorted[0];
  const topNeed = FRAME_OVERHANG * topRow.height + 0.015;
  assert.ok(
    topRow.box.top + 1e-12 >= topNeed,
    'padY @' + w + 'x' + h + ': top=' + topRow.box.top + ' ≥ ' + topNeed
  );
  for (let i = 0; i < sorted.length; i++) {
    for (let j = 0; j < sorted.length; j++) {
      if (i === j) continue;
      const a = sorted[i];
      const b = sorted[j];
      if (!(b.box.top >= a.box.bottom - 1e-12)) continue;
      const gap = b.box.top - a.box.bottom;
      const need = FRAME_OVERHANG * (a.height + b.height) + 0.006;
      assert.ok(
        gap + 1e-12 >= need,
        'Abstand ' + a.id + '→' + b.id + ' @' + w + 'x' + h + ': ' + gap + ' ≥ ' + need
      );
    }
  }
}

function noOverlap(rows, w, h) {
  const boxes = allBoxes(rows);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(
        !boxesOverlap(boxes[i], boxes[j]),
        boxes[i].id + ' überlappt ' + boxes[j].id + ' @' + w + 'x' + h
      );
    }
  }
}

function inUnitSquare(rows, w, h) {
  for (const r of rows) {
    assert.ok(r.box.left >= 0, r.id + ' left @' + w + 'x' + h);
    assert.ok(r.box.right <= 1, r.id + ' right @' + w + 'x' + h);
    assert.ok(r.box.top >= 0, r.id + ' top @' + w + 'x' + h);
    assert.ok(r.box.bottom <= 1, r.id + ' bottom @' + w + 'x' + h);
  }
}

test('CFG-layout: layoutRows ohne Messenger-Zeilen (normal) – keine Überlappung, FRAME_OVERHANG', () => {
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    const rows = layoutRows(w, h, LAYOUT_NO_MSG);
    const ids = rows.map((r) => r.id);
    assert.ok(!ids.includes('signal'), 'keine signal @' + w);
    assert.ok(!ids.includes('whatsapp'), 'keine whatsapp @' + w);
    assert.ok(ids.includes('time') && ids.includes('date') && ids.includes('weather'), 'Kernzeilen @' + w);
    assert.ok(ids.includes('timer') && ids.includes('stopwatch'), 'Timer/Stoppuhr @' + w);
    inUnitSquare(rows, w, h);
    noOverlap(rows, w, h);
    frameGapOk(rows, w, h);
  }
});

test('CFG-layout-ss: layoutRows ohne Messenger-Zeilen (screensaver) – zentriert ±0,03, FRAME_OVERHANG', () => {
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    const rows = layoutRows(w, h, LAYOUT_NO_MSG, { screensaver: true });
    const ids = rows.map((r) => r.id);
    assert.ok(!ids.includes('signal'), 'keine signal @' + w);
    assert.ok(!ids.includes('whatsapp'), 'keine whatsapp @' + w);
    assert.ok(!ids.includes('timer'), 'keine timer @' + w);
    assert.ok(!ids.includes('stopwatch'), 'keine stopwatch @' + w);
    assert.ok(rows.cityLabel, 'cityLabel vorhanden @' + w + 'x' + h);
    // Vertikale Zentrierung ±0,03
    const boxes = rows.map((r) => r.box);
    if (rows.cityLabel) boxes.push(rows.cityLabel);
    let top = Infinity;
    let bottom = -Infinity;
    for (const b of boxes) {
      if (b.top < top) top = b.top;
      if (b.bottom > bottom) bottom = b.bottom;
    }
    assert.ok(
      Math.abs(top - (1 - bottom)) <= 0.03,
      'zentriert @' + w + 'x' + h + ': topGap=' + top + ' bottomGap=' + (1 - bottom)
    );
    inUnitSquare(rows, w, h);
    noOverlap(rows, w, h);
    frameGapOk(rows, w, h);
  }
});
