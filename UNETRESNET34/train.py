import torch
import torch.nn.functional as F_nn
from torch.utils.data import DataLoader, Subset
import numpy as np
import os
from datetime import datetime

from dataset.landmark_dataset import LandmarkDataset
from models.unet_resnet34 import UNetResNet34
from utils.loss import HeatmapLoss
from utils.postprocess import gaussian_subpixel_argmax
from utils.metrics import (compute_mre, compute_mre_per_landmark,
                           compute_sdr_multi, compute_per_sample_mre,
                           compute_mre_percentiles)
from utils.visualize import save_epoch_grid, save_training_curve

# ─────────────────────────────────────────────────────────────
IMAGE_DIR  = "data/lv-landmark/Training/images"
MASK_DIR   = "data/lv-landmark/Training/masks"
BATCH_SIZE = 8
SEED       = 42
N_VIS      = 8

P1_EPOCHS = 6
P2_EPOCHS = 49
P3_EPOCHS = 35

LR_HEAD_P1     = 1e-3
LR_HEAD_P2     = 1e-3
LR_BACKBONE_P2 = 5e-5
LR_P3          = 3e-5

SIGMA_P1       = 12.0
SIGMA_START    = 12.0

# With cosine schedule this means sigma hits ~3 around epoch 30/49,
# giving the model ~19 epochs of subpixel-precision training in P2 alone.
SIGMA_END      = 2.0
SIGMA_P3_START = 2.0    # continue from P2 end — no discontinuity
SIGMA_P3_END   = 1.2

MIXUP_ALPHA  = 0.2
MIXUP_PROB   = 0.3
WEIGHT_DECAY = 1e-4

AUX_WEIGHT_MAX = 0.4
AUX_WEIGHT_MIN = 0.05

EARLY_STOP_P2 = 18
EARLY_STOP_P3 = 18

VAL_SPLIT    = 0.2
COORD_WEIGHT = 15.0
LM_WEIGHTS   = [2.5, 1.0]
HARD_K       = BATCH_SIZE - 2  

CARDIAC_PRETRAINED = False
# ─────────────────────────────────────────────────────────────


def seed_worker(worker_id):
    np.random.seed(SEED + worker_id)


def sigma_p2(ep, total):
    """
    FIX: cosine sigma decay instead of linear.
    Cosine shape: drops fast early, lingers at low sigma for the last third.
    That low-sigma tail is where the model actually learns subpixel precision.

    ep=0        → SIGMA_START (12.0)
    ep=total/2  → ~7.0
    ep=total    → SIGMA_END   (2.0)
    """
    t = min(ep / total, 1.0)
    t_cos = (1.0 - np.cos(np.pi * t)) / 2.0   # 0→1 with cosine easing
    return SIGMA_START + t_cos * (SIGMA_END - SIGMA_START)


def aux_weight(sigma):
    """Scale aux loss weight down as sigma shrinks — heatmap aux is less
    useful at subpixel scale but still helps at coarse scale."""
    t = np.clip((sigma - 2.0) / (15.0 - 2.0), 0, 1)
    return AUX_WEIGHT_MIN + t * (AUX_WEIGHT_MAX - AUX_WEIGHT_MIN)


def set_encoder_grad(model, flag):
    for n, p in model.named_parameters():
        if any(n.startswith(x) for x in ["enc0", "enc1", "enc2", "enc3", "enc4"]):
            p.requires_grad = flag


def mixup(images, heatmaps, alpha=0.2):
    lam = np.random.beta(alpha, alpha)
    idx = torch.randperm(images.size(0), device=images.device)
    return lam * images + (1 - lam) * images[idx], lam * heatmaps + (1 - lam) * heatmaps[idx]


@torch.no_grad()
def tta_predict(model, image):
    """Light 3-variant TTA used during validation (h-flip, v-flip, original)."""
    preds = []
    preds.append(torch.sigmoid(model(image)))
    p = torch.sigmoid(model(torch.flip(image, [3])))
    preds.append(torch.flip(p, [3]))
    p = torch.sigmoid(model(torch.flip(image, [2])))
    preds.append(torch.flip(p, [2]))
    return torch.stack(preds).mean(0)


