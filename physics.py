"""Gravitational dynamics from first principles.

Newton's law of universal gravitation states that every point mass attracts
every other point mass along the line joining them.  The acceleration that
body *i* feels from body *j* is

    a_i = sum_{j != i}  GM_j * (r_j - r_i) / |r_j - r_i|^3

This module computes that acceleration field for the whole system.  Working
with the gravitational parameter ``GM`` (rather than G and mass separately)
keeps everything in the AU / day unit system defined in :mod:`constants`.
"""

from __future__ import annotations

import numpy as np


def accelerations(positions: np.ndarray, gm: np.ndarray) -> np.ndarray:
    """Newtonian gravitational acceleration on every body.

    Parameters
    ----------
    positions:
        Array of shape ``(N, 3)`` -- the position of each body, in AU.
    gm:
        Array of shape ``(N,)`` -- the gravitational parameter GM of each
        body, in AU^3 / day^2.

    Returns
    -------
    np.ndarray
        Array of shape ``(N, 3)`` -- the acceleration of each body, in
        AU / day^2.

    Notes
    -----
    The computation is fully vectorised.  ``delta[i, j]`` is the vector from
    body *i* to body *j*; the self term ``i == j`` is masked out so it never
    contributes (and never divides by zero).
    """
    # delta[i, j, :] = r_j - r_i  -> shape (N, N, 3)
    delta = positions[np.newaxis, :, :] - positions[:, np.newaxis, :]

    # Pairwise distances |r_j - r_i|, shape (N, N).
    dist2 = np.sum(delta * delta, axis=-1)
    np.fill_diagonal(dist2, np.inf)          # mask self-interaction
    inv_dist3 = dist2 ** -1.5                 # 1 / |r|^3 (0 on the diagonal)

    # Each body j pulls on i with strength GM_j / |r_ij|^3 along delta.
    # acc[i] = sum_j GM_j * delta[i, j] * inv_dist3[i, j]
    factor = gm[np.newaxis, :] * inv_dist3    # shape (N, N)
    acc = np.einsum("ij,ijk->ik", factor, delta)
    return acc


def total_energy(
    positions: np.ndarray,
    velocities: np.ndarray,
    gm: np.ndarray,
) -> float:
    """Total mechanical energy per unit... scaled by G.

    Because we carry GM rather than mass, we report energy divided by G,
    i.e. in units where each body's "mass" is its GM.  The absolute value is
    unimportant; what matters for a conservation check is that this quantity
    stays constant over the integration.

        E/G = (1/2) sum_i GM_i |v_i|^2
              - sum_{i<j} GM_i GM_j / |r_i - r_j|
    """
    kinetic = 0.5 * np.sum(gm * np.sum(velocities * velocities, axis=-1))

    delta = positions[np.newaxis, :, :] - positions[:, np.newaxis, :]
    dist = np.sqrt(np.sum(delta * delta, axis=-1))
    n = positions.shape[0]
    iu = np.triu_indices(n, k=1)              # unique unordered pairs i<j
    potential = -np.sum(
        gm[iu[0]] * gm[iu[1]] / dist[iu]
    )
    return float(kinetic + potential)


def angular_momentum(
    positions: np.ndarray,
    velocities: np.ndarray,
    gm: np.ndarray,
) -> np.ndarray:
    """Total angular momentum (divided by G), shape ``(3,)``.

    L/G = sum_i GM_i * (r_i x v_i).  Like the energy, this should be conserved
    and provides an independent check on the integrator.
    """
    return np.sum(gm[:, np.newaxis] * np.cross(positions, velocities), axis=0)
