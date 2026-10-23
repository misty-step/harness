"""Run the installed CLI at native SSH/pass/Home and real t3-agent HTTP boundaries."""
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

from test_t3_agent import Handler, TOKEN

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "agent-config/bin/t3-access-renew"

# These stand-ins implement native executable protocols, not renewal internals.
BOUNDARY = r'''#!/usr/bin/env python3
import datetime as dt, json, os, pathlib, shlex, subprocess, sys, time
root = pathlib.Path(os.environ['FIXTURE'])
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
mode = (root / 'mode').read_text() if (root / 'mode').exists() else ''
with (root / 'calls').open('a') as f: f.write(json.dumps([name, *args]) + '\n')
if name == 'ssh':
    command = shlex.split(args[-1])
    assert args[:6] == ['-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes']
    assert args[6] == 'owner@example.test'
    assert command[:4] == ['exec', '$HOME/.local/bin/t3', 'auth', 'session']
    assert command[5:7] == ['--base-dir', '/home/owner/.t3']
    sessions = json.loads((root / 'sessions').read_text())
    if command[4] == 'list':
        print(json.dumps(sessions)); sys.exit()
    assert command[4] == 'issue'
    label = command[command.index('--label') + 1]
    assert command[7:] == ['--subject','mcp-client','--scope','orchestration:read','--ttl','30d','--label',label,'--json','--log-level','none']
    issued = dt.datetime.now(dt.timezone.utc)
    value = dict(sessionId=('replacement' if sessions[0]['sessionId'] == 'original' else 'replacement-next'), subject='mcp-client', scopes=['orchestration:read'],
                 method='bearer-access-token', client={'label':label,'deviceType':'bot'},
                 issuedAt=issued.isoformat(), expiresAt=(issued + dt.timedelta(days=30)).isoformat())
    if mode == 'wrong-scope': value['scopes'].append('access:write')
    if mode == 'wrong-subject': value['subject'] = 'cli-issued-session'
    if mode == 'wrong-ttl': value['expiresAt'] = (issued + dt.timedelta(days=31)).isoformat()
    sessions.append(value)
    (root / 'sessions').write_text(json.dumps(sessions))
    if mode == 'lost-response':
        print('synthetic-test-credential', file=sys.stderr); sys.exit(1)
    if mode == 'pause-issue':
        (root / 'paused').touch()
        time.sleep(30)
    value['token'] = 'synthetic-test-credential'
    print(json.dumps(value)); sys.exit()
if name == 'pass':
    if args[0] == 'git':
        if args[1] == 'config': print('false'); sys.exit()
        if mode == 'post-promotion-failed' and args[1] == 'commit' and args[-1] == 'test/watcher.gpg': sys.exit(1)
        if mode == 'stage-response-lost' and args[1] == 'commit' and '-renewal-' in args[-1]: sys.exit(1)
        sys.exit()
    path = pathlib.Path(os.environ['PASSWORD_STORE_DIR']) / (args[-1] + '.gpg')
    if args[0] == 'insert':
        if mode == 'stage-failed' and '-renewal-' in args[-1]:
            print('synthetic-test-credential'); sys.exit(1)
        if mode == 'promote-failed' and '-renewal-' not in args[-1]: sys.exit(1)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(sys.stdin.read())
        sys.exit()
    if args[0] == 'rm':
        path.unlink(); sys.exit()
    if args[0] == 'show':
        if not path.exists(): sys.exit(1)
        print(path.read_text(), end=''); sys.exit()
if name == 'pass-env':
    assert args[:2] == ['run', '-e'] and args[3] == '--'
    key, entry = args[2].split('=', 1)
    token = (pathlib.Path(os.environ['PASSWORD_STORE_DIR']) / (entry + '.gpg')).read_text().splitlines()[0]
    os.environ[key] = token
    if mode == 'candidate-failed' and '-renewal-' in entry:
        os.environ[key] = 'rejected-synthetic-token'
    os.execvp(args[4], args[4:])
if name == 'home':
    body = sys.stdin.read()
    if mode == 'home-failed': sys.exit(1)
    with (root / 'notifications').open('a') as f: f.write(body)
    sys.exit()
raise SystemExit('unexpected fixture command')
'''


