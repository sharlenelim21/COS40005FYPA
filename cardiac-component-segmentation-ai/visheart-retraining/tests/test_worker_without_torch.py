"""The training service on a PC where PyTorch cannot load (2026-11-21, a test desktop: "OSError: [WinError 1114] ...
c10.dll"). worker.py imported PyTorch for every command, so even "--stop" crashed with exit 1, and stop.bat took
that exit code for "a training is in progress" and asked whether to stop it.

These tests run the real worker.py in a child process with a fake "torch" that fails the same way."""
import os
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class WorkerWithoutTorch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        fake = root / "fake" / "torch"
        fake.mkdir(parents=True)
        (fake / "__init__.py").write_text(
            'raise OSError(\'[WinError 1114] A dynamic link library (DLL) initialization routine failed. '
            'Error loading "c10.dll" or one of its dependencies.\')\n', encoding="utf-8")
        self.data = root / "data"
        self.env = dict(os.environ, PYTHONPATH=str(root / "fake"), VISHEART_UNET_ROOT=str(self.data))
        self.port = free_port()

    def tearDown(self):
        self.tmp.cleanup()

    def run_worker(self, *args):
        return subprocess.run([sys.executable, str(TOOLS / "worker.py"), "--port", str(self.port), *args],
                              env=self.env, capture_output=True, text=True, timeout=60)

    def test_stop_says_not_running_instead_of_crashing(self):
        result = self.run_worker("--stop")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("not running", result.stdout)

    def test_check_running_works_without_torch(self):
        result = self.run_worker("--check-running")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("not running", result.stdout)
        self.assertNotIn("Traceback", result.stderr)

    def test_serving_explains_why_it_cannot_start(self):
        result = self.run_worker()
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertIn("PyTorch", result.stdout)
        self.assertIn("WinError 1114", result.stdout)
        self.assertNotIn("Traceback", result.stderr)
        # start-retraining-worker.bat points the user at this log
        log = (self.data / "jobs" / "worker.log").read_text(encoding="utf-8")
        self.assertIn("WinError 1114", log)


if __name__ == "__main__":
    unittest.main()
