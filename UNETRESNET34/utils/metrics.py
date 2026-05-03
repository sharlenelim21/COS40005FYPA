import torch
import numpy as np


def compute_mre(pred_coords, gt_coords):
    """
    Mean Radial Error across all landmarks and both batch items.

    pred_coords : [B, 4]  (x1,y1,x2,y2) in pixels
    gt_coords   : [B, 4]  raw GT pixel coords
    Returns     : scalar tensor — mean radial error in pixels
    """
    pred = pred_coords.view(-1, 2, 2)   # [B, 2 landmarks, xy]
    gt   = gt_coords.view(-1, 2, 2)
    dist = torch.norm(pred - gt, dim=-1)   # [B, 2]
    return dist.mean()


def compute_mre_per_landmark(pred_coords, gt_coords):
    """
    Per-landmark MRE so you can see which point is harder to localise.

    Returns : (mre_lm1, mre_lm2)  — scalars in pixels
    """
    pred = pred_coords.view(-1, 2, 2)   # [B, 2, 2]
    gt   = gt_coords.view(-1, 2, 2)
    dist = torch.norm(pred - gt, dim=-1)   # [B, 2]
    return dist[:, 0].mean().item(), dist[:, 1].mean().item()


def compute_sdr(pred_coords, gt_coords, threshold=5.0):
    """
    Successful Detection Rate: fraction of landmarks within `threshold` pixels.

    pred_coords : [B, 4]
    gt_coords   : [B, 4]
    threshold   : detection radius in pixels (default 5 px)
    """
    pred = pred_coords.view(-1, 2)
    gt   = gt_coords.view(-1, 2)
    dist = torch.norm(pred - gt, dim=-1)
    return (dist < threshold).float().mean().item()


def compute_sdr_multi(pred_coords, gt_coords, thresholds=(2.0, 5.0, 10.0)):
    """
    SDR at multiple thresholds simultaneously — useful for a richer picture
    of model accuracy without extra compute.

    Returns : dict  e.g. {2: 0.41, 5: 0.78, 10: 0.94}
    """
    pred = pred_coords.view(-1, 2)
    gt   = gt_coords.view(-1, 2)
    dist = torch.norm(pred - gt, dim=-1)
    return {int(t): (dist < t).float().mean().item() for t in thresholds}


def compute_per_sample_mre(pred_coords, gt_coords):
    """
    Per-sample MRE (averaged across the 2 landmarks within each sample).
    Use this to accumulate individual errors across batches for percentile
    computation — do NOT average before collecting all samples.

    pred_coords : [B, 4]
    gt_coords   : [B, 4]
    Returns     : [B] tensor — one MRE value per sample in pixels
    """
    pred = pred_coords.view(-1, 2, 2)   # [B, 2, xy]
    gt   = gt_coords.view(-1, 2, 2)
    dist = torch.norm(pred - gt, dim=-1)   # [B, 2]
    return dist.mean(dim=-1)              # [B]


def compute_mre_percentiles(all_sample_mres, percentiles=(50, 75, 90, 95, 100)):
    """
    Compute MRE percentiles across the full validation set.
    Call this once after collecting per-sample MREs from all batches.

    all_sample_mres : list or 1-D array/tensor of per-sample MRE values
                      (one scalar per val sample, NOT per landmark)
    percentiles     : which percentiles to compute (default: P50/75/90/95/100)

    Returns : dict  e.g. {50: 4.1, 75: 6.2, 90: 7.8, 95: 8.5, 100: 9.1}

    Example usage in validate():
        sample_mres = []
        for imgs, hms, gts in loader:
            ...
            per_sample = compute_per_sample_mre(pred_coords, gt_coords)
            sample_mres.extend(per_sample.cpu().tolist())
        pct = compute_mre_percentiles(sample_mres)
        print(f"P50={pct[50]:.2f} P90={pct[90]:.2f} Max={pct[100]:.2f}")
    """
    arr = np.array(all_sample_mres, dtype=np.float32)
    return {int(p): float(np.percentile(arr, p)) for p in percentiles}