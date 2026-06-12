// main.js -- ties the physics, renderer, and UI together into an interactive
// simulator. The simulation runs on its own clock (many integrator steps per
// animation frame); the UI just reads state out and lets you nudge it.
//
// Interaction model
// -----------------
//   left-drag        orbit the camera (yaw / pitch)
//   right-drag       pan the focus point
//   wheel            zoom
//   click a body     focus the camera on it
//   drag a body      grab it and set its velocity by flick (hand-of-god mode)
//   sliders/buttons  time direction & speed, trails, labels, reset
//
// "Interact by hand" is the headline: pause, grab a planet, drag it to a new
// place or flick it to change its velocity, then resume and watch Newtonian
// gravity take over from the new state.

import { BODIES, GM, BODY_NAMES, INDEX, J2000_STATE, J2000_JD } from './data.js';
import { NBody, removeBarycentreDrift } from './physics.js';
import { EclipseFinder, currentAlignment, jdToCalendar } from './eclipse.js';
import { Renderer } from './renderer.js';
import { HandTracker } from './handtrack.js';

// --- build the seed state arrays (flat Float64Array, canonical order) -------

function seedState() {
  const n = BODY_NAMES.length;
  const pos = new Float64Array(3 * n);
  const vel = new Float64Array(3 * n);
  BODY_NAMES.forEach((name, i) => {
    const s = J2000_STATE[name];
    pos[3 * i] = s.pos[0]; pos[3 * i + 1] = s.pos[1]; pos[3 * i + 2] = s.pos[2];
    vel[3 * i] = s.vel[0]; vel[3 * i + 1] = s.vel[1]; vel[3 * i + 2] = s.vel[2];
  });
  removeBarycentreDrift(pos, vel, GM);
  return { pos, vel };
}

// --- simulation + view singletons ------------------------------------------

const canvas = document.getElementById('view');
const renderer = new Renderer(canvas, BODIES);

let sim, finder;
const DT = 0.1;                 // days per integrator step (matches Python default)

function resetSim() {
  const { pos, vel } = seedState();
  sim = new NBody(pos, vel, GM, DT);
  finder = new EclipseFinder(J2000_JD, onEclipse);
  finder.feed(sim);             // seed the finder with the initial geometry
  renderer.clearTrails();
  eclipseList.length = 0;
  refreshEclipseList();
  e0 = sim.energy();
  l0 = sim.angularMomentum();
}

// --- canvas sizing ----------------------------------------------------------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

// --- run loop ---------------------------------------------------------------

let running = true;
let stepsPerFrame = 20;         // simulation speed (integrator steps per frame)
let direction = 1;              // +1 forward, -1 backward in time
let e0 = 0, l0 = [0, 0, 0];

function frame() {
  if (running && !grab.active) {
    const spf = Math.max(1, Math.round(stepsPerFrame));
    if (direction < 0) sim.dt = -DT; else sim.dt = DT;
    for (let s = 0; s < spf; s++) {
      sim.step();
      if (direction > 0) finder.feed(sim);   // detect eclipses going forward
    }
    renderer.pushTrail(sim.pos);
  }
  renderer.draw(sim.pos);
  updateHUD();
  requestAnimationFrame(frame);
}

// --- heads-up display -------------------------------------------------------

const hud = {
  date:   document.getElementById('hud-date'),
  speed:  document.getElementById('hud-speed'),
  energy: document.getElementById('hud-energy'),
  angmom: document.getElementById('hud-angmom'),
  align:  document.getElementById('hud-align'),
};

function fmtSci(x) {
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  const m = x / Math.pow(10, e);
  return `${m.toFixed(2)}e${e}`;
}