def train_epoch(model, loader, opt, criterion, device,
                sigma, do_mixup, do_aux, aw, clip=5.0):
    model.train()
    tot  = 0.0
    subs = {"bce": 0.0, "dice": 0.0, "coord": 0.0, "sep": 0.0}

    # check once per epoch whether aux heads exist AND have stored features.
    has_aux = do_aux and hasattr(model, 'aux_head1') and hasattr(model, '_aux_feat1')

    for imgs, hms, _ in loader:
        imgs = imgs.to(device)
        hms  = hms.to(device)

        if do_mixup and np.random.rand() < MIXUP_PROB:
            imgs, hms = mixup(imgs, hms, MIXUP_ALPHA)

        opt.zero_grad()
        logits     = model(imgs)
        loss, parts = criterion(logits, hms)

    # Wire deep supervision
        if has_aux and model._aux_feat1 is not None:
            out1 = model.aux_head1(model._aux_feat1)
            out2 = model.aux_head2(model._aux_feat2)
            hm1  = F_nn.interpolate(hms, size=out1.shape[2:],
                                    mode='bilinear', align_corners=False)
            hm2  = F_nn.interpolate(hms, size=out2.shape[2:],
                                    mode='bilinear', align_corners=False)
            a1, _ = criterion(out1, hm1)
            a2, _ = criterion(out2, hm2)
            loss   = loss + aw * (a1 + a2)

        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), clip)
        opt.step()

        tot += loss.item()
        for k in subs:
            subs[k] += parts[k]

    n = len(loader)
    return tot / n, {k: v / n for k, v in subs.items()}


@torch.no_grad()
def validate(model, loader, criterion, device, sigma):
    model.eval()
    vl = mr = mr1 = mr2 = 0.0
    sdr = {2: 0.0, 5: 0.0, 10: 0.0}
    vis_i, vis_p, vis_g = [], [], []
    sample_mres = []

    for imgs, hms, gts in loader:
        imgs = imgs.to(device)
        hms  = hms.to(device)
        gts  = gts.to(device)

        loss, _ = criterion(model(imgs), hms)
        vl += loss.item()

        ph = tta_predict(model, imgs)
        pc = gaussian_subpixel_argmax(ph, window=7)

        mr  += compute_mre(pc, gts).item()
        m1, m2 = compute_mre_per_landmark(pc, gts)
        mr1 += m1
        mr2 += m2
        s = compute_sdr_multi(pc, gts, (2.0, 5.0, 10.0))
        for t in sdr:
            sdr[t] += s[t]
        sample_mres.extend(compute_per_sample_mre(pc, gts).cpu().tolist())

        if len(vis_i) < N_VIS:
            vis_i.append(imgs[0, 0].cpu().numpy())
            vis_p.append(pc[0].cpu().numpy())
            vis_g.append(gts[0].cpu().numpy())

    n   = len(loader)
    pct = compute_mre_percentiles(sample_mres)
    return {
        "val_loss": vl / n,
        "mre":      mr / n,
        "mre1":     mr1 / n,
        "mre2":     mr2 / n,
        "sdr":      {t: sdr[t] / n for t in sdr},
        "pct":      pct,
        "vis":      (vis_i, vis_p, vis_g),
    }


def make_loaders(train_ds, val_ds, train_idx, val_idx):
    g = torch.Generator()
    g.manual_seed(SEED)
    tl = DataLoader(Subset(train_ds, train_idx), batch_size=BATCH_SIZE,
                    shuffle=True,  num_workers=2, pin_memory=True,
                    worker_init_fn=seed_worker, generator=g)
    vl = DataLoader(Subset(val_ds,   val_idx),   batch_size=BATCH_SIZE,
                    shuffle=False, num_workers=2, pin_memory=True,
                    worker_init_fn=seed_worker)
    return tl, vl


