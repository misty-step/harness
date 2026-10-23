"""Exercise owner/reader routing with synthetic data and no host commands."""
import contextlib
import datetime as dt
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from test_roster import fixture


class ReaderCommands(unittest.TestCase):
    def setUp(self):
        config = fixture()
        config["hosts"] = {"authority": ""}
        config["claude"] = []
        config["codex"] = [config["codex"][0]]
        self.account = config["codex"][0]["account"]
        config["plain_hosts"] = {
            "plain": {"dest": "plain.example.test", "codex": {self.account: "~/.codex"}},
            "pull": {"pull": True, "codex": {self.account: "~/.codex"}},
        }
        path = Path(__file__).with_name("t3-accounts")
        loader = importlib.machinery.SourceFileLoader("accounts_under_test", str(path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        self.app = importlib.util.module_from_spec(spec)
        with patch.object(Path, "read_text", return_value=json.dumps(config)), \
                patch("subprocess.run", side_effect=AssertionError("unexpected host command")):
            loader.exec_module(self.app)
        self.app.NOW = dt.datetime(2026, 10, 23, tzinfo=dt.timezone.utc)
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.app.PULL_DIR = Path(self.scratch.name) / "pull"
        self.original_py = self.app.py
        self.py = self.enterContext(patch.object(self.app, "py", side_effect=AssertionError("unexpected py")))
        self.run = self.enterContext(patch.object(self.app, "run", side_effect=AssertionError("unexpected run")))

    def owner_info(self):
        return {"present": True, "has_refresh": True, "last_refresh": self.app.NOW.isoformat(),
                "access_exp": (self.app.NOW + dt.timedelta(days=5)).isoformat(), "access_sha": "owner"}

    def test_plain_push_preserves_own_refresh_token(self):
        def inspect(host, code, home):
            self.assertEqual(code, self.app.CODEX_INFO)
            return self.owner_info()

        self.py.side_effect = inspect
        log, problems, owners = [], [], {}
        self.app.sync_codex(log, problems, {}, owners)
        self.assertEqual([c.args[0] for c in self.py.call_args_list], ["authority", "plain"])
        self.run.assert_not_called()
        self.assertEqual(log, [])
        self.assertEqual(problems, [])
        self.assertIn(self.account, owners)

    def test_plain_push_uses_owner_snapshot_and_skips_pull_host(self):
        snap = {"payload": {"tokens": {"access_token": "synthetic-access", "refresh_token": ""}}}
        self.py.side_effect = None
        self.py.side_effect = [self.owner_info(), {"present": False}, snap, {"result": "written"}]
        self.run.side_effect = None
        log, problems = [], []
        self.app.sync_codex(log, problems, {}, {})
        self.assertEqual([c.args[0] for c in self.py.call_args_list],
                         ["authority", "plain", "authority", "plain"])
        write = self.py.call_args_list[-1]
        self.assertEqual(write.args[:3], ("plain", self.app.CODEX_WRITE_READER, "~/.codex"))
        self.assertEqual(json.loads(write.kwargs["stdin"]), snap)
        self.assertEqual(problems, [])
        self.assertIn("written", log[0])
        self.run.assert_not_called()

    def test_plain_health_quotes_home_and_expands_tilde(self):
        for home in ("~", "~/", "~/codex with spaces; touch injected", "/tmp/codex 'quoted'; touch injected", "$(touch injected)"):
            with self.subTest(home=home):
                def execute(host, script):
                    result = subprocess.run(
                        ["bash", "-c", 'timeout() { shift; "$@"; }; codex() { printf "Logged in %s\\n" "$CODEX_HOME"; }; ' + script],
                        env=dict(os.environ, HOME=self.scratch.name), cwd=self.scratch.name,
                        text=True, capture_output=True, check=True)
                    expected = self.scratch.name + home[1:] if home == "~" or home.startswith("~/") else home
                    self.assertEqual(result.stdout, "Logged in " + expected + "\n")
                    self.assertFalse((Path(self.scratch.name) / "injected").exists())
                    return result.returncode, result.stdout
                self.run.side_effect = execute
                self.assertEqual(self.app.plain_codex_status("plain", home), "ready")

    def test_python_remote_arguments_are_shell_quoted(self):
        home = "~/home with 'quotes'; $(touch injected)"
        account = "person'; touch injected; #@example.test"
        self.run.side_effect = None
        self.run.return_value = (0, "{}")
        with patch.object(self.app, "py", self.original_py):
            self.app.py("plain", "print('{}')", home, account)
        self.assertEqual(shlex.split(self.run.call_args.args[1]),
                         ["python3", "-c", "print('{}')", home, account])

    def test_reader_writer_creates_private_home(self):
        home = Path(self.scratch.name) / "private reader"
        payload = {"payload": {"tokens": {"access_token": "synthetic-access", "refresh_token": ""}}}
        with patch.dict(os.environ, HOME=self.scratch.name), \
                patch("sys.argv", ["writer", str(home), "reader"]), \
                patch("sys.stdin", io.StringIO(json.dumps(payload))), \
                contextlib.redirect_stdout(io.StringIO()):
            exec(self.app.CODEX_WRITE_READER, {})
        self.assertEqual(home.stat().st_mode & 0o777, 0o700)
        self.assertEqual((home / "auth.json").stat().st_mode & 0o777, 0o600)

    def report(self):
        return {"accounts": {self.account: {
            "live": "ready", "has_refresh": False,
            "last_refresh": self.app.NOW.isoformat(),
            "access_exp": (self.app.NOW + dt.timedelta(days=5)).isoformat()}}}

    def write_report(self, *, age=0, live="ready", expires=120):
        report = {"at": (self.app.NOW - dt.timedelta(hours=age)).isoformat(), "accounts": {
            self.account: {"live": live, "has_refresh": False, "last_refresh": self.app.NOW.isoformat(),
                           "access_exp": (self.app.NOW + dt.timedelta(hours=expires)).isoformat()}}}
        self.app.PULL_DIR.mkdir(exist_ok=True)
        (self.app.PULL_DIR / "pull.json").write_text(json.dumps(report))

    def test_pull_report_health_and_expiry(self):
        for age, live, expires, expected in (
            (4, "ready", 120, [f"codex-plain:pull:{self.account}"]),
            (0, "unauthenticated", 120, [f"codex-plain:pull:{self.account}"]),
            (0, "ready", 47, [f"codex-reader-expiry:pull:{self.account}"]),
            (3, "ready", 48, []),
        ):
            with self.subTest(age=age, live=live, expires=expires):
                self.write_report(age=age, live=live, expires=expires)
                problems, table = [], []
                self.app.check_pull("pull", self.app.PLAIN["pull"], problems, {}, table)
                self.assertEqual([p[0] for p in problems], expected)
                if age > 3:
                    self.assertIn("4.0h old", problems[0][1])
                    self.assertEqual(table, [])
                else:
                    self.assertEqual(len(table), 1)
        self.py.assert_not_called()
        self.run.assert_not_called()

    def test_plain_health_uses_codex_cli_and_pull_report(self):
        self.write_report()
        self.py.side_effect = None
        self.py.return_value = dict(self.owner_info(), has_refresh=False)
        self.run.side_effect = None
        self.run.return_value = (0, "Logged in using ChatGPT\n")
        problems, table = [], []
        self.app.check_plain(problems, {}, table)
        self.assertEqual(problems, [])
        self.assertEqual([row[1] for row in table], ["plain", "pull"])
        self.run.assert_called_once()
        host, script = self.run.call_args.args
        self.assertEqual(host, "plain")
        self.assertIn("codex login status", script)
        self.assertNotIn("bun", script)

    def test_reader_payload_refuses_nonblank_refresh_token(self):
        self.py.side_effect = None
        self.py.return_value = {"payload": {"tokens": {
            "access_token": "synthetic-access", "refresh_token": "synthetic-refresh"}}}
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaisesRegex(SystemExit, "owner snapshot unusable"):
            self.app.cmd_reader_payload(self.account)
        self.assertEqual(output.getvalue(), "")
        self.py.assert_called_once_with("authority", self.app.CODEX_READER_PAYLOAD, "~/.codex0")

    def test_reader_snapshot_blanks_refresh_token_on_owner(self):
        source = {"tokens": {"access_token": "synthetic-access", "refresh_token": "synthetic-refresh"}}
        output = io.StringIO()
        with patch("builtins.open", return_value=io.StringIO(json.dumps(source))), \
                patch("sys.argv", ["snapshot", "~/.codex"]), contextlib.redirect_stdout(output):
            exec(self.app.CODEX_READER_PAYLOAD, {})
        self.assertEqual(json.loads(output.getvalue())["payload"]["tokens"]["refresh_token"], "")

    def test_pull_report_stamps_receipt_time(self):
        report = dict(self.report(), at="untrusted-time")
        output = io.StringIO()
        with patch("sys.stdin", io.StringIO(json.dumps(report))), contextlib.redirect_stdout(output):
            self.app.cmd_pull_report("pull")
        stored = json.loads((self.app.PULL_DIR / "pull.json").read_text())
        self.assertEqual(stored, dict(report, at=self.app.NOW.isoformat()))
        self.assertEqual(output.getvalue(), "recorded\n")

    def test_pull_report_rejects_unconfigured_nonpull_and_escaping_hosts(self):
        outside = Path(self.scratch.name) / "outside"
        outside.mkdir()
        target = outside / "auth.json"
        target.write_text("preserved")
        cases = ("unknown", "plain", str(outside / "auth"), "../outside/auth", "nested/report")
        for host in cases:
            with self.subTest(host=host):
                if host not in ("unknown", "plain"):
                    self.app.PLAIN[host] = {"pull": True, "codex": {self.account: "~/.codex"}}
                with patch("sys.stdin", io.StringIO(json.dumps(self.report()))), \
                        contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as caught:
                    self.app.cmd_pull_report(host)
                self.assertIsInstance(caught.exception.code, str)
                self.assertEqual(target.read_text(), "preserved")
        self.assertFalse(self.app.PULL_DIR.exists())

    def test_pull_report_rejects_symlink_outside_report_directory(self):
        target = Path(self.scratch.name) / "outside.json"
        target.write_text("preserved")
        self.app.PULL_DIR.mkdir()
        (self.app.PULL_DIR / "pull.json").symlink_to(target)
        with patch("sys.stdin", io.StringIO(json.dumps(self.report()))), self.assertRaises(SystemExit):
            self.app.cmd_pull_report("pull")
        self.assertEqual(target.read_text(), "preserved")

    def test_pull_report_cli_rejects_invalid_input_and_accepts_valid_report(self):
        home = Path(self.scratch.name)
        config_path = home / ".config/t3-accounts/accounts.json"
        config_path.parent.mkdir(parents=True)
        config_path.write_text(json.dumps(self.app.CONFIG))
        command = Path(__file__).with_name("t3-accounts")
        for host, content in (("unknown", json.dumps(self.report())), ("plain", json.dumps(self.report())),
                              ("../outside", json.dumps(self.report())), ("pull", "{invalid"),
                              ("pull", json.dumps({"accounts": []})), ("pull", json.dumps(self.report()))):
            with self.subTest(host=host, content=content):
                result = subprocess.run([str(command), "pull-report", host], input=content,
                                        env=dict(os.environ, HOME=str(home)), text=True, capture_output=True)
                if host == "pull" and content == json.dumps(self.report()):
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout, "recorded\n")
                    stored = home / ".local/state/t3-accounts/pull/pull.json"
                    self.assertEqual(json.loads(stored.read_text())["accounts"], self.report()["accounts"])
                    self.assertEqual(stored.stat().st_mode & 0o777, 0o600)
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, "")
                    self.assertIn("invalid", result.stderr)
                    self.assertNotIn("Traceback", result.stderr)

    def invalid_reports(self):
        yield "{invalid JSON"
        for value in (None, [], {}, {"accounts": []}, {"accounts": {"unknown@example.test": {}}}):
            yield json.dumps(value)
        for field, values in {
            "live": [None, "unreachable", 1, []],
            "has_refresh": [None, "false", 0, []],
            "access_exp": ["invalid-date", "2026-10-24T21:00:00.000000not-a-timezone", "", 123, [], {}],
            "last_refresh": ["invalid-date", "2026-10-24T21:00:00.000000not-a-timezone", "", 123, [], {}],
        }.items():
            for value in values:
                report = self.report()
                report["accounts"][self.account][field] = value
                yield json.dumps(report)
        for value in (None, [], "ready"):
            yield json.dumps({"accounts": {self.account: value}})
        report = self.report()
        del report["accounts"][self.account]["has_refresh"]
        yield json.dumps(report)

    def test_invalid_pull_reports_fail_without_replacing_prior_report(self):
        self.write_report()
        target = self.app.PULL_DIR / "pull.json"
        before = target.read_bytes()
        for content in self.invalid_reports():
            with self.subTest(content=content), patch("sys.stdin", io.StringIO(content)), \
                    contextlib.redirect_stdout(io.StringIO()) as output, self.assertRaises(SystemExit) as caught:
                self.app.cmd_pull_report("pull")
            self.assertIsInstance(caught.exception.code, str)
            self.assertIn("invalid", caught.exception.code)
            self.assertEqual(output.getvalue(), "")
            self.assertEqual(target.read_bytes(), before)

    def test_bad_stored_reports_produce_problems_and_status_still_runs(self):
        self.write_report()
        invalid = list(self.invalid_reports())
        invalid += [json.dumps(dict(self.report(), at=at)) for at in (None, "bad-date", 123, [])]
        self.run.side_effect = None
        self.run.return_value = (0, "Logged in using ChatGPT\n")
        for content in invalid:
            with self.subTest(content=content):
                (self.app.PULL_DIR / "pull.json").write_text(content)
                problems, table = [], []
                self.app.check_pull("pull", self.app.PLAIN["pull"], problems, {}, table)
                self.assertEqual(len(problems), 1)
                self.assertEqual(table, [])
                with patch.object(self.app, "sync_helpers"), patch.object(self.app, "all_statuses", return_value={}), \
                        contextlib.redirect_stdout(io.StringIO()) as output:
                    self.app.cmd_status()
                self.assertIn("invalid", output.getvalue())

    def test_unreadable_report_produces_problem(self):
        with patch.object(Path, "read_text", side_effect=PermissionError("denied")):
            problems = []
            self.app.check_pull("pull", self.app.PLAIN["pull"], problems, {}, [])
        self.assertEqual(len(problems), 1)
        self.assertIn("unreadable", problems[0][1])

    def test_ready_report_without_expiry_is_low_problem(self):
        for missing in (False, True):
            report = self.report()
            report["accounts"][self.account]["access_exp"] = None
            report["accounts"][self.account]["last_refresh"] = None
            if missing:
                del report["accounts"][self.account]["access_exp"]
            with patch("sys.stdin", io.StringIO(json.dumps(report))), contextlib.redirect_stdout(io.StringIO()):
                self.app.cmd_pull_report("pull")
            problems, table = [], []
            self.app.check_pull("pull", self.app.PLAIN["pull"], problems, {}, table)
            self.assertEqual(len(problems), 1)
            self.assertEqual(problems[0][2], "low")
            self.assertIn("expiry", problems[0][1])
            self.assertEqual(len(table), 1)

    def test_report_timestamp_preserves_fractional_seconds_and_offsets(self):
        report = self.report()
        report["accounts"][self.account]["access_exp"] = "2026-10-24T21:00:00.000000123-05:00"
        report["accounts"][self.account]["last_refresh"] = "2026-10-23T00:00:00.123456789Z"
        with patch("sys.stdin", io.StringIO(json.dumps(report))), contextlib.redirect_stdout(io.StringIO()):
            self.app.cmd_pull_report("pull")
        problems, table = [], []
        self.app.check_pull("pull", self.app.PLAIN["pull"], problems, {}, table)
        self.assertEqual(problems, [])
        self.assertEqual(len(table), 1)
        self.assertEqual(self.app.parse_time(report["accounts"][self.account]["last_refresh"]).microsecond, 123456)

    def test_report_publish_is_atomic_and_private(self):
        self.write_report(age=1)
        target = self.app.PULL_DIR / "pull.json"
        old = target.read_bytes()
        replace = os.replace
        def inspect_replace(source, dest):
            self.assertEqual(Path(source).parent, self.app.PULL_DIR)
            self.assertEqual(Path(source).stat().st_mode & 0o777, 0o600)
            self.assertEqual(Path(dest), target)
            self.assertEqual(target.read_bytes(), old)
            problems, table = [], []
            self.app.check_pull("pull", self.app.PLAIN["pull"], problems, {}, table)
            self.assertEqual(problems, [])
            json.loads(Path(source).read_text())
            replace(source, dest)
        with patch("os.replace", side_effect=inspect_replace) as publish, \
                patch("sys.stdin", io.StringIO(json.dumps(self.report()))), contextlib.redirect_stdout(io.StringIO()):
            self.app.cmd_pull_report("pull")
        publish.assert_called_once()
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.app.PULL_DIR.iterdir()), [target])

    def test_failed_publish_preserves_report_and_cleans_temp(self):
        self.write_report()
        target = self.app.PULL_DIR / "pull.json"
        old = target.read_bytes()
        with patch("os.replace", side_effect=OSError("failed")), \
                patch("sys.stdin", io.StringIO(json.dumps(self.report()))), \
                self.assertRaises((SystemExit, OSError)):
            self.app.cmd_pull_report("pull")
        self.assertEqual(target.read_bytes(), old)
        self.assertEqual(list(self.app.PULL_DIR.iterdir()), [target])

    def test_retired_accounts_are_skipped_by_checks_status_and_pushes(self):
        self.write_report()
        for retired in ("codex-0", "reader-0"):
            with self.subTest(retired=retired):
                self.app.CONFIG["retired"] = [retired]
                self.py.reset_mock()
                self.py.side_effect = lambda *args, **kwargs: self.owner_info()
                problems, table, log = [], [], []
                self.app.check_plain(problems, {}, table)
                self.assertEqual(problems, [])
                self.assertEqual(table, [])
                self.py.assert_not_called()
                self.app.sync_codex(log, problems, {}, {})
                self.assertTrue(all(c.args[0] == "authority" for c in self.py.call_args_list))
                self.assertEqual(log, [])
                with patch.object(self.app, "sync_helpers"), patch.object(self.app, "all_statuses", return_value={}), \
                        contextlib.redirect_stdout(io.StringIO()) as output:
                    self.app.cmd_status()
                self.assertNotIn("ready", output.getvalue())
                self.run.assert_not_called()

    def test_roster_ignores_plain_hosts(self):
        config = fixture()
        expected = self.app.roster(config)
        config["plain_hosts"] = self.app.PLAIN
        self.assertEqual(self.app.roster(config), expected)

    def test_keepalive_refreshes_only_selected_owner_then_syncs(self):
        self.py.side_effect = None
        self.py.side_effect = [self.owner_info(), {"result": "refreshed"}, self.owner_info()]
        with patch.object(self.app, "cmd_sync") as sync, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.app.cmd_keepalive(force=True, only=self.account), 0)
        self.assertEqual([c.args[0] for c in self.py.call_args_list], ["authority"] * 3)
        self.assertEqual(self.py.call_args_list[1].args,
                         ("authority", self.app.CODEX_KEEPALIVE, "~/.codex0", "1", "3.0"))
        sync.assert_called_once_with()

    def test_keepalive_failure_syncs_and_reports(self):
        self.py.side_effect = None
        self.py.side_effect = [self.owner_info(), {"result": "FAILED"}, self.owner_info()]
        with patch.object(self.app, "cmd_sync") as sync, patch.object(self.app, "post_home") as post, \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.app.cmd_keepalive(), 1)
        sync.assert_called_once_with()
        self.assertIn("keepalive FAILED", post.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
