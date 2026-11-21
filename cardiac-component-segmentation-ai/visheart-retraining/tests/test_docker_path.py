"""Where the training service finds Docker when it is not on PATH: from Windows' own folder variables, not a fixed
C:\\Program Files (Windows can live on another drive)."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pipeline  # noqa: E402


class DockerPath(unittest.TestCase):
    def test_docker_on_path_wins(self):
        with mock.patch.object(pipeline.shutil, "which", return_value=r"Q:\bin\docker.exe"):
            self.assertEqual(pipeline._default_docker_cmd({}), [r"Q:\bin\docker.exe"])

    def test_docker_desktop_is_found_where_this_windows_keeps_program_files(self):
        with tempfile.TemporaryDirectory() as programs:
            docker = Path(programs) / "Docker" / "Docker" / "resources" / "bin" / "docker.exe"
            docker.parent.mkdir(parents=True)
            docker.write_bytes(b"")
            with mock.patch.object(pipeline.shutil, "which", return_value=None):
                self.assertEqual(pipeline._default_docker_cmd({"ProgramW6432": programs}), [str(docker)])

    def test_without_docker_on_path_it_reads_this_pcs_own_variables(self):
        # The case the fallback exists for (a windowless worker without Docker on PATH), with the real environment.
        with mock.patch.object(pipeline.shutil, "which", return_value=None):
            self.assertIsInstance(pipeline._default_docker_cmd(), list)

    def test_without_any_docker_it_falls_back_to_the_bare_name(self):
        with tempfile.TemporaryDirectory() as empty:
            with mock.patch.object(pipeline.shutil, "which", return_value=None):
                self.assertEqual(pipeline._default_docker_cmd({"ProgramW6432": empty, "ProgramData": empty}), ["docker"])


if __name__ == "__main__":
    unittest.main()
