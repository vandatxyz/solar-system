"""Command-line driver for the solar-system simulation and eclipse predictor.

Examples
--------
Fetch fresh initial conditions from JPL Horizons and predict every solar
eclipse in the 10 years following J2000.0::

    python main.py --years 10

Re-run from the cached snapshot with a finer timestep::

    python main.py --years 5 --dt 0.25

Show the conserved-quantity diagnostics only (no eclipse search)::

    python main.py --years 1 --no-eclipses
"""

from __future__ import annotations

import argparse

from simulation import SolarSystem


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Simulate the solar system from first-principles gravity "
                    "and predict solar eclipses.",
    )
    p.add_argument("--years", type=float, default=10.0,
                   help="number of years to simulate forward from J2000.0 "
                        "(default: 10)")
    p.add_argument("--dt", type=float, default=0.1,
                   help="integration timestep in days (default: 0.1). The Moon's "
                        "27.3-day orbit needs a fine step to stay in phase over "
                        "years; coarser steps drift eclipse times.")
    p.add_argument("--no-eclipses", action="store_true",
                   help="skip eclipse detection, report diagnostics only")
    p.add_argument("--no-cache", action="store_true",
                   help="force a fresh fetch from JPL Horizons")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    print("Seeding from JPL Horizons state vectors at J2000.0 ...")
    system = SolarSystem(use_cache=not args.no_cache)

    days = args.years * 365.25
    print(f"Integrating {args.years:g} years ({days:.0f} days) "
          f"at dt = {args.dt:g} day, velocity-Verlet ...")
    result = system.run(days=days, dt=args.dt,
                        find_eclipses=not args.no_eclipses)

    print()
    print("Conservation diagnostics (a faithful integration keeps these tiny):")
    print(f"  relative energy drift          : {result.energy_drift:.2e}")
    print(f"  relative angular-momentum drift: {result.ang_mom_drift:.2e}")
    print(f"  steps taken                    : {result.n_steps:,}")

    if not args.no_eclipses:
        events = result.eclipses
        print()
        print(f"Predicted solar eclipses ({len(events)} found):")
        if not events:
            print("  (none)")
        else:
            totals = sum(1 for e in events if e.kind == "total")
            annular = sum(1 for e in events if e.kind == "annular")
            partial = sum(1 for e in events if e.kind == "partial")
            print(f"  {totals} total, {annular} annular, {partial} partial")
            print()
            for e in events:
                print(f"  {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
