#!/usr/bin/env python3
# owned by misty-step/harness agent-config desktop-guard
"""Disposable-home checks of the public opt-in installer boundary."""

import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent
INSTALL = ROOT.parent / "install"


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="desktop-guard-install-")
        self.addCleanup(self.scratch.cleanup)
        self.home = Path(self.scratch.name) / "home"
        self.home.mkdir()
        self.agent = Path(self.scratch.name) / "agent"
        self.stage = self.home / ".local/share/desktop-guard/staged"
        self.live_unit = self.home / ".config/systemd/user/dev-exec.slice"
        self.live_dropin = self.home / ".config/systemd/user/dev-exec.slice.d/limits.conf"
        self.live_binding = self.home / ".config/hypr/bindings.local.lua"
        for path, content in (
            (self.live_unit, "[Slice]\nMemoryMax=48G\n"),
            (self.live_dropin, "[Slice]\nMemoryMax=60G\n"),
            (self.live_binding, "-- foreign keyboard shortcuts\n"),
        ):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)

    def install(self, *options, guard=True):
        command = ["/bin/sh", str(INSTALL), "--home", str(self.home)]
        if guard:
            command.append("--desktop-guard")
        command.extend(options)
        return subprocess.run(
            command, env={**os.environ, "HOME": str(self.home)},
            capture_output=True, text=True, timeout=20, check=False,
        )

    def live_state(self):
        return tuple(path.read_bytes() for path in (self.live_unit, self.live_dropin, self.live_binding))

    def test_us043_check_is_inert_and_stage_does_not_activate_live_configuration(self):
        before = self.live_state()
        result = self.install("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.home / ".local").exists())
        self.assertEqual(self.live_state(), before)

        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.live_state(), before)
        self.assertTrue((self.stage / "hypr/herdr.lua").is_file())
        self.assertEqual(
            json.loads((self.stage / "manifest.json").read_text())["binding"],
            {"staged": "hypr/herdr.lua", "load_from": ".config/hypr/bindings.local.lua"},
        )
        unit = self.stage / "systemd/user"
        for name, maximum, swap in (
            ("dev.slice", "52G", "8G"),
            ("dev-fleet.slice", "36G", "6G"),
            ("dev-exec.slice", "16G", "2G"),
        ):
            text = (unit / name).read_text()
            self.assertIn(f"MemoryMax={maximum}\n", text)
            self.assertIn(f"MemorySwapMax={swap}\n", text)
            self.assertIn("MemoryHigh=infinity\n", text)
            self.assertNotIn("ManagedOOM", text)
        template = (unit / "herdr@.service").read_text()
        self.assertIn("Slice=dev-fleet.slice\n", template)
        self.assertIn("OOMPolicy=continue\n", template)
        self.assertIn("Restart=no\n", template)
        self.assertNotIn("ManagedOOM", template)
        launcher = self.home / ".local/bin/desktop-guard"
        self.assertEqual(stat.S_IMODE(launcher.stat().st_mode), 0o700)
        help_result = subprocess.run(
            [launcher, "--help"], env={**os.environ, "HOME": str(self.home)},
            capture_output=True, text=True, timeout=10, check=False,
        )
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        self.assertIn("serve", help_result.stdout)

    def test_preflight_rejects_foreign_unit_before_combined_install(self):
        collision = self.stage / "systemd/user/dev-exec.slice"
        collision.parent.mkdir(parents=True)
        collision.write_text("# foreign unit\n[Slice]\n")
        self.agent.mkdir()
        before = self.live_state()
        for options in (("--check",), ()):
            with self.subTest(options=options):
                result = self.install("--agent-dir", str(self.agent), "--skill", "authenticated-commands", *options)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Refusing foreign destination", result.stderr)
                self.assertEqual(collision.read_text(), "# foreign unit\n[Slice]\n")
                self.assertFalse((self.agent / "skills").exists())
                self.assertFalse((self.home / ".local/bin/desktop-guard").exists())
                self.assertEqual(self.live_state(), before)

    def test_symlinked_launcher_is_never_followed(self):
        outside = Path(self.scratch.name) / "foreign"
        outside.write_text("foreign\n")
        launcher = self.home / ".local/bin/desktop-guard"
        launcher.parent.mkdir(parents=True)
        launcher.symlink_to(outside)
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Refusing non-regular or symlink destination", result.stderr)
        self.assertEqual(outside.read_text(), "foreign\n")
        self.assertFalse(self.stage.exists())

    def test_owned_restage_replaces_only_its_targets(self):
        self.assertEqual(self.install().returncode, 0)
        owned = self.stage / "systemd/user/dev-fleet.slice"
        owned.write_text("# owned by misty-step/harness agent-config desktop-guard\n[Slice]\nMemoryMax=99G\n")
        foreign = self.stage / "operator-note"
        foreign.write_text("keep me\n")
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("MemoryMax=36G\n", owned.read_text())
        self.assertEqual(foreign.read_text(), "keep me\n")

    def test_default_selection_does_not_install_desktop_guard(self):
        self.agent.mkdir()
        before = self.live_state()
        result = self.install("--agent-dir", str(self.agent), "--skill", "authenticated-commands", guard=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.agent / "skills/authenticated-commands/SKILL.md").is_file())
        self.assertFalse((self.home / ".local/bin/desktop-guard").exists())
        self.assertFalse(self.stage.exists())
        self.assertEqual(self.live_state(), before)


if __name__ == "__main__":
    unittest.main()
