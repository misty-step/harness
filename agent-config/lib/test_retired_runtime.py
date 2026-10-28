import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from retired_runtime import BIN_MARKERS, retire


CLI = Path(__file__).with_name("retired_runtime.py")
CONSUMER = '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
home=Path(os.environ['HOME']); args=sys.argv[2:]; units=home/'.config/systemd/user'
with (home/'calls').open('a') as out: out.write(json.dumps(args)+'\\n')
if os.environ.get('FAIL_ON') == args[0]: raise SystemExit(1)
states=json.loads((home/'states.json').read_text())
if args[0]=='show':
 name=args[1]; path=units/name
 if not path.exists() and name.startswith('t3-access@'): path=units/('t3-access@.'+name.rsplit('.',1)[1])
 info={'FragmentPath':str(path) if path.exists() else '', 'ActiveState':'inactive', 'LoadState':'loaded' if path.exists() else 'not-found', 'DropInPaths':''}
 info.update(states.get(name,{}))
 for key,value in info.items(): print(key+'='+value)
elif args[0]=='list-units':
 for name in states:
  if name.startswith('t3-access@'): print(name+' loaded active waiting')
elif args[0]=='stop':
 assert args[1].endswith('.timer'), 'must never stop a running service'
elif args[0]=='disable':
 name=args[-1]
 for link in (units/'timers.target.wants').glob(name): link.unlink()
