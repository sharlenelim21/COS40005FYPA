# Disease Pattern Similarity — Methodology & Reference Values

> **This module is NOT a diagnostic tool.** It reports which known cardiac
> reference pattern (NOR / HCM / DCM) a set of measurements most resembles, with
> transparent per-metric reasoning. It does not diagnose, predict, or make any
> medical decision. Output must be interpreted by a qualified clinician.

This document backs `src/python/compute_disease_similarity.py`. It records the
methodology and the source of every reference number so the module is
academically defensible.

---

## 1. Methodology

**Chosen method: z-score weighted Euclidean distance → softmax similarity.**

For each candidate profile `p` and feature `f`, we store a literature-derived
mean `μ` and standard deviation `σ`. For a patient value `x`:

```
z_{p,f} = (x_f − μ_{p,f}) / σ_{p,f}          # standardised deviation
d_p     = sqrt( Σ_f  w_f · z_{p,f}² )        # weighted distance in z-space
s_p     = exp(−d_p / T) / Σ_q exp(−d_q / T)  # softmax → similarity %
```

Only features the patient actually provides are used; weights `w_f` are
renormalised over the available features so a missing metric never biases one
profile over another. `T` (temperature, default 1.0) controls how sharply the
closest profile dominates.

### Why this method (vs. the alternatives in the brief)

| Method | Verdict | Reason |
|--------|---------|--------|
| **z-score weighted distance + softmax** | ✅ chosen | Needs only literature mean+SD (no training data). Fully explainable — each score decomposes into per-metric contributions. Handles missing features and different metric scales correctly. |
| Mahalanobis distance | ✗ | Requires a per-disease covariance matrix, i.e. a labelled per-patient dataset we do not have. z-scoring is the diagonal-covariance special case — the honest choice here. |
| Cosine similarity | ✗ | Ignores magnitude: a mildly and a severely dilated ventricle point the same direction. Clinically wrong for volumetric data. |
| Plain (unweighted) Euclidean | ✗ | Dominated by large-magnitude features (volumes in mL vs. EF in %). Standardisation is required first — which is exactly what z-scoring does. |

The softmax gives interpretable percentages that sum to 100 ("82% NOR, 12% DCM,
6% HCM") without implying calibrated probabilities — it is a *ranked similarity*,
which matches the module's descriptive (non-diagnostic) purpose.

---

## 2. Reference profiles

Values are **population-level references**, not fitted to this application's data.
NOR = normal; HCM = hypertrophic cardiomyopathy; DCM = dilated cardiomyopathy.
Units: EF %, volumes mL, PeakGRS %, PeakGCS % (negative by convention).

Where a robust SD was not directly reported in the literature, a conservative
(wider) SD is used so the model does not over-claim confidence.

| Feature | NOR (μ, σ) | HCM (μ, σ) | DCM (μ, σ) |
|---------|-----------|-----------|-----------|
| EF (%) | 62, 6 | 68, 8 | 30, 10 |
| EDV (mL) | 142, 30 | 120, 28 | 225, 55 |
| ESV (mL) | 54, 17 | 38, 15 | 160, 55 |
| StrokeVolume (mL) | 88, 18 | 82, 18 | 65, 22 |
| PeakGRS (%) | 40, 10 | 32, 12 | 16, 8 |
| PeakGCS (%) | −20, 4 | −14, 4 | −9, 4 |

### Clinical rationale (what distinguishes each pattern)

- **NOR** — preserved EF, normal cavity size, normal strain magnitudes.
- **HCM** — preserved/supranormal EF, **small** cavity (low EDV/ESV) from wall
  thickening; radial strain often preserved early but **circumferential strain
  reduced** (less negative GCS).
- **DCM** — **large** cavity (high EDV/ESV), **low** EF, globally **reduced**
  strain magnitudes (low GRS, less-negative GCS).

### Sources to cite in the FYP report

> ⚠️ **Action for Sharlene:** replace the placeholders below with the exact
> citations you use in your literature review. The numeric values above were
> chosen to match the consensus ranges in these standard references — confirm
> each against the paper you cite and adjust `REFERENCE_PROFILES` if your chosen
> source differs.

- **Normal LV volumes & EF (CMR reference ranges):** e.g. Kawel-Boehm et al.,
  "Reference ranges (normal values) for cardiovascular magnetic resonance in
  adults and children," *JCMR* 2020. (EF, EDV, ESV, SV normal ranges.)
- **ACDC challenge population** (the dataset your project already uses for
  segmentation/landmarks) — Bernard et al., "Deep Learning Techniques for
  Automatic MRI Cardiac Multi-structures Segmentation…," *IEEE TMI* 2018.
  ACDC groups include NOR, HCM, DCM with per-group volume/EF statistics — a
  strong, project-aligned source for dataset-derived means/SDs.
- **HCM phenotype (small cavity, preserved EF, impaired strain):** e.g.
  Authors/Task Force, ESC Guidelines on cardiomyopathies (2023) and CMR strain
  studies in HCM.
- **DCM phenotype (dilated cavity, low EF, reduced strain):** ESC cardiomyopathy
  guidelines (2023) and CMR feature-tracking strain studies in DCM.
- **Strain (GRS/GCS) normal & disease values:** CMR feature-tracking normal
  reference papers (e.g. Vo et al. meta-analysis of CMR-FT normal strain).

---

## 3. Hybrid option (recommended future step)

The current profiles are **literature-derived**. Because your project already has
the **ACDC dataset with NOR/HCM/DCM labels**, the strongest defensible approach
for the final report is a **hybrid**:

1. Run the existing pipeline (segmentation → metrics → strain) over the labelled
   ACDC patients to get *this app's own* measured mean/SD per group.
2. Compare those to the literature values in the table above.
3. Use the dataset-derived μ/σ where they agree with literature (validates the
   pipeline), and note any divergence.

This turns Section 5 (validation) below into a concrete experiment.

---

## 4. Feature weights

| Feature | Weight | Why |
|---------|-------:|-----|
| EF | 1.0 | Most discriminative single metric for NOR/HCM/DCM. |
| EDV | 1.0 | Cavity size separates DCM (large) from HCM (small). |
| ESV | 0.8 | Correlated with EDV/EF; slightly down-weighted to avoid double-counting. |
| StrokeVolume | 0.5 | Derived (EDV−ESV); partly redundant, so low weight. |
| PeakGRS | 0.6 | Supporting evidence; more sensitive to this app's measurement noise. |
| PeakGCS | 0.6 | Supporting evidence; same noise caveat. |

Weights are a modelling choice, documented here for transparency. They are
renormalised at run time over whichever features are present.

---

## 5. Validation methods (suitable for an FYP)

1. **Synthetic sanity checks** (implemented in `scripts/check_disease_similarity.js`):
   feed archetypal NOR/HCM/DCM inputs and assert the correct pattern wins.
2. **Leave-one-out on ACDC** (recommended): for each labelled ACDC patient, run
   the pipeline, compute similarity, and check whether the top pattern matches
   the true label. Report a confusion matrix and top-1 agreement rate. Frame it
   as "pattern-match agreement," **not** diagnostic accuracy.
3. **Sensitivity analysis:** vary weights and temperature `T`; show the ranking
   is stable for clearly-separated cases and only shifts for borderline ones.
4. **Ablation:** drop each feature and observe the effect on agreement — quantifies
   how much each metric contributes.

---

## 6. Non-diagnostic disclaimer (shipped in every output)

> "This is a similarity assessment, not a diagnosis. It reports which known
> cardiac reference pattern the measurements most resemble and must be
> interpreted by a qualified clinician alongside the full clinical picture."