function updateHUD() {
  const jd = J2000_JD + sim.time;
  hud.date.textContent = jdToCalendar(jd);
  const dirLabel = direction < 0 ? '◀ reverse' : 'forward ▶';
  const daysPerSec = stepsPerFrame * DT * 60 * direction;
  hud.speed.textContent = `${dirLabel}  ~${Math.abs(daysPerSec).toFixed(0)} d/s`;

  const e = sim.energy();
  const l = sim.angularMomentum();
  const eDrift = e0 !== 0 ? Math.abs((e - e0) / e0) : 0;
  const lMag0 = Math.hypot(l0[0], l0[1], l0[2]);
  const lDrift = lMag0 !== 0
    ? Math.hypot(l[0] - l0[0], l[1] - l0[1], l[2] - l0[2]) / lMag0
    : 0;
  hud.energy.textContent = fmtSci(eDrift);
  hud.angmom.textContent = fmtSci(lDrift);

  const a = currentAlignment(sim.pos);
  if (a.kind === 'none') {
    hud.align.textContent = `${a.separationDeg.toFixed(2)}° (no eclipse)`;
    hud.align.className = '';
  } else {
    hud.align.textContent = `${a.kind.toUpperCase()}  mag ${a.magnitude.toFixed(2)}`;
    hud.align.className = 'eclipse-now';
  }
}

// --- eclipse log ------------------------------------------------------------

const eclipseList = [];
const eclipseListEl = document.getElementById('eclipse-list');

function onEclipse(ev) {
  // Avoid duplicate logging if we re-cross the same minimum after a reset.
  eclipseList.push(ev);
  if (eclipseList.length > 200) eclipseList.shift();
  refreshEclipseList();
}

function refreshEclipseList() {
  if (eclipseList.length === 0) {
    eclipseListEl.innerHTML = '<li class="muted">none yet — run forward in time</li>';
    return;
  }
  const rows = eclipseList.slice().reverse().map((e) => {
    const cls = e.kind === 'total' ? 'k-total'
              : e.kind === 'annular' ? 'k-annular' : 'k-partial';
    return `<li><span class="kind ${cls}">${e.kind}</span>`
         + `<span class="when">${e.calendar}</span>`
         + `<span class="mag">mag ${e.magnitude.toFixed(2)}</span></li>`;
  });
  eclipseListEl.innerHTML = rows.join('');
}

// --- mouse interaction ------------------------------------------------------

let drag = null;          // camera drag: {button, x, y}
const grab = { active: false, index: -1, lastWorld: null, samples: [] };

function screenToWorldOnEcliptic(sx, sy) {
  // Invert the orthographic projection back onto the body's current depth.
  // We approximate by placing the grabbed point at the focus depth: solve for
  // camera-space (cx, cy) from screen, then undo pitch/yaw at the body's z.
  const dpr = 1;
  const cx = (sx * dpr - canvas.clientWidth / 2) / renderer.scale;
  const cyTop = (canvas.clientHeight / 2 - sy * dpr) / renderer.scale;
  return { cx, cy: cyTop };
}

// Convert a screen point to a world position at the same depth as `index`.
function unprojectAtBody(sx, sy, index) {
  const { cx, cy } = screenToWorldOnEcliptic(sx, sy);
  // Current camera-space coords of the body give us its depth (z2) and we keep
  // it fixed; we only move within the view plane.
  const i = index;
  const camB = renderer._toCamera(sim.pos[3*i], sim.pos[3*i+1], sim.pos[3*i+2]);
  const z2 = camB[2];
  // Camera space (cx, cy, z2) -> undo pitch -> undo yaw -> world (+ focus).
  const cp = Math.cos(renderer.pitch), sp = Math.sin(renderer.pitch);
  const y1 = cp * cy + sp * z2;
  const z1 = -sp * cy + cp * z2;   // not used for world xy but kept for clarity
  const x1 = cx;
  const cyaw = Math.cos(renderer.yaw), syaw = Math.sin(renderer.yaw);
  const dx =  cyaw * x1 + syaw * y1;
  const dy = -syaw * x1 + cyaw * y1;
  return [
    dx + renderer.focus[0],
    dy + renderer.focus[1],
    sim.pos[3*i+2],                // keep original z (stay in its plane)
  ];
}

