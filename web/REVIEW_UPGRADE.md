# Solar System Simulator — Three.js Upgrade Review

**Reviewer:** Senior Three.js / WebGL Engineer
**Date:** 2026-06-24
**Scope:** `web/index.html` (Three.js renderer), `web/physics.js`, `web/data.js`, `web/eclipse.js`, `web/renderer.js`, `web/main.js`, `web/handtrack.js`, `physics.py`, `simulation.py`, `constants.py`

---

## Overall Verdict: **PASS WITH FIXES**

The Three.js upgrade delivers the P0–P2 feature set and adds significant P3 content (asteroid belt, extra moons, dwarf planets, keyboard shortcuts, camera reset). Physics is faithful to the Python backend, procedural textures eliminate async loading risks, and the scene is visually compelling. However, there are **3 bugs that will crash or visibly break the demo**, several polish gaps, and one serious architectural issue that must be resolved before shipping to a production audience.

---

## Verdict: PASS WITH FIXES

| Metric | Score | Notes |
|--------|-------|-------|
| **Demo wow score** | **6 / 10** | Good foundation, but no bloom/post-processing, no camera fly-through, static Earth textures, and a keyboard shortcut that throws a ReferenceError |

---

## 🔴 Critical Bugs (3)

### BUG-1: `sim.paused` ReferenceError — Keyboard Spacebar Crashes

**File:** `index.html`, keyboard shortcuts section (~line 2100)
```javascript
case ' ':
  e.preventDefault();
  sim.paused = !sim.paused;     // ← NBody has no 'paused' property
  playBtn.textContent = sim.paused ? '▶ Play' : '⏸ Pause';
  break;
```
**Impact:** Pressing spacebar throws `ReferenceError` in console (strict mode) or silently sets an unused property (sloppy). The play/pause state is managed by the standalone `running` variable, not `sim.paused`. The button text update references the wrong variable.

**Fix:**
```javascript
case ' ':
  e.preventDefault();
  running = !running;
  playBtn.textContent = running ? '❚❚ Pause' : '▶ Play';
  break;
```

### BUG-2: `speedSlider` ReferenceError — Keyboard +/- Crashes

**File:** `index.html`, keyboard shortcuts section (~line 2106)
```javascript
case '+': case '=':
  speedSlider.value = Math.min(100, Number(speedSlider.value) + 1);   // ← speedSlider never declared
  speedSlider.dispatchEvent(new Event('input'));
  break;
```
**Impact:** Pressing `+` or `-` throws `ReferenceError`. The slider element is `document.getElementById('speed')` — never assigned to `speedSlider`.

**Fix:**
```javascript
case '+': case '=': {
  const sl = document.getElementById('speed');
  sl.value = Math.min(200, Number(sl.value) + 5);
  sl.dispatchEvent(new Event('input'));
  break;
}
case '-': case '_': {
  const sl = document.getElementById('speed');
  sl.value = Math.max(1, Number(sl.value) - 5);
  sl.dispatchEvent(new Event('input'));
  break;
}
```

### BUG-3: Eclipse Detection Disabled in Reverse Mode

**File:** `index.html`, animate loop (~line 1830)
```javascript
if (direction > 0) finder.feed(sim);   // ← only feeds when going forward
```
**Impact:** When the user clicks "Reverse", the eclipse finder stops receiving data. The eclipse list freezes. Historical eclipses (from before the current date) are never discovered. This violates a core acceptance criterion.

**Fix:**
```javascript
finder.feed(sim);   // always feed; finder handles both directions
```

---

## 🟠 High-Priority Issues (5)

### HIGH-1: No URL State Restoration

**Impact:** Users cannot share or bookmark a specific view. Opening a URL like `#focus=Saturn&speed=50` should restore state. Currently there is zero URL hash parsing or serialization.

**Fix:** On boot, parse `location.hash` for `focus`, `speed`, `time` params. On state changes (focus, speed slider, reset), update the hash with `history.replaceState`.

### HIGH-2: Info Panel Missing Orbital Velocity

