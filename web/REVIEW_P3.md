# Solar System Three.js Visual Overhaul — P3 Review

**Reviewer:** Senior Frontend / WebGL Engineer
**Date:** 2026-06-24
**Files reviewed:** `web/index.html` (Three.js version), `web/physics.js`, `web/data.js`, `web/eclipse.js`, `web/main.js`, `web/renderer.js`, `web/handtrack.js`, `physics.py`, `simulation.py`, `constants.py`

---

## Overall Verdict: PASS WITH FIXES

The implementation delivers a solid Three.js upgrade: physics is cleanly separated, procedural textures work without async loading, and the feature set covers P0–P2. However, there are **2 critical bugs**, several high-priority issues that would hurt a production demo, and a few architectural concerns that should be resolved before shipping.

---

## Critical Blockers

### 1. 🚨 Broken Frame Rate Limiter — `animate()` (lines ~680–700)

```javascript
// FRAMERATE LIMITER: skip render if < 16ms delta (capped at 60fps)
if (delta < 16 && realtimeMode) {
  // Skip this frame — running fast enough
} else {
  renderer.render(scene, camera);
}
```

**The problem:** When `delta < 16` (running at >60fps, which is common on modern displays), the code skips `renderer.render()` in realtime mode. But the comment says "skip this frame" while the code only has `controls.update()` and `updateHUD()` in the else path. On 120Hz+ displays in realtime mode, **every other frame is unrendered** — the user sees jerky, 30fps-like motion despite a 120Hz panel.

**The fix:** Either remove the limiter entirely (Three.js is lightweight here, no performance reason to cap), or apply it correctly:

```javascript
// Option A: just render every frame (recommended for this scene complexity)
renderer.render(scene, camera);

// Option B: proper frame skipping
if (now - lastRenderTime >= 16.67) {
  renderer.render(scene, camera);
  lastRenderTime = now;
}
```

**Severity: CRITICAL** — breaks the "smooth 60fps" acceptance criterion on high-refresh displays.

### 2. 🚨 Eclipse Detection Disabled in Reverse Mode

```javascript
for (let s = 0; s < spf; s++) {
  sim.step();
  if (direction > 0) finder.feed(sim);  // <-- only forward!
}
```

When the user clicks "Reverse", `direction = -1`, and `finder.feed()` is never called. The eclipse list freezes and no historical eclipses are found. The Python version (`simulation.py` → `EclipseFinder`) handles both directions.

**Fix:** Always feed the finder, or implement reverse-mode eclipse detection:

```javascript
for (let s = 0; s < spf; s++) {
  sim.step();
  finder.feed(sim);  // always feed; finder internally handles time direction
}
```

**Severity: CRITICAL** — breaks a core acceptance criterion.

---

## High-Priority Fixes

### 3. Orbit Trails Don't Update After "Hand of God" Grab-and-Throw

When a user grabs a planet and flings it to a new orbit, the static circular orbit trail line (drawn from J2000 state) becomes stale. The body moves on its new Keplerian path while the trail shows the old circle.

**Suggested fix:** After `finishGrab()`, rebuild the orbit trail circle for the modified body using its new position and velocity to compute the orbital plane. Or switch to a dynamic trailing line (ring buffer of actual positions) instead of a pre-computed circle.

### 4. `infoPanel` Missing Mass Data

The spec requires "show name, radius, mass, distance from Sun." The current info panel shows only radius and distance:

