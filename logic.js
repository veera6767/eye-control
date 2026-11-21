/*
 * Pure logic for the eye-control app (no browser APIs, so it can be unit-tested).
 * Eye position -> servo angles for the side servo (D9) and the up/down servo (D10).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EyeLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // These numbers MUST match the Arduino sketch (centerAngle = 90, PAN_RANGE = 30, TILT_RANGE = 35).
  var CENTER = 90;
  var MAX_RANGE = 30;   // side servo: 60..120
  var MAX_TILT = 35;    // up/down servo: 55..125

  // MediaPipe names eyes from the PERSON's point of view (R = the person's right eye).
  var EYES = {
    R: { outer: 33,  inner: 133, iris: 468, up: 159, low: 145 },
    L: { outer: 263, inner: 362, iris: 473, up: 386, low: 374 },
  };

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function width(lm, e) { return Math.max(Math.abs(lm[e.outer].x - lm[e.inner].x), 1e-6); }

  // 0..1 position of the iris between the two eye corners, on the raw camera image.
  function irisRatio(lm, outer, inner, iris) {
    var a = lm[outer].x, b = lm[inner].x;
    var x1 = Math.min(a, b), x2 = Math.max(a, b);
    return (lm[iris].x - x1) / Math.max(x2 - x1, 1e-6);
  }

  // Side value of one eye. Mirrored like the Python script: looking LEFT is small, RIGHT is big.
  function eyeH(lm, e) { return 1 - irisRatio(lm, e.outer, e.inner, e.iris); }

  // Up/down value of one eye: iris height compared with the line between the eye corners,
  // in eye-widths. Bigger = looking DOWN. (aspect = video height / width)
  function eyeV(lm, e, aspect) {
    var cy = (lm[e.outer].y + lm[e.inner].y) / 2;
    return (lm[e.iris].y - cy) * aspect / width(lm, e);
  }

  // How open the eye is (lid gap in eye-widths). Near 0 = closed.
  function eyeOpen(lm, e, aspect) {
    return Math.abs(lm[e.low].y - lm[e.up].y) * aspect / width(lm, e);
  }

  // mode: "auto" (use whichever eye is open), "both" (needs both open), "left", "right".
  // Returns { oL, oR, n, h, v }; n = how many eyes were used (0 = hold the last position).
  function measure(lm, mode, aspect, closedAt) {
    var oL = eyeOpen(lm, EYES.L, aspect), oR = eyeOpen(lm, EYES.R, aspect);
    var openL = oL > closedAt, openR = oR > closedAt, use = [];
    if (mode === "left") { if (openL) use.push("L"); }
    else if (mode === "right") { if (openR) use.push("R"); }
    else if (mode === "both") { if (openL && openR) use.push("L", "R"); }
    else { if (openL) use.push("L"); if (openR) use.push("R"); }
    var h = 0, v = 0;
    use.forEach(function (k) { h += eyeH(lm, EYES[k]); v += eyeV(lm, EYES[k], aspect); });
    var n = use.length;
    return { oL: oL, oR: oR, n: n, h: n ? h / n : null, v: n ? v / n : null };
  }

  // Calibrated value -> -1..+1 (0 = middle), with gain and a dead zone around the middle.
  function norm(value, a, b, gain, dead) {
    var span = b - a;
    if (Math.abs(span) < 0.02) span = span < 0 ? -0.02 : 0.02;
    var n = clamp((2 * (value - a) / span - 1) * (gain || 1), -1, 1);
    dead = dead || 0;
    if (Math.abs(n) < dead) return 0;
    return (Math.abs(n) - dead) / (1 - dead) * (n > 0 ? 1 : -1);
  }

  // If one axis clearly dominates, calm the other so the servos do not wobble.
  function suppress(nh, nv, keep) {
    var ah = Math.abs(nh), av = Math.abs(nv);
    var s = clamp((Math.max(ah, av) - Math.min(ah, av) - 0.1) / 0.3, 0, 1) * (1 - keep);
    if (ah < av) nh *= 1 - s; else nv *= 1 - s;
    return [nh, nv];
  }

  function toAngle(n, range, flip) {
    return Math.round(CENTER + (flip ? -n : n) * clamp(range, 0, MAX_TILT));
  }

  // Older helper kept for compatibility: ratio -> side angle.
  function ratioToAngle(ratio, low, high, range, flip) {
    return toAngle(norm(ratio, low, high, 1, 0), Math.min(range, MAX_RANGE), flip);
  }

  function eyeRatio(lm) { return (eyeH(lm, EYES.R) + eyeH(lm, EYES.L)) / 2; }
  function smooth(prev, next, k) { return prev + (next - prev) * k; }
  function mean(values) {
    if (!values.length) return null;
    var s = 0;
    for (var i = 0; i < values.length; i++) s += values[i];
    return s / values.length;
  }

  return {
    CENTER: CENTER, MAX_RANGE: MAX_RANGE, MAX_TILT: MAX_TILT,
    irisRatio: irisRatio, eyeRatio: eyeRatio, measure: measure, norm: norm,
    suppress: suppress, toAngle: toAngle, ratioToAngle: ratioToAngle, smooth: smooth, mean: mean,
  };
});
