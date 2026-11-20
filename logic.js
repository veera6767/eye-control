/*
 * Pure logic for the eye-control app (no browser APIs here, so it can be unit-tested).
 * It mirrors eye_control.py: iris position between the eye corners -> servo angle.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EyeLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // These two numbers MUST match the Arduino sketch (centerAngle = 90, range = 30).
  var CENTER = 90;
  var MAX_RANGE = 30;

  // 0..1 position of the iris between the two eye corners, measured on the raw camera image.
  function irisRatio(lm, outer, inner, iris) {
    var a = lm[outer].x, b = lm[inner].x;
    var x1 = Math.min(a, b), x2 = Math.max(a, b);
    return (lm[iris].x - x1) / Math.max(x2 - x1, 1e-6);
  }

  // The Python app flips the picture like a mirror BEFORE measuring, so we do the same
  // here by using 1 - ratio. Looking to your LEFT gives a small number, RIGHT a big one.
  function eyeRatio(lm) {
    var r1 = irisRatio(lm, 33, 133, 468);   // one eye: corners 33/133, iris centre 468
    var r2 = irisRatio(lm, 362, 263, 473);  // other eye: corners 362/263, iris centre 473
    return 1 - (r1 + r2) / 2;
  }

  // Turn a smoothed ratio into a servo angle (CENTER - range .. CENTER + range).
  function ratioToAngle(ratio, low, high, range, flip) {
    var span = high - low;
    if (Math.abs(span) < 0.02) span = span < 0 ? -0.02 : 0.02; // avoid divide-by-zero
    var t = (ratio - low) / span;
    t = Math.max(0, Math.min(1, t));
    if (flip) t = 1 - t;
    var r = Math.max(0, Math.min(MAX_RANGE, range));
    return Math.round(CENTER - r + t * 2 * r);
  }

  // Exponential smoothing, same idea as SMOOTH = 0.35 in the Python script.
  function smooth(prev, next, k) {
    return prev + (next - prev) * k;
  }

  function mean(values) {
    if (!values.length) return null;
    var s = 0;
    for (var i = 0; i < values.length; i++) s += values[i];
    return s / values.length;
  }

  return {
    CENTER: CENTER,
    MAX_RANGE: MAX_RANGE,
    irisRatio: irisRatio,
    eyeRatio: eyeRatio,
    ratioToAngle: ratioToAngle,
    smooth: smooth,
    mean: mean,
  };
});
