import nibabel as nib
import numpy as np

mask = nib.load("data/lv-landmark/Training/masks/DET0000101.nii.gz").get_fdata()

print("Unique labels:", np.unique(mask))

# check how many RV pixels exist
print("RV pixels:", np.sum(mask == 2))
print("LV pixels:", np.sum(mask == 1))