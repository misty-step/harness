"""Exercise the installed producer, with fake identities and no native credentials."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def fixture():
    return {
        "hosts": {"authority": "", "reader": "reader.example.test"},
        "claude": [{"account": f"user{i}@example.test", "instance": f"claude-{i}",
                    "pass": f"workstation/CLAUDE_{i}", "keep": i == 0, "issued": "2026-10-23"}
                   for i in range(4)],
        "codex": [{"account": f"user{i}@example.test", "owner": ("reader" if i == 2 else "authority") + ":~/.codex" + str(i),
                   "instances": {"authority": f"codex-{i}", "*": f"reader-{i}"}, "keep": i == 0}
                  for i in range(3)],
        "watch_only": ["grok", "cursor", "antigravity", "opencode-openrouter"],
        "retired": ["claude-3"],
    }


class RosterCli(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.home = Path(self.scratch.name)
        self.env = dict(os.environ, HOME=str(self.home), PYTHONDONTWRITEBYTECODE="1")
        self.config = self.home / ".config/t3-accounts/accounts.json"
        self.config.parent.mkdir(parents=True)
        self.config.write_text(json.dumps(fixture()))
        subprocess.run([str(ROOT / "install"), "--agent-dir", str(self.home / ".agents"),
                        "--bin", "agent-accounts"], env=self.env, check=True)
        self.command = self.home / ".local/bin/agent-accounts"
        # Any accidental native plumbing call fails and leaves an observable marker.
        stubs = self.home / "stubs"
        stubs.mkdir()
        for name in ("ssh", "pass", "bun", "claude", "codex", "home"):
            stub = stubs / name
            stub.write_text('#!/bin/sh\ntouch "$HOME/unexpected-subprocess"\nexit 99\n')
            stub.chmod(0o755)
        self.env["PATH"] = str(stubs) + os.pathsep + self.env["PATH"]

    def run_cli(self, *args):
        return subprocess.run([str(self.command), *args], env=self.env, text=True, capture_output=True)

    def snapshot(self):
        return {str(p.relative_to(self.home)): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.home.rglob("*") if p.is_file()}

    def test_installed_roster_all_accounts_aliases_and_sources(self):
        before = self.snapshot()
        result = self.run_cli("roster", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(self.snapshot(), before)
        output = json.loads(result.stdout)
        self.assertEqual(set(output), {"schema_version", "source", "hosts", "accounts", "retired"})
        self.assertEqual(output["schema_version"], 1)
        self.assertEqual(output["source"], {"host": "authority", "path": "~/.config/t3-accounts/accounts.json"})
        self.assertEqual(output["hosts"], fixture()["hosts"])
        self.assertEqual(output["retired"], ["claude-3"])
        rows = output["accounts"]
        self.assertEqual(len(rows), 11)
        for i, row in enumerate(rows[:4]):
            self.assertEqual(row, {
                "provider": "anthropic", "email": f"user{i}@example.test", "email_reason": None,
                "tracking": "managed", "keep": i == 0,
                "instances": {"authority": f"claude-{i}", "reader": f"claude-{i}"},
                "credential_sources": [{"kind": "pass", "host": h, "entry": f"workstation/CLAUDE_{i}"}
                                       for h in ("authority", "reader")],
            })
        for i, row in enumerate(rows[4:7]):
            self.assertEqual(row, {
                "provider": "codex", "email": f"user{i}@example.test", "email_reason": None,
                "tracking": "managed", "keep": i == 0,
                "instances": {"authority": f"codex-{i}", "reader": f"reader-{i}"},
                "credential_sources": [{"kind": "codex_home", "host": "reader" if i == 2 else "authority", "home": f"~/.codex{i}"}],
            })
        for row, instance in zip(rows[7:], fixture()["watch_only"]):
            self.assertEqual(row, {
                "provider": instance, "email": None, "email_reason": "not_configured", "tracking": "watch_only",
                "keep": False, "instances": {h: instance for h in fixture()["hosts"]}, "credential_sources": [],
            })

    def test_secret_fields_and_native_files_are_not_output(self):
        data = fixture()
        data["access_token"] = "SECRET_SENTINEL"
        for entry in data["claude"] + data["codex"]:
            entry["refresh_token"] = "SECRET_SENTINEL"
        self.config.write_text(json.dumps(data))
        # Invalid native credential files would fail if the producer parsed them.
        for name in (".codex/auth.json", ".claude/.credentials.json"):
            p = self.home / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("SECRET_SENTINEL invalid json")
        before = self.snapshot()
        result = self.run_cli("roster", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("SECRET_SENTINEL", result.stdout + result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_invalid_configuration_fails_without_partial_output_or_values(self):
        variants = []
        for mutate in (
            lambda d: d["hosts"].update(reader=""),
            lambda d: d["hosts"].update(authority="ssh-authority"),
            lambda d: d["codex"][0].update(owner="missing:~/.codex"),
            lambda d: d["codex"][0].update(owner="authority:relative/home"),
            lambda d: d["codex"][0].update(instances={"authority": "codex-0"}),
            lambda d: d["codex"][0]["instances"].update(unknown="bad"),
            lambda d: d["claude"].append(copy.deepcopy(d["claude"][0])),
            lambda d: d["claude"][0].update(account="SECRET_SENTINEL"),
            lambda d: d["claude"][0].update(keep="yes"),
            lambda d: d["watch_only"].append("claude-0"),
            lambda d: d.update(retired="SECRET_SENTINEL"),
            lambda d: d.update(codex=None),
        ):
            d = fixture()
            mutate(d)
            variants.append(json.dumps(d))
        variants += ["{SECRET_SENTINEL", "null", "[]", "{}"]
        for content in variants:
            with self.subTest(content=content):
                self.config.write_text(content)
                before = self.snapshot()
                result = self.run_cli("roster", "--json")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr.strip(), "agent-accounts: roster configuration is unavailable or invalid")
                self.assertEqual(self.snapshot(), before)

    def test_watch_only_inventory_without_managed_accounts(self):
        data = fixture()
        data.update(claude=[], codex=[])
        self.config.write_text(json.dumps(data))
        result = self.run_cli("roster", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = json.loads(result.stdout)["accounts"]
        self.assertEqual([row["provider"] for row in rows], data["watch_only"])
        self.assertTrue(all(row["tracking"] == "watch_only" and not row["credential_sources"] for row in rows))

    def test_installed_command_cannot_spawn_connect_or_write(self):
        before = self.snapshot()
        wrapper = r"""
import runpy, sys
command = sys.argv[1]
sys.argv = [command, "roster", "--json"]
def guard(event, args):
    if event.startswith(("subprocess.", "socket.", "os.exec", "os.spawn")) or event in {
        "os.system", "os.mkdir", "os.remove", "os.rename", "os.rmdir", "os.chmod", "os.truncate", "os.symlink", "os.link"}:
        raise RuntimeError("unexpected side effect")
    if event == "open":
        mode, flags = args[1:3]
        if mode and any(c in mode for c in "wax+") or flags & 3:
            raise RuntimeError("unexpected write")
sys.addaudithook(guard)
runpy.run_path(command, run_name="__main__")
"""
        result = subprocess.run(["python3", "-c", wrapper, str(self.command)], env=self.env,
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(result.stdout)["accounts"]), 11)
        self.assertEqual(self.snapshot(), before)

    def test_missing_config_and_strict_arguments(self):
        self.config.unlink()
        result = self.run_cli("roster", "--json")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        for args in (("roster",), ("roster", "--json", "extra"), ("roster", "--bad")):
            result = self.run_cli(*args)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertEqual(result.stderr.strip(), "usage: agent-accounts roster --json")


if __name__ == "__main__":
    unittest.main()