'''


class RuntimeRetirement(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.bin = self.home / ".local/bin"
        self.units = self.home / ".config/systemd/user"
        self.bin.mkdir(parents=True)
        self.units.mkdir(parents=True)
        self.toolbin = self.home / "tools"
        self.toolbin.mkdir()
        (self.toolbin / "systemctl").write_text(CONSUMER)
        (self.toolbin / "systemctl").chmod(0o700)
        self.states({})

    def states(self, value):
        (self.home / "states.json").write_text(json.dumps(value))

    def seed(self, template=False):
        for name in ["t3-pool", "t3-runtime-mode", "t3-agent", "t3-access-renew"]:
            (self.bin / name).write_text("#!/usr/bin/env bun\n" + BIN_MARKERS[name] + "\n")
        for prefix in ["t3-pool", "t3-access-renew"] + (["t3-access@"] if template else []):
            marker = "t3-pool" if prefix == "t3-pool" else "t3-access"
            for suffix in ["service", "timer"]:
                (self.units / f"{prefix}.{suffix}").write_text(f"# owned by misty-step/harness {marker}\n[Unit]\nDescription=owned\n")
        wants = self.units / "timers.target.wants"
        wants.mkdir()
        for name in ["t3-pool.timer", "t3-access-renew.timer"] + (["t3-access@qa.timer"] if template else []):
            target = "t3-access@.timer" if "@" in name else name
            (wants / name).symlink_to(self.units / target)

    def run_cli(self, *args, fail=None):
        env = {**os.environ, "HOME": str(self.home), "PATH": str(self.toolbin) + os.pathsep + os.environ["PATH"]}
        if fail:
            env["FAIL_ON"] = fail
        return subprocess.run([sys.executable, str(CLI), "--home", str(self.home), *args], env=env, capture_output=True, text=True)

    def snapshot(self):
        return {str(p.relative_to(self.home)): ("link", os.readlink(p)) if p.is_symlink() else ("file", p.read_bytes(), stat.S_IMODE(p.stat().st_mode))
                for p in self.home.rglob("*") if p.is_symlink() or p.is_file()}

    @unittest.skipUnless(sys.platform == "linux", "native user jobs are Linux-only")
    def test_enabled_owned_jobs_retire_idempotently_and_preflight_is_inert(self):
        self.seed(template=True)
        self.states({"t3-access@qa.timer": {}, "t3-access@qa.service": {}})
        private = self.home / ".t3/userdata/state.sqlite"
        private.parent.mkdir(parents=True)
        private.write_bytes(b"private history fixture")
        private.chmod(0o600)
        before = self.snapshot()
        self.assertEqual(self.run_cli("--check").returncode, 0)
        self.assertEqual(self.snapshot(), before)
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(list(self.bin.iterdir()), [])
        self.assertEqual(list((self.units / "timers.target.wants").iterdir()), [])
        self.assertEqual(list(self.units.glob("*.service")), [])
        calls = [json.loads(line) for line in (self.home / "calls").read_text().splitlines()]
        self.assertIn(["stop", "t3-access@qa.timer"], calls)
        self.assertIn(["disable", "--no-reload", "t3-pool.timer"], calls)
        self.assertEqual(private.read_bytes(), b"private history fixture")
        self.assertEqual(stat.S_IMODE(private.stat().st_mode), 0o600)
        (self.home / "calls").unlink()
        self.assertEqual(self.run_cli().returncode, 0)
        self.assertFalse((self.home / "calls").exists())

    def test_foreign_replacements_links_dropins_and_masks_survive(self):
        self.seed()
        (self.units / "t3-pool.service").write_text("foreign replacement\n")
        (self.units / "t3-access-renew.timer").unlink()
        (self.units / "t3-access-renew.timer").symlink_to("/dev/null")
        (self.bin / "t3-runtime-mode").unlink()
        foreign = self.home / "foreign-tool"
        foreign.write_text("unrelated executable\n")
        (self.bin / "t3-runtime-mode").symlink_to(foreign)
        pool_before = {p: p.read_bytes() for p in [self.bin / "t3-pool", self.units / "t3-pool.service", self.units / "t3-pool.timer"]}
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        for path, data in pool_before.items():
            self.assertEqual(path.read_bytes(), data)
        self.assertEqual(os.readlink(self.units / "t3-access-renew.timer"), "/dev/null")
        self.assertEqual(os.readlink(self.bin / "t3-runtime-mode"), str(foreign))
        self.assertEqual(foreign.read_text(), "unrelated executable\n")

    def test_foreign_dropin_preserves_group(self):
        self.seed()
        dropin = self.units / "t3-pool.service.d"
        dropin.mkdir()
        (dropin / "foreign.conf").write_text("[Service]\nEnvironment=KEEP=yes\n")
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.bin / "t3-pool").exists())
        self.assertTrue((self.units / "t3-pool.timer").exists())
        self.assertTrue((dropin / "foreign.conf").exists())

    def test_unrelated_activation_alias_preserves_its_group(self):
        self.seed()
        alias = self.units / "timers.target.wants/foreign.timer"
        alias.symlink_to(self.units / "t3-pool.timer")
        self.assertEqual(self.run_cli().returncode, 0)
        self.assertTrue(alias.is_symlink())
        self.assertTrue((self.bin / "t3-pool").exists())

    def test_mac_retirement_never_calls_systemd(self):
        self.seed()
        with patch("retired_runtime.sys.platform", "darwin"), patch("retired_runtime.systemctl", side_effect=AssertionError("systemd on Mac")):
            retire(self.home)
        self.assertEqual(list(self.bin.iterdir()), [])
        self.assertEqual(list((self.units / "timers.target.wants").iterdir()), [])

    @unittest.skipUnless(sys.platform == "linux", "native user jobs are Linux-only")
    def test_running_service_is_not_stopped_and_files_remain_for_retry(self):
        self.seed()
        self.states({"t3-pool.service": {"ActiveState": "active"}})
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("still running", result.stderr)
        self.assertTrue((self.bin / "t3-pool").exists())
        self.assertTrue((self.units / "t3-pool.service").exists())
        self.assertFalse((self.units / "timers.target.wants/t3-pool.timer").exists())
        self.assertNotIn('["stop", "t3-pool.service"]', (self.home / "calls").read_text())
        self.states({})
        self.assertEqual(self.run_cli().returncode, 0)

    @unittest.skipUnless(sys.platform == "linux", "native user jobs are Linux-only")
    def test_native_command_failures_keep_executables_and_surface_the_error(self):
        for command in ["stop", "disable", "daemon-reload"]:
            with self.subTest(command=command):
                self.seed()
                result = self.run_cli(fail=command)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Runtime retirement failed", result.stderr)
                self.assertTrue((self.bin / "t3-pool").exists())
                self.assertTrue((self.units / "t3-pool.service").exists())
                self.assertEqual(self.run_cli().returncode, 0)
                (self.units / "timers.target.wants").rmdir()


if __name__ == "__main__":
    unittest.main()
