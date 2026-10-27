#!/usr/bin/env python3
"""Linux-only lifecycle contracts; external services are isolated behind CLI fixtures."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


BOAT_DIR = Path(__file__).resolve().parent
DISPATCH = BOAT_DIR.parents[1] / "skills/boat-dispatch/kaylee-dispatch"
WORKER = BOAT_DIR / "worker-run.sh"
SANDBOX = "bx_23456789"

BOAT_FIXTURE = r'''#!/usr/bin/env python3
import json, os, pathlib, signal, sys, time
args = sys.argv[1:]
with open(os.environ["CALLS"], "a") as calls:
    calls.write(json.dumps(["boat", *args]) + "\n")
if args[0] == "list":
    print(json.dumps({"sandboxes": []}))
elif args[0] == "new":
    print(json.dumps({"event": "accepted", "id": "bx_23456789"}), flush=True)
    os.kill(os.getppid(), signal.SIGTERM)
    time.sleep(0.05)
    sys.exit(143)
elif args[0] == "info":
    print(json.dumps({"sandbox": {"name": "kaylee-test", "state": "idle"}}))
elif args[0] == "ssh":
    sys.stdin.read()
    print(json.dumps({"repo": "owner/repo", "finished": True, "exit": 0}))
elif args[0] == "scp":
    run = pathlib.Path(args[-1]) / "run"
    run.mkdir()
    (run / "metadata.json").write_text('{"repo":"owner/repo"}')
    (run / "exit-code").write_text("0\n")
elif args[0] == "delete":
    if os.environ.get("DELETE_FAIL") == "1":
        print('{"event":"error","error":"fixture deletion failure"}')
        sys.exit(1)
    print('{"deleted":true}')
else:
    raise RuntimeError(args)
'''

SYSTEMCTL_FIXTURE = r'''#!/usr/bin/env python3
import json, os, sys
with open(os.environ["CALLS"], "a") as calls:
    calls.write(json.dumps(["systemctl", *sys.argv[1:]]) + "\n")
if "disable" in sys.argv and os.environ.get("TUNNEL_FAIL") == "1":
    print("fixture tunnel shutdown failure", file=sys.stderr)
    sys.exit(1)
'''

OMP_FIXTURE = r'''#!/usr/bin/env python3
import json, os, pathlib, time
print(json.dumps({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"fixture completion"}]}}), flush=True)
pathlib.Path(os.environ["OMP_ENTERED"]).write_text("started")
while not pathlib.Path(os.environ["OMP_RELEASE"]).exists():
    time.sleep(0.01)
'''


@unittest.skipUnless(sys.platform.startswith("linux"), "dispatcher targets the Linux chief host (GNU stat/date)")
class PipelineLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.bin = self.home / ".local/bin"
        self.bin.mkdir(parents=True)
        self.calls = self.home / "calls.jsonl"
        self.env = dict(os.environ, HOME=str(self.home), CALLS=str(self.calls))
        self.install("boat", BOAT_FIXTURE)
        self.install("systemctl", SYSTEMCTL_FIXTURE)
        keys = self.home / ".config/hermes/keys"
        keys.mkdir(parents=True)
        (keys / "WORKER_GATEWAY_KEY").write_text("fixture-only-key")
        (keys / "WORKER_GATEWAY_KEY").chmod(0o600)
        unit = self.home / ".config/systemd/user/boat-tunnel@.service"
        unit.parent.mkdir(parents=True)
        unit.write_text("fixture unit")
        self.install("gh", "#!/bin/sh\nexit 0\n")
        self.brief = self.home / "brief.txt"
        self.brief.write_text("Read-only fixture commission")

    def install(self, name, source):
        path = self.bin / name
        path.write_text(source)
        path.chmod(0o755)

    def run_dispatch(self, *arguments, **extra_env):
        return subprocess.run(
            ["bash", str(DISPATCH), *arguments],
            env=dict(self.env, **extra_env), capture_output=True, text=True, timeout=10,
        )

    def recorded_calls(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def test_signal_during_creation_deletes_allocated_vm_and_disables_monitoring(self):
        result = self.run_dispatch(
            "start", "--repo", "owner/repo", "--brief", str(self.brief), "--name", "test",
        )
        self.assertEqual(result.returncode, 143, result.stderr)
        calls = self.recorded_calls()
        create = next(call for call in calls if call[:2] == ["boat", "new"])
        self.assertIn("--no-monitoring", create)
        self.assertIn(["boat", "delete", SANDBOX, "--yes", "--json"], calls)

    def test_finish_attempts_both_teardowns_and_reports_each_failure(self):
        for tunnel_fail, delete_fail in (("1", "0"), ("0", "1"), ("1", "1")):
            with self.subTest(tunnel_fail=tunnel_fail, delete_fail=delete_fail):
                self.calls.write_text("")
                result = self.run_dispatch(
                    "finish", SANDBOX, TUNNEL_FAIL=tunnel_fail, DELETE_FAIL=delete_fail,
                )
                self.assertEqual(result.returncode, 1, result.stderr)
                calls = self.recorded_calls()
                self.assertIn(["systemctl", "--user", "disable", "--now", f"boat-tunnel@{SANDBOX}.service"], calls)
                self.assertIn(["boat", "delete", SANDBOX, "--yes", "--json"], calls)
                if tunnel_fail == "1":
                    self.assertNotIn("Tunnel stopped and disabled:", result.stdout)
                if delete_fail == "1":
                    self.assertNotIn("Deleted sandbox:", result.stdout)

    def test_duplicate_worker_never_clobbers_first_run_or_restarts_completed_run(self):
        run = self.home / "run"
        run.mkdir()
        (run / "metadata.json").write_text('{"model":"anthropic/claude-sonnet-5-5","thinking":"high"}')
        (run / "brief.md").write_text("Read-only fixture commission")
        credentials = self.home / ".config/kaylee"
        credentials.mkdir()
        for name in ("gateway-token", "github-token"):
            (credentials / name).write_text("fixture-only-key")
        (self.home / "work/repo").mkdir(parents=True)
        self.install("omp", OMP_FIXTURE)
        entered, release = self.home / "omp-entered", self.home / "omp-release"
        env = dict(self.env, OMP_ENTERED=str(entered), OMP_RELEASE=str(release))
        env.pop("OMP_AUTH_BROKER_URL", None)
        env.pop("OMP_AUTH_BROKER_TOKEN", None)
        first = subprocess.Popen(["bash", str(WORKER)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not entered.exists():
                if first.poll() is not None or time.monotonic() > deadline:
                    self.fail(f"First worker failed to enter OMP: {first.communicate(timeout=1)}")
                time.sleep(0.01)
            tracked = ("runner.pid", "started-at", "worker.jsonl", "worker.stderr")
            before = {name: (run / name).read_bytes() for name in tracked}
            second = subprocess.run(["bash", str(WORKER)], env=env, capture_output=True, timeout=5)
            self.assertNotEqual(second.returncode, 0)
            self.assertFalse((run / "exit-code").exists(), "Duplicate invocation wrote the first run's exit file")
            self.assertEqual(before, {name: (run / name).read_bytes() for name in tracked})
            release.touch()
            self.assertEqual(first.wait(timeout=5), 0)
            completed = {path.name: path.read_bytes() for path in run.iterdir() if path.is_file()}
            third = subprocess.run(["bash", str(WORKER)], env=env, capture_output=True, timeout=5)
            self.assertNotEqual(third.returncode, 0)
            self.assertEqual(completed, {path.name: path.read_bytes() for path in run.iterdir() if path.is_file()})
        finally:
            release.touch()
            if first.poll() is None:
                first.kill()
            first.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
