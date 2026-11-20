# Eye Control – move a servo with your eyes

A website that tracks your eyes with the laptop camera and turns a servo motor left and right.
Students only open a web page and plug in the Arduino. No Arduino IDE, Python, OpenCV or command prompt.

* Works in **Google Chrome or Microsoft Edge** on Windows, macOS, Linux or ChromeOS laptops/desktops.
* Not supported: phones/tablets, Safari, Firefox (they have no Web Serial).
* The camera picture never leaves the computer. Eye tracking runs inside the page (MediaPipe).

## For the teacher – one-time setup

### 1. Prepare the Arduino (once per board)
1. Open `arduino/eye_servo/eye_servo.ino` in the Arduino IDE.
2. Choose your board (Arduino Uno or Nano) and port, then click **Upload**.
3. Wire the servo: signal → **D9**, servo red → external 5 V supply (+), servo brown → supply GND **and** Arduino GND.
   (A battery pack or a 5 V 2 A adapter works. Powering the servo from the Arduino's 5 V pin can make the board reset.)

The board remembers the program, so students never need the Arduino IDE.

### 2. Put the website online (free, GitHub Pages)
1. Create a GitHub account and click **New repository** (for example `eye-control`, set to **Public**).
2. Click **uploading an existing file**, drag in **everything inside this folder** (`index.html`, `app.js`, `logic.js`, `sw.js`, the `mediapipe` folder and the `arduino` folder) and click **Commit changes**.
   * If the web uploader struggles with the `mediapipe` folder, use **GitHub Desktop** instead: it uploads folders without limits.
3. Open **Settings → Pages**. Under **Build and deployment**, set **Source = Deploy from a branch**, **Branch = main**, folder **/(root)**, then **Save**.
4. After a minute the page shows your link: `https://veera6767.github.io/eye-control/`. Share that link.

## For students
1. Plug in the Arduino with the USB cable.
2. Open the link in Chrome or Edge.
3. Press **Connect Arduino**, choose the Arduino in the list, press **Connect**.
4. Press **Start camera** and allow the camera.
5. Press **Calibrate**: look fully left, then fully right.
6. Move your eyes left and right, and the servo follows.

## Test on your own computer (optional)
The page must be opened from a web address, not by double-clicking `index.html`. If Python is installed:

```
cd eye-control
py -m http.server 8000
```

Then open <http://localhost:8000> in Chrome or Edge.

## How it works
* `app.js`: camera, MediaPipe FaceMesh, Web Serial, calibration, screen.
* `logic.js`: the maths (eye position to servo angle). It matches the earlier Python script.
* `arduino/eye_servo/eye_servo.ino`: moves the servo smoothly to each angle it receives (60–120°) and returns to the centre if nothing arrives for 2 seconds. The page must keep `centerAngle` and `range` equal to the values in `logic.js` (`CENTER = 90`, `MAX_RANGE = 30`).
* `mediapipe/`: the eye-tracking files, bundled so the site does not depend on another server.
  They come from the npm package `@mediapipe/face_mesh` 0.4.1633559619 (Apache-2.0).
* `sw.js`: lets the page work offline after the first visit.

## Troubleshooting
* **No Arduino in the list**: try another USB cable (some only charge) or another USB port. Boards with a CH340 chip may need the CH340 driver.
* **Failed to open serial port**: close the Arduino IDE Serial Monitor and any other program using the Arduino.
* **Servo goes the wrong way**: tick or untick **Reverse direction**.
* **Arduino keeps disconnecting or the servo twitches**: power the servo from its own supply, with the grounds joined.
* **Camera blocked**: click the camera icon in the address bar and allow it.
