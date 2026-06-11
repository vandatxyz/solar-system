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
      if (b.name === "Sun") return 10;
      if (["Jupiter", "Saturn", "Uranus", "Neptune"].includes(b.name)) return 5;
      if (b.name === "Moon") return 2;
      return 3.2;
    });

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
      const [cx, cy] = this._toCamera(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      const [sx, sy] = this._toScreen(cx, cy);
      const cam = this._toCamera(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      items.push({ i, sx, sy, depth: cam[2] });
      this.screen[i] = { x: sx, y: sy, r: this.drawRadius[i] };
    }

    if (this.showTrails) this._drawTrails();

    // Far bodies first.
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) this._drawBody(it.i, it.sx, it.sy);
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

  _drawBody(i, sx, sy) {
    const { ctx } = this;
    const b = this.bodies[i];
    const r = this.drawRadius[i];

    if (b.name === "Sun") {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.4);
      g.addColorStop(0, "#fff4c2");
      g.addColorStop(0.5, b.color);
      g.addColorStop(1, "#ffcc3300");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 2.4, 0, 2 * Math.PI);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, 2 * Math.PI);
    ctx.fillStyle = b.color;
    ctx.fill();

    if (this.focusIndex === i) {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 5, 0, 2 * Math.PI);
      ctx.strokeStyle = "#ffffffaa";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (this.showLabels) {
      ctx.fillStyle = "#cfd6e4";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(b.name, sx + r + 3, sy - r - 2);
    }
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
