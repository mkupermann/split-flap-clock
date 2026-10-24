/**
 * render3d.js — WebGL-Fallblattanzeige (Three.js), klassisches Script.
 * Reine Funktionen (flipAngle, layoutRows, createModulePlan, glyphBaselineY)
 * laufen ohne THREE/DOM in Node. DOM/WebGL-Code ausschließlich in FlapRenderer.init.
 *
 * Korrekturrunde 2: Timer/Stoppuhr als untere Gruppe bündig zur Uhrzeit,
 * Doppelpunkte mittig in der Lücke, gemeinsame Glyphen-Baseline für Umlaute,
 * Labels TIMER/STOPPUHR/DÜSSELDORF, Pfeil- und Action-Tasten an den Anzeigen.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Konstanten
  // ---------------------------------------------------------------------------

  /** Kontroll-Namen für onControl (Pflicht-Schnittstelle). */
  var CONTROL_NAMES = [
    'timerHourUp',
    'timerHourDown',
    'timerMinUp',
    'timerMinDown',
    'timerStartPause',
    'timerReset',
    'swStartPause',
    'swReset',
  ];

  /** Zeichensatz für kleine Zeilen (identisch zu app.js CHARSET). */
  var CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789°%/.:-';
  /** Ziffern + Leerzeichen für große Uhr-/Timer-/Stoppuhr-Module. */
  var DIGITS = '0123456789';

  /** Standard-Layout-Zeilen (id, length, charset, scale). */
  var DEFAULT_LAYOUT = [
    { id: 'time', length: 4, charset: DIGITS, scale: 1.0 },
    { id: 'date', length: 14, charset: CHARSET, scale: 0.22 },
    { id: 'weather', length: 27, charset: CHARSET, scale: 0.2 },
    { id: 'signal', length: 24, charset: CHARSET, scale: 0.2 },
    { id: 'whatsapp', length: 24, charset: CHARSET, scale: 0.2 },
    { id: 'timer', length: 6, charset: DIGITS, scale: 0.22 },
    { id: 'stopwatch', length: 6, charset: DIGITS, scale: 0.22 },
  ];

  /** Modul-Breite zu Höhe (Solari-Blatt). */
  var MODULE_ASPECT = 0.7;

  /** Abstand zwischen Modulen (Vielfaches der Modulhöhe). */
  var MODULE_GAP = 0.055;

  /** Dicke des Fallblatts als Anteil der Modulhöhe (≈ 1,2 %). */
  var THICKNESS_RATIO = 0.012;

  /** Eckenradius als Anteil der Modulhöhe. */
  var CORNER_RATIO = 0.09;

  /** Anzahl Stapelkanten je Hälfte (oben und unten). */
  var STACK_EDGE_COUNT = 4;

  /** Versatz der Stapelkanten als Anteil der Modulhöhe (≈ 0,6 %). */
  var STACK_OFFSET_RATIO = 0.006;

  /** Tiefe des Modulfensters (Rahmen) als Anteil der Modulhöhe (≈ 8 %). */
  var FRAME_DEPTH_RATIO = 0.08;

  /**
   * Überstand des Modulrahmens über die Modulkante je Seite
   * (Rahmen außen 1,08 = 1 + 2 × FRAME_OVERHANG).
   */
  var FRAME_OVERHANG = 0.04;

  /** Flip-Dauer Uhrzeit-Module in ms. */
  var FLIP_MS_BIG = 340;

  /** Flip-Dauer übrige Zeilen in ms. */
  var FLIP_MS_SMALL = 220;

  /** Verkürzungsfaktor bei mehr als 8 anstehenden Schritten. */
  var FLIP_STEP_FAST = 0.6;

  /** Ab wie vielen anstehenden Schritten verkürzt wird. */
  var FLIP_STEP_FAST_MIN = 8;

  /** Kamera-Neigung nach unten in Grad (Blickwinkel 4–6°). */
  var CAMERA_TILT_DEG = 5;

  /** Shadow-Map-Kante ab dieser Viewport-Breite. */
  var SHADOW_MAP_BIG = 4096;
  var SHADOW_MAP_SMALL = 2048;
  var SHADOW_MAP_BREAKPOINT = 1600;

  /** Höhe der Uhrzeit-Zeile (normiert 0..1). */
  var TIME_ROW_H = 0.42;

  /** Anteil der Zellhöhe, den die Glyphe optisch füllt (80–85 %). */
  var GLYPH_FILL = 0.82;

  /** Vertikaler Spalt zwischen den Modulhälften (Anteil Modulhöhe, ~1 %). */
  var AXIS_GAP = 0.01;

  /** Höhe der 3D-Tastenreihe unter Timer/Stoppuhr (normiert 0..1). */
  var BUTTON_BAND_H = 0.085;

  /** Horizontaler Abstand zwischen Timer- und Stoppuhr-Zeile (normiert). */
  var PAIR_GAP = 0.03;

  /** Höhe der Labels TIMER/STOPPUHR (normiert). */
  var LABEL_H = 0.022;

  /** Höhe der Stadt-Labels DÜSSELDORF (normiert, mind. so hoch wie LABEL_H). */
  var CITY_LABEL_H = 0.022;

  /** Höhe der Pfeil-Tasten ▲/▼ (normiert). */
  var ARROW_H = 0.036;

  /** Höhe der START/PAUSE- und RESET-Tasten (normiert). */
  var ACTION_H = 0.042;

  /** Unterkante Tasten zum Bildrand (normiert, 3,5 %). */
  var BOTTOM_MARGIN = 0.035;

  /** Mindestanteil zwischen WhatsApp-Zeile und der Timer/Stopwatch-Gruppe. */
  var MIN_GAP_BOTTOM_GROUP = 0.03;

  /** Vertikaler Kleinstabstand innerhalb der unteren Gruppe. */
  var SMALL_GAP = 0.01;

  /**
   * Breite des Doppelpunkt-Slots als Anteil der Modulbreite.
   * Minimal: Lückenbreite ≥ 2 × Punktbreite (Punktbreite + beidseitig Luft ≥ 1 Punktbreite).
   */
  var COLON_W_RATIO = 0.18;

  /** Kantenlänge eines Doppelpunkt-Punkts als Anteil der Modulhöhe. */
  var COLON_DOT_RATIO = 0.09;

  /** Abstand der Punktmitten von der Scharnierachse als Anteil der Modulhöhe. */
  var COLON_DOT_OFF_RATIO = 0.18;

  /** Zentrierung der Zeile time/timer/stopwatch auf Modulebene. */
  function colonCountFor(id) {
    if (id === 'time') return 1;
    if (id === 'timer' || id === 'stopwatch') return 2;
    return 0;
  }

  /**
   * glyphBaselineY(ch, cell, capMetrics) -> Baseline-y von der Zelloberkante.
   * Gemeinsame Grundlinie für ALLE Zeichen: Zentrierung über die Versalhöhe
   * "H" (capMetrics.actualBoundingBox*), NICHT pro Glyphe über dessen
   * actualBoundingBox. Dadurch liegen Ä/Ö/Ü-Punkte oberhalb der Versalhöhe
   * und werden nicht durch die größere Box nach unten verschoben.
   * Der Parameter ch wird ignoriert — O und Ö liefern denselben Wert.
   */
  function glyphBaselineY(ch, cell, capMetrics) {
    void ch;
    var asc = capMetrics && capMetrics.ascent > 0 ? capMetrics.ascent : 0;
    var desc = capMetrics && capMetrics.descent >= 0 ? capMetrics.descent : 0;
    var capH = asc + desc;
    if (!(capH > 0)) return cell / 2;
    // Cap-Höhe optisch in der Zelle zentriert
    return cell / 2 + (asc - desc) / 2;
  }

  /** Maximales Überschwingen von flipAngle in Radiant. */
  var FLIP_OVERSHOOT = 0.06;

  /**
   * labelTextureSize(labelWidthPx, dpr) -> Texturbreite in Pixeln.
   * Mindestens labelWidthPx (kein Hochskalieren), skaliert mit devicePixelRatio.
   */
  function labelTextureSize(labelWidthPx, dpr) {
    var w = Number(labelWidthPx);
    if (!isFinite(w) || w < 1) w = 1;
    var r = Number(dpr);
    if (!isFinite(r) || r < 1) r = 1;
    return Math.ceil(w * r);
  }

  /** Zeitpunkt des Aufpralls als Anteil der Flip-Dauer. */
  var FLIP_IMPACT = 0.82;

  /** Timeout für document.fonts.load in ms. */
  var FONT_TIMEOUT_MS = 3000;

  // ---------------------------------------------------------------------------
  // Pure Funktionen
  // ---------------------------------------------------------------------------

  /**
   * flipAngle(tMs, durationMs) -> Winkel in Radiant (0 .. Math.PI).
   * Beschleunigter Fall (ease-in, Schwerkraft) bis zum Aufprall, danach
   * kurzes Nachfedern (Überschwingen max. FLIP_OVERSHOOT, Endwert exakt Math.PI).
   */
  function flipAngle(tMs, durationMs) {
    var d = Number(durationMs);
    var t = Number(tMs);
    if (!isFinite(t) || t <= 0) return 0;
    if (!isFinite(d) || d <= 0) return Math.PI;
    if (t >= d) return Math.PI;
    var p = t / d;
    if (p <= FLIP_IMPACT) {
      // ease-in (Schwerkraft): Winkel ~ t²
      var u = p / FLIP_IMPACT;
      return Math.PI * u * u;
    }
    // Nachfedern: PI + OVERSHOOT * sin(PI * q), q in (0,1)
    var q = (p - FLIP_IMPACT) / (1 - FLIP_IMPACT);
    return Math.PI + FLIP_OVERSHOOT * Math.sin(Math.PI * q);
  }

  /**
   * flipDurationFor(baseMs, rnd) -> Dauer in ms: baseMs * (0.9 + 0.2*rnd).
   * Immer vom festen Basiswert berechnet — kein Drift über mehrere Starts.
   * rnd = 0 → 0.9 × base, rnd = 1 → 1.1 × base (±10 %).
   */
  function flipDurationFor(baseMs, rnd) {
    var b = Number(baseMs);
    var r = Number(rnd);
    if (!isFinite(b) || b < 0) b = 0;
    if (!isFinite(r)) r = 0.5;
    // Ganze Millisekunden, damit flipDurationFor(340,1) === 374 exakt gilt.
    return Math.round(b * (0.9 + 0.2 * r));
  }

  /**
   * stepDurationFor(baseMs, remainingSteps, rnd) -> Dauer eines Schritts.
   * Bei mehr als FLIP_STEP_FAST_MIN anstehenden Schritten wird pro Schritt
   * auf FLIP_STEP_FAST × Basis verkürzt, damit eine Zeile spätestens nach
   * ~8 s steht.
   */
  function stepDurationFor(baseMs, remainingSteps, rnd) {
    var base = Number(baseMs);
    if (!isFinite(base) || base < 0) base = 0;
    if (remainingSteps > FLIP_STEP_FAST_MIN) base = base * FLIP_STEP_FAST;
    return flipDurationFor(base, rnd);
  }

  /**
   * shadowMapSizeFor(viewportW) -> Shadow-Map-Kante.
   * 4096 bei Viewport-Breite ≥ 1600, sonst 2048.
   */
  function shadowMapSizeFor(viewportW) {
    var w = Number(viewportW);
    if (!isFinite(w) || w < SHADOW_MAP_BREAKPOINT) return SHADOW_MAP_SMALL;
    return SHADOW_MAP_BIG;
  }

  /**
   * sceneSpec() -> Geometrie-Spezifikation der Szene (für Tests/Debug-JSON).
   */
  function sceneSpec() {
    return {
      leafThicknessRatio: THICKNESS_RATIO,
      stackEdgeCountTop: STACK_EDGE_COUNT,
      stackEdgeCountBottom: STACK_EDGE_COUNT,
      stackEdgeCount: STACK_EDGE_COUNT * 2,
      stackOffsetRatio: STACK_OFFSET_RATIO,
      frameDepthRatio: FRAME_DEPTH_RATIO,
      hasFrame: true,
      frameBevel: true,
      cameraTiltDeg: CAMERA_TILT_DEG,
      flipMsBig: FLIP_MS_BIG,
      flipMsSmall: FLIP_MS_SMALL,
    };
  }

  /**
   * playImpactClack(mod, tMs, durationMs, soundApi) -> true wenn Klack ausgelöst.
   * Löst FlapSound.clack(kind) genau einmal aus, wenn der Fortschritt
   * FLIP_IMPACT erreicht (Aufschlag), nicht beim Losfallen.
   * Sekunden-Module bleiben stumm (kind='second' → sound.js ignoriert).
   */
  function playImpactClack(mod, tMs, durationMs, soundApi) {
    if (!mod) return false;
    if (mod._impactFired) return false;
    var d = Number(durationMs);
    var t = Number(tMs);
    if (!isFinite(d) || d <= 0) return false;
    if (!isFinite(t) || t < 0) return false;
    if (t / d < FLIP_IMPACT) return false;
    mod._impactFired = true;
    if (soundApi && typeof soundApi.clack === 'function') {
      soundApi.clack(moduleSoundKind(mod.rowId, mod.index));
    }
    return true;
  }

  /**
   * Breite einer Zeile (normiert 0..1 der Viewport-Breite) bei gegebener
   * normierter Zeilenhöhe (Anteil der Viewport-Höhe).
   */
  function rowWidthNorm(row, heightNorm, aspect) {
    if (!(aspect > 0)) aspect = 1;
    var mw = (MODULE_ASPECT * heightNorm) / aspect;
    var gap = (MODULE_GAP * heightNorm) / aspect;
    var len = Math.max(0, row.length | 0);
    var w = 0;
    if (len > 0) w = len * mw + (len - 1) * gap;
    w += colonCountFor(row.id) * mw * COLON_W_RATIO;
    return w;
  }

  /** Maximale Zeilenhöhe (normiert), damit die Zeile in usableW passt. */
  function maxHeightForWidth(row, usableW, aspect) {
    var len = Math.max(1, row.length | 0);
    var colons = colonCountFor(row.id);
    var denom = MODULE_ASPECT * len + MODULE_GAP * (len - 1) + colons * MODULE_ASPECT * COLON_W_RATIO;
    if (denom <= 0) return 1;
    return (usableW * aspect) / denom;
  }

  /**
   * createModulePlan(char, target, charset, opts) -> Modulplan.
   * opts.first: erster setText (Seitenstart) → sofort, keine Sequenz.
   * opts.running / opts.flipTo: Retarget während laufendem Flip.
   * opts.isTime: Uhrzeit ohne Startverzögerung.
   * Rückgabe: { instant, char, seq, delay }
   *   instant=true: char sofort setzen, seq ist leer (keine Animation).
   *   instant=false: seq abarbeiten; delay ist Startverzögerung in ms
   *   (0 oder 1 als Marker; der konkrete Zufallswert wird im Renderer gezogen).
   */
  function createModulePlan(char, target, charset, opts) {
    var o = opts || {};
    var cs = typeof charset === 'string' && charset.length > 0 ? charset : ' 0123456789';
    var t = typeof target === 'string' && target.length > 0 ? target.charAt(0) : ' ';
    var cur = typeof char === 'string' && char.length > 0 ? char.charAt(0) : ' ';

    if (o.first) {
      return { instant: true, char: t, seq: [], delay: 0 };
    }

    if (o.running) {
      var from = typeof o.flipTo === 'string' && o.flipTo.length > 0 ? o.flipTo.charAt(0) : cur;
      var seqR = flapSequence(from, t, cs);
      return { instant: false, char: cur, seq: seqR, delay: 0 };
    }

    if (cur === t) {
      return { instant: true, char: t, seq: [], delay: 0 };
    }

    var seq = flapSequence(cur, t, cs);
    if (seq.length === 0) {
      // unbekanntes Zeichen o.ä. → sofort setzen
      return { instant: true, char: t, seq: [], delay: 0 };
    }

    return {
      instant: false,
      char: cur,
      seq: seq,
      delay: o.isTime ? 0 : 1,
    };
  }

  /**
   * layoutRowsScreensaver — Layout ohne Timer/Stoppuhr, Labels, Tasten, Hinweis.
   * Inhalt (Zeit, Datum, DÜSSELDORF, Wetter, Signal, WhatsApp) vertikal
   * zentriert; Uhrzeit wächst bis zur Breitengrenze; Abstände nach
   * FRAME_OVERHANG-Regel (gap ≥ FRAME_OVERHANG×(h1+h2)+0,006,
   * padY ≥ FRAME_OVERHANG×h+0,015) wie im Normalmodus.
   */
  function layoutRowsScreensaver(W, H, src, aspect) {
    var padX = 0.03;
    var gapH = 0.012;
    var cityGap = 0.004;
    var maxW = 1 - 2 * padX;

    var n = src.length;
    var i;
    var idxOf = {};
    for (i = 0; i < n; i++) idxOf[src[i].id] = i;
    var timeIdx = idxOf.time != null ? idxOf.time : 0;
    var weatherIdx = idxOf.weather != null ? idxOf.weather : -1;

    // Nur Zeilen ohne timer/stopwatch
    var visIdx = [];
    for (i = 0; i < n; i++) {
      var id = src[i].id;
      if (id === 'timer' || id === 'stopwatch') continue;
      visIdx.push(i);
    }

    // Zeit-Zeile: wächst bis zur Breitengrenze
    var timeH = TIME_ROW_H;
    var timeHMax = maxHeightForWidth(src[timeIdx], maxW, aspect);
    if (timeHMax > timeH) timeH = timeHMax;
    if (timeH < 0.4) timeH = 0.4;
    var timeW = rowWidthNorm(src[timeIdx], timeH, aspect);
    if (timeW > maxW) {
      timeH = maxHeightForWidth(src[timeIdx], maxW, aspect);
      if (timeH < 0.4) timeH = 0.4;
      timeW = rowWidthNorm(src[timeIdx], timeH, aspect);
      if (timeW > maxW) timeW = maxW;
    }

    // Textzeilen (ohne Zeit, ohne timer/stopwatch)
    var textIdx = [];
    for (i = 0; i < visIdx.length; i++) {
      if (visIdx[i] === timeIdx) continue;
      textIdx.push(visIdx[i]);
    }

    var cityLabelH = CITY_LABEL_H;

    function minRowGap(h1, h2) {
      return FRAME_OVERHANG * (h1 + h2) + 0.006;
    }
    function rowGap(h1, h2) {
      return Math.max(gapH, minRowGap(h1, h2));
    }

    // Mindest-Rand oben/unten (Rahmen-Überstand)
    var padY = FRAME_OVERHANG * timeH + 0.015;

    var heights = [];
    for (i = 0; i < n; i++) heights[i] = 0;
    heights[timeIdx] = timeH;

    var gapAfterTime = rowGap(timeH, 0.06);
    var textGaps = [];
    for (i = 0; i < textIdx.length; i++) textGaps[i] = gapH;

    function applyTextHeights(topFixed) {
      var gaps = 0;
      for (i = 0; i + 1 < textIdx.length; i++) gaps += textGaps[i];
      if (weatherIdx >= 0) gaps += cityLabelH + cityGap;
      var avail = 1 - padY - topFixed - gaps;
      if (avail < 0) avail = 0;

      var sumScale = 0;
      for (i = 0; i < textIdx.length; i++) {
        var s = Number(src[textIdx[i]].scale);
        if (!isFinite(s) || s <= 0) s = 0.2;
        sumScale += s;
      }
      if (sumScale <= 0) sumScale = 1;

      for (i = 0; i < textIdx.length; i++) {
        var si = textIdx[i];
        var sc2 = Number(src[si].scale);
        if (!isFinite(sc2) || sc2 <= 0) sc2 = 0.2;
        heights[si] = (avail * sc2) / sumScale;
        var hMax = maxHeightForWidth(src[si], maxW, aspect);
        if (heights[si] > hMax) heights[si] = hMax;
      }
    }

    for (var iter = 0; iter < 3; iter++) {
      applyTextHeights(padY + timeH + gapAfterTime);
      gapAfterTime = rowGap(timeH, textIdx.length > 0 ? heights[textIdx[0]] : 0.06);
      for (i = 0; i + 1 < textIdx.length; i++) {
        textGaps[i] = rowGap(heights[textIdx[i]], heights[textIdx[i + 1]]);
      }
    }
    gapAfterTime = rowGap(timeH, textIdx.length > 0 ? heights[textIdx[0]] : 0.06);
    for (i = 0; i + 1 < textIdx.length; i++) {
      textGaps[i] = rowGap(heights[textIdx[i]], heights[textIdx[i + 1]]);
    }

    // Content-Höhe für vertikale Zentrierung
    var contentH = timeH + gapAfterTime;
    if (weatherIdx >= 0) contentH += cityLabelH + cityGap;
    for (i = 0; i < textIdx.length; i++) {
      contentH += heights[textIdx[i]];
      if (i + 1 < textIdx.length) contentH += textGaps[i];
    }

    var startY = (1 - contentH) / 2;
    if (startY < padY) startY = padY;

    // Boxen aufbauen (ohne Timer/Stoppuhr/Tasten/Hinweis)
    var out = [];

    var timeLeft = (1 - timeW) / 2;
    out.push(
      makeRowLayout(
        src[timeIdx],
        timeH,
        timeW,
        timeLeft,
        startY,
        startY + timeH,
        startY + timeH / 2,
        aspect
      )
    );

    var textY = startY + timeH + gapAfterTime;
    for (var ti = 0; ti < textIdx.length; ti++) {
      var ii = textIdx[ti];
      if (weatherIdx >= 0 && ii === weatherIdx) {
        var clW = Math.min(maxW, 0.18);
        var clLeft = (1 - clW) / 2;
        out.cityLabel = {
          left: clLeft,
          top: textY,
          right: clLeft + clW,
          bottom: textY + cityLabelH,
        };
        textY += cityLabelH + cityGap;
      }
      var tw = rowWidthNorm(src[ii], heights[ii], aspect);
      if (tw > maxW) tw = maxW;
      var tleft = (1 - tw) / 2;
      out.push(
        makeRowLayout(
          src[ii],
          heights[ii],
          tw,
          tleft,
          textY,
          textY + heights[ii],
          textY + heights[ii] / 2,
          aspect
        )
      );
      textY += heights[ii] + (ti + 1 < textIdx.length ? textGaps[ti] : 0);
    }

    return out;
  }

  /**
   * layoutRows(viewportW, viewportH, rows, options) -> Array von Zeilen-Layouts.
   * Jede Zeile: { id, length, charset, x, y, w, h, cx, cy, width, height,
   *              moduleW, moduleH, gap, moduleCenters, colonCenters,
   *              box: { left, top, right, bottom } }
   * box in normierten Koordinaten 0..1 (Ursprung oben links).
   *
   * Zusätzliche Eigenschaften des Arrays:
   *   buttonBox        — Band der START/RESET-Tasten (unterste Box)
   *   timerLabel, stopwatchLabel, cityLabel — Label-Boxen
   *   buttons          — Boxen je Taste (timerHourUp, …, swReset)
   *
   * Aufbau (unten): Labels TIMER/STOPPUHR, ▲-Tasten über Stunden- und
   * Minuten-Paar, Anzeige HH:MM:SS, ▼-Tasten unter den Paaren,
   * START/PAUSE + RESET unter der Anzeige. Timer links bündig zur linken
   * Kante der Uhrzeit, Stoppuhr rechts bündig zur rechten Kante.
   *
   * options.screensaver (boolean): true → kein Timer/Stoppuhr, keine
   * Labels TIMER/STOPPUHR, keine Tasten, kein Tastaturhinweis. Inhalt
   * (Zeit, Datum, DÜSSELDORF, Wetter, Signal, WhatsApp) vertikal
   * zentriert, Uhrzeit bis zur Breitengrenze vergrößert, Abstände nach
   * FRAME_OVERHANG-Regel wie im Normalmodus.
   */
  function layoutRows(viewportW, viewportH, rows, options) {
    var W = Number(viewportW);
    var H = Number(viewportH);
    if (!isFinite(W) || W <= 0) W = 1920;
    if (!isFinite(H) || H <= 0) H = 1080;
    var aspect = W / H;

    var src = Array.isArray(rows) && rows.length > 0 ? rows : DEFAULT_LAYOUT;
    var n = src.length;

    if (options && options.screensaver) {
      return layoutRowsScreensaver(W, H, src, aspect);
    }

    var padX = 0.03;
    var gapH = 0.012;
    var cityGap = 0.004;

    // Zeilen-Indizes
    var i;
    var idxOf = {};
    for (i = 0; i < n; i++) idxOf[src[i].id] = i;
    var timeIdx = idxOf.time != null ? idxOf.time : 0;
    var timerIdx = idxOf.timer != null ? idxOf.timer : -1;
    var swIdx = idxOf.stopwatch != null ? idxOf.stopwatch : -1;
    var hasPair = timerIdx >= 0 && swIdx >= 0;

    // ---- Zeit-Zeile ----
    var timeH = TIME_ROW_H;
    var timeW = rowWidthNorm(src[timeIdx], timeH, aspect);
    var maxW = 1 - 2 * padX;
    if (timeW > maxW) {
      timeH = maxHeightForWidth(src[timeIdx], maxW, aspect);
      if (timeH < 0.4) timeH = 0.4;
      timeW = rowWidthNorm(src[timeIdx], timeH, aspect);
    }
    if (timeH < 0.4) timeH = 0.4;

    // Oberer Rand: Platz für Rahmen-Überstand + Kameraneigung
    var padY = FRAME_OVERHANG * timeH + 0.015;

    // ---- Timer/Stoppuhr-Display: gleiche Modulgröße, bündig zur Zeit ----
    var dispH = 0;
    if (hasPair) {
      // Breiten-Denominator für 6 Module + 2 Doppelpunkte
      var denomDisp =
        MODULE_ASPECT * 6 + MODULE_GAP * 5 + 2 * COLON_W_RATIO * MODULE_ASPECT;
      // Ziel: große freie Lücke zwischen Timer und Stoppuhr
      var targetDispW = timeW * 0.4;
      dispH = (targetDispW * aspect) / denomDisp;
      if (dispH < 0.05) dispH = 0.05;
      if (dispH > 0.12) dispH = 0.12;
    }

    // ---- Untere Gruppe von unten nach oben ----
    var actionBottom = 1 - BOTTOM_MARGIN;
    var actionTop = actionBottom - ACTION_H;
    var arrowDownBottom = actionTop - SMALL_GAP;
    var arrowDownTop = arrowDownBottom - ARROW_H;
    var dispBottom = arrowDownTop - SMALL_GAP;
    var dispTop = dispBottom - (dispH > 0 ? dispH : 0.07);
    var arrowUpBottom = dispTop - SMALL_GAP;
    var arrowUpTop = arrowUpBottom - ARROW_H;
    var labelBottom = arrowUpTop - SMALL_GAP;
    var labelTop = labelBottom - LABEL_H;
    var bottomGroupTop = labelTop;
    var waLimit = bottomGroupTop - MIN_GAP_BOTTOM_GROUP;

    // ---- Obere Zeilen von oben nach unten ----
    var heights = [];
    for (i = 0; i < n; i++) {
      if (i === timeIdx) {
        heights[i] = timeH;
      } else if (hasPair && (i === timerIdx || i === swIdx)) {
        heights[i] = dispH > 0 ? dispH : 0.07;
      } else {
        var sc = Number(src[i].scale);
        if (!isFinite(sc) || sc <= 0) sc = 0.2;
        heights[i] = sc * 0.12;
      }
    }

    // Stadt-Label über der Wetterzeile
    var cityLabelH = CITY_LABEL_H;
    var weatherIdx = idxOf.weather != null ? idxOf.weather : -1;

    // Vertikaler Platz für die Textzeilen (date, weather, signal, whatsapp)
    var textIdx = [];
    for (i = 0; i < n; i++) {
      if (i === timeIdx) continue;
      if (hasPair && (i === timerIdx || i === swIdx)) continue;
      textIdx.push(i);
    }

    // Mindest-Abstand zwischen zwei Zeilen: Rahmen-Überstand beider + 0,006
    function minRowGap(h1, h2) {
      return FRAME_OVERHANG * (h1 + h2) + 0.006;
    }
    function rowGap(h1, h2) {
      return Math.max(gapH, minRowGap(h1, h2));
    }

    // Iterativ: Abstände hängen von den Text-Höhen ab und umgekehrt.
    // Danach letzter Durchlauf mit den fertigen Abständen, damit der
    // tatsächliche Abstand exakt rowGap(timeH, dateH) ist.
    var gapAfterTime = rowGap(timeH, 0.06);
    var textGaps = [];
    for (i = 0; i < textIdx.length; i++) textGaps[i] = gapH;

    function applyTextHeights(topFixed) {
      var gaps = 0;
      for (i = 0; i + 1 < textIdx.length; i++) gaps += textGaps[i];
      if (weatherIdx >= 0) gaps += cityLabelH + cityGap;
      var avail = waLimit - topFixed - gaps;
      if (avail < 0) avail = 0;

      var sumScale = 0;
      for (i = 0; i < textIdx.length; i++) {
        var s = Number(src[textIdx[i]].scale);
        if (!isFinite(s) || s <= 0) s = 0.2;
        sumScale += s;
      }
      if (sumScale <= 0) sumScale = 1;

      for (i = 0; i < textIdx.length; i++) {
        var si = textIdx[i];
        var sc2 = Number(src[si].scale);
        if (!isFinite(sc2) || sc2 <= 0) sc2 = 0.2;
        heights[si] = (avail * sc2) / sumScale;
        // Breiten-Skalierung
        var hMax = maxHeightForWidth(src[si], maxW, aspect);
        if (heights[si] > hMax) heights[si] = hMax;
      }
    }

    for (var iter = 0; iter < 3; iter++) {
      applyTextHeights(padY + timeH + gapAfterTime);
      gapAfterTime = rowGap(
        timeH,
        textIdx.length > 0 ? heights[textIdx[0]] : 0.06
      );
      for (i = 0; i + 1 < textIdx.length; i++) {
        textGaps[i] = rowGap(heights[textIdx[i]], heights[textIdx[i + 1]]);
      }
    }
    // Abstand aus den finalen Höhen; Platzierung nutzt genau diesen Wert
    gapAfterTime = rowGap(
      timeH,
      textIdx.length > 0 ? heights[textIdx[0]] : 0.06
    );
    for (i = 0; i + 1 < textIdx.length; i++) {
      textGaps[i] = rowGap(heights[textIdx[i]], heights[textIdx[i + 1]]);
    }
    var topFixed = padY + timeH + gapAfterTime;

    // ---- Boxen aufbauen ----
    var out = [];

    function pushBox(b) {
      return b;
    }

    // Zeit
    var timeLeft = (1 - timeW) / 2;
    out[timeIdx] = makeRowLayout(
      src[timeIdx],
      timeH,
      timeW,
      timeLeft,
      padY,
      padY + timeH,
      padY + timeH / 2,
      aspect
    );
    pushBox(out[timeIdx].box);

    // Textzeilen (zentriert), Stadt-Label über weather
    var textY = topFixed;
    for (var ti = 0; ti < textIdx.length; ti++) {
      var ii = textIdx[ti];
      if (weatherIdx >= 0 && ii === weatherIdx) {
        // Stadt-Label
        var clW = Math.min(maxW, 0.18);
        var clLeft = (1 - clW) / 2;
        var cityLabel = {
          left: clLeft,
          top: textY,
          right: clLeft + clW,
          bottom: textY + cityLabelH,
        };
        out.cityLabel = pushBox(cityLabel);
        textY += cityLabelH + cityGap;
      }
      var tw = rowWidthNorm(src[ii], heights[ii], aspect);
      if (tw > maxW) tw = maxW;
      var tleft = (1 - tw) / 2;
      out[ii] = makeRowLayout(
        src[ii],
        heights[ii],
        tw,
        tleft,
        textY,
        textY + heights[ii],
        textY + heights[ii] / 2,
        aspect
      );
      pushBox(out[ii].box);
      textY += heights[ii] + (ti + 1 < textIdx.length ? textGaps[ti] : gapH);
    }

    // ---- Timer + Stoppuhr ----
    if (hasPair) {
      var dH = heights[timerIdx];
      var dW = rowWidthNorm(src[timerIdx], dH, aspect);
      // Timer links bündig mit time, Stoppuhr rechts bündig mit time
      var tLeft = out[timeIdx].box.left;
      var sRight = out[timeIdx].box.right;
      // freie Lücke in der Mitte
      if (2 * dW > sRight - tLeft) {
        dW = (sRight - tLeft) / 2;
        // Höhe an Breite anpassen
        var denomD =
          MODULE_ASPECT * 6 + MODULE_GAP * 5 + 2 * COLON_W_RATIO * MODULE_ASPECT;
        dH = (dW * aspect) / denomD;
        heights[timerIdx] = dH;
        heights[swIdx] = dH;
        dispTop = dispBottom - dH;
        arrowUpBottom = dispTop - SMALL_GAP;
        arrowUpTop = arrowUpBottom - ARROW_H;
        labelBottom = arrowUpTop - SMALL_GAP;
        labelTop = labelBottom - LABEL_H;
        bottomGroupTop = labelTop;
      }
      var sLeft = sRight - dW;

      out[timerIdx] = makeRowLayout(
        src[timerIdx],
        dH,
        dW,
        tLeft,
        dispTop,
        dispBottom,
        (dispTop + dispBottom) / 2,
        aspect
      );
      pushBox(out[timerIdx].box);

      out[swIdx] = makeRowLayout(
        src[swIdx],
        dH,
        dW,
        sLeft,
        dispTop,
        dispBottom,
        (dispTop + dispBottom) / 2,
        aspect
      );
      pushBox(out[swIdx].box);

      // Labels TIMER / STOPPUHR
      var lblW = Math.min(dW * 0.7, 0.16);
      out.timerLabel = pushBox({
        left: out[timerIdx].cx - lblW / 2,
        top: labelTop,
        right: out[timerIdx].cx + lblW / 2,
        bottom: labelBottom,
      });
      out.stopwatchLabel = pushBox({
        left: out[swIdx].cx - lblW / 2,
        top: labelTop,
        right: out[swIdx].cx + lblW / 2,
        bottom: labelBottom,
      });

      // ---- Tasten ----
      var buttons = {};
      var tMod = out[timerIdx];
      // Paare: Stunden = Module 0+1, Minuten = Module 2+3
      var pairW = 2 * tMod.moduleW + tMod.gap;
      var arrowW = pairW * 0.6;
      var hourCx = (tMod.moduleCenters[0] + tMod.moduleCenters[1]) / 2;
      var minCx = (tMod.moduleCenters[2] + tMod.moduleCenters[3]) / 2;

      buttons.timerHourUp = pushBox({
        left: hourCx - arrowW / 2,
        top: arrowUpTop,
        right: hourCx + arrowW / 2,
        bottom: arrowUpBottom,
      });
      buttons.timerMinUp = pushBox({
        left: minCx - arrowW / 2,
        top: arrowUpTop,
        right: minCx + arrowW / 2,
        bottom: arrowUpBottom,
      });
      buttons.timerHourDown = pushBox({
        left: hourCx - arrowW / 2,
        top: arrowDownTop,
        right: hourCx + arrowW / 2,
        bottom: arrowDownBottom,
      });
      buttons.timerMinDown = pushBox({
        left: minCx - arrowW / 2,
        top: arrowDownTop,
        right: minCx + arrowW / 2,
        bottom: arrowDownBottom,
      });

      // START/PAUSE + RESET unter der jeweiligen Anzeige
      function actionBoxes(rowLayout, prefix) {
        var rw = rowLayout.box.right - rowLayout.box.left;
        var gapB = rw * 0.06;
        var startW = rw * 0.52;
        var resetW = rw * 0.36;
        var x0 = rowLayout.box.left + (rw - startW - gapB - resetW) / 2;
        buttons[prefix + 'StartPause'] = pushBox({
          left: x0,
          top: actionTop,
          right: x0 + startW,
          bottom: actionBottom,
        });
        buttons[prefix + 'Reset'] = pushBox({
          left: x0 + startW + gapB,
          top: actionTop,
          right: x0 + startW + gapB + resetW,
          bottom: actionBottom,
        });
      }
      actionBoxes(tMod, 'timer');
      actionBoxes(out[swIdx], 'sw');
      out.buttons = buttons;

      // buttonBox = Band der Action-Tasten (unterste Box, für Alt-Tests)
      out.buttonBox = {
        left: Math.min(buttons.timerStartPause.left, buttons.swStartPause.left),
        top: actionTop,
        right: Math.max(buttons.timerReset.right, buttons.swReset.right),
        bottom: actionBottom,
      };
    } else {
      // Fallback ohne Timer/Stoppuhr: einfaches Band unten
      var bbTop = 1 - BOTTOM_MARGIN - ACTION_H;
      out.buttonBox = {
        left: padX,
        top: bbTop,
        right: 1 - padX,
        bottom: 1 - BOTTOM_MARGIN,
      };
    }

    // Tastaturhinweis: unter der Tastenreihe im freien Rand (darf keine Box überlappen)
    out.hintBox = makeHintBox(1 - BOTTOM_MARGIN, W, H);

    return out;
  }

  /**
   * makeHintBox(actionBottom, W, H) -> Box des Tastaturhinweises (normiert).
   * Liegt unterhalb der untersten Box im freien Rand, rechtsbündig.
   * Entspricht der CSS-Regel .hint (bottom/right/font-size clamp).
   */
  function makeHintBox(actionBottom, W, H) {
    // CSS: bottom clamp(4px, 1vh, 12px), font-size clamp(9px, 0.9vw, 12px)
    var bottomPx = Math.min(12, Math.max(4, H * 0.01));
    var fontPx = Math.min(12, Math.max(9, W * 0.009));
    var hintH = fontPx * 1.35 / H;
    var hintW = Math.min(0.48, (fontPx * 38) / W);
    var hintBottom = 1 - bottomPx / H;
    var hintTop = hintBottom - hintH;
    var hintRight = 1 - Math.min(28, Math.max(12, W * 0.02)) / W;
    return {
      left: hintRight - hintW,
      top: Math.max(actionBottom + 0.002, hintTop),
      right: hintRight,
      bottom: hintBottom,
    };
  }

  function makeRowLayout(def, h, w, left, top, bottom, cy, aspect) {
    if (!(aspect > 0)) aspect = 1;
    var moduleH = h;
    var moduleW = (MODULE_ASPECT * h) / aspect;
    var gapW = (MODULE_GAP * h) / aspect;
    var len = Math.max(0, def.length | 0);
    var colons = colonCountFor(def.id);
    var colonSlot = COLON_W_RATIO * moduleW;

    // Modul- und Doppelpunkt-Positionen
    var totalW = len * moduleW + (len - 1) * gapW + colons * colonSlot;
    var startX = left + (w - totalW) / 2 + moduleW / 2;
    var moduleCenters = [];
    var colonCenters = [];
    var m;
    for (m = 0; m < len; m++) {
      var mx = startX + m * (moduleW + gapW);
      if (colons === 1 && m >= 2) mx += colonSlot;
      if (colons === 2) {
        if (m >= 2 && m < 4) mx += colonSlot;
        if (m >= 4) mx += 2 * colonSlot;
      }
      moduleCenters.push(mx);
    }
    // Doppelpunkte: exakt mittig in der Lücke zwischen den Modulen
    var colonBoxes = [];
    if (colons >= 1 && len >= 4) {
      // Lücke zwischen Modul 1 und 2 (0-basiert)
      var gapLeft = moduleCenters[1] + moduleW / 2;
      var gapRight = moduleCenters[2] - moduleW / 2;
      var gapMid = (gapLeft + gapRight) / 2;
      colonCenters.push(gapMid);
      colonBoxes.push(makeColonBox(gapLeft, gapRight, gapMid, h, cy, aspect));
    }
    if (colons >= 2 && len >= 6) {
      // Lücke zwischen Modul 3 und 4
      var gapLeft2 = moduleCenters[3] + moduleW / 2;
      var gapRight2 = moduleCenters[4] - moduleW / 2;
      var gapMid2 = (gapLeft2 + gapRight2) / 2;
      colonCenters.push(gapMid2);
      colonBoxes.push(makeColonBox(gapLeft2, gapRight2, gapMid2, h, cy, aspect));
    }

    return {
      id: def.id,
      length: len,
      charset: def.charset,
      x: left,
      y: top,
      w: w,
      h: h,
      cx: left + w / 2,
      cy: cy,
      width: w,
      height: h,
      moduleW: moduleW,
      moduleH: moduleH,
      gap: gapW,
      moduleCenters: moduleCenters,
      colonCenters: colonCenters,
      colonBoxes: colonBoxes,
      box: { left: left, top: top, right: left + w, bottom: bottom },
    };
  }

  /**
   * makeColonBox(gapLeft, gapRight, gapMid, moduleH, cy, aspect) -> Doppelpunkt-Box.
   * Zwei quadratische Punkte: Kantenlänge = COLON_DOT_RATIO × Modulhöhe (in
   * Pixeln quadratisch: w*viewW = h*viewH), Mitten bei cy ± COLON_DOT_OFF_RATIO
   * × Modulhöhe, horizontal in der Lückenmitte.
   */
  function makeColonBox(gapLeft, gapRight, gapMid, moduleH, cy, aspect) {
    if (!(aspect > 0)) aspect = 1;
    var gapWidth = gapRight - gapLeft;
    var boxH = COLON_DOT_RATIO * moduleH;
    // Quadratisch in Pixeln: w_norm * viewW = h_norm * viewH → w_norm = h_norm / aspect
    var boxW = boxH / aspect;
    var off = COLON_DOT_OFF_RATIO * moduleH;
    var dots = [];
    var signs = [-1, 1];
    var i;
    for (i = 0; i < 2; i++) {
      var dcy = cy + signs[i] * off;
      dots.push({
        cx: gapMid,
        cy: dcy,
        w: boxW,
        h: boxH,
        left: gapMid - boxW / 2,
        right: gapMid + boxW / 2,
        top: dcy - boxH / 2,
        bottom: dcy + boxH / 2,
      });
    }
    return {
      cx: gapMid,
      cy: cy,
      w: boxW,
      h: boxH,
      left: gapMid - boxW / 2,
      right: gapMid + boxW / 2,
      top: dots[0].top,
      bottom: dots[1].bottom,
      gapLeft: gapLeft,
      gapRight: gapRight,
      gapMid: gapMid,
      gapWidth: gapWidth,
      dots: dots,
    };
  }

  /** flapSequence äquivalent zu app.js (nur vorwärts, Wrap-around). */
  function flapSequence(from, to, charset) {
    if (typeof from !== 'string' || typeof to !== 'string') return [];
    if (from === to) return [];
    var cs = typeof charset === 'string' && charset.length > 0 ? charset : ' 0123456789';
    var fromIdx = cs.indexOf(from);
    var toIdx = cs.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return [];
    var seq = [];
    var i = fromIdx;
    for (var n = 0; n < cs.length; n++) {
      i = (i + 1) % cs.length;
      seq.push(cs.charAt(i));
      if (i === toIdx) break;
    }
    return seq;
  }

  // ---------------------------------------------------------------------------
  // FlapRenderer (WebGL) — initialisiert erst in init()
  // ---------------------------------------------------------------------------

  var _state = {
    ready: false,
    modulesReady: false,
    canvas: null,
    layout: null,
    rows: null,
    modulesByRow: null,
    onControlCb: null,
    controlsVisible: true,
    screensaver: false,
    cityLabel: 'DÜSSELDORF',
    activity: 0,
    loopRunning: false,
    needRender: true,
    blink: {},
    blinkPhase: 0,
    lastBlinkTs: 0,
    buttons: [],
    hoverButton: null,
    fontLoaded: false,
    debug: false,
    debugEl: null,
    frames: 0,
    atlas: null,
    textQueue: [],
    THREE: null,
    labels: null,
    lastLayout: null,
    freezeFlip: null,
    shadowMapSize: 0,
    cameraTiltDeg: 0,
    keyLight: null,
  };

  function activityStart() {
    _state.activity++;
    scheduleFrame();
  }

  function activityEnd() {
    if (_state.activity > 0) _state.activity--;
  }

  /**
   * Modulaktivität: genau ein Zähler je Modul. true = Modul hat offene
   * Sequenz (pendingStart oder running), false = fertig.
   */
  function setModActive(mod, on) {
    if (!mod) return;
    var v = !!on;
    if (!!mod._active === v) return;
    mod._active = v;
    if (v) activityStart();
    else activityEnd();
  }

  function scheduleFrame() {
    if (_state.loopRunning) return;
    if (_state.activity > 0 || _state.needRender) {
      _state.loopRunning = true;
      requestAnimationFrame(tick);
    }
  }

  function markDirty() {
    _state.needRender = true;
    scheduleFrame();
  }

  // Placeholder — eigentliche tick-Funktion wird unten gesetzt
  var tick = function () {
    _state.loopRunning = false;
  };

  var FlapRenderer = {
    CONTROL_NAMES: CONTROL_NAMES,
    DEFAULT_LAYOUT: DEFAULT_LAYOUT,
    flipAngle: flipAngle,
    layoutRows: layoutRows,
    flapSequence: flapSequence,
    createModulePlan: createModulePlan,
    glyphBaselineY: glyphBaselineY,
    labelTextureSize: labelTextureSize,
    flipDurationFor: flipDurationFor,
    FLIP_MS_BIG: FLIP_MS_BIG,
    FLIP_MS_SMALL: FLIP_MS_SMALL,
    FLIP_IMPACT: FLIP_IMPACT,

    init: function (canvas, layout, options) {
      return initRenderer(canvas, layout, options);
    },

    setText: function (rowId, text) {
      setText(rowId, text);
    },

    setBlink: function (rowId, on) {
      setBlink(rowId, on);
    },

    onControl: function (callback) {
      _state.onControlCb = typeof callback === 'function' ? callback : null;
    },

    setControlsVisible: function (bool) {
      setControlsVisible(!!bool);
    },
  };

  function emitControl(name) {
    if (typeof _state.onControlCb === 'function') {
      _state.onControlCb({ control: name });
    }
  }

  function setText(rowId, text) {
    var s = String(text == null ? '' : text);
    if (!_state.modulesReady || !_state.modulesByRow || !_state.modulesByRow[rowId]) {
      // Vor Fertigstellung puffern (letzter Text je Zeile gewinnt)
      var q = _state.textQueue;
      for (var qi = 0; qi < q.length; qi++) {
        if (q[qi].rowId === rowId) {
          q[qi].text = s;
          return;
        }
      }
      q.push({ rowId: rowId, text: s });
      return;
    }
    var row = _state.modulesByRow[rowId];
    row.targetText = s;
    var charset = row.charset;
    var chars = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (charset.indexOf(c) !== -1) chars.push(c);
    }
    for (var m = 0; m < row.modules.length; m++) {
      var target = m < chars.length ? chars[m] : ' ';
      setModuleTarget(row.modules[m], target);
    }
    markDirty();
  }

  function flushTextQueue() {
    var q = _state.textQueue;
    _state.textQueue = [];
    for (var i = 0; i < q.length; i++) {
      setText(q[i].rowId, q[i].text);
    }
  }

  function setBlink(rowId, on) {
    if (!_state.ready) return;
    var on2 = !!on;
    if (!!_state.blink[rowId] === on2) return;
    _state.blink[rowId] = on2;
    if (on2) {
      _state.blinkPhase = 1;
      _state.lastBlinkTs = 0;
      activityStart();
    } else {
      if (_state.modulesByRow && _state.modulesByRow[rowId]) {
        var mods = _state.modulesByRow[rowId].modules;
        for (var i = 0; i < mods.length; i++) {
          if (mods[i].group) mods[i].group.visible = true;
        }
      }
      activityEnd();
    }
    markDirty();
  }

  function setControlsVisible(bool) {
    _state.controlsVisible = !!bool;
    // Debug/Selbstprüfung: Tasten bleiben sichtbar (Screenshots + DOM-Check)
    if (_state.debug) _state.controlsVisible = true;
    if (!_state.ready) return;
    for (var i = 0; i < _state.buttons.length; i++) {
      _state.buttons[i].group.visible = _state.controlsVisible;
    }
    markDirty();
  }

  /**
   * setModuleTarget — nutzt createModulePlan und setzt den Modulzustand.
   * Erster setText (mod.first) → sofort ohne Sequenz.
   */
  function setModuleTarget(mod, target) {
    if (!mod) return;
    var plan = createModulePlan(mod.char, target, mod.charset, {
      first: !!mod.first,
      running: !!mod.running,
      flipTo: mod.flipTo,
      isTime: !!mod.isTime,
    });
    mod.first = false;

    // Laufende Verzögerung / Sequenz verwerfen, wenn neu geplant
    if (mod.startTimer) {
      clearTimeout(mod.startTimer);
      mod.startTimer = null;
    }
    if (mod.pendingStart) {
      mod.pendingStart = false;
      setModActive(mod, false);
    }

    if (plan.instant) {
      if (mod.running) {
        // laufenden Flip abbrechen und sofort setzen
        mod.running = false;
        mod.flipStartTs = 0;
        mod.seq = [];
        hideLeaf(mod);
        setModActive(mod, false);
      }
      mod.char = plan.char;
      mod.seq = [];
      applyStaticChar(mod, plan.char);
      return;
    }

    if (mod.running) {
      // Retarget: Restsequenz ab dem Flip-Ziel (keine Warteschlange)
      mod.seq = plan.seq.slice();
      // bleibt aktiv
      setModActive(mod, true);
      return;
    }

    mod.seq = plan.seq.slice();
    // Startverzögerung außer bei Uhrzeit
    var delay = plan.delay > 0 ? Math.floor(Math.random() * 120) : 0;
    // Dauer wird in beginFlip aus dem festen Basiswert gezogen (kein Drift)

    if (delay > 0) {
      mod.pendingStart = true;
      setModActive(mod, true);
      mod.startTimer = setTimeout(function () {
        mod.startTimer = null;
        beginFlip(mod);
      }, delay);
    } else {
      beginFlip(mod);
    }
  }

  function hideLeaf(mod) {
    if (mod.leafBody) mod.leafBody.visible = false;
    if (mod.leafFront) mod.leafFront.visible = false;
    if (mod.leafBack) mod.leafBack.visible = false;
    if (mod.pivot) mod.pivot.rotation.x = 0;
  }

  /**
   * applyFreezeFlip — Debug ?freezeFlip=<0..1>:
   * Alle Module der Uhrzeit-Zeile zeigen dauerhaft einen Flip im
   * angegebenen Fortschritt (für Screenshots).
   */
  function applyFreezeFlip() {
    if (_state.freezeFlip == null) return;
    var p = _state.freezeFlip;
    var row = _state.modulesByRow && _state.modulesByRow['time'];
    if (!row) return;
    for (var i = 0; i < row.modules.length; i++) {
      var mod = row.modules[i];
      var from = mod.char && mod.char !== ' ' ? mod.char : '0';
      var idx = mod.charset.indexOf(from);
      if (idx < 0) idx = 0;
      var to = mod.charset.charAt((idx + 1) % mod.charset.length);
      mod.flipFrom = from;
      mod.flipTo = to;
      mod.running = true;
      mod._impactFired = p >= FLIP_IMPACT;
      mod.flipStartTs = -1; // Marker: eingefroren
      mod.flipDurationMs = 100;
      var atlas = mod.atlas;
      if (atlas) {
        applyGlyphUVs(mod.leafFront, atlas, mod.charset.indexOf(from), 'top', false);
        applyGlyphUVs(mod.leafBack, atlas, mod.charset.indexOf(to), 'bottom', true);
        applyGlyphUVs(mod.topPlane, atlas, mod.charset.indexOf(to), 'top', false);
      }
      var ang = flipAngle(p * 100, 100);
      if (mod.pivot) mod.pivot.rotation.x = ang;
      if (mod.leafBody) mod.leafBody.visible = true;
      if (mod.leafFront) mod.leafFront.visible = ang < Math.PI / 2;
      if (mod.leafBack) mod.leafBack.visible = ang >= Math.PI / 2;
    }
  }

  function beginFlip(mod) {
    if (mod.running) return;
    if (mod.pendingStart) {
      mod.pendingStart = false;
      // bleibt aktiv (gleicher Modulzähler)
    }
    if (!mod.seq || mod.seq.length === 0) {
      setModActive(mod, false);
      return;
    }
    // Dauer aus dem festen Basiswert (keine Drift), bei vielen Schritten verkürzt
    var remaining = mod.seq.length;
    var baseMs = mod.flipBaseMs != null ? mod.flipBaseMs : FLIP_MS_SMALL;
    mod.flipDurationMs = stepDurationFor(baseMs, remaining, Math.random());
    mod._impactFired = false;
    var next = mod.seq.shift();
    mod.flipFrom = mod.char;
    mod.flipTo = next;
    mod.flipStartTs = 0;
    mod.running = true;
    setModActive(mod, true);

    // Klang: Klack erst beim Aufschlag (playImpactClack in updateAnimations).
    // Sekunden-Module bleiben stumm (kind='second' → sound.js ignoriert).

    // UVs: Blattvorderseite = FROM oben, Blattrückseite = TO unten (180°)
    // feste obere Hälfte = TO (wird freigelegt, wenn Blatt fällt)
    // feste untere Hälfte bleibt FROM, bis Flip beendet ist
    var atlas = mod.atlas;
    if (atlas) {
      var fromIdx = mod.charset.indexOf(mod.flipFrom);
      var toIdx = mod.charset.indexOf(mod.flipTo);
      applyGlyphUVs(mod.leafFront, atlas, fromIdx, 'top', false);
      applyGlyphUVs(mod.leafBack, atlas, toIdx, 'bottom', true);
      applyGlyphUVs(mod.topPlane, atlas, toIdx, 'top', false);
    }
  }

  /**
   * Klangart je Zeile/Stelle (Modulindex 0..n der Zeile, ohne Doppelpunkte).
   * time: 0-1 Stunde, 2-3 Minute. timer/stopwatch: 0-1 Stunde, 2-3 Minute, 4-5 Sekunde.
   * Übrige Zeilen (Datum/Wetter/Messenger) -> 'other'.
   */
  function moduleSoundKind(rowId, index) {
    if (rowId === 'time') {
      return index < 2 ? 'hour' : 'minute';
    }
    if (rowId === 'timer' || rowId === 'stopwatch') {
      if (index <= 1) return 'hour';
      if (index <= 3) return 'minute';
      return 'second';
    }
    return 'other';
  }

  function applyStaticChar(mod, ch) {
    var atlas = mod.atlas;
    if (!atlas) return;
    var idx = mod.charset.indexOf(ch);
    applyGlyphUVs(mod.topPlane, atlas, idx, 'top', false);
    applyGlyphUVs(mod.bottomPlane, atlas, idx, 'bottom', false);
  }

  /** Zeilen-Text aus den Modulzeichen (mit Doppelpunkten bei time/timer/stopwatch). */
  function composeShown(row) {
    if (!row || !row.modules) return '';
    var chars = [];
    for (var i = 0; i < row.modules.length; i++) {
      chars.push(row.modules[i].char || ' ');
    }
    if (row.def && row.def.id === 'time' && chars.length >= 4) {
      return chars[0] + chars[1] + ':' + chars[2] + chars[3];
    }
    if (
      row.def &&
      (row.def.id === 'timer' || row.def.id === 'stopwatch') &&
      chars.length >= 6
    ) {
      return chars[0] + chars[1] + ':' + chars[2] + chars[3] + ':' + chars[4] + chars[5];
    }
    return chars.join('');
  }

  function writeDebug() {
    if (!_state.debug) return;
    if (typeof document === 'undefined') return;
    var el = _state.debugEl;
    if (!el) {
      el = document.getElementById('flap-debug');
      if (!el) {
        el = document.createElement('pre');
        el.id = 'flap-debug';
        el.setAttribute('hidden', '');
        el.style.display = 'none';
        (document.body || document.documentElement).appendChild(el);
      }
      _state.debugEl = el;
    }
    var rows = {};
    var ids = Object.keys(_state.modulesByRow || {});
    for (var i = 0; i < ids.length; i++) {
      var row = _state.modulesByRow[ids[i]];
      var animating = 0;
      for (var m = 0; m < row.modules.length; m++) {
        if (row.modules[m].running || row.modules[m].pendingStart) animating++;
      }
      var shown = composeShown(row);
      rows[ids[i]] = {
        shown: shown,
        target: row.targetText != null ? row.targetText : shown,
        animating: animating,
      };
    }
    var atlasInfo = {};
    if (_state.atlas) {
      var names = Object.keys(_state.atlas);
      for (var a = 0; a < names.length; a++) {
        var at = _state.atlas[names[a]];
        atlasInfo[names[a]] = {
          width: at.canvas ? at.canvas.width : 0,
          height: at.canvas ? at.canvas.height : 0,
          fontLoaded: !!_state.fontLoaded,
        };
      }
    }
    var dbg = {
      rows: rows,
      atlas: atlasInfo,
      textures: _state.renderer ? _state.renderer.info.memory.textures : 0,
      frames: _state.frames | 0,
      viewport: {
        w: _state.viewportW || 0,
        h: _state.viewportH || 0,
      },
      shadowMapSize: _state.shadowMapSize || 0,
      cameraTiltDeg: _state.cameraTiltDeg || 0,
      freezeFlip: _state.freezeFlip,
      scene: sceneSpec(),
    };
    if (_state.buttons) {
      dbg.buttons = _state.buttons.map(function (b) {
        return {
          control: b.control,
          visible: !!b.group.visible,
          x: Math.round(b.group.position.x * 1000) / 1000,
          y: Math.round(b.group.position.y * 1000) / 1000,
          z: Math.round(b.group.position.z * 1000) / 1000,
          sx: Math.round(b.group.scale.x * 1000) / 1000,
          sy: Math.round(b.group.scale.y * 1000) / 1000,
        };
      });
    }
    // Layout-Boxen für check-render (a)-(e)
    if (_state.lastLayout) {
      var L = _state.lastLayout;
      var layoutDbg = { rows: {}, labels: {}, buttons: {} };
      for (var li = 0; li < L.length; li++) {
        var lr = L[li];
        layoutDbg.rows[lr.id] = {
          x: lr.box.left,
          y: lr.box.top,
          w: lr.box.right - lr.box.left,
          h: lr.box.bottom - lr.box.top,
          box: lr.box,
          moduleH: lr.height,
          colonBoxes: lr.colonBoxes || [],
        };
      }
      if (L.timerLabel) layoutDbg.labels.timerLabel = L.timerLabel;
      if (L.stopwatchLabel) layoutDbg.labels.stopwatchLabel = L.stopwatchLabel;
      if (L.cityLabel) layoutDbg.labels.cityLabel = L.cityLabel;
      if (L.buttons) {
        var bkeys = Object.keys(L.buttons);
        for (var bi = 0; bi < bkeys.length; bi++) {
          layoutDbg.buttons[bkeys[bi]] = L.buttons[bkeys[bi]];
        }
      }
      if (L.buttonBox) layoutDbg.buttonBox = L.buttonBox;
      if (L.hintBox) layoutDbg.hintBox = L.hintBox;
      dbg.layout = layoutDbg;
    }
    if (_state.labels) {
      dbg.labelTexts = {
        city: _state.labels.city ? _state.labels.city.text : null,
      };
      if (!_state.screensaver) {
        dbg.labelTexts.timer = _state.labels.timer ? _state.labels.timer.text : null;
        dbg.labelTexts.stopwatch = _state.labels.stopwatch ? _state.labels.stopwatch.text : null;
      }
      dbg.labelTextures = {};
      var lkeys = Object.keys(_state.labels);
      for (var lk = 0; lk < lkeys.length; lk++) {
        var lab = _state.labels[lkeys[lk]];
        dbg.labelTextures[lkeys[lk]] = {
          texW: lab.texW || 0,
          texH: lab.texH || 0,
        };
      }
    }
    try {
      el.textContent = JSON.stringify(dbg);
    } catch (e) {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // WebGL-Aufbau (nur mit THREE + document)
  // ---------------------------------------------------------------------------

  function initRenderer(canvas, layout, options) {
    if (_state.ready) return true;
    if (!canvas) return false;

    var THREE = global.THREE;
    if (!THREE) {
      return false;
    }

    var gl = null;
    try {
      gl =
        canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl');
    } catch (e) {
      gl = null;
    }
    if (!gl) return false;

    // Screensaver-Modus: keine Timer/Stoppuhr-Module, Labels oder Tasten
    _state.screensaver = !!(options && options.screensaver);
    _state.cityLabel =
      options && typeof options.cityLabel === 'string' && options.cityLabel !== ''
        ? options.cityLabel
        : 'DÜSSELDORF';

    // Debug-Modus und freezeFlip per URL-Parameter
    try {
      var search =
        (global.location && global.location.search) ||
        (typeof location !== 'undefined' && location.search) ||
        '';
      _state.debug = /(?:\?|&)debug=1(?:&|$)/.test(search);
      var freezeMatch = search.match(/(?:\?|&)freezeFlip=([0-9]*\.?[0-9]+)/);
      if (freezeMatch) {
        var fv = parseFloat(freezeMatch[1]);
        if (isFinite(fv)) _state.freezeFlip = Math.min(1, Math.max(0, fv));
      }
    } catch (e) {
      _state.debug = false;
    }

    var rowsDef = Array.isArray(layout) && layout.length > 0 ? layout : DEFAULT_LAYOUT;
    if (_state.screensaver) {
      var ssRows = [];
      for (var ssI = 0; ssI < rowsDef.length; ssI++) {
        var ssId = rowsDef[ssI] && rowsDef[ssI].id;
        if (ssId === 'timer' || ssId === 'stopwatch') continue;
        ssRows.push(rowsDef[ssI]);
      }
      rowsDef = ssRows;
    }

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0b0d);

    // Kamera leicht von oben (4–6° nach unten): Oberkanten der Blätter
    // und Achsen dadurch minimal sichtbar.
    var camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    var camDist = 10;
    var camY = camDist * Math.tan((CAMERA_TILT_DEG * Math.PI) / 180);
    camera.position.set(0, camY, camDist);
    camera.lookAt(0, 0, 0);
    _state.cameraTiltDeg = CAMERA_TILT_DEG;

    // --- Licht: Hauptlicht von oben links, leicht warm ---
    var hemi = new THREE.HemisphereLight(0x9aabc4, 0x1c2028, 1.05);
    scene.add(hemi);

    var key = new THREE.DirectionalLight(0xfff2df, 2.35);
    key.position.set(-4.5, 9, 7);
    key.castShadow = true;
    var shadowSize = shadowMapSizeFor(
      (canvas.clientWidth || global.innerWidth || 1920)
    );
    key.shadow.mapSize.width = shadowSize;
    key.shadow.mapSize.height = shadowSize;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    // Schattenkamera eng auf den sichtbaren Bereich (keine Treppen)
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 2.5;
    scene.add(key);
    _state.keyLight = key;
    _state.shadowMapSize = shadowSize;

    var fill = new THREE.DirectionalLight(0x8899cc, 0.72);
    fill.position.set(6, -2, 5);
    scene.add(fill);

    var rim = new THREE.DirectionalLight(0xdde4ff, 0.55);
    rim.position.set(0, 4, -6);
    scene.add(rim);

    // --- prozedurale Noise-Textur (feine Rauheit, kein externes Bild) ---
    var noiseTex = createNoiseTexture(THREE, 128);

    // --- geteilte Materialien (ohne Glyphen-Map) ---
    var matPlastic = new THREE.MeshPhysicalMaterial({
      color: 0x161616,
      roughness: 0.52,
      metalness: 0.06,
      clearcoat: 0.28,
      clearcoatRoughness: 0.38,
      roughnessMap: noiseTex,
      bumpMap: noiseTex,
      bumpScale: 0.003,
    });
    var matPlasticDark = new THREE.MeshPhysicalMaterial({
      color: 0x101012,
      roughness: 0.62,
      metalness: 0.05,
      clearcoat: 0.18,
      roughnessMap: noiseTex,
      bumpMap: noiseTex,
      bumpScale: 0.003,
    });
    // Kunststoffkante: etwas heller als die Flächen
    var matPlasticEdge = new THREE.MeshPhysicalMaterial({
      color: 0x2c2c30,
      roughness: 0.48,
      metalness: 0.12,
      clearcoat: 0.32,
      clearcoatRoughness: 0.35,
    });
    var matMetal = new THREE.MeshStandardMaterial({
      color: 0xb0b6be,
      roughness: 0.32,
      metalness: 0.92,
    });
    var matMetalDark = new THREE.MeshStandardMaterial({
      color: 0x6a7078,
      roughness: 0.38,
      metalness: 0.9,
    });
    // Gehäuse: dunkel, leicht gebürstetes Metall / mattschwarz lackiert
    var matHousing = new THREE.MeshStandardMaterial({
      color: 0x0e0e10,
      roughness: 0.72,
      metalness: 0.35,
      roughnessMap: noiseTex,
    });
    // Modulfenster-Rahmen: mattschwarz mit schwacher Reflexion
    var matFrame = new THREE.MeshStandardMaterial({
      color: 0x141416,
      roughness: 0.65,
      metalness: 0.4,
      roughnessMap: noiseTex,
    });
    var matBtnBody = new THREE.MeshPhysicalMaterial({
      color: 0x4a4a52,
      roughness: 0.4,
      metalness: 0.55,
      clearcoat: 0.45,
    });
    var matBtnFace = new THREE.MeshPhysicalMaterial({
      color: 0x333338,
      roughness: 0.38,
      metalness: 0.62,
      clearcoat: 0.45,
    });

    var geoms = createSharedGeometries(THREE);

    var boardGroup = new THREE.Group();
    scene.add(boardGroup);

    var housing = new THREE.Mesh(geoms.housing, matHousing);
    housing.receiveShadow = true;
    housing.position.z = -0.35;
    boardGroup.add(housing);

    _state.THREE = THREE;
    _state.renderer = renderer;
    _state.scene = scene;
    _state.camera = camera;
    _state.boardGroup = boardGroup;
    _state.geoms = geoms;
    _state.materials = {
      plastic: matPlastic,
      plasticDark: matPlasticDark,
      plasticEdge: matPlasticEdge,
      metal: matMetal,
      metalDark: matMetalDark,
      housing: matHousing,
      frame: matFrame,
      btnBody: matBtnBody,
      btnFace: matBtnFace,
    };
    _state.housingMesh = housing;
    _state.canvas = canvas;
    _state.layout = rowsDef;
    _state.ready = true;

    _state.raycaster = new THREE.Raycaster();
    _state.pointer = new THREE.Vector2();
    bindEvents(canvas);

    // Erster Frame sofort (auch vor Font), damit frames > 0
    handleResize();
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
      _state.frames = (_state.frames | 0) + 1;
      writeDebug();
    }

    // Font laden, dann Atlanten zeichnen und Module bauen
    loadOswald().then(function (ok) {
      _state.fontLoaded = !!ok;
      _state.atlas = {
        digits: createGlyphAtlas(THREE, DIGITS + ' ', 256, 'digits'),
        text: createGlyphAtlas(THREE, CHARSET, 128, 'text'),
      };
      // Glyphen-Materialien (transparenter Atlas, weiße Schrift)
      _state.materials.glyphDigits = new THREE.MeshBasicMaterial({
        map: _state.atlas.digits.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      _state.materials.glyphText = new THREE.MeshBasicMaterial({
        map: _state.atlas.text.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      buildRows(rowsDef, _state.atlas.digits, _state.atlas.text);
      buildControls();
      buildLabels();
      _state.modulesReady = true;
      handleResize();
      flushTextQueue();
      if (_state.freezeFlip != null) applyFreezeFlip();
      markDirty();
      if (renderer && scene && camera) {
        renderer.render(scene, camera);
        _state.frames = (_state.frames | 0) + 1;
        writeDebug();
      }
    });

    return true;
  }

  /** document.fonts.load('600 100px Oswald') mit 3-s-Timeout. */
  function loadOswald() {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (ok) {
        if (done) return;
        done = true;
        resolve(!!ok);
      };
      var timer = setTimeout(function () {
        finish(false);
      }, FONT_TIMEOUT_MS);
      try {
        if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
          document.fonts.load('600 100px Oswald').then(
            function () {
              clearTimeout(timer);
              finish(true);
            },
            function () {
              clearTimeout(timer);
              finish(false);
            }
          );
        } else {
          clearTimeout(timer);
          finish(false);
        }
      } catch (e) {
        clearTimeout(timer);
        finish(false);
      }
    });
  }

  function createSharedGeometries(THREE) {
    var halfCard = createRoundedHalfGeometry(THREE, 1, 0.5, THICKNESS_RATIO, CORNER_RATIO);
    // Textebene: obere/unere Hälfte lückenlos (Höhe 0.5, nur echter Achs-Spalt)
    var halfPlaneH = 0.5 - AXIS_GAP / 2;
    var halfPlane = new THREE.PlaneGeometry(0.98, halfPlaneH);
    var stackEdge = new THREE.BoxGeometry(1, 0.5, THICKNESS_RATIO * 0.55);
    var axis = new THREE.CylinderGeometry(0.012, 0.012, 1, 10);
    axis.rotateZ(Math.PI / 2);
    var bearing = new THREE.BoxGeometry(0.06, 0.14, 0.08);
    var pin = new THREE.CylinderGeometry(0.01, 0.01, 0.07, 8);
    pin.rotateZ(Math.PI / 2);
    var housing = new THREE.BoxGeometry(1, 1, 0.5);
    // Modulfenster: Rahmen mit Fase, Tiefe ≈ 8 % Modulhöhe;
    // außen = Modul + 2 × FRAME_OVERHANG (sonst ragt der Rahmen über die Zeile)
    var frameOuter = 1 + 2 * FRAME_OVERHANG;
    var moduleFrame = createModuleFrameGeometry(
      THREE,
      frameOuter,
      frameOuter,
      0.94,
      0.94,
      FRAME_DEPTH_RATIO
    );
    // Doppelpunkte: zwei quadratische Punkte mit leicht abgerundeten Kanten,
    // Einheitsgeometrie 1×1×0.5
    var colonDot = createRoundedBoxGeometry(THREE, 1, 1, 0.5, 0.12);
    var btnBox = createRoundedBoxGeometry(THREE, 1, 0.45, 0.12, 0.06);
    var btnFace = new THREE.PlaneGeometry(0.85, 0.32);
    var arrowBox = createRoundedBoxGeometry(THREE, 0.36, 0.22, 0.1, 0.05);

    return {
      halfCard: halfCard,
      halfPlane: halfPlane,
      stackEdge: stackEdge,
      axis: axis,
      bearing: bearing,
      pin: pin,
      housing: housing,
      moduleFrame: moduleFrame,
      colonDot: colonDot,
      btnBox: btnBox,
      btnFace: btnFace,
      arrowBox: arrowBox,
    };
  }

  /**
   * createModuleFrameGeometry — vertiefte Modulöffnung im Gehäuse.
   * Äußerer Rahmen mit Fase, inneres Fenster; Tiefe = depth.
   * Shape mit Hole, extrudiert mit Bevel.
   */
  function createModuleFrameGeometry(THREE, outerW, outerH, innerW, innerH, depth) {
    var bevel = Math.min(0.012, depth * 0.18);
    var rOuter = 0.04;
    var rInner = 0.03;
    var shape = new THREE.Shape();
    var ox = -outerW / 2;
    var oy = -outerH / 2;
    addRoundedRectPath(shape, ox, oy, outerW, outerH, rOuter);
    var hole = new THREE.Path();
    var ix = -innerW / 2;
    var iy = -innerH / 2;
    addRoundedRectPath(hole, ix, iy, innerW, innerH, rInner);
    shape.holes.push(hole);
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.01, depth),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.85,
      bevelSegments: 2,
      curveSegments: 4,
    });
    geo.center();
    return geo;
  }

  /** Rechteck mit Radien als Shape/Path anhängen. */
  function addRoundedRectPath(path, x, y, w, h, r) {
    var rr = Math.min(r, w * 0.35, h * 0.35);
    path.moveTo(x + rr, y);
    path.lineTo(x + w - rr, y);
    path.quadraticCurveTo(x + w, y, x + w, y + rr);
    path.lineTo(x + w, y + h - rr);
    path.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    path.lineTo(x + rr, y + h);
    path.quadraticCurveTo(x, y + h, x, y + h - rr);
    path.lineTo(x, y + rr);
    path.quadraticCurveTo(x, y, x + rr, y);
    return path;
  }

  /** Abgerundetes Shape (Rechteck mit Radien) extrudiert mit Bevel. */
  function createRoundedHalfGeometry(THREE, w, h, thickness, radius) {
    var r = Math.min(radius, h * 0.35, w * 0.35);
    var shape = new THREE.Shape();
    var x0 = -w / 2;
    var y0 = -h / 2;
    var x1 = w / 2;
    var y1 = h / 2;
    shape.moveTo(x0 + r, y0);
    shape.lineTo(x1 - r, y0);
    shape.quadraticCurveTo(x1, y0, x1, y0 + r);
    shape.lineTo(x1, y1 - r);
    shape.quadraticCurveTo(x1, y1, x1 - r, y1);
    shape.lineTo(x0 + r, y1);
    shape.quadraticCurveTo(x0, y1, x0, y1 - r);
    shape.lineTo(x0, y0 + r);
    shape.quadraticCurveTo(x0, y0, x0 + r, y0);

    var depth = Math.max(0.002, thickness);
    var bevel = depth * 0.18;
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.85,
      bevelSegments: 2,
      curveSegments: 5,
    });
    geo.center();
    return geo;
  }

  function createRoundedBoxGeometry(THREE, w, h, d, radius) {
    return createRoundedHalfGeometry(THREE, w, h, d, radius);
  }

  /**
   * createNoiseTexture — prozedurale feine Rauheit (Graustufen).
   * Kein externes Bild; als roughnessMap/bumpMap der Blattflächen.
   */
  function createNoiseTexture(THREE, size) {
    var n = size || 128;
    var canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(n, n);
    // Deterministisches Feinrauschen (sin/fraktal, ohne Zufall → reproduzierbar)
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var v =
          128 +
          18 * Math.sin(x * 1.7 + y * 0.9) +
          10 * Math.sin(x * 0.31 * y * 0.27 + 1.3) +
          6 * Math.sin((x + y) * 2.1);
        var i = (y * n + x) * 4;
        var c = Math.max(0, Math.min(255, Math.round(v)));
        img.data[i] = c;
        img.data[i + 1] = c;
        img.data[i + 2] = c;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Glyphen-Atlas: EINE CanvasTexture je Größe, KEIN Klonen pro Modul.
   * ALLE Zeichen teilen eine gemeinsame Grundlinie (glyphBaselineY):
   * Zentrierung über die Versalhöhe "H", NICHT pro Glyphe über
   * actualBoundingBox. Dadurch sitzen Ä/Ö/Ü-Punkte oberhalb der Versalhöhe
   * und werden nicht verschoben. Schriftgröße so gewählt, dass Umlautpunkte
   * noch in die obere Blatthälfte passen.
   * Hintergrund transparent, Schrift cremeweiß.
   */
  function createGlyphAtlas(THREE, charset, cell, name) {
    var chars = [];
    for (var i = 0; i < charset.length; i++) chars.push(charset.charAt(i));
    var n = chars.length;
    var cols = Math.max(4, Math.ceil(Math.sqrt(n)));
    var rows = Math.ceil(n / cols);
    // Atlas-Kantenlänge max. 4096
    var maxSide = 4096;
    while (cols * cell > maxSide || rows * cell > maxSide) {
      cell = Math.floor(cell * 0.8);
      if (cell < 16) break;
    }
    var canvas = document.createElement('canvas');
    canvas.width = cols * cell;
    canvas.height = rows * cell;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var fontStack = 'Oswald, "Roboto Condensed", "Arial Narrow", "Segoe UI", sans-serif';
    // Referenzmaß bei 100px
    var ref = 100;
    ctx.font = '600 ' + ref + 'px ' + fontStack;

    // Versalhöhe "H" als gemeinsame Referenz
    var mH = ctx.measureText('H');
    var capAsc = mH.actualBoundingBoxAscent;
    var capDesc = mH.actualBoundingBoxDescent;
    if (!(capAsc > 0)) capAsc = ref * 0.72;
    if (!(capDesc >= 0)) capDesc = 0;

    // Höchste Glyphe inkl. Umlaute (für Schriftgröße)
    var maxH = 0;
    for (var c0 = 0; c0 < n; c0++) {
      var ch0 = chars[c0];
      if (ch0 === ' ') continue;
      var m0 = ctx.measureText(ch0);
      var h0 = m0.actualBoundingBoxAscent + m0.actualBoundingBoxDescent;
      if (h0 > maxH) maxH = h0;
    }
    if (!(maxH > 0)) maxH = capAsc + capDesc;

    // Schriftgröße: Umlaute sollen in die Zelle passen (obere Blatthälfte)
    var fontPx = Math.max(8, Math.floor((ref * (GLYPH_FILL * cell)) / maxH));
    ctx.font = '600 ' + fontPx + 'px ' + fontStack;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f4f1e8';

    // Cap-Metriken bei finaler Schriftgröße (skalieren linear)
    var scale = fontPx / ref;
    var capMetrics = { ascent: capAsc * scale, descent: capDesc * scale };
    // Gemeinsame Baseline (zell-relativ) für ALLE Zeichen
    var cellBaseline = glyphBaselineY('H', cell, capMetrics);

    var index = {};
    for (var c = 0; c < n; c++) {
      var ch = chars[c];
      var col = c % cols;
      var row = Math.floor(c / cols);
      var cx = col * cell + cell / 2;
      // Baseline in Canvas-Koordinaten: Zell-Offset + zell-relative Baseline
      var baselineY = row * cell + cellBaseline;
      if (ch !== ' ') {
        ctx.fillText(ch, cx, baselineY);
      }
      index[ch] = c;
    }

    var texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    try {
      var maxAniso =
        _state.renderer && _state.renderer.capabilities
          ? _state.renderer.capabilities.getMaxAnisotropy()
          : 8;
      if (maxAniso > 0) texture.anisotropy = Math.min(16, maxAniso);
    } catch (e) {
      /* ignore */
    }
    texture.needsUpdate = true;

    return {
      name: name || 'atlas',
      canvas: canvas,
      texture: texture,
      cols: cols,
      rows: rows,
      cell: cell,
      index: index,
    };
  }

  /**
   * Setzt die UV-Attribute einer Plane so, dass sie die Ober- oder Unterhälfte
   * des Glyphen `charIdx` aus dem gemeinsamen Atlas zeigt.
   * flip180=true für die Blatt-Rückseite (nach 180°-Flip aufrecht).
   * KEINE Textur-Klonen, Auswahl rein über UVs der Face-Geometrie.
   */
  function applyGlyphUVs(mesh, atlas, charIdx, half, flip180) {
    if (!mesh || !mesh.geometry || !atlas) return;
    var uvAttr = mesh.geometry.attributes && mesh.geometry.attributes.uv;
    if (!uvAttr) return;
    var idx = charIdx;
    if (idx == null || idx < 0) {
      idx = atlas.index[' '] != null ? atlas.index[' '] : 0;
    }
    var cols = atlas.cols;
    var rows = atlas.rows;
    var col = idx % cols;
    var row = Math.floor(idx / cols);

    var u0 = col / cols;
    var u1 = (col + 1) / cols;
    // CanvasTexture flipY=true: v=0 ist Canvas-Unterkante
    var vTop = 1 - row / rows;
    var vBot = 1 - (row + 1) / rows;
    var vMid = 1 - (row + 0.5) / rows;

    var v0, v1; // v0 = Geometrie-Unterkante, v1 = -Oberkante
    if (half === 'top') {
      v0 = vMid;
      v1 = vTop;
    } else {
      v0 = vBot;
      v1 = vMid;
    }

    // PlaneGeometry UV-Reihenfolge: 0:(0,1) 1:(1,1) 2:(0,0) 3:(1,0)
    if (!flip180) {
      uvAttr.setXY(0, u0, v1);
      uvAttr.setXY(1, u1, v1);
      uvAttr.setXY(2, u0, v0);
      uvAttr.setXY(3, u1, v0);
    } else {
      uvAttr.setXY(0, u1, v0);
      uvAttr.setXY(1, u0, v0);
      uvAttr.setXY(2, u1, v1);
      uvAttr.setXY(3, u0, v1);
    }
    uvAttr.needsUpdate = true;
  }

  /**
   * Baut alle Zeilen und Module.
   * EINE geteilte Atlas-Textur je Größe; pro Mesh eigene BufferGeometry
   * mit gesetzten UVs (kein Klonen der Atlas-Textur pro Modul).
   */
  function buildRows(rowsDef, atlasDigits, atlasText) {
    var THREE = _state.THREE;
    var boardGroup = _state.boardGroup;
    var geoms = _state.geoms;
    var mats = _state.materials;

    _state.modulesByRow = {};

    for (var r = 0; r < rowsDef.length; r++) {
      var def = rowsDef[r];
      var isBig = def.id === 'time';
      var atlas = isBig ? atlasDigits : atlasText;
      // Timer/Stoppuhr nutzen DIGITS → eigenes digits-Atlas, wenn Zeichensatz klein
      if (def.charset && def.charset.length <= 12) atlas = atlasDigits;
      var glyphMat = isBig || (def.charset && def.charset.length <= 12)
        ? mats.glyphDigits
        : mats.glyphText;
      // Einheitlich: Atlas nach Zeichensatz wählen
      if (def.charset && def.charset.length <= 12) {
        atlas = atlasDigits;
        glyphMat = mats.glyphDigits;
      } else {
        atlas = atlasText;
        glyphMat = mats.glyphText;
      }
      var isTime = def.id === 'time' || def.id === 'timer' || def.id === 'stopwatch';
      var flipBase = isBig ? FLIP_MS_BIG : FLIP_MS_SMALL;

      var rowGroup = new THREE.Group();
      rowGroup.name = 'row-' + def.id;
      boardGroup.add(rowGroup);

      var modules = [];
      for (var m = 0; m < def.length; m++) {
        var mod = createModule(THREE, geoms, mats, atlas, glyphMat, isTime, flipBase, def.charset);
        mod.index = m;
        mod.rowId = def.id;
        rowGroup.add(mod.group);
        modules.push(mod);
      }

      var colons = [];
      if (def.id === 'time') {
        colons.push(createColon(THREE, geoms, mats));
        rowGroup.add(colons[0].group);
      } else if (def.id === 'timer' || def.id === 'stopwatch') {
        colons.push(createColon(THREE, geoms, mats));
        colons.push(createColon(THREE, geoms, mats));
        rowGroup.add(colons[0].group);
        rowGroup.add(colons[1].group);
      }

      _state.modulesByRow[def.id] = {
        def: def,
        group: rowGroup,
        modules: modules,
        colons: colons,
        charset: def.charset,
        isTime: isTime,
        isBig: isBig,
        targetText: null,
      };
    }
  }

  function createModule(THREE, geoms, mats, atlas, glyphMat, isTime, flipBaseMs, charset) {
    var group = new THREE.Group();

    // Material-Paar für Extrude-Körper: Flächen + helle Kunststoffkante
    var cardMats = [mats.plastic, mats.plasticEdge];
    var leafMats = [mats.plasticDark, mats.plasticEdge];

    // Statische obere Hälfte (Karte ohne Textur)
    var topFixed = new THREE.Mesh(geoms.halfCard, cardMats);
    topFixed.position.set(0, 0.25, 0.01);
    topFixed.castShadow = true;
    topFixed.receiveShadow = true;
    group.add(topFixed);

    // Statische untere Hälfte
    var bottomFixed = new THREE.Mesh(geoms.halfCard, cardMats);
    bottomFixed.position.set(0, -0.25, 0.01);
    bottomFixed.castShadow = true;
    bottomFixed.receiveShadow = true;
    group.add(bottomFixed);

    // Glyphen-Ebenen: eigene BufferGeometry mit UVs, gemeinsame Atlas-Textur
    var topPlane = new THREE.Mesh(geoms.halfPlane.clone(), glyphMat);
    topPlane.position.set(0, 0.25 + AXIS_GAP / 4, 0.025);
    group.add(topPlane);

    var bottomPlane = new THREE.Mesh(geoms.halfPlane.clone(), glyphMat);
    bottomPlane.position.set(0, -0.25 - AXIS_GAP / 4, 0.025);
    group.add(bottomPlane);

    // Blattstapel: 3–4 Kanten hinter der oberen Hälfte
    for (var s = 0; s < STACK_EDGE_COUNT; s++) {
      var edge = new THREE.Mesh(geoms.stackEdge, mats.plasticDark);
      edge.position.set(0, 0.25 + s * STACK_OFFSET_RATIO, -0.02 - s * STACK_OFFSET_RATIO * 1.5);
      edge.castShadow = true;
      edge.receiveShadow = true;
      group.add(edge);
    }

    // Blattstapel: 3–4 Kanten unter der unteren festen Hälfte
    for (var s2 = 0; s2 < STACK_EDGE_COUNT; s2++) {
      var edgeB = new THREE.Mesh(geoms.stackEdge, mats.plasticDark);
      edgeB.position.set(0, -0.25 - s2 * STACK_OFFSET_RATIO, -0.02 - s2 * STACK_OFFSET_RATIO * 1.5);
      edgeB.castShadow = true;
      edgeB.receiveShadow = true;
      group.add(edgeB);
    }

    // Modulfenster: vertiefte Öffnung im Gehäuse (Rahmen mit Fase)
    var frame = new THREE.Mesh(geoms.moduleFrame, mats.frame);
    frame.position.set(0, 0, 0.02);
    frame.castShadow = true;
    frame.receiveShadow = true;
    group.add(frame);

    // Klappendes Blatt (Pivot an der Achse)
    var pivot = new THREE.Group();
    pivot.position.set(0, 0, 0.04);
    group.add(pivot);

    var leafBody = new THREE.Mesh(geoms.halfCard, leafMats);
    leafBody.position.set(0, 0.25, 0);
    leafBody.castShadow = true;
    leafBody.receiveShadow = true;
    pivot.add(leafBody);

    // Vorderseite (obere Glyphenhälfte FROM)
    var leafFront = new THREE.Mesh(geoms.halfPlane.clone(), glyphMat);
    leafFront.position.set(0, 0.25 + AXIS_GAP / 4, 0.02);
    pivot.add(leafFront);

    // Rückseite (untere Glyphenhälfte TO): nach -Z gedreht,
    // flip180-UVs bei setGlyph, damit nach dem Fall aufrecht
    var leafBack = new THREE.Mesh(geoms.halfPlane.clone(), glyphMat);
    leafBack.position.set(0, 0.25 + AXIS_GAP / 4, -0.02);
    leafBack.rotation.y = Math.PI;
    pivot.add(leafBack);

    // Achse
    var axis = new THREE.Mesh(geoms.axis, mats.metal);
    axis.scale.set(1.18, 1, 1);
    axis.castShadow = true;
    axis.receiveShadow = true;
    group.add(axis);

    // Lagerböcke nur links/rechts an der Achse (keine Kugeln)
    var bearingL = new THREE.Mesh(geoms.bearing, mats.metalDark);
    bearingL.position.set(-0.56, 0, 0);
    bearingL.castShadow = true;
    bearingL.receiveShadow = true;
    group.add(bearingL);
    var bearingR = new THREE.Mesh(geoms.bearing, mats.metalDark);
    bearingR.position.set(0.56, 0, 0);
    bearingR.castShadow = true;
    bearingR.receiveShadow = true;
    group.add(bearingR);

    var pinL = new THREE.Mesh(geoms.pin, mats.metal);
    pinL.position.set(-0.62, 0, 0);
    group.add(pinL);
    var pinR = new THREE.Mesh(geoms.pin, mats.metal);
    pinR.position.set(0.62, 0, 0);
    group.add(pinR);

    hideLeaf({ pivot: pivot, leafBody: leafBody, leafFront: leafFront, leafBack: leafBack });

    return {
      group: group,
      pivot: pivot,
      leafBody: leafBody,
      leafFront: leafFront,
      leafBack: leafBack,
      topFixed: topFixed,
      bottomFixed: bottomFixed,
      topPlane: topPlane,
      bottomPlane: bottomPlane,
      frame: frame,
      stackEdgeCount: STACK_EDGE_COUNT * 2,
      leafThicknessRatio: THICKNESS_RATIO,
      atlas: atlas,
      char: ' ',
      seq: [],
      running: false,
      flipStartTs: 0,
      flipBaseMs: flipBaseMs,
      flipDurationMs: flipBaseMs,
      flipFrom: ' ',
      flipTo: ' ',
      isTime: isTime,
      charset: charset,
      pendingStart: false,
      startTimer: null,
      first: true,
      _active: false,
      _impactFired: false,
      scale: 1,
    };
  }

  function createColon(THREE, geoms, mats) {
    var group = new THREE.Group();
    // Zwei quadratische Punkte (Doppelpunkt), Einheitsgeometrie 1×1×0.5.
    // Einheits-Abstand = COLON_DOT_OFF_RATIO / COLON_DOT_RATIO (0,18/0,09 = 2).
    var yOff = COLON_DOT_OFF_RATIO / COLON_DOT_RATIO;
    var t = new THREE.Mesh(geoms.colonDot, mats.metal);
    t.position.set(0, yOff, 0);
    t.castShadow = true;
    t.receiveShadow = true;
    group.add(t);
    var b = new THREE.Mesh(geoms.colonDot, mats.metal);
    b.position.set(0, -yOff, 0);
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
    return { group: group };
  }

  // ---------------------------------------------------------------------------
  // Bedienelemente (3D-Tasten)
  // ---------------------------------------------------------------------------

  function buildControls() {
    var THREE = _state.THREE;
    var boardGroup = _state.boardGroup;
    var geoms = _state.geoms;
    var mats = _state.materials;

    _state.buttons = [];

    // Screensaver: keine Tasten erzeugen
    if (_state.screensaver) return;

    // Action-Labels: Schrifthöhe ≥ 40 % der Tastenhöhe → großzügige Textur
    var labelStart = createLabelTexture(THREE, 'START/PAUSE', 512, 128, 72);
    var labelReset = createLabelTexture(THREE, 'RESET', 512, 128, 72);

    // Pfeil-Texturen: echtes Dreieck, Symbolhöhe ≥ 50 % der Tastenhöhe
    var labelUp = createArrowTexture(THREE, true);
    var labelDown = createArrowTexture(THREE, false);

    function addButton(control, labelTex, w, h) {
      var group = new THREE.Group();
      var body = new THREE.Mesh(geoms.btnBox, mats.btnBody);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);
      if (labelTex) {
        // MeshBasicMaterial: Label-Textur unverdunkelt
        var faceMat = new THREE.MeshBasicMaterial({
          map: labelTex,
          transparent: true,
          toneMapped: false,
        });
        var face = new THREE.Mesh(geoms.btnFace, faceMat);
        face.position.z = 0.12;
        group.add(face);
      }
      group.scale.set(w, h, 1);
      group.visible = _state.controlsVisible;
      boardGroup.add(group);
      var btn = {
        control: control,
        group: group,
        body: body,
        restX: 0,
        restY: 0,
        restZ: 0.12,
        press: 0,
        pressDir: 0,
        hover: false,
      };
      _state.buttons.push(btn);
      return btn;
    }

    addButton('timerHourUp', labelUp, 0.42, 0.42);
    addButton('timerHourDown', labelDown, 0.42, 0.42);
    addButton('timerMinUp', labelUp, 0.42, 0.42);
    addButton('timerMinDown', labelDown, 0.42, 0.42);
    addButton('timerStartPause', labelStart, 1.15, 0.42);
    addButton('timerReset', labelReset, 0.95, 0.42);
    addButton('swStartPause', labelStart, 1.15, 0.42);
    addButton('swReset', labelReset, 0.95, 0.42);
  }

  /** Dreiecks-Pfeil als Textur (echte Dreiecksform, hohe Lesbarkeit). */
  function createArrowTexture(THREE, up) {
    var canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    // Dreieck füllt ~70 % der Fläche (Symbolhöhe ≥ 50 % der Tastenhöhe)
    ctx.fillStyle = '#e8e4d8';
    ctx.beginPath();
    if (up) {
      ctx.moveTo(64, 18);
      ctx.lineTo(112, 110);
      ctx.lineTo(16, 110);
    } else {
      ctx.moveTo(64, 110);
      ctx.lineTo(112, 18);
      ctx.lineTo(16, 18);
    }
    ctx.closePath();
    ctx.fill();
    var tex = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Label-Textur: gedruckt wirkende Schrift auf dunklem Grund.
   * fontPx so gewählt, dass Schrifthöhe ≥ 60 % der Zellhöhe ist.
   * Textur mit Mipmaps + anisotroper Filterung (kein Hochskalieren).
   */
  function createLabelTexture(THREE, text, w, h, fontPx) {
    var canvas = document.createElement('canvas');
    canvas.width = w || 256;
    canvas.height = h || 64;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2c2c32';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e8e4d8';
    // Schrifthöhe ≥ 60 % der Labelhöhe
    var size = fontPx || Math.floor(canvas.height * 0.65);
    if (size < Math.floor(canvas.height * 0.6)) size = Math.floor(canvas.height * 0.6);
    ctx.font =
      '600 ' + size + 'px Oswald, "Roboto Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + size * 0.05);
    var tex = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    try {
      var maxAniso =
        _state.renderer && _state.renderer.capabilities
          ? _state.renderer.capabilities.getMaxAnisotropy()
          : 8;
      if (maxAniso > 0) tex.anisotropy = Math.min(16, maxAniso);
    } catch (e) {
      /* ignore */
    }
    tex.needsUpdate = true;
    return tex;
  }

  /** Labels TIMER / STOPPUHR / DÜSSELDORF als Meshes auf dem Gehäuse. */
  function buildLabels() {
    var THREE = _state.THREE;
    var boardGroup = _state.boardGroup;
    _state.labels = {};

    // Bildschirmmaße für die Texturauflösung
    var canvasW =
      (_state.canvas && _state.canvas.clientWidth) || global.innerWidth || 1920;
    var canvasH =
      (_state.canvas && _state.canvas.clientHeight) || global.innerHeight || 1080;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var layout = layoutRows(canvasW, canvasH, _state.layout, {
      screensaver: _state.screensaver,
    });

    function labelScreenW(box) {
      if (!box) return 256;
      return Math.max(64, (box.right - box.left) * canvasW);
    }

    function makeLabel(key, text, box) {
      var screenW = labelScreenW(box);
      var texW = labelTextureSize(screenW, dpr);
      var screenH = box ? (box.bottom - box.top) * canvasH : 48;
      var texH = Math.max(32, labelTextureSize(screenH, dpr));
      // Schrifthöhe ≥ 60 % der Labelhöhe
      var fontPx = Math.floor(texH * 0.65);
      var tex = createLabelTexture(THREE, text, texW, texH, fontPx);
      var mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        toneMapped: false,
      });
      var geo = new THREE.PlaneGeometry(1, 1);
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 0, 0.05);
      var group = new THREE.Group();
      group.add(mesh);
      group.visible = true;
      boardGroup.add(group);
      _state.labels[key] = {
        group: group,
        mesh: mesh,
        text: text,
        texW: texW,
        texH: texH,
      };
    }

    // Screensaver: nur Stadt-Label, keine TIMER/STOPPUHR-Labels
    if (!_state.screensaver) {
      makeLabel('timer', 'TIMER', layout.timerLabel);
      makeLabel('stopwatch', 'STOPPUHR', layout.stopwatchLabel);
    }
    makeLabel('city', _state.cityLabel, layout.cityLabel);
  }

  // ---------------------------------------------------------------------------
  // Resize / Layout anwenden
  // ---------------------------------------------------------------------------

  function handleResize() {
    if (!_state.renderer) return;
    var THREE = _state.THREE;
    var canvas = _state.canvas;
    var renderer = _state.renderer;
    var camera = _state.camera;

    var w = canvas.clientWidth || global.innerWidth || 1920;
    var h = canvas.clientHeight || global.innerHeight || 1080;
    _state.viewportW = w;
    _state.viewportH = h;
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    // Shadow-Map-Größe: 4096 ab 1600 px Breite, sonst 2048
    var newShadow = shadowMapSizeFor(w);
    if (_state.keyLight && _state.shadowMapSize !== newShadow) {
      _state.keyLight.shadow.mapSize.width = newShadow;
      _state.keyLight.shadow.mapSize.height = newShadow;
      if (_state.keyLight.shadow.map) {
        _state.keyLight.shadow.map.dispose();
        _state.keyLight.shadow.map = null;
      }
      _state.shadowMapSize = newShadow;
    }

    var layout = layoutRows(w, h, _state.layout, {
      screensaver: _state.screensaver,
    });

    // Sichtbare Weltgröße bei der Kamera-Distanz (leicht geneigte Kamera)
    var dist = camera.position.length();
    var viewH = 2 * Math.tan((camera.fov * Math.PI) / 180 / 2) * dist;
    var viewW = viewH * camera.aspect;

    for (var i = 0; i < layout.length; i++) {
      var L = layout[i];
      var row = _state.modulesByRow && _state.modulesByRow[L.id];
      if (!row) continue;

      var mh = L.height * viewH;
      var moduleW = L.moduleW * viewW;
      var gapW = L.gap * viewW;
      var centerX = (L.cx - 0.5) * viewW;
      var centerY = (0.5 - L.cy) * viewH;

      // Module an moduleCenters platzieren (normiert → Welt)
      var n = row.modules.length;
      for (var m = 0; m < n; m++) {
        var mod = row.modules[m];
        var mx =
          L.moduleCenters && L.moduleCenters[m] != null
            ? (L.moduleCenters[m] - 0.5) * viewW
            : centerX - ((n - 1) / 2) * (moduleW + gapW) + m * (moduleW + gapW);
        mod.group.position.set(mx, centerY, 0);
        mod.group.scale.set(moduleW, mh, moduleW);
      }

      // Doppelpunkte: exakt mittig in der Lücke (layout.colonCenters)
      for (var c = 0; c < row.colons.length; c++) {
        var colX;
        if (L.colonCenters && L.colonCenters[c] != null) {
          colX = (L.colonCenters[c] - 0.5) * viewW;
        } else {
          colX = centerX;
        }
        var cb = L.colonBoxes && L.colonBoxes[c];
        // Quader-Maße aus layout.colonBoxes (quadratisch, Kante = 0,09 × Modulhöhe)
        var cW = cb ? cb.w * viewW : mh * COLON_DOT_RATIO;
        var cH = cb ? cb.h * viewH : mh * COLON_DOT_RATIO;
        row.colons[c].group.position.set(colX, centerY, 0.05);
        // Einheitsgeometrie 1×1×0.5 → Scale = Zielmaß
        row.colons[c].group.scale.set(cW, cH, cW * 0.5);
      }

      row.layout = L;
      row.viewW = viewW;
      row.viewH = viewH;
      row.centerY = centerY;
    }

    // Labels (TIMER / STOPPUHR / DÜSSELDORF) platzieren
    layoutLabels(layout, viewW, viewH);

    if (_state.housingMesh && layout.length > 0) {
      var first = layout[0].box.top;
      var last = layout[layout.length - 1].box.bottom;
      var maxW = 0;
      for (var j = 0; j < layout.length; j++) {
        var rw = layout[j].box.right - layout[j].box.left;
        if (rw > maxW) maxW = rw;
      }
      // Gehäuse bis einschließlich Tasten
      var bb = layout.buttonBox;
      if (bb && bb.bottom > last) last = bb.bottom;
      if (layout.timerLabel && layout.timerLabel.top < first) first = layout.timerLabel.top;
      var hw = (maxW + 0.08) * viewW;
      var hh = (last - first + 0.06) * viewH;
      var hy = (0.5 - (first + last) / 2) * viewH;
      _state.housingMesh.scale.set(hw, hh, 1);
      _state.housingMesh.position.set(0, hy, -0.35);
    }

    layoutButtons(layout, viewW, viewH);

    _state.lastLayout = layout;
    markDirty();
  }

  /** Labels TIMER / STOPPUHR / DÜSSELDORF an den Layout-Boxen platzieren. */
  function layoutLabels(layout, viewW, viewH) {
    if (!_state.labels) return;
    function placeLabel(key, box) {
      var lab = _state.labels[key];
      if (!lab || !box) return;
      var cx = ((box.left + box.right) / 2 - 0.5) * viewW;
      var cy = (0.5 - (box.top + box.bottom) / 2) * viewH;
      var w = (box.right - box.left) * viewW;
      var h = (box.bottom - box.top) * viewH;
      lab.group.position.set(cx, cy, 0.05);
      lab.group.scale.set(w, h, 1);
    }
    placeLabel('timer', layout.timerLabel);
    placeLabel('stopwatch', layout.stopwatchLabel);
    placeLabel('city', layout.cityLabel);
  }

  /**
   * Tasten an den Layout-Boxen (layout.buttons) platzieren:
   * ▲/▼ über/unter Stunden- und Minuten-Paar, START/RESET unter der Anzeige.
   */
  function layoutButtons(layout, viewW, viewH) {
    if (!_state.buttons || _state.buttons.length === 0) return;
    var boxes = layout.buttons;
    if (!boxes) return;

    for (var i = 0; i < _state.buttons.length; i++) {
      var btn = _state.buttons[i];
      var box = boxes[btn.control];
      if (!box) continue;
      var cx = ((box.left + box.right) / 2 - 0.5) * viewW;
      var cy = (0.5 - (box.top + box.bottom) / 2) * viewH;
      var bw = (box.right - box.left) * viewW;
      var bh = (box.bottom - box.top) * viewH;
      btn.restX = cx;
      btn.restY = cy;
      btn.restZ = 0.14;
      btn.group.position.set(cx, cy, 0.14);
      // Geometrie btnBox: 1 x 0.45 x 0.12
      var scaleY = bh / 0.45;
      var scaleX = bw;
      btn.group.scale.set(scaleX, scaleY, scaleY);
    }
  }

  // ---------------------------------------------------------------------------
  // Interaktion (Raycaster, Mausrad, Tastendruck)
  // ---------------------------------------------------------------------------

  function bindEvents(canvas) {
    function onResize() {
      handleResize();
    }
    global.addEventListener('resize', onResize);

    canvas.addEventListener('pointermove', function (e) {
      updatePointer(e, canvas);
      var hit = raycastButton();
      if (hit !== _state.hoverButton) {
        if (_state.hoverButton) {
          _state.hoverButton.hover = false;
          if (_state.hoverButton.body && _state.hoverButton.body.material) {
            if (_state.hoverButton.body.material.emissive) {
              _state.hoverButton.body.material.emissive.setHex(0x000000);
            }
          }
        }
        _state.hoverButton = hit;
        if (hit) {
          hit.hover = true;
          if (hit.body && hit.body.material && hit.body.material.emissive) {
            hit.body.material.emissive.setHex(0x222226);
          }
        }
        markDirty();
      }
      canvas.style.cursor = hit ? 'pointer' : 'default';
    });

    canvas.addEventListener('pointerdown', function (e) {
      updatePointer(e, canvas);
      var hit = raycastButton();
      if (!hit) return;
      if (!_state.controlsVisible) return;
      hit.pressDir = 1;
      hit.press = 0;
      activityStart();
      markDirty();
    });

    canvas.addEventListener('pointerup', function (e) {
      updatePointer(e, canvas);
      for (var i = 0; i < _state.buttons.length; i++) {
        var b = _state.buttons[i];
        if (b.pressDir === 1) {
          b.pressDir = -1;
          activityStart();
        }
      }
      var hit = raycastButton();
      if (hit && _state.controlsVisible) {
        emitControl(hit.control);
      }
      markDirty();
    });

    canvas.addEventListener(
      'wheel',
      function (e) {
        if (!_state.controlsVisible) return;
        updatePointer(e, canvas);
        var target = raycastRow('timer');
        if (!target) return;
        e.preventDefault();
        var delta = e.deltaY < 0 ? 1 : -1;
        if (target.moduleIndex < 2) {
          emitControl(delta > 0 ? 'timerHourUp' : 'timerHourDown');
        } else if (target.moduleIndex < 4) {
          emitControl(delta > 0 ? 'timerMinUp' : 'timerMinDown');
        }
      },
      { passive: false }
    );
  }

  function updatePointer(e, canvas) {
    if (!_state.pointer || !_state.canvas) return;
    var rect = _state.canvas.getBoundingClientRect();
    var x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    var y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _state.pointer.set(x, y);
  }

  function raycastButton() {
    if (!_state.raycaster || !_state.buttons) return null;
    if (!_state.controlsVisible) return null;
    _state.raycaster.setFromCamera(_state.pointer, _state.camera);
    for (var i = 0; i < _state.buttons.length; i++) {
      var b = _state.buttons[i];
      if (!b.group.visible) continue;
      var hits = _state.raycaster.intersectObject(b.group, true);
      if (hits && hits.length > 0) return b;
    }
    return null;
  }

  function raycastRow(rowId) {
    if (!_state.raycaster) return null;
    var row = _state.modulesByRow && _state.modulesByRow[rowId];
    if (!row) return null;
    _state.raycaster.setFromCamera(_state.pointer, _state.camera);
    for (var i = 0; i < row.modules.length; i++) {
      var hits = _state.raycaster.intersectObject(row.modules[i].group, true);
      if (hits && hits.length > 0) {
        return { moduleIndex: i, rowId: rowId };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Animations-/Render-Loop (nur bei Aktivität)
  // ---------------------------------------------------------------------------

  function updateAnimations(now) {
    // freezeFlip: eingefrorene Flips der Uhrzeit-Zeile anwenden, aber
    // keinen Dauer-Loop erzwingen (Screenshot braucht nur einen Frame).
    if (_state.freezeFlip != null) {
      applyFreezeFlip();
      return false;
    }
    var anything = false;
    var ids = Object.keys(_state.modulesByRow || {});
    for (var r = 0; r < ids.length; r++) {
      var row = _state.modulesByRow[ids[r]];
      for (var m = 0; m < row.modules.length; m++) {
        var mod = row.modules[m];
        if (mod.running) {
          anything = true;
          if (!mod.flipStartTs) mod.flipStartTs = now;
          var t = now - mod.flipStartTs;
          var dur = mod.flipDurationMs;
          if (t >= dur) {
            // Flip beenden
            mod.char = mod.flipTo;
            applyStaticChar(mod, mod.char);
            mod.running = false;
            mod.flipStartTs = 0;
            hideLeaf(mod);
            // Nächstes Zeichen der Sequenz oder Modul inaktiv
            if (mod.seq && mod.seq.length > 0) {
              beginFlip(mod);
              anything = true;
            } else {
              setModActive(mod, false);
            }
          } else {
            var ang = flipAngle(t, dur);
            mod.pivot.rotation.x = ang;
            mod.leafBody.visible = true;
            mod.leafFront.visible = ang < Math.PI / 2;
            mod.leafBack.visible = ang >= Math.PI / 2;
            // Klack beim Aufschlag (Fortschritt ≥ FLIP_IMPACT), genau einmal
            var soundApi =
              typeof FlapSound !== 'undefined' && FlapSound ? FlapSound : null;
            playImpactClack(mod, t, dur, soundApi);
          }
        } else if (mod.pendingStart) {
          anything = true;
        }
      }
    }

    // Tastendruck
    for (var b = 0; b < _state.buttons.length; b++) {
      var btn = _state.buttons[b];
      if (btn.pressDir !== 0) {
        anything = true;
        var speed = 1 / 80;
        if (btn.pressDir === 1) {
          btn.press = Math.min(1, btn.press + speed * 16);
          if (btn.press >= 1) {
            btn.pressDir = -1;
          }
        } else {
          btn.press = Math.max(0, btn.press - speed * 16);
          if (btn.press <= 0) {
            btn.pressDir = 0;
            activityEnd();
          }
        }
        var depth = 0.025 * btn.press;
        btn.group.position.z = btn.restZ - depth;
      }
    }

    // Blinken
    var blinking = false;
    var blinkIds = Object.keys(_state.blink || {});
    for (var i = 0; i < blinkIds.length; i++) {
      if (_state.blink[blinkIds[i]]) blinking = true;
    }
    if (blinking) {
      anything = true;
      if (now - _state.lastBlinkTs > 350) {
        _state.lastBlinkTs = now;
        _state.blinkPhase = _state.blinkPhase ? 0 : 1;
        for (var bi = 0; bi < blinkIds.length; bi++) {
          if (!_state.blink[blinkIds[bi]]) continue;
          var brows = _state.modulesByRow[blinkIds[bi]];
          if (!brows) continue;
          for (var mi = 0; mi < brows.modules.length; mi++) {
            brows.modules[mi].group.visible = !!_state.blinkPhase;
          }
        }
      }
    }

    return anything;
  }

  tick = function (now) {
    _state.loopRunning = true;
    if (typeof now !== 'number') {
      now =
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now();
    }

    var active = updateAnimations(now);

    if (_state.renderer && _state.scene && _state.camera) {
      _state.renderer.render(_state.scene, _state.camera);
      _state.frames = (_state.frames | 0) + 1;
      writeDebug();
    }
    _state.needRender = false;

    if (_state.activity > 0 || active) {
      requestAnimationFrame(tick);
    } else {
      _state.loopRunning = false;
      writeDebug();
    }
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  var exported = {
    flipAngle: flipAngle,
    layoutRows: layoutRows,
    flapSequence: flapSequence,
    createModulePlan: createModulePlan,
    glyphBaselineY: glyphBaselineY,
    labelTextureSize: labelTextureSize,
    flipDurationFor: flipDurationFor,
    stepDurationFor: stepDurationFor,
    shadowMapSizeFor: shadowMapSizeFor,
    sceneSpec: sceneSpec,
    playImpactClack: playImpactClack,
    CONTROL_NAMES: CONTROL_NAMES,
    DEFAULT_LAYOUT: DEFAULT_LAYOUT,
    FlapRenderer: FlapRenderer,
    MODULE_ASPECT: MODULE_ASPECT,
    FLIP_OVERSHOOT: FLIP_OVERSHOOT,
    BUTTON_BAND_H: BUTTON_BAND_H,
    FLIP_MS_BIG: FLIP_MS_BIG,
    FLIP_MS_SMALL: FLIP_MS_SMALL,
    FLIP_IMPACT: FLIP_IMPACT,
    FLIP_STEP_FAST: FLIP_STEP_FAST,
    CAMERA_TILT_DEG: CAMERA_TILT_DEG,
    THICKNESS_RATIO: THICKNESS_RATIO,
    STACK_EDGE_COUNT: STACK_EDGE_COUNT,
    FRAME_DEPTH_RATIO: FRAME_DEPTH_RATIO,
    FRAME_OVERHANG: FRAME_OVERHANG,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (global) {
    global.FlapRenderer = FlapRenderer;
    global.Flap3D = exported;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
