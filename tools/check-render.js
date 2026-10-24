#!/usr/bin/env node
/**
 * tools/check-render.js — maschinelle Selbstprüfung der WebGL-Darstellung.
 * Startet Chrome headless (ANGLE D3D11, GPU) gegen index.html?debug=1,
 * wertet das Debug-JSON im gedumpsten DOM aus und schreibt Screenshots.
 *
 * Aufruf: node tools/check-render.js
 * Exit 0 = alle Prüfungen bestanden, sonst 1.
 */
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { FRAME_OVERHANG } = require(path.join(__dirname, '..', 'render3d.js'));

const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const project = path.resolve(__dirname, '..');
const shotsDir = path.join(project, '.claude', 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

const projectUrl = 'file:///' + project.replace(/\\/g, '/');

/** Debug-JSON aus gedumpstem DOM extrahieren. */
function extractDebug(html) {
  const m = html.match(/<pre[^>]*id=["']flap-debug["'][^>]*>([\s\S]*?)<\/pre>/i);
  if (!m) return null;
  const raw = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    // evtl. HTML-Encoding von Anführungszeichen
    try {
      return JSON.parse(raw.replace(/&#39;/g, "'"));
    } catch (e2) {
      return null;
    }
  }
}

/**
 * Chrome headless starten. useVirtualTime nutzt --virtual-time-budget.
 * extraQuery wird an die URL angehängt (z.B. '&freezeFlip=0.5').
 */
function runChrome(width, height, shotName, useVirtualTime, extraQuery) {
  const shotFile = path.join(shotsDir, shotName);
  const dumpFile = path.join(shotsDir, 'dump-' + shotName.replace(/\.png$/, '') + '.html');
  const url = projectUrl + '/index.html?debug=1' + (extraQuery || '');

  const args = [
    '--headless=new',
    '--use-angle=d3d11',
    '--enable-gpu',
    '--window-size=' + width + ',' + height,
    '--allow-file-access-from-files',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
  ];
  if (useVirtualTime) {
    args.push('--virtual-time-budget=15000');
  } else {
    args.push('--timeout=12000');
  }
  args.push('--dump-dom', '--screenshot=' + shotFile.replace(/\\/g, '/'), url);

  let stdout = '';
  try {
    stdout = execFileSync(CHROME, args, {
      encoding: 'utf8',
      timeout: 90000,
      maxBuffer: 80 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (e) {
    stdout = (e.stdout || '') + '';
    console.error('Chrome-Fehler (' + (useVirtualTime ? 'virtual' : 'wait') + '):', e.message);
  }

  fs.writeFileSync(dumpFile, stdout, 'utf8');
  const dbg = extractDebug(stdout);
  return { dbg, shotFile, dumpFile, stdout };
}

/** Prüft Debug-JSON gegen die Akzeptanzkriterien. */
function evaluate(dbg, label, width, height, opts) {
  const options = opts || {};
  const result = {
    label: label,
    ok: false,
    rows: {},
    textures: null,
    frames: null,
    fontLoaded: null,
    layoutChecks: {},
    shadowMapSize: null,
    cameraTiltDeg: null,
    errors: [],
  };

  if (!dbg) {
    result.errors.push('kein flap-debug JSON im DOM');
    return result;
  }

  result.textures = dbg.textures;
  result.frames = dbg.frames;
  result.shadowMapSize = dbg.shadowMapSize;
  result.cameraTiltDeg = dbg.cameraTiltDeg;
  result.fontLoaded =
    dbg.atlas && Object.keys(dbg.atlas).length > 0
      ? Object.keys(dbg.atlas).every((k) => dbg.atlas[k].fontLoaded === true)
      : false;

  if (!(dbg.frames > 0)) {
    result.errors.push('frames=' + dbg.frames + ' (erwartet > 0)');
  }
  if (!result.fontLoaded) {
    result.errors.push('fontLoaded nicht true in allen Atlanten');
  }
  if (!(dbg.textures <= 12)) {
    result.errors.push('textures=' + dbg.textures + ' (erwartet ≤ 12)');
  }

  // ---- Shadow-Map-Größe (AK4) ----
  const expectShadow = width >= 1600 ? 4096 : 2048;
  if (dbg.shadowMapSize !== expectShadow) {
    result.errors.push(
      'shadowMapSize=' + dbg.shadowMapSize + ' (erwartet ' + expectShadow + ' bei ' + width + ')'
    );
  }

  // ---- Kamera-Neigung (AK5): 4–6° ----
  const tilt = dbg.cameraTiltDeg;
  if (!(tilt >= 4 && tilt <= 6)) {
    result.errors.push('cameraTiltDeg=' + tilt + ' (erwartet 4–6)');
  }

  // ---- Szene (AK3): Stapelkanten, Blattdicke, Rahmen ----
  const scene = dbg.scene || {};
  if (!(scene.stackEdgeCount >= 3)) {
    result.errors.push('scene.stackEdgeCount=' + scene.stackEdgeCount + ' (erwartet ≥ 3)');
  }
  if (!(scene.leafThicknessRatio >= 0.01)) {
    result.errors.push(
      'scene.leafThicknessRatio=' + scene.leafThicknessRatio + ' (erwartet ≥ 0.01)'
    );
  }
  if (!scene.hasFrame) {
    result.errors.push('scene.hasFrame fehlt');
  }

  const rows = dbg.rows || {};
  const rowIds = Object.keys(rows);
  if (rowIds.length === 0) {
    result.errors.push('keine Zeilen im Debug-JSON');
  }

  for (const id of rowIds) {
    const r = rows[id] || {};
    // Bei freezeFlip darf die Uhrzeit-Zeile animiert sein
    const frozen = options.allowFrozen && id === 'time';
    const rowOk = frozen ? true : r.shown === r.target && r.animating === 0;
    result.rows[id] = {
      ok: rowOk,
      shown: r.shown,
      target: r.target,
      animating: r.animating,
    };
    if (!rowOk) {
      result.errors.push(
        id +
          ': shown=' +
          JSON.stringify(r.shown) +
          ' target=' +
          JSON.stringify(r.target) +
          ' animating=' +
          r.animating
      );
    }
  }

  // Pflicht-Zeilen
  for (const need of ['time', 'date', 'weather', 'signal', 'whatsapp', 'timer', 'stopwatch']) {
    if (!result.rows[need]) {
      result.errors.push('Zeile fehlt: ' + need);
      result.rows[need] = { ok: false, shown: null, target: null, animating: null };
    }
  }

  // ---- Layout-Prüfungen (a)-(f) ----
  const layout = dbg.layout;
  const lc = result.layoutChecks;
  if (!layout || !layout.rows) {
    result.errors.push('layout-Boxen fehlen im Debug-JSON');
    lc.a = lc.b = lc.c = lc.d = lc.e = lc.f = lc.g = false;
  } else {
    const t = layout.rows.timer;
    const s = layout.rows.stopwatch;
    // (a) gleiche y (Toleranz 0,5 % Höhe)
    if (t && s) {
      lc.a = Math.abs(t.box.top - s.box.top) <= 0.005;
      if (!lc.a) {
        result.errors.push(
          '(a) timer.y=' + t.box.top + ' ≠ stopwatch.y=' + s.box.top + ' (Tol 0.005)'
        );
      }
      // (b) Timer links der Mitte, Stoppuhr rechts davon
      lc.b = t.box.right < 0.5 && s.box.left > 0.5;
      if (!lc.b) {
        result.errors.push(
          '(b) timer.right=' + t.box.right + ' / stopwatch.left=' + s.box.left
        );
      }
    } else {
      lc.a = false;
      lc.b = false;
      result.errors.push('(a/b) timer/stopwatch Boxen fehlen');
    }

    // (c) jede Taste horizontal innerhalb der Breite ihrer Anzeige
    lc.c = true;
    const btnMap = layout.buttons || {};
    const pairOf = {
      timerHourUp: 'timer',
      timerHourDown: 'timer',
      timerMinUp: 'timer',
      timerMinDown: 'timer',
      timerStartPause: 'timer',
      timerReset: 'timer',
      swStartPause: 'stopwatch',
      swReset: 'stopwatch',
    };
    for (const ctrl of Object.keys(pairOf)) {
      const b = btnMap[ctrl];
      const disp = layout.rows[pairOf[ctrl]];
      if (!b || !disp) {
        lc.c = false;
        result.errors.push('(c) Taste oder Anzeige fehlt: ' + ctrl);
        continue;
      }
      const inside =
        b.left >= disp.box.left - 1e-6 && b.right <= disp.box.right + 1e-6;
      if (!inside) {
        lc.c = false;
        result.errors.push(
          '(c) ' +
            ctrl +
            ' [' +
            b.left +
            ',' +
            b.right +
            '] außerhalb ' +
            pairOf[ctrl] +
            ' [' +
            disp.box.left +
            ',' +
            disp.box.right +
            ']'
        );
      }
    }

    // (d) keine Box überlappt eine andere (inkl. Hinweis-Box)
    const boxes = [];
    for (const id of Object.keys(layout.rows)) {
      boxes.push({ id: id, box: layout.rows[id].box });
    }
    for (const lk of Object.keys(layout.labels || {})) {
      boxes.push({ id: lk, box: layout.labels[lk] });
    }
    for (const bk of Object.keys(layout.buttons || {})) {
      boxes.push({ id: bk, box: layout.buttons[bk] });
    }
    if (layout.hintBox) {
      boxes.push({ id: 'hintBox', box: layout.hintBox });
    }
    lc.d = true;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].box;
        const b = boxes[j].box;
        const ov = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        if (ov) {
          lc.d = false;
          result.errors.push('(d) ' + boxes[i].id + ' überlappt ' + boxes[j].id);
        }
      }
    }

    // (e) unterste Box endet bei ≤ 97 % der Höhe (ohne Hinweis-Box im freien Rand)
    let maxBottom = 0;
    for (const b of boxes) {
      if (b.id === 'hintBox') continue;
      if (b.box.bottom > maxBottom) maxBottom = b.box.bottom;
    }
    lc.e = maxBottom <= 0.97;
    if (!lc.e) {
      result.errors.push('(e) unterste Box endet bei ' + maxBottom + ' > 0.97');
    }

    // (f) Doppelpunkte (Runde 4): quadratische Punkte, Kante = 0,09 × Modulhöhe,
    //     Punktmitten bei Achse ± 0,18 × Modulhöhe, Mitte in der Lücke.
    lc.f = true;
    const vp = dbg.viewport || {};
    const W = vp.w > 0 ? vp.w : width;
    const H = vp.h > 0 ? vp.h : height;
    for (const rowId of ['time', 'timer', 'stopwatch']) {
      const r = layout.rows[rowId];
      if (!r) {
        lc.f = false;
        result.errors.push('(f) Zeile fehlt: ' + rowId);
        continue;
      }
      const cb = r.colonBoxes || [];
      const expect = rowId === 'time' ? 1 : 2;
      if (cb.length !== expect) {
        lc.f = false;
        result.errors.push('(f) ' + rowId + ': ' + cb.length + ' Doppelpunkte (erwartet ' + expect + ')');
        continue;
      }
      const modH = r.moduleH != null ? r.moduleH : r.h;
      for (let i = 0; i < cb.length; i++) {
        const c = cb[i];
        const gapMid = c.gapMid;
        const gapW = c.gapWidth;
        // Mitte in der Lücke (±5 %)
        const off = Math.abs(c.cx - gapMid);
        if (!(off <= 0.05 * gapW)) {
          lc.f = false;
          result.errors.push(
            '(f) ' + rowId + '[' + i + '] cx=' + c.cx + ' ≠ gapMid=' + gapMid + ' (Tol ' + 0.05 * gapW + ')'
          );
        }
        // Zwei quadratische Punkte
        const dots = c.dots || [];
        if (dots.length !== 2) {
          lc.f = false;
          result.errors.push('(f) ' + rowId + '[' + i + '] ' + dots.length + ' Punkte (erwartet 2)');
          continue;
        }
        for (let j = 0; j < dots.length; j++) {
          const d = dots[j];
          // w/h in Pixeln in [0,95; 1,05]
          const ratio = (d.w * W) / (d.h * H);
          if (!(ratio >= 0.95 && ratio <= 1.05)) {
            lc.f = false;
            result.errors.push(
              '(f) ' + rowId + '[' + i + '].dot' + j + ' w/h=' + ratio + ' nicht in [0,95;1,05]'
            );
          }
          // h = 0,09 × Modulhöhe (±0,5 % relativ)
          const rel = Math.abs(d.h - 0.09 * modH) / (0.09 * modH);
          if (!(rel <= 0.005)) {
            lc.f = false;
            result.errors.push(
              '(f) ' + rowId + '[' + i + '].dot' + j + ' h=' + d.h + ' ≠ 0,09×Modulhöhe=' + 0.09 * modH + ' (rel ' + rel + ')'
            );
          }
          // Punktmitten bei Achse ± 0,18 × Modulhöhe (±0,01)
          const dy = Math.abs(d.cy - c.cy) / modH;
          if (!(Math.abs(dy - 0.18) <= 0.01)) {
            lc.f = false;
            result.errors.push(
              '(f) ' + rowId + '[' + i + '].dot' + j + ' |dy|/modH=' + dy + ' ≠ 0,18 (±0,01)'
            );
          }
          // Punktmitte horizontal in der Lückenmitte (±5 %)
          const dx = Math.abs(d.cx - gapMid);
          if (!(dx <= 0.05 * gapW)) {
            lc.f = false;
            result.errors.push(
              '(f) ' + rowId + '[' + i + '].dot' + j + ' cx=' + d.cx + ' ≠ gapMid=' + gapMid
            );
          }
        }
      }
    }

    // Labels im Debug-JSON
    const lt = dbg.labelTexts || {};
    if (lt.timer !== 'TIMER' || lt.stopwatch !== 'STOPPUHR' || lt.city !== 'DÜSSELDORF') {
      result.errors.push(
        'Labels fehlen: ' + JSON.stringify(lt) + ' (erwartet TIMER/STOPPUHR/DÜSSELDORF)'
      );
    }

    // (g) Rahmen-Boxen: Modul-Box erweitert um FRAME_OVERHANG × Zeilenhöhe.
    //     Diese Boxen dürfen sich zwischen Zeilen nicht überlappen und in 0..1 liegen.
    lc.g = true;
    const frameBoxes = [];
    for (const id of Object.keys(layout.rows)) {
      const r = layout.rows[id];
      const hRow = r.box.bottom - r.box.top;
      const exp = FRAME_OVERHANG * hRow;
      const fb = {
        id: id,
        left: r.box.left - exp,
        top: r.box.top - exp,
        right: r.box.right + exp,
        bottom: r.box.bottom + exp,
      };
      frameBoxes.push(fb);
      if (
        fb.left < -1e-9 ||
        fb.top < -1e-9 ||
        fb.right > 1 + 1e-9 ||
        fb.bottom > 1 + 1e-9
      ) {
        lc.g = false;
        result.errors.push(
          '(g) Rahmen-Box ' +
            id +
            ' außerhalb 0..1: [' +
            fb.left +
            ',' +
            fb.top +
            ',' +
            fb.right +
            ',' +
            fb.bottom +
            ']'
        );
      }
    }
    for (let i = 0; i < frameBoxes.length; i++) {
      for (let j = i + 1; j < frameBoxes.length; j++) {
        const a = frameBoxes[i];
        const b = frameBoxes[j];
        const ov =
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        if (ov) {
          lc.g = false;
          result.errors.push('(g) Rahmen ' + a.id + ' überlappt ' + b.id);
        }
      }
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

/**
 * Prüfung (i): Screensaver-Debug-JSON auswerten.
 * Keine timer/stopwatch-Zeilen, Labels oder Tasten;
 * Rahmen-Boxen überlappen nicht; Inhalt vertikal zentriert (±3 %).
 */
function evaluateSaver(dbg, label, width, height) {
  const result = {
    label: label,
    ok: false,
    errors: [],
    layoutChecks: {},
    rows: {},
    frames: null,
    fontLoaded: null,
  };

  if (!dbg) {
    result.errors.push('kein flap-debug JSON im DOM');
    return result;
  }

  result.frames = dbg.frames;
  result.fontLoaded =
    dbg.atlas && Object.keys(dbg.atlas).length > 0
      ? Object.keys(dbg.atlas).every((k) => dbg.atlas[k].fontLoaded === true)
      : false;

  if (!(dbg.frames > 0)) {
    result.errors.push('frames=' + dbg.frames + ' (erwartet > 0)');
  }
  if (!result.fontLoaded) {
    result.errors.push('fontLoaded nicht true in allen Atlanten');
  }

  const rows = dbg.rows || {};
  result.rows = {};
  for (const id of Object.keys(rows)) {
    const r = rows[id] || {};
    const rowOk = r.shown === r.target && r.animating === 0;
    result.rows[id] = {
      ok: rowOk,
      shown: r.shown,
      target: r.target,
      animating: r.animating,
    };
    if (!rowOk) {
      result.errors.push(
        id +
          ': shown=' +
          JSON.stringify(r.shown) +
          ' target=' +
          JSON.stringify(r.target) +
          ' animating=' +
          r.animating
      );
    }
  }
  result.textures = dbg.textures;
  result.shadowMapSize = dbg.shadowMapSize;
  result.cameraTiltDeg = dbg.cameraTiltDeg;
  const layout = dbg.layout || {};
  const layoutRowsMap = layout.rows || {};
  const labels = layout.labels || {};
  const btnBoxes = layout.buttons || {};
  const lc = result.layoutChecks;

  // (i) keine timer/stopwatch-Zeilen
  lc.i_noTimerRows = !rows.timer && !rows.stopwatch;
  if (!lc.i_noTimerRows) {
    result.errors.push('(i) timer/stopwatch-Zeilen im Debug-JSON');
  }
  if (layoutRowsMap.timer || layoutRowsMap.stopwatch) {
    lc.i_noTimerRows = false;
    result.errors.push('(i) timer/stopwatch in layout.rows');
  }

  // (i) keine timer/stopwatch-Labels
  lc.i_noTimerLabels = !labels.timerLabel && !labels.stopwatchLabel;
  if (!lc.i_noTimerLabels) {
    result.errors.push('(i) timerLabel/stopwatchLabel im Debug-JSON');
  }

  // (i) keine Tasten
  const btnKeys = Object.keys(btnBoxes);
  lc.i_noButtons = btnKeys.length === 0;
  if (!lc.i_noButtons) {
    result.errors.push('(i) Tasten-Boxen im Debug-JSON: ' + btnKeys.join(','));
  }
  const btn3d = dbg.buttons || [];
  if (btn3d.length > 0) {
    lc.i_noButtons = false;
    result.errors.push('(i) 3D-Tasten vorhanden: ' + btn3d.length);
  }

  // Erforderliche Zeilen vorhanden
  for (const need of ['time', 'date', 'weather', 'signal', 'whatsapp']) {
    if (!layoutRowsMap[need] && !rows[need]) {
      result.errors.push('(i) Zeile fehlt: ' + need);
    }
  }

  // (i) Rahmen-Boxen überlappen nicht
  lc.i_frames = true;
  const frameBoxes = [];
  for (const id of Object.keys(layoutRowsMap)) {
    const r = layoutRowsMap[id];
    const hRow = r.box.bottom - r.box.top;
    const exp = FRAME_OVERHANG * hRow;
    frameBoxes.push({
      id: id,
      left: r.box.left - exp,
      top: r.box.top - exp,
      right: r.box.right + exp,
      bottom: r.box.bottom + exp,
    });
  }
  for (let i = 0; i < frameBoxes.length; i++) {
    for (let j = i + 1; j < frameBoxes.length; j++) {
      const a = frameBoxes[i];
      const b = frameBoxes[j];
      const ov =
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      if (ov) {
        lc.i_frames = false;
        result.errors.push('(i) Rahmen ' + a.id + ' überlappt ' + b.id);
      }
    }
  }

  // (i) Inhalt vertikal zentriert: Abstand oben und unten gleich ±3 %
  const allBoxes = [];
  for (const id of Object.keys(layoutRowsMap)) {
    allBoxes.push(layoutRowsMap[id].box);
  }
  if (labels.cityLabel) allBoxes.push(labels.cityLabel);
  if (allBoxes.length > 0) {
    let top = Infinity;
    let bottom = -Infinity;
    for (const b of allBoxes) {
      if (b.top < top) top = b.top;
      if (b.bottom > bottom) bottom = b.bottom;
    }
    const topGap = top;
    const bottomGap = 1 - bottom;
    lc.i_centered = Math.abs(topGap - bottomGap) <= 0.03;
    if (!lc.i_centered) {
      result.errors.push(
        '(i) nicht zentriert: topGap=' +
          topGap.toFixed(4) +
          ' bottomGap=' +
          bottomGap.toFixed(4) +
          ' (Tol 0.03)'
      );
    }
  } else {
    lc.i_centered = false;
    result.errors.push('(i) keine Layout-Boxen für Zentrierung');
  }

  result.ok = result.errors.length === 0;
  return result;
}

/**
 * Helligkeits-/Kontrastprüfung der Ziffern auf den Blättern.
 * Misst die mittlere Helligkeit im Uhrzeit-Bereich und in der Blatt-Fläche;
 * Ziffern (cremeweiß, unlit) müssen deutlich heller sein als das Blatt.
 */
function probeBrightness(shotName) {
  const shotPath = path.join(shotsDir, shotName);
  if (!fileExists(shotPath)) {
    return { ok: false, errors: ['Screenshot fehlt: ' + shotName] };
  }
  const html = `<!DOCTYPE html><html><body><canvas id="c"></canvas><pre id="out"></pre>
<script>
function probe(src) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var c = document.getElementById('c');
      c.width = img.width; c.height = img.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      function region(x, y, w, h) {
        x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
        w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
        var d = ctx.getImageData(x, y, w, h).data;
        var r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
        return [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
      }
      function maxLum(x, y, w, h) {
        x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
        w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
        var d = ctx.getImageData(x, y, w, h).data;
        var mx = 0;
        for (var i = 0; i < d.length; i += 4) {
          var l = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
          if (l > mx) mx = l;
        }
        return Math.round(mx);
      }
      var W = img.width, H = img.height;
      // Uhrzeit-Bereich (Ziffern) und Blatt-Fläche (Rand)
      var timeArea = region(W*0.30, H*0.18, W*0.40, H*0.16);
      var timeMax = maxLum(W*0.30, H*0.18, W*0.40, H*0.16);
      var leafEdge = region(W*0.05, H*0.18, W*0.08, H*0.16);
      resolve({ size: [W, H], timeArea: timeArea, timeMax: timeMax, leafEdge: leafEdge });
    };
    img.onerror = function() { resolve({ error: 'load ' + src }); };
    img.src = src;
  });
}
probe('${shotName.replace(/\\/g, '/')}').then(function(a) {
  document.getElementById('out').textContent = JSON.stringify(a);
});
</script></body></html>`;
  const probeFile = path.join(shotsDir, 'probe-brightness.html');
  fs.writeFileSync(probeFile, html, 'utf8');
  const url = 'file:///' + shotsDir.replace(/\\/g, '/') + '/probe-brightness.html';
  let out = '';
  try {
    out = execFileSync(
      CHROME,
      [
        '--headless=new',
        '--allow-file-access-from-files',
        '--virtual-time-budget=5000',
        '--dump-dom',
        url,
      ],
      { encoding: 'utf8', timeout: 40000, maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (e) {
    out = (e.stdout || '') + '';
  }
  const m = out.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!m) return { ok: false, errors: ['kein Helligkeits-Ergebnis'] };
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (e) {
    return { ok: false, errors: ['Helligkeits-JSON ungültig'] };
  }
  if (data.error) return { ok: false, errors: [data.error] };
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const tLum = data.timeMax != null ? data.timeMax : lum(data.timeArea || [0, 0, 0]);
  const lLum = lum(data.leafEdge || [0, 0, 0]);
  const contrast = tLum - lLum;
  // Ziffern-Spitzenhelligkeit (cremeweiß) muss deutlich über dem Blatt liegen
  const ok = contrast > 80;
  return {
    ok: ok,
    timeArea: data.timeArea,
    timeMax: data.timeMax,
    leafEdge: data.leafEdge,
    contrast: Math.round(contrast),
    errors: ok ? [] : ['Kontrast Ziffern-Spitze/Blatt zu niedrig: ' + Math.round(contrast) + ' (erwartet > 80)'],
  };
}

/**
 * (h) Pixelprüfung Datumszeile: im unteren Drittel jedes Datums-Moduls,
 * das ein Zeichen (kein Leerzeichen) zeigt, muss es Pixel mit Helligkeit > 180 geben.
 */
function probeDateLine(shotName, dbg) {
  const shotPath = path.join(shotsDir, shotName);
  if (!fileExists(shotPath)) {
    return { ok: false, errors: ['Screenshot fehlt: ' + shotName] };
  }
  const layout = dbg && dbg.layout;
  const row = layout && layout.rows && layout.rows.date;
  const shownRow = dbg && dbg.rows && dbg.rows.date;
  const shown = (shownRow && shownRow.shown) || '';
  if (!row || !row.box) {
    return { ok: false, errors: ['date-Layout-Box fehlt'] };
  }
  // Layout ist auf dem Canvas normiert; Pixelkoordinaten beziehen sich
  // auf das Screenshot-Bild (img.width/height) in der Probe.
  const hRow = row.box.bottom - row.box.top;
  const len = Math.max(1, shown.length || 14);

  // Unteres Drittel jedes belegten Moduls. Slots aus der Zeilen-Box;
  // horizontal mit halbem Slot-Zuschlag, weil Canvas-Maß (viewport) und
  // Screenshot-Maß auseinanderfallen können (Chrome-Layout).
  const boxW = row.box.right - row.box.left;
  const slotW = boxW / len;
  const regions = [];
  const my = hRow * 0.08;
  const mx = slotW * 0.5;
  for (let i = 0; i < len; i++) {
    const ch = shown.charAt(i);
    if (!ch || ch === ' ') continue;
    const y0 = row.box.top + (2 / 3) * hRow - my;
    regions.push({
      index: i,
      char: ch,
      x: row.box.left + i * slotW - mx,
      y: y0,
      w: slotW + 2 * mx,
      h: hRow / 3 + my,
    });
  }
  if (regions.length === 0) {
    return { ok: false, errors: ['keine belegten Datums-Module'], regions: [] };
  }

  const html = `<!DOCTYPE html><html><body><canvas id="c"></canvas><pre id="out"></pre>
<script>
function probe(src, regs) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var c = document.getElementById('c');
      c.width = img.width; c.height = img.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      function maxLum(x, y, w, h) {
        x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
        w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
        if (x >= img.width || y >= img.height) return 0;
        w = Math.min(w, img.width - x); h = Math.min(h, img.height - y);
        var d = ctx.getImageData(x, y, w, h).data;
        var mx = 0;
        for (var i = 0; i < d.length; i += 4) {
          var l = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
          if (l > mx) mx = l;
        }
        return Math.round(mx);
      }
      var out = [];
      for (var i = 0; i < regs.length; i++) {
        var r = regs[i];
        // normierte Regionen → Pixel über die tatsächliche Bildgröße
        out.push({
          index: r.index,
          char: r.char,
          maxLum: maxLum(r.x * img.width, r.y * img.height, r.w * img.width, r.h * img.height),
        });
      }
      resolve({ size: [img.width, img.height], modules: out });
    };
    img.onerror = function() { resolve({ error: 'load ' + src }); };
    img.src = src;
  });
}
probe('${shotName.replace(/\\/g, '/')}', ${JSON.stringify(regions)}).then(function(a) {
  document.getElementById('out').textContent = JSON.stringify(a);
});
</script></body></html>`;
  const probeFile = path.join(shotsDir, 'probe-date.html');
  fs.writeFileSync(probeFile, html, 'utf8');
  const url = 'file:///' + shotsDir.replace(/\\/g, '/') + '/probe-date.html';
  let out = '';
  try {
    out = execFileSync(
      CHROME,
      [
        '--headless=new',
        '--allow-file-access-from-files',
        '--virtual-time-budget=5000',
        '--dump-dom',
        url,
      ],
      { encoding: 'utf8', timeout: 40000, maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (e) {
    out = (e.stdout || '') + '';
  }
  const m = out.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!m) return { ok: false, errors: ['kein Datums-Pixel-Ergebnis'], regions: regions };
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (e) {
    return { ok: false, errors: ['Datums-Pixel-JSON ungültig'], regions: regions };
  }
  if (data.error) return { ok: false, errors: [data.error], regions: regions };
  const errors = [];
  const modules = data.modules || [];
  for (const mod of modules) {
    if (!(mod.maxLum > 180)) {
      errors.push(
        '(h) date[' + mod.index + '] "' + mod.char + '" maxLum=' +
          mod.maxLum + ' im unteren Drittel (erwartet > 180)'
      );
    }
  }
  return {
    ok: errors.length === 0,
    modules: modules,
    errors: errors,
  };
}

function printResult(res) {
  console.log('--- ' + res.label + ' ---');
  console.log(
    'fontLoaded=' +
      res.fontLoaded +
      ' frames=' +
      res.frames +
      ' textures=' +
      res.textures +
      ' shadowMap=' +
      res.shadowMapSize +
      ' tilt=' +
      res.cameraTiltDeg +
      '°'
  );
  for (const id of Object.keys(res.rows)) {
    const r = res.rows[id];
    const status = r.ok ? 'bestanden' : 'NICHT BESTANDEN';
    console.log(
      '  ' +
        id +
        ': ' +
        status +
        ' shown=' +
        JSON.stringify(r.shown) +
        ' target=' +
        JSON.stringify(r.target) +
        ' animating=' +
        r.animating
    );
  }
  const lc = res.layoutChecks || {};
  console.log(
    '  Layout (a) gleiche y: ' +
      lc.a +
      ' (b) links/rechts: ' +
      lc.b +
      ' (c) Tasten in Anzeige: ' +
      lc.c +
      ' (d) keine Überlappung: ' +
      lc.d +
      ' (e) unterste Box ≤97%: ' +
      lc.e +
      ' (f) Doppelpunkte: ' +
      lc.f +
      ' (g) Rahmen-Boxen: ' +
      lc.g
  );
  if (lc.i_noTimerRows !== undefined) {
    console.log(
      '  Screensaver (i) keine timer/stopwatch-Zeilen: ' +
        lc.i_noTimerRows +
        ' keine Labels: ' +
        lc.i_noTimerLabels +
        ' keine Tasten: ' +
        lc.i_noButtons +
        ' Rahmen: ' +
        lc.i_frames +
        ' zentriert: ' +
        lc.i_centered
    );
  }
  if (res.errors.length) {
    console.log('Fehler:');
    for (const e of res.errors) console.log('  - ' + e);
  }
  console.log('');
}

function fileExists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch (e) {
    return false;
  }
}

function main() {
  if (!fs.existsSync(CHROME)) {
    console.error('Chrome nicht gefunden: ' + CHROME);
    process.exit(1);
  }

  const results = [];

  // 1920x1080
  console.log('Starte Chrome 1920x1080 …');
  let r1 = runChrome(1920, 1080, 'render-1920.png', true);
  let e1 = evaluate(r1.dbg, '1920x1080 (virtual-time)', 1920, 1080);
  if (!e1.ok) {
    console.log('virtual-time unvollständig, versuche Lauf ohne virtual time …');
    r1 = runChrome(1920, 1080, 'render-1920.png', false);
    e1 = evaluate(r1.dbg, '1920x1080 (ohne virtual time)', 1920, 1080);
  }
  results.push(e1);

  // 1366x768
  console.log('Starte Chrome 1366x768 …');
  let r2 = runChrome(1366, 768, 'render-1366.png', true);
  let e2 = evaluate(r2.dbg, '1366x768 (virtual-time)', 1366, 768);
  if (!e2.ok) {
    console.log('virtual-time unvollständig, versuche Lauf ohne virtual time …');
    r2 = runChrome(1366, 768, 'render-1366.png', false);
    e2 = evaluate(r2.dbg, '1366x768 (ohne virtual time)', 1366, 768);
  }
  results.push(e2);

  // freezeFlip=0.5 Screenshot (1920x1080)
  console.log('Starte Chrome 1920x1080 freezeFlip=0.5 …');
  let r3 = runChrome(1920, 1080, 'render-1920-flip.png', true, '&freezeFlip=0.5');
  let e3 = evaluate(r3.dbg, '1920x1080 freezeFlip=0.5', 1920, 1080, { allowFrozen: true });
  if (!e3.ok) {
    console.log('freezeFlip virtual-time unvollständig, versuche Lauf ohne virtual time …');
    r3 = runChrome(1920, 1080, 'render-1920-flip.png', false, '&freezeFlip=0.5');
    e3 = evaluate(r3.dbg, '1920x1080 freezeFlip=0.5 (ohne virtual time)', 1920, 1080, {
      allowFrozen: true,
    });
  }
  results.push(e3);

  // Screensaver 1920x1080 (?screensaver=1) — Prüfung (i)
  console.log('Starte Chrome 1920x1080 screensaver=1 …');
  let r4 = runChrome(1920, 1080, 'render-1920-saver.png', true, '&screensaver=1');
  let e4 = evaluateSaver(r4.dbg, '1920x1080 screensaver=1', 1920, 1080);
  if (!e4.ok) {
    console.log('screensaver virtual-time unvollständig, versuche Lauf ohne virtual time …');
    r4 = runChrome(1920, 1080, 'render-1920-saver.png', false, '&screensaver=1');
    e4 = evaluateSaver(r4.dbg, '1920x1080 screensaver=1 (ohne virtual time)', 1920, 1080);
  }
  results.push(e4);

  for (const res of results) printResult(res);

  // Helligkeits-/Kontrastprüfung: Ziffern klar lesbar
  console.log('Helligkeitsprüfung render-1920.png …');
  const bright = probeBrightness('render-1920.png');
  console.log(
    '  timeArea=' +
      JSON.stringify(bright.timeArea) +
      ' timeMax=' +
      bright.timeMax +
      ' leafEdge=' +
      JSON.stringify(bright.leafEdge) +
      ' Kontrast=' +
      bright.contrast
  );
  if (!bright.ok) {
    for (const e of bright.errors) console.log('  - ' + e);
  }
  console.log('');

  // (h) Pixelprüfung Datumszeile: unteres Drittel jedes belegten Datums-Moduls
  console.log('Datumszeile-Pixelprüfung render-1920.png …');
  const dateProbe = probeDateLine('render-1920.png', r1.dbg);
  if (dateProbe.modules) {
    console.log(
      '  geprüfte Module: ' +
        dateProbe.modules.length +
        ' shown=' +
        JSON.stringify((r1.dbg && r1.dbg.rows && r1.dbg.rows.date && r1.dbg.rows.date.shown) || '')
    );
    for (const mod of dateProbe.modules) {
      console.log('    [' + mod.index + '] "' + mod.char + '" maxLum=' + mod.maxLum);
    }
  }
  if (!dateProbe.ok) {
    for (const e of dateProbe.errors) console.log('  - ' + e);
  }
  console.log('');

  // (h) auch für 1366x768
  console.log('Datumszeile-Pixelprüfung render-1366.png …');
  const dateProbe2 = probeDateLine('render-1366.png', r2.dbg);
  if (dateProbe2.modules) {
    console.log('  geprüfte Module: ' + dateProbe2.modules.length);
    for (const mod of dateProbe2.modules) {
      console.log('    [' + mod.index + '] "' + mod.char + '" maxLum=' + mod.maxLum);
    }
  }
  if (!dateProbe2.ok) {
    for (const e of dateProbe2.errors) console.log('  - ' + e);
  }
  console.log('');

  const shotsOk =
    fileExists(path.join(shotsDir, 'render-1920.png')) &&
    fileExists(path.join(shotsDir, 'render-1366.png')) &&
    fileExists(path.join(shotsDir, 'render-1920-flip.png')) &&
    fileExists(path.join(shotsDir, 'render-1920-saver.png'));
  console.log(
    'Screenshots: render-1920.png=' +
      fileExists(path.join(shotsDir, 'render-1920.png')) +
      ' render-1366.png=' +
      fileExists(path.join(shotsDir, 'render-1366.png')) +
      ' render-1920-flip.png=' +
      fileExists(path.join(shotsDir, 'render-1920-flip.png')) +
      ' render-1920-saver.png=' +
      fileExists(path.join(shotsDir, 'render-1920-saver.png'))
  );

  const allOk =
    results.every((r) => r.ok) &&
    shotsOk &&
    bright.ok &&
    dateProbe.ok &&
    dateProbe2.ok;
  console.log(allOk ? 'GESAMT: bestanden' : 'GESAMT: NICHT BESTANDEN');
  process.exit(allOk ? 0 : 1);
}

main();
