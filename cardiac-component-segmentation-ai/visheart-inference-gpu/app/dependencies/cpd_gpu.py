"""
CUDA port of pycpd.DeformableRegistration, for fit_cpd_rv()'s GPU path.

Ported directly from pycpd's own source (deformable_registration.py +
emregistration.py, read in full before writing this) so the two
implementations run the identical EM iteration -- expectation() computes the
same P, update_transform()/transform_point_cloud() the same W and TY,
update_variance() the same sigma2 -- just on cupy arrays instead of numpy.
CPD's EM loop has no randomness anywhere (no random initialisation), so given
identical X, Y, beta, alpha, max_iterations, tolerance, w, the two backends
should agree up to floating-point rounding.

Ported from Sharlene's rv-deformation repo (src/cpd_gpu.py), where it was
verified against real patient data (scripts/verify_cpd_gpu.py): W differs by
3.8e-13 max / 4.5e-14 mean between backends -- floating-point noise, not a
real disagreement -- and the warm GPU call ran ~9x faster than CPU at that
project's actual point-cloud sizes (target 3000 pts, source 2700 pts).

Only what downstream code actually reads is exposed. cpd_rv_segmentation's
apply_cpd_field only ever touches reg.Y, reg.W, reg.beta -- get_registration_
parameters(), .P, .sigma2 etc. are never read outside pycpd's own internals,
so FittedField below doesn't carry them.

Two deliberate departures from pycpd's own CPU code, both same-numbers/
less-memory rather than algorithmic changes:

  - gaussian_kernel and the E-step's pairwise distance are built here with
    plain broadcasting (X[None,:,:] - Y[:,None,:]) instead of pycpd's
    np.tile-based version. np.tile materialises D duplicate copies before
    broadcasting would have given the same result for free.
  - diag(P1) @ G / diag(P1) @ Y are row-scaling operations, so they're done
    as P1[:, None] * G / P1[:, None] * Y instead of forming the full M x M
    diagonal matrix and multiplying it out. Identical result, no O(M^2)
    matrix nobody needed.
"""
from dataclasses import dataclass

import numpy as np

try:
    import cupy as cp
    _CUPY_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover -- environment dependent
    cp = None
    _CUPY_IMPORT_ERROR = exc


def gpu_available() -> bool:
    """True only if cupy is importable AND a CUDA device actually responds --
    a machine without a GPU (or without cupy installed) gets False here, not
    an exception, so callers can use this as a plain fallback check."""
    if cp is None:
        return False
    try:
        return bool(cp.cuda.is_available())
    except Exception:
        return False


@dataclass
class FittedField:
    """Duck-typed drop-in for the three attributes apply_cpd_field() reads off
    a pycpd DeformableRegistration. Always plain numpy, regardless of which
    backend produced it, so downstream code doesn't need to know or care
    which one ran."""
    Y: np.ndarray
    W: np.ndarray
    beta: float


def fit_cpd_gpu(target_points: np.ndarray, source_points: np.ndarray,
                 beta: float = 1.5, lamb: float = 30.0, max_iterations: int = 30,
                 tolerance: float = 0.001, w: float = 0.0) -> FittedField:
    """
    GPU equivalent of DeformableRegistration(X=target_points, Y=source_points,
    beta=beta, alpha=lamb, max_iterations=max_iterations).register().

    float64 throughout, matching numpy/pycpd's default precision -- chosen
    for numerical agreement with the CPU path over the extra speed float32
    would give.
    """
    if not gpu_available():
        raise RuntimeError(
            "fit_cpd_gpu() called but no CUDA-capable GPU / cupy install is "
            "available -- callers should check gpu_available() first. "
            f"Import error was: {_CUPY_IMPORT_ERROR}"
        )

    X = cp.asarray(target_points, dtype=cp.float64)
    Y = cp.asarray(source_points, dtype=cp.float64)
    N, D = X.shape
    M, _ = Y.shape
    alpha = lamb

    # initialize_sigma2 (emregistration.py)
    diff0 = X[None, :, :] - Y[:, None, :]
    sigma2 = float(cp.sum(diff0 ** 2) / (D * M * N))

    # gaussian_kernel (deformable_registration.py)
    diffG = Y[None, :, :] - Y[:, None, :]
    G = cp.exp(-cp.sum(diffG * diffG, axis=2) / (2 * beta ** 2))

    W = cp.zeros((M, D))
    TY = Y  # transform_point_cloud() with W=0 leaves TY == Y, as in pycpd's register()

    iteration = 0
    diff = np.inf
    while iteration < max_iterations and diff > tolerance:
        # --- expectation (E-step) ---
        P = cp.sum((X[None, :, :] - TY[:, None, :]) ** 2, axis=2)
        c = (2 * cp.pi * sigma2) ** (D / 2)
        c = c * w / (1 - w)
        c = c * M / N

        P = cp.exp(-P / (2 * sigma2))
        den = cp.sum(P, axis=0)
        den = cp.tile(den, (M, 1))
        den[den == 0] = cp.finfo(cp.float64).eps
        den += c

        P = P / den
        Pt1 = cp.sum(P, axis=0)
        P1 = cp.sum(P, axis=1)
        Np = cp.sum(P1)

        # --- maximization: update_transform ---
        A = P1[:, None] * G + alpha * sigma2 * cp.eye(M)
        B = P @ X - P1[:, None] * Y
        W = cp.linalg.solve(A, B)

        # --- maximization: transform_point_cloud ---
        TY = Y + G @ W

        # --- maximization: update_variance ---
        sigma2_prev = sigma2
        xPx = Pt1 @ cp.sum(X * X, axis=1)
        yPy = P1 @ cp.sum(TY * TY, axis=1)
        trPXY = cp.sum(TY * (P @ X))
        sigma2 = float((xPx - 2 * trPXY + yPy) / (Np * D))
        if sigma2 <= 0:
            sigma2 = tolerance / 10

        diff = abs(sigma2 - sigma2_prev)
        iteration += 1

    return FittedField(Y=cp.asnumpy(Y), W=cp.asnumpy(W), beta=beta)
