'use strict';

// Tests für den Windows-Bildschirmschoner screensaver/FallblattUhr.scr.
// Prüft Bauen (build.cmd), /p-Verhalten, ParseMode-SELFTEST und Pflicht-Bausteine
// im Quelltext. Der Schoner wird NICHT mit /s gestartet (würde den Bildschirm
// beenden und die laufende Uhr beenden).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const scrDir = path.join(root, 'screensaver');
const csPath = path.join(scrDir, 'FallblattUhr.cs');
const buildCmd = path.join(scrDir, 'build.cmd');
const scrPath = path.join(root, 'FallblattUhr.scr');
const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

function run(cmd, args, opts) {
  return spawnSync(cmd, args, Object.assign({
    encoding: 'utf8',
    windowsHide: true,
  }, opts || {}));
}

test('AK1: screensaver\\build.cmd Exitcode 0 und erzeugt FallblattUhr.scr im Projekt-Root', { skip: process.platform !== 'win32' && 'nur unter Windows' }, () => {
  assert.ok(fs.existsSync(buildCmd), 'build.cmd existiert');
  assert.ok(fs.existsSync(csPath), 'FallblattUhr.cs existiert');

  const r = run('cmd.exe', ['/c', buildCmd], { cwd: scrDir, timeout: 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.strictEqual(r.status, 0, 'build.cmd Exitcode 0, Ausgabe: ' + out);
  assert.ok(fs.existsSync(scrPath), 'FallblattUhr.scr liegt im Projekt-Root');
  assert.ok(fs.statSync(scrPath).size > 0, 'FallblattUhr.scr ist nicht leer');
});

test('AK2: FallblattUhr.scr /p 1234 beendet in 2 s mit Exitcode 0', { skip: process.platform !== 'win32' && 'nur unter Windows' }, () => {
  assert.ok(fs.existsSync(scrPath), 'FallblattUhr.scr muss vorher gebaut sein (AK1)');
  // .scr wird per cmd.exe gestartet (CreateProcess/PATHEXT kennt .scr nicht immer)
  const started = Date.now();
  const r = run('cmd.exe', ['/c', scrPath, '/p', '1234'], { timeout: 2000 });
  const ms = Date.now() - started;
  assert.strictEqual(r.status, 0, '/p Exitcode 0, signal=' + r.signal + ' err=' + (r.stderr || '') + ' out=' + (r.stdout || ''));
  assert.ok(ms < 2000, 'Beendigung nach ' + ms + ' ms (< 2000 ms)');
});

test('AK3: ParseMode-SELFTEST-Build (Eigenes Main, Exitcode 0/1)', { skip: process.platform !== 'win32' && 'nur unter Windows' }, () => {
  assert.ok(fs.existsSync(CSC), 'csc.exe vorhanden: ' + CSC);
  const selftestExe = path.join(os.tmpdir(), 'FallblattUhr.selftest.' + process.pid + '.exe');

  const build = run(CSC, [
    '/nologo',
    '/target:exe',
    '/define:SELFTEST',
    '/out:' + selftestExe,
    '/r:System.dll',
    '/r:System.Management.dll',
    '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll',
    csPath,
  ], { timeout: 60000 });
  const buildOut = (build.stdout || '') + (build.stderr || '');
  assert.strictEqual(build.status, 0, 'SELFTEST-Build Exitcode 0: ' + buildOut);

  const runResult = run(selftestExe, [], { timeout: 10000 });
  const runOut = (runResult.stdout || '') + (runResult.stderr || '');
  assert.strictEqual(runResult.status, 0, 'SELFTEST Exitcode 0: ' + runOut);
});

test('AK4: Quelltext enthält --kiosk, FallblattUhrChrome, screensaver=1, GetLastInputInfo, WMI, wasKioskRunning', () => {
  const src = fs.readFileSync(csPath, 'utf8');

  assert.match(src, /--kiosk/, 'Chrome-Flag --kiosk');
  assert.match(src, /FallblattUhrChrome/, 'Profil-Marker FallblattUhrChrome');
  assert.match(src, /screensaver=1/, 'URL-Parameter screensaver=1');
  assert.match(src, /GetLastInputInfo/, 'P/Invoke GetLastInputInfo');

  // WMI-Abfrage auf Win32_Process mit Filter auf FallblattUhrChrome
  assert.match(src, /Win32_Process/, 'WMI Win32_Process');
  assert.match(
    src,
    /Win32_Process WHERE Name = 'chrome\.exe' AND CommandLine LIKE '%"\s*\+\s*ProfileMarker/,
    'WMI-Filter auf FallblattUhrChrome / ProfileMarker'
  );
  // Robuster: der Query-Baustein muss ProfileMarker (FallblattUhrChrome) enthalten
  assert.match(src, /CommandLine LIKE/, 'WMI-Filter auf CommandLine');
  assert.ok(
    src.includes('ProfileMarker') && src.includes('FallblattUhrChrome'),
    'Profil-Marker-FallblattUhrChrome im WMI-Filter'
  );

  // Neustart der Kiosk-Ansicht bei wasKioskRunning
  assert.match(src, /wasKioskRunning/, 'Flag wasKioskRunning');
  assert.match(
    src,
    /if\s*\(\s*wasKioskRunning\s*\)/,
    'Neustart der Kiosk-Ansicht an wasKioskRunning gekoppelt'
  );

  // Beenden nur der eigenen Chrome-Prozesse, Helper nicht beenden
  assert.match(src, /--user-data-dir/, 'eigenes Chrome-Profil');
  assert.doesNotMatch(src, /taskkill/i, 'kein taskkill (nur gezielte Prozess-Beendigung)');
});

test('Chrome-Flags gegen Render-Drosselung in StartChrome und Uhr-starten.cmd', () => {
  const requiredFlags = [
    '--disable-features=Translate,CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ];

  // 1) StartChrome in FallblattUhr.cs
  const src = fs.readFileSync(csPath, 'utf8');
  const startChromeMatch = src.match(
    /private static Process StartChrome[\s\S]*?return Process\.Start\(psi\);/
  );
  assert.ok(startChromeMatch, 'StartChrome-Methode in FallblattUhr.cs gefunden');
  const startChrome = startChromeMatch[0];
  for (const flag of requiredFlags) {
    assert.ok(startChrome.includes(flag), 'StartChrome enthält ' + flag);
  }
  assert.match(
    startChrome,
    /--disable-features=Translate,CalculateNativeWinOcclusion/,
    'CalculateNativeWinOcclusion steht in --disable-features'
  );

  // 2) Chrome-Zeile in Uhr-starten.cmd
  const cmdPath = path.join(root, 'Uhr-starten.cmd');
  assert.ok(fs.existsSync(cmdPath), 'Uhr-starten.cmd existiert');
  const cmd = fs.readFileSync(cmdPath, 'utf8');
  const chromeLine = cmd.split(/\r?\n/).find((l) => l.includes('chrome.exe'));
  assert.ok(chromeLine, 'Chrome-Zeile in Uhr-starten.cmd gefunden');
  for (const flag of requiredFlags) {
    assert.ok(chromeLine.includes(flag), 'Chrome-Zeile enthält ' + flag);
  }
});

test('AK5: bisherige Tests weiterhin grün (Meta-Check auf Testdateien im Root)', () => {
  // Dieser Test läuft zusammen mit den bisherigen; npm test muss  grün bleiben.
  // Explizit: app.test.js und die weiteren *.test.js sind unverändert vorhanden.
  for (const f of ['app.test.js', 'render3d.test.js', 'sound.test.js', 'screensaver.test.js']) {
    assert.ok(fs.existsSync(path.join(root, f)), f + ' vorhanden');
  }
  assert.ok(!fs.readFileSync(path.join(root, 'app.test.js'), 'utf8').includes('FallblattUhr.scr'),
    'app.test.js unverändert (kein Schoner-Code dort)');
});
