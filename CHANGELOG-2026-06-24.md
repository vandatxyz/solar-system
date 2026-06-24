# Changelog — 2026-06-24: Solar System Visual Overhaul

> 3D Three.js Solar System Simulator at `web/index.html`
> Server: `http://103.249.116.175:8888`

---

## 🎯 Mục tiêu

Upgrade từ Three.js basic lên cinematic movie-quality rendering: real textures, post-processing bloom, plasma sun shader, config-driven materials, và bug fixes.

---

## 🧠 Agent 1: `hiressentials` (texture download)

**Model:** `9router/sapk/claude-opus-4.8` | **Runtime:** 4m8s

### Task
Download high-quality 2K-4K NASA/Solar System Scope textures vào `web/textures/`.

### Kết quả
19 texture files, tổng **13MB**, tất cả đều 2048×1024 equirectangular:

| Texture | Size | Source |
|---------|------|--------|
| `sun/sun.jpg` | 803 KB | Solar System Scope |
| `mercury/mercury.jpg` | 852 KB | Solar System Scope |
| `mercury/mercury_bump.jpg` | 1 MB | Generated procedural |
| `venus/venus.jpg` | 864 KB | Solar System Scope |
| `earth/earth_day.jpg` | 452 KB | Solar System Scope |
| `earth/earth_clouds.jpg` | 943 KB | Solar System Scope |
| `earth/earth_bump.jpg` | 493 KB | Generated from source |
| `earth/earth_normal.jpg` | 208 KB | Generated from source |
| `earth/earth_specular.jpg` | 126 KB | Generated from source |
| `mars/mars.jpg` | 732 KB | Solar System Scope |
| `mars/mars_bump.jpg` | 653 KB | Generated from source |
| `jupiter/jupiter.jpg` | 487 KB | Solar System Scope |
| `saturn/saturn.jpg` | **2.3 MB** | NASA Wikipedia (4613×2233) |
| `saturn/saturn_ring.png` | 11 KB | Solar System Scope |
| `uranus/uranus.jpg` | 75 KB | Solar System Scope |
| `uranus/uranus_ring.png` | 2 KB | Generated procedural |
| `neptune/neptune.jpg` | 235 KB | Solar System Scope |
| `moon/moon.jpg` | 1 MB | Solar System Scope |
| `moon/moon_bump.jpg` | 1 MB | Solar System Scope |

> **Note:** NASA `eoimages.gsfc.nasa.gov` blocked all requests. Dùng Solar System Scope (CC-BY 4.0) làm primary source. ImageMagick dùng để generate bump/normal/specular maps từ source images.

---

## 🧠 Agent 2: `solarsystemcodeupgrade` (code upgrade)

**Model:** `9router/sapk/claude-opus-4.8` | **Runtime:** 5m31s

### Task
Upgrade `index.html` với config-driven rendering, fire shader, Earth maps, ring geometry, và bug fixes.

### Kết quả — 10 tính năng chính

#### 1. VISUAL_BODY_CONFIG (`index.html` line 489+)
Config object cho tất cả 10 bodies (Sun → Moon):
- `visualRadius`, `fallbackColor`
- texture paths: `tex`, `bump`, `normal`, `specular`, `cloud`
- `ringTexture`, `ringInnerRadius`, `ringOuterRadius`
- `axialTiltDeg`, `rotationPeriodDays` (hỗ trợ retrograde)
- `atmosphere`, `atmosphereColor`, `glow`, `fireShader`

#### 2. Config-driven texture loading
- `loadConfigTextures()` — async loader với retry + fallbackColor
- `getConfigTex(name, type)` — trả về THREE.Texture hoặc null
- Nếu texture fail → dùng fallbackColor thay vì crash

#### 3. Sun ShaderMaterial (fire shader)
- Animated simplex noise (3D noise + FBM octaves)
- Limb darkening (realistic solar disk)
- Hot/cool color mixing + emissive boost ×1.4

#### 4. Earth MeshPhongMaterial (5-layer)
- `map` (day texture) + `bumpMap` (bump scale 0.03) + `normalMap` + `specularMap`
- Separate cloud layer (transparent, slow rotation)
- Atmosphere rim glow (custom glow texture, additive blending)

#### 5. Saturn + Uranus RingGeometry
- `RingGeometry` với transparent PNG texture
- Cassini division visible on Saturn rings
- Config-driven inner/outer radius

#### 6. Axial tilt + rotation period từ config
- Mỗi planet quay với tốc độ riêng từ `rotationPeriodDays`
- Venus, Uranus quay ngược (retrograde) — signed period

