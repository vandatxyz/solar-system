# Solar System Three.js Upgrade — Spec

## Goal
Upgrade web frontend from 2D Canvas to interactive 3D Three.js visualization. Preserve existing physics core.

## Hard Constraints
- Do NOT rewrite N-body leapfrog physics (physics.js, data.js).
- Keep J2000 seed state and AU/day units unchanged.
- Three.js frontend consumes existing body positions from simulation.
- Must run smoothly at ~60 FPS on desktop.
- Use separate visual scales for distance (AU) and planet radius (km/visual).
- If texture loading fails, use procedural/material fallback.

## Project Structure (current)
- `web/index.html` — single bundled HTML (1719 lines)
- `web/main.js` — orchestration, interaction, run loop
- `web/renderer.js` — Canvas 2D rendering (TO BE REPLACED)
- `web/physics.js` — NBody integrator (KEEP)
- `web/data.js` — constants, bodies, J2000 state (KEEP)
- `web/eclipse.js` — eclipse detection (KEEP)
- `web/handtrack.js` — webcam hand tracking (KEEP)

## Deliverables

### P0 (Must have — ~3-4h)
1. **Three.js scene** with perspective camera + `OrbitControls`
2. **Sun** as emissive sphere with glow sprite (additive blending)
3. **Planets** with materials:
   - Mercury: grey matte
   - Venus: yellowish cloudy
   - Earth: blue/green + cloud layer (transparent rotating)
   - Mars: reddish
   - Jupiter: banded procedural texture
   - Saturn: procedural texture + ring mesh with transparency
   - Uranus: cyan
   - Neptune: blue
   - Moon: grey
4. **Orbit trails** — draw orbital paths (ellipses or trail lines)
5. **Planet labels** — always face camera (sprite text)

### P1 (~1-2h)
6. **Sun glow** — lens flare or sprite glow halo
7. **Lighting** — directional light from Sun, ambient light
8. **Day/night terminator** via lighting
9. **Atmosphere glow** — Earth rim glow, Venus glow
10. **Time controls** — play/pause, speed multiplier slider, date display
11. **Saturn rings** — ring geometry with procedural color/texture

### P2 (~1h)
12. **Hover tooltip** — planet name on mouseover (raycaster)
13. **Click info panel** — show name, radius, mass, distance from Sun
14. **Follow mode** — camera auto-follows selected body
15. **Reset camera** button
16. **Screenshot export** button

### P3 (if time remains)
17. **Asteroid belt** — procedural ring of small bodies
18. **Extra moons** — Io, Europa, Ganymede, Callisto, Titan, Triton
19. **Dwarf planets** — Pluto, Ceres, Eris, Makemake

## Tech
- Three.js (loaded from CDN: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r152/three.min.js`)
- OrbitControls from CDN or bundled
- No build step — keep single HTML file deliverable
- All planet textures: load from `https://github.com/mrdoob/three.js/tree/master/examples/textures/planets/` (fallback to MeshPhongMaterial + procedural color)

## Integration
- Existing `main.js` simulation runs unchanged
- Every frame: read `sim.pos` → update Three.js mesh positions
- `Renderer` class replaced by `ThreeRenderer`
- Camera: `PerspectiveCamera` + `OrbitControls`

## Acceptance Criteria
- Zoom from full solar system to near-planet view smoothly
- All 8 planets visible and distinguishable by color/size/texture
- Time advances correctly, date display updates
- Physics output unchanged (same seed units)
- Graceful fallback if CDN/textures fail
