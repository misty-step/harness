"""Offline audit consumer contracts. No real tracker, model, GitHub, journal or Herdr is touched."""

from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("omp_audit", Path(__file__).with_name("omp-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
NOW = datetime(2026, 10, 12, 12, tzinfo=timezone.utc)
MARK = "foundation-gap: foundations/misty-step/chrondle/sentry"
NATIVE_PREFIX = ["pass-env", "run", "-e", "CF_ACCESS_CLIENT_ID=workstation/POWDER_ACCESS_CLIENT_ID",
                 "-e", "=".join(("CF_ACCESS_CLIENT_SECRET", "workstation/POWDER_ACCESS_CLIENT_SECRET")),
                 "--", "work-tracker", "--url", "https://powder.mistystep.io"]


def request(**overrides):
    return {"action": "file", "gap": "sentry", "area": "F2", "title": "chrondle: production errors reach Sentry",
            "body": "No Sentry SDK in the code; production failures are silent.", "priority": "high", "nature": "build",
            "scope_in": ["Report production errors from the web app to Sentry"],
            "scope_out": ["Alert routing beyond Sentry's defaults"],
            "done": [{"check": "A thrown production error appears in Sentry", "proof": "sentry issue URL for a test error"}],
            "victory": "A production failure in chrondle is seen the day it happens.", **overrides}


def native_item(id_, state=None, *, revision="1", body="", **extra):
    return {"id": id_, "revision": revision, "scope": "misty-step/chrondle", "title": "An existing error-reporting gap",
            "body": body, "rank": 0, "references": [], "why": "Existing accepted work",
            "work": {"scope_in": ["Repair the original failure"], "scope_out": ["Other work"],
                     "done_when": [{"claim": "Original failure restored", "proof": "Independent readback"}],
                     "victory": "The original user is restored."},
            "state": {"kind": "open"} if state is None else state, "owner": None,
            "readiness": None if state and state["kind"] in ("done", "dropped") else "needs_discussion", "waiting": None,
            "created_at": 1790000000000, "updated_at": 1790000000000, "actions": [], **extra}


def journal(id_, event, *, sequence=1, cursor=1):
    return {"ticket_id": id_, "sequence": sequence, "cursor": cursor, "actor": "kaylee", "at": 1790000000000,
            "request_id": None, "event": event}


def process(argv, data=None, *, code=0, stderr=""):
    return subprocess.CompletedProcess(argv, code, "" if data is None else json.dumps(data), stderr)


def receipt(argv, wire, outcome="applied"):
    """Native peer acknowledgement, not the assertion of what the consumer should send."""
    write = json.loads(wire)
    item = native_item(write["id"], **write["change"]["fields"], **write["change"]["definition"])
    return process(argv, {"outcome": outcome, "request_id": write["request_id"], "cursor": 1, "item": item})


class NativePeer:
    """Stateful native reader/receipt peer; tests independently control accepted write answers."""
    def __init__(self, items=(), histories=None, writer=None):
        self.items = list(items)
        self.histories = histories or {}
        self.writer = writer
        self.calls = []
        self.ceiling = max([row["cursor"] for rows in self.histories.values() for row in rows] + [0])

    def __call__(self, argv, *, stdin=None, **kwargs):
        self.calls.append((list(argv), stdin))
        if argv[:len(NATIVE_PREFIX)] != NATIVE_PREFIX:
            raise AssertionError(f"Misty Step reached a non-native command: {argv}")
        args = argv[len(NATIVE_PREFIX):]
        verb = args[0]
        if verb == "list":
            return process(argv, {"snapshot": self.ceiling, "items": self.items, "counts": {}, "complete": True, "next": None})
        if verb == "get":
            item = next((item for item in self.items if item["id"] == args[1]), None)
            return process(argv, item) if item else process(argv, code=1, stderr='{"code":"not_found"}')
        if verb == "history":
            rows = self.histories.get(args[1], [])
            after = int(argv[argv.index("--after") + 1])
            ceiling = int(argv[argv.index("--ceiling") + 1]) if "--ceiling" in argv else self.ceiling
            rows = [row for row in rows if row["sequence"] > after and row["cursor"] <= ceiling]
            return process(argv, {"ceiling": ceiling, "events": rows, "next": rows[-1]["sequence"] if rows else after,
                                  "complete": True})
        if verb == "write" and self.writer:
            answer = self.writer(argv, stdin)
            if answer.returncode == 0:
                try:
                    reply = json.loads(answer.stdout)
                    write = json.loads(stdin)
                    if isinstance(reply, dict) and reply.get("outcome") in ("applied", "already_applied"):
                        self.commit(write, reply["item"])
                except (ValueError, TypeError, KeyError):
                    pass
            return answer
        raise AssertionError(f"unexpected native mutation: {argv}")

    def commit(self, write, accepted):
        self.items = [item for item in self.items if item["id"] != accepted["id"]] + [accepted]
        rows = self.histories.setdefault(accepted["id"], [])
        if not any(row.get("request_id") == write["request_id"] for row in rows):
            self.ceiling += 1
            rows.append({**journal(accepted["id"], write["change"], sequence=len(rows) + 1,
                                  cursor=self.ceiling),
                         "actor": write["actor"], "request_id": write["request_id"]})

    @property
    def writes(self):
        return [wire for argv, wire in self.calls if argv[len(NATIVE_PREFIX)] == "write"]


class AuditConsumer(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.runs = Path(self.temp.name) / "runs"
        self.outputs = self.runs / "R2" / "outputs.jsonl"
        self.outputs.parent.mkdir(parents=True)
        self.outputs.touch()
        self.context = {"run": "R2", "audit": "foundations", "repo": "misty-step/chrondle", "commit": "a" * 40,
                        "outputs": str(self.outputs)}
        self.context_path = self.outputs.parent / "context.json"
        self.context_path.write_text(json.dumps(self.context))

    def tearDown(self):
        self.temp.cleanup()

    def record(self, req=None, **context):
        self.context_path.write_text(json.dumps({**self.context, **context}))
        with patch.object(audit, "run", side_effect=AssertionError("auditor touched a tracker")), patch("sys.stdout", new=io.StringIO()):
            audit.file_command(self.context_path, io.StringIO(json.dumps(request() if req is None else req)))

    def latest(self):
        return audit.current(self.outputs)[("misty-step/chrondle", MARK)]

    def earlier(self, run="R1", **fields):
        path = self.runs / run / "outputs.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {**request(), "run": run, "audit": "foundations", "repo": "misty-step/chrondle", "commit": "b" * 40,
               "marker": MARK, "record_only": False, **fields}
        path.write_text(json.dumps(row) + "\n")
        return path

    def deliver(self, peer):
        with patch.object(audit, "run", side_effect=peer):
            return audit.deliver_run(self.outputs)

    def test_auditor_records_original_request_once_and_never_reads_or_writes_trackers(self):
        self.record()
        self.record(request(title="A second report of the same production gap"))
        records = audit.read_records(self.outputs)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["outcome"], "pending")
        self.assertEqual(records[0]["tracker"], "powder")
        for key, value in request().items():
            self.assertEqual(records[0][key], value)

    def test_native_create_preserves_authored_spec_and_freezes_before_transmission(self):
        authored = request(title="chrondle: close ALR-001 — the alert rule", body="US-014 (story) fails - see #201.\n\n" + "Evidence. " * 500,
                           priority="urgent", nature="review", done=[{"check": "HA-12 stays closed", "proof": "habitat get HA-12  --json"}])
        self.record(authored)
        synced = []

        def write(argv, wire):
            frozen = audit.read_records(self.outputs)[-1]
            self.assertEqual(frozen["outcome"], "unknown")
            self.assertEqual(frozen["native_wire"], wire)
            self.assertEqual(frozen["native_request"], json.loads(wire))
            self.assertEqual(frozen["native_sha256"], hashlib.sha256(wire.encode()).hexdigest())
            self.assertTrue(synced, "the prepared append must be durable before the peer sees it")
            return receipt(argv, wire)

        peer = NativePeer(writer=write)
        with patch.object(audit.os, "fsync", side_effect=lambda fd: synced.append(fd)):
            self.assertEqual(self.deliver(peer), {"created": 1})
        write = json.loads(peer.writes[0])
        self.assertEqual(set(write), {"request_id", "actor", "id", "expected_revision", "change"})
        self.assertEqual((write["actor"], write["expected_revision"], write["change"]["kind"]), ("omp-audit", "0", "create"))
        expected_key = hashlib.sha256((MARK + "|R2").encode()).hexdigest()[:40]
        self.assertEqual((write["id"], write["request_id"]), ("audit-" + expected_key, "omp-audit-" + expected_key))
        fields, definition = write["change"]["fields"], write["change"]["definition"]
        self.assertEqual((fields["title"], fields["scope"], fields["rank"]), (authored["title"], "misty-step/chrondle", 0))
        self.assertEqual(fields["references"], [{"kind": "repo", "repo": "misty-step/chrondle"}, {"kind": "run", "system": "omp-audit", "id": "R2"}])
        self.assertTrue(audit.carries(fields["body"], MARK))
        self.assertIn(authored["body"], fields["body"])
        self.assertIn("Nature: review", fields["body"])
        self.assertIn("priority: urgent", fields["body"])
        self.assertIn(self.context["commit"], fields["body"])
        self.assertIn(str(self.outputs), fields["body"])
        self.assertEqual(definition, {"why": "US-014 (story) fails - see #201.", "work": {
            "scope_in": authored["scope_in"], "scope_out": authored["scope_out"],
            "done_when": [{"claim": "HA-12 stays closed", "proof": "habitat get HA-12  --json"}], "victory": authored["victory"]}})
        self.assertNotIn("transition", write["change"])
        self.assertNotIn("roster", fields)
        self.assertNotIn("owner", fields)
        self.assertEqual(self.latest()["body"], authored["body"])

    def test_record_only_findings_never_deliver_and_never_own_a_live_gap(self):
        self.earlier(action="adopt", outcome="adopted", ticket="K-20260920-declined", record_only=True)
        self.record(record_only=True)
        with patch.object(audit, "run", side_effect=AssertionError("record-only touched tracker")):
            self.assertEqual(audit.deliver_run(self.outputs), {})
            audit.deliver({**self.context, "record_only": True}, request(), MARK)
        self.assertTrue(self.latest()["record_only"])
        live_peer = NativePeer(writer=receipt)
        with patch.object(audit, "run", side_effect=live_peer):
            self.assertEqual(audit.owners("powder", MARK, self.runs), [])

    def test_current_state_wins_over_past_lifecycle_and_imported_marker_notes_are_complete(self):
        id_ = "K-20260920-old"
        current = native_item(id_, {"kind": "dropped", "source": "glass"}, revision="3")
        histories = {id_: [
            journal(id_, {"kind": "imported", "original": json.dumps({"notes": "Updated notes without the marker", "name": "old-owner"}),
                          "lifecycle": {"kind": "open", "active": {"kind": "claimed", "owner": "old-owner"}}}),
            journal(id_, {"kind": "archived", "original": json.dumps({"changes": json.dumps({"notes": [f"- {MARK}\nOriginal finding", "Updated notes without the marker"]})})}, sequence=2, cursor=2),
            journal(id_, {"kind": "note", "comment": "Human decline remains final."}, sequence=3, cursor=3)]}
        peer = NativePeer([current], histories)
        self.record()
        self.assertEqual(self.deliver(peer), {"declined": 1})
        self.assertEqual(self.latest()["ticket"], id_)
        self.assertEqual(peer.writes, [])
        history_calls = len([args for args, _ in peer.calls if args[len(NATIVE_PREFIX)] == "history"])
        with patch.object(audit, "run", side_effect=peer):
            context = audit.powder_context()
        self.assertEqual(context[0]["state"], current["state"])
        self.assertEqual(len([args for args, _ in peer.calls if args[len(NATIVE_PREFIX)] == "history"]), history_calls)

    def test_native_closed_marker_in_an_old_body_is_not_lost_when_current_body_is_amended(self):
        id_ = "old-native-owner"
        current = native_item(id_, {"kind": "dropped", "reason": "Not wanted"}, revision="2", body="Human replacement text")
        peer = NativePeer([current], {id_: [
            journal(id_, {"kind": "applied", "fields": {"body": f"* {MARK}\nFinding"}}),
            journal(id_, {"kind": "applied", "fields": {"body": "Human replacement text"}}, sequence=2, cursor=2)]})
        self.record()
        self.assertEqual(self.deliver(peer), {"declined": 1})
        self.assertEqual(peer.writes, [])

    def test_old_adopted_owner_resolves_only_in_powder_and_missing_or_unreadable_owner_refuses(self):
        id_ = "K-20260920-adopted"
        original = self.earlier(action="adopt", outcome="adopted", ticket=id_)
        original_bytes = original.read_bytes()
        self.record()
        owner = native_item(id_, {"kind": "dropped", "source": "glass"})
        peer = NativePeer([owner], {id_: [journal(id_, {"kind": "imported", "original": '{"notes":"Desk notes"}'})]})
        self.assertEqual(self.deliver(peer), {"declined": 1})
        self.assertIn(NATIVE_PREFIX + ["get", id_], [argv for argv, _ in peer.calls])
        self.assertEqual(original.read_bytes(), original_bytes)
        with patch.object(audit, "run", side_effect=NativePeer()):
            with self.assertRaises(audit.Refusal):
                audit.owners("powder", MARK, self.runs)
        with patch.object(audit, "run", return_value=process([], code=1, stderr='{"code":"unauthenticated"}')):
            with self.assertRaises(audit.Refusal):
                audit.powder_ticket_state(id_)

    def test_adopt_and_carry_are_read_only_and_never_claim_or_complete_as_the_owner(self):
        id_ = "K-20260920-owned"
        owner = native_item(id_, {"kind": "open"}, owner="a-real-engineer", readiness="ready")
        peer = NativePeer([owner], {id_: [journal(id_, {"kind": "note", "comment": f"- {MARK}"})]})
        self.record(request(action="adopt", ticket=id_))
        self.assertEqual(self.deliver(peer), {"adopted": 1})
        with patch.object(audit, "run", side_effect=peer):
            carried = audit.deliver(self.context, request(action="carry", ticket=id_), MARK)
        self.assertEqual(carried["outcome"], "carried")
        self.assertEqual(peer.writes, [])
        with patch.object(audit, "run", side_effect=NativePeer()):
            refused = audit.deliver(self.context, request(action="adopt", ticket="K-20261002-missing"), MARK)
        self.assertEqual(refused["outcome"], "stranded")

    def test_done_regression_retains_its_explicit_owner_reference(self):
        id_ = "K-20260920-done"
        owner = native_item(id_, {"kind": "done", "source": "glass"}, body=f"- {MARK}")
        peer = NativePeer([owner], {id_: [journal(id_, {"kind": "imported", "original": json.dumps({"notes": f"- {MARK}"})})]}, receipt)
        self.record()
        self.assertEqual(self.deliver(peer), {"created": 1})
        self.assertEqual(self.latest()["regression_of"], [id_])
        self.assertIn("- regression of: " + id_, json.loads(peer.writes[0])["change"]["fields"]["body"])

    def test_uncertain_legacy_done_owner_reconciles_without_a_new_regression(self):
        id_ = "K-20260920-done"
        owner = native_item(id_, {"kind": "done", "source": "glass"}, body=f"- {MARK}")
        peer = NativePeer([owner], {id_: [journal(id_, {"kind": "imported", "original": json.dumps({"notes": f"- {MARK}"})})]}, receipt)
        legacy_outputs = self.earlier(outcome="stranded", tracker="board")
        prefix = legacy_outputs.read_bytes()
        before = len(peer.writes)
        with patch.object(audit, "run", side_effect=peer):
            self.assertEqual(audit.deliver_run(legacy_outputs), {"closed-since": 1})
        self.assertEqual(len(peer.writes), before)
        self.assertTrue(legacy_outputs.read_bytes().startswith(prefix))

    def test_uncertain_legacy_draft_stays_preserved_and_refuses_again_until_marker_reconciliation(self):
        legacy = self.earlier(outcome="stranded", tracker="board", error="Glass acknowledgement was lost")
        prefix = legacy.read_bytes()
        peer = NativePeer(writer=receipt)
        with patch.object(audit, "run", side_effect=peer):
            self.assertEqual(audit.deliver_run(legacy), {"stranded": 1})
            self.assertEqual(audit.deliver_run(legacy), {"stranded": 1})
        self.assertTrue(legacy.read_bytes().startswith(prefix))
        self.assertEqual(peer.writes, [])
        self.assertEqual(audit.current(legacy)[("misty-step/chrondle", MARK)]["tracker"], "legacy-glass")

    def test_doctrine_proposal_is_native_without_preparation_or_other_company_calls(self):
        self.record(request(action="propose"))
        peer = NativePeer(writer=receipt)
        self.assertEqual(self.deliver(peer), {"proposed": 1})
        write = json.loads(peer.writes[0])
        self.assertEqual(write["change"]["fields"]["scope"], "misty-step/harness")
        self.assertEqual(write["change"]["kind"], "create")
        self.assertEqual(self.latest()["tracker"], "powder")

    def test_unknown_acknowledgement_replays_identical_wire_before_fresh_receipt_readback(self):
        self.record()
        peer = NativePeer(writer=lambda argv, wire: process(argv, code=1, stderr=json.dumps({
            "code": "unknown", "request_id": json.loads(wire)["request_id"], "message": "response lost after commit"})))
        self.assertEqual(self.deliver(peer), {"unknown": 1})
        frozen = self.latest()
        prefix = self.outputs.read_bytes()
        self.assertEqual(audit.stranded_count(self.outputs), 1)
        self.assertEqual(frozen["native_request"]["expected_revision"], "0")
        resent = []

        def replay(argv, wire):
            resent.append(wire)
            return receipt(argv, wire, "already_applied")

        replay_peer = NativePeer(writer=replay)
        with patch.object(audit, "run", side_effect=replay_peer), patch("sys.stdout", new=io.StringIO()), patch.object(audit, "STATE", self.runs.parent):
            self.assertEqual(audit.refile_command("R2"), 0)
        self.assertEqual(replay_peer.calls[0], (NATIVE_PREFIX + ["write"], frozen["native_wire"]))
        self.assertEqual([argv[len(NATIVE_PREFIX)] for argv, _ in replay_peer.calls], ["write", "get", "history"])
        self.assertEqual(resent, [frozen["native_wire"]])
        self.assertTrue(self.outputs.read_bytes().startswith(prefix))
        self.assertEqual(self.latest()["native_request"], frozen["native_request"])
        self.assertEqual(self.latest()["outcome"], "created")

    def test_unknown_adoption_regression_replays_request_and_retains_the_original_adoption_target(self):
        old = "K-20260920-completed-owner"
        owner = native_item(old, {"kind": "done", "source": "glass"}, body=f"- {MARK}")
        peer = NativePeer([owner], {old: [journal(old, {"kind": "imported", "original": json.dumps({"notes": f"- {MARK}"})})]},
                          lambda argv, wire: subprocess.CompletedProcess(argv, 0, "{}", ""))
        self.record(request(action="adopt", ticket=old))
        self.assertEqual(self.deliver(peer), {"unknown": 1})
        frozen = self.latest()

        def replay(argv, wire):
            self.assertEqual(wire, frozen["native_wire"])
            return receipt(argv, wire, "already_applied")

        replay_peer = NativePeer([owner], writer=replay)
        with patch.object(audit, "run", side_effect=replay_peer):
            self.assertEqual(audit.deliver_run(self.outputs), {"created": 1})
        self.assertEqual(self.latest()["adoption_refused"], old)
        self.assertEqual(self.latest()["regression_of"], [old])
        self.assertEqual(self.latest()["native_request"], frozen["native_request"])

    def test_malformed_or_unrelated_acknowledgements_stay_unknown_with_frozen_request(self):
        cases = ["invalid-json", "null", "wrong-request", "wrong-id", "missing-revision", "missing-state", "transport"]
        for case in cases:
            with self.subTest(case=case):
                outputs = Path(self.temp.name) / case / "runs" / ("bad-" + case) / "outputs.jsonl"
                outputs.parent.mkdir(parents=True)
                outputs.touch()
                context = {**self.context, "run": "bad-" + case, "outputs": str(outputs)}

                def writer(argv, wire):
                    if case == "invalid-json":
                        return subprocess.CompletedProcess(argv, 0, "{", "")
                    if case == "null":
                        return subprocess.CompletedProcess(argv, 0, "null", "")
                    if case == "transport":
                        raise subprocess.TimeoutExpired(argv, 30)
                    reply = json.loads(receipt(argv, wire).stdout)
                    if case == "wrong-request":
                        reply["request_id"] = "another-request"
                    if case == "wrong-id":
                        reply["item"]["id"] = "another-id"
                    if case == "missing-revision":
                        del reply["item"]["revision"]
                    if case == "missing-state":
                        del reply["item"]["state"]
                    return process(argv, reply)

                peer = NativePeer(writer=writer)
                with patch.object(audit, "run", side_effect=peer):
                    record = audit.deliver(context, request(), MARK)
                self.assertEqual(record["outcome"], "unknown")
                self.assertEqual(record["native_wire"], peer.writes[0])
                self.assertEqual(audit.stranded_count(outputs), 1)

    def test_stale_or_modified_frozen_request_never_refreshes_or_rekeys(self):
        self.record()
        peer = NativePeer(writer=lambda argv, wire: process(argv, code=1, stderr='{"code":"stale","expected":"0","actual":"7"}'))
        self.assertEqual(self.deliver(peer), {"stranded": 1})
        frozen = self.latest()
        calls_before = len(peer.calls)
        with patch.object(audit, "run", side_effect=peer):
            result = audit.deliver(self.context, request(title="Different proposed title", body="Different words should never replace a frozen native request."), MARK)
        self.assertEqual(peer.calls[calls_before:], [(NATIVE_PREFIX + ["write"], frozen["native_wire"])])
        self.assertEqual(result["native_request"], frozen["native_request"])
        broken = {**frozen, "native_sha256": "0" * 64}
        with patch.object(audit, "run", side_effect=AssertionError("corrupt request sent")):
            with self.assertRaises(audit.Refusal):
                audit.powder_transmit(broken, self.context, request(), MARK)

    def test_unknown_old_run_blocks_new_duplicates_and_unchanged_repository_carry(self):
        self.record()
        peer = NativePeer(writer=lambda argv, wire: subprocess.CompletedProcess(argv, 0, "{}", ""))
        self.assertEqual(self.deliver(peer), {"unknown": 1})
        outputs = self.runs / "R3" / "outputs.jsonl"
        outputs.parent.mkdir()
        outputs.touch()
        context = {**self.context, "run": "R3", "outputs": str(outputs)}
        with patch.object(audit, "run", side_effect=peer):
            refused = audit.deliver(context, request(), MARK)
            self.assertEqual(audit.carry_forward(context, "R2"), 0)
        self.assertEqual(refused["outcome"], "stranded")
        self.assertIn("refile that exact request", refused["error"])
        self.assertEqual(len(peer.writes), 1)

    def test_unreadable_original_output_records_refuse_without_a_write(self):
        earlier = self.earlier(outcome="adopted", ticket="K-20260920-custody")
        earlier.write_text('{"marker":')
        self.record()
        peer = NativePeer(writer=receipt)
        self.assertEqual(self.deliver(peer), {"stranded": 1})
        self.assertEqual(peer.writes, [])


class NativeReadProtocol(unittest.TestCase):
    def test_listing_and_history_page_until_proven_complete_at_one_snapshot(self):
        a = native_item("first", revision="2")
        b = native_item("second", {"kind": "dropped", "source": "glass"})
        answers = [
            {"snapshot": 8, "items": [a], "counts": {}, "complete": False, "next": "cursor-one"},
            {"snapshot": 8, "items": [b], "counts": {}, "complete": True, "next": None},
            {"ceiling": 8, "events": [journal("first", {"kind": "note", "comment": "Old note"}, cursor=2)], "complete": False, "next": 1},
            {"ceiling": 8, "events": [journal("first", {"kind": "note", "comment": f"- {MARK}"}, sequence=2, cursor=8)], "complete": True, "next": 2},
            {"ceiling": 8, "events": [journal("second", {"kind": "imported", "original": json.dumps({"notes": f"- {MARK}"})}, cursor=4)], "complete": True, "next": 1},
        ]
        calls = []

        def answer(argv, **kwargs):
            calls.append(argv)
            return process(argv, answers.pop(0))

        with patch.object(audit, "run", side_effect=answer):
            found = audit.powder_marked(MARK)
        self.assertEqual([(item["id"], item["state"]) for item in found], [("first", "open"), ("second", "declined")])
        self.assertEqual(calls[1], NATIVE_PREFIX + ["list", "--scope", "misty-step", "--limit", "100", "--cursor", "cursor-one"])
        self.assertEqual(calls[3], NATIVE_PREFIX + ["history", "first", "--after", "1", "--limit", "100", "--ceiling", "8"])
        self.assertFalse(answers)

    def test_partial_repeated_or_snapshot_changed_list_is_never_an_empty_owner_set(self):
        first = {"snapshot": 8, "items": [native_item("first")], "counts": {}, "complete": False, "next": "same"}
        bad = [
            {"snapshot": 8, "items": [], "complete": False, "next": "next"},
            {"snapshot": 8, "items": [], "complete": "true", "next": None},
            {"snapshot": 8, "items": [], "complete": True},
            {"snapshot": 9, "items": [native_item("second")], "complete": True, "next": None},
            {"snapshot": 8, "items": [native_item("second")], "complete": False, "next": "same"},
            {"snapshot": 8, "items": [native_item("first")], "complete": True, "next": None},
        ]
        for page in bad:
            with self.subTest(page=page):
                answers = [first, page]
                with patch.object(audit, "run", side_effect=lambda argv, **kwargs: process(argv, answers.pop(0))):
                    with self.assertRaises(audit.Refusal):
                        audit.powder_inventory()

    def test_lost_history_sequence_ceiling_or_imported_notes_refuses(self):
        item = native_item("owned", revision="2")
        bad = [
            {"ceiling": 8, "events": [journal("owned", {"kind": "note", "comment": "two"}, sequence=2)], "next": 2, "complete": True},
            {"ceiling": 9, "events": [], "next": 0, "complete": True},
            {"ceiling": 8, "events": [], "next": 0, "complete": False},
            {"ceiling": 8, "events": [journal("owned", {"kind": "imported", "original": "not-json"})], "next": 1, "complete": True},
        ]
        for page in bad:
            with self.subTest(page=page), patch.object(audit, "run", return_value=process([], page)):
                with self.assertRaises((audit.Refusal, ValueError)):
                    audit.powder_history(item, 8)
        malformed_notes = [journal("owned", {"kind": "archived", "original": '{"changes":"{not-json"}'})]
        with self.assertRaises(ValueError):
            audit.authored_notes(malformed_notes)

    def test_exact_observed_state_shape_is_required_and_working_is_never_inferred(self):
        proof = [{"kind": "web", "url": "https://proof.invalid/", "label": None}]
        valid = [({"kind": "open"}, {}, "open"),
                 ({"kind": "open"}, {"readiness": "ready"}, "open"),
                 ({"kind": "open"}, {"readiness": "ready", "owner": "engineer"}, "open"),
                 ({"kind": "open"}, {"waiting": {"to": "human", "question": "Which route?"}}, "open"),
                 ({"kind": "open"}, {"readiness": "ready", "owner": "engineer", "waiting": {"to": "human", "question": "Which route?"}}, "open"),
                 ({"kind": "done", "evidence": proof}, {"owner": "engineer"}, "done"),
                 ({"kind": "done", "source": "glass"}, {}, "done"),
                 ({"kind": "dropped", "reason": "No longer needed"}, {}, "declined"),
                 ({"kind": "dropped", "source": "glass"}, {}, "declined")]
        for state, facts, expected in valid:
            with self.subTest(state=state, facts=facts):
                self.assertEqual(audit.powder_state(native_item("owner", state, **facts))["state"], expected)
        refused = [({"kind": "working"}, {}), ({"kind": "later"}, {}), ({"kind": "ready"}, {}),
                   ({"kind": "claimed", "owner": "engineer"}, {}), ({"kind": "historical_closed", "outcome": "done", "source": "glass"}, {}),
                   ({"kind": "open"}, {"owner": "guessed"}), ({"kind": "open"}, {"readiness": None}),
                   ({"kind": "open"}, {"waiting": {"to": "human"}}), ({"kind": "done", "evidence": proof}, {}),
                   ({"kind": "done", "evidence": proof, "source": "glass"}, {"owner": "engineer"}),
                   ({"kind": "dropped", "source": "glass"}, {"readiness": "ready"})]
        for state, facts in refused:
            with self.subTest(state=state, facts=facts), self.assertRaises(audit.Refusal):
                audit.powder_state(native_item("owner", state, **facts))
        missing_fact = native_item("owner")
        del missing_fact["waiting"]
        with self.assertRaises(audit.Refusal):
            audit.powder_state(missing_fact)
        for revision in (1, None, "", " "):
            with self.subTest(revision=revision), self.assertRaises(audit.Refusal):
                audit.powder_state(native_item("owner", revision=revision))
        self.assertFalse(audit.carries(f"- {MARK}-drill", MARK))
        self.assertFalse(audit.carries("discussion of " + MARK, MARK))


class UnchangedR90AndRequestContract(unittest.TestCase):
    def test_habitat_create_keeps_keys_priority_module_and_idempotency_contract(self):
        context = {"run": "R2", "audit": "foundations", "repo": "r90group/tach", "commit": "a" * 40}
        mark = "foundation-gap: foundations/r90group/tach/sentry"
        body = audit.ticket_body(context, request(priority="urgent"), mark)
        calls = []

        def answer(argv, **kwargs):
            calls.append(argv)
            if argv[-1] == "filters":
                return process(argv, {"data": {"modules": [{"label": "Agent Usage Telemetry (AUT)", "value": "module-aut"}]}})
            return process(argv, {"data": {"external_id": "AUT-7"}})

        with patch.object(audit, "run", side_effect=answer):
            self.assertEqual(audit.create("habitat", "Agent Usage Telemetry (AUT)", request(priority="urgent"), body, context, mark), ("AUT-7", None))
        expected_key = "audit-" + hashlib.sha256((mark + "|R2").encode()).hexdigest()[:40]
        self.assertEqual(calls, [[audit.HABITAT, "--json", "filters"],
            [audit.HABITAT, "--json", "create", "--type", "task", "--title", request()["title"], "--description", body + "\n" + audit.spec_text(request(priority="urgent")),
             "--priority", "p0", "--tags", "audit,foundations", "--idempotency-key", expected_key, "--module-id", "module-aut"]])

    def test_habitat_priority_climb_reads_current_revision_and_closed_marker_search_stays_intact(self):
        calls = []
        owner = {"id": "HA-7", "state": "open", "priority": 3, "created": "2026-09-01T00:00:00Z"}
        with patch.object(audit, "run_json", return_value={"data": {"external_id": "HA-7", "revision": 4}}), patch.object(audit, "run", side_effect=lambda argv, **kwargs: calls.append(argv)):
            self.assertEqual(audit.recur(owner, request(priority="normal"), {}, NOW), "high")
        self.assertEqual(calls, [[audit.HABITAT, "--json", "update", "HA-7", "--priority", "p1", "--expected-revision", "4"]])
        marker = "foundation-gap: foundations/r90group/habitat/sentry"
        pages = [{"items": [{"external_id": "HA-7", "status": "open", "description": "- " + marker, "priority": "p2"}], "has_more": False},
                 {"items": [{"external_id": "HA-8", "status": "closed", "description": "- " + marker, "priority": "p3"}], "has_more": False}]
        with patch.object(audit, "run_json", side_effect=pages) as read:
            found = audit.habitat_marked(marker)
        self.assertEqual([(item["id"], item["state"]) for item in found], [("HA-7", "open"), ("HA-8", "declined")])
        self.assertEqual(read.call_args_list[1].args[0], [audit.HABITAT, "--json", "list", "--search", marker, "--status", "closed", "--limit", "200", "--offset", "0"])
        self.assertEqual(audit.climbed(0, NOW - timedelta(days=90), NOW), 0)
        self.assertEqual(audit.climbed(3, NOW - timedelta(days=90), NOW), 1)

    def test_r90_keeps_habitat_and_legacy_board_evidence_misty_step_never_reads_glass(self):
        habitat = [{"id": "AUT-7", "title": "Telemetry gap", "module": "Agent Usage Telemetry", "status": "open"}]
        board = [{"id": "K-20261001-tach", "title": "tach doctrine", "project": None, "status": "later"}]
        native = [{**native_item("own"), "notes": []}]
        with patch.object(audit, "gh", return_value=""), patch.object(audit, "fetch", return_value={"text": ""}), patch.object(audit, "sentry_projects", return_value={}), \
             patch.object(audit, "habitat_open", return_value=habitat), patch.object(audit, "board_open", return_value=board), patch.object(audit, "powder_context", side_effect=AssertionError("R90 reached Powder")):
            r90 = audit.shared_evidence(["r90group/tach"])
        self.assertEqual(audit.project_tickets("r90group/tach", r90), {"tracker": habitat, "board": board})
        with patch.object(audit, "gh", return_value=""), patch.object(audit, "fetch", return_value={"text": ""}), patch.object(audit, "sentry_projects", return_value={}), \
             patch.object(audit, "habitat_open", side_effect=AssertionError("Misty Step reached Habitat")), patch.object(audit, "board_open", side_effect=AssertionError("Misty Step reached Glass")), patch.object(audit, "powder_context", return_value=native):
            misty = audit.shared_evidence(["misty-step/chrondle"])
        self.assertEqual(audit.project_tickets("misty-step/chrondle", misty), {"tracker": native, "authority": "https://powder.mistystep.io"})

    def test_r90_origin_doctrine_routes_native_and_retains_original_finding_and_readback(self):
        with tempfile.TemporaryDirectory() as folder:
            outputs = Path(folder) / "runs/R2/outputs.jsonl"
            outputs.parent.mkdir(parents=True)
            context = {"run": "R2", "audit": "principles", "repo": "r90group/tach", "commit": "a" * 40, "outputs": str(outputs)}
            context_file = outputs.parent / "context.json"
            context_file.write_text(json.dumps(context))
            authored = request(action="propose", nature="review")
            mark = "foundation-gap: principles/r90group/tach/sentry"
            with patch("sys.stdout", new=io.StringIO()):
                audit.file_command(context_file, io.StringIO(json.dumps(authored)))
            prefix = outputs.read_bytes()
            peer = NativePeer(writer=receipt)
            with patch.object(audit, "run", side_effect=peer):
                self.assertEqual(audit.deliver_run(outputs), {"proposed": 1})
            record = audit.current(outputs)[("r90group/tach", mark)]
            for key, value in authored.items():
                self.assertEqual(record[key], value)
            self.assertTrue(outputs.read_bytes().startswith(prefix))
            self.assertEqual(len(peer.writes), 1)
            write = json.loads(peer.writes[0])
            self.assertEqual(write["change"]["fields"]["scope"], "misty-step/harness")
            self.assertEqual(write["change"]["fields"]["references"][0], {"kind": "repo", "repo": "r90group/tach"})
            self.assertEqual(record["native_ack"]["request_id"], write["request_id"])
            self.assertEqual(record["native_readback"]["item"]["id"], write["id"])
            self.assertEqual(record["tracker"], "powder")

    def test_legacy_bare_enrichment_uses_actual_misty_scope_and_one_atomic_definition_note(self):
        id_ = "K-20260920-r90-origin-misty-work"
        mark = "foundation-gap: foundations/r90group/tach/sentry"
        for scope in ("misty-step/harness", "r90group/tach", "moomooskycow/workbench", ""):
            with self.subTest(scope=scope), tempfile.TemporaryDirectory() as folder:
                outputs = Path(folder) / "runs/R2/outputs.jsonl"
                outputs.parent.mkdir(parents=True)
                outputs.touch()
                context = {"run": "R2", "audit": "foundations", "repo": "r90group/tach", "commit": "a" * 40, "outputs": str(outputs)}
                old = {"id": id_, "status": "waiting", "notes": f"- {mark}", "ticket": None}
                current = native_item(id_, scope=scope, revision="opaque-revision", work=None, owner="exact-active-owner",
                                      readiness="ready", waiting={"to": "kaylee", "question": "Keep this held?"}, body=f"- {mark}")

                def amend_ack(argv, wire):
                    write = json.loads(wire)
                    changed = {**current, "work": write["change"]["patch"]["work"], "revision": "opaque-next"}
                    return process(argv, {"outcome": "applied", "request_id": write["request_id"], "cursor": 1, "item": changed})

                peer = NativePeer([current], writer=amend_ack)

                def answer(argv, **kwargs):
                    if argv == ["glass", "item", "show", id_]:
                        return process(argv, {"item": old})
                    return peer(argv, **kwargs)

                with patch.object(audit, "run", side_effect=answer):
                    result = audit.deliver(context, request(action="adopt", ticket=id_), mark)
                self.assertEqual(result["outcome"], "adopted" if scope == "misty-step/harness" else "stranded")
                self.assertEqual(len(peer.writes), 1 if scope == "misty-step/harness" else 0)
                if scope == "misty-step/harness":
                    write = json.loads(peer.writes[0])
                    self.assertEqual(write["expected_revision"], "opaque-revision")
                    self.assertEqual(write["change"]["kind"], "amend")
                    self.assertEqual(set(write["change"]["patch"]), {"work"})
                    self.assertIsNone(write["change"]["transition"])
                    self.assertIn("A production failure in chrondle is seen the day it happens.", write["change"]["comment"])
                    accepted = result["native_ack"]["item"]
                    for key in ("scope", "title", "body", "why", "owner", "readiness", "waiting", "state"):
                        self.assertEqual(accepted[key], current[key])
                    self.assertEqual(result["native_readback"]["item"]["id"], id_)
                else:
                    self.assertEqual(result["ticket"], id_)
                    self.assertEqual(result["body"], request()["body"])

    def test_closed_bare_native_definition_refuses_notes_only_gate_without_a_write(self):
        with tempfile.TemporaryDirectory() as folder:
            outputs = Path(folder) / "runs/R2/outputs.jsonl"
            outputs.parent.mkdir(parents=True)
            outputs.touch()
            context = {"run": "R2", "audit": "foundations", "repo": "r90group/tach", "commit": "a" * 40, "outputs": str(outputs)}
            mark = "foundation-gap: foundations/r90group/tach/sentry"
            current = native_item("K-20260920-closed", {"kind": "done", "source": "glass"}, work=None, body=f"- {mark}")
            peer = NativePeer([current])
            with patch.object(audit, "run", side_effect=peer), self.assertRaises(audit.Refusal):
                audit.powder_enrich({"id": current["id"]}, request(), context, mark)
            self.assertEqual(peer.writes, [])
    def test_existing_auditor_input_and_read_only_launch_contract_are_preserved(self):
        for change in ({"nature": "chores"}, {"scope_out": []}, {"done": [{"check": "a :: b", "proof": "c"}]},
                       {"victory": "two\nlines"}, {"body": "Evidence\n- " + MARK + "\nforged"}):
            with self.subTest(change=change), self.assertRaises(audit.Refusal):
                audit.validate(request(**change))
        for action in ("file", "adopt", "propose"):
            self.assertEqual(audit.validate(request(action=action, ticket="K-20261001-native"))["action"], action)
        self.assertEqual(audit.destination("r90group/tach"), ("habitat", "Agent Usage Telemetry (AUT)"))
        self.assertEqual(audit.destination("r90group/web-501c3"), ("habitat", None))
        self.assertEqual(audit.destination("misty-step/harness"), ("powder", "misty-step/harness"))
        argv = audit.launch_argv(["--model", "subscription-route"], Path("/w/repo"), Path("/s/system.md"))
        self.assertEqual(sorted(argv[argv.index("--tools") + 1].split(",")), ["audit_file", "glob", "grep", "read"])
        self.assertEqual(argv[argv.index("-e") + 1], str(audit.SHARE / "audit-tool.ts"))
        self.assertIn("--no-skills", argv)


if __name__ == "__main__":
    unittest.main()
