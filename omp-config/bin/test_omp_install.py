"""Real installer selection tests in a disposable HOME with no live manager."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

DIRECTORY = Path(__file__).resolve().parent
INSTALLER = DIRECTORY.parent / "install"


class BrowserPrerequisiteTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        for name in (".local/bin", ".local/lib/omp-engineer", ".config/systemd/user",
                     "agent", ".cache/tmp"):
            (self.home / name).mkdir(parents=True, mode=0o700)
        for name in ("omp-engineer", "omp-display", "omp-gui", "omp-host-install"):
            shutil.copyfile(DIRECTORY / (name + ".py"), self.home / ".local/bin" / name)
        (self.home / ".local/bin/omp").symlink_to("omp-engineer")
        for name, content in {
            ".local/lib/omp-engineer/omp": "native entrypoint sentinel\n",
            ".config/systemd/user/omp.slice": "# foreign unit sentinel\n",
            "agent/config.yml": "foreignFixture: unchanged\n",
            "agent/auth.json": '{"fixture":"unchanged"}\n',
            "agent/SOUL.md": "foreign soul sentinel\n",
            ".claude/settings.json": '{"hooks":{"SessionStart":[]}}\n',
        }.items():
            target = self.home / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
        self.before = self.snapshot()
        mask = self.root / "nonexecutable-chromium"
        mask.write_text("Chromium unavailable in this fixture\n")
        mask.chmod(0o600)
        passwd = []
        for line in Path("/etc/passwd").read_text().splitlines():
            parts = line.split(":")
            if parts[2] == str(os.getuid()):
                parts[5] = "/mnt/home"
            passwd.append(":".join(parts))
        (self.root / "passwd").write_text("\n".join(passwd) + "\n")
        for name in ("tmp", "var-tmp"):
            (self.root / name).mkdir()
        # Preserve real absence; only mask Chromium when the host has it.
        chromium = Path("/usr/bin/chromium")
        chromium_mask = ["--ro-bind", str(mask), str(chromium.resolve())] if chromium.exists() else []
        self.command = [
            "bwrap", "--ro-bind", "/", "/", "--proc", "/proc", "--dev-bind", "/dev", "/dev",
            "--bind", str(self.root), "/mnt", "--bind", str(self.root / "tmp"), "/tmp",
            "--bind", str(self.root / "var-tmp"), "/var/tmp", "--tmpfs", "/run",
            "--ro-bind", str(self.root / "passwd"), "/etc/passwd",
            *chromium_mask,
            "--setenv", "HOME", "/mnt/home", "--setenv", "TMPDIR", "/mnt/home/.cache/tmp",
            "--setenv", "PI_CODING_AGENT_DIR", "/mnt/home/agent",
        ]
        # Keep tool lookup, not the caller's credentials, component selection or bus.
        self.environment = {"PATH": os.environ["PATH"]}

    def snapshot(self):
        return {str(path.relative_to(self.home)): ("link", os.readlink(path))
                if path.is_symlink() else ("file", path.read_bytes())
                for path in self.home.rglob("*") if path.is_symlink() or path.is_file()}

    def install(self, components=None):
        selection = [] if components is None else ["--setenv", "OMP_INSTALL_COMPONENTS", components]
        return subprocess.run(self.command + selection + ["--", str(INSTALLER)],
                              env=self.environment, capture_output=True, text=True, timeout=60)

    def test_ordinary_active_alias_cli_update_needs_no_chromium(self):
        result = self.install("cli")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.snapshot(), self.before)
        self.assertFalse((self.home / ".local/bin/omp-browser-helper").exists())

    def test_ordinary_active_alias_default_install_needs_no_chromium(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        after = self.snapshot()
        for name in (".local/lib/omp-engineer/omp", ".local/bin/omp",
                     ".config/systemd/user/omp.slice", "agent/auth.json", "agent/SOUL.md"):
            self.assertEqual(after[name], self.before[name], name)
        self.assertIn("foreignFixture: unchanged", (self.home / "agent/config.yml").read_text())
        settings = json.loads((self.home / ".claude/settings.json").read_text())
        self.assertEqual(settings["hooks"], {"SessionStart": []})
        self.assertFalse((self.home / ".local/bin/omp-browser-helper").exists())

    def test_explicit_helper_refuses_missing_chromium_before_any_payload_write(self):
        # The earlier selected component must also remain unwritten on refusal.
        result = self.install("guidance browser-helper")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("require /usr/bin/chromium", result.stderr)
        self.assertEqual(self.snapshot(), self.before)
        self.assertFalse((self.home / "agent/AGENTS.md").exists())
        self.assertFalse((self.home / ".local/bin/omp-browser-helper").exists())
