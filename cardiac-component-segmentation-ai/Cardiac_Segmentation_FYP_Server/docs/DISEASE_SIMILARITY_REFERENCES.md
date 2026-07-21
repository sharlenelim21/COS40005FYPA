# Disease Pattern Similarity — Methodology & Reference Values

> **This module is NOT a diagnostic tool.** It reports which known cardiac
> reference pattern (NOR / HCM / DCM) a set of measurements most resembles, with
> transparent per-metric reasoning. It does not diagnose, predict, or make any
> medical decision. Output must be interpreted by a qualified clinician.

This document backs `src/python/compute_disease_similarity.py`. It records the
methodology and the source of every reference number so the module is
academically defensible.

---

## 0. Reference ranges actually used (quick view)

These are the exact `(mean, ±SD)` profiles the module compares each patient
against. A "range" here is a **mean with a spread** (not a hard min–max): the
module scores similarity by how many SDs a patient's value sits from each group's
mean — closer = more similar. Full provenance and caveats are in §2.

| Metric | **NOR** (normal) | **HCM** (hypertrophic) | **DCM** (dilated) |
|--------|------------------|------------------------|-------------------|
| **EF** (%) | 60.3 ± 5.1 | 67.4 ± 8.9 | 17.9 ± 7.7 |
| **EDV** (mL) | 130.1 ± 26.4 | 129.1 ± 35.2 | 284.6 ± 47.8 |
| **ESV** (mL) | 51.6 ± 17 | 42.1 ± 18 | 233.6 ± 51 |
| **Stroke Volume** (mL) | 78.5 ± 31.4 | 87.0 ± 39.5 | 51.0 ± 69.9 |
| **Peak GRS** (%) | 40 ± 10 | 32 ± 12 | 16 ± 8 |
| **Peak GCS** (%) | −20 ± 4 | −14 ± 4 | −9 ± 4 |

**Sources at a glance:** EF + EDV = ACDC dataset group statistics (the same
dataset the segmentation is built on); ESV = derived from EF and EDV
(`ESV = EDV × (1 − EF/100)`); Stroke Volume = EDV − ESV; Peak GRS/GCS = published
CMR feature-tracking literature. Volume/EF SDs and derived means are solid; the
starred SDs in §2 (ESV/SV spread) and the strain values are the softer numbers to
confirm before the final report.

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

Values are **population-level references**, not fitted to individual patients.
NOR = normal; HCM = hypertrophic cardiomyopathy; DCM = dilated cardiomyopathy.
Units: EF %, volumes mL, PeakGRS %, PeakGCS % (negative by convention).

**EF and EDV** are the **ACDC cohort group statistics** (mean ± SD) reported for
the ACDC dataset — the same dataset this project's segmentation pipeline is built
on. **ESV means are DERIVED**, not published: the ACDC cohort table reports LV
end-diastolic volume (= EDV) and EF but does **not** publish ESV, so ESV mean is
computed from the identity `ESV = EDV × (1 − EF/100)`. **StrokeVolume** = EDV −
ESV of the group means. **PeakGRS / PeakGCS** are literature CMR feature-tracking
values (see below).

| Feature | NOR (μ, σ) | HCM (μ, σ) | DCM (μ, σ) | Source |
|---------|-----------|-----------|-----------|--------|
| EF (%) | 60.3, 5.1 | 67.4, 8.9 | 17.9, 7.7 | ACDC group stats (published) |
| EDV (mL) | 130.1, 26.4 | 129.1, 35.2 | 284.6, 47.8 | ACDC group stats (published) |
| ESV (mL) | 51.6, 17* | 42.1, 18* | 233.6, 51* | **derived** = EDV × (1 − EF/100) |
| StrokeVolume (mL) | 78.5, 31.4* | 87.0, 39.5* | 51.0, 69.9* | derived (EDV − ESV) |
| PeakGRS (%) | 40, 10 | 32, 12 | 16, 8 | CMR-FT literature |
| PeakGCS (%) | −20, 4 | −14, 4 | −9, 4 | CMR-FT literature |

