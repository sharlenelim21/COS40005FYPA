import torch
import torch.nn.functional as F


def soft_argmax(heatmap, beta=50):
    """
    Differentiable spatial argmax.
    heatmap: [B, C, H, W] — must be in [0,1] (apply sigmoid to logits first)
    returns: [B, C*2]  interleaved (x0,y0, x1,y1)

    beta: sharpness of the soft distribution.
      - High beta (~50-200) → tight distribution, accurate at low sigma.
      - Low beta (~10) was the old default — too spread at sigma<5, loses precision.
    """
    B, C, H, W = heatmap.shape
    flat  = heatmap.view(B, C, -1)
    probs = torch.softmax(flat * beta, dim=-1)

    idx = torch.arange(H * W, device=heatmap.device, dtype=heatmap.dtype)
    x   = idx % W
    y   = idx // W

    ex = (probs * x).sum(dim=-1)   # [B, C]
    ey = (probs * y).sum(dim=-1)   # [B, C]

    return torch.stack([ex, ey], dim=-1).view(B, -1)   # [B, C*2]


def soft_argmax_normalized(heatmap, beta=50):
    """Same as soft_argmax but returns coords normalized to [0, 1]."""
    B, C, H, W = heatmap.shape
    coords = soft_argmax(heatmap, beta)
    norm = torch.tensor([W, H] * C,
                        device=heatmap.device,
                        dtype=heatmap.dtype)
    return coords / norm


def heatmap_to_coords_argmax(heatmap):
    """
    Hard argmax — NOT differentiable.
    Fast but subpixel-inaccurate. Replaced by gaussian_subpixel_argmax
    at inference time for better precision.
    heatmap: [B, C, H, W]
    returns: [B, C*2]
    """
    B, C, H, W = heatmap.shape
    flat = heatmap.view(B, C, -1)
    idx  = torch.argmax(flat, dim=-1)   # [B, C]
    x    = idx % W
    y    = idx // W
    return torch.stack([x, y], dim=-1).view(B, -1).float()


def gaussian_subpixel_argmax(heatmap, window=7):
    """
    Subpixel-accurate landmark localisation via Gaussian-weighted centroid
    computed inside a local window around the hard-argmax peak.

    window default raised to 7 (was 5).
    For sigma=1.2 the peak is sharp but still has meaningful probability mass
    within a 7px radius — a window of 3 (old: int(sigma*1.2)) truncates too early.

    heatmap : [B, C, H, W] — probabilities in [0, 1]
    window  : neighbourhood half-width (total patch = 2*window+1)
    returns : [B, C*2]  float coords in pixel space
    """
    B, C, H, W = heatmap.shape
    hw = window

    flat = heatmap.view(B, C, -1)
    peak_idx = torch.argmax(flat, dim=-1)   # [B, C]
    px = (peak_idx % W).float()
    py = (peak_idx // W).float()

    ex = torch.zeros_like(px)
    ey = torch.zeros_like(py)

    for b in range(B):
        for c in range(C):
            peak_x = int(px[b, c].item())
            peak_y = int(py[b, c].item())

            x0 = max(peak_x - hw, 0);   x1 = min(peak_x + hw + 1, W)
            y0 = max(peak_y - hw, 0);   y1 = min(peak_y + hw + 1, H)

            patch = heatmap[b, c, y0:y1, x0:x1]
            ph, pw = patch.shape

            if ph == 0 or pw == 0:
                ex[b, c] = px[b, c]
                ey[b, c] = py[b, c]
                continue

            flat_patch = patch.reshape(1, 1, -1)
            probs      = torch.softmax(flat_patch * 20.0, dim=-1).squeeze()
            probs      = probs.view(ph, pw)

            xs = torch.arange(x0, x1, device=heatmap.device, dtype=heatmap.dtype)
            ys = torch.arange(y0, y1, device=heatmap.device, dtype=heatmap.dtype)

            ex[b, c] = (probs.sum(0) * xs).sum()
            ey[b, c] = (probs.sum(1) * ys).sum()

    return torch.stack([ex, ey], dim=-1).view(B, -1)   # [B, C*2]


def quadratic_subpixel_argmax(heatmap):
    """
    Subpixel peak refinement using 1D quadratic fits on a 3x3 neighborhood.

    Uses the closed-form offset from three samples along x and y:
      dx = 0.5 * (f(-1) - f(+1)) / (f(-1) - 2f(0) + f(+1))
    Falls back to integer argmax at borders or if curvature is too small.

    heatmap : [B, C, H, W] — probabilities in [0, 1]
    returns : [B, C*2] float coords in pixel space
    """
    B, C, H, W = heatmap.shape
    flat = heatmap.view(B, C, -1)
    peak_idx = torch.argmax(flat, dim=-1)   # [B, C]
    px = (peak_idx % W).float()
    py = (peak_idx // W).float()

    ex = torch.zeros_like(px)
    ey = torch.zeros_like(py)

    for b_idx in range(B):
        for c_idx in range(C):
            x = int(px[b_idx, c_idx].item())
            y = int(py[b_idx, c_idx].item())

            if x <= 0 or x >= W - 1 or y <= 0 or y >= H - 1:
                ex[b_idx, c_idx] = px[b_idx, c_idx]
                ey[b_idx, c_idx] = py[b_idx, c_idx]
                continue

            f0 = heatmap[b_idx, c_idx, y, x]
            fx1 = heatmap[b_idx, c_idx, y, x - 1]
            fx2 = heatmap[b_idx, c_idx, y, x + 1]
            fy1 = heatmap[b_idx, c_idx, y - 1, x]
            fy2 = heatmap[b_idx, c_idx, y + 1, x]

            denom_x = fx1 - 2.0 * f0 + fx2
            denom_y = fy1 - 2.0 * f0 + fy2

            if torch.abs(denom_x) > 1e-6:
                dx = 0.5 * (fx1 - fx2) / denom_x
            else:
                dx = torch.tensor(0.0, device=heatmap.device, dtype=heatmap.dtype)

            if torch.abs(denom_y) > 1e-6:
                dy = 0.5 * (fy1 - fy2) / denom_y
            else:
                dy = torch.tensor(0.0, device=heatmap.device, dtype=heatmap.dtype)

            dx = torch.clamp(dx, -1.0, 1.0)
            dy = torch.clamp(dy, -1.0, 1.0)

            ex[b_idx, c_idx] = px[b_idx, c_idx] + dx
            ey[b_idx, c_idx] = py[b_idx, c_idx] + dy

    return torch.stack([ex, ey], dim=-1).view(B, -1)   # [B, C*2]