**File:** `index.html`, `showInfoPanel()` (~line 1540)
```javascript
infoPanel.innerHTML = `
  <div class="info-name" ...>${name}</div>
  <div class="info-row"><span class="info-label">Radius</span>...`
  <div class="info-row"><span class="info-label">Mass</span>...`
  <div class="info-row"><span class="info-label">Distance from Sun</span>...`
`;
```
Mass and velocity data is available from `MASS_KG[name]` and `sim.vel`, but velocity is missing from the display.

**Fix:** Add a velocity row: `Math.hypot(sim.vel[3*i], sim.vel[3*i+1], sim.vel[3*i+2]).toFixed(4) + ' AU/day'`.

### HIGH-3: Orbit Trails Don't Rebuild After Hand-of-God Grab

**File:** `index.html`, `finishGrab()` (~line 1590)

After a user grabs and flings a planet, `finishGrab()` calls `createOrbitLine()` which rebuilds the trail from J2000 state — not from the new position/velocity. The old stale circle remains while the body moves on a new path.

**Fix:** After grab, compute the new orbital plane from the body's current position and velocity cross product, then draw the new ellipse/circle.

### HIGH-4: Monolithic 81KB HTML vs. Clean Module Architecture

**Impact:** The `web/` directory has clean ES modules (`data.js`, `physics.js`, `eclipse.js`, `handtrack.js`, `main.js`, `renderer.js`) with proper exports. The `index.html` inlines and duplicates all of this into a single script block with hardcoded constants. Two diverging codebases means physics fixes in one don't reach the other.

**Recommendation:** One of:
1. Make `index.html` import from the existing ES modules via the importmap (preferred).
2. Delete the now-redundant modular `.js` files and document `index.html` as canonical.
3. Extract shared constants into a single `data.js` consumed by both.

### HIGH-5: Hand Tracking Interface Inconsistency

**File:** `web/handtrack.js` returns `{nx, ny, z, ...}` (normalized coordinates).
**File:** `index.html` inline `HandTracker` returns `{x, y, z, ...}` (screen pixels) in some paths and `{nx, ny}` in others.

The `onHandFrame()` consumer in `index.html` uses `sx = s.x - rect.left` (pixel-based) but the hand tracker actually returns screen-pixel coordinates. If the hand tracker module is ever swapped in, the interface mismatch would break hand control silently.

**Fix:** Standardize on one interface (normalized `nx/ny` is better — screen-independent).

---

## 🟡 Medium-Priority Issues (5)

### MED-1: Body Rotation Conflates Frame Rate with Simulation Speed

**File:** `index.html`, `updateMeshes()` (~line 1340)
```javascript
mesh.rotation.y += _rotSpeed * Math.abs(sim.dt);
```
This accumulates per animation frame, not per simulation step. At 60fps it looks right, but at 30fps or 120fps the visual rotation rate changes. The fix is to track accumulated rotation time or apply rotation per step.

### MED-2: No Loading Spinner (Actually Present but Fragile)

The HTML has a loading spinner and error container, but `__solarSysLoaded` is only set at the very end of the module script. If the script fails partway (e.g., a Three.js API issue), the spinner stays forever with no feedback. The 12-second timeout is too long.

**Fix:** Use a shorter timeout (5s) and add incremental status ("Loading Three.js…", "Building scene…", etc.).

### MED-3: `createOrbitLine()` Is Called But Dead Code on Reset

After reset, `document.getElementById('chk-trails').dispatchEvent(new Event('change'))` toggles trail visibility but doesn't rebuild orbit lines for bodies that were grabbed. The orbit line rebuild code exists but isn't reliably invoked after all state changes.

### MED-4: Labels Don't Fade Smoothly with Distance

Labels are toggled by a hard cutoff at `150` AU distance. This creates a visible pop-in/pop-out as bodies cross the threshold.

**Fix:** Use `sprite.material.opacity = THREE.MathUtils.clamp(1.0 - d/150, 0, 1)` for smooth fade.

### MED-5: Saturn Ring Material Uses MeshStandardMaterial Without PBR Environment

**File:** `index.html`, Saturn ring setup
```javascript
const ringMat = new THREE.MeshStandardMaterial({
  map: ringTex, roughness: 0.7, metalness: 0.1, ...
});
```
`MeshStandardMaterial` requires an environment map for proper PBR reflections. Without one, the metalness parameter has no visible effect and the material degrades to `MeshPhong`-like behavior. Either add a simple environment (e.g., `PMREMGenerator` with a solid color) or switch to `MeshPhongMaterial`.

---

## 🟢 Nice-to-Have / Polish Suggestions (8)

### POLISH-1: No Cinematic / Fly-Through Tour Mode

The spec mentions "Tour mode can run without user intervention." Currently there is no camera tour/fly-through feature. Adding a simple time-based camera path (e.g., slowly orbit around inner planets → zoom to Jupiter → Saturn fly-by) would dramatically increase demo wow.

### POLISH-2: No Post-Processing Bloom

The Sun glow is a basic additive sprite. Using `EffectComposer` with `UnrealBloomPass` would make the Sun look dramatically more premium. The glow sprite could be replaced with a proper HDR bloom pass.

### POLISH-3: Earth Has No Night Side or Continental Detail

Earth is a solid blue sphere with a semi-transparent white cloud layer. No texture maps, no day/night terminator effect, no continental outlines. A simple procedural noise texture for continents and a darkening of the shadow hemisphere would be a large visual upgrade.

### POLISH-4: Stars Are Static, No Twinkle

The starfield is 5000 static white points. Adding per-star twinkling (sinusoidal opacity variation) or color temperature variation (warm/cool/blue stars) would add life.

### POLISH-5: No Asteroid Size Variation

All 2000 asteroids are the same `size: 0.015`. Randomizing the size attribute per-asteroid (using the already-computed `sizes[]` array) would add visual depth.

### POLISH-6: Tooltip Doesn't Show Orbital Velocity or Distance

The hover tooltip only shows the body name. Adding distance-from-Sun and velocity would make it more informative on hover.

### POLISH-7: Dwarf Planet Orbits Not to Scale

Dwarf planets orbit at true AU distances (39–68 AU) but the camera max distance is 200 AU. Pluto at 39 AU is far from the inner planets, making it hard to see both at once. Consider a "scale mode" toggle or auto-fit.

### POLISH-8: No Measurement Tools

The spec mentions measurement tools. Currently there's no ruler or angle measurement between bodies.

---

## Performance Analysis

### ✅ Good
- **No per-frame material/geometry creation** — all meshes, materials, and textures are created once at boot
- **Procedural textures** — no async texture loading, no GPU stalls from decoding
- **Asteroid belt is capped** — 2000 points with pre-allocated Float32Array, updated in-place
- **Star count is capped** — 5000 static points, no per-frame mutation
- **Label sprites use `depthTest: false`** — correct for always-visible overlays

### ⚠️ Risks
- **Asteroid position update** — 6000 float writes + `needsUpdate = true` every frame. Acceptable on desktop but could be optimized with a `THREE.Points` animation shader (vertex shader reads time uniform, no CPU copy).
- **`new THREE.Vector3()` in hot loop** — `camera.position.distanceTo(new THREE.Vector3(x, y, z))` inside `updateMeshes()` creates a temporary Vector3 every frame per body. Pre-allocate a reusable vector.
- **`EclipseFinder.feed()` allocates `Float64Array.from()` per call** — called 20 times per frame at default speed. Could use a reusable typed array.
- **Labels group rebuild** — `rebuildLabels()` disposes old materials/textures then recreates. Only called on checkbox change, so acceptable, but could leak if called frequently.

### Resource Disposal
- `rebuildLabels()` correctly disposes old `material` and `material.map` before removing children ✅
- `finishGrab()` disposes old orbit line geometry and material before rebuilding ✅
- **Missing:** On page unload, no `renderer.dispose()`, no material/geometry disposal of planet meshes. For a single-page app this is fine, but for long-running sessions it would accumulate.

---

## Python Physics Code Review

### `physics.py` — ✅ CLEAN
- Fully vectorized NumPy N² acceleration computation
- Proper diagonal masking with `np.fill_diagonal(dist2, np.inf)` to avoid division by zero
- Energy and angular momentum computation are correct for conservation checks
- JS port in `web/physics.js` is a faithful, character-for-character translation

### `simulation.py` — ✅ CLEAN
- `SolarSystem.run()` properly computes energy/angular momentum drift for diagnostics
- `removeBarycentre_drift()` correctly zeros total momentum in the barycentric frame
- dt=0.1 days gives 270 steps per Moon orbit — sufficient for eclipse timing accuracy
- EclipseFinder integration is correct

### `constants.py` — ✅ CLEAN
- J2000.0 epoch, IAU 2012 AU definition, IAU 2015 radii — all standard
- GM values are JPL body-center (not barycenter), consistent with Moon-as-separate-body model
- JS mirror in `web/data.js` is identical

### `integrator.py` (not directly reviewed, but referenced)
- velocity-Verlet is symplectic and time-reversible — correct choice for orbital mechanics
- The JS `NBody.step()` implements the same half-kick → drift → half-kick scheme

---

## File / Function-Level Notes

### `index.html`

| Location | Lines (approx) | Assessment |
|----------|-----------------|------------|
| `NBody` class (inlined) | 180–240 | Exact duplicate of `physics.js` — architectural debt |
| `EclipseFinder` class (inlined) | 245–310 | Exact duplicate of `eclipse.js` |
| `MOON_DATA` / `DWARF_DATA` | 315–345 | ✅ Now used — P3 content active |
| `makeGlowTexture()` | ~340 | ✅ Clean canvas radial gradient |
| `makeBandTexture()` | ~360 | ✅ Nice procedural Jupiter bands with noise |
| `makeSaturnRingTexture()` | ~390 | ✅ Cassini division gap included |
| `createOrbitLine()` | ~430–490 | Clever cross-product plane derivation; draws circles, not ellipses |
| `addPlanetToScene()` | ~495–620 | Well-structured per-planet setup with special Earth/Venus/Saturn handling |
| `buildMoons()` | ~625–660 | P3: Io, Europa, Ganymede, Callisto, Titan, Triton |
| `buildDwarfs()` | ~665–695 | P3: Pluto, Ceres, Eris, Makemake |
| `buildAsteroidBelt()` | ~700–740 | P3: 2000 asteroids with Kepler-like orbits |
| `updateMeshes()` | ~750–850 | Correctly updates glow, clouds, atmosphere, rings, labels |
| `animate()` | ~1810–1870 | Main loop — physics stepping + rendering + follow mode |
| `showInfoPanel()` | ~1540–1570 | Shows name, radius, mass, distance — missing velocity |
| `finishGrab()` | ~1590–1620 | Flick velocity from sampled positions — good physics |
| Keyboard shortcuts | ~2095–2125 | **BUGS** — `sim.paused` and `speedSlider` are undefined |
| `#btn-reset-view` handler | ~2080 | ✅ Resets camera to `(2, 3, 6)` |

