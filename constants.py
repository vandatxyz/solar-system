"""Physical constants and body metadata for the solar-system simulation.

Unit system
-----------
We work in heliocentric/barycentric units that keep the numbers well-scaled
and the integrator well-conditioned:

    length : astronomical unit            (AU)
    time   : day                          (d)   = 86400 s
    mass   : encoded via the gravitational parameter GM, in AU^3 / d^2

Using the gravitational parameter ``GM`` directly (rather than G and M
separately) is standard in celestial mechanics: GM is known to far higher
precision than either G or a body's mass alone, and the equations of motion
only ever need the product.
"""

from __future__ import annotations

from dataclasses import dataclass

# --- Unit conversion ------------------------------------------------------

KM_PER_AU = 149_597_870.7          # IAU 2012 definition of the AU, in km
SEC_PER_DAY = 86_400.0

# Convert a gravitational parameter from km^3/s^2 to AU^3/day^2.
#   (km^3/s^2) * (AU/km)^3 * (s/day)^2
_GM_KM3_S2_TO_AU3_D2 = (1.0 / KM_PER_AU) ** 3 * SEC_PER_DAY ** 2


def gm_km3s2_to_au3d2(gm_km3s2: float) -> float:
    """Convert GM from km^3/s^2 (the form JPL publishes) to AU^3/day^2."""
    return gm_km3s2 * _GM_KM3_S2_TO_AU3_D2


# --- Reference epoch ------------------------------------------------------

# J2000.0 = 2000-01-01 12:00:00 TDB.  This is the epoch at which we seed the
# integration with state vectors from JPL Horizons.
J2000_JD = 2_451_545.0


@dataclass(frozen=True)
class Body:
    """Static description of a celestial body.

    Attributes
    ----------
    name:        human-readable name
    horizons_id: JPL Horizons COMMAND code used to fetch its state vector
    gm:          gravitational parameter GM, in AU^3/day^2
    radius_km:   mean physical radius, in km (used for eclipse geometry)
    """

    name: str
    horizons_id: str
    gm: float
    radius_km: float


# Gravitational parameters GM in km^3/s^2, from JPL DE-series / IAU values.
# These are body-center values (the planet itself, not the planet+satellite
# barycenter), which is consistent with treating the Moon as its own body.
_GM_KM3_S2 = {
    "Sun":     1.32712440018e11,
    "Mercury": 2.2031868551e4,
    "Venus":   3.24858592000e5,
    "Earth":   3.98600435507e5,
    "Moon":    4.90028001184e3,
    "Mars":    4.282837362e4,
    "Jupiter": 1.26686531900e8,
    "Saturn":  3.79311879180e7,
    "Uranus":  5.793951256e6,
    "Neptune": 6.835099502e6,
}

# Mean radii in km (IAU 2015).
_RADIUS_KM = {
    "Sun":     696_000.0,
    "Mercury": 2_439.7,
    "Venus":   6_051.8,
    "Earth":   6_371.0084,
    "Moon":    1_737.4,
    "Mars":    3_389.5,
    "Jupiter": 69_911.0,
    "Saturn":  58_232.0,
    "Uranus":  25_362.0,
    "Neptune": 24_622.0,
}

# JPL Horizons COMMAND codes.  We use individual body centers so the modelled
# GM (body-only) matches the fetched position.
_HORIZONS_ID = {
    "Sun":     "10",
    "Mercury": "199",
    "Venus":   "299",
    "Earth":   "399",
    "Moon":    "301",
    "Mars":    "499",
    "Jupiter": "599",
    "Saturn":  "699",
    "Uranus":  "799",
    "Neptune": "899",
}

# Canonical ordering used everywhere (state-vector rows follow this order).
BODY_NAMES = [
    "Sun", "Mercury", "Venus", "Earth", "Moon",
    "Mars", "Jupiter", "Saturn", "Uranus", "Neptune",
]

BODIES: dict[str, Body] = {
    name: Body(
        name=name,
        horizons_id=_HORIZONS_ID[name],
        gm=gm_km3s2_to_au3d2(_GM_KM3_S2[name]),
        radius_km=_RADIUS_KM[name],
    )
    for name in BODY_NAMES
}

# Convenience: indices into the state arrays.
INDEX = {name: i for i, name in enumerate(BODY_NAMES)}
