#!/usr/bin/env python3
"""Run the chief installer chain in private homes; no live Hermes or services."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


CHIEF = Path(__file__).resolve().parent

# Hermes v0.22.5, hermes_cli/default_soul.py. Exact bytes, not an identity prefix.
HERMES_DEFAULT_SOUL = (
    "You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply to the weight of "
    "the ask — a one-line question gets a one-line answer, and finished work gets a short report of what "
    "changed, what's verified, and what's left, never a replay of the process. No filler (\"Great question,\" "
    "\"I'd be happy to\"), no restating the request back, no re-summarizing what you already said, no narrating "
    "tool calls the user can see. Plain claims over adjectives; when unsure, say so plainly. Agree because it's "
    "right, not because the user said it. Depth is earned — give it when the user asks for detail, teaches, or "
    "the stakes demand it, not by default."
)

HERMES_FIXTURE = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
home = pathlib.Path(os.environ["HERMES_HOME"])
home.mkdir(parents=True, exist_ok=True)
soul = home / "SOUL.md"
if not soul.exists() and not soul.is_symlink():
    soul.write_text(os.environ["FIXTURE_DEFAULT_SOUL"])
args = sys.argv[1:]
assert args[0] == "-p", args
profile, args = args[1], args[2:]
if args[:2] == ["config", "set"]:
    assert profile == "default", profile
    path = home / "config.json"
    config = json.loads(path.read_text()) if path.exists() else {}
    config[args[2]] = args[3]
    path.write_text(json.dumps(config))
elif args[:2] == ["config", "get"]:
    assert profile == "default", profile
    config = json.loads((home / "config.json").read_text())
    if args[2] == "platform_toolsets":
        value = {key.removeprefix("platform_toolsets."): json.loads(value)
                 for key, value in config.items() if key.startswith("platform_toolsets.")}
    elif args[2] in config:
        value = json.loads(config[args[2]])
    else:
        print(f"Config key not set: {args[2]}", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(value))
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
            FIXTURE_DEFAULT_SOUL=HERMES_DEFAULT_SOUL,
        )
        for name, source in {
            "hermes": HERMES_FIXTURE,
            "exocortex": "#!/bin/sh\nexit 0\n",
            "boat": "#!/bin/sh\nexit 0\n",
            "systemctl": "#!/bin/sh\nexit 0\n",
            # Never invoke sudo or write /etc, including through nested installers.
            "sudo": "#!/bin/sh\ncat >/dev/null\n",
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

    def test_hermes_default_soul_is_replaced(self):
        self.hermes.mkdir()
        soul = self.hermes / "SOUL.md"
        for default in (HERMES_DEFAULT_SOUL, "A future Hermes-generated default"):
            with self.subTest(default=default):
                self.env["FIXTURE_DEFAULT_SOUL"] = default
                soul.write_text(default)
                self.install()
                self.assertEqual(soul.read_bytes(), (CHIEF / "SOUL.md").read_bytes())

    def test_customized_default_soul_is_kept(self):
        self.hermes.mkdir()
        soul = self.hermes / "SOUL.md"
        soul.write_text(HERMES_DEFAULT_SOUL + "\nKaylee's own addition\n")
        before = soul.read_bytes()
        output = self.install()
        self.assertEqual(soul.read_bytes(), before)
        self.assertIn(f"kept {soul}", output)

    def test_soul_symlinks_are_kept(self):
        self.hermes.mkdir()
        soul = self.hermes / "SOUL.md"
        target = self.home / "owned-soul.md"
        target.write_text(HERMES_DEFAULT_SOUL)
        soul.symlink_to(target)
        for dangling in (False, True):
            with self.subTest(dangling=dangling):
                if dangling:
                    target.unlink()
                output = self.install()
                self.assertTrue(soul.is_symlink())
                self.assertEqual(soul.readlink(), target)
                self.assertIn(f"kept {soul}", output)
                if dangling:
                    self.assertFalse(target.exists())
                else:
                    self.assertEqual(target.read_text(), HERMES_DEFAULT_SOUL)

    def test_rerun_disables_delegation_without_resetting_tool_choices(self):
        self.install()
        for disabled in ([], ["file", "kanban"]):
            with self.subTest(disabled=disabled):
                config = self.config()
                config["agent.disabled_toolsets"] = json.dumps(disabled)
                platforms = {
                    "cli": ["browser", "delegation", "terminal"],
                    "discord": ["delegation", "browser", "memory"],
                    "cron": ["web", "delegation", "browser"],
                    "slack": ["browser", "delegation", "skills", "delegation"],
                }
                for platform, toolsets in platforms.items():
                    config[f"platform_toolsets.{platform}"] = json.dumps(toolsets)
                (self.hermes / "config.json").write_text(json.dumps(config))
                self.install()
                after = self.config()
                self.assertEqual(json.loads(after["agent.disabled_toolsets"]), disabled + ["delegation"])
                for platform, toolsets in platforms.items():
                    self.assertEqual(json.loads(after[f"platform_toolsets.{platform}"]),
                                     [toolset for toolset in toolsets if toolset != "delegation"])

    def test_unmarked_home_merges_tool_choices_and_disables_delegation(self):
        self.hermes.mkdir()
        platforms = ("cli", "discord", "cron", "slack")
        config = {"agent.disabled_toolsets": '["custom-disabled"]'}
        for platform in platforms:
            config[f"platform_toolsets.{platform}"] = '["browser","delegation","custom","browser"]'
        (self.hermes / "config.json").write_text(json.dumps(config))
        self.install()
        after = self.config()
        disabled = json.loads(after["agent.disabled_toolsets"])
        self.assertIn("custom-disabled", disabled)
        self.assertIn("delegation", disabled)
        for platform in platforms:
            toolsets = json.loads(after[f"platform_toolsets.{platform}"])
            self.assertNotIn("delegation", toolsets)
            self.assertEqual([toolset for toolset in toolsets if toolset in ("browser", "custom")],
                             ["browser", "custom", "browser"])

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
        changed["agent.disabled_toolsets"] = '["delegation","her-own-disabled-toolset"]'
        for platform in ("cli", "discord", "cron"):
            changed[f"platform_toolsets.{platform}"] = '["browser","memory"]'
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