### `web/physics.js`
- Exports `NBody` and `removeBarycentreDrift`
- O(N²) force loop with Float64Array — correct and cache-friendly for N=10
- `energy()` and `angularMomentum()` are correct conservation diagnostics

### `web/data.js`
- Exports all constants, body metadata, J2000 state
- GM conversion from km³/s² to AU³/day² matches Python exactly

### `web/eclipse.js`
- Streaming parabolic refinement of Sun-Moon angular separation minima
- `classify()` handles total/annular/partial with correct geometry
- `jdToCalendar()` uses Fliegel-Van Flandern algorithm — correct

### `web/renderer.js`
- Canvas 2D renderer (legacy, used by `main.js`)
- Clean painter's-algorithm sorting, correct Saturn ring splitting (back/front halves)
- Orthographic projection with manual yaw/pitch — no Three.js dependency

### `web/main.js`
- Canvas 2D orchestration — binds physics + renderer + UI
- Mouse interaction with proper screen→world unprojection
- Clean separation of concerns

### `web/handtrack.js`
- MediaPipe Hands wrapper with normalized coordinate output
- Hysteresis on pinch detection (0.05 on / 0.08 off) prevents chatter
- Skeleton rendering on overlay canvas — nice visual feedback

---

## Final Punch-List (Ordered by Impact)

