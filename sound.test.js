'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { shouldChime, chimePlan, isSecondModule } = require('./sound.js');

// ---------------------------------------------------------------------------
// Stub-AudioContext: zählt erzeugte Audio-Knoten
// ---------------------------------------------------------------------------
class StubAudioContext {
  constructor() {
    this.state = 'running';
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.destination = { name: 'destination' };
    this.nodeCount = 0;
  }

  _count() {
    this.nodeCount++;
  }

  createDynamicsCompressor() {
    this._count();
    return { threshold: { value: 0 }, ratio: { value: 0 }, connect() {} };
  }

  createGain() {
    this._count();
    return {
      gain: {
        value: 0,
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() {},
    };
  }

  createConvolver() {
    this._count();
    return { buffer: null, connect() {} };
  }

  createBuffer(channels, length) {
    this._count();
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }

  createBufferSource() {
    this._count();
    return { buffer: null, connect() {}, start() {}, stop() {} };
  }

  createBiquadFilter() {
    this._count();
    return {
      type: '',
      frequency: { value: 0 },
      Q: { value: 0 },
      connect() {},
    };
  }

  createOscillator() {
    this._count();
    return {
      type: '',
      frequency: { value: 0 },
      connect() {},
      start() {},
      stop() {},
    };
  }

  resume() {
    return Promise.resolve();
  }
}

function loadSoundWithStub() {
  const stub = new StubAudioContext();
  const prevAC = globalThis.AudioContext;
  globalThis.AudioContext = function AudioContext() {
    return stub;
  };
  const resolved = require.resolve('./sound.js');
  delete require.cache[resolved];
  require('./sound.js');
  const FlapSound = globalThis.FlapSound;
  return {
    stub,
    FlapSound,
    restore() {
      if (prevAC === undefined) delete globalThis.AudioContext;
      else globalThis.AudioContext = prevAC;
    },
  };
}

// ---------------------------------------------------------------------------
// AK 1: shouldChime
// ---------------------------------------------------------------------------
test('AK1: shouldChime löst genau bei :00 und :30 aus', () => {
  // 22:00 -> 10 Schläge (22 % 12 = 10)
  assert.deepStrictEqual(shouldChime(new Date(2026, 9, 23, 21, 59, 59), new Date(2026, 9, 23, 22, 0, 0)), {
    type: 'hour',
    strikes: 10,
  });

  // 23:59:59 -> 00:00:00 nächster Tag -> strikes 12
  assert.deepStrictEqual(shouldChime(new Date(2026, 9, 23, 23, 59, 59), new Date(2026, 9, 24, 0, 0, 0)), {
    type: 'hour',
    strikes: 12,
  });

  // 12:29:59 -> 12:30:00 -> halbe Stunde
  assert.deepStrictEqual(shouldChime(new Date(2026, 9, 23, 12, 29, 59), new Date(2026, 9, 23, 12, 30, 0)), {
    type: 'half',
  });

  // bereits ausgelöst: 12:30:0 -> 12:30:1
  assert.strictEqual(shouldChime(new Date(2026, 9, 23, 12, 30, 0), new Date(2026, 9, 23, 12, 30, 1)), null);

  // keine Marke: 12:10:0 -> 12:11:0
  assert.strictEqual(shouldChime(new Date(2026, 9, 23, 12, 10, 0), new Date(2026, 9, 23, 12, 11, 0)), null);
});

// ---------------------------------------------------------------------------
// AK 2: chimePlan volle Stunde
// ---------------------------------------------------------------------------
test('AK2: chimePlan({type:"hour",strikes:3}) — 3 STRIKE, t aufsteigend, Abstand 2,0–2,5 s', () => {
  const plan = chimePlan({ type: 'hour', strikes: 3 });
  assert.strictEqual(plan.length, 3);
  for (const e of plan) {
    assert.strictEqual(e.note, 'STRIKE');
  }
  assert.strictEqual(plan[0].t, 0);
  for (let i = 1; i < plan.length; i++) {
    assert.ok(plan[i].t > plan[i - 1].t, 't streng aufsteigend');
    const gap = plan[i].t - plan[i - 1].t;
    assert.ok(gap >= 2.0 && gap <= 2.5, 'Abstand ' + gap + ' in [2.0, 2.5]');
  }
});

// ---------------------------------------------------------------------------
// AK 3: chimePlan halbe Stunde
// ---------------------------------------------------------------------------
test('AK3: chimePlan({type:"half"}) — genau 1 STRIKE bei t=0', () => {
  const plan = chimePlan({ type: 'half' });
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].note, 'STRIKE');
  assert.strictEqual(plan[0].t, 0);
});

