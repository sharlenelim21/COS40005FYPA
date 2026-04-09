# ACDC Extraction Comparison (Sprint 2)

## Run Configuration

- Generated at: 2026-04-05T10:06:04.877702Z
- Model: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\models\fourd_model_epoch_250.pth`
- Num iterations: 120
- Resolution: 160
- Process all frames: False
- ED frame index: 0

## Per-Sample Results

### patient001_4d

- Mesh: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient001_4d\patient001_4d.nii_4D_ED00.obj`
- Point cloud: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient001_4d\patient001_4d.nii_4D_ED00_pointcloud.npy`
- SDF: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient001_4d\patient001_4d.nii_4D_ED00_sdf.npy`
- Sign report: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient001_4d\patient001_4d.nii_4D_ED00_sdf_sign_check.json`
- Point count: 309145
- Point bbox min: [-0.735849, -0.710692, -0.974843]
- Point bbox max: [0.710692, 0.672956, 0.886792]
- Point centroid: [-0.008068, -0.052322, -0.162286]
- SDF shape: [160, 160, 160]
- SDF min/max: -0.061017 / 0.999683
- SDF mean/std: 0.400749 / 0.354541
- Near-surface fraction (|sdf|<0.005): 0.033988
- Sign check: sign_convention_ok=True, inside_sdf=-0.061016812920570374, outside_sdf=0.9996827840805054
- Runtime (s): 13.11

### patient002_4d

- Mesh: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient002_4d\patient002_4d.nii_4D_ED00.obj`
- Point cloud: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient002_4d\patient002_4d.nii_4D_ED00_pointcloud.npy`
- SDF: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient002_4d\patient002_4d.nii_4D_ED00_sdf.npy`
- Sign report: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient002_4d\patient002_4d.nii_4D_ED00_sdf_sign_check.json`
- Point count: 323590
- Point bbox min: [-0.710692, -0.710692, -0.962264]
- Point bbox max: [0.685534, 0.698113, 0.91195]
- Point centroid: [-0.01324, -0.036022, -0.16323]
- SDF shape: [160, 160, 160]
- SDF min/max: -0.057015 / 0.999771
- SDF mean/std: 0.406098 / 0.357369
- Near-surface fraction (|sdf|<0.005): 0.036975
- Sign check: sign_convention_ok=True, inside_sdf=-0.05701521039009094, outside_sdf=0.9997714757919312
- Runtime (s): 11.21

### patient003_4d

- Mesh: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient003_4d\patient003_4d.nii_4D_ED00.obj`
- Point cloud: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient003_4d\patient003_4d.nii_4D_ED00_pointcloud.npy`
- SDF: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient003_4d\patient003_4d.nii_4D_ED00_sdf.npy`
- Sign report: `C:\Users\-Sharlene-\OneDrive - Swinburne Sarawak\Documents\GitHub\COS40005FYPA\cardiac-component-segmentation-ai\visheart-inference-gpu\app\_acdc_eval\patient003_4d\patient003_4d.nii_4D_ED00_sdf_sign_check.json`
- Point count: 313268
- Point bbox min: [-0.710692, -0.72327, -0.987421]
- Point bbox max: [0.698113, 0.685534, 0.91195]
- Point centroid: [-0.007635, -0.059672, -0.166033]
- SDF shape: [160, 160, 160]
- SDF min/max: -0.054249 / 0.999638
- SDF mean/std: 0.402191 / 0.357269
- Near-surface fraction (|sdf|<0.005): 0.033971
- Sign check: sign_convention_ok=True, inside_sdf=-0.054248929023742676, outside_sdf=0.9996380805969238
- Runtime (s): 12.60

## Pairwise Point Cloud Distance

Lower Chamfer-L2 means more similar point clouds.

- patient001_4d vs patient002_4d: chamfer_l2=0.096072
- patient001_4d vs patient003_4d: chamfer_l2=0.097358
- patient002_4d vs patient003_4d: chamfer_l2=0.102209

## Qualitative Visual Evidence (3 ACDC Samples)

Visuals were reviewed from `app/_acdc_eval/visuals/` for patient001_4d, patient002_4d, and patient003_4d.

### Point Cloud (Projections)

Files used:

- `app/_acdc_eval/visuals/patient001_4d_pointcloud_views.png`
- `app/_acdc_eval/visuals/patient002_4d_pointcloud_views.png`
- `app/_acdc_eval/visuals/patient003_4d_pointcloud_views.png`

Observations:

- Across all 3 samples, XY/XZ/YZ projections preserve a consistent heart-like outer shell and inner cavity pattern.
- Shapes are similar across patients, with expected anatomical variation (minor orientation/contour differences).
- Point clouds show useful geometric detail but contain scattered interior points/noise, which can make direct deformation constraints less stable without additional processing.

### SDF (Central Slices)

Files used:

- `app/_acdc_eval/visuals/patient001_4d_sdf_slices.png`
- `app/_acdc_eval/visuals/patient002_4d_sdf_slices.png`
- `app/_acdc_eval/visuals/patient003_4d_sdf_slices.png`

Observations:

- Sign convention is consistent for all 3 samples (`sign_convention_ok=True` in each sign report).
- Central slices show smooth, continuous signed distance transitions with stable myocardium/ring-like structure.
- SDF fields look less noisy than point clouds and provide volumetric inside/outside information, which is useful for robust deformation optimization.

## Sprint 2 Recommendation (Point Cloud vs SDF)

### Decision

Use **SDF** as the primary representation for generic model deformation in Sprint 2. Keep point clouds as a secondary artifact for fast qualitative QA and visualization.

### Why SDF is more suitable

- Provides a dense volumetric field with explicit inside/outside sign, not just surface samples.
- Better supports stable optimization objectives (distance-to-surface and smooth gradients in nearby regions).
- More robust to local sampling irregularities than raw point clouds.
- Visual review across 3 ACDC samples shows consistent structure and sign behavior.

### Trade-offs

- SDF uses more memory and compute than point clouds.
- At fixed grid resolution, SDF can smooth fine details.

### Mitigation

- Keep current `resolution=160` for Sprint 2 baseline and only increase if deformation quality requires it.
- Continue generating point cloud projections for fast artifact detection during QA.

