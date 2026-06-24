# SAPK P0+P1 Review Notes

## Done well
- Three.js r152 ES module importmap ✓
- OrbitControls with damping ✓
- Sun glow sprite using canvas radial gradient ✓
- MeshPhongMaterial for planets ✓
- Saturn RingGeometry with procedural canvas texture ✓
- Earth cloud layer as semi-transparent rotating sphere ✓
- Atmosphere rim glow (BackSide emission) for Earth/Venus ✓
- Raycaster hover tooltip ✓
- Click info panel ✓
- Time controls (play/pause, speed slider, date display) ✓
- Focus selector dropdown ✓
- Orbit trail lines (BufferGeometry, circle in orbital plane) ✓
- Starfield particle system ✓
- Lightning: DirectionalLight from Sun + AmbientLight + PCFSoftShadowMap ✓
- NBody physics preserved ✓

## Missing / Needs Fix (P2)
1. Follow mode: click focus-select should move OrbitControls target to follow the body
2. Screenshot/export button
3. Real-time clock mode (currently always fast-forward, no real-time toggle)
4. Escape hatch: if Three.js doesn't load, show graceful error

## Missing (P3 — if time)
5. Asteroid belt
6. Extra moons
7. Dwarf planets
