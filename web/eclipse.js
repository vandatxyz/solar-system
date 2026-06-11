// eclipse.js -- solar-eclipse detection read off the live trajectory.
//
// Port of the Python `eclipse.py`. No eclipse-specific physics is hard-coded;
// everything follows from three position vectors (Sun, Earth, Moon) that the
// N-body integration already produces. We track the Sun-Moon angular
// separation seen from Earth, find its local minima (new moons), and check
// whether the disks overlap once lunar parallax is accounted for.

import { KM_PER_AU, RADIUS_KM, INDEX, J2000_JD } from './data.js';

const R_SUN   = RADIUS_KM.Sun   / KM_PER_AU;
const R_MOON  = RADIUS_KM.Moon  / KM_PER_AU;
const R_EARTH = RADIUS_KM.Earth / KM_PER_AU;

const I_SUN   = INDEX.Sun;
const I_EARTH = INDEX.Earth;
const I_MOON  = INDEX.Moon;

function vecFrom(pos, a, b, out) {
  // out = r_a - r_b
  const ka = 3 * a, kb = 3 * b;
  out[0] = pos[ka]     - pos[kb];
  out[1] = pos[ka + 1] - pos[kb + 1];
  out[2] = pos[ka + 2] - pos[kb + 2];
  return out;
}

function norm(v) { return Math.hypot(v[0], v[1], v[2]); }

function angularSeparation(s, m) {
  const dot = s[0] * m[0] + s[1] * m[1] + s[2] * m[2];
  let cos = dot / (norm(s) * norm(m));
  cos = Math.min(1, Math.max(-1, cos));
  return Math.acos(cos);
}

// (kind, magnitude) for a conjunction at angular `separation` (radians).
function classify(s, m, separation) {
  const distSun = norm(s);
  const distMoon = norm(m);

  const alphaSun  = Math.asin(R_SUN  / distSun);
  const alphaMoon = Math.asin(R_MOON / distMoon);
  const alphaPar  = Math.asin(R_EARTH / distMoon);   // lunar parallax

  if (separation > alphaSun + alphaMoon + alphaPar) {
    return { kind: 'none', magnitude: 0 };
  }

  // Apparent radii from the sub-lunar surface point (closest observer).
  const alphaSunSurf  = Math.asin(R_SUN  / (distSun  - R_EARTH));
  const alphaMoonSurf = Math.asin(R_MOON / (distMoon - R_EARTH));

  const centralOverlap = separation < alphaSun + alphaMoon;
  let kind;
  if (centralOverlap && alphaMoonSurf >= alphaSunSurf) kind = 'total';
  else if (centralOverlap)                             kind = 'annular';
  else                                                 kind = 'partial';

  const sepSurf = Math.max(separation - alphaPar, 0);
  let magnitude = (alphaSunSurf + alphaMoonSurf - sepSurf) / (2 * alphaSunSurf);
  magnitude = Math.min(2, Math.max(0, magnitude));
  return { kind, magnitude };
}

const RAD2DEG = 180 / Math.PI;

// Fliegel & Van Flandern: Julian Date -> 'YYYY-MM-DD HH:MM' (UTC-ish).
export function jdToCalendar(jd) {
  const jdAdj = jd + 0.5;
  const z = Math.floor(jdAdj);
  const frac = jdAdj - z;
  let a;
  if (z < 2299161) a = z;
  else {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  let hours = frac * 24;
  let hh = Math.floor(hours);
  let mm = Math.round((hours - hh) * 60);
  if (mm === 60) { mm = 0; hh += 1; }
  const p = (x, w = 2) => String(x).padStart(w, '0');
  return `${p(year, 4)}-${p(month)}-${p(day)} ${p(hh)}:${p(mm)}`;
}

// Streaming finder: feed it the integrator after each step; it watches the
// Sun-Moon separation and emits an event when a refined local minimum turns
// out to be an eclipse. Same parabolic sub-step refinement as the Python side.
export class EclipseFinder {
  constructor(jd0 = J2000_JD, onEvent = null) {
    this.jd0 = jd0;
    this.onEvent = onEvent;
    this.events = [];
    this._hist = [];                       // last 3 {t, sep, s, m}
    this._s = new Float64Array(3);
    this._m = new Float64Array(3);
  }

  feed(integ) {
    const s = vecFrom(integ.pos, I_SUN, I_EARTH, this._s);
    const m = vecFrom(integ.pos, I_MOON, I_EARTH, this._m);
    const sep = angularSeparation(s, m);
    this._hist.push({ t: integ.time, sep, s: Float64Array.from(s), m: Float64Array.from(m) });
    if (this._hist.length > 3) this._hist.shift();
    if (this._hist.length === 3) this._checkMinimum();
  }

  _checkMinimum() {
    const [a, b, c] = this._hist;
    const f0 = a.sep, f1 = b.sep, f2 = c.sep;
    if (!(f1 < f0 && f1 < f2)) return;     // not a local minimum

    const denom = f0 - 2 * f1 + f2;
    if (denom <= 0) return;
    const delta = 0.5 * (f0 - f2) / denom; // vertex offset, in steps
    let sepMin = f1 - 0.25 * (f0 - f2) * delta;
    sepMin = Math.max(sepMin, 0);

    const { kind, magnitude } = classify(b.s, b.m, sepMin);
    if (kind === 'none') return;

    const h = b.t - a.t;
    const tMin = b.t + delta * h;
    const jd = this.jd0 + tMin;
    const ev = {
      jd,
      calendar: jdToCalendar(jd),
      kind,
      separationDeg: sepMin * RAD2DEG,
      magnitude,
    };
    this.events.push(ev);
    if (this.onEvent) this.onEvent(ev);
  }
}

// One-shot geometry probe for the *current* instant, for the live HUD: is an
// eclipse happening right now, and how aligned are the disks?
export function currentAlignment(pos) {
  const s = vecFrom(pos, I_SUN, I_EARTH, new Float64Array(3));
  const m = vecFrom(pos, I_MOON, I_EARTH, new Float64Array(3));
  const sep = angularSeparation(s, m);
  const { kind, magnitude } = classify(s, m, sep);
  return { separationDeg: sep * RAD2DEG, kind, magnitude };
}