```javascript
infoPanel.innerHTML = `
  <div class="info-name" style="color:${COLOR[name]}">${name}</div>
  <div class="info-row"><span class="info-label">Radius</span>...`
  // Missing: Mass (GM), orbital velocity, etc.
`;
```

**Fix:** Add mass display. Since GM is available as `BODIES[index].gm`, compute mass as `gm / G_constant` or simply display GM with a note. At minimum, show GM in conventional units.

### 5. Monolithic ~1800-Line `index.html` vs. Clean ES Module Architecture

The existing `web/` directory has clean ES modules:
- `data.js` — constants, J2000 state (exported)
- `physics.js` — NBody class (exported)
- `eclipse.js` — EclipseFinder (exported)
- `renderer.js` — Canvas 2D renderer (exported)
- `main.js` — orchestration (imported from above)
- `handtrack.js` — webcam tracking (exported)

The new `index.html` **inlines and duplicates all of this** into a single script block. This creates two diverging codebases. The physics constants (GM values, body names, J2000 state) are hardcoded arrays inside the HTML rather than imported from `data.js`.

**Impact:** Any fix to physics/eclipse/handtracking in the modular files won't automatically flow to `index.html`, and vice versa. Maintenance burden doubles.

**Recommendation:** Either:
1. Make `index.html` import from the existing ES modules (the importmap already supports this), or
2. Delete the now-redundant modular files and document `index.html` as the canonical version, or
3. Extract the shared constants/data into a common file both consume.

### 6. Directional Light + Shadow Maps on Solar-System Scale

```javascript
const sunLight = new THREE.DirectionalLight(0xffeedd, 1.8);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
```

A directional light at position `(0,0,0)` with shadow maps is suboptimal:
- Directional lights have **infinite range** — shadow maps attempt to capture the entire scene
- At Neptune's distance (~30 AU), the shadow camera frustum must be enormous
- Each shadow map render costs a full scene draw — 1024×1024 × ~5 shadow casters = significant GPU work
- PCFSoftShadowMap is the most expensive shadow filter

**Fix:** Consider using a `PointLight` at the Sun position (natural for a star), or disable shadow maps entirely (the visual benefit is negligible at this scale — planets are small spheres floating in space).

### 7. `mesh.rotation.y += 0.01` Unphysical Body Rotation

```javascript
// Rotate body (slow rotation for aesthetic)
mesh.rotation.y += 0.01;
```

Every body rotates at the same angular velocity (0.01 rad/frame = ~0.6 rad/s at 60fps). Real planets have vastly different rotation periods (Earth: ~24h, Jupiter: ~10h, Venus: retrograde ~243 days). At simulation speed (potentially ~1200 days/s), the visual rotation becomes a blur.

**Fix:** Either remove it (physics positions speak for themselves), or scale rotation by real period / simulation speed.

---

## Nice-to-Have Improvements

### 8. Orbit Lines Are Circles, Not Ellipses

The orbit trail lines compute a perfect circle at the body's J2000 distance. Real orbits are ellipses (Mercury has eccentricity 0.21). The circle approximation is visually noticeable for Mercury and Pluto (if added).

**Fix:** Use the vis-viva equation and angular momentum to compute semi-major axis `a` and eccentricity `e`, then draw a true Keplerian ellipse.

### 9. No Asteroid Belt, Extra Moons, or Dwarf Planets (P3)

Per the spec's P3 section, these are aspirational. But they would significantly improve the "wow" factor:
- Asteroid belt: 1000–2000 small points between Mars and Jupiter
- Galilean moons + Titan + Triton: already have data in `MOON_DATA`
- Pluto, Ceres, Eris: already have data in `DWARF_DATA`

The data arrays (`MOON_DATA`, `DWARF_DATA`) are defined in the HTML but never used. This is dead code.

### 10. No Camera Reset Button

The spec lists "Reset camera" as a P2 deliverable. The HTML has a "Reset to J2000" button (resets simulation) but no button to reset camera position/orientation.

**Fix:** Add a "Reset View" button that restores camera to initial position:

```javascript
document.getElementById('btn-reset-view').addEventListener('click', () => {
  camera.position.set(2, 3, 6);
  controls.target.set(sim.pos[3*INDEX.Earth], ...);
  controls.update();
});
```

### 11. Label Scale Doesn't Adapt to Zoom

Labels are fixed-size sprites (`vRadius * 1.2` width). When zoomed far out (Neptune view), the Sun's label is huge. When zoomed in (Mercury view), outer planet labels may overlap.

**Fix:** Scale label sprites inversely with camera distance, or hide labels for bodies outside the viewport.

### 12. No Keyboard Shortcuts

Common in simulation demos: Space = pause, R = reset, 1-9 = focus body, +/- = speed. Would improve UX significantly.

### 13. Tooltip Doesn't Show Distance/Velocity

The hover tooltip only shows the body name. Adding distance from Sun and orbital velocity would make it more informative.

### 14. Starfield Depth Cue

The starfield is a flat layer at fixed distance. Adding slight twinkling (opacity oscillation) or depth-based size variation would add immersion.

### 15. No Loading Indicator

The scene takes a moment to initialize (Three.js CDN load + scene setup). The error container only shows after 12 seconds. A loading spinner in the meantime would improve perceived performance.

---

## Specific File / Function-Level Comments

### `index.html`

| Section | Line Range | Comment |
|---------|-----------|---------|
| `VISUAL_RADIUS_SCALE` | ~380 | Good separation of visual vs. physical scale. Values are reasonable. |
| `NBody` class (inlined) | ~180–240 | Exact duplicate of `physics.js`. Use the module version. |
| `EclipseFinder` class (inlined) | ~245–310 | Exact duplicate of `eclipse.js`. Use the module version. |
| `createOrbitLine()` | ~430–490 | Clever orbital-plane computation from cross product. But draws a circle, not ellipse. |
| `addPlanetToScene()` | ~495–620 | Well-structured per-planet setup. Earth/Venus/Saturn get special treatment. |
| `makeGlowTexture()` | ~340 | Canvas-generated radial gradient. Clean, no async failure risk. |
| `makeBandTexture()` | ~360 | Jupiter's procedural bands. Nice touch with noise. |
| `makeSaturnRingTexture()` | ~390 | Cassini division gap included. Good detail. |
| `updateMeshes()` | ~645–695 | Correctly updates all child objects (glow, clouds, atmosphere, rings). |
| `updateHUD()` | ~705–740 | Displays date, speed, energy drift, angular momentum drift, FPS, eclipse status. |
| `finishGrab()` | ~810 | Computes flick velocity from sampled positions. Good physics. |
| `animate()` | ~680–710 | **BUG** — frame rate limiter is inverted (see Critical #1). |
| Error container | ~90–105 | Good: shows error if Three.js CDN fails, with retry button. |
| `MOON_DATA` / `DWARF_DATA` | ~315–345 | Defined but unused. Dead code. Remove or implement. |

### `physics.py` / `simulation.py` / `constants.py`

| File | Comment |
|------|---------|
| `physics.py` | Clean, vectorized NumPy implementation. JS version is a faithful port. ✅ |
| `simulation.py` | Proper barycentre drift removal. JS version matches. ✅ |
| `constants.py` | Canonical body list, GM values, radii. JS `data.js` is an exact mirror. ✅ |
| `integrator.py` | Not directly used by Three.js version (JS has its own Verlet). ✅ |

### `web/physics.js` vs. inlined `NBody` in `index.html`

The inlined version is a character-for-character copy. The only difference: the module exports `NBody` and `removeBarycentreDrift`; the inline version defines them as local functions. This duplication is the core architecture concern (see #5).

### `web/handtrack.js` vs. inlined `HandTracker` in `index.html`

Same duplication. The module version returns `{x, y, z, ...}` in screen pixels; the inline version in `index.html` also returns `{x, y, z}` but the consumer (`onHandFrame`) uses `sx = s.x - rect.left` to convert, while `handtrack.js` uses normalized `{nx, ny}` coordinates. These are **incompatible interfaces** — the inline version and the module version would behave differently if swapped.

---

## What's Done Well

1. **Physics separation** — The Three.js renderer only reads `sim.pos` and `sim.vel`. No physics code is entangled with rendering. ✅
2. **Separate scales** — `VISUAL_RADIUS_SCALE` vs. actual AU positions. Planets are visible without being overlapping. ✅
3. **OrbitControls** — Smooth damping, sensible distance limits (0.5–200 AU). ✅
4. **Sun glow** — Canvas-generated radial gradient texture with additive blending. No external asset dependency. ✅
5. **Directional + ambient lighting** — Correct setup for solar illumination. ✅
6. **Procedural textures** — Jupiter bands, Saturn rings with Cassini division. All sync, no async failure. ✅
7. **Earth atmosphere** — Cloud layer + BackSide glow sphere. Nice visual polish. ✅
8. **Saturn rings** — `RingGeometry` + procedural texture + `MeshStandardMaterial`. ✅
9. **Raycaster interaction** — Hover tooltip + click info panel + hand-of-god grab. ✅
10. **Follow mode** — Camera target tracks selected body via OrbitControls. ✅
11. **Error handling** — Graceful fallback if Three.js CDN fails. ✅
12. **Eclipse detection** — Streaming parabolic refinement, ported faithfully from Python. ✅
13. **HUD** — Date, speed, energy drift, angular momentum drift, FPS, eclipse status. ✅

---

## Final Punch-List to "Wow Demo" Quality

| # | Priority | Task | Est. |
|---|----------|------|------|
| 1 | 🔴 Critical | Fix frame rate limiter — render every frame or use correct skip logic | 15 min |
| 2 | 🔴 Critical | Fix eclipse detection in reverse mode — always call `finder.feed()` | 10 min |
| 3 | 🟠 High | Remove shadow maps (or use PointLight) — performance win, minimal visual loss | 15 min |
| 4 | 🟠 High | Add mass to info panel (GM in standard units) | 10 min |
| 5 | 🟠 High | Update orbit trail after grab-and-throw (rebuild circle from new state) | 30 min |
| 6 | 🟠 High | Fix body rotation speed (remove or scale by real period) | 10 min |
| 7 | 🟡 Medium | Add "Reset View" camera button | 10 min |
| 8 | 🟡 Medium | Remove unused `MOON_DATA` / `DWARF_DATA` dead code (or implement P3) | 10 min |
| 9 | 🟡 Medium | Scale labels with camera distance (hide distant/small ones) | 20 min |
| 10 | 🟡 Medium | Resolve module duplication (import from ES modules or consolidate) | 1h |
| 11 | 🟢 Nice | Add keyboard shortcuts (Space, R, 1-9, +/-) | 20 min |
| 12 | 🟢 Nice | Implement asteroid belt (P3) — 1000 Points between Mars and Jupiter | 30 min |
| 13 | 🟢 Nice | Implement Galilean moons + Titan + Triton (P3 data exists) | 1h |
| 14 | 🟢 Nice | Add loading spinner while Three.js CDN loads | 15 min |
| 15 | 🟢 Nice | Starfield twinkling animation | 15 min |

**Estimated effort to "production demo" quality:** ~4–5 hours for all items, ~1 hour for critical + high-priority only.

---

*Review complete. The foundation is solid — physics is correct, rendering is clean, and the feature set covers all P0–P2. Fix the 2 critical bugs and the shadow map issue, and this is demo-ready.*
