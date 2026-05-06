import matplotlib.pyplot as plt
import numpy as np
import os


def save_epoch_grid(images, pred_coords_list, gt_coords_list, epoch, save_dir, n_samples=8):
    n   = min(n_samples, len(images))
    fig, axes = plt.subplots(1, n, figsize=(3 * n, 3.5))
    if n == 1:
        axes = [axes]

    for i in range(n):
        ax  = axes[i]
        img = images[i]
        pc  = pred_coords_list[i]
        gc  = gt_coords_list[i]

        ax.imshow(img, cmap="gray", aspect="auto")

        # GT — small solid green dots, thin black edge
        ax.scatter([gc[0], gc[2]], [gc[1], gc[3]],
                   c="lime", s=20, linewidths=0.5,
                   edgecolors="black", zorder=3, label="GT")

        # Pred — small solid red dots, thin black edge
        ax.scatter([pc[0], pc[2]], [pc[1], pc[3]],
                   c="red", s=20, linewidths=0.5,
                   edgecolors="black", zorder=3, label="Pred")

        # dashed lines between matched pairs
        ax.plot([gc[0], pc[0]], [gc[1], pc[1]], "w--", lw=0.6, alpha=0.6)
        ax.plot([gc[2], pc[2]], [gc[3], pc[3]], "w--", lw=0.6, alpha=0.6)

        mre_i = 0.5 * (
            np.linalg.norm([pc[0]-gc[0], pc[1]-gc[1]])
            + np.linalg.norm([pc[2]-gc[2], pc[3]-gc[3]])
        )
        ax.set_title(f"MRE={mre_i:.1f}px", fontsize=8)
        ax.axis("off")

    axes[-1].legend(loc="lower right", fontsize=7, markerscale=0.8)
    fig.suptitle(f"Epoch {epoch}", fontsize=10, y=1.01)
    plt.tight_layout()

    os.makedirs(save_dir, exist_ok=True)
    out = os.path.join(save_dir, f"epoch_{epoch:03d}_grid.png")
    plt.savefig(out, bbox_inches="tight", dpi=150)
    plt.close()


def save_training_curve(history, save_dir):
    epochs     = [h["epoch"]      for h in history]
    train_loss = [h["train_loss"] for h in history]
    val_loss   = [h["val_loss"]   for h in history]
    mre        = [h["mre"]        for h in history]
    sdr        = [h["sdr"]        for h in history]
    sigma      = [h["sigma"]      for h in history]

    fig, axes = plt.subplots(1, 3, figsize=(15, 4))

    axes[0].plot(epochs, train_loss, label="Train")
    axes[0].plot(epochs, val_loss,   label="Val")
    axes[0].set_title("Loss"); axes[0].legend(); axes[0].grid(True)

    axes[1].plot(epochs, mre, color="orange", label="MRE (px)")
    ax2 = axes[1].twinx()
    ax2.plot(epochs, sdr, color="green", linestyle="--", label="SDR")
    axes[1].set_title("MRE & SDR")
    axes[1].legend(loc="upper right"); ax2.legend(loc="lower right")
    axes[1].grid(True)

    axes[2].plot(epochs, sigma, color="purple")
    axes[2].set_title("Sigma Curriculum")
    axes[2].set_ylabel("sigma"); axes[2].grid(True)

    plt.tight_layout()
    out = os.path.join(save_dir, "training_curve.png")
    plt.savefig(out, dpi=120)
    plt.close()