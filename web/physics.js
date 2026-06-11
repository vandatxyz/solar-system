// physics.js -- Newtonian gravity and the symplectic integrator.
//
// Direct JavaScript port of the Python `physics.py` + `integrator.py`. The law
// of motion is Newton's law of universal gravitation, nothing else:
//
//     a_i = sum_{j != i}  GM_j * (r_j - r_i) / |r_j - r_i|^3
//
// and the trajectory is advanced with velocity-Verlet, a symplectic,
// time-reversible scheme that conserves a shadow energy for all time -- the
// property that keeps orbits (and thus eclipse timing) stable over long runs.
//
// State layout
// ------------
// Positions and velocities are stored as flat Float64Array of length 3N
// (x0,y0,z0, x1,y1,z1, ...). Flat arrays avoid per-step allocation and make
// the force loop cache-friendly, which matters because we run thousands of
// steps per animation frame.

export class NBody {
  /**
   * @param {Float64Array} pos  length 3N, AU
   * @param {Float64Array} vel  length 3N, AU/day
   * @param {number[]|Float64Array} gm  length N, AU^3/day^2
   * @param {number} dt  timestep in days
   */
  constructor(pos, vel, gm, dt) {
    this.n = gm.length;
    this.pos = Float64Array.from(pos);
    this.vel = Float64Array.from(vel);
    this.gm = Float64Array.from(gm);
    this.dt = dt;
    this.time = 0.0;                       // days since the seed epoch
    this.acc = new Float64Array(3 * this.n);
    this._computeAcc();                    // prime the cached acceleration
  }

  // Newtonian acceleration field -> this.acc. O(N^2); N is small (10).
  _computeAcc() {
    const { n, pos, gm, acc } = this;
    acc.fill(0.0);
    for (let i = 0; i < n; i++) {
      const ix = 3 * i, iy = ix + 1, iz = ix + 2;
      const xi = pos[ix], yi = pos[iy], zi = pos[iz];
      let axi = 0.0, ayi = 0.0, azi = 0.0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const jx = 3 * j;
        const dx = pos[jx]     - xi;
        const dy = pos[jx + 1] - yi;
        const dz = pos[jx + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz;
        // GM_j / r^3 along the separation vector.
        const invR3 = gm[j] / (r2 * Math.sqrt(r2));
        axi += dx * invR3;
        ayi += dy * invR3;
        azi += dz * invR3;
      }
      acc[ix] = axi; acc[iy] = ayi; acc[iz] = azi;
    }
  }

  // Advance one timestep in place: half kick -> full drift -> half kick.
  step() {
    const { pos, vel, acc, dt } = this;
    const h = dt, half = 0.5 * dt;
    const m = pos.length;
    // Half kick + full drift using the cached acceleration.
    for (let k = 0; k < m; k++) {
      vel[k] += half * acc[k];
      pos[k] += h * vel[k];
    }
    // Recompute acceleration at the new positions, then the second half kick.
    this._computeAcc();
    for (let k = 0; k < m; k++) {
      vel[k] += half * acc[k];
    }
    this.time += h;
  }

  // Advance n steps; invoke cb(this) after each if provided.
  run(nSteps, cb) {
    for (let s = 0; s < nSteps; s++) {
      this.step();
      if (cb) cb(this);
    }
  }

  // --- conserved quantities, for the live diagnostics readout -------------

  // Total mechanical energy divided by G (units where "mass" is GM).
  energy() {
    const { n, pos, vel, gm } = this;
    let kinetic = 0.0;
    for (let i = 0; i < n; i++) {
      const k = 3 * i;
      const v2 = vel[k] * vel[k] + vel[k + 1] * vel[k + 1] + vel[k + 2] * vel[k + 2];
      kinetic += 0.5 * gm[i] * v2;
    }
    let potential = 0.0;
    for (let i = 0; i < n; i++) {
      const ix = 3 * i;
      for (let j = i + 1; j < n; j++) {
        const jx = 3 * j;
        const dx = pos[ix]     - pos[jx];
        const dy = pos[ix + 1] - pos[jx + 1];
        const dz = pos[ix + 2] - pos[jx + 2];
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        potential -= gm[i] * gm[j] / r;
      }
    }
    return kinetic + potential;
  }

  // Total angular momentum divided by G, as [Lx, Ly, Lz].
  angularMomentum() {
    const { n, pos, vel, gm } = this;
    let lx = 0.0, ly = 0.0, lz = 0.0;
    for (let i = 0; i < n; i++) {
      const k = 3 * i;
      const x = pos[k],   y = pos[k + 1],   z = pos[k + 2];
      const vx = vel[k],  vy = vel[k + 1],  vz = vel[k + 2];
      lx += gm[i] * (y * vz - z * vy);
      ly += gm[i] * (z * vx - x * vz);
      lz += gm[i] * (x * vy - y * vx);
    }
    return [lx, ly, lz];
  }
}

// Shift to the GM-weighted centre-of-mass frame and null the net momentum, so
// the whole system doesn't drift across the view. Mutates pos/vel in place.
export function removeBarycentreDrift(pos, vel, gm) {
  const n = gm.length;
  let totalGm = 0.0;
  const com = [0, 0, 0], vcom = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    totalGm += gm[i];
    const k = 3 * i;
    for (let d = 0; d < 3; d++) {
      com[d]  += gm[i] * pos[k + d];
      vcom[d] += gm[i] * vel[k + d];
    }
  }
  for (let d = 0; d < 3; d++) { com[d] /= totalGm; vcom[d] /= totalGm; }
  for (let i = 0; i < n; i++) {
    const k = 3 * i;
    for (let d = 0; d < 3; d++) {
      pos[k + d] -= com[d];
      vel[k + d] -= vcom[d];
    }
  }
}