// ---------------------------------------------------------------------------
// AK 4: isSecondModule
// Indexierung: Ziffernstellen 0-7 von "HH:MM:SS" inkl. Doppelpunkt-Positionen 2 und 5:
//   0=H 1=H 2=: 3=M 4=M 5=: 6=S 7=S
// true nur für timer/stopwatch an den Sekundenstellen 6 und 7.
// ---------------------------------------------------------------------------
test('AK4: isSecondModule — Indizes 0-7 von HH:MM:SS inkl. Doppelpunkte 2 und 5', () => {
  assert.strictEqual(isSecondModule('timer', 6), true);
  assert.strictEqual(isSecondModule('timer', 7), true);
  assert.strictEqual(isSecondModule('timer', 4), false);
  assert.strictEqual(isSecondModule('stopwatch', 7), true);
  assert.strictEqual(isSecondModule('time', 3), false);
  // Doppelpunkte und Stunden sind keine Sekunden
  assert.strictEqual(isSecondModule('timer', 2), false);
  assert.strictEqual(isSecondModule('timer', 5), false);
  assert.strictEqual(isSecondModule('timer', 0), false);
});

// ---------------------------------------------------------------------------
// AK 5: clack('second') erzeugt keine Audio-Knoten
// ---------------------------------------------------------------------------
test('AK5: FlapSound.clack("second") erzeugt keinen Audio-Knoten (Stub zählt)', () => {
  const { stub, FlapSound, restore } = loadSoundWithStub();
  try {
    assert.ok(FlapSound && typeof FlapSound.clack === 'function');
    FlapSound.init();
    FlapSound.setClackEnabled(true);
    const before = stub.nodeCount;
    FlapSound.clack('second');
    assert.strictEqual(stub.nodeCount, before, 'clack(second) darf keinen Knoten erzeugen');
    // Gegenprobe: minute erzeugt Knoten (Zähler ist aktiv)
    FlapSound.clack('minute');
    assert.ok(stub.nodeCount > before, 'clack(minute) erzeugt Knoten');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// AK 6: Taste G + localStorage "flap.chime" in try/catch
// ---------------------------------------------------------------------------
test('AK6: Taste G und localStorage "flap.chime" verdrahtet, Zugriff in try/catch', () => {
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(src, /k === 'g' \|\| k === 'G'/);
  assert.match(src, /flap\.chime/);
  assert.match(src, /flap\.sound/);
  assert.match(src, /toggleChime/);

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

  // Statusanzeige beim Umschalten
  assert.match(src, /STANDUHR /);
});

// ---------------------------------------------------------------------------
// AK 7: Chrome-Flag für Autoplay
// ---------------------------------------------------------------------------
test('AK7: Uhr-starten.cmd enthält --autoplay-policy=no-user-gesture-required', () => {
  const cmd = fs.readFileSync(path.join(__dirname, 'Uhr-starten.cmd'), 'utf8');
  assert.match(cmd, /--autoplay-policy=no-user-gesture-required/);
});

// ---------------------------------------------------------------------------
// AK 9: .gitignore
// ---------------------------------------------------------------------------
test('AK9: .gitignore im Root mit .claude/ und node_modules/', () => {
  const gi = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8');
  assert.match(gi, /\.claude\//);
  assert.match(gi, /node_modules\//);
  assert.match(gi, /\.mimocode\//);
  assert.match(gi, /\.playwright-mcp\//);
});

// ---------------------------------------------------------------------------
// Zusätzlich: sound.js vor app.js geladen, FlapSound global, pure Exporte
// ---------------------------------------------------------------------------
test('SOUND: index.html lädt sound.js vor app.js, FlapSound global + pure Exporte', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const soundIdx = html.indexOf('sound.js');
  const appIdx = html.indexOf('app.js');
  assert.ok(soundIdx !== -1, 'sound.js in index.html');
  assert.ok(appIdx !== -1, 'app.js in index.html');
  assert.ok(soundIdx < appIdx, 'sound.js vor app.js');

  assert.strictEqual(typeof shouldChime, 'function');
  assert.strictEqual(typeof chimePlan, 'function');
  assert.strictEqual(typeof isSecondModule, 'function');

  const { FlapSound, restore } = loadSoundWithStub();
  try {
    assert.ok(FlapSound, 'FlapSound global');
    assert.strictEqual(typeof FlapSound.init, 'function');
    assert.strictEqual(typeof FlapSound.clack, 'function');
    assert.strictEqual(typeof FlapSound.chime, 'function');
  } finally {
    restore();
  }
});
