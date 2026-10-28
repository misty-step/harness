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
import json, os, pathlib, shutil, signal, subprocess, sys, time
args = sys.argv[1:]
with open(os.environ["CALLS"], "a") as calls:
    calls.write(json.dumps(["boat", *args]) + "\n")
home = pathlib.Path(os.environ["HOME"])
if args[0] == "list":
    sandboxes = []
    if os.environ.get("LIST_WORKER") == "1":
        sandboxes = [{"id": "bx_23456789", "name": "kaylee-test", "createdAt": "2026-01-01T00:00:00Z",
                      "state": os.environ.get("STATE", "idle")}]
    print(json.dumps({"sandboxes": sandboxes, "pageInfo": {"hasMore": False}}))
elif args[0] == "new":
    print(json.dumps({"event": "accepted", "id": "bx_23456789"}), flush=True)
    os.kill(os.getppid(), signal.SIGTERM)
    time.sleep(0.05)
    sys.exit(143)
elif args[0] == "info":
    print(json.dumps({"sandbox": {"name": "kaylee-test", "state": os.environ.get("STATE", "idle")}}))
elif args[0] == "ssh":
    # The fixture VM is this HOME: run the remote command for real, record what crosses back.
    done = subprocess.run(["bash", "-c", " ".join(args[2:])], capture_output=True)
    with open(os.environ["CALLS"] + ".ssh-bytes", "a") as sizes:
        sizes.write(f"{len(done.stdout)}\n")
    sys.stdout.buffer.write(done.stdout)
    sys.stderr.buffer.write(done.stderr)
    sys.exit(done.returncode)
elif args[0] == "snapshot" and args[1] == "tree":
    if os.environ.get("TREE_FAIL") == "1":
        print('{"event":"error","error":"snapshot tree unavailable"}')
        sys.exit(1)
    if "TREE_OUTPUT" in os.environ:
        print(os.environ["TREE_OUTPUT"])
    else:
        print(json.dumps({"paths": [
            "/home/user/" + str(p.relative_to(home)) for p in home.rglob("*")
        ]}))
