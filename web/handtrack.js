// handtrack.js -- webcam hand tracking that turns a real hand into a 3D cursor
// for the simulator. Uses Google MediaPipe Hands (loaded from CDN, runs fully
// in-browser on WebGL/WASM -- no backend, no data leaves the machine).
//
// What it exposes to the rest of the app, per video frame:
//
//   onUpdate({
//     present,            // is a hand visible this frame
//     x, y,               // index-fingertip position in *screen* pixels
//     z,                  // relative depth (smaller = hand closer to camera)
//     pinch,              // true while thumb + index tips are pinched together
//     pinchStrength,      // 0..1, how closed the pinch is
//   })
//
// Gesture model
// -------------
//   move hand   -> move the cursor (index fingertip drives it)
//   pinch       -> "grab" (equivalent to mouse-down on a planet)
//   release     -> let go; the motion just before release becomes a flick
//   push/pull   -> hand depth maps to camera zoom when nothing is grabbed
//
// The cursor is mirrored horizontally so the interaction feels like a mirror:
// move your hand right, the cursor goes right.

const MP_VERSION = "0.4.1675469240";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MP_VERSION}`;

// Landmark indices we care about (MediaPipe Hands topology).
const TIP_THUMB = 4;
const TIP_INDEX = 8;
const MCP_INDEX = 5;
const WRIST = 0;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export class HandTracker {
  /**
   * @param {object} opts
   * @param {HTMLVideoElement} opts.video    hidden <video> fed by the webcam
   * @param {HTMLCanvasElement} opts.overlay small canvas showing the skeleton
   * @param {(s:object)=>void} opts.onUpdate per-frame state callback
   * @param {(msg:string)=>void} [opts.onStatus] status / error reporting
   */
  constructor({ video, overlay, onUpdate, onStatus }) {
    this.video = video;
    this.overlay = overlay;
    this.octx = overlay.getContext("2d");
    this.onUpdate = onUpdate;
    this.onStatus = onStatus || (() => {});
    this.running = false;
    this.hands = null;
    this.stream = null;

    // Smoothing state (exponential moving average) to kill jitter.
    this.sm = { x: 0, y: 0, z: 0, init: false };
    this.SMOOTH = 0.45;          // higher = snappier, lower = smoother
    this.PINCH_ON = 0.05;        // normalized distance to enter pinch
    this.PINCH_OFF = 0.08;       // hysteresis: looser threshold to release
    this.pinched = false;
  }

  async start() {
    if (this.running) return;
    this.onStatus("loading model…");

    // MediaPipe ships as classic scripts that attach globals to window.
    if (!window.Hands) {
      await loadScript(`${CDN}/hands.js`);
    }

    this.hands = new window.Hands({
      locateFile: (file) => `${CDN}/${file}`,
    });
    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,        // 0 = lite, fast enough for live control
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    this.hands.onResults((r) => this._onResults(r));

    this.onStatus("requesting camera…");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    this.running = true;
    this.onStatus("tracking");
    this._pump();
  }

  stop() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.onStatus("off");
    // Signal "no hand" so any active grab is released cleanly.
    this.onUpdate({ present: false, x: 0, y: 0, z: 0, pinch: false, pinchStrength: 0 });
  }

  // Drive MediaPipe from requestAnimationFrame; it processes one frame at a
  // time and we re-arm only after it returns, so we never queue up backlog.
  async _pump() {
    if (!this.running) return;
    try {
      await this.hands.send({ image: this.video });
    } catch (e) {
      // Transient send errors (e.g. video not ready) -- just try next frame.
    }
    if (this.running) requestAnimationFrame(() => this._pump());
  }

  _onResults(res) {
    const ow = this.overlay.width, oh = this.overlay.height;
    this.octx.clearRect(0, 0, ow, oh);

    const hasHand = res.multiHandLandmarks && res.multiHandLandmarks.length > 0;
    if (!hasHand) {
      this.onUpdate({ present: false, x: 0, y: 0, z: 0, pinch: false, pinchStrength: 0 });
      this.sm.init = false;
      return;
    }

    const lm = res.multiHandLandmarks[0];
    const tip = lm[TIP_INDEX];
    const thumb = lm[TIP_THUMB];

    // Mirror X so it behaves like a mirror. Landmarks are normalized [0,1].
    const nx = 1 - tip.x;
    const ny = tip.y;

    // Hand scale = wrist->index-MCP distance, used to normalize the pinch gap
    // so it's distance-invariant (works whether hand is near or far).
    const handScale = Math.hypot(
      lm[WRIST].x - lm[MCP_INDEX].x,
      lm[WRIST].y - lm[MCP_INDEX].y,
    ) || 0.1;
    const pinchGap = Math.hypot(tip.x - thumb.x, tip.y - thumb.y) / handScale;
    const pinchStrength = Math.max(0, Math.min(1, 1 - pinchGap / 0.6));

    // Pinch with hysteresis so it doesn't chatter at the threshold.
    if (!this.pinched && pinchGap < this.PINCH_ON) this.pinched = true;
    else if (this.pinched && pinchGap > this.PINCH_OFF) this.pinched = false;

    // Depth proxy: hand scale grows as the hand nears the camera.
    const z = handScale;

    // Smooth the *normalized* coords (0..1). The consumer maps them onto
    // whatever target rect it wants (here: the canvas), so the full range of
    // hand motion always covers the full drawing area -- mapping to the whole
    // window would waste the part of the range that falls over the side panel.
    if (!this.sm.init) {
      this.sm.x = nx; this.sm.y = ny; this.sm.z = z; this.sm.init = true;
    } else {
      const a = this.SMOOTH;
      this.sm.x += (nx - this.sm.x) * a;
      this.sm.y += (ny - this.sm.y) * a;
      this.sm.z += (z - this.sm.z) * a;
    }

    this._drawSkeleton(lm, ow, oh, this.pinched);

    this.onUpdate({
      present: true,
      nx: this.sm.x,            // normalized [0,1], mirrored
      ny: this.sm.y,
      z: this.sm.z,
      pinch: this.pinched,
      pinchStrength,
    });
  }

  // Draw the hand skeleton onto the small mirrored preview overlay.
  _drawSkeleton(lm, w, h, pinched) {
    const ctx = this.octx;
    const EDGES = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],
      [0,17],
    ];
    const X = (p) => (1 - p.x) * w;   // mirror to match the cursor
    const Y = (p) => p.y * h;

    ctx.lineWidth = 2;
    ctx.strokeStyle = pinched ? "#ff8a5f" : "#4f8fe0";
    ctx.beginPath();
    for (const [a, b] of EDGES) {
      ctx.moveTo(X(lm[a]), Y(lm[a]));
      ctx.lineTo(X(lm[b]), Y(lm[b]));
    }
    ctx.stroke();

    ctx.fillStyle = pinched ? "#ffd0bf" : "#cfe0ff";
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(X(p), Y(p), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Highlight index fingertip (the cursor driver).
    const tip = lm[TIP_INDEX];
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(X(tip), Y(tip), 4, 0, 2 * Math.PI);
    ctx.fill();
  }
}
