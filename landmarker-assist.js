/*
 * Face Landmarker assist for the UP / DOWN eye axis.
 *
 * WHY: the original up/down value (iris height compared with the line between the eye corners)
 * barely changes for small eyeball movements, so the up/down servo sat at its limit.
 * The MediaPipe Face Landmarker also reports the EYELIDS: 52 blendshape scores such as
 * eyeLookUpLeft / eyeLookDownLeft (they come from iris + upper/lower lid shape), plus the lid
 * landmarks. Those react clearly even to a tiny up/down glance.
 *
 * HOW (additive, nothing in app.js / logic.js was edited):
 *   - This file wraps EyeLogic.measure(). It calls the original first, then replaces ONLY the
 *     vertical value `v` with a Face-Landmarker value on the SAME scale (centre 0.05, span +-0.07),
 *     so the existing calibration, dead zone, gain, smoothing and servo mapping keep working.
 *   - If the Face Landmarker is loading, fails, finds no face, or is switched off, the original
 *     value is returned untouched (automatic fallback to the old behaviour).
 *   - Side (left/right) detection is not touched.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EyeLandmarkerAssist = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Same eye landmark numbers as logic.js (person's right = R, person's left = L).
  var EYES = {
    R: { outer: 33,  inner: 133, iris: 468, up: 159, low: 145, side: "Right" },
    L: { outer: 263, inner: 362, iris: 473, up: 386, low: 374, side: "Left"  },
  };
  // Eyelid outlines (standard FaceMesh eye contour) – drawn on the camera picture.
  var LID_OUTLINE = {
    R: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    L: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  };

  // Output scale: must match the defaults in app.js (vUp = -0.02, vDown = 0.12).
  var V_CENTER = 0.05, V_SPAN = 0.07;
  // Blendshape (look down - look up) of about +-0.5 is a strong glance; lid ratio moves about +-0.2.
  var BS_SCALE = 0.5, LID_SCALE = 0.2;
  var W_BS = 0.7, W_LID = 0.3;     // blendshapes lead, lid-gap ratio supports
  var BLINK_SKIP = 0.7;            // eyeBlink above this = lids closing, ignore that eye

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  // blendshape categories ([{categoryName, score}]) -> { name: score }
  function toMap(categories) {
    var m = {};
    for (var i = 0; categories && i < categories.length; i++) m[categories[i].categoryName] = categories[i].score;
    return m;
  }

  // Where the iris sits between the upper and lower eyelid: 0 = at the upper lid, 1 = at the lower lid.
  function lidRatio(lm, e) {
    var gap = lm[e.low].y - lm[e.up].y;
    if (Math.abs(gap) < 1e-6) return 0.5;
    return (lm[e.iris].y - lm[e.up].y) / gap;
  }

  // Up/down "look" of ONE eye. Positive = looking DOWN, negative = looking UP. Roughly -1..+1.
  function eyeLook(map, lm, key) {
    var e = EYES[key];
    var bs = (map["eyeLookDown" + e.side] || 0) - (map["eyeLookUp" + e.side] || 0);
    var d = W_BS * (bs / BS_SCALE);
    if (lm && lm[e.iris] && lm[e.up] && lm[e.low]) d += W_LID * ((lidRatio(lm, e) - 0.5) / LID_SCALE);
    else d = bs / BS_SCALE;           // no landmarks: blendshapes only
    return d;
  }

  // Which eyes does EyeLogic.measure use? (mirrors its rules so both agree)
  function usedEyes(m, mode, closedAt) {
    var openL = m.oL > closedAt, openR = m.oR > closedAt, use = [];
    if (mode === "left") { if (openL) use.push("L"); }
    else if (mode === "right") { if (openR) use.push("R"); }
    else if (mode === "both") { if (openL && openR) use.push("L", "R"); }
    else { if (openL) use.push("L"); if (openR) use.push("R"); }
    return use;
  }

  // Fused up/down value on the app's own scale, or null if it can't be computed.
  function fusedV(det, use) {
    if (!det || !use.length) return null;
    var sum = 0, n = 0;
    use.forEach(function (k) {
      var blink = det.map["eyeBlink" + EYES[k].side] || 0;
      if (blink > BLINK_SKIP) return;
      sum += eyeLook(det.map, det.lm, k); n++;
    });
    return n ? V_CENTER + V_SPAN * (sum / n) : null;
  }

  // Wrap EyeLogic.measure. getDetection() -> {map, lm} | null ; isOn() -> boolean
  function patchMeasure(Logic, getDetection, isOn, onFused) {
    var original = Logic.measure;
    Logic.measure = function (lm, mode, aspect, closedAt) {
      var m = original.apply(this, arguments);
      try {
        if (!m || !m.n || !isOn()) return m;
        var det = getDetection();
        var v = fusedV(det, usedEyes(m, mode, closedAt));
        if (v !== null) { m.vOld = m.v; m.v = v; m.src = "landmarker"; if (onFused) onFused(m, det); }
      } catch (err) { /* any problem -> keep the original value */ }
      return m;
    };
    Logic.measure.original = original;
    return original;
  }

  /* ------------------------- browser wiring (skipped in tests) ------------------------- */
  var API = {
    EYES: EYES, LID_OUTLINE: LID_OUTLINE, V_CENTER: V_CENTER, V_SPAN: V_SPAN,
    toMap: toMap, lidRatio: lidRatio, eyeLook: eyeLook, usedEyes: usedEyes, fusedV: fusedV,
    patchMeasure: patchMeasure,
  };
  if (typeof window === "undefined" || typeof document === "undefined" || !window.EyeLogic) return API;

  var VERSION = "0.10.14";   // pinned @mediapipe/tasks-vision
  var CANDIDATES = [
    { // 1) files bundled in the repo (works offline, no third-party server)
      bundle: new URL("mediapipe-tasks/vision_bundle.mjs", document.baseURI).href,
      wasm:   new URL("mediapipe-tasks/wasm", document.baseURI).href,
      model:  new URL("mediapipe-tasks/face_landmarker.task", document.baseURI).href,
    },
    { // 2) public CDN fallback
      bundle: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + VERSION + "/vision_bundle.mjs",
      wasm:   "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + VERSION + "/wasm",
      model:  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    },
  ];
  var PREF_KEY = "eyeControlLM.v1";
  var S = { landmarker: null, ready: false, failed: false, loading: false, enabled: true,
            errors: 0, lastTs: 0, last: null, uiAt: 0, notified: false };

  function $(id) { return document.getElementById(id); }
  function loadPref() { try { var p = JSON.parse(localStorage.getItem(PREF_KEY) || "null"); if (p && typeof p.enabled === "boolean") S.enabled = p.enabled; } catch (e) {} }
  function savePref() { try { localStorage.setItem(PREF_KEY, JSON.stringify({ enabled: S.enabled })); } catch (e) {} }

  function setStatus(text, color) {
    var el = $("lmStatus"); if (!el) return;
    el.textContent = text; el.style.color = color || "";
  }

  async function createFrom(c) {
    var mod = await import(c.bundle);
    var fileset = await mod.FilesetResolver.forVisionTasks(c.wasm);
    function opts(delegate) {
      return { baseOptions: { modelAssetPath: c.model, delegate: delegate }, runningMode: "VIDEO", numFaces: 1,
               outputFaceBlendshapes: true, minFaceDetectionConfidence: 0.5,
               minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 };
    }
    try { return await mod.FaceLandmarker.createFromOptions(fileset, opts("GPU")); }
    catch (e) { return await mod.FaceLandmarker.createFromOptions(fileset, opts("CPU")); }
  }

  async function load() {
    if (S.loading || S.ready) return;
    S.loading = true; setStatus("Face Landmarker: loading…", "");
    for (var i = 0; i < CANDIDATES.length; i++) {
      try {
        S.landmarker = await createFrom(CANDIDATES[i]);
        S.ready = true; S.failed = false; S.errors = 0;
        setStatus("Face Landmarker: ready – waiting for your face", "");
        S.loading = false;
        notifyRecalibrate();
        return;
      } catch (e) { if (window.console) console.warn("Face Landmarker source " + (i + 1) + " failed:", e); }
    }
    S.loading = false; S.failed = true;
    setStatus("Face Landmarker: unavailable – using standard up/down tracking", "#b45309");
  }

  // One-time hint: the up/down signal changed, so a fresh calibration gives the best result.
  function notifyRecalibrate() {
    try { if (localStorage.getItem(PREF_KEY + ".notified")) return; localStorage.setItem(PREF_KEY + ".notified", "1"); } catch (e) {}
    var el = $("message"); if (!el) return;
    el.textContent = "Eyelid tracking (Face Landmarker) is now on for up/down. Press Calibrate once, so it learns your eyes.";
    el.className = "info";
  }

  function detect() {
    var video = $("video");
    if (!S.ready || !video || video.readyState < 2) return null;
    var ts = performance.now(); if (ts <= S.lastTs) ts = S.lastTs + 1; S.lastTs = ts;
    var res;
    try { res = S.landmarker.detectForVideo(video, ts); S.errors = 0; }
    catch (e) {
      if (++S.errors >= 5) { S.ready = false; S.failed = true; setStatus("Face Landmarker stopped – using standard up/down tracking", "#b45309"); }
      return null;
    }
    if (!res || !res.faceLandmarks || !res.faceLandmarks.length ||
        !res.faceBlendshapes || !res.faceBlendshapes.length) { S.last = null; return null; }
    S.last = { lm: res.faceLandmarks[0], map: toMap(res.faceBlendshapes[0].categories) };
    return S.last;
  }

  // Draw the detected eyelids on the camera picture (same mirrored canvas as the iris dots).
  function drawLids(det) {
    var o = $("overlay"); if (!o || !det) return;
    var ctx = o.getContext("2d"), W = o.width, H = o.height;
    ctx.save();
    ctx.lineWidth = 2; ctx.strokeStyle = "#facc15"; ctx.fillStyle = "#f472b6";
    ["R", "L"].forEach(function (k) {
      var idx = LID_OUTLINE[k], e = EYES[k];
      ctx.beginPath();
      idx.forEach(function (i, j) { var p = det.lm[i]; if (!p) return; (j ? ctx.lineTo : ctx.moveTo).call(ctx, p.x * W, p.y * H); });
      ctx.closePath(); ctx.stroke();
      [e.up, e.low].forEach(function (i) {
        var p = det.lm[i]; if (!p) return;
        ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 3, 0, Math.PI * 2); ctx.fill();
      });
    });
    ctx.restore();
  }

  function onFused(m, det) {
    drawLids(det);
    var now = Date.now(); if (now - S.uiAt < 200) return; S.uiAt = now;
    var dn = ((det.map.eyeLookDownLeft || 0) + (det.map.eyeLookDownRight || 0)) / 2;
    var up = ((det.map.eyeLookUpLeft || 0) + (det.map.eyeLookUpRight || 0)) / 2;
    var dir = dn - up > 0.05 ? "▼ down" : (up - dn > 0.05 ? "▲ up" : "● centre");
    setStatus("Face Landmarker: active · " + dir + " · lid up " + up.toFixed(2) + " / down " + dn.toFixed(2), "#15803d");
  }

  function buildUi() {
    var eyes = $("eyesText"), flip = $("chkFlipTilt");
    if (eyes && eyes.parentNode && !$("lmStatus")) {
      var d = document.createElement("div"); d.id = "lmStatus"; d.className = "small"; d.textContent = "Face Landmarker: starting…";
      eyes.parentNode.insertAdjacentElement("afterend", d);
    }
    if (flip && flip.closest && !$("chkLandmarker")) {
      var lab = document.createElement("label"); lab.className = "field";
      lab.innerHTML = '<input type="checkbox" id="chkLandmarker"> Use eyelid tracking for up/down (Face Landmarker – recommended)';
      flip.closest("label").insertAdjacentElement("afterend", lab);
      var cb = $("chkLandmarker"); cb.checked = S.enabled;
      cb.addEventListener("change", function (e) {
        S.enabled = e.target.checked; savePref();
        setStatus(S.enabled ? "Face Landmarker: on" : "Face Landmarker: off – using standard up/down tracking", "");
      });
    }
  }

  function start() {
    loadPref(); buildUi();
    patchMeasure(window.EyeLogic, detect, function () { return S.enabled && S.ready; }, onFused);
    if (!S.enabled) setStatus("Face Landmarker: off – using standard up/down tracking", "");
    // Load after the page is idle so the first paint and FaceMesh start are not slowed down.
    setTimeout(load, 600);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  API.state = S;
  return API;
});
