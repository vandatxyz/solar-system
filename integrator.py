"""Symplectic time integration of the N-body equations of motion.

Why velocity Verlet?
--------------------
The equations of motion form a Hamiltonian system, and over the long
integration spans needed to predict eclipses (years to centuries) the choice
of integrator matters more than its local truncation error.  A naive
high-order method like RK4 is *not* symplectic: it slowly drifts the system's
energy, so orbits spiral in or out and phase errors accumulate without bound.

Velocity Verlet (a.k.a. the leapfrog / kick-drift-kick scheme) is symplectic
and time-reversible.  It conserves a "shadow" energy to second order for all
time, so orbital shapes stay stable and the long-term phase error grows only
linearly.  That is exactly the property we need for eclipse prediction.

One full step (timestep h):

    v_{1/2} = v_0     + (h/2) a(r_0)        # half "kick"
    r_1     = r_0     + h     v_{1/2}        # full "drift"
    v_1     = v_{1/2} + (h/2) a(r_1)         # half "kick"

The acceleration is evaluated from first principles in :mod:`physics`.
"""

from __future__ import annotations

from typing import Callable

import numpy as np

from physics import accelerations


class VerletIntegrator:
    """Velocity-Verlet integrator for a fixed set of gravitating bodies.

    The accelerations only depend on positions, so we cache the acceleration
    at the end of each step and reuse it as the opening "kick" of the next --
    one force evaluation per step.
    """

    def __init__(self, positions: np.ndarray, velocities: np.ndarray,
                 gm: np.ndarray, dt: float):
        self.pos = np.array(positions, dtype=float)
        self.vel = np.array(velocities, dtype=float)
        self.gm = np.array(gm, dtype=float)
        self.dt = float(dt)
        self.time = 0.0                       # days since the seed epoch
        self._acc = accelerations(self.pos, self.gm)

    def step(self) -> None:
        """Advance the system by one timestep ``dt`` in place."""
        h = self.dt
        # Half kick using the cached acceleration.
        self.vel += 0.5 * h * self._acc
        # Full drift.
        self.pos += h * self.vel
        # Recompute acceleration at the new positions, then second half kick.
        self._acc = accelerations(self.pos, self.gm)
        self.vel += 0.5 * h * self._acc
        self.time += h

    def run(self, n_steps: int,
            callback: Callable[["VerletIntegrator", int], None] | None = None
            ) -> None:
        """Advance ``n_steps`` steps, invoking ``callback(self, i)`` each step."""
        for i in range(n_steps):
            self.step()
            if callback is not None:
                callback(self, i)