#### 7. Bug fixes
- 🌒 **Eclipse reverse mode**: `Math.abs(b.t - a.t)` — JD tính đúng khi time chạy ngược
- 🪐 **Orbit trail after grab**: `createOrbitLine` dùng `currentState` thay vì J2000
- 🐌 **Rotation speeds**: Dùng `sim.dt` thay `stepSize`
- 📐 **Pixel ratio cap**: `Math.min(window.devicePixelRatio, 2)` cho performance
- ♻️ **GC optimization**: Preallocated `_tempVec3` trong updateMeshes

#### 8. Old code cleanup
- Xoá `__texEncoded` base64 approach
- Xoá TEX_LIST / getTex cũ
- Texture path structure: `textures/{planet}/{file}` (organized từ flat→subdirectories)

#### 9. Post-processing pipeline
- `vendor/postprocessing/EffectComposer.js` + `RenderPass`
- `UnrealBloomPass` (strength 1.2, radius 0.4, threshold 0.75)
- `ShaderPass` — custom GLSL vignette (dark corners)
- ACES Filmic tone mapping + exposure 1.2
- Auto-resize composer on window resize

#### 10. Upstream features (giữ nguyên)
- Tour mode (6 stops, camera lerp, glassmorphism UI)
- 6 showcase presets (Overview, Inner, Earth, Jupiter, Saturn, Asteroids)
- Measurement tool (click 2 bodies → AU/km)
- Hand tracking (MediaPipe)
- Keyboard shortcuts: Space/R/+/T/M/Esc
- Moons (6), Dwarf planets (4), Asteroid belt (2000 particles)
- Loading spinner, Orbit trails, Labels, Screenshot export

---

## 🛠️ Manual fixes (post-agent)

Sau khi agent chạy xong, em tự fix thêm:

| Fix | What | Why |
|-----|------|-----|
| 🔴 `Pass.js` + `MaskPass.js` | Download 2 vendor files thiếu | EffectComposer import dependency |
| ☀️ **Sun shader v2** | 3D simplex noise → 6-octave FBM, domain warping, granulation, filament, 4-color palette | Anh bảo "mặt trời xấu quá" |
| ☀️ **Glow 128→512px** | 3-layer: inner + corona (10x) + wispy texture | Solar corona effect |
| ☀️ **Bloom 0.8→1.2** | Tăng intensity, hạ threshold 0.85→0.75 | Cinematic glow |
| ☀️ **Sun radius 0.18→0.22** | Larger visual presence | Imposing hot star |
| 🐛 `wisp.rotation` | Sprite.rotation là read-only → dùng `.material.rotation` | Runtime crash |
| 🐛 `glow is not defined` | Stale ref trong coronaWisp block | ReferenceError |
| 🫨 Favicon 404 | Thêm `<link rel="icon" href="data:,">` | Browser noise |
| 🔄 Sun pulse animation | Glow + corona + wisp pulse independently | Dynamic feel |

---

## 📦 Git History (today's commits)

```
01f870b fix: remove stale glow refs + suppress favicon 404
12c25dd fix: Sun sprite rotation — use material.rotation
a4d1206 feat: epic Sun upgrade — 6-octave plasma shader + 3-layer corona + bloom
1637074 fix: add missing Pass.js + MaskPass.js for EffectComposer
69b2b91 feat: hi-res textures from Solar System Scope (2K equirectangular)
c23acf4 feat: cinematic bloom post-processing + hi-res textures upgrade
a03bf85 feat: config-driven rendering + real planet textures + fire shader Sun
44059ad feat: real NASA planet textures + enhanced procedural fallbacks
74ce007 feat(upgrade): cinematic tour, presets, camera lerp, measurement tool, sun corona
6d5de0c feat(P3): solar system — moons, dwarfs, asteroid belt + bugfixes
```

---

## 📊 Project Stats (end of day)

| Metric | Value |
|--------|-------|
| `index.html` | **115 KB**, ~2900 lines |
| Textures | **19 files, 13 MB** |
| Vendor | **9 files, 1.3 MB** |
| Total repo | **~14.3 MB** |
| Server | Python HTTP on `:8888` |
| Features | P0✅ P1✅ P2✅ P3✅ |
| Current model | `9router/cmc/deepseek/deepseek-v4-pro` |

---

## 🔮 Next steps (future)

- [ ] HDRI starfield background (thay vì dots)
- [ ] Earth atmospheric scattering (Rayleigh shader)
- [ ] Sun lens flare effect
- [ ] Particle solar wind
- [ ] Orbit ellipses (Mercury eccentricity 0.21)
- [ ] Starfield twinkling
- [ ] Body detail panel upgrade
- [ ] Time travel presets
- [ ] Shareable URL state
