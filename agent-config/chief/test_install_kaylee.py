#!/usr/bin/env python3
"""Run the chief installer chain in private homes; no live Hermes or services."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


CHIEF = Path(__file__).resolve().parent

HERMES_FIXTURE = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
home = pathlib.Path(os.environ["HERMES_HOME"])
args = sys.argv[1:]
assert args[0] == "-p", args
profile, args = args[1], args[2:]
if args[:2] == ["config", "set"]:
    assert profile == "default", profile
    path = home / "config.json"
    config = json.loads(path.read_text()) if path.exists() else {}
    config[args[2]] = args[3]
    path.write_text(json.dumps(config))
elif args[:2] == ["cron", "list"]:
    path = home / "jobs.json"
    print(path.read_text() if path.exists() else "[]")
elif args[:2] == ["cron", "create"]:
    path = home / "jobs.json"
    jobs = json.loads(path.read_text()) if path.exists() else []
    jobs.append({"name": args[args.index("--name") + 1], "args": args})
    path.write_text(json.dumps(jobs))
elif args == ["gateway", "stop"]:
    sys.exit(1)  # A standalone legacy profile must still be parked.
else:
    raise RuntimeError(args)
'''


class ChiefSeedTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        self.hermes = self.home / "hermes"
        self.workspace = self.home / "workspace/factory"
        self.bin = self.home / ".local/bin"
        self.bin.mkdir(parents=True)
        self.env = dict(
            os.environ, HOME=str(self.home), HERMES_HOME=str(self.hermes),
            HERMES=str(self.bin / "hermes"), KAYLEE_WORKSPACE=str(self.workspace),
            KAYLEE_DELIVER="discord:fixture-owner", XDG_RUNTIME_DIR=str(self.home / "runtime"),
            KAYLEE_SKIP_DAYBOOK_CLONE="1",
        )
        gh = (
            '#!/bin/sh\n'
            'echo "$@" > "$HOME/gh-called"\n'
            '[ "$1 $2" = "repo clone" ] || exit 2\n'
            'git init -q "$4"\n'
        )
        for name, source in {
            "hermes": HERMES_FIXTURE,
            "gh": gh,
            "boat": "#!/bin/sh\nexit 0\n",
            "systemctl": "#!/bin/sh\nexit 0\n",
            # Never invoke sudo or write /etc, including through nested installers.
            # Record each call; only `rm` runs, on the installer's private unit directory.
            "sudo": (
                '#!/bin/sh\n'
                'echo "$@" >> "$HOME/sudo-calls"\n'
                'if [ "$1" = rm ]; then exec "$@"; fi\n'
            ),
        }.items():
            path = self.bin / name
            path.write_text(source)
            path.chmod(0o755)
        for relative in (".config/kaylee/boat-api-key", ".config/ascii/boat/config.json"):
            path = self.home / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture-only")

    def install(self):
        result = subprocess.run(
            ["bash", str(CHIEF / "install-kaylee.sh")], env=self.env,
            capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def config(self):
        return json.loads((self.hermes / "config.json").read_text())

    def owned_files(self):
        paths = [self.hermes / "SOUL.md", self.workspace / "AGENTS.md"]
        paths.extend(path for path in (self.hermes / "skills").rglob("*") if path.is_file())
        return {str(path.relative_to(self.home)): path.read_bytes() for path in paths}

    def test_fresh_home_gets_complete_seed(self):
        self.install()
        self.assertEqual((self.hermes / "SOUL.md").read_bytes(), (CHIEF / "SOUL.md").read_bytes())
        manual = self.workspace / "AGENTS.md"
        self.assertFalse(manual.is_symlink())
        self.assertEqual(manual.read_bytes(), (CHIEF / "AGENTS.md").read_bytes())
        for source in (CHIEF / "skills").rglob("*"):
            if source.is_file():
                self.assertEqual((self.hermes / "skills" / source.relative_to(CHIEF / "skills")).read_bytes(), source.read_bytes())
        config = self.config()
        self.assertEqual(config["memory.memory_enabled"], "true")
        self.assertEqual(config["memory.user_profile_enabled"], "true")
        self.assertEqual(config["memory.nudge_interval"], "10")
        self.assertEqual(config["skills.creation_nudge_interval"], "10")
        self.assertNotIn("hermes-agent-skill-authoring", json.loads(config["skills.disabled"]))
        self.assertNotIn("memory", json.loads(config["agent.disabled_toolsets"]))
        for platform in ("cli", "discord"):
            self.assertIn("memory", json.loads(config[f"platform_toolsets.{platform}"]))
        self.assertTrue((self.hermes / ".kaylee-seeded").is_file())
        jobs = json.loads((self.hermes / "jobs.json").read_text())
        self.assertEqual({job["name"] for job in jobs}, {"kaylee-workers", "kaylee-legacy-fleet"})
        self.assertTrue(os.access(self.bin / "kaylee-dispatch", os.X_OK))
        self.assertTrue((self.home / ".config/systemd/user/boat-tunnel@.service").is_file())

    def test_rerun_preserves_owned_state_but_restores_boundaries(self):
        self.install()
        original = self.config()
        boundaries = {
            "delegation.backend", "delegation.backends", "plugins.enabled", "plugins.disabled",
            "kanban.dispatch_in_gateway", "kanban.review_dispatch", "kanban.auto_decompose",
            "kanban.dispatch_profiles", "gateway.allow_all_users",
            "platforms.discord.unauthorized_dm_behavior", "discord.allow_bots",
            "approvals.mode", "approvals.cron_mode", "approvals.single_query_mode",
            "approvals.unattended_mode", "command_allowlist",
        }
        seeds = set(original) - boundaries
        self.assertFalse((self.workspace / "AGENTS.md").is_symlink())
        for relative in self.owned_files():
            (self.home / relative).write_bytes(b"Kaylee's evolved state\n")
        extra = self.hermes / "skills/boat-dispatch/learned.md"
        extra.write_text("A learned procedure\n")
        before = self.owned_files()
        changed = {key: f"Kaylee changed {key}" for key in original}
        (self.hermes / "config.json").write_text(json.dumps(changed))
        jobs = self.hermes / "jobs.json"
        custom_jobs = [{"name": "kaylee-workers", "args": ["Kaylee's routine"]}]
        jobs.write_text(json.dumps(custom_jobs))
        legacy = self.hermes / "profiles/builder"
        legacy.mkdir(parents=True)
        output = self.install()
        self.assertEqual(self.owned_files(), before)
        config = self.config()
        self.assertEqual({key: config[key] for key in seeds}, {key: changed[key] for key in seeds})
        self.assertEqual({key: config[key] for key in boundaries}, {key: original[key] for key in boundaries})
        self.assertTrue((legacy / "gateway.parked").is_file())
        after_jobs = json.loads(jobs.read_text())
        self.assertEqual(after_jobs[0], custom_jobs[0])
        self.assertEqual([job["name"] for job in after_jobs], ["kaylee-workers", "kaylee-legacy-fleet"])
        for path in (self.hermes / "SOUL.md", self.workspace / "AGENTS.md", *(self.hermes / "skills").iterdir()):
            self.assertIn(f"kept {path}", output)
        self.assertIn("kept seeded config", output)

    def test_daybook_clone_is_skipped_when_directory_exists(self):
        clone = self.home / "development/moomooskycow/daybook"
        clone.mkdir(parents=True)
        (clone / "marker").write_text("existing clone\n")
        del self.env["KAYLEE_SKIP_DAYBOOK_CLONE"]
        output = self.install()
        self.assertIn(f"kept {clone}", output)
        self.assertEqual(os.listdir(clone), ["marker"])
        self.assertFalse((self.home / "gh-called").exists())

    def test_daybook_clone_is_made_once_with_kaylee_identity(self):
        del self.env["KAYLEE_SKIP_DAYBOOK_CLONE"]
        output = self.install()
        clone = self.home / "development/moomooskycow/daybook"
        self.assertIn(f"cloned {clone}", output)
        self.assertEqual((self.home / "gh-called").read_text().split(), ["repo", "clone", "moomooskycow/daybook", str(clone)])
        identity = lambda key: subprocess.run(
            ["git", "-C", str(clone), "config", "--local", key], capture_output=True, text=True, check=True,
        ).stdout.strip()
        self.assertEqual(identity("user.name"), "Kaylee")
        self.assertEqual(identity("user.email"), "kaylee@agents.misty-step.com")
        (self.home / "gh-called").unlink()
        self.assertIn(f"kept {clone}", self.install())
        self.assertFalse((self.home / "gh-called").exists())

    def test_retired_daybook_timer_units_are_removed_idempotently(self):
        units = self.home / "etc-systemd-system"
        units.mkdir()
        retired = [f"daybook-re{'fresh'}.{kind}" for kind in ("timer", "service")]
        for name in retired:
            (units / name).write_text("retired\n")
        (units / "other.service").write_text("kept\n")
        self.env["KAYLEE_SYSTEMD_SYSTEM_DIR"] = str(units)
        output = self.install()
        self.assertEqual(os.listdir(units), ["other.service"])
        self.assertIn(f"removed retired {' '.join(retired)}", output)
        calls = (self.home / "sudo-calls").read_text()
        self.assertIn(f"systemctl disable --now {' '.join(retired)}", calls)
        self.assertNotIn("removed retired", self.install())

    def test_allowlist_is_only_kaylee_clis_and_heredoc(self):
        self.install()
        self.assertEqual(
            json.loads(self.config()["command_allowlist"]),
            ["kaylee-dispatch *", "kaylee-retire-legacy-access", "script execution via heredoc"],
        )

    def test_unmarked_home_keeps_existing_files_and_skills(self):
        self.hermes.mkdir()
        soul = self.hermes / "SOUL.md"
        soul.write_text("Existing identity\n")
        self.workspace.mkdir(parents=True)
        manual = self.workspace / "AGENTS.md"
        target = self.home / "owned-manual.md"
        target.write_text("Existing manual\n")
        manual.symlink_to(target)
        skill = self.hermes / "skills/boat-dispatch"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("Existing skill\n")
        before = {path: path.read_bytes() for path in (soul, manual, skill / "SKILL.md")}
        output = self.install()
        self.assertEqual({path: path.read_bytes() for path in before}, before)
        self.assertTrue(manual.is_symlink())
        self.assertEqual(list(skill.iterdir()), [skill / "SKILL.md"])
        self.assertTrue((self.hermes / "skills/daybook/SKILL.md").is_file())
        for path in (soul, manual, skill):
            self.assertIn(f"kept {path}", output)


if __name__ == "__main__":
    unittest.main()
