// renderer.js -- Canvas 2D view of the simulation with an interactive camera.
//
// The simulation lives in 3D ecliptic coordinates (AU). The renderer projects
// those onto the screen with a simple camera the user can drive:
//
//     - yaw / pitch  : orbit the viewpoint around the focus  (left-drag)
//     - zoom         : AU-per-pixel scale                     (wheel)
//     - pan          : move the focus point                   (right-drag)
//     - focus        : lock the camera onto a chosen body     (click / picker)
//
// Bodies are drawn at exaggerated sizes (true planetary radii are invisible at
// solar-system scale), with orbital trails accumulated as the system evolves.

export class Renderer {
  constructor(canvas, bodies) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.bodies = bodies;
    this.n = bodies.length;

    // Camera state.
    this.scale = 90;        // pixels per AU (set to frame the inner system)
    this.yaw = 0.0;         // rotation about ecliptic +z
    this.pitch = 0.4;       // tilt toward the ecliptic plane
    this.focus = [0, 0, 0]; // world-space point the camera centres on (AU)
    this.focusIndex = 0;    // body index the focus tracks (-1 = free)

    // Per-body screen positions (filled each draw), used for picking.
    this.screen = new Array(this.n).fill(null).map(() => ({ x: 0, y: 0, r: 0 }));

    // Orbital trails: a ring buffer of recent world positions per body.
    this.trailLen = 600;
    this.trails = bodies.map(() => []);

    // Cosmetic per-body draw radius (px), loosely by class, not to scale.
    this.drawRadius = bodies.map((b) => {
      if (b.name === "Sun") return 14;
      if (b.name === "Jupiter") return 9;
      if (b.name === "Saturn") return 8;
      if (["Uranus", "Neptune"].includes(b.name)) return 6.5;
      if (["Venus", "Earth", "Mars"].includes(b.name)) return 4.5;
      if (b.name === "Mercury") return 3.6;
      if (b.name === "Moon") return 2.2;
      return 3.5;
    });

    // Index of the Sun (light source) for shading the other bodies.
    this.sunIndex = bodies.findIndex((b) => b.name === "Sun");