canvas.addEventListener('mousedown', (ev) => {
  ev.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;

  if (ev.button === 0) {
    const hit = renderer.pick(sx, sy);
    if (hit >= 0 && handMode) {
      // Grab this body: pause integration, start tracking the cursor.
      grab.active = true;
      grab.index = hit;
      grab.samples = [];
      grab.lastWorld = unprojectAtBody(sx, sy, hit);
      return;
    }
    if (hit >= 0) {
      renderer.setFocus(hit, sim.pos);
      focusSelect.value = String(hit);
      return;
    }
    drag = { button: 0, x: sx, y: sy };
  } else if (ev.button === 2) {
    drag = { button: 2, x: sx, y: sy };
  }
});

window.addEventListener('mousemove', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;

  if (grab.active) {
    const i = grab.index;
    const world = unprojectAtBody(sx, sy, i);
    // Move the body to the cursor (drag the planet itself).
    sim.pos[3*i] = world[0];
    sim.pos[3*i+1] = world[1];
    sim.pos[3*i+2] = world[2];
    sim._computeAcc();
    // Track recent motion to estimate a flick velocity on release.
    const now = performance.now();
    grab.samples.push({ t: now, p: world.slice() });
    while (grab.samples.length > 5) grab.samples.shift();
    grab.lastWorld = world;
    return;
  }

  if (!drag) return;
  const dx = sx - drag.x, dy = sy - drag.y;
  drag.x = sx; drag.y = sy;
  if (drag.button === 0) {
    renderer.yaw += dx * 0.01;
    renderer.pitch = Math.max(-1.5, Math.min(1.5, renderer.pitch + dy * 0.01));
  } else if (drag.button === 2) {
    // Pan: shift the focus in the view plane. Free the body lock first.
    renderer.focusIndex = -1;
    focusSelect.value = '-1';
    const k = 1 / renderer.scale;
    const cyaw = Math.cos(renderer.yaw), syaw = Math.sin(renderer.yaw);
    renderer.focus[0] -= (cyaw * dx - syaw * -dy) * k;
    renderer.focus[1] -= (syaw * dx + cyaw * -dy) * k;
  }
});

window.addEventListener('mouseup', () => {
  if (grab.active) finishGrab();
  drag = null;
});

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const f = Math.exp(-ev.deltaY * 0.0015);
  renderer.scale = Math.max(2, Math.min(4000, renderer.scale * f));
}, { passive: false });

canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

// --- control bindings -------------------------------------------------------

const playBtn = document.getElementById('btn-play');
const focusSelect = document.getElementById('focus-select');
let handMode = false;

document.getElementById('btn-play').addEventListener('click', () => {
  running = !running;
  playBtn.textContent = running ? '❚❚ Pause' : '▶ Play';
});

document.getElementById('btn-reverse').addEventListener('click', () => {
  direction = -direction;
});

document.getElementById('speed').addEventListener('input', (ev) => {
  stepsPerFrame = Number(ev.target.value);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  resetSim();
  renderer.setFocus(Number(focusSelect.value), sim.pos);
});

document.getElementById('chk-trails').addEventListener('change', (ev) => {
  renderer.showTrails = ev.target.checked;
  if (!ev.target.checked) renderer.clearTrails();
});

document.getElementById('chk-labels').addEventListener('change', (ev) => {
  renderer.showLabels = ev.target.checked;
});

const handBtn = document.getElementById('btn-hand');
handBtn.addEventListener('click', () => {
  handMode = !handMode;
  handBtn.classList.toggle('active', handMode);
  canvas.style.cursor = handMode ? 'grab' : 'default';
});

// --- camera (real-hand) control --------------------------------------------
//
// The HandTracker reports {x,y,pinch,...} per video frame. We translate that
// into the same grab/move/release machinery as the mouse path above, so the
// simulation only ever sees one kind of interaction.

const camBtn = document.getElementById('btn-cam');
const camWrap = document.getElementById('cam-wrap');
const camStatus = document.getElementById('cam-status');
const handCursor = document.getElementById('hand-cursor');
let handTracker = null;
let handState = { active: false, pinch: false, x: 0, y: 0 };

