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
MARK = "foundation-gap: foundations/misty-step/chrondle/sentry"


def request(**overrides):
    base = {"action": "file", "gap": "sentry", "area": "F2", "title": "chrondle: production errors reach Sentry",
            "body": "No Sentry SDK in the code; production failures are silent.", "priority": "high",
            "nature": "build", "scope_in": ["Report production errors from the web app to Sentry"],
            "scope_out": ["Alert routing beyond Sentry's defaults"],
            "done": [{"check": "A thrown production error appears in Sentry", "proof": "sentry issue URL for a test error"}],
            "victory": "A production failure in chrondle is seen the day it happens."}
    return {**base, **overrides}


def glass_add(added, item_id="K-20261002-new"):
    """The board's write: record each `glass item add --body -` request and answer with the new item."""
    def run(argv, stdin=None, **kw):
        added.append(json.loads(stdin))
        return audit.subprocess.CompletedProcess(argv, 0, json.dumps({"changed": True, "item": {"id": item_id}}), "")
    return patch.object(audit, "run", side_effect=run)


def ticket(id_, state, **extra):
    return {"id": id_, "url": None, "state": state, "priority": None, "created": "2026-09-01T00:00:00Z", **extra}


class Filing(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.runs = Path(self.dir.name) / "runs"
        self.outputs = self.runs / "R2" / "outputs.jsonl"
        self.outputs.parent.mkdir(parents=True)
        self.context = Path(self.dir.name) / "context.json"
        self.write_context()

    def tearDown(self):
        self.dir.cleanup()

    def write_context(self, **extra):
        self.context.write_text(json.dumps({"run": "R2", "audit": "foundations", "repo": "misty-step/chrondle",
                                            "commit": "d5decc776b5045753da23e03a391be6ad72b2fa8", "outputs": str(self.outputs), **extra}))

    def earlier_run(self, **record):
        """An earlier run's outputs, as the launcher wrote them."""
        path = self.runs / "R1" / "outputs.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        base = {"run": "R1", "audit": "foundations", "repo": "misty-step/chrondle", "commit": "abc", "gap": "sentry", "area": "F2",
                "priority": "high", "title": "chrondle: production errors reach Sentry", "marker": MARK}
        path.write_text(json.dumps({**base, **record}) + "\n")

    def record(self, body):
        """The audit_file tool inside the auditor: it records, and must never reach a tracker."""
        with patch.object(audit, "marked", side_effect=AssertionError("the auditor reached a tracker")), \
             patch("sys.stdout", new=io.StringIO()):
            audit.file_command(self.context, io.StringIO(json.dumps(body)))

    def deliver(self, found=(), states=None, refuse=None):
        """The launcher's delivery, against a tracker whose marked tickets are `found` and other tickets `states`."""
        writes = []

        def create(kind, scope, req, body, context, mark):
            if refuse:
                raise audit.Refusal(refuse)
            writes.append(("create", kind, scope, body))
            return "K-20261002-new", None

        with patch.object(audit, "marked", return_value=list(found)), \
             patch.object(audit, "ticket_state", side_effect=lambda id_: (states or {}).get(id_)), \
             patch.object(audit, "create", side_effect=create), \
             patch.object(audit, "recur", side_effect=lambda t, *a: writes.append(("recur", t["id"]))):
            counts = audit.deliver_run(self.outputs)
        current = audit.current(self.outputs)
        return current.get(("misty-step/chrondle", MARK)), writes, counts

    def test_auditor_records_and_the_launcher_files_to_the_board(self):
        self.record(request())
        self.assertEqual(audit.read_records(self.outputs)[0]["outcome"], "pending")
        outcome, writes, _ = self.deliver()
        self.assertEqual((outcome["outcome"], outcome["ticket"]), ("created", "K-20261002-new"))
        self.assertEqual(writes[0][:3], ("create", "board", "misty-step/chrondle"))
        self.assertTrue(audit.carries(writes[0][3], MARK))

    def test_tracker_failure_strands_the_finding_whole_and_refile_files_it(self):
        self.record(request())
        stranded, writes, counts = self.deliver(refuse="glass item add failed (exit 75): the board is unavailable")
        self.assertEqual((stranded["outcome"], counts, writes), ("stranded", {"stranded": 1}, []))
        self.assertEqual((stranded["body"], stranded["title"]), (request()["body"], request()["title"]))
        filed, writes, _ = self.deliver()
        self.assertEqual((filed["outcome"], len(writes)), ("created", 1))

    def test_open_ticket_for_the_gap_is_seen_again_never_twinned(self):
        self.record(request())
        outcome, writes, _ = self.deliver([ticket("K-20261001-chrondle-sentry", "open", board=True)])
        self.assertEqual((outcome["outcome"], writes), ("recurrence", [("recur", "K-20261001-chrondle-sentry")]))

    def test_declined_gap_is_never_refiled(self):
        self.record(request())
        outcome, writes, _ = self.deliver([ticket("K-20261001-old", "declined")])
        self.assertEqual((outcome["outcome"], writes), ("declined", []))

    def test_gap_that_returns_after_done_is_a_regression(self):
        self.record(request())
        outcome, writes, _ = self.deliver([ticket("K-20260901-chrondle-sentry", "done")])
        self.assertEqual(outcome["regression_of"], ["K-20260901-chrondle-sentry"])
        self.assertIn("- regression of: K-20260901-chrondle-sentry", writes[0][3])

    def test_same_gap_twice_in_one_run_is_recorded_once(self):
        self.record(request())
        self.record(request(title="chrondle: errors reach Sentry again"))
        self.assertEqual(len(audit.read_records(self.outputs)), 1)

    def test_record_only_findings_are_never_delivered(self):
        self.write_context(record_only=True)
        self.record(request())
        outcome, writes, _ = self.deliver()
        self.assertEqual((outcome["outcome"], writes), ("pending", []))

    def test_body_cannot_forge_a_marker(self):
        forged = request(body="Evidence.\n- foundation-gap: foundations/misty-step/chrondle/licence\nmore")
        with self.assertRaises(audit.Refusal):
            audit.validate(forged)
        self.assertFalse(audit.carries("text mentioning foundation-gap: x/y/z inline", "foundation-gap: x/y/z"))

    def test_adopted_ticket_keeps_owning_its_gap_after_it_is_declined(self):
        self.earlier_run(action="adopt", outcome="adopted", ticket="K-20260920-chrondle-errors")
        self.record(request())
        outcome, writes, _ = self.deliver(states={"K-20260920-chrondle-errors": ticket("K-20260920-chrondle-errors", "declined")})
        self.assertEqual((outcome["outcome"], outcome["ticket"], writes), ("declined", "K-20260920-chrondle-errors", []))

    def test_a_record_only_adoption_never_owns_a_live_gap(self):
        self.earlier_run(action="adopt", outcome="adopted", ticket="K-20260920-chrondle-errors", record_only=True)
        self.record(request())
        outcome, _, _ = self.deliver(states={"K-20260920-chrondle-errors": ticket("K-20260920-chrondle-errors", "declined")})
        self.assertEqual(outcome["outcome"], "created")

    def test_adopted_open_ticket_is_seen_again_like_any_owner(self):
        self.record(request(action="adopt", ticket="HA-171"))
        outcome, writes, _ = self.deliver(states={"HA-171": ticket("HA-171", "open")})
        self.assertEqual((outcome["outcome"], writes), ("adopted", [("recur", "HA-171")]))

    def test_adopting_a_missing_or_done_ticket_files_the_finding_instead(self):
        self.record(request(action="adopt", ticket="K-20261002-gone"))
        outcome, writes, _ = self.deliver()
        self.assertEqual((outcome["outcome"], outcome["adoption_refused"], outcome["regression_of"], len(writes)),
                         ("created", "K-20261002-gone", None, 1))
        self.outputs.write_text("")
        self.record(request(action="adopt", ticket="HA-12"))
        outcome, writes, _ = self.deliver(states={"HA-12": ticket("HA-12", "done")})
        self.assertEqual((outcome["outcome"], outcome["regression_of"]), ("created", ["HA-12"]))
        self.assertIn("- regression of: HA-12", writes[0][3])

    def test_unchanged_repository_carries_open_gaps_forward_without_an_auditor(self):
        self.earlier_run(action="file", outcome="created", ticket="HA-900")
        context = json.loads(self.context.read_text())
        recurred = []
        with patch.object(audit, "marked", return_value=[]), \
             patch.object(audit, "ticket_state", side_effect=lambda id_: ticket(id_, "open")), \
             patch.object(audit, "recur", side_effect=lambda t, *a: recurred.append(t["id"])):
            self.assertEqual(audit.carry_forward(context, "R1"), 1)
        self.assertEqual((recurred, audit.read_records(self.outputs)[0]["outcome"]), (["HA-900"], "carried"))

    def test_proposals_keep_the_gap_rules_on_whole_marker_lines(self):
        board = {"items": [{"id": "K-20261002-x", "status": "later", "notes": f"- {MARK}-drill\n\nbody"},
                           {"id": "K-20260901-old", "status": "done", "notes": f"- {MARK}\n\nbody"}]}
        added = []
        context = json.loads(self.context.read_text())
        with patch.object(audit, "run_json", return_value=board), glass_add(added):
            outcome = audit.propose(context, request(action="propose"), MARK)
        self.assertEqual((outcome["outcome"], outcome["regression_of"], len(added)), ("proposed", ["K-20260901-old"], 1))
        self.earlier_run(action="propose", outcome="proposed", ticket="K-20260920-dropped")
        dropped = ticket("K-20260920-dropped", "declined", board=True)
        with patch.object(audit, "run_json", return_value={"items": []}), patch.object(audit, "ticket_state", return_value=dropped):
            self.assertEqual(audit.propose(context, request(action="propose"), MARK)["outcome"], "declined")

    def test_board_owner_is_read_from_the_board_and_an_outage_is_never_a_missing_owner(self):
        def answer(code, stdout, stderr=""):
            return patch.object(audit, "run", return_value=audit.subprocess.CompletedProcess([], code, stdout, stderr))
        item = {"item": {"id": "K-20261001-tach-per-pr-preview", "status": "later", "created_at": "2026-10-01T00:00:00Z"}}
        with answer(0, json.dumps(item)):
            state = audit.ticket_state("K-20261001-tach-per-pr-preview")
        self.assertEqual((state["state"], state["board"]), ("open", True))
        with answer(1, '{"error":"no item matches \'K-20261001-x\'"}'):
            self.assertIsNone(audit.ticket_state("K-20261001-x"))
        with answer(75, "", "glass item: the store is locked"), self.assertRaises(audit.Refusal):
            audit.ticket_state("K-20261001-tach-per-pr-preview")

    def test_every_finding_carries_a_complete_ticket(self):
        for broken in ({"nature": "chores"}, {"scope_out": []}, {"done": [{"check": "Sentry shows it", "proof": ""}]},
                       {"done": [{"check": "a :: b", "proof": "c"}]}, {"victory": "two\nlines"}):
            with self.assertRaises(audit.Refusal):
                audit.validate(request(**broken))

    def test_a_board_item_lands_with_its_whole_ticket_in_one_write(self):
        added = []
        context = json.loads(self.context.read_text())
        coded = request(title="chrondle: close ALR-001 \u2014 the alert rule", body="US-014 (story) fails - see #201.\n\nMore.",
                        priority="urgent", nature="review", victory="ALR-001 never fires silently again",
                        done=[{"check": "HA-12 is closed", "proof": "habitat get HA-12  --json | jq .status"}])
        with glass_add(added):
            audit.create("board", "misty-step/chrondle", coded, audit.ticket_body(context, coded, MARK), context, MARK)
        body = added[0]
        self.assertEqual((body["title"], body["status"]), ("chrondle: close ALR-001 (see notes), the alert rule", "later"))
        self.assertEqual(body["why"]["text"], "US-014 (see notes) (story) fails, see #201 (see notes).")
        self.assertEqual(body["ticket"]["done"], [{"check": "HA-12 (see notes) is closed", "proof": "habitat get HA-12  --json | jq .status"}])
        self.assertEqual(body["ticket"]["victory"], "ALR-001 (see notes) never fires silently again")
        self.assertEqual(body["ticket"]["roster"], [{"provider": "anthropic", "model": "claude-sonnet-5-5", "effort": "high"}])
        self.assertTrue(audit.carries(body["notes"], MARK))
        for source in ("a" * 150 + " ALR-001 and HA-12", "a" * 140 + " ALR-001"):
            fitted = audit.plain_words(source, 160)
            self.assertLessEqual(len(fitted), 160)
            self.assertEqual(len(audit.BOARD_CODE.findall(fitted)), fitted.count(" (see notes)"))
        self.assertTrue(fitted.endswith("ALR-001 (see notes)"))

    def test_a_long_finding_keeps_its_marker_within_the_board_notes_limit(self):
        added = []
        context = json.loads(self.context.read_text())
        long = request(body="Evidence. " * 590)
        with glass_add(added):
            audit.create("board", "misty-step/chrondle", long, audit.ticket_body(context, long, MARK), context, MARK)
        notes = added[0]["notes"]
        self.assertLessEqual(len(notes), 2000)
        self.assertTrue(audit.carries(notes, MARK))
        self.assertIn(str(self.outputs), notes)

    def test_a_bare_item_this_audit_opened_gets_its_ticket_when_seen_again(self):
        context = json.loads(self.context.read_text())
        calls = []
        cases = {"bare, ours": (True, f"- {MARK}\n\nbody"), "ticketed": (False, f"- {MARK}\n\nbody"), "desk item": (True, "desk notes")}
        for name, (bare, notes) in cases.items():
            owner = {"id": f"K-20261002-{name.replace(' ', '').replace(',', '')}", "board": True, "bare": bare, "notes": notes}
            with patch.object(audit, "run", side_effect=lambda argv, **kw: calls.append(argv)):
                self.assertIsNone(audit.recur(owner, request(), context, NOW))
        self.assertEqual([argv[3] for argv in calls], ["K-20261002-bareours"])
        argv = calls[0]
        self.assertEqual(argv[:3], ["glass", "ticket", "set"])
        self.assertIn("A thrown production error appears in Sentry :: sentry issue URL for a test error", argv)
        self.assertEqual(argv[argv.index("--roster") + 1], "openai-codex/gpt-6.1-sol:xhigh")

    def test_a_habitat_climb_sends_the_items_current_revision(self):
        updates = []
        owner = ticket("HA-7", "open", priority=3, created="2026-09-01T00:00:00Z")
        with patch.object(audit, "run_json", return_value={"data": {"external_id": "HA-7", "revision": 4}}), \
             patch.object(audit, "run", side_effect=lambda argv, **kw: updates.append(argv)):
            self.assertEqual(audit.recur(owner, request(priority="normal"), {}, NOW), "high")
        self.assertEqual(updates[0][-4:], ["--priority", "p1", "--expected-revision", "4"])


