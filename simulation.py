"""High-level driver: seed the system, integrate, and report diagnostics.

This module wires together the pieces that each handle one idea:

    horizons   -> accurate initial conditions at J2000.0
    physics    -> Newtonian gravity (the law of motion)
    integrator -> symplectic time stepping (solving that law)
    eclipse    -> reading eclipse geometry off the trajectory

It also recentres the system on its barycentre and removes any net drift, and
it reports conserved quantities (energy, angular momentum) as a check that the
integration is faithful to the physics.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from constants import BODY_NAMES, BODIES, J2000_JD
from physics import accelerations, total_energy, angular_momentum
from integrator import VerletIntegrator
from eclipse import EclipseFinder, EclipseEvent
from horizons import load_state


def _gm_vector() -> np.ndarray:
    return np.array([BODIES[name].gm for name in BODY_NAMES])


def _remove_barycentre_drift(pos: np.ndarray, vel: np.ndarray,
                             gm: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Shift to the centre-of-mass frame and null the total momentum.

    GM-weighted centroid stands in for the mass-weighted one (the G cancels).
    Doing this keeps the whole system from translating across space and makes
    the angular-momentum check cleaner.
    """
    total_gm = np.sum(gm)
    com = np.sum(gm[:, None] * pos, axis=0) / total_gm
    vcom = np.sum(gm[:, None] * vel, axis=0) / total_gm
    return pos - com, vel - vcom


@dataclass
class SimulationResult:
    eclipses: list[EclipseEvent]
    energy_drift: float          # |E_final - E_0| / |E_0|
    ang_mom_drift: float         # |L_final - L_0| / |L_0|
    days: float
    dt: float
    n_steps: int


class SolarSystem:
    """A simulated solar system seeded from real ephemeris data."""

    def __init__(self, use_cache: bool = True):
        pos, vel = load_state(use_cache=use_cache)
        self.gm = _gm_vector()
        self.pos0, self.vel0 = _remove_barycentre_drift(pos, vel, self.gm)

    def run(self, days: float, dt: float = 0.1,
            find_eclipses: bool = True) -> SimulationResult:
        """Integrate forward ``days`` days with timestep ``dt`` (days).

        The timestep is set by the fastest-moving body we care about: the
        Moon, whose 27.3-day orbit must stay in phase over many revolutions
        for eclipse timing to hold up.  At dt = 0.1 day that orbit gets ~270
        steps per revolution; velocity-Verlet's phase error then stays small
        enough that predicted eclipses land within hours of reality even a
        decade out.  (A coarser dt = 0.5 day drifts the Moon ~2 days -- and
        thus ~2 deg -- out of position after a couple of years, enough to miss
        a central eclipse entirely.)
        """
        n_steps = int(round(days / dt))
        integ = VerletIntegrator(self.pos0, self.vel0, self.gm, dt)

        e0 = total_energy(integ.pos, integ.vel, self.gm)
        l0 = angular_momentum(integ.pos, integ.vel, self.gm)

        finder = EclipseFinder(jd0=J2000_JD) if find_eclipses else None
        # Seed the finder with the initial state too.
        if finder is not None:
            finder(integ, -1)
        integ.run(n_steps, callback=finder)

        e1 = total_energy(integ.pos, integ.vel, self.gm)
        l1 = angular_momentum(integ.pos, integ.vel, self.gm)

        energy_drift = abs(e1 - e0) / abs(e0)
        ang_mom_drift = float(np.linalg.norm(l1 - l0) / np.linalg.norm(l0))

        return SimulationResult(
            eclipses=finder.events() if finder is not None else [],
            energy_drift=energy_drift,
            ang_mom_drift=ang_mom_drift,
            days=days,
            dt=dt,
            n_steps=n_steps,
        )
