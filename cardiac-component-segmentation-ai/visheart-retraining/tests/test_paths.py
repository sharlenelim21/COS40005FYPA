"""The data root and the paths derived from it (plan linux-and-cpu-support, Task 1)."""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402

TOOLS = Path(__file__).resolve().parents[1]


class DataRoot(unittest.TestCase):
    def test_the_environment_variable_wins_everywhere(self):
        self.assertEqual(common.default_unet_root({"VISHEART_UNET_ROOT": "/srv/visheart"}, "nt"), Path("/srv/visheart"))
        self.assertEqual(common.default_unet_root({"VISHEART_UNET_ROOT": "/srv/visheart"}, "posix"), Path("/srv/visheart"))

    def test_windows_keeps_its_drive_and_linux_uses_the_home_folder(self):
        self.assertEqual(common.default_unet_root({}, "nt"), Path(r"E:\Jy\Unet"))
        self.assertEqual(common.default_unet_root({}, "posix", home="/home/jy"), Path("/home/jy/visheart-unet"))

    def test_the_training_copy_and_the_frozen_index_follow_the_root_unless_named(self):
        root = Path("/srv/visheart")
        self.assertEqual(common.default_v2_root(root, {}),
                         root / "2023_FRGS_HeartDigitalTwin" / "segmentation" / "v2-unet")
        self.assertEqual(common.default_v2_root(root, {"VISHEART_V2_ROOT": "/data/v2"}), Path("/data/v2"))
        self.assertEqual(common.default_frozen_index(root, {}), root / "versions" / "frozen_slices.npz")
        self.assertEqual(common.default_frozen_index(root, {"VISHEART_FROZEN_SLICES": "/data/f.npz"}), Path("/data/f.npz"))

    def test_the_models_folder_is_the_repositorys_own(self):
        self.assertEqual(common.REPO_MODELS, TOOLS.parent / "visheart-inference-gpu" / "app" / "models")

    @unittest.skipUnless(os.name == "nt" and not any(
        os.environ.get(name) for name in ("VISHEART_UNET_ROOT", "VISHEART_V2_ROOT", "VISHEART_FROZEN_SLICES")),
        "the unchanged Windows defaults")
    def test_this_windows_machine_keeps_every_old_default(self):
        import frozen_guard
        import versions
        self.assertEqual(versions.DEFAULT_REGISTRY, r"E:\Jy\Unet\versions\registry.json")
        self.assertEqual(versions.DEFAULT_MANIFEST, r"E:\Jy\Unet\versions\frozen_holdout.json")
        self.assertEqual(Path(versions.DEFAULT_ORIGINAL), TOOLS.parent / "visheart-inference-gpu" / "app" / "models" / "unet.pth")
        self.assertEqual(Path(versions.DEFAULT_ACTIVE_SLOT),
                         TOOLS.parent / "visheart-inference-gpu" / "app" / "models" / "active" / "unet.pth")
        self.assertEqual(frozen_guard.DEFAULT_INDEX, Path(r"E:\Jy\Unet\versions\frozen_slices.npz"))
        self.assertEqual(common.DEFAULT_V2_ROOT, Path(r"E:\Jy\Unet\2023_FRGS_HeartDigitalTwin\segmentation\v2-unet"))


if __name__ == "__main__":
    unittest.main()
