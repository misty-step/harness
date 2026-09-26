#!/usr/bin/env python3
# owned by misty-step/harness agent-config desktop-guard
"""Real-filesystem checks for operator cutover snapshot and recovery."""

import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from cutover_transaction import Transaction


class TransactionTest(unittest.TestCase):
    def setUp(self):
        scratch_root = Path.home() / ".cache/tmp"
        scratch_root.mkdir(parents=True, exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(prefix="desktop-guard-transaction-", dir=scratch_root)
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.units = self.home / ".config/systemd/user"
        self.units.mkdir(parents=True)
        self.hypr = self.home / ".config/hypr"
        self.hypr.mkdir(parents=True)
        self.unit = self.units / "dev.slice"
        self.binding = self.hypr / "bindings.local.lua"
        self.dropin = self.units / "dev.slice.d"
        self.backup = self.root / "private-backup"
        self.unit.write_bytes(b"[Slice]\nMemoryMax=40G\n")
        self.unit.chmod(0o640)
        self.binding.write_bytes(b"-- engineer shortcuts\n")
        self.binding.chmod(0o644)
        self.dropin.mkdir()
        self.dropin.chmod(0o750)  # mkdir(mode=) is umask-filtered; the cutover service runs UMask=0077.
        (self.dropin / "limits.conf").write_bytes(b"[Slice]\nMemoryHigh=36G\n")
        (self.dropin / "limits.conf").chmod(0o640)
        (self.dropin / "local-link").symlink_to("../limits.conf")
        nested = self.dropin / "legacy"
        nested.mkdir()
        nested.chmod(0o750)
        (nested / "override.conf").write_bytes(b"[Slice]\nMemoryLow=3G\n")
        (nested / "override.conf").chmod(0o604)

    def changes(self):
        return {
            self.unit: b"[Slice]\nMemoryMax=24G\n",
            self.binding: b"-- engineer shortcuts\ndofile('herdr.lua')\n",
            self.dropin: None,
        }

    def killed_during_replace(self, backup, target):
        """Leave atomic staging on disk exactly as process death would."""
        script = (
            "import os, signal, sys\n"
            "from pathlib import Path\n"
            "import cutover_transaction as transaction\n"
            "target = Path(sys.argv[2])\n"
            "original_replace = os.replace\n"
            "def killed(source, destination):\n"
            "    if Path(destination) == target:\n"
            "        os.kill(os.getpid(), signal.SIGKILL)\n"
            "    return original_replace(source, destination)\n"
            "os.replace = killed\n"
            "transaction.Transaction(Path(sys.argv[1])).apply()\n"
        )
        result = subprocess.run(
            [sys.executable, "-B", "-c", script, str(backup), str(target)],
            cwd=Path(__file__).parent, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, -signal.SIGKILL, result.stderr)


    def test_reconciliation_refuses_any_remaining_transaction_state(self):
        Transaction(self.backup).prepare(self.changes())
        Transaction(self.backup).assert_rolled_back()  # Nothing applied yet.
        Transaction(self.backup).apply()
        with self.assertRaisesRegex(ValueError, str(self.binding)):
            Transaction(self.backup).assert_rolled_back()
        Transaction(self.backup).rollback()
        self.unit.write_bytes(b"[Unit]\nDescription=operator edit after rollback\n")
        Transaction(self.backup).assert_rolled_back()  # Later foreign edits are not ours.

    def test_success_then_fresh_process_rollback_restores_bytes_modes_links_and_tree(self):
        leaf_link = self.units / "dev-exec.slice"
        leaf_link.symlink_to("/outside/keep-unfollowed")
        absent_unit = self.units / "herdr@.service"
        wants = self.units / "graphical-session.target.wants"
        enable = wants / "herdr@default.service"
        before_unit = self.unit.read_bytes()
        before_binding = self.binding.read_bytes()
        changes = self.changes() | {
            leaf_link: b"[Slice]\nMemoryMax=5G\n",
            absent_unit: b"[Service]\nExecStart=/bin/true\n",
            enable: "../herdr@.service",
        }
        Transaction(self.backup).prepare(changes)
        Transaction(self.backup).apply()
        self.assertEqual(self.unit.read_bytes(), changes[self.unit])
        self.assertEqual(stat.S_IMODE(self.unit.stat().st_mode), 0o600)
        self.assertEqual(self.binding.read_bytes(), changes[self.binding])
        self.assertFalse(self.dropin.exists())
        self.assertEqual(leaf_link.read_bytes(), changes[leaf_link])
        self.assertEqual(stat.S_IMODE(leaf_link.stat().st_mode), 0o600)
        self.assertEqual(os.readlink(enable), "../herdr@.service")
        Transaction(self.backup).check_rollback()
        subprocess.run(
            [sys.executable, "-B", "-c",
             "import sys; from pathlib import Path; from cutover_transaction import Transaction; "
             "Transaction(Path(sys.argv[1])).rollback()", str(self.backup)],
            cwd=Path(__file__).parent, check=True,
        )
        self.assertEqual(self.unit.read_bytes(), before_unit)
        self.assertEqual(stat.S_IMODE(self.unit.stat().st_mode), 0o640)
        self.assertEqual(self.binding.read_bytes(), before_binding)
        self.assertEqual(stat.S_IMODE(self.binding.stat().st_mode), 0o644)
        self.assertEqual(stat.S_IMODE(self.dropin.stat().st_mode), 0o750)
        self.assertEqual((self.dropin / "limits.conf").read_bytes(), b"[Slice]\nMemoryHigh=36G\n")
        self.assertEqual(stat.S_IMODE((self.dropin / "limits.conf").stat().st_mode), 0o640)
        self.assertEqual(os.readlink(self.dropin / "local-link"), "../limits.conf")
        self.assertEqual(stat.S_IMODE((self.dropin / "legacy").stat().st_mode), 0o750)
        self.assertEqual((self.dropin / "legacy/override.conf").read_bytes(), b"[Slice]\nMemoryLow=3G\n")
        self.assertEqual(stat.S_IMODE((self.dropin / "legacy/override.conf").stat().st_mode), 0o604)
        self.assertEqual(os.readlink(leaf_link), "/outside/keep-unfollowed")
        self.assertFalse(absent_unit.exists())
        self.assertFalse(wants.exists())
        Transaction(self.backup).check_rollback()  # Recovered state remains safe to inspect.

    def test_process_death_during_atomic_staging_keeps_new_parent_rollback_safe(self):
        for replacement in (b"[Unit]\nDescription=guard\n", "../herdr@.service"):
            with self.subTest(replacement=type(replacement).__name__):
                with tempfile.TemporaryDirectory(dir=self.root) as directory:
                    case = Path(directory)
                    wants = case / "graphical-session.target.wants"
                    target = wants / "herdr@default.service"
                    backup = case / "backup"
                    Transaction(backup).prepare({target: replacement})
                    self.killed_during_replace(backup, target)
                    self.assertTrue(any((backup / "staging").iterdir()))
                    self.assertTrue(wants.is_dir())
                    self.assertFalse(target.exists())
                    Transaction(backup).check_rollback()
                    Transaction(backup).rollback()
                    self.assertFalse(wants.exists())

    def test_interrupted_apply_can_rollback_from_only_persisted_backup(self):
        changes = self.changes()
        Transaction(self.backup).prepare(changes)
        real_replace = os.replace

        def fail_second_replace(source, destination):
            if Path(destination) == self.unit:
                raise OSError("simulated filesystem failure during second target")
            return real_replace(source, destination)

        with patch("cutover_transaction.os.replace", side_effect=fail_second_replace):
            with self.assertRaisesRegex(OSError, "simulated filesystem failure"):
                Transaction(self.backup).apply()
        self.assertEqual(self.binding.read_bytes(), changes[self.binding])
        self.assertEqual(self.unit.read_bytes(), b"[Slice]\nMemoryMax=40G\n")
        self.assertTrue((self.dropin / "limits.conf").is_file())
        Transaction(self.backup).check_rollback()
        Transaction(self.backup).rollback()
        self.assertEqual(self.binding.read_bytes(), b"-- engineer shortcuts\n")
        self.assertEqual(self.unit.read_bytes(), b"[Slice]\nMemoryMax=40G\n")
        self.assertTrue((self.dropin / "limits.conf").is_file())

    def test_interrupted_directory_removal_recovers_after_the_rename(self):
        Transaction(self.backup).prepare({self.dropin: None, self.binding: b"planned binding\n"})
        real_rename = os.rename

        def interrupt_after_rename(source, destination):
            real_rename(source, destination)
            raise OSError("simulated process loss after directory rename")

        with patch("cutover_transaction.os.rename", side_effect=interrupt_after_rename):
            with self.assertRaisesRegex(OSError, "after directory rename"):
                Transaction(self.backup).apply()
        self.assertFalse(self.dropin.exists())
        Transaction(self.backup).check_rollback()
        Transaction(self.backup).rollback()
        self.assertEqual(self.binding.read_bytes(), b"-- engineer shortcuts\n")
        self.assertEqual((self.dropin / "limits.conf").read_bytes(), b"[Slice]\nMemoryHigh=36G\n")

    def test_foreign_unit_binding_or_dropin_blocks_all_restoration(self):
        for label in ("unit", "binding", "dropin"):
            with self.subTest(label=label):
                with tempfile.TemporaryDirectory(dir=self.root) as case:
                    # Each case uses a separate tree; never carry another case's edits.
                    unit = Path(case) / "dev.slice"
                    binding = Path(case) / "bindings.local.lua"
                    dropin = Path(case) / "dev.slice.d"
                    unit.write_bytes(b"original unit\n")
                    binding.write_bytes(b"original binding\n")
                    dropin.mkdir()
                    (dropin / "limits.conf").write_bytes(b"original dropin\n")
                    backup = Path(case) / "backup"
                    planned_unit = b"planned unit\n"
                    planned_binding = b"planned binding\n"
                    Transaction(backup).prepare({unit: planned_unit, binding: planned_binding, dropin: None})
                    Transaction(backup).apply()
                    edited = {"unit": unit, "binding": binding, "dropin": dropin}[label]
                    if label == "dropin":
                        edited.mkdir()
                        (edited / "foreign.conf").write_bytes(b"engineer setting\n")
                    else:
                        edited.write_bytes(b"foreign edit\n")
                    for action in ("check_rollback", "rollback"):
                        with self.assertRaisesRegex(ValueError, str(edited)):
                            getattr(Transaction(backup), action)()
                    self.assertEqual(unit.read_bytes(), b"foreign edit\n" if label == "unit" else planned_unit)
                    self.assertEqual(binding.read_bytes(), b"foreign edit\n" if label == "binding" else planned_binding)
                    if label == "dropin":
                        self.assertEqual((dropin / "foreign.conf").read_bytes(), b"engineer setting\n")
                    else:
                        self.assertFalse(dropin.exists())

    def test_foreign_deletion_before_apply_is_not_a_recoverable_interruption(self):
        Transaction(self.backup).prepare({self.unit: None, self.binding: b"planned binding\n"})
        self.unit.unlink()
        with self.assertRaisesRegex(ValueError, str(self.unit)):
            Transaction(self.backup).check_rollback()
        with self.assertRaisesRegex(ValueError, str(self.unit)):
            Transaction(self.backup).rollback()
        self.assertEqual(self.binding.read_bytes(), b"-- engineer shortcuts\n")

    def test_foreign_deletion_after_changing_existing_replacement_blocks_all_rollback(self):
        changes = {self.binding: b"planned binding\n", self.unit: b"planned unit\n"}
        Transaction(self.backup).prepare(changes)
        self.killed_during_replace(self.backup, self.unit)
        self.assertEqual(self.binding.read_bytes(), changes[self.binding])
        self.unit.unlink()
        for action in ("check_rollback", "rollback"):
            with self.assertRaisesRegex(ValueError, str(self.unit)):
                getattr(Transaction(self.backup), action)()
        self.assertFalse(self.unit.exists())
        self.assertEqual(self.binding.read_bytes(), changes[self.binding])

    def test_apply_preflights_foreign_target_before_any_target_changes(self):
        Transaction(self.backup).prepare(self.changes())
        self.unit.write_bytes(b"engineer changed the unit after snapshot\n")
        with self.assertRaisesRegex(ValueError, str(self.unit)):
            Transaction(self.backup).apply()
        self.assertEqual(self.unit.read_bytes(), b"engineer changed the unit after snapshot\n")
        self.assertEqual(self.binding.read_bytes(), b"-- engineer shortcuts\n")
        self.assertTrue((self.dropin / "limits.conf").is_file())

    def test_existing_ancestor_drift_blocks_rollback_before_any_restore(self):
        Transaction(self.backup).prepare(self.changes())
        Transaction(self.backup).apply()
        self.units.chmod(0o750)
        for action in ("check_rollback", "rollback"):
            with self.assertRaisesRegex(ValueError, str(self.units)):
                getattr(Transaction(self.backup), action)()
        self.assertEqual(self.unit.read_bytes(), self.changes()[self.unit])
        self.assertFalse(self.dropin.exists())

    def test_corrupted_private_copy_never_restores_incorrect_original(self):
        Transaction(self.backup).prepare(self.changes())
        Transaction(self.backup).apply()
        # Bindings are first in sorted target order, so its saved original is 0000.
        (self.backup / "originals/0000").write_bytes(b"corrupt backup\n")
        with self.assertRaisesRegex(ValueError, str(self.binding)):
            Transaction(self.backup).rollback()
        self.assertEqual(self.binding.read_bytes(), self.changes()[self.binding])
        self.assertFalse(self.dropin.exists())

    def test_symlink_ancestor_rejected_without_touching_other_targets(self):
        alias = self.home / "aliased-units"
        alias.symlink_to(self.units, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, str(alias)):
            Transaction(self.backup).prepare({
                self.binding: b"planned binding\n", alias / "dev.slice": b"unsafe write\n"})
        self.assertEqual(self.binding.read_bytes(), b"-- engineer shortcuts\n")
        self.assertFalse(self.backup.exists())

    def test_snapshot_failure_leaves_every_target_unchanged(self):
        os.mkfifo(self.dropin / "unsafe-node")
        before_unit = self.unit.read_bytes()
        before_binding = self.binding.read_bytes()
        with self.assertRaisesRegex(ValueError, "special filesystem node"):
            Transaction(self.backup).prepare(self.changes())
        self.assertEqual(self.unit.read_bytes(), before_unit)
        self.assertEqual(stat.S_IMODE(self.unit.stat().st_mode), 0o640)
        self.assertEqual(self.binding.read_bytes(), before_binding)
        self.assertTrue(stat.S_ISFIFO((self.dropin / "unsafe-node").lstat().st_mode))
        self.assertFalse((self.backup / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