> **\* Derived-value caveat (read before citing).** The published ACDC cohort
> table gives EDV and EF only. The **ESV and StrokeVolume MEANS above are exact
> consequences** of those (EF's definition), so they are safe. But their
> **standard deviations (marked \*) are estimates**, not published values —
> ACDC does not report ESV/SV SDs per group. They are set to plausible widths so
> the model does not over-claim confidence. If you need published ESV/SV
> dispersion, cite a source that reports it directly (see the search prompt
> Sharlene has) and replace the starred SDs.
>
> **Note on StrokeVolume SD:** the DCM StrokeVolume σ (69.9) is inflated because
> it propagates the EDV and ESV SDs in quadrature. StrokeVolume carries a low
> weight (0.5) and is partly redundant with EDV/ESV, so this does not materially
> affect the ranking.

### Clinical grounding: the official ACDC diagnostic criteria (citable)

The NOR/HCM/DCM profiles are consistent with the **official ACDC group-definition
criteria**, published on the ACDC challenge database page. These are verifiable
threshold rules (unlike the exact cohort mean/SD table, whose precise paper-source
should still be confirmed), and are the primary **clinical justification** cited
for why each profile is shaped the way it is:

| Group | Official ACDC defining criteria |
|-------|--------------------------------|
| **NOR** | LV EF > 50 %; LV EDV < 90 mL/m² (men) / < 80 mL/m² (women); RV vol < 100 mL/m²; RV EF > 40 %. |
| **DCM** | LV EF < 40 %; LV EDV > 100 mL/m²; wall thickness < 12 mm. |
| **HCM** | LV mass > 110 g/m²; ≥ several segments with wall thickness > 15 mm in diastole; **normal EF**. |
| **MINF** | LV EF < 40 % with abnormal segmental contraction. *(not modelled — excluded.)* |
| **RV/ARV** | RV cavity vol > 110 mL/m² or RV EF < 40 %. *(not modelled — excluded.)* |

> These thresholds use **BSA-indexed** volumes (mL/m²); our profiles use absolute
> mL (matching what the app measures), so the criteria are used as *directional
> grounding* — e.g. "DCM = low EF + dilated cavity" → low-EF/high-EDV DCM profile;
> "HCM = normal EF + thick wall (small cavity)" → high-EF/low-EDV HCM profile —
> not as literal cut-offs inside the similarity computation.
>
> **Source:** *Databases — Automated Cardiac Diagnosis Challenge (ACDC)*,
> CREATIS, INSA-Lyon. <https://www.creatis.insa-lyon.fr/Challenge/acdc/databases.html>.
> Cite this page for the **group criteria**; cite Bernard et al. 2018 (ref 1) for
> the **dataset provenance**. The criteria are challenge definitions from one
> clinical cohort — appropriate for a prototype comparator, **not** a universal
> diagnostic guideline.

### Independent check against our own ACDC ground-truth masks

`scripts/derive_acdc_reference_ranges.py` recomputes EF **from this project's own
ACDC ground-truth segmentation masks** (labels 0=bg,1=RV,2=MYO,3=LVC; EF is a
ratio so it is independent of the masks' stripped voxel spacing). Measured EF:

| Group | Our masks (n=20) | Published ACDC |
|-------|------------------|----------------|
| NOR | 71.2 ± 5.5 % | 60.3 ± 5.1 % |
| HCM | 77.5 ± 8.9 % | 67.4 ± 8.9 % |
| DCM | 40.8 ± 22.7 % | 17.9 ± 7.7 % |

The **direction is confirmed** (HCM highest, NOR middle, DCM lowest). The mask
EF runs higher, and DCM is noisy (σ 22.7, range 9.8–77.8 %), because the bundled
masks (a) lost their voxel spacing and (b) cover only a **partial slice stack**
over just **two frames** — so per-patient whole-heart EF is unreliable from them.
We therefore adopt the **published ACDC statistics** for the profiles and use the
mask computation only as a directional sanity check. This is documented honestly
as a limitation rather than presenting the noisy mask EF as the reference.

### Clinical rationale (what distinguishes each pattern)

- **NOR** — preserved EF, normal cavity size, normal strain magnitudes.
- **HCM** — preserved/supranormal EF, **small** cavity (low EDV/ESV) from wall
  thickening; radial strain often preserved early but **circumferential strain
  reduced** (less negative GCS).
- **DCM** — **large** cavity (high EDV/ESV), **low** EF, globally **reduced**
  strain magnitudes (low GRS, less-negative GCS).

### Citations

1. **Bernard O, Lalande A, Zotti C, et al.** "Deep Learning Techniques for
   Automatic MRI Cardiac Multi-Structures Segmentation and Diagnosis: Is the
   Problem Solved?" *IEEE Transactions on Medical Imaging* 37(11):2514–2525,
   2018. DOI: 10.1109/TMI.2018.2837502. — Defines the **ACDC dataset** and its
   NOR/HCM/DCM/MINF/RV groups. ACDC challenge site:
   <https://www.creatis.insa-lyon.fr/Challenge/acdc/>.
   > ⚠️ **Verify the exact table source.** The per-group **LV-Vol(=EDV) / EF**
   > statistics used here (NOR 130.1±26.4 / 60.3±5.1; HCM 129.1±35.2 / 67.4±8.9;
   > DCM 284.6±47.8 / 17.9±7.7) are the standard "ACDC cohort characteristics"
   > table. This exact table (with RV-Vol, Myo-Vol, RV/LV ratio columns) is often
   > reproduced in **secondary papers analysing ACDC**, and may not appear
   > verbatim in Bernard 2018 itself. **Confirm which paper's table you cite**
   > before the final report, and cite that paper for the numbers (Bernard 2018
   > remains the correct citation for the *dataset*). **ESV is NOT in this table**
   > — the ESV means here are derived as EDV × (1 − EF/100); their SDs are
   > estimates. See the derived-value caveat in §2.
2. **Kawel-Boehm N, Hetzel SJ, Ambale-Venkatesh B, et al.** "Reference ranges
   ('normal values') for cardiovascular magnetic resonance (CMR) in adults and
   children: 2020 update." *Journal of Cardiovascular Magnetic Resonance*
   22:87, 2020. DOI: 10.1186/s12968-020-00683-3. — Corroborating normal CMR LV
   volume/EF reference ranges.
   PMC (open access): <https://pmc.ncbi.nlm.nih.gov/articles/PMC7724938/>.
3. **Arbelo E, Protonotarios A, Gimeno JR, et al. (ESC Task Force).** "2023 ESC
   Guidelines for the management of cardiomyopathies." *European Heart Journal*
   44(37):3503–3626, 2023. DOI: 10.1093/eurheartj/ehad194. — Clinical
   definitions of the HCM and DCM phenotypes.
4. **CMR feature-tracking strain reference values** (for PeakGRS / PeakGCS):
   e.g. Vo HQ, Marwick TH, Negishi K. "MRI-derived myocardial strain measures in
   normal subjects." *JACC: Cardiovascular Imaging* / meta-analyses of CMR-FT
   normal strain. — **Action for Sharlene:** confirm the exact strain paper you
   cite and update the PeakGRS/PeakGCS numbers if your source differs; these are
   the only remaining literature-placeholder values.

---

## 3. Provenance summary (what is measured vs. cited)

| Feature block | Provenance | Fully citable? |
|---------------|-----------|----------------|
| EF, EDV (means + SDs) | ACDC cohort group stats (published table) | ✅ yes — confirm exact paper |
| ESV mean | Derived: EDV × (1 − EF/100) | ✅ follows from EF definition |
| ESV SD, StrokeVolume SD | Estimated (not published) | ⚠️ replace if a source gives them |
| StrokeVolume mean | Derived (EDV − ESV of means) | ✅ yes |
| EF direction check | Measured from our own ACDC ground-truth masks | ✅ our own result |
| PeakGRS, PeakGCS | CMR-FT literature placeholders | ⚠️ confirm citation |

**Future step (strongest):** obtain the *original* ACDC NIfTIs with intact voxel
spacing and full slice coverage, then recompute EDV/ESV/EF *and* strain through
this app's own pipeline to produce fully self-derived ranges. The bundled masks
here have stripped spacing (1×1×1 mm) and partial coverage, which is why volumes
are taken from the published statistics rather than measured locally.

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