elif args[0] == "snapshot" and args[1] == "pull":
    out = pathlib.Path(args[args.index("--out") + 1]) / "home/user"
    paths = [args[i + 1] for i, arg in enumerate(args) if arg == "--path"]
    for path in paths:
        source = home / pathlib.Path(path).relative_to("/home/user")
        if source.name == os.environ.get("FAIL_PULL"):
            print('{"event":"error","error":"snapshot chunk download failed: connection reset by peer"}')
            sys.exit(1)
        if not source.exists():
            print('{"event":"error","error":"path not in snapshot"}')
            sys.exit(1)
        target = out / source.relative_to(home)
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, target, symlinks=True)
        else:
            shutil.copy2(source, target)
    print(json.dumps({"homeDir": str(out)}))
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

    def make_run(self, files=None, exit_code="0\n"):
        """Populate the fixture VM's ~/run (the fixture HOME is the VM)."""
        run = self.home / "run"
        run.mkdir(exist_ok=True)
        files = {"metadata.json": '{"repo":"owner/repo"}', **(files or {})}
        if exit_code is not None:
            files["exit-code"] = exit_code
        for name, content in files.items():
            path = run / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        return run

    def add_junk(self, run):
        (run / "gitleaks").write_bytes(b"\0" * 2_000_000)
        (run / "tools.tar.gz").write_bytes(b"\1" * 500_000)
        (run / "repo-copy/.git").mkdir(parents=True)
        (run / "repo-copy/.git/config").write_text("copy")
        (run / "sessions/nested").mkdir(parents=True, exist_ok=True)
        (run / "sessions/nested/subagent.jsonl").write_text("nested")
        (run / "sessions/artifact.bin").write_text("artifact")
        (run / "clone.stdout").symlink_to("/etc/hostname")

    ALLOWED = {
        "metadata.json", "brief.md", "launch.json", "started-at", "runner.pid", "exit-code",
        "worker.jsonl", "worker.stderr", "clone.stderr", "sessions/session.jsonl",
    }

    def collected(self):
        root = self.home / f".local/state/kaylee/runs/{SANDBOX}"
        return {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() and p.name != "deletion.json"}

    def full_run(self):
        run = self.make_run({name: name for name in self.ALLOWED - {"metadata.json", "exit-code"}})
        self.add_junk(run)
        return run

    def test_finish_collects_only_allowlisted_files_from_live_vm(self):
        self.full_run()  # clone.stdout is a symlink and must be refused
        (self.home / "run/launch.json").unlink()
        result = self.run_dispatch("finish", SANDBOX)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.collected(), self.ALLOWED - {"launch.json"})
        calls = self.recorded_calls()
        self.assertFalse([call for call in calls if call[:2] in (["boat", "scp"], ["boat", "snapshot"])])
        self.assertIn(["boat", "delete", SANDBOX, "--yes", "--json"], calls)

    def test_finish_collects_only_allowlisted_paths_from_snapshot(self):
        run = self.full_run()
        (run / "clone.stdout").unlink()
        result = self.run_dispatch("finish", SANDBOX, STATE="stopped")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.collected(), self.ALLOWED)
        pulled = {call[i + 1] for call in self.recorded_calls()
                  if call[:3] == ["boat", "snapshot", "pull"]
                  for i, arg in enumerate(call) if arg == "--path"}
        self.assertEqual(pulled, {f"/home/user/run/{name}" for name in (
            "metadata.json", "brief.md", "launch.json", "started-at", "runner.pid", "exit-code",
            "worker.jsonl", "worker.stderr", "clone.stderr", "sessions")})

    def test_list_of_stopped_worker_pulls_only_metadata_and_exit_code(self):
        self.full_run()
        result = self.run_dispatch("list", STATE="stopped", LIST_WORKER="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("owner/repo\ttrue\t0", result.stdout)
        pulled = [call[i + 1] for call in self.recorded_calls()
                  if call[:3] == ["boat", "snapshot", "pull"]
                  for i, arg in enumerate(call) if arg == "--path"]
        self.assertEqual(sorted(pulled), ["/home/user/run/exit-code", "/home/user/run/metadata.json"])

    def assert_vm_retained(self, result):
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("VM retained", result.stderr)
        calls = self.recorded_calls()
        self.assertFalse([call for call in calls if call[:2] == ["boat", "delete"]])
        self.assertFalse([call for call in calls if call[0] == "systemctl" and "disable" in call])

    def test_stopped_finish_retains_vm_on_worker_jsonl_transfer_failure(self):
        self.make_run({"worker.jsonl": "existing report"})
        result = self.run_dispatch("finish", SANDBOX, STATE="stopped", FAIL_PULL="worker.jsonl")
        self.assert_vm_retained(result)
        self.assertIn("snapshot chunk download failed: connection reset by peer", result.stderr)

    def test_force_finish_retains_vm_on_exit_code_transfer_failure(self):
        self.make_run()
        result = self.run_dispatch("finish", SANDBOX, "--force", STATE="stopped", FAIL_PULL="exit-code")
        self.assert_vm_retained(result)
        self.assertIn("snapshot chunk download failed: connection reset by peer", result.stderr)

    def test_stopped_finish_retains_vm_on_sessions_transfer_failure(self):
        self.make_run({"sessions/session.jsonl": "existing session"})
        result = self.run_dispatch("finish", SANDBOX, STATE="stopped", FAIL_PULL="sessions")
        self.assert_vm_retained(result)
        self.assertIn("snapshot chunk download failed: connection reset by peer", result.stderr)

    def test_stopped_list_is_unavailable_on_exit_code_transfer_failure(self):
        self.make_run()
        result = self.run_dispatch("list", STATE="stopped", LIST_WORKER="1", FAIL_PULL="exit-code")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("UNAVAILABLE\tunknown\t-", result.stdout)
        self.assertNotIn("owner/repo\tfalse\t-", result.stdout)
        self.assertIn("Could not read stopped worker", result.stderr)
        self.assertIn("snapshot chunk download failed: connection reset by peer", result.stderr)

    def test_stopped_finish_succeeds_with_confirmed_absent_optional_files(self):
        self.make_run({"worker.jsonl": "report"})
        result = self.run_dispatch("finish", SANDBOX, STATE="stopped")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.collected(), {"metadata.json", "exit-code", "worker.jsonl"})
        self.assertIn(["boat", "delete", SANDBOX, "--yes", "--json"], self.recorded_calls())

    def test_stopped_list_is_unfinished_only_with_confirmed_absent_exit_code(self):
        self.make_run(exit_code=None)
        result = self.run_dispatch("list", STATE="stopped", LIST_WORKER="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("owner/repo\tfalse\t-", result.stdout)

    def test_stopped_finish_retains_vm_when_snapshot_tree_fails(self):
        self.make_run()
        result = self.run_dispatch("finish", SANDBOX, "--force", STATE="stopped", TREE_FAIL="1")
        self.assert_vm_retained(result)
        self.assertIn("snapshot tree unavailable", result.stderr)
        self.assertFalse([call for call in self.recorded_calls() if call[:3] == ["boat", "snapshot", "pull"]])

    def test_stopped_collection_rejects_unrecognised_snapshot_tree(self):
        self.make_run()
        for tree in ('', 'not json', '{}', '{"paths":null}', '{"paths":[7]}',
                     '{"paths":["run/exit-code"]}', '{"paths":["/home/user/run/../exit-code"]}',
                     '{"paths":[]}\\n{"paths":[]}', '{"paths":[],"error":"truncated"}'):
            for command in (("finish", SANDBOX, "--force"), ("list",)):
                with self.subTest(tree=tree, command=command):
                    self.calls.write_text("")
                    result = self.run_dispatch(*command, STATE="stopped", LIST_WORKER="1", TREE_OUTPUT=tree)
                    self.assert_vm_retained(result)
                    if command == ("list",):
                        self.assertIn("UNAVAILABLE\tunknown\t-", result.stdout)
                    self.assertFalse([call for call in self.recorded_calls()
                                      if call[:3] == ["boat", "snapshot", "pull"]])

    def test_result_on_live_vm_transfers_report_not_worker_jsonl(self):
        run = self.make_run()
        event = {"type": "message_end", "message": {"role": "assistant", "content": [
            {"type": "text", "text": "done https://github.com/owner/repo/pull/7"}]}}
        noise = json.dumps({"type": "tool", "payload": "x" * 4000})
        (run / "worker.jsonl").write_text("\n".join([noise] * 500 + [json.dumps(event)]) + "\n")
        result = self.run_dispatch("result", SANDBOX)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Exit code: 0", result.stdout)
        self.assertIn("done https://github.com/owner/repo/pull/7", result.stdout)
        self.assertTrue(result.stdout.rstrip().endswith("https://github.com/owner/repo/pull/7"))
        calls = self.recorded_calls()
        self.assertFalse([call for call in calls if call[:2] in (["boat", "scp"], ["boat", "snapshot"])])
        sizes = [int(n) for n in (self.calls.parent / "calls.jsonl.ssh-bytes").read_text().split()]
        self.assertLess((run / "worker.jsonl").stat().st_size, 3_000_000)
        self.assertGreater((run / "worker.jsonl").stat().st_size, 1_000_000)
        self.assertLess(max(sizes), 1000)

    def test_result_without_exit_code_fails_on_live_vm(self):
        self.make_run(exit_code=None)
        result = self.run_dispatch("result", SANDBOX)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no exit-code", result.stderr)

    def test_finish_retains_vm_when_required_files_are_missing(self):
        for state in ("idle", "stopped"):
            with self.subTest(state=state):
                self.calls.write_text("")
                run = self.make_run()
                (run / "metadata.json").unlink()
                result = self.run_dispatch("finish", SANDBOX, STATE=state)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn(["boat", "delete", SANDBOX, "--yes", "--json"], self.recorded_calls())
        (self.make_run() / "exit-code").unlink()
        self.calls.write_text("")
        refused = self.run_dispatch("finish", SANDBOX, STATE="stopped")
        self.assertNotEqual(refused.returncode, 0)
        self.assertNotIn(["boat", "delete", SANDBOX, "--yes", "--json"], self.recorded_calls())
        forced = self.run_dispatch("finish", SANDBOX, "--force", STATE="stopped")
        self.assertEqual(forced.returncode, 0, forced.stderr)
        self.assertIn(["boat", "delete", SANDBOX, "--yes", "--json"], self.recorded_calls())

    def test_finish_attempts_both_teardowns_and_reports_each_failure(self):
        self.make_run()
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
