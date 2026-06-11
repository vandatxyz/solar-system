"""Fetch initial state vectors from JPL Horizons.

The simulation needs a starting position and velocity for every body at the
seed epoch (J2000.0).  Rather than hard-code possibly-stale numbers, we query
NASA JPL's Horizons system over HTTP and cache the result on disk so the
network is only hit once.

We deliberately use only the Python standard library (``urllib``) so the
fetch has no third-party dependencies.  The returned vectors are expressed in
the J2000 ecliptic frame, centered on the Solar System barycenter (SSB), in
units of AU and AU/day -- exactly the unit system used by the integrator.

If the network is unavailable, :func:`load_state` falls back to a bundled
snapshot (``j2000_state.json``) if present, and otherwise raises.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

import numpy as np

from constants import BODY_NAMES, BODIES, J2000_JD

_HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"
_CACHE_FILE = os.path.join(os.path.dirname(__file__), "j2000_state.json")


def _build_query(command: str) -> str:
    """Build a Horizons API URL requesting a state vector for ``command``.

    We ask for:
      * VECTORS ephemeris (Cartesian position + velocity)
      * center '@0'  -> Solar System barycenter
      * J2000 ecliptic reference frame
      * a single epoch at J2000.0 TDB
      * output units AU and AU/day
    """
    params = {
        "format": "text",
        "COMMAND": f"'{command}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'VECTORS'",
        "CENTER": "'@0'",            # Solar System barycenter
        "REF_PLANE": "'ECLIPTIC'",
        "REF_SYSTEM": "'J2000'",
        "VEC_TABLE": "'2'",          # state vector: position + velocity
        "OUT_UNITS": "'AU-D'",       # AU and AU/day
        "TLIST": f"'{J2000_JD}'",    # single epoch, Julian Date (TDB)
        "CSV_FORMAT": "'YES'",
    }
    return _HORIZONS_API + "?" + urllib.parse.urlencode(params)


# Horizons brackets the actual vector data between $$SOE and $$EOE markers.
_SOE = "$$SOE"
_EOE = "$$EOE"


def _parse_vectors(text: str) -> tuple[np.ndarray, np.ndarray]:
    """Extract (position, velocity) in AU and AU/day from a Horizons reply.

    The CSV vector line looks like:
        JDTDB, Calendar Date, X, Y, Z, VX, VY, VZ,
    """
    try:
        body = text.split(_SOE, 1)[1].split(_EOE, 1)[0]
    except IndexError as exc:  # markers missing -> error reply
        raise RuntimeError(
            "Unexpected Horizons reply (no $$SOE/$$EOE markers):\n"
            + text[:500]
        ) from exc

    line = next(l for l in body.splitlines() if l.strip())
    fields = [f.strip() for f in line.split(",")]
    # fields[0]=JDTDB, [1]=date, [2:5]=XYZ, [5:8]=VXVYVZ
    x, y, z = (float(fields[i]) for i in (2, 3, 4))
    vx, vy, vz = (float(fields[i]) for i in (5, 6, 7))
    return np.array([x, y, z]), np.array([vx, vy, vz])


def _fetch_body(command: str) -> tuple[np.ndarray, np.ndarray]:
    url = _build_query(command)
    with urllib.request.urlopen(url, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    return _parse_vectors(text)


def fetch_from_horizons() -> dict[str, dict[str, list[float]]]:
    """Query Horizons for every body and return a JSON-serialisable dict."""
    state: dict[str, dict[str, list[float]]] = {}
    for name in BODY_NAMES:
        pos, vel = _fetch_body(BODIES[name].horizons_id)
        state[name] = {"pos": pos.tolist(), "vel": vel.tolist()}
    return state


def load_state(use_cache: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """Return (positions, velocities) arrays of shape (N, 3) at J2000.0.

    Rows follow :data:`constants.BODY_NAMES`.  Results are cached to
    ``j2000_state.json``; pass ``use_cache=False`` to force a fresh fetch.
    """
    state: dict | None = None

    if use_cache and os.path.exists(_CACHE_FILE):
        with open(_CACHE_FILE, "r", encoding="utf-8") as fh:
            state = json.load(fh)

    if state is None:
        state = fetch_from_horizons()
        with open(_CACHE_FILE, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2)

    n = len(BODY_NAMES)
    positions = np.zeros((n, 3))
    velocities = np.zeros((n, 3))
    for i, name in enumerate(BODY_NAMES):
        positions[i] = state[name]["pos"]
        velocities[i] = state[name]["vel"]
    return positions, velocities
