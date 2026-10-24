import json, os, pathlib, subprocess, sys, tempfile, unittest

SCRIPT = pathlib.Path(__file__).with_name("t3-accounts")


class BuildOnlyHostTest(unittest.TestCase):
    def test_hetzner_ci_plain_host_is_refused(self):
        for name, dest in (("hetzner-ci", "hetzner-ci"), ("ci", "root@hetzner-ci")):
            with tempfile.TemporaryDirectory() as home:
                cfg = pathlib.Path(home, ".config/t3-accounts")
                cfg.mkdir(parents=True)
                (cfg / "accounts.json").write_text(json.dumps(
                    {"hosts": {}, "plain_hosts": {name: {"dest": dest, "codex": {}}}}))
                r = subprocess.run([sys.executable, str(SCRIPT), "status"], capture_output=True,
                                   text=True, env={**os.environ, "HOME": home}, timeout=30)
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("build/CI only", r.stderr)


if __name__ == "__main__":
    unittest.main()
