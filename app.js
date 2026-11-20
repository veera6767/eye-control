/*
 * Eye Control web app.
 * Webcam -> MediaPipe FaceMesh (runs in the browser) -> angle -> Web Serial -> Arduino.
 * The Arduino runs arduino/eye_servo/eye_servo.ino, which reads one angle per line.
 */
(function () {
  "use strict";

  var L = window.EyeLogic;
  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var BAUD = 9600;
  var SMOOTH = 0.35;          // 0..1, lower = smoother but slower
  var KEEPALIVE_MS = 500;     // resend angle so the Arduino's 2 s timeout never fires
  var SETTINGS_KEY = "eyeControlSettings.v1";
  var encoder = new TextEncoder();

  var state = {
    port: null, writer: null, serialReady: false,
    stream: null, running: false, faceMesh: null, busy: false,
    ratioS: 0.5, haveRatio: false,
    low: 0.40, high: 0.60, flip: true, range: L.MAX_RANGE, calibrated: false,
    lastSent: null, lastSentAt: 0, holdUntil: 0, holdAngle: L.CENTER, holdTimer: null,
    calib: null,
  };

  // ---------- saved settings ----------
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (s && typeof s.low === "number" && typeof s.high === "number") {
        state.low = s.low; state.high = s.high; state.calibrated = !!s.calibrated;
        if (typeof s.flip === "boolean") state.flip = s.flip;
        if (typeof s.range === "number") state.range = Math.max(10, Math.min(L.MAX_RANGE, s.range));
      }
    } catch (e) { /* storage may be blocked; that is fine */ }
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        low: state.low, high: state.high, flip: state.flip, range: state.range, calibrated: state.calibrated,
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------- small UI helpers ----------
  function setPill(id, text, cls) {
    var el = $(id); el.textContent = text; el.className = "pill " + cls;
  }
  function showMsg(text, kind) {
    var el = $("message");
    if (!text) { el.className = ""; el.textContent = ""; return; }
    el.textContent = text; el.className = kind || "info";
  }
  function setStage(text) { $("stageMsg").textContent = text || ""; }
  function updateDial(angle) {
    $("angleText").textContent = angle;
    $("needle").setAttribute("transform", "rotate(" + ((angle - L.CENTER) * 2) + " 100 100)");
  }
  function updateCalibText() {
    $("calibText").textContent = state.calibrated
      ? "Calibrated (left " + state.low.toFixed(2) + ", right " + state.high.toFixed(2) + ")."
      : "Using default settings. Calibrating makes it work better for your eyes.";
  }
  function updateButtons() {
    var ser = state.serialReady;
    $("btnTestLeft").disabled = !ser; $("btnTestCenter").disabled = !ser; $("btnTestRight").disabled = !ser;
    $("btnCalibrate").disabled = !state.running; $("btnReset").disabled = !state.running && !state.calibrated;
    $("btnConnect").textContent = ser ? "Disconnect" : "Connect Arduino";
  }

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
      sendAngle(L.CENTER, true);
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
    state.writer = null; state.port = null; state.serialReady = false; state.lastSent = null;
    try { if (w) w.releaseLock(); } catch (e) { /* ignore */ }
    try { if (p) p.close().catch(function () {}); } catch (e) { /* ignore */ }
  }

  async function disconnectSerial() {
    try { if (state.writer) await state.writer.write(encoder.encode(L.CENTER + "\n")); } catch (e) { /* ignore */ }
    var w = state.writer, p = state.port;
    state.writer = null; state.port = null; state.serialReady = false; state.lastSent = null;
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

  function sendAngle(angle, force) {
    updateDial(angle);
    if (!state.serialReady || !state.writer) return;
    var now = Date.now();
    if (!force && angle === state.lastSent && now - state.lastSentAt < KEEPALIVE_MS) return;
    state.lastSent = angle; state.lastSentAt = now;
    state.writer.write(encoder.encode(angle + "\n")).catch(onSerialLost);
  }

  function testServo(angle) {
    // Pause eye tracking for 2 s and keep resending the test angle so the Arduino holds it.
    state.holdUntil = Date.now() + 2000;
    state.holdAngle = angle;
    sendAngle(angle, true);
    if (state.holdTimer) clearInterval(state.holdTimer);
    state.holdTimer = setInterval(function () {
      if (Date.now() >= state.holdUntil) { clearInterval(state.holdTimer); state.holdTimer = null; return; }
      sendAngle(state.holdAngle, false);
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
      state.running = true; state.haveRatio = false;
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
    sendAngle(L.CENTER, true);
    $("ratioText").textContent = "–";
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

    var ratio = L.eyeRatio(lm);
    state.ratioS = state.haveRatio ? L.smooth(state.ratioS, ratio, SMOOTH) : ratio;
    state.haveRatio = true;
    $("ratioText").textContent = state.ratioS.toFixed(2);

    if (state.calib) { tickCalibration(state.ratioS); return; }

    if (Date.now() < state.holdUntil) return;      // a servo test is running
    var angle = L.ratioToAngle(state.ratioS, state.low, state.high, state.range, state.flip);
    setStage("Looking good – move your eyes left and right");
    sendAngle(angle, false);
  }

  // ---------- calibration wizard ----------
  var COUNTDOWN_MS = 2000, SAMPLE_MS = 1500;

  function startCalibration() {
    if (!state.running) { showMsg("Start the camera first.", "warn"); return; }
    showMsg("", "");
    state.calib = { step: "left", t0: performance.now(), samples: [], left: null };
  }

  function tickCalibration(ratioOrNull) {
    var c = state.calib; if (!c) return;
    var el = performance.now() - c.t0;
    var side = c.step === "left" ? "LEFT" : "RIGHT";
    if (el < COUNTDOWN_MS) {
      setStage("Look fully to your " + side + " and hold… " + Math.ceil((COUNTDOWN_MS - el) / 1000));
      return;
    }
    if (el < COUNTDOWN_MS + SAMPLE_MS) {
      setStage("Hold still…");
      if (ratioOrNull !== null) c.samples.push(ratioOrNull);
      return;
    }
    var avg = L.mean(c.samples);
    if (avg === null || c.samples.length < 5) {
      state.calib = null;
      showMsg("I couldn't see your face during calibration. Face the camera, add light, and try again.", "warn");
      return;
    }
    if (c.step === "left") {
      state.calib = { step: "right", t0: performance.now(), samples: [], left: avg };
      return;
    }
    var left = c.left, right = avg;
    state.calib = null;
    if (Math.abs(right - left) < 0.04) {
      showMsg("Your eye movement was too small to measure. Look further left and right (turn only your eyes) and try again.", "warn");
      return;
    }
    state.low = left; state.high = right; state.calibrated = true;
    saveSettings(); updateCalibText(); updateButtons();
    showMsg("Calibration done. Now move your eyes left and right.", "ok");
  }

  function resetCalibration() {
    state.low = 0.40; state.high = 0.60; state.calibrated = false; state.calib = null;
    saveSettings(); updateCalibText(); updateButtons();
    showMsg("Calibration reset to the default settings.", "info");
  }

  // ---------- start-up ----------
  function init() {
    loadSettings();
    $("chkFlip").checked = state.flip;
    $("rngRange").value = state.range; $("rangeVal").textContent = state.range;
    updateCalibText(); updateDial(L.CENTER); updateButtons();

    if (!("serial" in navigator)) {
      $("unsupported").hidden = false;
      $("btnConnect").disabled = true;
      setPill("serialStatus", "Not supported here", "bad");
    }

    $("btnConnect").addEventListener("click", connectSerial);
    $("btnCamera").addEventListener("click", startCamera);
    $("btnCalibrate").addEventListener("click", startCalibration);
    $("btnReset").addEventListener("click", resetCalibration);
    $("chkFlip").addEventListener("change", function (e) { state.flip = e.target.checked; saveSettings(); });
    $("rngRange").addEventListener("input", function (e) {
      state.range = Number(e.target.value); $("rangeVal").textContent = state.range; saveSettings();
    });
    $("btnTestLeft").addEventListener("click", function () { testServo(L.CENTER - state.range); });
    $("btnTestCenter").addEventListener("click", function () { testServo(L.CENTER); });
    $("btnTestRight").addEventListener("click", function () { testServo(L.CENTER + state.range); });

    // Let the page work offline after the first visit (needs https or localhost).
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* optional feature */ });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
