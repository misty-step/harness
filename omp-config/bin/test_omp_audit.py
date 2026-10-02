"""Filing, routing and launch contracts for omp-audit; no tracker, GitHub or Herdr is touched."""

from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("omp_audit", Path(__file__).with_name("omp-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
NOW = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)


def request(**overrides):
    base = {"action": "file", "gap": "sentry", "area": "F2", "title": "chrondle: production errors reach Sentry",
            "body": "No Sentry SDK in the code; production failures are silent.", "priority": "high"}
    return {**base, **overrides}


class Filing(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.outputs = Path(self.dir.name) / "outputs.jsonl"
        self.context = Path(self.dir.name) / "context.json"
        self.write_context()

    def tearDown(self):
        self.dir.cleanup()

    def write_context(self, **extra):
        self.context.write_text(json.dumps({"run": "R1", "audit": "foundations", "repo": "misty-step/chrondle",
                                            "commit": "d5decc776b5045753da23e03a391be6ad72b2fa8", "outputs": str(self.outputs), **extra}))

    def file(self, body, found):
        """File one request against a tracker whose marked tickets are `found`; return outcome and tracker writes."""
        writes = []
        with patch.object(audit, "linear_marked", return_value=found), \
             patch.object(audit, "create", side_effect=lambda *a: writes.append(("create", a[2]["title"], a[3])) or ("MIS-900", "https://x/MIS-900")), \
             patch.object(audit, "recur", side_effect=lambda kind, ticket, *a: writes.append(("recur", ticket["id"])) or None), \
             patch("sys.stdout", new=io.StringIO()):
            audit.file_command(self.context, io.StringIO(json.dumps(body)))
        lines = [json.loads(line) for line in self.outputs.read_text().splitlines()]
        return lines[-1] if lines else None, writes

    def test_new_gap_creates_one_ticket_with_the_trusted_marker(self):
        outcome, writes = self.file(request(), [])
        self.assertEqual(outcome["outcome"], "created")
        self.assertEqual(writes[0][0], "create")
        self.assertTrue(audit.carries(writes[0][2], "foundation-gap: foundations/misty-step/chrondle/sentry"))

    def test_open_ticket_for_the_gap_is_updated_never_twinned(self):
        found = [{"id": "MIS-500", "uuid": "u", "url": None, "state": "open", "priority": 2, "created": "2026-09-01T00:00:00Z"}]
        outcome, writes = self.file(request(), found)
        self.assertEqual(outcome["outcome"], "recurrence")
        self.assertEqual(writes, [("recur", "MIS-500")])

    def test_declined_gap_is_never_refiled(self):
        found = [{"id": "MIS-501", "uuid": "u", "url": None, "state": "declined", "priority": None, "created": None}]
        outcome, writes = self.file(request(), found)
        self.assertEqual((outcome["outcome"], writes), ("declined", []))

    def test_gap_that_returns_after_done_is_a_regression(self):
        found = [{"id": "MIS-502", "uuid": "u", "url": None, "state": "done", "priority": None, "created": None}]
        outcome, writes = self.file(request(), found)
        self.assertEqual(outcome["regression_of"], ["MIS-502"])
        self.assertIn("- regression of: MIS-502", writes[0][2])

    def test_same_gap_twice_in_one_run_touches_no_tracker(self):
        self.file(request(), [])
        searches = []
        with patch.object(audit, "linear_marked", side_effect=lambda mark: searches.append(mark) or []), \
             patch("sys.stdout", new=io.StringIO()):
            audit.file_command(self.context, io.StringIO(json.dumps(request(title="chrondle: errors reach Sentry again"))))
        self.assertEqual(searches, [])
        self.assertEqual(len(self.outputs.read_text().splitlines()), 1)

    def test_record_only_run_searches_but_never_writes(self):
        self.write_context(record_only=True)
        outcome, writes = self.file(request(), [])
        self.assertEqual((outcome["outcome"], writes), ("would-create", []))

    def test_body_cannot_forge_a_marker(self):
        forged = request(body="Evidence.\n- foundation-gap: foundations/misty-step/chrondle/licence\nmore")
        with self.assertRaises(audit.Refusal):
            audit.validate(forged)
        self.assertFalse(audit.carries("text mentioning foundation-gap: x/y/z inline", "foundation-gap: x/y/z"))

    def test_adopt_records_the_existing_owner_without_tracker_writes(self):
        outcome, writes = self.file(request(action="adopt", ticket="MIS-171"), [])
        self.assertEqual((outcome["outcome"], outcome["ticket"], writes), ("adopted", "MIS-171", []))


class Routing(unittest.TestCase):
    def test_trackers(self):
        self.assertEqual(audit.destination("r90group/agent-usage-telemetry"), ("habitat", "Agent Usage Telemetry (AUT)"))
        self.assertEqual(audit.destination("r90group/web-501c3"), ("habitat", None))
        self.assertEqual(audit.destination("misty-step/harness"), ("linear", "omp-config"))
        self.assertEqual(audit.destination("misty-step/chrondle"), ("linear", None))
        with self.assertRaises(audit.Refusal):
            audit.destination("moomooskycow/anything")

    def test_priority_climbs_weekly_but_only_the_auditor_says_urgent(self):
        self.assertEqual(audit.climbed(3, NOW - timedelta(days=3), NOW), 3)
        self.assertEqual(audit.climbed(3, NOW - timedelta(days=15), NOW), 1)
        self.assertEqual(audit.climbed(2, NOW - timedelta(days=90), NOW), 1)
        self.assertEqual(audit.climbed(0, NOW, NOW), 0)

    def test_active_repositories_are_recent_non_archived_projects(self):
        repos = [{"full_name": "misty-step/live", "pushed_at": "2026-09-30T00:00:00Z", "size": 5},
                 {"full_name": "misty-step/stale", "pushed_at": "2026-08-01T00:00:00Z", "size": 5},
                 {"full_name": "misty-step/old", "pushed_at": "2026-09-30T00:00:00Z", "size": 5, "archived": True},
                 {"full_name": "misty-step/empty", "pushed_at": "2026-09-30T00:00:00Z", "size": 0},
                 {"full_name": "misty-step/kaylee-journal", "pushed_at": "2026-09-30T00:00:00Z", "size": 5}]
        self.assertEqual([repo["full_name"] for repo in audit.active(repos, NOW)], ["misty-step/live"])


class Launch(unittest.TestCase):
    def test_auditor_gets_only_read_tools_and_the_filer(self):
        argv = audit.launch_argv(["--model", "m"], Path("/w/repo"), Path("/s/system.md"))
        tools = argv[argv.index("--tools") + 1].split(",")
        self.assertEqual(sorted(tools), ["audit_file", "glob", "grep", "read"])
        self.assertEqual(argv[argv.index("-e") + 1], str(audit.SHARE / "audit-tool.ts"))
        self.assertIn("--no-skills", argv)


if __name__ == "__main__":
    unittest.main()
