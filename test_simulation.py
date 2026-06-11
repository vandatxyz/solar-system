"""Tests: the physics must conserve what it should, and the eclipse predictor
must reproduce eclipses that actually happened.

Run with:  python -m pytest test_simulation.py -v
       or:  python test_simulation.py        (falls back to a plain runner)
"""

from __future__ import annotations

import math

import numpy as np

from constants import BODIES, BODY_NAMES, INDEX, J2000_JD
from physics import accelerations, total_energy, angular_momentum
from integrator import VerletIntegrator


# --- Physics: Newton's law itself ----------------------------------------

def test_two_body_acceleration_matches_newton():
    """A hand calculation of g = GM/r^2 for the Sun pulling on the Earth."""
    gm_sun = BODIES["Sun"].gm
    # Earth one AU along +x from the Sun; ignore the Earth's pull on the Sun
    # by giving the Earth zero GM here.
    pos = np.array([[0.0, 0.0, 0.0],     # Sun
                    [1.0, 0.0, 0.0]])    # test body at 1 AU
    gm = np.array([gm_sun, 0.0])
    acc = accelerations(pos, gm)
    # Test body should accelerate toward the Sun (-x) with magnitude GM/r^2.
    assert acc[1, 0] == -gm_sun                # r = 1 AU
    assert abs(acc[1, 1]) < 1e-15
    assert abs(acc[1, 2]) < 1e-15
    # Newton's third law: massless test body exerts no force on the Sun.
    assert np.allclose(acc[0], 0.0)


def test_newtons_third_law_momentum():
    """With both bodies massive, total momentum change is zero each step."""
    gm = np.array([1e-4, 2e-4])
    pos = np.array([[0.0, 0.0, 0.0], [3.0, 0.0, 0.0]])
    acc = accelerations(pos, gm)
    # GM-weighted accelerations must sum to zero (internal forces cancel).
    net = gm[0] * acc[0] + gm[1] * acc[1]
    assert np.allclose(net, 0.0, atol=1e-18)


# --- Two-body Kepler problem: a known closed-form answer ------------------

def test_circular_orbit_period():
    """A test mass on a circular orbit returns to its start after one period.

    For a circular orbit of radius r about a central GM, the speed is
    v = sqrt(GM/r) and the period is T = 2*pi*sqrt(r^3 / GM).  Integrating one
    period should bring the body back to (r, 0) to good accuracy, and the
    energy must barely drift -- the headline property of a symplectic method.
    """
    gm_central = 4.0 * math.pi**2 * 1e-6      # arbitrary but well-scaled
    r = 1.0
    v = math.sqrt(gm_central / r)
    period = 2.0 * math.pi * math.sqrt(r**3 / gm_central)

    pos = np.array([[0.0, 0.0, 0.0], [r, 0.0, 0.0]])
    vel = np.array([[0.0, 0.0, 0.0], [0.0, v, 0.0]])
    gm = np.array([gm_central, 0.0])

    # Specific orbital energy of the test particle, v^2/2 - GM/r, is the
    # quantity conserved in a restricted two-body problem.  (The framework's
    # GM-weighted total_energy is identically zero for a massless test body,
    # so we compute the specific energy directly here.)
    def specific_energy(p, vv):
        rr = np.linalg.norm(p[1] - p[0])
        speed2 = float(np.dot(vv[1], vv[1]))
        return 0.5 * speed2 - gm_central / rr

    dt = period / 5000.0
    integ = VerletIntegrator(pos, vel, gm, dt)
    e0 = specific_energy(integ.pos, integ.vel)
    integ.run(5000)
    e1 = specific_energy(integ.pos, integ.vel)

    # Back to the starting point?
    assert np.allclose(integ.pos[1], [r, 0.0, 0.0], atol=2e-3)
    # Energy conserved to a tight tolerance.
    assert abs(e1 - e0) / abs(e0) < 1e-6


# --- The full system conserves energy and angular momentum ----------------

def _load_or_skip():
    """Load real initial conditions, or skip if neither cache nor net exists."""
    try:
        from horizons import load_state
        return load_state(use_cache=True)
    except Exception as exc:                    # noqa: BLE001
        import pytest
        pytest.skip(f"no initial conditions available: {exc}")