function onHandFrame(s) {
  if (!s.present) {
    handCursor.hidden = true;
    handState.active = false;
    // Release any active pinch-grab so it doesn't get stuck.
    if (grab.active) finishGrab();
    return;
  }

  handCursor.hidden = false;
  handCursor.style.left = `${s.x}px`;
  handCursor.style.top = `${s.y}px`;
  handCursor.classList.toggle('pinching', s.pinch);
  handState = { active: true, pinch: s.pinch, x: s.x, y: s.y };

  // Translate cursor into canvas-local coordinates.
  const rect = canvas.getBoundingClientRect();
  const sx = s.x - rect.left;
  const sy = s.y - rect.top;
  const insideCanvas = sx >= 0 && sy >= 0 && sx <= rect.width && sy <= rect.height;

  // Pinch starts a grab on the nearest body (if any in canvas).
  if (s.pinch && !grab.active && insideCanvas) {
    const hit = renderer.pick(sx, sy);
    if (hit >= 0) {
      grab.active = true;
      grab.index = hit;
      grab.samples = [];
      grab.lastWorld = unprojectAtBody(sx, sy, hit);
    }
    return;
  }

  // Drag while pinched: same logic as mousemove during a mouse grab.
  if (s.pinch && grab.active) {
    const i = grab.index;
    const world = unprojectAtBody(sx, sy, i);
    sim.pos[3*i]   = world[0];
    sim.pos[3*i+1] = world[1];
    sim.pos[3*i+2] = world[2];
    sim._computeAcc();
    const now = performance.now();
    grab.samples.push({ t: now, p: world.slice() });
    while (grab.samples.length > 5) grab.samples.shift();
    grab.lastWorld = world;
    return;
  }

  // Released the pinch: complete the grab and apply the flick velocity.
  if (!s.pinch && grab.active) finishGrab();
}

// Wraps the velocity-from-flick logic shared by mouse-up and pinch-release.
function finishGrab() {
  if (!grab.active) return;
  const s = grab.samples;
  if (s.length >= 2) {
    const a = s[0], b = s[s.length - 1];
    const dtSec = (b.t - a.t) / 1000;
    if (dtSec > 1e-3) {
      const FLICK_TO_AUPERDAY = 0.15;
      const i = grab.index;
      sim.vel[3*i]   = (b.p[0] - a.p[0]) / dtSec * FLICK_TO_AUPERDAY;
      sim.vel[3*i+1] = (b.p[1] - a.p[1]) / dtSec * FLICK_TO_AUPERDAY;
      sim.vel[3*i+2] = (b.p[2] - a.p[2]) / dtSec * FLICK_TO_AUPERDAY;
      sim._computeAcc();
    }
  }
  grab.active = false;
  grab.index = -1;
  e0 = sim.energy();
  l0 = sim.angularMomentum();
}

async function toggleCamHands() {
  if (handTracker && handTracker.running) {
    handTracker.stop();
    camWrap.hidden = true;
    handCursor.hidden = true;
    camBtn.classList.remove('active');
    return;
  }
  camWrap.hidden = false;
  camBtn.classList.add('active');
  if (!handTracker) {
    handTracker = new HandTracker({
      video: document.getElementById('cam-video'),
      overlay: document.getElementById('cam-overlay'),
      onUpdate: onHandFrame,
      onStatus: (msg) => { camStatus.textContent = msg; },
    });
  }
  try {
    await handTracker.start();
  } catch (err) {
    camStatus.textContent = 'error: ' + (err.message || err);
    camBtn.classList.remove('active');
  }
}
camBtn.addEventListener('click', () => { toggleCamHands(); });

// Populate the focus selector from the body list.
BODY_NAMES.forEach((name, i) => {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = name;
  focusSelect.appendChild(opt);
});
const freeOpt = document.createElement('option');
freeOpt.value = '-1';
freeOpt.textContent = 'Free camera';
focusSelect.appendChild(freeOpt);
focusSelect.value = String(INDEX.Earth);

focusSelect.addEventListener('change', (ev) => {
  const idx = Number(ev.target.value);
  renderer.setFocus(idx, sim.pos);
});

// --- boot -------------------------------------------------------------------

resize();
resetSim();
renderer.setFocus(INDEX.Earth, sim.pos);
renderer.scale = 90;
requestAnimationFrame(frame);
