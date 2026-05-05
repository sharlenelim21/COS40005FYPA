import numpy as np


def generate_heatmap(height, width, cx, cy, sigma=8):
    x = np.arange(0, width,  1, float)
    y = np.arange(0, height, 1, float)[:, np.newaxis]
    heatmap = np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma ** 2))
    heatmap = heatmap / (heatmap.max() + 1e-8)
    return heatmap.astype(np.float32)


def coords_to_heatmaps(coords, image_shape, sigma=8):
    """
    coords: [x1, y1, x2, y2]
    returns: [2, H, W] float32 in [0, 1]
    """
    H, W = image_shape
    x1, y1, x2, y2 = coords
    h1 = generate_heatmap(H, W, x1, y1, sigma)
    h2 = generate_heatmap(H, W, x2, y2, sigma)
    return np.stack([h1, h2], axis=0)