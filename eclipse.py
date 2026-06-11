"""Solar-eclipse prediction from simulated body positions.

A solar eclipse happens when the Moon passes between the Earth and the Sun and
its shadow falls on the Earth.  Everything we need follows from three position
vectors -- Sun, Earth, Moon -- which the N-body integration already produces
from first principles.  No eclipse-specific physics is hard-coded; we just read
off the geometry.

Geometry
--------
Work in the Earth-centred frame.  Let

    S = r_sun  - r_earth      (Earth -> Sun)
    M = r_moon - r_earth      (Earth -> Moon)

The **angular separation** between the centres of the Sun and Moon as seen from
Earth's centre is the angle between S and M.  A new moon is the moment this
separation reaches a local minimum; an eclipse is a new moon that happens close
enough to a node that the disks actually overlap.

The Sun and Moon subtend angular radii (seen from Earth's centre)

    alpha_sun  = asin(R_sun  / |S|)
    alpha_moon = asin(R_moon / |M|)

The disks overlap for a central observer when separation < alpha_sun +
alpha_moon.  But the Moon is near enough that observers elsewhere on Earth see
it shifted by up to Earth's angular radius seen from the Moon,

    alpha_par = asin(R_earth / |M|)        (~0.95 deg, the lunar parallax)

so an eclipse is visible *somewhere* on Earth when

    separation < alpha_sun + alpha_moon + alpha_par.

Total vs. annular
-----------------
At greatest eclipse compare the apparent sizes seen from the sub-lunar point on
Earth's surface (distance |M| - R_earth):

    total    if the Moon's disk fully covers the Sun's  (alpha_moon' > alpha_sun')
    annular  otherwise (a ring of Sun remains)

If the disks only overlap once parallax is taken into account, the eclipse is
merely partial.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from constants import INDEX, BODIES, J2000_JD


# Physical radii needed for the shadow geometry, in AU.
from constants import KM_PER_AU

_R_SUN = BODIES["Sun"].radius_km / KM_PER_AU
_R_MOON = BODIES["Moon"].radius_km / KM_PER_AU
_R_EARTH = BODIES["Earth"].radius_km / KM_PER_AU


@dataclass
class EclipseEvent:
    """A predicted solar eclipse."""

    jd: float                 # Julian Date (TDB) of greatest eclipse
    calendar: str             # human-readable UTC-ish calendar string
    kind: str                 # "total", "annular", or "partial"
    separation_deg: float     # Sun-Moon angular separation at greatest eclipse
    magnitude: float          # fraction of Sun's diameter covered (central)

    def __str__(self) -> str:
        return (f"{self.calendar}  JD {self.jd:.3f}  {self.kind:<7s}  "
                f"sep={self.separation_deg:.4f} deg  mag={self.magnitude:.3f}")


def _angular_separation(s: np.ndarray, m: np.ndarray) -> float:
    """Angle (radians) between the Earth->Sun and Earth->Moon vectors."""
    cos = np.dot(s, m) / (np.linalg.norm(s) * np.linalg.norm(m))
    return float(np.arccos(np.clip(cos, -1.0, 1.0)))


def _jd_to_calendar(jd: float) -> str:
    """Convert a Julian Date to a 'YYYY-MM-DD HH:MM' string (proleptic Gregorian)."""
    # Fliegel & Van Flandern algorithm, then split off the fractional day.
    jd_adj = jd + 0.5
    z = int(np.floor(jd_adj))
    frac = jd_adj - z
    if z < 2_299_161:                     # before 1582-10-15: Julian calendar
        a = z
    else:
        alpha = int((z - 1_867_216.25) / 36_524.25)
        a = z + 1 + alpha - alpha // 4
    b = a + 1524
    c = int((b - 122.1) / 365.25)
    d = int(365.25 * c)
    e = int((b - d) / 30.6001)
    day = b - d - int(30.6001 * e)
    month = e - 1 if e < 14 else e - 13
    year = c - 4716 if month > 2 else c - 4715
    hours = frac * 24.0
    hh = int(hours)
    mm = int(round((hours - hh) * 60.0))
    if mm == 60:
        mm = 0
        hh += 1
    return f"{year:04d}-{month:02d}-{day:02d} {hh:02d}:{mm:02d}"


def _classify(s: np.ndarray, m: np.ndarray, separation: float) -> tuple[str, float]:
    """Return (kind, magnitude) for a conjunction at angular ``separation``.

    ``s``, ``m`` are the Earth->Sun and Earth->Moon vectors (AU).
    """
    dist_sun = np.linalg.norm(s)
    dist_moon = np.linalg.norm(m)

    alpha_sun = np.arcsin(_R_SUN / dist_sun)
    alpha_moon = np.arcsin(_R_MOON / dist_moon)
    alpha_par = np.arcsin(_R_EARTH / dist_moon)

    # Visible somewhere on Earth?
    if separation > alpha_sun + alpha_moon + alpha_par:
        return ("none", 0.0)

    # Apparent radii from the sub-lunar surface point (closest observer).
    alpha_sun_surf = np.arcsin(_R_SUN / (dist_sun - _R_EARTH))
    alpha_moon_surf = np.arcsin(_R_MOON / (dist_moon - _R_EARTH))

    # Could the axis of the shadow cone actually reach the surface? Require the
    # central separation to be within parallax reach of a perfect alignment.
    central_overlap = separation < alpha_sun + alpha_moon

    if central_overlap and alpha_moon_surf >= alpha_sun_surf:
        kind = "total"
    elif central_overlap:
        kind = "annular"
    else:
        kind = "partial"

    # Eclipse magnitude: fraction of the Sun's *diameter* obscured for the best
    # placed observer, clamped to [0, 1+].
    reach = alpha_sun_surf + alpha_moon_surf
    sep_surf = max(separation - alpha_par, 0.0)
    magnitude = (alpha_sun_surf + alpha_moon_surf - sep_surf) / (2.0 * alpha_sun_surf)
    magnitude = float(np.clip(magnitude, 0.0, 2.0))
    return (kind, magnitude)


class EclipseFinder:
    """Accumulates Sun/Earth/Moon geometry during a run and extracts eclipses.

    Use as the integrator callback.  After the run, :meth:`events` returns the
    list of detected solar eclipses.

    Detection works by tracking the Sun-Moon angular separation each step and
    locating its local minima (conjunctions in apparent longitude == new moons).
    A parabola through the three samples around each minimum refines the time
    and separation to sub-step accuracy.
    """

    def __init__(self, jd0: float = J2000_JD):
        self.jd0 = jd0
        self._i_sun = INDEX["Sun"]
        self._i_earth = INDEX["Earth"]
        self._i_moon = INDEX["Moon"]

        # Ring buffer of the last three (time, separation, S, M) samples.
        self._hist: list[tuple[float, float, np.ndarray, np.ndarray]] = []
        self._events: list[EclipseEvent] = []

    def __call__(self, integ, i: int) -> None:
        pos = integ.pos
        s = pos[self._i_sun] - pos[self._i_earth]
        m = pos[self._i_moon] - pos[self._i_earth]
        sep = _angular_separation(s, m)
        self._hist.append((integ.time, sep, s.copy(), m.copy()))
        if len(self._hist) > 3:
            self._hist.pop(0)
        if len(self._hist) == 3:
            self._check_minimum()

    def _check_minimum(self) -> None:
        (t0, f0, _, _), (t1, f1, s1, m1), (t2, f2, _, _) = self._hist
        # Local minimum of the separation at the middle sample?
        if not (f1 < f0 and f1 < f2):
            return

        # Parabolic refinement of the minimum (uniform spacing assumed).
        denom = (f0 - 2.0 * f1 + f2)
        if denom <= 0:
            return
        # Offset of the vertex from the middle sample, in units of the step.
        delta = 0.5 * (f0 - f2) / denom
        sep_min = f1 - 0.25 * (f0 - f2) * delta
        sep_min = max(sep_min, 0.0)

        kind, magnitude = _classify(s1, m1, sep_min)
        if kind == "none":
            return

        h = t1 - t0                       # step length in days
        t_min = t1 + delta * h
        jd = self.jd0 + t_min
        self._events.append(EclipseEvent(
            jd=jd,
            calendar=_jd_to_calendar(jd),
            kind=kind,
            separation_deg=np.degrees(sep_min),
            magnitude=magnitude,
        ))

    def events(self) -> list[EclipseEvent]:
        """Detected solar eclipses, in chronological order."""
        return list(self._events)
