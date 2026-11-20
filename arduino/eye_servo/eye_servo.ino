#include <Servo.h>

Servo myServo;
const int servoPin = 9;

const int centerAngle = 90;   // straight ahead
const int range = 30;         // +/- 30 degrees -> 60 to 120

int currentAngle = centerAngle;
int targetAngle  = centerAngle;

const int stepDelay = 10;                 // ms per degree (higher = slower, smoother)
const unsigned long timeoutMs = 2000;     // go back to centre if no data for 2 s
unsigned long lastStep = 0;
unsigned long lastRx = 0;

void setup() {
  Serial.begin(9600);
  Serial.setTimeout(20);
  myServo.attach(servoPin);
  myServo.write(centerAngle);
  delay(500);
  lastRx = millis();
}

void loop() {
  // 1) read a new angle from the laptop (one number per line)
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      int a = line.toInt();
      targetAngle = constrain(a, centerAngle - range, centerAngle + range);
      lastRx = millis();
    }
  }

  // 2) no data for a while -> return to centre
  if (millis() - lastRx > timeoutMs) {
    targetAngle = centerAngle;
  }

  // 3) move one degree at a time toward the target
  if (millis() - lastStep >= stepDelay && currentAngle != targetAngle) {
    currentAngle += (targetAngle > currentAngle) ? 1 : -1;
    myServo.write(currentAngle);
    lastStep = millis();
  }
}