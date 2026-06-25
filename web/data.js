// data.js -- physical constants, body metadata, and the J2000.0 seed state.
//
// This is the JavaScript twin of the Python `constants.py` + `j2000_state.json`.
// Same unit system as the Python simulation:
//
//     length : astronomical unit (AU)
//     time   : day (d) = 86400 s
//     mass   : carried as the gravitational parameter GM, in AU^3 / day^2
//
// Using GM directly (not G and M separately) is standard celestial mechanics:
// GM is known far more precisely than either factor, and the equations of
// motion only ever need the product.

// --- Unit conversion ------------------------------------------------------

export const KM_PER_AU = 149_597_870.7;     // IAU 2012 definition, km
const SEC_PER_DAY = 86_400.0;

// (km^3/s^2) -> (AU^3/day^2)
const GM_KM3S2_TO_AU3D2 = Math.pow(1.0 / KM_PER_AU, 3) * SEC_PER_DAY * SEC_PER_DAY;

// J2000.0 = 2000-01-01 12:00:00 TDB, the epoch the seed state belongs to.
export const J2000_JD = 2_451_545.0;

// Gravitational parameters GM in km^3/s^2 (JPL DE-series / IAU values),
// body-center values consistent with treating the Moon as its own body.
const GM_KM3S2 = {
  Sun:     1.32712440018e11,
  Mercury: 2.2031868551e4,
  Venus:   3.24858592000e5,
  Earth:   3.98600435507e5,
  Moon:    4.90028001184e3,
  Mars:    4.282837362e4,
  Jupiter: 1.26686531900e8,
  Saturn:  3.79311879180e7,
  Uranus:  5.793951256e6,
  Neptune: 6.835099502e6,
};

// Mean radii in km (IAU 2015).
export const RADIUS_KM = {
  Sun:     696_000.0,
  Mercury: 2_439.7,
  Venus:   6_051.8,
  Earth:   6_371.0084,
  Moon:    1_737.4,
  Mars:    3_389.5,
  Jupiter: 69_911.0,
  Saturn:  58_232.0,
  Uranus:  25_362.0,
  Neptune: 24_622.0,
};

export const COLOR = {
  Sun:     "#ffcc33",
  Mercury: "#b9b6ad",
  Venus:   "#e8c98a",
  Earth:   "#4f8fe0",
  Moon:    "#cfcfcf",
  Mars:    "#d9603b",
  Jupiter: "#d8a86b",
  Saturn:  "#e3d29a",
  Uranus:  "#9fd8e0",
  Neptune: "#6f8fe0",
};

export const MASS_KG = {
  Sun: 1.989e30, Mercury: 3.301e23, Venus: 4.867e24, Earth: 5.972e24,
  Moon: 7.342e22, Mars: 6.417e23, Jupiter: 1.898e27, Saturn: 5.683e26,
  Uranus: 8.681e25, Neptune: 1.024e26,
};

// Canonical ordering -- state arrays follow this order everywhere.
export const BODY_NAMES = [
  "Sun", "Mercury", "Venus", "Earth", "Moon",
  "Mars", "Jupiter", "Saturn", "Uranus", "Neptune",
];

export const INDEX = Object.fromEntries(BODY_NAMES.map((n, i) => [n, i]));

// Per-body static metadata, in simulation units.
export const BODIES = BODY_NAMES.map((name) => ({
  name,
  gm: GM_KM3S2[name] * GM_KM3S2_TO_AU3D2,   // AU^3 / day^2
  radiusKm: RADIUS_KM[name],
  radiusAu: RADIUS_KM[name] / KM_PER_AU,
  color: COLOR[name],
}));

// GM vector in canonical order (handy for the integrator).
export const GM = BODIES.map((b) => b.gm);

// --- J2000.0 seed state ---------------------------------------------------
//
// Position (AU) and velocity (AU/day) in the J2000 ecliptic frame, centred on
// the Solar System barycentre. Identical to the cached `j2000_state.json`
// fetched from JPL Horizons by the Python version.

export const J2000_STATE = {
  Sun:     { pos: [-0.007137179161607904, -0.002795997495567612,  0.0002062985061910257],
             vel: [ 5.378460339618783e-06, -7.406916207973516e-06, -9.43429343213747e-08] },
  Mercury: { pos: [-0.1372307845370601,  -0.450083615630924,    -0.02439200845186075],
             vel: [ 0.02137177412835578,  -0.006455396660044872, -0.002487957757771483] },
  Venus:   { pos: [-0.725439475506997,   -0.03545030569537367,   0.04122048053303724],
             vel: [ 0.0008034959761149407,-0.02030262561844178,  -0.0003235458586621571] },
  Earth:   { pos: [-0.1842722784343177,   0.964445689270963,     0.0002022132246085051],
             vel: [-0.01720224660838933,  -0.003166189060532839,  1.064592514002072e-08] },
  Moon:    { pos: [-0.1862215600840044,   0.9626075632308897,    0.000444671198490556],
             vel: [-0.01683057613107253,  -0.003588367637063646, -6.634893538849906e-06] },
  Mars:    { pos: [ 1.383578742584744,   -0.01621231564658005,  -0.03426136426962697],
             vel: [ 0.0006768779624069969, 0.0151798411782796,    0.0003015574290837992] },
  Jupiter: { pos: [ 3.994040256427818,    2.935779784974931,    -0.101578984945624],
             vel: [-0.004562948121087195,  0.006435847855854325,  7.548691257292337e-05] },
  Saturn:  { pos: [ 6.399273249217048,    6.567192454614989,    -0.3688696745701767],
             vel: [-0.004286506154280534,  0.003883395100744251,  0.0001025581110922691] },
  Uranus:  { pos: [14.42471809676244,   -13.73711939965492,     -0.2379354688209131],
             vel: [ 0.002683627208509772,  0.002665254700749824, -2.488379610328529e-05] },
  Neptune: { pos: [16.8049100760519,    -24.99455905985419,      0.1274288139389692],
             vel: [ 0.002584290670584903,  0.001769120292270417, -9.611096855010698e-05] },
};
