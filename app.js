/*
 * Eye Control web app.
 * Webcam -> MediaPipe FaceMesh (in the browser) -> side + up/down angles -> Web Serial -> Arduino.
 * The Arduino runs arduino/eye_servo/eye_servo.ino, which reads "pan,tilt" (or just "pan") per line.
 */
(function () {
  "use strict";

  var L = window.EyeLogic;
  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  var BAUD = 9600;
  var SMOOTH_H = 0.35, SMOOTH_V = 0.30;   // 0..1, lower = smoother but slower
  var KEEPALIVE_MS = 500;                 // resend so the Arduino's 2 s timeout never fires
  var CLOSED_EAR = 0.15;                  // eye openness below this = eye closed
  var DEAD_V = 0.05, WEAK_KEEP = 0.30;    // up/down dead zone, calming of the weaker axis
  var SETTINGS_KEY = "eyeControlSettings.v2";
  var encoder = new TextEncoder();
  var STEPS = [
    { key: "low", axis: "h", label: "LEFT" }, { key: "high", axis: "h", label: "RIGHT" },
    { key: "vUp", axis: "v", label: "UP" }, { key: "vDown", axis: "v", label: "DOWN" },
  ];
  var MODE_HINT = {
    auto: "Both eyes closed – holding position", both: "Both eyes must be open",
    left: "Open your LEFT eye", right: "Open your RIGHT eye",
  };

  var state = {
    port: null, writer: null, serialReady: false,
    stream: null, running: false, faceMesh: null, busy: false, aspect: 0.75,
    hS: 0, vS: 0, haveSig: false,
    low: 0.40, high: 0.60, vUp: -0.02, vDown: 0.12, calibrated: false,
    flip: true, flipTilt: true, useTilt: true, eyeMode: "auto", vGain: 1.5,
    range: L.MAX_RANGE, tiltRange: L.MAX_TILT,
    pan: L.CENTER, tilt: L.CENTER, lastMsg: null, lastSentAt: 0,
    holdUntil: 0, holdTimer: null, calib: null,
  };
  var SAVED = ["low", "high", "vUp", "vDown", "calibrated", "flip", "flipTilt", "useTilt",
               "eyeMode", "vGain", "range", "tiltRange"];

  // ---------- saved settings ----------
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (!s) return;
      SAVED.forEach(function (k) { if (typeof s[k] === typeof state[k]) state[k] = s[k]; });
      state.range = clamp(state.range, 10, L.MAX_RANGE);
      state.tiltRange = clamp(state.tiltRange, 10, L.MAX_TILT);
      if (["auto", "both", "left", "right"].indexOf(state.eyeMode) < 0) state.eyeMode = "auto";
    } catch (e) { /* storage may be blocked; that is fine */ }
  }
  function saveSettings() {
    try {
      var o = {}; SAVED.forEach(function (k) { o[k] = state[k]; });
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(o));
    } catch (e) { /* ignore */ }
  }

  // ---------- small UI helpers ----------
  function setPill(id, text, cls) { var el = $(id); el.textContent = text; el.className = "pill " + cls; }
  function showMsg(text, kind) {
    var el = $("message");
    if (!text) { el.className = ""; el.textContent = ""; return; }
    el.textContent = text; el.className = kind || "info";
  }
  function setStage(text) { $("stageMsg").textContent = text || ""; }
  function updateDials(pan, tilt) {
    $("angleText").textContent = pan; $("tiltText").textContent = tilt;
    $("needleP").setAttribute("transform", "rotate(" + ((pan - L.CENTER) * 2) + " 100 100)");
    $("needleT").setAttribute("transform", "rotate(" + ((tilt - L.CENTER) * 2) + " 100 100)");
  }
  function updateCalibText() {
    $("calibText").textContent = state.calibrated
      ? "Calibrated (side " + state.low.toFixed(2) + " to " + state.high.toFixed(2) +
        "; up/down " + state.vUp.toFixed(2) + " to " + state.vDown.toFixed(2) + ")."
      : "Using default settings. Calibrating makes it work better for your eyes.";
  }
  function updateButtons() {
    var ser = state.serialReady;
    ["btnTestLeft", "btnTestCenter", "btnTestRight"].forEach(function (id) { $(id).disabled = !ser; });
    ["btnTestUp", "btnTestTiltCenter", "btnTestDown"].forEach(function (id) { $(id).disabled = !(ser && state.useTilt); });
    $("btnCalibrate").disabled = !state.running; $("btnReset").disabled = !state.running && !state.calibrated;
    $("btnConnect").textContent = ser ? "Disconnect" : "Connect Arduino";
  }
  function centreMsg() { return state.useTilt ? L.CENTER + "," + L.CENTER : String(L.CENTER); }

  // ---------- Arduino over Web Serial ----------
  async function connectSerial() {
    if (state.serialReady) { await disconnectSerial(); return; }
    if (!("serial" in navigator)) { showMsg("This browser can't use USB devices. Open the page in Chrome or Edge.", "error"); return; }
    try {
      var port = await navigator.serial.requestPort();
      $("btnConnect").disabled = true;
      setPill("serialStatus", "Connecting…", "warn");
      await port.open({ baudRate: BAUD });
      state.port = port;
      state.writer = port.writable.getWriter();
      port.addEventListener("disconnect", onSerialLost);
      setPill("serialStatus", "Starting Arduino…", "warn");
      await sleep(2000);                          // the Arduino restarts when the port opens
      if (state.port !== port) return;            // unplugged during the wait
      state.serialReady = true;
      setPill("serialStatus", "Connected", "on");
      showMsg("", "");
      sendPose(L.CENTER, L.CENTER, true);
    } catch (e) {
      cleanupSerial();
      if (e && e.name === "NotFoundError") {      // user closed the picker
        setPill("serialStatus", "Not connected", "off");
      } else {
        setPill("serialStatus", "Not connected", "bad");
        showMsg("Could not open the Arduino. Close the Arduino IDE Serial Monitor (and any other program using it), unplug and replug the USB cable, then try again.", "error");
      }
    } finally {
      $("btnConnect").disabled = false;
      updateButtons();
    }
  }

  function cleanupSerial() {
    var w = state.writer, p = state.port;
    state.writer = null; state.port = null; state.serialReady = false; state.lastMsg = null;
    try { if (w) w.releaseLock(); } catch (e) { /* ignore */ }
    try { if (p) p.close().catch(function () {}); } catch (e) { /* ignore */ }
  }

  async function disconnectSerial() {
    try { if (state.writer) await state.writer.write(encoder.encode(centreMsg() + "\n")); } catch (e) { /* ignore */ }
    var w = state.writer, p = state.port;
    state.writer = null; state.port = null; state.serialReady = false; state.lastMsg = null;
    try { if (w) w.releaseLock(); } catch (e) { /* ignore */ }
    try { if (p) await p.close(); } catch (e) { /* ignore */ }
    setPill("serialStatus", "Not connected", "off");
    updateButtons();
  }

  function onSerialLost() {
    if (!state.port && !state.writer) return;
    cleanupSerial();
    setPill("serialStatus", "Disconnected", "bad");
    showMsg("The Arduino was unplugged or stopped responding. Plug it back in and press “Connect Arduino”.", "error");
    updateButtons();
  }

  // Sends "pan,tilt" (or just "pan" when the up/down servo is switched off).
  function sendPose(pan, tilt, force) {
    state.pan = pan; state.tilt = tilt;
    updateDials(pan, tilt);
    if (!state.serialReady || !state.writer) return;
    var msg = state.useTilt ? pan + "," + tilt : String(pan);
    var now = Date.now();
    if (!force && msg === state.lastMsg && now - state.lastSentAt < KEEPALIVE_MS) return;
    state.lastMsg = msg; state.lastSentAt = now;
    state.writer.write(encoder.encode(msg + "\n")).catch(onSerialLost);
  }

  function testPose(pan, tilt) {
    // Pause eye tracking for 2 s and keep resending the test pose so the Arduino holds it.
    state.holdUntil = Date.now() + 2000;
    sendPose(pan, tilt, true);
    if (state.holdTimer) clearInterval(state.holdTimer);
    state.holdTimer = setInterval(function () {
      if (Date.now() >= state.holdUntil) { clearInterval(state.holdTimer); state.holdTimer = null; return; }
      sendPose(pan, tilt, false);
    }, 250);
  }

  // ---------- camera + eye tracking ----------
  async function startCamera() {
    if (state.running) { await stopCamera(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showMsg("This browser can't use the camera. Use Chrome or Edge, and open the page from its web address (https).", "error"); return;
    }
    if (typeof window.FaceMesh === "undefined") {
      showMsg("The eye-tracking files did not load. Check your internet connection and refresh the page.", "error"); return;
    }
    $("btnCamera").disabled = true;
    try {
      setPill("cameraStatus", "Starting camera…", "warn");
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false,
      });
      var video = $("video");
      video.srcObject = state.stream;
      await video.play();
      var overlay = $("overlay");
      overlay.width = video.videoWidth || 640; overlay.height = video.videoHeight || 480;
      state.aspect = overlay.height / overlay.width;
      $("stageIdle").style.display = "none";

      if (!state.faceMesh) {
        setPill("cameraStatus", "Loading eye tracker…", "warn");
        setStage("Loading the eye tracker (first time only)…");
        var fm = new window.FaceMesh({ locateFile: function (f) { return "mediapipe/" + f; } });
        fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        fm.onResults(handleResults);
        await fm.initialize();
        state.faceMesh = fm;
      }
      state.running = true; state.haveSig = false;
      $("btnCamera").textContent = "Stop camera";
      setPill("cameraStatus", "Camera on", "on");
      setStage("Looking for your face…");
      showMsg("", "");
      loop();
    } catch (e) {
      stopStream();
      setPill("cameraStatus", "Camera off", "bad");
      $("stageIdle").style.display = "grid";
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        showMsg("The camera is blocked. Click the camera icon in the address bar, allow it, and try again.", "error");
      } else if (e && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) {
        showMsg("No camera was found on this computer.", "error");
      } else if (e && e.name === "NotReadableError") {
        showMsg("The camera is being used by another app. Close it and try again.", "error");
      } else {
        showMsg("Could not start the camera or the eye tracker. Refresh the page and try again. (" + (e && e.message ? e.message : e) + ")", "error");
      }
    } finally {
      $("btnCamera").disabled = false;
      updateButtons();
    }
  }

  function stopStream() {
    if (state.stream) { state.stream.getTracks().forEach(function (t) { t.stop(); }); state.stream = null; }
    $("video").srcObject = null;
  }

  async function stopCamera() {
    state.running = false; state.calib = null;
    stopStream();
    var o = $("overlay"); o.getContext("2d").clearRect(0, 0, o.width, o.height);
    $("stageIdle").style.display = "grid";
    setStage("");
    $("btnCamera").textContent = "Start camera";
    setPill("cameraStatus", "Camera off", "off");
    sendPose(L.CENTER, L.CENTER, true);
    $("ratioText").textContent = "–"; $("eyesText").textContent = "–";
    updateButtons();
  }

  function loop() {
    if (!state.running) return;
    var video = $("video");
    if (video.readyState >= 2 && !state.busy) {
      state.busy = true;
      state.faceMesh.send({ image: video })
        .catch(function () { /* a dropped frame is fine */ })
        .then(function () { state.busy = false; });
    }
    requestAnimationFrame(loop);
  }

  function drawIris(lm) {
    var o = $("overlay"), ctx = o.getContext("2d");
    ctx.clearRect(0, 0, o.width, o.height);
    ctx.fillStyle = "#22d3ee";
    [468, 473].forEach(function (i) {
      if (!lm[i]) return;
      ctx.beginPath(); ctx.arc(lm[i].x * o.width, lm[i].y * o.height, 4, 0, Math.PI * 2); ctx.fill();
    });
  }

  function handleResults(results) {
    if (!state.running) return;
    var faces = results.multiFaceLandmarks;
    if (!faces || !faces.length || faces[0].length < 478) {
      var o = $("overlay"); o.getContext("2d").clearRect(0, 0, o.width, o.height);
      setStage(state.calib ? "I can't see your face – look at the camera" : "No face found – look at the camera");
      tickCalibration(null);
      return;
    }
    var lm = faces[0];
    drawIris(lm);

    var m = L.measure(lm, state.eyeMode, state.aspect, CLOSED_EAR);
    $("eyesText").textContent = "L " + (m.oL > CLOSED_EAR ? "open" : "closed") + " " + m.oL.toFixed(2) +
                                " · R " + (m.oR > CLOSED_EAR ? "open" : "closed") + " " + m.oR.toFixed(2);
    if (m.n) {                                    // only learn from open eyes (blinks are ignored)
      state.hS = state.haveSig ? L.smooth(state.hS, m.h, SMOOTH_H) : m.h;
      state.vS = state.haveSig ? L.smooth(state.vS, m.v, SMOOTH_V) : m.v;
      state.haveSig = true;
    }
    $("ratioText").textContent = state.haveSig
      ? state.hS.toFixed(2) + (state.useTilt ? " / " + state.vS.toFixed(2) : "") : "–";

    if (state.calib) { tickCalibration(m); return; }
    if (Date.now() < state.holdUntil) return;      // a servo test is running
    if (!state.haveSig) { setStage(MODE_HINT[state.eyeMode]); return; }
    if (!m.n) { setStage(MODE_HINT[state.eyeMode]); sendPose(state.pan, state.tilt, false); return; }

    var nh = L.norm(state.hS, state.low, state.high, 1, 0), nv = 0;
    if (state.useTilt) {
      nv = L.norm(state.vS, state.vUp, state.vDown, state.vGain, DEAD_V);
      var r = L.suppress(nh, nv, WEAK_KEEP); nh = r[0]; nv = r[1];
    }
    setStage("Looking good – move your eyes");
    sendPose(L.toAngle(nh, state.range, state.flip),
             state.useTilt ? L.toAngle(nv, state.tiltRange, state.flipTilt) : L.CENTER, false);
  }

  // ---------- calibration wizard: left, right, (up, down) ----------
  var COUNTDOWN_MS = 2000, SAMPLE_MS = 1500;

  function startCalibration() {
    if (!state.running) { showMsg("Start the camera first.", "warn"); return; }
    showMsg("", "");
    state.calib = { i: 0, steps: state.useTilt ? STEPS : STEPS.slice(0, 2), t0: performance.now(), samples: [], res: {} };
  }

  function tickCalibration(m) {
    var c = state.calib; if (!c) return;
    var s = c.steps[c.i], el = performance.now() - c.t0;
    if (el < COUNTDOWN_MS) {
      setStage("Look fully " + s.label + " and hold… " + Math.ceil((COUNTDOWN_MS - el) / 1000));
      return;
    }
    if (el < COUNTDOWN_MS + SAMPLE_MS) {
      setStage("Hold still…");
      if (m && m.n) c.samples.push(s.axis === "h" ? m.h : m.v);
      return;
    }
    var avg = L.mean(c.samples);
    if (avg === null || c.samples.length < 5) {
      state.calib = null;
      showMsg("I couldn't see your open eye during calibration. Face the camera, add light, keep the eye you use open, and try again.", "warn");
      return;
    }
    c.res[s.key] = avg;
    if (++c.i < c.steps.length) { c.t0 = performance.now(); c.samples = []; return; }

    var r = c.res;
    var okH = Math.abs(r.high - r.low) >= 0.04;
    var okV = !state.useTilt || Math.abs(r.vDown - r.vUp) >= 0.015;
    state.calib = null;
    if (okH) { state.low = r.low; state.high = r.high; }
    if (state.useTilt && okV) { state.vUp = r.vUp; state.vDown = r.vDown; }
    if (okH || (state.useTilt && okV)) state.calibrated = true;
    saveSettings(); updateCalibText(); updateButtons();
    if (okH && okV) showMsg("Calibration done. Now move your eyes.", "ok");
    else showMsg((okH ? "" : "Side movement was too small – look further left and right. ") +
                 (okV ? "" : "Up/down movement was too small – look further up and down. ") +
                 "Turn only your eyes, then calibrate again.", "warn");
  }

  function resetCalibration() {
    state.low = 0.40; state.high = 0.60; state.vUp = -0.02; state.vDown = 0.12;
    state.calibrated = false; state.calib = null;
    saveSettings(); updateCalibText(); updateButtons();
    showMsg("Calibration reset to the default settings.", "info");
  }

  // ---------- start-up ----------
  function bindCheck(id, key) {
    $(id).checked = state[key];
    $(id).addEventListener("change", function (e) { state[key] = e.target.checked; saveSettings(); updateButtons(); });
  }
  function bindRange(id, valId, key) {
    $(id).value = state[key]; $(valId).textContent = state[key];
    $(id).addEventListener("input", function (e) {
      state[key] = Number(e.target.value); $(valId).textContent = state[key]; saveSettings();
    });
  }

  function init() {
    loadSettings();
    bindCheck("chkFlip", "flip"); bindCheck("chkFlipTilt", "flipTilt"); bindCheck("chkTilt", "useTilt");
    bindRange("rngRange", "rangeVal", "range"); bindRange("rngTilt", "tiltVal", "tiltRange");
    bindRange("rngGain", "gainVal", "vGain");
    $("selEyeMode").value = state.eyeMode;
    $("selEyeMode").addEventListener("change", function (e) {
      state.eyeMode = e.target.value; saveSettings();
      showMsg("Eye mode changed. For best results press Calibrate again, using the eye(s) you will control with.", "info");
    });
    updateCalibText(); updateDials(L.CENTER, L.CENTER); updateButtons();

    if (!("serial" in navigator)) {
      $("unsupported").hidden = false;
      $("btnConnect").disabled = true;
      setPill("serialStatus", "Not supported here", "bad");
    }

    $("btnConnect").addEventListener("click", connectSerial);
    $("btnCamera").addEventListener("click", startCamera);
    $("btnCalibrate").addEventListener("click", startCalibration);
    $("btnReset").addEventListener("click", resetCalibration);
    $("btnTestLeft").addEventListener("click", function () { testPose(L.CENTER - state.range, L.CENTER); });
    $("btnTestCenter").addEventListener("click", function () { testPose(L.CENTER, L.CENTER); });
    $("btnTestRight").addEventListener("click", function () { testPose(L.CENTER + state.range, L.CENTER); });
    // "Up" / "Down" = the angle the servo gets when YOU look up / down (follows "Reverse up/down").
    $("btnTestUp").addEventListener("click", function () { testPose(L.CENTER, L.toAngle(-1, state.tiltRange, state.flipTilt)); });
    $("btnTestTiltCenter").addEventListener("click", function () { testPose(L.CENTER, L.CENTER); });
    $("btnTestDown").addEventListener("click", function () { testPose(L.CENTER, L.toAngle(1, state.tiltRange, state.flipTilt)); });

    // Let the page work offline after the first visit (needs https or localhost).
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* optional feature */ });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