| # | Priority | Task | Est. | Blocks Demo? |
|---|----------|------|------|--------------|
| 1 | 🔴 Critical | Fix `sim.paused` → `running` in spacebar handler | 5 min | Yes — crashes |
| 2 | 🔴 Critical | Fix `speedSlider` → `document.getElementById('speed')` in +/- handler | 5 min | Yes — crashes |
| 3 | 🔴 Critical | Fix eclipse detection: remove `direction > 0` guard, always `finder.feed(sim)` | 5 min | Yes — feature broken |
| 4 | 🟠 High | Add URL hash state restore (`#focus=Saturn&speed=50`) | 30 min | No, but expected |
| 5 | 🟠 High | Add orbital velocity to info panel | 10 min | No |
| 6 | 🟠 High | Rebuild orbit trails after hand-of-god grab from new state | 30 min | No, but misleading |
| 7 | 🟠 High | Resolve module duplication (import from ES modules or consolidate) | 1h | No, but tech debt |
| 8 | 🟠 High | Standardize hand tracker interface (normalized coords) | 20 min | No, but fragile |
| 9 | 🟡 Medium | Fix body rotation to be simulation-time-correct | 15 min | No |
| 10 | 🟡 Medium | Add smooth label opacity fade with distance | 15 min | No |
| 11 | 🟡 Medium | Add Saturn ring PBR environment or switch to Phong | 10 min | No |
| 12 | 🟡 Medium | Pre-allocate temp Vector3 in `updateMeshes()` hot path | 5 min | No |
| 13 | 🟡 Medium | Reduce loading spinner timeout from 12s to 5s | 5 min | No |
| 14 | 🟢 Nice | Add cinematic camera tour mode (fly-through paths) | 2h | No |
| 15 | 🟢 Nice | Add UnrealBloomPass post-processing for Sun glow | 1h | No |
| 16 | 🟢 Nice | Add Earth night side + procedural continent texture | 1h | No |
| 17 | 🟢 Nice | Add star twinkling animation | 30 min | No |
| 18 | 🟢 Nice | Randomize asteroid sizes using pre-computed `sizes[]` array | 10 min | No |
| 19 | 🟢 Nice | Add measurement tools (ruler, angle) | 2h | No |
| 20 | 🟢 Nice | Draw Keplerian ellipses instead of circles for orbit trails | 1h | No |