def train(p2_checkpoint=None):
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark     = False

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    probe = LandmarkDataset(IMAGE_DIR, MASK_DIR, augment=False,
                            sigma=SIGMA_P1, min_landmark_dist=0, slice_axis=2)
    n_total = len(probe)
    del probe

    g   = torch.Generator().manual_seed(SEED)
    idx = torch.randperm(n_total, generator=g).tolist()
    n_v = int(n_total * VAL_SPLIT)
    train_idx, val_idx = idx[n_v:], idx[:n_v]

    train_ds = LandmarkDataset(IMAGE_DIR, MASK_DIR, augment=True,
                               sigma=SIGMA_P1, min_landmark_dist=0, slice_axis=2)
    val_ds   = LandmarkDataset(IMAGE_DIR, MASK_DIR, augment=False,
                               sigma=SIGMA_P1, min_landmark_dist=0, slice_axis=2)
    tl, vl   = make_loaders(train_ds, val_ds, train_idx, val_idx)

    model = UNetResNet34(in_channels=1, num_classes=2, dropout=0.2,
                   pretrained=True,
                   cardiac_pretrained=CARDIAC_PRETRAINED).to(device)
    has_aux = hasattr(model, 'aux_head1')
    print(f"Deep supervision: {'enabled' if has_aux else 'disabled'}")

    crit = HeatmapLoss(
        coord_weight=COORD_WEIGHT,
        sep_weight=1.0,
        sep_min_dist=0.08,
        wing_w=0.04,        # ~10px in P1, tightened further in P3
        wing_eps=0.008,
        lm_weights=LM_WEIGHTS,
        hard_k=HARD_K,
    )

    ts        = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    run_dir   = os.path.join("checkpoints", ts)
    grids_dir = os.path.join(run_dir, "grids")
    os.makedirs(grids_dir, exist_ok=True)

    history    = []
    best_score = float("inf")
    best_mre   = float("inf")

    if p2_checkpoint is None:
        # ═══════════════════════════════════════════════════════════
        #  PHASE 1 — warmup, frozen encoder
        # ═══════════════════════════════════════════════════════════
        print(f"\n{'='*60}\n  PHASE 1 - warmup ({P1_EPOCHS} ep, frozen enc, sigma={SIGMA_P1})\n{'='*60}")
        set_encoder_grad(model, False)
        op1 = torch.optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()),
                                lr=LR_HEAD_P1, weight_decay=WEIGHT_DECAY)
        sc1 = torch.optim.lr_scheduler.CosineAnnealingLR(op1, T_max=P1_EPOCHS, eta_min=1e-5)
        train_ds.set_sigma(SIGMA_P1)
        val_ds.set_sigma(SIGMA_P1)

        for ep in range(1, P1_EPOCHS + 1):
            aw = aux_weight(SIGMA_P1)
            tl_loss, sub = train_epoch(model, tl, op1, crit, device,
                                       SIGMA_P1, do_mixup=True, do_aux=has_aux, aw=aw)
            v = validate(model, vl, crit, device, SIGMA_P1)
            sc1.step()
            print(f"[P1] {ep:2d}/{P1_EPOCHS} | sigma={SIGMA_P1} | lr={op1.param_groups[-1]['lr']:.2e} | "
                  f"Train={tl_loss:.4f} | Val={v['val_loss']:.4f} | "
                  f"MRE={v['mre']:.2f}px (LM1={v['mre1']:.2f} LM2={v['mre2']:.2f}) | "
                  f"SDR@2/5/10: {v['sdr'][2]:.3f}/{v['sdr'][5]:.3f}/{v['sdr'][10]:.3f} | "
                  f"P50={v['pct'][50]:.2f} P90={v['pct'][90]:.2f} Max={v['pct'][100]:.2f}px")
            history.append({"epoch": ep, "train_loss": tl_loss, "val_loss": v["val_loss"],
                            "mre": v["mre"], "sdr": v["sdr"][5], "sigma": SIGMA_P1})

        # ═══════════════════════════════════════════════════════════
        #  PHASE 2 — cosine sigma curriculum, full model
        # ═══════════════════════════════════════════════════════════
        print(f"\n{'='*60}\n  PHASE 2 - curriculum ({P2_EPOCHS} ep, sigma {SIGMA_START}->{SIGMA_END}, cosine)\n{'='*60}")
        set_encoder_grad(model, True)
        enc_pfx = ["enc0", "enc1", "enc2", "enc3", "enc4"]
        op2 = torch.optim.AdamW([
            {"params": [p for n, p in model.named_parameters()
                        if any(n.startswith(x) for x in enc_pfx)],     "lr": LR_BACKBONE_P2},
            {"params": [p for n, p in model.named_parameters()
                        if not any(n.startswith(x) for x in enc_pfx)], "lr": LR_HEAD_P2},
        ], weight_decay=WEIGHT_DECAY)
        sc2 = torch.optim.lr_scheduler.CosineAnnealingLR(op2, T_max=P2_EPOCHS, eta_min=2e-6)

        no_imp = 0
        for ep_loc in range(1, P2_EPOCHS + 1):
            ep_g  = P1_EPOCHS + ep_loc
            # cosine schedule — ep_loc-1 so first epoch starts at SIGMA_START
            sigma = sigma_p2(ep_loc - 1, P2_EPOCHS)
            train_ds.set_sigma(sigma)
            val_ds.set_sigma(sigma)

            aw = aux_weight(sigma)
            tl_loss, sub = train_epoch(model, tl, op2, crit, device,
                                       sigma, do_mixup=True, do_aux=has_aux, aw=aw)
            v = validate(model, vl, crit, device, sigma)
            sc2.step()

            score    = v["pct"][90]   # FIX: checkpoint on P90, not mean MRE
            improved = score < best_score
            print(f"[P2] {ep_g:2d} | sigma={sigma:.2f} | lr={op2.param_groups[-1]['lr']:.2e} | "
                  f"Train={tl_loss:.4f} | Val={v['val_loss']:.4f} | "
                  f"MRE={v['mre']:.2f}px (LM1={v['mre1']:.2f} LM2={v['mre2']:.2f}) | "
                  f"SDR@2/5/10: {v['sdr'][2]:.3f}/{v['sdr'][5]:.3f}/{v['sdr'][10]:.3f} | "
                  f"P50={v['pct'][50]:.2f} P90={v['pct'][90]:.2f} Max={v['pct'][100]:.2f}px"
                  + (" best" if improved else ""))
            history.append({"epoch": ep_g, "train_loss": tl_loss, "val_loss": v["val_loss"],
                            "mre": v["mre"], "sdr": v["sdr"][5], "sigma": sigma})

            if improved:
                best_score = score
                best_mre   = v["pct"][90]
                no_imp     = 0
                torch.save(model.state_dict(), os.path.join(run_dir, "best_p2.pth"))
                save_epoch_grid(*v["vis"], epoch=ep_g, save_dir=grids_dir, n_samples=N_VIS)
            else:
                no_imp += 1
                if no_imp >= EARLY_STOP_P2:
                    print("  Warning: P2 early stop")
                    break
            torch.save(model.state_dict(), os.path.join(run_dir, "last_model.pth"))
    else:
        print(f"\n{'='*60}\n  PHASE 2 - skipped (using provided checkpoint)\n{'='*60}")

    # ═══════════════════════════════════════════════════════════
    #  PHASE 3 — subpixel precision squeeze
    # ═══════════════════════════════════════════════════════════
    print(f"\n{'='*60}\n  PHASE 3 - precision ({P3_EPOCHS} ep, "
          f"sigma {SIGMA_P3_START}->{SIGMA_P3_END}, LR={LR_P3}->1e-6)\n{'='*60}")

    set_encoder_grad(model, True)

    p2_ckpt = p2_checkpoint or os.path.join(run_dir, "best_p2.pth")
    if p2_ckpt and os.path.exists(p2_ckpt):
        model.load_state_dict(torch.load(p2_ckpt, map_location=device, weights_only=True))
        print(f"  Loaded P2 checkpoint: {p2_ckpt}")
        v = validate(model, vl, crit, device, SIGMA_P3_START)
        best_mre = v["pct"][90]
        print(f"  P2 baseline - P90={v['pct'][90]:.2f}px MRE={v['mre']:.2f}px")

    op3 = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=LR_P3, weight_decay=WEIGHT_DECAY,
    )
    sc3 = torch.optim.lr_scheduler.CosineAnnealingLR(op3, T_max=P3_EPOCHS, eta_min=1e-6)

    crit_p3 = HeatmapLoss(
        coord_weight=25.0,
        sep_weight=0.3,
        sep_min_dist=0.08,
        wing_w=0.008,       # ~2px threshold
        wing_eps=0.002,
        lm_weights=LM_WEIGHTS,
        hard_k=HARD_K,
    )

    best_mre_p3 = best_mre
    no_imp      = 0

    for ep_loc in range(1, P3_EPOCHS + 1):
        ep_g  = P1_EPOCHS + P2_EPOCHS + ep_loc
        t     = (ep_loc - 1) / max(P3_EPOCHS - 1, 1)
        sigma = SIGMA_P3_START + t * (SIGMA_P3_END - SIGMA_P3_START)
        train_ds.set_sigma(sigma)
        val_ds.set_sigma(sigma)

        tl_loss, sub = train_epoch(model, tl, op3, crit_p3, device,
                                   sigma, do_mixup=False, do_aux=False,
                                   aw=0.0, clip=3.0)
        v = validate(model, vl, crit_p3, device, sigma)
        sc3.step()

        improved = v["pct"][90] < best_mre_p3
        print(f"[P3] {ep_g:2d} | sigma={sigma:.2f} | lr={op3.param_groups[0]['lr']:.2e} | "
              f"Train={tl_loss:.4f} | Val={v['val_loss']:.4f} | "
              f"MRE={v['mre']:.2f}px (LM1={v['mre1']:.2f} LM2={v['mre2']:.2f}) | "
              f"SDR@2/5/10: {v['sdr'][2]:.3f}/{v['sdr'][5]:.3f}/{v['sdr'][10]:.3f} | "
              f"P50={v['pct'][50]:.2f} P90={v['pct'][90]:.2f} Max={v['pct'][100]:.2f}px"
              + (" best" if improved else ""))
        history.append({"epoch": ep_g, "train_loss": tl_loss, "val_loss": v["val_loss"],
                        "mre": v["mre"], "sdr": v["sdr"][5], "sigma": sigma})

        if improved:
            best_mre_p3 = v["pct"][90]
            no_imp      = 0
            torch.save(model.state_dict(), os.path.join(run_dir, "best_model.pth"))
            save_epoch_grid(*v["vis"], epoch=ep_g, save_dir=grids_dir, n_samples=N_VIS)
        else:
            no_imp += 1
            if no_imp >= EARLY_STOP_P3:
                print("  Warning: P3 early stop")
                break
        torch.save(model.state_dict(), os.path.join(run_dir, "last_model.pth"))

    save_training_curve(history, run_dir)
    print(f"\n{'='*60}")
    print(f"  Best P2 P90 MRE : {best_mre:.2f}px")
    print(f"  Best P3 P90 MRE : {best_mre_p3:.2f}px")
    print(f"  Checkpoints     : {run_dir}")
    print(f"{'='*60}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--p2-checkpoint", default=None,
                        help="Path to a P2 checkpoint to start P3 from")
    args = parser.parse_args()
    try:
        train(p2_checkpoint=args.p2_checkpoint)
    except KeyboardInterrupt:
        print("\nTraining interrupted by user (Ctrl+C)")
        torch.cuda.empty_cache()
        print("You can continue using the terminal normally.")
