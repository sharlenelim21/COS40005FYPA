import torch
import torch.nn as nn
import math
from utils.postprocess import soft_argmax_normalized


def wing_loss(pred, target, w=10.0, epsilon=2.0):
    """
    Wing loss for coordinate regression.
    Reference: Feng et al., CVPR 2018.
    """
    diff = torch.abs(pred - target)
    C    = w - w * math.log(1.0 + w / epsilon)
    loss = torch.where(
        diff < w,
        w * torch.log(1.0 + diff / epsilon),
        diff - C,
    )
    return loss.mean()


def wing_loss_elementwise(pred, target, w=10.0, epsilon=2.0):
    """
    Element-wise Wing loss — returns [B, 4] without reducing,
    so per-sample losses can be sorted for Worst-K mining.
    """
    diff = torch.abs(pred - target)
    C    = w - w * math.log(1.0 + w / epsilon)
    return torch.where(
        diff < w,
        w * torch.log(1.0 + diff / epsilon),
        diff - C,
    )


class HeatmapLoss(nn.Module):
    """
    Balanced heatmap + coordinate loss.

    FIX: Default wing_w lowered from 0.05 → 0.02.
    In normalised [0,1] space, wing_w is the threshold (in fraction of image
    width) below which the loss switches from linear to log.
    0.05 → threshold at ~13px  (too coarse — easy samples dominate)
    0.02 → threshold at ~5px   (correct for subpixel precision target)
    0.005→ threshold at ~1.3px (use in P3 for final precision squeeze)

    wing_eps similarly tightened from 0.01 → 0.005.

    hard_k: keep only the K highest-error samples per batch for the gradient.
    Set to batch_size - 2 in train.py (drops the 2 easiest per batch).
    """

    def __init__(
        self,
        coord_weight=10.0,
        sep_weight=1.0,
        sep_min_dist=0.08,
        wing_w=0.02,       
        wing_eps=0.005,    
        lm_weights=None,
        hard_k=None,
    ):
        super().__init__()
        self.bce          = nn.BCEWithLogitsLoss()
        self.coord_weight = coord_weight
        self.sep_weight   = sep_weight
        self.sep_min_dist = sep_min_dist
        self.wing_w       = wing_w
        self.wing_eps     = wing_eps
        self.hard_k       = hard_k

        if lm_weights is not None:
            w = torch.tensor(lm_weights, dtype=torch.float32)
            self.register_buffer("lm_weights", w / w.mean())
        else:
            self.lm_weights = None

    def dice_loss(self, pred, target):
        pred   = torch.sigmoid(pred)
        smooth = 1e-6
        inter  = (pred * target).sum(dim=(2, 3))
        union  = pred.sum(dim=(2, 3)) + target.sum(dim=(2, 3))
        dice   = (2 * inter + smooth) / (union + smooth)
        return 1 - dice.mean()

    def forward(self, pred, target):
        # 1. Heatmap losses (pred is raw logits, target is [0,1])
        loss_bce  = self.bce(pred, target)
        loss_dice = self.dice_loss(pred, target)

        # 2. Coordinate loss — Wing loss in normalised [0,1] space
        pred_sig    = torch.sigmoid(pred)
        pred_coords = soft_argmax_normalized(pred_sig)
        gt_coords   = soft_argmax_normalized(target)

        raw = wing_loss_elementwise(pred_coords, gt_coords,
                                    w=self.wing_w, epsilon=self.wing_eps)  # [B, 4]

        if self.lm_weights is not None:
            w = self.lm_weights.to(pred.device).repeat_interleave(2)   # [4]
            raw = raw * w

        # Per-sample scalar loss, keep only the K hardest.
        per_sample = raw.mean(dim=-1)   # [B]
        if self.hard_k is not None and per_sample.size(0) > self.hard_k:
            per_sample = per_sample.topk(self.hard_k).values

        loss_coord = per_sample.mean()

        # 3. Separation loss
        p1       = pred_coords[:, :2]
        p2       = pred_coords[:, 2:]
        sep      = torch.norm(p1 - p2, dim=1).mean()
        loss_sep = torch.clamp(self.sep_min_dist - sep, min=0.0)

        total = (
            loss_bce
            + loss_dice
            + self.coord_weight * loss_coord
            + self.sep_weight   * loss_sep
        )

        return total, {
            "bce":   loss_bce.item(),
            "dice":  loss_dice.item(),
            "coord": loss_coord.item(),
            "sep":   loss_sep.item(),
        }