    this.showTrails = true;
    this.showLabels = true;
  }

  // World (AU, 3D) -> camera space, applying focus translation then yaw/pitch.
  _toCamera(x, y, z) {
    const dx = x - this.focus[0];
    const dy = y - this.focus[1];
    const dz = z - this.focus[2];
    // Yaw about z.
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const x1 = cy * dx - sy * dy;
    const y1 = sy * dx + cy * dy;
    const z1 = dz;
    // Pitch about the (rotated) x axis.
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const y2 = cp * y1 - sp * z1;
    const z2 = sp * y1 + cp * z1;
    return [x1, y2, z2];     // z2 is depth (toward viewer), used for ordering
  }

  // Camera space -> screen pixels (orthographic; depth only sorts draw order).
  _toScreen(cx, cy) {
    return [
      this.canvas.width / 2 + cx * this.scale,
      this.canvas.height / 2 - cy * this.scale,
    ];
  }

  // Record the current positions into the trail ring buffers.
  pushTrail(pos) {
    if (!this.showTrails) return;
    for (let i = 0; i < this.n; i++) {
      const t = this.trails[i];
      t.push([pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
      if (t.length > this.trailLen) t.shift();
    }
  }

  clearTrails() {
    this.trails = this.bodies.map(() => []);
  }

  // Lock the focus onto a body (or pass -1 to free the camera in place).
  setFocus(index, pos) {
    this.focusIndex = index;
    if (index >= 0) {
      this.focus = [pos[3 * index], pos[3 * index + 1], pos[3 * index + 2]];
    }
  }

  // Pick the body whose drawn disk is nearest a screen point (or -1).
  pick(sx, sy) {
    let best = -1, bestD = 14; // px tolerance
    for (let i = 0; i < this.n; i++) {
      const s = this.screen[i];
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < Math.max(bestD, s.r + 4)) { bestD = d; best = i; }
    }
    return best;
  }

  draw(pos) {
    const { ctx, canvas } = this;

    // Keep the focus glued to the tracked body.
    if (this.focusIndex >= 0) {
      const i = this.focusIndex;
      this.focus = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
    }

    ctx.fillStyle = "#05070d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this._drawStarfield();

    // Project everything, carrying depth for painter's-order sorting.
    const items = [];
    for (let i = 0; i < this.n; i++) {
      const cam = this._toCamera(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      const [sx, sy] = this._toScreen(cam[0], cam[1]);
      items.push({ i, sx, sy, depth: cam[2] });
      this.screen[i] = { x: sx, y: sy, r: this.drawRadius[i] };
    }

    if (this.showTrails) this._drawTrails();

    // The Sun's projected position is the light source for shading the
    // illuminated hemisphere of every other body.
    const sun = this.sunIndex >= 0
      ? items.find((it) => it.i === this.sunIndex)
      : null;

    // Far bodies first (painter's algorithm).
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) this._drawBody(it.i, it.sx, it.sy, sun);
  }

  _drawTrails() {
    const { ctx } = this;
    for (let i = 0; i < this.n; i++) {
      const t = this.trails[i];
      if (t.length < 2) continue;
      ctx.beginPath();
      for (let k = 0; k < t.length; k++) {
        const [cx, cy] = this._toCamera(t[k][0], t[k][1], t[k][2]);
        const [sx, sy] = this._toScreen(cx, cy);
        if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.strokeStyle = this.bodies[i].color + "55"; // translucent
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Lighten/darken a #rrggbb hex colour by `f` in [-1, 1].
  _shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f >= 0) {
      r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f;
    } else {
      r *= 1 + f; g *= 1 + f; b *= 1 + f;
    }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  _drawBody(i, sx, sy, sun) {
    const { ctx } = this;
    const b = this.bodies[i];
    const r = this.drawRadius[i];

    if (b.name === "Sun") {
      // Outer corona glow.
      const glow = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 3.2);
      glow.addColorStop(0, "rgba(255,228,140,0.55)");
      glow.addColorStop(0.4, "rgba(255,190,70,0.22)");
      glow.addColorStop(1, "rgba(255,180,40,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 3.2, 0, 2 * Math.PI);
      ctx.fill();
      // Bright photosphere.
      const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      core.addColorStop(0, "#fffdf0");
      core.addColorStop(0.6, "#ffe9a0");
      core.addColorStop(1, "#ffb52e");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, 2 * Math.PI);
      ctx.fill();
      this._label(i, b, sx, sy, r);
      return;
    }

    // Direction toward the Sun in screen space -> offset the highlight so the
    // lit limb faces the Sun and the far limb falls into shadow.
    let lx = -0.4, ly = -0.4;
    if (sun) {
      const dx = sun.sx - sx, dy = sun.sy - sy;
      const d = Math.hypot(dx, dy) || 1;
      lx = dx / d; ly = dy / d;
    }

    // Saturn's rings, back half drawn before the globe.
    if (b.name === "Saturn") this._drawRings(sx, sy, r, lx, ly, true);

    // Shaded sphere: highlight offset toward the light, terminator into shadow.
    const hx = sx + lx * r * 0.55, hy = sy + ly * r * 0.55;
    const g = ctx.createRadialGradient(hx, hy, r * 0.1, sx, sy, r * 1.05);
    g.addColorStop(0, this._shade(b.color, 0.55));
    g.addColorStop(0.5, b.color);
    g.addColorStop(1, this._shade(b.color, -0.78));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, 2 * Math.PI);
    ctx.fill();

    // Subtle rim light on the lit edge.
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, 2 * Math.PI);
    ctx.clip();
    const rim = ctx.createRadialGradient(hx, hy, r * 0.7, hx, hy, r * 1.4);
    rim.addColorStop(0, "rgba(255,255,255,0)");
    rim.addColorStop(1, "rgba(255,255,255,0.18)");
    ctx.fillStyle = rim;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    ctx.restore();

    if (b.name === "Saturn") this._drawRings(sx, sy, r, lx, ly, false);

    if (this.focusIndex === i) {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 6, 0, 2 * Math.PI);
      ctx.strokeStyle = "#ffffffaa";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    this._label(i, b, sx, sy, r);
  }

  _label(i, b, sx, sy, r) {
    if (!this.showLabels) return;
    const { ctx } = this;
    ctx.fillStyle = "#cfd6e4";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(b.name, sx + r + 4, sy - r - 2);
  }

  // Saturn's ring system as a tilted ellipse, split into a back and front half
  // so the globe sits correctly between them.
  _drawRings(sx, sy, r, lx, ly, backHalf) {
    const { ctx } = this;
    const rx = r * 2.2;          // ring outer radius (x)
    const ry = r * 0.7;          // squashed by viewing tilt
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-0.45);
    ctx.beginPath();
    if (backHalf) ctx.ellipse(0, 0, rx, ry, 0, Math.PI, 2 * Math.PI);
    else          ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI);
    ctx.lineWidth = r * 0.55;
    ctx.strokeStyle = backHalf ? "rgba(210,190,140,0.45)" : "rgba(230,210,160,0.8)";
    ctx.stroke();
    // Thin inner ring gap.
    ctx.beginPath();
    if (backHalf) ctx.ellipse(0, 0, rx * 0.78, ry * 0.78, 0, Math.PI, 2 * Math.PI);
    else          ctx.ellipse(0, 0, rx * 0.78, ry * 0.78, 0, 0, Math.PI);
    ctx.lineWidth = r * 0.18;
    ctx.strokeStyle = backHalf ? "rgba(180,160,120,0.35)" : "rgba(200,180,135,0.6)";
    ctx.stroke();
    ctx.restore();
  }

  _drawStarfield() {
    // A cheap, stable starfield seeded once from the canvas size.
    if (!this._stars) {
      this._stars = [];
      let seed = 1234567;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 220; k++) {
        this._stars.push([rnd(), rnd(), 0.3 + 0.7 * rnd()]);
      }
    }
    const { ctx, canvas } = this;
    for (const [fx, fy, b] of this._stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.15 * b})`;
      ctx.fillRect(fx * canvas.width, fy * canvas.height, 1, 1);
    }
  }
}
