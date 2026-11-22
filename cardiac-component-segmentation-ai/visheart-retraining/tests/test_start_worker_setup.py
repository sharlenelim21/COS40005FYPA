"""start-retraining-worker.bat must not call a half-finished setup "set up" (2026-11-21, a test desktop).

setup-training-pc.ps1 creates the Python environment first and writes retraining.local.bat (where the training data
is) last. When it stopped in between, .venv existed, so the bat started the worker, which fell back to the default
data folder (E:\\Jy\\Unet, the original PC) and the page said "The model registry is missing". Because the bat did
not report "not set up" (exit 2), start.ps1 never ran the setup again."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform == "win32", "a Windows batch file")
class HalfFinishedSetup(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.tools = root / "visheart-retraining"
        self.tools.mkdir()
        for name in ("start-retraining-worker.bat", "retraining-env.bat"):
            shutil.copy(TOOLS / name, self.tools / name)
        scripts = root / "venv" / "Scripts"
        scripts.mkdir(parents=True)
        for exe in ("python.exe", "pythonw.exe"):  # never run: the bat must stop before using them
            (scripts / exe).write_bytes(b"")
        self.data = root / "data"
        self.data.mkdir()
        self.env = dict(os.environ, VISHEART_RETRAINING_VENV=str(root / "venv"), VISHEART_UNET_ROOT=str(self.data))

    def tearDown(self):
        self.tmp.cleanup()

    def run_bat(self):
        return subprocess.run(["cmd.exe", "/c", str(self.tools / "start-retraining-worker.bat")], env=self.env,
                              capture_output=True, text=True, timeout=60)

    def test_environment_without_training_data_is_not_set_up(self):
        result = self.run_bat()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("not set up", result.stdout)

    def test_training_data_without_this_pcs_setup_file_is_not_set_up(self):
        # A copied or freshly installed pack has a registry, but its paths are the packing PC's until
        # setup-training-pc.ps1 rewrites them; it writes retraining.local.bat only after that.
        (self.data / "versions").mkdir()
        (self.data / "versions" / "registry.json").write_text("{}", encoding="utf-8")
        result = self.run_bat()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("not set up", result.stdout)

    def test_without_settings_it_looks_beside_itself_not_on_one_developer_pc(self):
        env = {k: v for k, v in self.env.items() if k not in ("VISHEART_UNET_ROOT", "VISHEART_RETRAINING_VENV")}
        probe = self.tools / "probe.bat"
        probe.write_text('@echo off\r\ncall "%~dp0retraining-env.bat"\r\necho DATA=%TRAINING_DATA%\r\n', encoding="ascii")
        result = subprocess.run(["cmd.exe", "/c", str(probe)], env=env, capture_output=True, text=True, timeout=60)
        self.assertIn("DATA=" + str(self.tools.parent / "visheart-training-data"), result.stdout)


if __name__ == "__main__":
    unittest.main()