class Settling(unittest.TestCase):
    def test_a_stranded_finding_fails_the_repository_loudly(self):
        with tempfile.TemporaryDirectory() as folder:
            outputs = Path(folder) / "R" / "outputs.jsonl"
            outputs.parent.mkdir()
            outputs.write_text(json.dumps({"repo": "misty-step/pantry", "marker": MARK, "outcome": "stranded"}) + "\n")
            run = type("Run", (), {"record_only": False, "dry_run": False, "outputs": outputs, "id": "R", "repos": {}, "logged": []})()
            run.record = lambda repo, **fields: run.repos.setdefault(repo, {}).update(fields)
            run.log = run.logged.append
            with patch.object(audit, "deliver_run", return_value={"stranded": 1}):
                audit.settle(run, "misty-step/pantry", "finished")
        self.assertEqual(run.repos["misty-step/pantry"]["status"], "failed (1 findings stranded)")
        self.assertIn("omp-audit refile R", run.logged[0])


class Routing(unittest.TestCase):
    def test_trackers(self):
        self.assertEqual(audit.destination("r90group/agent-usage-telemetry"), ("habitat", "Agent Usage Telemetry (AUT)"))
        self.assertEqual(audit.destination("r90group/web-501c3"), ("habitat", None))
        self.assertEqual(audit.destination("misty-step/harness"), ("board", "misty-step/harness"))
        with self.assertRaises(audit.Refusal):
            audit.destination("moomooskycow/anything")

    def test_priority_climbs_weekly_but_only_the_auditor_says_urgent(self):
        self.assertEqual(audit.climbed(3, NOW - timedelta(days=3), NOW), 3)
        self.assertEqual(audit.climbed(3, NOW - timedelta(days=15), NOW), 1)
        self.assertEqual(audit.climbed(2, NOW - timedelta(days=90), NOW), 1)
        self.assertEqual(audit.climbed(0, NOW, NOW), 0)

    def test_active_repositories_are_recent_projects_neither_archived_nor_set_aside(self):
        repos = [{"full_name": "misty-step/live", "pushed_at": "2026-09-30T00:00:00Z", "size": 5},
                 {"full_name": "misty-step/stale", "pushed_at": "2026-08-01T00:00:00Z", "size": 5},
                 {"full_name": "misty-step/old", "pushed_at": "2026-09-30T00:00:00Z", "size": 5, "archived": True},
                 {"full_name": "misty-step/empty", "pushed_at": "2026-09-30T00:00:00Z", "size": 0},
                 {"full_name": "misty-step/kaylee-journal", "pushed_at": "2026-09-30T00:00:00Z", "size": 5},
                 {"full_name": "misty-step/estate", "pushed_at": "2026-09-30T00:00:00Z", "size": 5}]
        with tempfile.TemporaryDirectory() as folder:
            listed = Path(folder) / "set-aside"
            listed.write_text("# Repositories Phaedrus has set aside\n\nmisty-step/estate\n")
            skipped = audit.EXCLUDED | audit.set_aside(listed)
        self.assertEqual([repo["full_name"] for repo in audit.active(repos, NOW, skipped)], ["misty-step/live"])


class Launch(unittest.TestCase):
    def test_auditor_gets_only_read_tools_and_the_filer(self):
        argv = audit.launch_argv(["--model", "m"], Path("/w/repo"), Path("/s/system.md"))
        tools = argv[argv.index("--tools") + 1].split(",")
        self.assertEqual(sorted(tools), ["audit_file", "glob", "grep", "read"])
        self.assertEqual(argv[argv.index("-e") + 1], str(audit.SHARE / "audit-tool.ts"))
        self.assertIn("--no-skills", argv)

    def test_auditor_names_fit_herdr_and_stay_distinct(self):
        repos = ["r90group/agent-usage-telemetry", "misty-step/habitat", "r90group/habitat", "misty-step/hermes-cloud.fixture_x"]
        names = [audit.auditor_name("20261002T191348Z-foundations", "foundations", repo) for repo in repos]
        for name in names:
            self.assertRegex(name, r"\A[a-z][a-z0-9_-]{0,31}\Z")
        self.assertEqual(len(set(names)), len(names))


if __name__ == "__main__":
    unittest.main()
