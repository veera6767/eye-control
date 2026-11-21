// Eye control: side servo on D9, up/down servo on D10.
// Accepts "pan,tilt" per line (new page / Python script) or just "pan" (older single-servo page).
#include <Servo.h>

Servo pan;    // side servo
Servo tilt;   // up/down servo

const int CENTER = 90;
const int PAN_RANGE = 30;    // 60..120  (page: MAX_RANGE)
const int TILT_RANGE = 35;   // 55..125  (page: MAX_TILT, Python: TILT_RANGE)

const unsigned long STEP_DELAY = 8;       // ms per degree (lower = faster)
const unsigned long TIMEOUT_MS = 2000;    // back to centre if nothing arrives

int panNow = CENTER, tiltNow = CENTER;
int panTarget = CENTER, tiltTarget = CENTER;
unsigned long lastStep = 0, lastRx = 0;

void setup() {
  Serial.begin(9600);
  Serial.setTimeout(20);
  pan.attach(9);
  tilt.attach(10);
  pan.write(CENTER);
  tilt.write(CENTER);
  delay(500);
  lastRx = millis();
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      int comma = line.indexOf(',');
      int p = line.toInt();
      int t = CENTER;
      if (comma > 0) t = line.substring(comma + 1).toInt();
      panTarget  = constrain(p, CENTER - PAN_RANGE,  CENTER + PAN_RANGE);
      tiltTarget = constrain(t, CENTER - TILT_RANGE, CENTER + TILT_RANGE);
      lastRx = millis();
    }
  }

  if (millis() - lastRx > TIMEOUT_MS) {
    panTarget = CENTER;
    tiltTarget = CENTER;
  }

  if (millis() - lastStep >= STEP_DELAY) {
    if (panNow != panTarget) {
      panNow += (panTarget > panNow) ? 1 : -1;
      pan.write(panNow);
    }
    if (tiltNow != tiltTarget) {
      tiltNow += (tiltTarget > tiltNow) ? 1 : -1;
      tilt.write(tiltNow);
    }
    lastStep = millis();
  }
}
