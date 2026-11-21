"""Which saved corrections may train the UNet, and how much data a training needs (option C, 2026-11-22).

The same rule as the server's export, which decides first (Cardiac_Segmentation_FYP_Server/src/services/
training_eligibility.ts and training_selection.ts editTooSmall). This copy is the training job's own check:
build_training_volumes.py refuses a case or a slice the rule rules out, and pipeline.py gates on the export's counts.
tests/fixtures/training_eligibility.json holds examples that the server's tests and these tests both check.

- A template project never trains (it stays in the held-out comparison).
- A case without its own model's AI result never trains: a missing AI result is never read as an empty mask.
- A slice its AI result does not hold ("aiBaseline": false) is skipped; the rest of the case stays.
- A measured slice counts when its edit is at least min_share (2%) of the heart in the AI result and the correction
  together, or a structure was added or removed; a slice nobody measured falls back to min_pixels (20).

It imports nothing heavy, so the builder can use it inside the app container and its tests need no torch.
"""

MIN_SHARE, MIN_PIXELS = 0.02, 20
MIN_PROJECTS = 5           # below this, training does not start; a project counts only with a qualifying slice
RECOMMENDED_PROJECTS = 7   # below this, the page warns
FEW_SLICES = 10            # below this, the page warns: each correction is repeated more often (about 147x at 5)


def case_exclusion(facts):
    """Why a case may not train, or None. `facts` is what the export sends ({"isTemplate", "aiResult", "heldOut"});
    without them nothing is assumed, and the case does not train."""
    if not isinstance(facts, dict):
        return "unknown_case"
    if facts.get("isTemplate") and not facts.get("heldOut"):
        return "template_project"
    if facts.get("aiResult") is not True:
        return "no_ai_result"
    return None


def slice_skip(tracked_slice, min_pixels=MIN_PIXELS, min_share=MIN_SHARE):
    """Why a tracked slice's edit may not train ("no_ai_baseline", "below_min_share", "below_min_pixels"), or None."""
    if tracked_slice.get("aiBaseline") is False:
        return "no_ai_baseline"
    share = tracked_slice.get("editShare")
    if share is not None:
        return None if share >= min_share or tracked_slice.get("structureChanged") else "below_min_share"
    return None if tracked_slice.get("pixelsChanged", 0) >= min_pixels else "below_min_pixels"


def qualifying(dry):
    """The slices a dry run would train: every candidate's qualifying slices."""
    return sum(int(candidate["qualifyingSlices"]) for candidate in dry["candidates"])


def too_little(projects, slices):
    """The refusal when a training set has too few projects, or None. The slice count is only reported."""
    if projects >= MIN_PROJECTS:
        return None
    return (f"Too little data to train: {projects} project(s) and {slices} slice(s) qualify. Training needs at least "
            f"{MIN_PROJECTS} corrected projects ({RECOMMENDED_PROJECTS} are recommended); more patients help more than "
            "more slices.")
