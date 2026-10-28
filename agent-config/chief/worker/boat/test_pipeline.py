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
home = pathlib.Path(os.environ["VM_HOME"])
state_file = pathlib.Path(os.environ["CALLS"] + ".state")
state = state_file.read_text() if state_file.exists() else os.environ.get("STATE", "idle")
if args[0] == "list":
    sandboxes = []
    if os.environ.get("LIST_WORKER") == "1":
        sandboxes = [{"id": "bx_23456789", "name": "kaylee-test", "createdAt": "2026-01-01T00:00:00Z",
                      "state": state}]
    print(json.dumps({"sandboxes": sandboxes, "pageInfo": {"hasMore": False}}))
elif args[0] == "new":
    print(json.dumps({"event": "accepted", "id": "bx_23456789"}), flush=True)
    os.kill(os.getppid(), signal.SIGTERM)
    time.sleep(0.05)
    sys.exit(143)
elif args[0] == "info":
    print(json.dumps({"sandbox": {"name": "kaylee-test", "state": state}}))
elif args[0] == "ssh":
    remote = " ".join(args[2:]).replace("/home/user", str(home))
    payload = sys.stdin.buffer.read()
    done = subprocess.run(["bash", "-c", remote], cwd=home, input=payload,
                          env=dict(os.environ, HOME=str(home)), capture_output=True)
    output, code = done.stdout, done.returncode
    if "SSH_DROP_AFTER" in os.environ and b"tar -c" in payload:
        output, code = output[:int(os.environ["SSH_DROP_AFTER"])], 255
        sys.stderr.write("Connection closed by remote host\n")
    with open(os.environ["CALLS"] + ".transfers", "a") as transfers:
        transfers.write(json.dumps({"kind": "ssh", "bytes": len(output)}) + "\n")
    sys.stdout.buffer.write(output)
    sys.stderr.buffer.write(done.stderr)
    sys.exit(code)
elif args[0] == "scp":
    source = home / pathlib.Path(args[-2].split(":", 1)[1]).relative_to("/home/user")
    shutil.copytree(source, pathlib.Path(args[-1]) / source.name)
    with open(os.environ["CALLS"] + ".transfers", "a") as transfers:
        transfers.write(json.dumps({"kind": "scp", "files": [str(p.relative_to(home)) for p in source.rglob("*") if p.is_file()]}) + "\n")
elif args[:2] == ["snapshot", "tree"]:
    entries = [{"kind": "symlink" if p.is_symlink() else "dir" if p.is_dir() else "file",
                "path": str(p.relative_to(home))} for p in home.rglob("*")]
    print(json.dumps({"entries": entries, "fileCount": sum(e["kind"] == "file" for e in entries),
                      "generation": 1, "sandboxId": "bx_23456789", "snapshotId": "snap_fixture",
                      "totalSizeBytes": 0, "treeAvailable": True, "truncated": False}))
elif args[:2] == ["snapshot", "pull"]:
    if os.environ.get("PULL_FAIL") == "1":
        print('{"event":"error","error":"snapshot chunk download failed: connection reset by peer"}')
        sys.exit(1)
    out = pathlib.Path(args[args.index("--out") + 1]) / "home/user"
    source = home / pathlib.Path(args[args.index("--path") + 1]).relative_to("/home/user")
    target = out / source.relative_to(home)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, symlinks=True)
    print(json.dumps({"homeDir": str(out)}))
elif args[0] == "stop":
    state_file.write_text("stopped")
    print('{"stopped":true}')
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
import json, os, pathlib, tempfile, time
print(json.dumps({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"fixture completion"}]}}), flush=True)
with tempfile.NamedTemporaryFile() as scratch:
    pathlib.Path(os.environ["OMP_ENTERED"]).write_text(str(pathlib.Path(scratch.name).parent))
while not pathlib.Path(os.environ["OMP_RELEASE"]).exists():
    time.sleep(0.01)