class RenewalCLI(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = {**os.environ, "FIXTURE": str(self.root), "HOME": str(self.root),
                    "PATH": str(self.bin) + os.pathsep + os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1",
                    "PASSWORD_STORE_DIR": str(self.root / "store")}
        for name in ("ssh", "pass", "pass-env", "home", "systemctl"):
            path = self.bin / name
            path.write_text(BOUNDARY)
            path.chmod(0o700)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.requests = []
        self.server.fail = False
        worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.state = self.root / "approved.json"
        self.config = self.root / "watchers.toml"
        self.config.write_text(f'''[[servers]]
id = "example"
url = "http://127.0.0.1:{self.server.server_port}/mcp"
token_env = "TEST_WATCHER"
token_pass = "test/watcher"
[servers.renewal]
host = "example"
ssh = "owner@example.test"
base_dir = "/home/owner/.t3"
''')
        self.receipt = dict(host="example", role="watcher", subject="mcp-client", scopes=["orchestration:read"],
                            ttl="30d", sessionId="original", tokenPass="test/watcher",
                            expiresAt=(dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)).isoformat(),
                            previous=[{"sessionId": "obsolete-subject-session"}])
        self.other = {"host": "example", "role": "grok", "scopes": ["orchestration:operate"]}
        self.write_state()
        self.write_sessions()
        (self.root / "store/test").mkdir(parents=True)
        self.passfile().write_text("previous-synthetic-token\n")
        self.install()

    def install(self):
        result = subprocess.run([str(ROOT / "agent-config/install"), "--agent-dir", str(self.root / "agent"),
                                 "--home", str(self.root), "--t3-access-renew"],
                                env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        installed = self.root / ".local/bin"
        for name in ("t3-agent", "t3-access-renew"):
            self.assertEqual((installed / name).read_bytes(), (ROOT / "agent-config/bin" / name).read_bytes())
            shutil.copy2(installed / name, self.bin / name)
        self.cli = installed / "t3-access-renew"

    def passfile(self):
        return self.root / "store/test/watcher.gpg"

    def write_state(self):
        self.state.write_text(json.dumps({"approval": "synthetic approval", "credentials": {
            "watcher/example": self.receipt, "grok/example": self.other}}))

    def write_sessions(self):
        (self.root / "sessions").write_text(json.dumps([{
            **self.receipt, "method": "bearer-access-token", "client": {"deviceType": "bot", "label": "approved"},
            "issuedAt": (dt.datetime.fromisoformat(self.receipt["expiresAt"]) - dt.timedelta(days=30)).isoformat()}]))

    def call(self):
        return subprocess.run(self.command(), env=self.env, capture_output=True, text=True, timeout=30)

    def command(self):
        return [str(self.cli), "--config", str(self.config), "--state", str(self.state),
                "--report-url", "https://example.test/review"]

    def mode(self, value):
        (self.root / "mode").write_text(value)

    def calls(self):
        path = self.root / "calls"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def issued(self):
        return [call for call in self.calls() if call[0] == "ssh" and "session issue" in call[-1]]

    def state_value(self):
        return json.loads(self.state.read_text())["credentials"]["watcher/example"]

    def test_fresh_is_read_only_and_receipt_bytes_unchanged(self):
        self.receipt["expiresAt"] = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=20)).isoformat()
        self.write_state(); self.write_sessions()
        before = self.state.read_bytes()
        result = self.call()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(json.loads(result.stdout)["watchers"][0]["status"], "fresh")
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual([c[0] for c in self.calls()], ["ssh"])

    def test_exact_issuer_candidate_consumer_promotion_and_preserved_roles(self):
        result = self.call()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(self.issued()), 1)
        receipt = self.state_value()
        self.assertEqual(receipt["sessionId"], "replacement")
        self.assertEqual(receipt["previous"], self.receipt["previous"])
        self.assertEqual(json.loads(self.state.read_text())["credentials"]["grok/example"], self.other)
        names = [r.get("params", {}).get("name") for r in self.server.requests]
        self.assertEqual(names.count("t3_project_list"), 2)
        self.assertEqual(names.count("t3_environment_read"), 2)
        self.assertEqual(self.passfile().read_text().splitlines()[0], TOKEN)
        self.assertNotIn(TOKEN, result.stdout + result.stderr + self.state.read_text() + (self.root / "calls").read_text())
        self.assertEqual(self.call().returncode, 0)
        self.assertEqual(len(self.issued()), 1)

    def test_candidate_failure_preserves_current_and_recovers_without_reissue(self):
        self.mode("candidate-failed")
        first = self.call()
        self.assertEqual(first.returncode, 1)
        self.assertEqual(self.passfile().read_text(), "previous-synthetic-token\n")
        self.assertEqual(self.state_value()["sessionId"], "original")
        self.assertEqual(self.call().returncode, 1)
        self.assertEqual((self.root / "notifications").read_text().count("T3 watcher renewal on example failed:"), 1)
        self.mode("")
        self.assertEqual(self.call().returncode, 0)
        self.assertEqual(len(self.issued()), 1)
        messages = (self.root / "notifications").read_text()
        self.assertIn("recovered", messages)
        self.assertIn("[renewal evidence](https://example.test/review)", messages)
        self.assertNotIn(TOKEN, messages)

    def test_lost_issue_response_holds_instead_of_minting_again(self):
        self.mode("lost-response")
        self.assertEqual(self.call().returncode, 1)
        self.mode("")
        result = self.call()
        self.assertEqual(result.returncode, 1)
        self.assertIn("issuance-held", result.stdout)
        self.assertIn("1 matching sessions", result.stdout)
        self.assertEqual(len(self.issued()), 1)
        self.assertNotIn(TOKEN, result.stdout + result.stderr + (self.root / "notifications").read_text())

    def test_stage_write_acknowledgement_loss_recovers_encrypted_candidate(self):
        self.mode("stage-response-lost")
        (self.root / "store/.git").mkdir()
        self.assertEqual(self.call().returncode, 1)
        self.assertEqual(self.state_value()["renewal"]["phase"], "issuing")
        self.mode("")
        self.assertEqual(self.call().returncode, 0)
        self.assertEqual(len(self.issued()), 1)

    def test_promotion_failure_keeps_pending_candidate_for_idempotent_retry(self):
        # A non-file current destination must be rejected before promotion.
        original = self.passfile().read_text()
        self.passfile().unlink()
        self.passfile().mkdir()
        self.assertEqual(self.call().returncode, 1)
        self.assertEqual(self.state_value()["renewal"]["phase"], "promoting")
        self.passfile().rmdir()
        self.passfile().write_text(original)
        self.assertEqual(self.call().returncode, 0)
        self.assertEqual(len(self.issued()), 1)

    def test_next_renewal_prunes_only_its_previous_encrypted_stage(self):
        self.assertEqual(self.call().returncode, 0)
        self.receipt = self.state_value()
        stage = self.root / "store" / (self.receipt["lastRenewal"]["stagePass"] + ".gpg")
        self.assertTrue(stage.is_file())
        self.receipt["expiresAt"] = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)).isoformat()
        self.write_state(); self.write_sessions()
        self.assertEqual(self.call().returncode, 0)
        self.assertFalse(stage.exists())
        self.assertEqual(self.state_value()["sessionId"], "replacement-next")
        self.assertEqual(self.state_value()["previous"], self.receipt["previous"])
        self.assertEqual(len(self.issued()), 2)

    def test_bad_native_scope_subject_and_ttl_cannot_promote(self):
        for mode in ("wrong-scope", "wrong-subject", "wrong-ttl"):
            with self.subTest(mode=mode):
                self.write_state(); self.write_sessions(); self.mode(mode)
                result = self.call()
                self.assertEqual(result.returncode, 1)
                self.assertEqual(self.passfile().read_text(), "previous-synthetic-token\n")
                self.assertNotIn(TOKEN, result.stdout + result.stderr)

    def test_missing_native_label_after_lost_response_still_holds(self):
        self.mode("lost-response")
        self.assertEqual(self.call().returncode, 1)
        self.write_sessions()
        self.mode("")
        result = self.call()
        self.assertIn("0 matching sessions", result.stdout)
        self.assertEqual(len(self.issued()), 1)

    def test_post_promotion_failure_recovers_with_same_candidate(self):
        # A failing native Git receipt happens after the atomic credential swap.
        (self.root / "store/.git").mkdir()
        self.mode("post-promotion-failed")
        self.assertEqual(self.call().returncode, 1)
        self.assertEqual(self.passfile().read_text().splitlines()[0], TOKEN)
        self.assertEqual(self.state_value()["sessionId"], "original")
        self.assertEqual(self.state_value()["renewal"]["phase"], "promoting")
        self.mode("")
        self.assertEqual(self.call().returncode, 0)
        self.assertEqual(len(self.issued()), 1)

    def test_duplicate_candidate_label_cannot_promote(self):
        self.mode("candidate-failed")
        self.assertEqual(self.call().returncode, 1)
        sessions = json.loads((self.root / "sessions").read_text())
        sessions.append({**sessions[-1], "sessionId": "duplicate"})
        (self.root / "sessions").write_text(json.dumps(sessions))
        self.mode("")
        self.assertIn("ambiguous-candidate-label", self.call().stdout)
        self.assertEqual(self.passfile().read_text(), "previous-synthetic-token\n")
        self.assertEqual(len(self.issued()), 1)

    def test_stage_storage_failure_remains_held(self):
        self.mode("stage-failed")
        self.assertEqual(self.call().returncode, 1)
        self.mode("")
        self.assertIn("issuance-held", self.call().stdout)
        self.assertEqual(len(self.issued()), 1)

    def test_unknown_owner_store_and_unapproved_receipts_never_issue(self):
        (self.root / "sessions").write_text("[]")
        self.assertIn("tracked-session-missing", self.call().stdout)
        self.assertEqual(len(self.issued()), 0)
        self.receipt["scopes"].append("access:write")
        self.write_state()
        self.assertIn("unapproved-watcher-receipt", self.call().stdout)
        self.assertEqual(len(self.issued()), 0)

    def test_lock_rejects_competing_scan(self):
        lock = self.state.with_name(self.state.name + ".renewal.lock")
        with lock.open("a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.call()
            self.assertIn("renewal-locked", result.stderr)
            self.assertEqual(self.calls(), [])

    def test_home_delivery_failure_retries_on_next_scan(self):
        self.mode("home-failed")
        (self.root / "sessions").write_text("[]")
        result = self.call()
        self.assertIn("notification-failed", result.stdout)
        self.mode("")
        self.assertEqual(self.call().returncode, 1)
        self.assertIn("failed:", (self.root / "notifications").read_text())


    @unittest.skipUnless(shutil.which("pass") and shutil.which("gpg") and shutil.which("bun"),
                         "native encrypted-store proof needs pass, GPG and Bun")
    def test_native_gpg_pass_and_pass_env_rejection_then_atomic_promotion(self):
        self.env.update(GIT_AUTHOR_NAME="Harness QA", GIT_AUTHOR_EMAIL="qa@example.test",
                        GIT_COMMITTER_NAME="Harness QA", GIT_COMMITTER_EMAIL="qa@example.test")
        self.env["GNUPGHOME"] = str(self.root / "gnupg")
        Path(self.env["GNUPGHOME"]).mkdir(mode=0o700)
        self.env["PASSWORD_STORE_GPG_OPTS"] = "--batch --yes --pinentry-mode loopback"
        native_pass = shutil.which("pass")
        (self.bin / "pass").unlink()
        (self.bin / "pass").symlink_to(native_pass)
        def native(command, data=None):
            result = subprocess.run(command, input=data, env=self.env, capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, "native encrypted-store boundary failed: " + command[0])
            return result.stdout
        native(["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase", "", "--quick-generate-key",
                "Harness QA <qa@example.test>", "rsa2048", "encrypt", "1d"])
        keys = native(["gpg", "--list-keys", "--with-colons"])
        fingerprint = next(line.split(":")[9] for line in keys.splitlines() if line.startswith("fpr:"))
        native(["pass", "init", fingerprint])
        native(["pass", "git", "init"])
        self.passfile().unlink()
        native(["pass", "insert", "--multiline", "--force", "test/watcher"], "previous-synthetic-token\n")
        original = self.passfile().read_bytes()
        native([str(ROOT / "agent-config/install"), "--agent-dir", str(self.root / "agent"),
                "--home", str(self.root), "--bin", "pass-env.ts"])
        shutil.copy2(self.root / ".local/bin/pass-env", self.bin / "pass-env")
        unrelated = self.root / "store/unrelated.txt"
        unrelated.write_text("unrelated staged content\n")
        native(["pass", "git", "add", "unrelated.txt"])
        self.server.fail = True
        result = self.call()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.passfile().read_bytes(), original)
        self.assertEqual(native(["pass", "git", "diff", "--cached", "--name-only"]).strip(), "unrelated.txt",
                         "staging must preserve the shared index")
        self.server.fail = False
        result = self.call()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(self.issued()), 1)
        self.assertEqual(native(["pass", "show", "test/watcher"]).splitlines()[0], TOKEN)
        self.assertNotIn(TOKEN.encode(), self.passfile().read_bytes())
        self.assertNotIn(TOKEN, self.state.read_text() + result.stdout + result.stderr)
        # The stage and promoted ciphertext were generated by pass, not the fixture.
        self.assertEqual(self.state_value()["sessionId"], "replacement")
        self.assertEqual(native(["pass", "git", "diff", "--cached", "--name-only"]).strip(), "unrelated.txt")
        self.assertEqual(self.call().returncode, 0)

    def test_installer_loads_cli_and_daily_units_without_activation(self):
        result = subprocess.run([str(self.cli), "--help"], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("--report-url", result.stdout)
        units = self.root / ".config/systemd/user"
        for suffix in ("service", "timer"):
            name = "t3-access-renew." + suffix
            self.assertEqual((units / name).read_bytes(), (ROOT / "agent-config/t3-access" / name).read_bytes())
        self.assertIn("OnCalendar=daily", (units / "t3-access-renew.timer").read_text())
        self.assertIn("Persistent=true", (units / "t3-access-renew.timer").read_text())
        self.assertNotIn("systemctl", [c[0] for c in self.calls()])
        (units / "t3-access-renew.service").write_text("foreign unit\n")
        result = subprocess.run([str(ROOT / "agent-config/install"), "--agent-dir", str(self.root / "agent"),
                                 "--home", str(self.root), "--t3-access-renew"], env=self.env,
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("foreign T3 renewal", result.stderr)


if __name__ == "__main__":
    unittest.main()