def test_full_system_conserves_energy_and_momentum():
    from simulation import SolarSystem
    try:
        system = SolarSystem(use_cache=True)
    except Exception as exc:                    # noqa: BLE001
        import pytest
        pytest.skip(f"no initial conditions available: {exc}")

    result = system.run(days=365.25, dt=0.5, find_eclipses=False)
    # A symplectic integrator over a year should keep both drifts very small.
    assert result.energy_drift < 1e-6
    assert result.ang_mom_drift < 1e-9


# --- Eclipse prediction against reality -----------------------------------

# Real total/annular solar eclipses with the UTC instant of *greatest eclipse*
# (not calendar midnight -- an eclipse peaks at a specific hour, and comparing
# against midnight would introduce a spurious offset of up to a full day).
# Sources: NASA/Fred Espenak eclipse catalogue.
#   (year, month, day, hour, minute, kind-hint)
KNOWN_ECLIPSES = [
    (2001, 6, 21, 12, 4, "total"),
    (2002, 12, 4, 7, 31, "total"),
    (2003, 11, 23, 22, 49, "total"),
    (2005, 10, 3, 10, 32, "annular"),
    (2006, 3, 29, 10, 11, "total"),
    (2008, 8, 1, 10, 22, "total"),
    (2009, 7, 22, 2, 36, "total"),
]

# Tolerance for matching a predicted eclipse to the real instant.  A pure
# point-mass Newtonian model seeded at J2000 accumulates lunar phase error of
# order an hour per year (no solar radiation pressure, no figure-of-the-Moon
# torques, no relativity), so by ~2009 the drift is ~14 h.  One day of margin
# keeps the check meaningful while tolerating that physical limitation.
_ECLIPSE_TOL_DAYS = 1.0


def _calendar_to_jd(y: int, m: int, d: int, h: int = 0, mi: int = 0) -> float:
    """Gregorian date + UTC time to Julian Date (good for modern dates)."""
    a = (14 - m) // 12
    yy = y + 4800 - a
    mm = m + 12 * a - 3
    jdn = (d + (153 * mm + 2) // 5 + 365 * yy + yy // 4
           - yy // 100 + yy // 400 - 32045)
    return jdn - 0.5 + (h + mi / 60.0) / 24.0   # JDN is noon; add UTC fraction


def test_known_eclipses_are_predicted():
    from simulation import SolarSystem
    try:
        system = SolarSystem(use_cache=True)
    except Exception as exc:                    # noqa: BLE001
        import pytest
        pytest.skip(f"no initial conditions available: {exc}")

    # Cover the span of the known list (J2000 -> end of 2009).  dt=0.1 keeps
    # the Moon in phase over the full decade (see SolarSystem.run).
    result = system.run(days=10.0 * 365.25, dt=0.1)
    predicted_jds = [e.jd for e in result.eclipses]
    assert predicted_jds, "no eclipses predicted at all"

    for (y, m, d, h, mi, _kind) in KNOWN_ECLIPSES:
        target = _calendar_to_jd(y, m, d, h, mi)
        nearest = min(predicted_jds, key=lambda jd: abs(jd - target))
        off_h = abs(nearest - target) * 24.0
        assert abs(nearest - target) < _ECLIPSE_TOL_DAYS, (
            f"no predicted eclipse near {y}-{m:02d}-{d:02d} {h:02d}:{mi:02d}Z "
            f"(closest is JD {nearest:.3f}, off by {off_h:.1f} h)"
        )


if __name__ == "__main__":
    # Minimal runner so the file works without pytest installed.
    import traceback

    tests = [obj for name, obj in sorted(globals().items())
             if name.startswith("test_") and callable(obj)]
    passed = failed = skipped = 0
    for t in tests:
        try:
            t()
        except Exception as exc:                # noqa: BLE001
            msg = str(exc).lower()
            if "skip" in type(exc).__name__.lower() or "skip" in msg:
                print(f"SKIP {t.__name__}: {exc}")
                skipped += 1
            else:
                print(f"FAIL {t.__name__}: {exc}")
                traceback.print_exc()
                failed += 1
        else:
            print(f"PASS {t.__name__}")
            passed += 1
    print(f"\n{passed} passed, {failed} failed, {skipped} skipped")
    raise SystemExit(1 if failed else 0)
