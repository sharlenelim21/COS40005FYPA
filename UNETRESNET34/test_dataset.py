from dataset.landmark_dataset import LandmarkDataset

dataset = LandmarkDataset(
    image_dir="data/lv-landmark/Training/images",
    mask_dir="data/lv-landmark/Training/masks"
)

img, heatmap, coords = dataset[0]

print(img.shape)       # (1, H, W)
print(heatmap.shape)   # (2, H, W)
print(coords.shape)    # (4,)