'''


@unittest.skipUnless(sys.platform.startswith("linux"), "dispatcher targets the Linux chief host (GNU stat/date)")
class PipelineLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name) / "factory"
        self.vm = Path(self.temporary.name) / "vm"
        self.vm.mkdir()
        self.bin = self.home / ".local/bin"
        self.bin.mkdir(parents=True)
        self.calls = self.home / "calls.jsonl"
        self.env = dict(os.environ, HOME=str(self.home), CALLS=str(self.calls), VM_HOME=str(self.vm))
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
        run = self.vm / "run"
        run.mkdir(exist_ok=True)
        files = {"metadata.json": '{"repo":"owner/repo"}', **(files or {})}
        if exit_code is not None:
            files["exit-code"] = exit_code
        for name, content in files.items():
            path = run / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        return run

    def assert_vm_retained(self, result):
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("VM retained", result.stderr)
        calls = self.recorded_calls()
        self.assertFalse([call for call in calls if call[:2] == ["boat", "delete"]])
        self.assertFalse([call for call in calls if call[0] == "systemctl" and "disable" in call])

    def test_live_finish_transfers_only_allowlisted_regular_files(self):
        allowed = {"metadata.json", "brief.md", "launch.json", "started-at", "runner.pid",
                   "exit-code", "worker.jsonl", "worker.stderr", "clone.stdout", "clone.stderr",
                   "sessions/session.jsonl", "sessions/second session.jsonl"}
        run = self.make_run({name: name for name in allowed - {"metadata.json", "exit-code"}})
        (run / "gitleaks").write_bytes(b"\0" * 22_000_000)
        (run / "sessions/id").mkdir()
        (run / "sessions/id/artifact.bin").write_bytes(b"\1" * 6_000_000)
        (run / "sessions/id/subagent.jsonl").write_text("nested")
        (run / "sessions/artifact.bin").write_text("artifact")
        (run / "clone.stdout").unlink()
        (run / "clone.stdout").symlink_to(self.brief)
        (run / "launch.json").unlink()  # optional files may be absent
        result = self.run_dispatch("finish", SANDBOX)
        self.assertEqual(result.returncode, 0, result.stderr)
        retained = self.home / f".local/state/kaylee/runs/{SANDBOX}"
        self.assertEqual({str(p.relative_to(retained)) for p in retained.rglob("*") if p.is_file()},
                         (allowed - {"clone.stdout", "launch.json"}) | {"deletion.json"})
        for name in allowed - {"clone.stdout", "launch.json"}:
            self.assertEqual((run / name).read_bytes(), (retained / name).read_bytes())
        transfers = [json.loads(line) for line in Path(str(self.calls) + ".transfers").read_text().splitlines()]
        self.assertTrue(all(t["kind"] == "ssh" for t in transfers))
        self.assertLess(sum(t["bytes"] for t in transfers), 30_000)
        self.assertIn(["boat", "delete", SANDBOX, "--yes", "--json"], self.recorded_calls())

    def test_live_finish_retains_vm_when_ssh_drops_even_after_complete_tar(self):
        self.make_run({"worker.jsonl": "report"})
        for cut in ("500", "999999"):
            with self.subTest(cut=cut):
                self.calls.write_text("")
                result = self.run_dispatch("finish", SANDBOX, SSH_DROP_AFTER=cut)
                self.assert_vm_retained(result)
                self.assertIn("Connection closed by remote host", result.stderr)

    def test_live_finish_refuses_symlinked_sessions_directory(self):
        run = self.make_run()
        outside = self.vm / "outside"
        outside.mkdir()
        (outside / "secret.jsonl").write_text("not a report")
        (run / "sessions").symlink_to(outside, target_is_directory=True)
        self.assert_vm_retained(self.run_dispatch("finish", SANDBOX))

    def test_live_result_returns_final_text_and_unique_assistant_prs_only(self):
        def assistant(*texts):
            return {"type": "message_end", "message": {"role": "assistant",
                    "content": [{"type": "text", "text": text} for text in texts]}}
        events = [{"type": "tool", "payload": "x" * 2_000_000},
                  assistant("earlier https://github.com/o/r/pull/7"),
                  {"type": "message_end", "message": {"role": "user", "content": [
                      {"type": "text", "text": "https://github.com/o/r/pull/999"}]}},
                  assistant("Done λ '$HOME' \\ https://github.com/o/r/pull/8",
                            "https://github.com/o/r/pull/7"),
                  assistant("")]
        self.make_run({"worker.jsonl": "\n".join(map(json.dumps, events)) + "\n"})
        result = self.run_dispatch("result", SANDBOX)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "Exit code: 0\n\nDone λ '$HOME' \\ https://github.com/o/r/pull/8\n"
                         "https://github.com/o/r/pull/7\n\nPR URLs:\n"
                         "https://github.com/o/r/pull/7\nhttps://github.com/o/r/pull/8\n")
        calls = self.recorded_calls()
        self.assertEqual(sum(call[:2] == ["boat", "ssh"] for call in calls), 1)
        self.assertFalse([call for call in calls if call[:2] in (["boat", "scp"], ["boat", "snapshot"])])
        transfers = [json.loads(line) for line in Path(str(self.calls) + ".transfers").read_text().splitlines()]
        self.assertEqual(transfers, [{"kind": "ssh", "bytes": len(result.stdout.encode())}])

    def test_live_result_requires_exit_code(self):
        self.make_run(exit_code=None)
        result = self.run_dispatch("result", SANDBOX)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no exit-code", result.stderr)

    def test_stopped_commands_keep_whole_run_pull_and_fail_closed(self):
        self.make_run({"worker.jsonl": json.dumps({"type": "message_end", "message": {
            "role": "assistant", "content": [{"type": "text", "text": "report"}]}}) + "\n",
            "worker.stderr": "stderr\n", "sessions/id/nested.jsonl": "nested"})
        commands = [("finish", SANDBOX), ("finish", SANDBOX, "--force"), ("list",),
                    ("result", SANDBOX), ("logs", SANDBOX, "-n", "1")]
        for state in ("stopped", "archived"):
            for fail in ("0", "1"):
                for command in commands:
                    with self.subTest(state=state, fail=fail, command=command):
                        self.calls.write_text("")
                        result = self.run_dispatch(*command, STATE=state, LIST_WORKER="1", PULL_FAIL=fail)
                        self.assertEqual(result.returncode, int(fail), result.stderr)
                        snapshots = [call for call in self.recorded_calls() if call[:2] == ["boat", "snapshot"]]
                        self.assertEqual(len(snapshots), 1)
                        self.assertEqual(snapshots[0][2:6], ["pull", SANDBOX, "--path", "/home/user/run"])
                        if fail == "1":
                            self.assert_vm_retained(result)
                            if command == ("list",):
                                self.assertIn("UNAVAILABLE\tunknown\t-", result.stdout)
                        elif command == ("list",):
                            self.assertIn("owner/repo\ttrue\t0", result.stdout)
                        elif command[0] == "finish":
                            retained = self.home / f".local/state/kaylee/runs/{SANDBOX}"
                            self.assertEqual((retained / "sessions/id/nested.jsonl").read_text(), "nested")

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
            self.assertEqual(entered.read_text(), str(self.home / "scratch"))
            self.assertEqual((self.home / "scratch").stat().st_mode & 0o777, 0o700)
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
