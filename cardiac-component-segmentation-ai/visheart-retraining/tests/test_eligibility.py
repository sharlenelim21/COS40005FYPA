"""eligibility.py against the examples the server's export is tested on (tests/fixtures/training_eligibility.json):
the training job's own check must decide every case and slice as the export does, and count what the page shows."""
import json
import sys
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import build_training_volumes as btv  # noqa: E402
import eligibility  # noqa: E402

FIXTURE = json.loads((Path(__file__).resolve().parent / "fixtures" / "training_eligibility.json").read_text("utf-8"))


class AgreesWithTheExport(unittest.TestCase):
    def test_case_rules(self):
        for rule in FIXTURE["caseRules"]:
            with self.subTest(rule["name"]):
                # The facts the export sends the builder (training_eligibility.test.ts checks it sends these).
                facts = {"isTemplate": rule["isTemplate"], "fromTemplate": rule["fromTemplate"],
                         "aiResult": rule["ai"] == "same_model", "heldOut": rule["heldOut"]}
                self.assertEqual(eligibility.case_exclusion(facts), rule["expected"])

    def test_an_unpublished_template_with_its_own_unet_result_and_edits_never_trains(self):
        unpublished = {"isTemplate": False, "fromTemplate": True, "aiResult": True, "heldOut": False}
        self.assertEqual(eligibility.case_exclusion(unpublished), "template_project")
        self.assertIsNone(eligibility.case_exclusion({**unpublished, "fromTemplate": False}))  # the origin alone

    def test_slice_rules(self):
        frames = [{"frameindex": 0, "slices": [{"sliceindex": 0, "segmentationmasks": []}]}]
        for rule in FIXTURE["sliceRules"]:
            with self.subTest(rule["name"]):
                tracked = {"frameindex": 0, "sliceindex": 0, **rule["slice"]}
                chosen, skipped = btv.select_slices([tracked], frames, eligibility.MIN_PIXELS, eligibility.MIN_SHARE)
                reasons = [reason for reason, n in skipped.items() if n]
                self.assertEqual(None if chosen else reasons[0], rule["expected"])
                self.assertLessEqual(len(reasons), 1)

    def test_the_training_job_counts_what_the_page_shows(self):
        dry, expected = FIXTURE["dryRun"], FIXTURE["expected"]
        self.assertEqual(dry["counts"]["projects"], expected["projects"])
        self.assertEqual(eligibility.qualifying(dry), expected["slices"])
        self.assertEqual(eligibility.too_little(dry["counts"]["projects"], eligibility.qualifying(dry)) is None,
                         expected["trainingAllowed"])
        self.assertNotIn("p-template", {candidate["projectId"] for candidate in dry["candidates"]})

    def test_without_the_export_s_facts_nothing_is_assumed(self):
        self.assertEqual(eligibility.case_exclusion(None), "unknown_case")
        self.assertEqual(eligibility.case_exclusion({"isTemplate": False}), "no_ai_result")

    def test_the_gate_matches_the_page(self):
        # visheart-frontend/src/components/extend-training/logic.ts MIN_PROJECTS, RECOMMENDED_PROJECTS, FEW_SLICES
        logic = (TOOLS.parent / "visheart-frontend" / "src" / "components" / "extend-training" / "logic.ts").read_text("utf-8")
        for name in ("MIN_PROJECTS", "RECOMMENDED_PROJECTS", "FEW_SLICES"):
            self.assertIn(f"export const {name} = {getattr(eligibility, name)};", logic)


if __name__ == "__main__":
    unittest.main()