**Estimated effort:** ~20 min to fix all critical bugs, ~2h for high+medium, ~8h for full polish.

---

## What's Done Well

1. **Physics separation** — Three.js renderer only reads `sim.pos`/`sim.vel`. No physics mutation from rendering. ✅
2. **Dual-scale rendering** — `VISUAL_RADIUS_SCALE` vs actual AU positions. Planets visible without overlap. ✅
3. **OrbitControls** — Smooth damping (0.08), sensible limits (0.5–200 AU). ✅
4. **Sun glow** — Canvas radial gradient sprite with additive blending. No external assets. ✅
5. **Procedural textures** — Jupiter bands, Saturn rings with Cassini division, all sync. ✅
6. **Earth atmosphere** — Cloud layer + BackSide glow sphere + Venus atmosphere. ✅
7. **Saturn rings** — RingGeometry + procedural texture with Cassini division gaps. ✅
8. **Raycaster interaction** — Hover tooltip + click info panel + hand-of-god grab-and-throw. ✅
9. **Follow mode** — Camera target tracks selected body via OrbitControls, with highlight ring. ✅
10. **Eclipse detection** — Streaming parabolic refinement, faithfully ported from Python. ✅
11. **HUD diagnostics** — Date, speed, energy drift, angular momentum drift, FPS, eclipse status. ✅
12. **Error handling** — Graceful fallback if Three.js CDN fails, with retry button. ✅
13. **P3 content active** — Moons (Io, Europa, Ganymede, Callisto, Titan, Triton), dwarf planets (Pluto, Ceres, Eris, Makemake), 2000-asteroid belt all functional. ✅
14. **Keyboard shortcuts** — Space (pause), R (reset), Escape (free camera), +/- (speed) — all present (with bugs noted above). ✅
15. **Python backend** — Clean, vectorized, well-documented. JS ports are faithful. ✅

---

*The Three.js upgrade is a substantial improvement over the Canvas 2D renderer. Fix the 3 critical bugs (15 minutes of work), and this is demo-ready. The remaining polish items are what separate "working demo" from "wow demo."*
