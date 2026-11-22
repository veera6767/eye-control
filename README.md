**[Live app: https://veera6767.github.io/eye-control/](https://veera6767.github.io/eye-control/)**
Open the link in **Google Chrome** or **Microsoft Edge** on a laptop or desktop — no install needed.

---

# Eye Control – move servos with your eyes

A website that tracks your eyes with the laptop camera and turns two servo motors left, right, up and down.
Students only open a web page and plug in the Arduino. No Arduino IDE, Python, OpenCV or command prompt.

* Works in **Google Chrome or Microsoft Edge** on Windows, macOS, Linux or ChromeOS laptops/desktops.
* Not supported: phones/tablets, Safari, Firefox (they have no Web Serial).
* The camera picture never leaves the computer. Eye tracking runs inside the page (MediaPipe).
* **Comprehensive 38-Page Technical Manual:** See [Eye_Control_Complete_Technical_Manual.pdf](Eye_Control_Complete_Technical_Manual.pdf) for detailed circuit schematics, breadboard power distribution, computer vision mathematics, PWM timing, and full firmware listings.
* **25-Slide Presentation Deck:** See [Eye_Control_Presentation.pptx](Eye_Control_Presentation.pptx) for an accessible, beginner-friendly slide deck designed for general audiences and classroom presentations.

## What's new

* **Up/down servo** – a second servo on pin **D10** (±35°) tracks vertical eye movement.
* **One-eye mode** – go to **Settings → Eyes used** and pick *Auto*, *Left eye only* or *Right eye only*. Close one eye and the open eye controls the servos.
* **Four-step calibration** – the calibration wizard now asks you to look **left**, **right**, **up** and **down** (about 14 seconds total).
* **Separate reverse options** – "Reverse side direction" and "Reverse up/down direction" can be toggled independently.
* **Up/down sensitivity & dead-zone** – a gain slider and built-in dead zone reduce servo wobble on the vertical axis.
* **Eyelid tracking for up/down (Face Landmarker)** – the up/down servo now also uses Google MediaPipe **Face Landmarker** (eyelid blendshapes `eyeLookUp/Down` + upper/lower lid landmarks), so even a tiny up or down eyeball movement is detected. Yellow eyelid outlines are drawn on the camera picture and a status line under the dials shows what it sees. If it cannot load, the app silently falls back to the old up/down tracking.

> **Note:** After updating the web files, upload `arduino/eye_servo/eye_servo.ino` to your Arduino again — the new sketch reads `"pan,tilt"` instead of a single angle.

## For the teacher – one-time setup

### 1. Prepare the Arduino (once per board)
1. Open `arduino/eye_servo/eye_servo.ino` in the Arduino IDE.
2. Choose your board (Arduino Uno or Nano) and port, then click **Upload**.
3. Wire the servos:
   * **Side servo** signal → pin **D9**
   * **Up/down servo** signal → pin **D10**
   * Both servo red wires → external 5 V supply (+)
   * Both servo brown/black wires → supply GND **and** Arduino GND (all grounds joined)

   (A battery pack or a 5 V 2 A adapter works. Powering servos from the Arduino's 5 V pin can make the board reset.)

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
5. Press **Calibrate**: look fully left, right, up and then down.
6. Move your eyes and the servos follow. In **Settings → Eyes used**, choose *Auto* to control with one eye (close the other).

## Test on your own computer (optional)
The page must be opened from a web address, not by double-clicking `index.html`. If Python is installed:

```
cd eye-control
py -m http.server 8000
```

Then open <http://localhost:8000> in Chrome or Edge.

## How it works
* `app.js`: camera, MediaPipe FaceMesh, Web Serial, calibration, screen.
* `logic.js`: the maths (eye position to servo angles). Side servo uses `MAX_RANGE = 30`, up/down uses `MAX_TILT = 35`. It matches the earlier Python script.
* `arduino/eye_servo/eye_servo.ino`: reads `"pan,tilt"` per line (or just `"pan"` for backward compatibility). Moves both servos smoothly and returns to centre if nothing arrives for 2 seconds. `PAN_RANGE = 30` and `TILT_RANGE = 35` must match `logic.js`.
* `mediapipe/`: the eye-tracking files, bundled so the site does not depend on another server.
  They come from the npm package `@mediapipe/face_mesh` 0.4.1633559619 (Apache-2.0).
* `landmarker-assist.js`: **new** – loads MediaPipe Face Landmarker (`@mediapipe/tasks-vision` 0.10.14) and replaces only the up/down value coming out of `EyeLogic.measure()` with an eyelid-based value on the same scale (centre 0.05, span ±0.07), so calibration, gain, dead zone and servo mapping are unchanged. Side (left/right) tracking is untouched. It loads the files from `mediapipe-tasks/` first and from the jsDelivr / Google CDN if they are missing.
* `mediapipe-tasks/`: Face Landmarker files bundled for offline use (`vision_bundle.mjs`, `wasm/`, `face_landmarker.task`). See *Face Landmarker files* below.
* `sw.js`: lets the page work offline after the first visit.

## Troubleshooting
* **No Arduino in the list**: try another USB cable (some only charge) or another USB port. Boards with a CH340 chip may need the CH340 driver.
* **Failed to open serial port**: close the Arduino IDE Serial Monitor and any other program using the Arduino.
* **Servo goes the wrong way**: tick or untick **Reverse side direction** or **Reverse up/down direction**.
* **Up/down servo does not move**: upload the new `eye_servo.ino` (it now reads `"pan,tilt"`) and press **Calibrate** again.
* **One-eye mode does nothing**: check the "Eyes:" line under the dials. The closed eye should say "closed". If your open eye also says "closed", open it wider or add light.
* **Arduino keeps disconnecting or the servo twitches**: power the servos from their own supply, with all grounds joined.
* **Camera blocked**: click the camera icon in the address bar and allow it.
* **Up/down still jumps or looks wrong**: under the dials the line *Face Landmarker: active* must be green. If it says *unavailable*, check your internet connection (or that `mediapipe-tasks/` is uploaded) and refresh. Then press **Calibrate** again and look clearly up and down.
* **Compare with the old up/down tracking**: untick **Use eyelid tracking for up/down** in Settings.

## Face Landmarker files (offline copy)
The page works without these because it falls back to the CDN, but bundling them makes it faster and fully offline. From the repo folder:

```
npm pack @mediapipe/tasks-vision@0.10.14
tar -xzf mediapipe-tasks-vision-0.10.14.tgz
mkdir -p mediapipe-tasks
cp package/vision_bundle.mjs mediapipe-tasks/
cp -r package/wasm mediapipe-tasks/wasm
curl -L -o mediapipe-tasks/face_landmarker.task https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
rm -rf package mediapipe-tasks-vision-0.10.14.tgz
```

Face Landmarker is Apache-2.0, from Google AI Edge MediaPipe.
