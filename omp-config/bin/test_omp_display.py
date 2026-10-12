"""Display authority tests; synthetic host sockets, never the real desktop."""

import importlib.util
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import select
import signal
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

DIRECTORY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("omp_display", DIRECTORY / "omp-display.py")
display = importlib.util.module_from_spec(spec)
spec.loader.exec_module(display)


class HerdrAuthorityTests(unittest.TestCase):
    def test_command_input_and_other_pane_reports_never_reach_host_server(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            upstream.bind(str(root / "host.sock"))
            upstream.listen(1)
            upstream.settimeout(0.05)
            bridge = display.HerdrBridge(root / "engineer.sock", root / "host.sock", "own:p1")
            try:
                for method, params in (
                    (["pane.send_keys"], {}),
                    ({"method": "agent.start"}, {}),
                    (None, {}),
                    ("agent.start", {"pane_id": "own:p1", "agent": "omp"}),
                    ("pane.send_keys", {"pane_id": "own:p1", "keys": ["F12"]}),
                    ("command.invoke", {"command_id": "host-command"}),
                    ("pane.report_agent", {"pane_id": "other:p1", "source": "herdr:omp", "agent": "omp"}),
                ):
                    with self.subTest(method=method), socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                        client.settimeout(2)
                        client.connect(str(root / "engineer.sock"))
                        client.sendall(json.dumps({"id": "test", "method": method, "params": params}).encode() + b"\n")
                        result = json.loads(display.HerdrBridge.line(client))
                        self.assertEqual(result["error"]["code"], "engineer_display_denied")
                        with self.assertRaises(socket.timeout):
                            upstream.accept()
            finally:
                bridge.close()
                upstream.close()

    def test_only_read_and_own_lifecycle_authority_is_granted(self):
        request = lambda method, params: {"id": "test", "method": method, "params": params}
        self.assertTrue(display.allowed_request(request("agent.list", {}), "own:p1"))
        params = {"pane_id": "own:p1", "source": "herdr:omp", "agent": "omp", "state": "working"}
        self.assertTrue(display.allowed_request(request("pane.report_agent", params), "own:p1"))
        self.assertFalse(display.allowed_request(request("pane.report_agent", {**params, "source": "foreign"}), "own:p1"))
        self.assertFalse(display.allowed_request({**request("agent.list", {}), "execute": "host"}, "own:p1"))

    def test_trailing_input_frame_never_reaches_host_after_allowed_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            upstream = socket.socket(socket.AF_UNIX)
            upstream.bind(str(root / "host.sock"))
            upstream.listen(1)
            upstream.settimeout(2)
            state = {"reads": 0, "input": 0}
            errors = []

            def host():
                try:
                    connection, _ = upstream.accept()
                    with connection, connection.makefile("rb") as client:
                        for line in client:
                            request = json.loads(line)
                            if request["method"] == "agent.list":
                                state["reads"] += 1
                            else:
                                state["input"] += 1
                            connection.sendall(json.dumps({"id": request["id"], "result": {}}).encode() + b"\n")
                except Exception as error:
                    errors.append(error)

            thread = threading.Thread(target=host, daemon=True)
            thread.start()
            bridge = display.HerdrBridge(root / "engineer.sock", root / "host.sock", "own:p1")
            try:
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(2)
                    client.connect(str(root / "engineer.sock"))
                    frames = [json.dumps({"id": method, "method": method, "params": {}}).encode() + b"\n"
                              for method in ("agent.list", "pane.send_keys")]
                    client.sendall(b"".join(frames))
                    client.shutdown(socket.SHUT_WR)
                    try:
                        while client.recv(1024):
                            pass
                    except ConnectionResetError:
                        # Dropping unread malicious input may reset the stream.
                        pass
                thread.join(timeout=3)
                self.assertFalse(thread.is_alive())
                self.assertEqual(errors, [])
                self.assertEqual(state, {"reads": 1, "input": 0})
            finally:
                bridge.close()
                upstream.close()


class PowderNoteAuthorityTests(unittest.TestCase):
    def test_non_note_or_wrong_item_requests_cannot_reach_either_writer(self):
        import io

        valid = {"request_id": "retained-request", "actor": "engineer",
                 "id": "existing-item", "expected_revision": "opaque",
                 "change": {"kind": "note", "comment": "Evidence"}}
        requests = [
            {**valid, "id": "different-item"},
            {**valid, "change": {"kind": "create", "fields": {}}},
            {**valid, "change": {**valid["change"], "status": "done"}},
            {**valid, "owner": "glass"},
        ]
        for request in requests:
            with self.subTest(request=request), \
                    patch.object(sys, "stdin", io.TextIOWrapper(io.BytesIO(json.dumps(request).encode()))), \
                    patch.object(display.subprocess, "run") as native, \
                    patch.object(display, "append_note") as legacy:
                with self.assertRaises(display.DisplayError):
                    display.main(["append-note", "--powder", "existing-item"])
                native.assert_not_called()
                legacy.assert_not_called()

    def test_missing_powder_item_cannot_be_interpreted_as_legacy_item(self):
        with patch.object(display, "append_note") as legacy:
            with self.assertRaises(display.DisplayError):
                display.main(["append-note", "--powder"])
            legacy.assert_not_called()


class NativeNoteTransportTests(unittest.TestCase):
    """Run the real CLI/bridge against a private native sink, never installed tools."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.item = "K-20261012-native-note"
        self.current = {"id": self.item, "scope": "misty-step/harness", "revision": "opaque-R7"}
        self.notes = ["Original evidence"]
        self.writes, self.reads, self.receipts = [], [], {}
        self.freeze_path = None
        self.freeze_observations = []
        self.lose_ack = False
        test = self

        class Sink(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def reply(self, code, stdout="", stderr=""):
                body = json.dumps({"returncode": code, "stdout": stdout, "stderr": stderr}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                test.reads.append(self.path)
                self.reply(0, json.dumps(test.current) + "\n")

            def do_POST(self):
                wire = self.rfile.read(int(self.headers["Content-Length"]))
                test.writes.append(wire)
                if test.freeze_path is not None:
                    path = test.freeze_path
                    test.freeze_observations.append((path.read_bytes(), stat.S_IMODE(path.stat().st_mode)))
                request = json.loads(wire)
                identity = request["request_id"]
                previous = test.receipts.get(identity)
                if previous is not None:
                    old_wire, receipt = previous
                    if wire != old_wire:
                        self.reply(9, stderr='{"code":"request_reused"}\n')
                        return
                else:
                    if request["id"] != test.item or request["expected_revision"] != test.current["revision"]:
                        self.reply(9, stderr='{"code":"conflict"}\n')
                        return
                    if request["change"]["kind"] != "note":
                        self.reply(9, stderr='{"code":"not_note"}\n')
                        return
                    test.notes.append(request["change"]["comment"])
                    test.current["revision"] = "opaque-R8"
                    receipt = json.dumps({"outcome": "applied", "request_id": identity,
                                          "item": dict(test.current)}) + "\n"
                    test.receipts[identity] = wire, receipt
                if test.lose_ack:
                    test.lose_ack = False
                    self.reply(7, stderr=json.dumps({"code": "unknown", "request_id": identity}) + "\n")
                else:
                    self.reply(0, stdout=receipt)

        self.server = HTTPServer(("127.0.0.1", 0), Sink)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_sink)
        # These executables only transport to the isolated sink. The sink, not
        # the stub, implements independent revision and immutable-replay rules.
        tracker = self.root / "work-tracker"
        tracker.write_text(f"#!{sys.executable}\n" + r'''
import http.client, json, os, sys
assert sys.argv[1:3] == ["--url", "https://powder.mistystep.io"]
command = sys.argv[3:]
connection = http.client.HTTPConnection("127.0.0.1", int(os.environ["NOTE_TEST_PORT"]), timeout=3)
if command == ["write"]:
    connection.request("POST", "/write", body=sys.stdin.buffer.read())
else:
    assert len(command) == 2 and command[0] == "get"
    connection.request("GET", "/get/" + command[1])
reply = json.loads(connection.getresponse().read())
sys.stdout.write(reply["stdout"])
sys.stderr.write(reply["stderr"])
sys.exit(reply["returncode"])
''')
        tracker.chmod(0o700)
        binder = self.root / "pass-env"
        binder.write_text(f"#!{sys.executable}\n" + r'''
import os, sys
assert sys.argv[1:7] == [
    "run", "-e", "CF_ACCESS_CLIENT_ID=workstation/POWDER_ACCESS_CLIENT_ID",
    "-e", "=".join(("CF_ACCESS_CLIENT_SECRET",
                   "/".join(("workstation", "POWDER_ACCESS_CLIENT_SECRET")))), "--"]
os.execvp(sys.argv[7], sys.argv[7:])
''')
        binder.chmod(0o700)
        self.environment = {**os.environ, "PATH": str(self.root) + os.pathsep + os.environ["PATH"],
                            "NOTE_TEST_PORT": str(self.server.server_port)}

    def stop_sink(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def cli(self, args, stdin):
        return subprocess.run([sys.executable, str(DIRECTORY / "omp-display.py"), *args],
                              input=stdin, capture_output=True, env=self.environment, timeout=5)

    def envelope(self, **changes):
        return {"request_id": "retained-direct-note", "actor": "omp-display append-note",
                "id": self.item, "expected_revision": "opaque-R7",
                "change": {"kind": "note", "comment": "Evidence\n"}, **changes}

    def exchange(self, endpoint, frame):
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(5)
            client.connect(str(endpoint))
            client.sendall(json.dumps(frame).encode() + b"\n")
            return json.loads(display.HerdrBridge.line(client))

    def test_fresh_freezes_before_one_send_and_lost_ack_replays_identical_bytes(self):
        self.freeze_path = self.root / "request.json"
        self.lose_ack = True
        args = ["append-note", self.item, "--request-file", str(self.freeze_path)]
        first = self.cli(args, "Evidence café\n".encode())
        self.assertEqual(first.returncode, 7, first.stderr)
        frozen = self.freeze_path.read_bytes()
        request = json.loads(frozen)
        self.assertEqual(request["actor"], "omp-display append-note")
        self.assertEqual(request["expected_revision"], "opaque-R7")
        self.assertEqual(request["change"], {"kind": "note", "comment": "Evidence café\n"})
        self.assertEqual(self.notes, ["Original evidence", "Evidence café\n"])
        self.assertEqual(self.writes, [frozen])
        self.assertEqual(self.freeze_observations, [(frozen, 0o600)])
        second = self.cli(args, "Evidence café\n".encode())
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(json.loads(second.stdout)["request_id"], request["request_id"])
        self.assertEqual(self.freeze_path.read_bytes(), frozen)
        self.assertEqual(self.writes, [frozen, frozen])
        self.assertEqual(self.freeze_observations, [(frozen, 0o600), (frozen, 0o600)])
        self.assertEqual(self.notes, ["Original evidence", "Evidence café\n"])

    def test_existing_malformed_mismatch_or_nonprivate_request_never_writes(self):
        path = self.root / "retained.json"
        valid = self.envelope()
        cases = [
            (b"{", "Evidence\n", self.item, 0o600),
            (json.dumps({**valid, "id": "wrong-target"}).encode(), "Evidence\n", self.item, 0o600),
            (json.dumps(valid).encode(), "Changed evidence\n", self.item, 0o600),
            (json.dumps({**valid, "actor": "guessed-owner"}).encode(), "Evidence\n", self.item, 0o600),
            (json.dumps({**valid, "expected_revision": 7}).encode(), "Evidence\n", self.item, 0o600),
            (json.dumps({**valid, "request_id": ""}).encode(), "Evidence\n", self.item, 0o600),
            (json.dumps({**valid, "change": {"kind": "done"}}).encode(), "Evidence\n", self.item, 0o600),
            (json.dumps(valid).encode(), "Evidence\n", self.item, 0o644),
            (json.dumps(valid).encode(), "Evidence\n", "wrong-target", 0o600),
            (b'{"id":"other",' + json.dumps(valid).encode()[1:], "Evidence\n", self.item, 0o600),
        ]
        for wire, text, item, mode in cases:
            with self.subTest(wire=wire, mode=mode):
                path.write_bytes(wire)
                path.chmod(mode)
                result = self.cli(["append-note", item, "--request-file", str(path)], text.encode())
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(path.read_bytes(), wire)
                self.assertEqual(self.writes, [])
        self.assertEqual(self.reads, [])
        path.chmod(0o600)
        link = self.root / "linked.json"
        link.symlink_to(path)
        result = self.cli(["append-note", self.item, "--request-file", str(link)], b"Evidence\n")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.writes, [])

    def test_wrong_native_scope_id_or_revision_refuses_before_freeze_or_write(self):
        for value in (
            {**self.current, "scope": "r90group/habitat"},
            {**self.current, "scope": ""},
            {**self.current, "id": "another-item"},
            {**self.current, "revision": 7},
            {"data": {"item": self.current}},
        ):
            with self.subTest(value=value):
                self.current = value
                path = self.root / "new.json"
                result = self.cli(["append-note", self.item, "--request-file", str(path)], b"Evidence\n")
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertFalse(path.exists())
                self.assertEqual(self.writes, [])
        # A hand-supplied, otherwise valid private file is not scope authority.
        self.current = {"id": self.item, "scope": "r90group/habitat", "revision": "opaque-R7"}
        path.write_text(json.dumps(self.envelope()))
        path.chmod(0o600)
        original = path.read_bytes()
        result = self.cli(["append-note", self.item, "--request-file", str(path)], b"Evidence\n")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(self.writes, [])

    def test_direct_native_bridge_commits_to_sink_and_preserves_unknown_then_replay_without_patch(self):
        endpoint, upstream = self.root / "note.sock", self.root / "legacy.sock"
        wire = (json.dumps(self.envelope(), indent=2, ensure_ascii=False) + "\n").encode()
        with socket.socket(socket.AF_UNIX) as legacy, patch.dict(os.environ, self.environment):
            legacy.bind(str(upstream))
            upstream.chmod(0o600)
            legacy.listen(1)
            legacy.settimeout(0.05)
            bridge = display.GlassNoteBridge(endpoint, upstream)
            try:
                self.lose_ack = True
                frame = {"item": self.item, "native_wire": wire.decode()}
                first = self.exchange(endpoint, frame)
                self.assertEqual(first["returncode"], 7)
                self.assertEqual(first["stdout"], "")
                self.assertEqual(json.loads(first["stderr"])["code"], "unknown")
                self.assertEqual(self.notes, ["Original evidence", "Evidence\n"])
                self.assertEqual(self.writes, [wire])
                second = self.exchange(endpoint, frame)
                self.assertEqual(second["returncode"], 0)
                self.assertEqual(second["stderr"], "")
                self.assertEqual(json.loads(second["stdout"])["request_id"], "retained-direct-note")
                self.assertEqual(self.writes, [wire, wire])
                self.assertEqual(self.notes, ["Original evidence", "Evidence\n"])
                with self.assertRaises(socket.timeout):
                    legacy.accept()
            finally:
                bridge.close()

    def test_direct_bridge_invalid_envelope_or_wrong_scope_has_no_native_or_legacy_write(self):
        endpoint, upstream = self.root / "note.sock", self.root / "legacy.sock"
        with socket.socket(socket.AF_UNIX) as legacy, patch.dict(os.environ, self.environment):
            legacy.bind(str(upstream))
            upstream.chmod(0o600)
            legacy.listen(1)
            legacy.settimeout(0.05)
            bridge = display.GlassNoteBridge(endpoint, upstream)
            try:
                valid = {"item": self.item, "native_wire": json.dumps(self.envelope())}
                frames = [
                    {**valid, "native_wire": "{"},
                    {**valid, "item": "different-item"},
                    {**valid, "native_wire": json.dumps(self.envelope(change={"kind": "done"}))},
                    {**valid, "native_wire": json.dumps(self.envelope(expected_revision=None))},
                    {**valid, "native_wire": str(self.root / "request.json")},
                    {**valid, "command": "arbitrary"},
                    {**valid, "text": "mixed legacy"},
                ]
                for frame in frames:
                    with self.subTest(frame=frame):
                        reply = self.exchange(endpoint, frame)
                        self.assertTrue(reply.get("returncode") is None)
                        self.assertEqual(self.writes, [])
                        with self.assertRaises(socket.timeout):
                            legacy.accept()
                self.assertEqual(self.reads, [])
                for current in (
                    {**self.current, "scope": "r90group/habitat"},
                    {**self.current, "id": "other-native-item"},
                    {"data": {"item": self.current}},
                ):
                    with self.subTest(current=current):
                        self.current = current
                        reply = self.exchange(endpoint, valid)
                        self.assertIsNone(reply["returncode"])
                        self.assertEqual(self.writes, [])
                        with self.assertRaises(socket.timeout):
                            legacy.accept()
            finally:
                bridge.close()

    def test_approved_raw_powder_mode_forwards_bytes_without_get_and_replays(self):
        wire = (json.dumps(self.envelope(), indent=3) + "\n").encode()
        self.lose_ack = True
        first = self.cli(["append-note", "--powder", self.item], wire)
        self.assertEqual(first.returncode, 7, first.stderr)
        second = self.cli(["append-note", "--powder", self.item], wire)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(self.writes, [wire, wire])
        self.assertEqual(self.notes, ["Original evidence", "Evidence\n"])
        self.assertEqual(self.reads, [])



class GlassNoteAuthorityTests(unittest.TestCase):
    def exchange(self, endpoint, request):
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(2)
            client.connect(str(endpoint))
            client.sendall(json.dumps(request).encode() + b"\n")
            return json.loads(display.HerdrBridge.line(client))

    def test_replacement_creation_and_other_field_authority_never_reach_writer(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as writer:
            root = Path(directory)
            upstream, endpoint = root / "writer.sock", root / "note.sock"
            writer.bind(str(upstream))
            upstream.chmod(0o600)
            writer.listen(1)
            writer.settimeout(0.05)
            bridge = display.GlassNoteBridge(endpoint, upstream)
            try:
                valid = {"item": "K-20261008-existing-item", "text": "Evidence"}
                requests = [
                    {**valid, field: value} for field, value in (
                        ("notes", "replace"), ("status", "done"), ("rank", 1),
                        ("title", "shadow"), ("caller", "Kaylee"), ("relaying", "Phaedrus"),
                        ("store", "/private/board.db"), ("method", "POST"),
                    )
                ] + [
                    {**valid, "item": "words from a title"},
                    {**valid, "item": "K-existing/review"},
                    {**valid, "text": ""},
                    {**valid, "text": "x" * 2001},
                ]
                for request in requests:
                    with self.subTest(request=request):
                        result = self.exchange(endpoint, request)
                        self.assertEqual(result["status"], 503)
                        with self.assertRaises(socket.timeout):
                            writer.accept()
            finally:
                bridge.close()

    def test_misty_step_or_unknown_scope_cannot_reach_legacy_writer(self):
        import io

        item = "K-20261012-existing-item"
        documents = [
            {"data": {"item": {"state": "ok", "value": {"id": item,
             "placement": {"state": "ok", "value": {"scope": scope}}}}}}
            for scope in ("misty-step", "misty-step/harness", "")
        ] + [
            {"data": {"item": {"state": "unknown", "value": {"id": item,
             "placement": {"state": "ok", "value": {"scope": "r90"}}}}}},
            {"data": {"item": {"state": "ok", "value": {"id": "K-other",
             "placement": {"state": "ok", "value": {"scope": "r90"}}}}}},
        ]
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as writer:
            root = Path(directory)
            upstream, endpoint = root / "writer.sock", root / "note.sock"
            writer.bind(str(upstream))
            upstream.chmod(0o600)
            writer.listen(1)
            writer.settimeout(0.05)
            bridge = display.GlassNoteBridge(endpoint, upstream)
            try:
                for document in documents:
                    result = subprocess.CompletedProcess([], 0, json.dumps(document).encode(), b"")
                    with self.subTest(document=document), \
                            patch.object(display.subprocess, "run", return_value=result) as reads:
                        reply = self.exchange(endpoint, {"item": item, "text": "Evidence"})
                        self.assertEqual(reply["status"], 503)
                        with self.assertRaises(socket.timeout):
                            writer.accept()
                        reads.assert_called_once_with(["glass", "query", "item", item, "--json"],
                                                      capture_output=True, timeout=15, check=False)
                        reads.reset_mock()
                        with patch.object(sys, "stdin", io.StringIO("Evidence")), \
                                patch.object(display.socket, "socket") as transport:
                            with self.assertRaises(display.DisplayError):
                                display.main(["append-note", item])
                            transport.assert_not_called()
                        reads.assert_called_once_with(["glass", "query", "item", item, "--json"],
                                                      capture_output=True, timeout=15, check=False)
            finally:
                bridge.close()

    def test_exact_r90_scope_keeps_append_access_and_original_notes(self):
        item = "K-20261012-existing-r90-item"
        document = {"data": {"item": {"state": "ok", "value": {"id": item,
                    "placement": {"state": "ok", "value": {"scope": "r90group/habitat"}}}}}}
        read = subprocess.CompletedProcess([], 0, json.dumps(document).encode(), b"")
        notes, replies = ["Original evidence"], []
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as writer:
            root = Path(directory)
            upstream, endpoint = root / "writer.sock", root / "note.sock"
            writer.bind(str(upstream))
            upstream.chmod(0o600)
            writer.listen(1)
            writer.settimeout(2)
            bridge = display.GlassNoteBridge(endpoint, upstream)
            try:
                with patch.object(display.subprocess, "run", return_value=read):
                    client = threading.Thread(target=lambda: replies.append(
                        self.exchange(endpoint, {"item": item, "text": "New evidence"})))
                    client.start()
                    connection, _ = writer.accept()
                    with connection, connection.makefile("rb") as request:
                        request.readline()
                        headers = {}
                        while (line := request.readline()) != b"\r\n":
                            name, value = line.decode().split(":", 1)
                            headers[name.lower()] = value.strip()
                        body = json.loads(request.read(int(headers["content-length"])))
                        notes.append(body["notes_append"])
                        receipt = json.dumps({"item": {"id": item}, "recorded": "authored"}).encode()
                        connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: "
                                           + str(len(receipt)).encode() + b"\r\n\r\n" + receipt)
                    client.join(timeout=3)
                self.assertEqual(notes, ["Original evidence", "New evidence"])
                self.assertEqual(replies[0]["status"], 200)
            finally:
                bridge.close()

    def test_nonowned_endpoint_shapes_fail_without_fallback(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as writer, \
                patch.object(display, "check_legacy_note_scope"):
            root = Path(directory)
            real, upstream, endpoint = root / "real.sock", root / "writer.sock", root / "note.sock"
            writer.bind(str(real))
            real.chmod(0o600)
            writer.listen(1)
            writer.settimeout(0.05)
            bridge = display.GlassNoteBridge(endpoint, upstream)
            try:
                request = {"item": "K-20261008-existing-item", "text": "Evidence"}
                for shape in ("missing", "regular", "symlink", "wrong_mode"):
                    with self.subTest(shape=shape):
                        if upstream.exists() or upstream.is_symlink():
                            upstream.unlink()
                        if shape == "regular":
                            upstream.write_text("not a socket")
                        elif shape == "symlink":
                            upstream.symlink_to(real)
                        elif shape == "wrong_mode":
                            os.link(real, upstream)
                            upstream.chmod(0o660)
                        result = self.exchange(endpoint, request)
                        self.assertEqual(result["status"], 503)
                        self.assertNotIn("changed", result["body"])
                        with self.assertRaises(socket.timeout):
                            writer.accept()
            finally:
                bridge.close()

    def test_trickled_frame_cannot_extend_the_complete_request_deadline(self):
        reader, sender = socket.socketpair()
        def trickle():
            try:
                for part in (b"{", b" ", b" ", b"}", b"\n"):
                    time.sleep(0.1)
                    sender.sendall(part)
            except OSError:
                pass
        thread = threading.Thread(target=trickle)
        thread.start()
        try:
            reader.settimeout(0.2)
            with self.assertRaises(socket.timeout):
                display.HerdrBridge.line(reader, deadline=time.monotonic() + 0.2)
        finally:
            reader.close()
            thread.join(timeout=2)
            sender.close()


class GpgAuthorityTests(unittest.TestCase):
    def test_client_cannot_enable_pinentry_or_kill_host_agent_even_after_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            upstream.bind(str(root / "host.sock"))
            upstream.listen(1)
            upstream.settimeout(2)
            state = {"mode": b"ask", "killed": False, "environment_reads": 0}
            errors = []

            def host_agent():
                try:
                    connection, _ = upstream.accept()
                    with connection, connection.makefile("rb") as client:
                        connection.sendall(b"OK synthetic agent\n")
                        for line in client:
                            if line.startswith(b"OPTION pinentry-mode="):
                                state["mode"] = line.rstrip().split(b"=", 1)[1]
                            elif line == b"RESET\n":
                                state["mode"] = b"ask"
                            elif line == b"KILLAGENT\n":
                                state["killed"] = True
                            elif line.startswith(b"GETINFO std_"):
                                state["environment_reads"] += 1
                                connection.sendall(b"D DISPLAY=:host\n")
                            connection.sendall(b"OK\n")
                            if line == b"BYE\n":
                                break
                except Exception as error:
                    errors.append(error)

            thread = threading.Thread(target=host_agent, daemon=True)
            thread.start()
            bridge = display.GpgBridge(root / "engineer.sock", root / "host.sock", None)
            try:
                with socket.socket(socket.AF_UNIX) as connection:
                    connection.settimeout(2)
                    connection.connect(str(root / "engineer.sock"))
                    with connection.makefile("rb") as agent:
                        self.assertTrue(agent.readline().startswith(b"OK"))
                        for option in (b"OPTION pinentry-mode=ask", b"RESET", b"OPTION display=:0"):
                            connection.sendall(option + b"\n")
                            self.assertEqual(agent.readline(), b"OK\n")
                            self.assertEqual(state["mode"], b"error")
                        for query in (b"std_session_env", b"std_startup_env", b"std_env_names", b"future_subcommand"):
                            connection.sendall(b"GETINFO " + query + b"\n")
                            self.assertTrue(agent.readline().startswith(b"ERR "))
                        connection.sendall(b"KILLAGENT\n")
                        self.assertTrue(agent.readline().startswith(b"ERR "))
                        connection.sendall(b"BYE\n")
                        self.assertEqual(agent.readline(), b"OK\n")
                thread.join(timeout=3)
                self.assertFalse(thread.is_alive())
                self.assertEqual(errors, [])
                self.assertFalse(state["killed"])
                self.assertEqual(state["environment_reads"], 0)
            finally:
                bridge.close()
                upstream.close()


class HostInstallExposureTests(unittest.TestCase):
    def fixture_mounts(self, root):
        home = root / "home"
        home.mkdir()
        (home / ".omp/run").mkdir(parents=True)
        (home / ".cache/tmp").mkdir(parents=True)
        (home / ".local/lib/workbench-host-install").mkdir(parents=True)
        private = root / "private"
        private.mkdir()
        dns = root / "resolv.conf"
        dns.write_text("nameserver 10.0.2.3\n")
        runtime = root / "runtime"
        runtime.mkdir()
        return home, private, dns, runtime

    def mounts(self, home, dns, private, runtime):
        # Relocate only the fixed runtime path into a disposable fixture. No
        # live runtime socket or host installer is created or replaced.
        original = Path
        def fixture_path(value):
            return runtime if str(value) == f"/run/user/{os.getuid()}" else original(value)
        with patch.object(display, "Path", side_effect=fixture_path):
            args = display.mounts(home, dns, private)
        # Match /run masking for the relocated synthetic runtime too.
        index = args.index("/run") + 1
        args[index:index] = ["--tmpfs", str(runtime)]
        return args

    @unittest.skipUnless(shutil.which("bwrap"), "bubblewrap namespace dependency")
    def test_missing_or_invalid_optional_endpoint_does_not_block_unrelated_cage_launch(self):
        scratch = Path.home() / ".cache/tmp"
        scratch.mkdir(parents=True, exist_ok=True)
        for state in ("missing", "regular", "socket", "symlink"):
            with self.subTest(state=state), tempfile.TemporaryDirectory(dir=scratch) as directory, \
                    socket.socket(socket.AF_UNIX) as server:
                root = Path(directory)
                home, private, dns, runtime = self.fixture_mounts(root)
                endpoint = home / ".local/lib/workbench-host-install/route.sock"
                if state == "regular":
                    endpoint.write_text("not a socket")
                elif state == "socket":
                    server.bind(str(endpoint))
                    endpoint.chmod(0o660)
                elif state == "symlink":
                    endpoint.symlink_to(runtime / "missing.sock")
                unrelated = home / ".local/state/engineer-state"
                unrelated.parent.mkdir(parents=True)
                code = r'''
from pathlib import Path
import sys
path = Path(sys.argv[1])
path.write_text("unrelated cage launched")
print(path.read_text())
'''
                process = subprocess.run(
                    [display.BWRAP, "--unshare-user", "--unshare-pid", "--unshare-net",
                     "--die-with-parent", "--cap-drop", "ALL",
                     *self.mounts(home, dns, private, runtime), "--", "/usr/bin/python3", "-c", code,
                     str(unrelated)], capture_output=True, text=True, timeout=10)
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertEqual(process.stdout, "unrelated cage launched\n")
                self.assertEqual(unrelated.read_text(), "unrelated cage launched")

    @unittest.skipUnless(shutil.which("bwrap"), "bubblewrap namespace dependency")
    def test_already_running_same_uid_cage_can_change_chmod_sealed_late_release(self):
        scratch = Path.home() / ".cache/tmp"
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            root = Path(directory)
            home, private, dns, runtime = self.fixture_mounts(root)
            (home / ".local/share").mkdir(parents=True)
            releases = home / ".local/share/workbench/releases"
            release = releases / ("a" * 40)
            asset = release / "synthetic-tool"
            self.assertFalse(releases.exists())
            code = r'''
import json, os, stat, sys
from pathlib import Path
releases, release, asset = map(Path, sys.argv[1:])
print(json.dumps({"uid": os.getuid(), "release_absent": not releases.exists(),
                  "mount_namespace": os.readlink("/proc/self/ns/mnt")}), flush=True)
if sys.stdin.readline() != "created\n":
    raise RuntimeError("late release was not created")
sealed_modes = [stat.S_IMODE(path.stat().st_mode) for path in (releases, release, asset)]
releases.chmod(0o755)
release.chmod(0o755)
asset.chmod(0o755)
asset.write_text("changed by already-running same-UID cage")
print(json.dumps({"sealed_modes": sealed_modes, "changed": asset.read_text()}), flush=True)
'''
            with subprocess.Popen(
                    [display.BWRAP, "--unshare-user", "--unshare-pid", "--unshare-net",
                     "--die-with-parent", "--cap-drop", "ALL",
                     *self.mounts(home, dns, private, runtime), "--", "/usr/bin/python3", "-c", code,
                     str(releases), str(release), str(asset)],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as child:
                try:
                    self.assertTrue(select.select([child.stdout], [], [], 10)[0])
                    ready = json.loads(child.stdout.readline())
                    self.assertEqual(ready["uid"], os.getuid())
                    self.assertTrue(ready["release_absent"])
                    self.assertNotEqual(ready["mount_namespace"], os.readlink("/proc/self/ns/mnt"))
                    # Create and seal only after the normal cage is running.
                    # This is the exclusion blocker, not an added mount grant.
                    release.mkdir(parents=True)
                    asset.write_text("#!/bin/sh\nprintf 'reviewed synthetic release\\n'\n")
                    asset.chmod(0o555)
                    release.chmod(0o555)
                    releases.chmod(0o555)
                    self.assertEqual(asset.stat().st_uid, os.getuid())
                    self.assertEqual([stat.S_IMODE(path.stat().st_mode)
                                      for path in (releases, release, asset)], [0o555] * 3)
                    output, errors = child.communicate("created\n", timeout=10)
                    self.assertEqual(child.returncode, 0, errors)
                    self.assertEqual(json.loads(output), {
                        "sealed_modes": [0o555] * 3,
                        "changed": "changed by already-running same-UID cage",
                    })
                    self.assertEqual(asset.read_text(), "changed by already-running same-UID cage")
                    self.assertEqual([stat.S_IMODE(path.stat().st_mode)
                                      for path in (releases, release, asset)], [0o755] * 3)
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.communicate(timeout=5)

    @unittest.skipUnless(shutil.which("bwrap"), "bubblewrap namespace dependency")
    def test_installed_socket_recreation_and_library_private_state_are_protected(self):
        scratch = Path.home() / ".cache/tmp"
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory, socket.socket(socket.AF_UNIX) as server:
            root = Path(directory)
            home, private, dns, runtime = self.fixture_mounts(root)
            protected = [
                home / ".local/lib/workbench-host-install/audit",
                home / ".local/lib/workbench-host-install/sources",
            ]
            for path in protected:
                path.mkdir(parents=True)
                (path / "sentinel").write_text("host-owned")
            (home / ".hermes/profiles/kaylee").mkdir(parents=True)
            (home / ".hermes/profiles/kaylee/private").write_text("hidden")
            unrelated = home / ".local/state/workbench/engineer-state"
            unrelated.parent.mkdir(parents=True)
            unrelated.write_text("engineer-owned")
            (runtime / "unrelated-secret").write_text("not exposed")
            endpoint = home / ".local/lib/workbench-host-install/route.sock"
            server.bind(str(endpoint))
            endpoint.chmod(0o600)
            server.listen(1)
            server.settimeout(5)
            failures = []
            def host():
                try:
                    connection, _ = server.accept()
                    with connection, socket.socket(socket.AF_UNIX) as replacement:
                        self.assertEqual(connection.recv(32), b"capabilities\n")
                        # Activation may recreate its owned socket while an
                        # already launched engineer keeps the directory mount.
                        server.close()
                        endpoint.unlink()
                        replacement.bind(str(endpoint))
                        endpoint.chmod(0o600)
                        replacement.listen(1)
                        replacement.settimeout(5)
                        connection.sendall(b"host-route\n")
                        second, _ = replacement.accept()
                        with second:
                            self.assertEqual(second.recv(32), b"readback\n")
                            second.sendall(b"recreated-route\n")
                except Exception as exc:
                    failures.append(exc)
            thread = threading.Thread(target=host, daemon=True)
            thread.start()
            code = r'''
import json, socket, sys
from pathlib import Path
endpoint, secret, hermes, unrelated, *protected = map(Path, sys.argv[1:])
with socket.socket(socket.AF_UNIX) as connection:
    connection.settimeout(3)
    connection.connect(str(endpoint))
    connection.sendall(b"capabilities\n")
    response = connection.recv(32).decode()
with socket.socket(socket.AF_UNIX) as connection:
    connection.settimeout(3)
    connection.connect(str(endpoint))
    connection.sendall(b"readback\n")
    recreated = connection.recv(32).decode()
try:
    endpoint.unlink()
    socket_protected = False
except OSError:
    socket_protected = True
denied = []
for path in protected:
    operations = [
        lambda: (path / "sentinel").write_text("tampered"),
        lambda: (path / "new-file").write_text("tampered"),
        lambda: path.rename(path.with_name(path.name + "-moved")),
    ]
    for operation in operations:
        try:
            operation()
            denied.append(False)
        except OSError:
            denied.append(True)
unrelated.write_text("still writable")
print(json.dumps({"reply": response, "recreated": recreated, "socket_protected": socket_protected,
                  "secret_hidden": not secret.exists(), "hermes_hidden": not hermes.exists(),
                  "denied": denied, "unrelated_writable": unrelated.read_text() == "still writable"}))
'''
            process = subprocess.run(
                [display.BWRAP, "--unshare-user", "--unshare-pid", "--unshare-net",
                 "--die-with-parent", "--cap-drop", "ALL",
                 *self.mounts(home, dns, private, runtime), "--", "/usr/bin/python3", "-c", code,
                 str(endpoint), str(runtime / "unrelated-secret"), str(home / ".hermes/profiles/kaylee/private"),
                 str(unrelated), *map(str, protected)],
                capture_output=True, text=True, timeout=10)
            thread.join(6)
            self.assertFalse(thread.is_alive())
            self.assertEqual(failures, [])
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual(json.loads(process.stdout), {
                "reply": "host-route\n", "recreated": "recreated-route\n", "socket_protected": True,
                "secret_hidden": True, "hermes_hidden": True,
                "denied": [True] * 6, "unrelated_writable": True,
            })
            for path in protected:
                self.assertEqual((path / "sentinel").read_text(), "host-owned")

@unittest.skipUnless(shutil.which("bwrap") and shutil.which("slirp4netns"), "display namespace dependencies")
class NamespaceAuthorityTests(unittest.TestCase):
    def test_env_socket_rediscovery_host_proc_loopback_and_inherited_fds_are_fenced(self):
        scratch = Path.home() / ".cache/tmp"
        scratch.mkdir(parents=True, exist_ok=True)
        scratch_device = scratch.stat().st_dev
        with tempfile.TemporaryDirectory(dir=scratch) as directory, socket.socket(socket.AF_UNIX) as filesystem, \
                socket.socket(socket.AF_UNIX) as abstract, socket.socket() as tcp:
            path = str(Path(directory) / "display.sock")
            filesystem.bind(path)
            filesystem.listen(1)
            abstract_name = "\0omp-display-test-" + str(os.getpid())
            abstract.bind(abstract_name)
            abstract.listen(1)
            tcp.bind(("127.0.0.1", 0))
            tcp.listen(1)
            code = r'''
import json, os, socket, sys, tempfile
from pathlib import Path
path, abstract, host_pid, port, fd, scratch_device = sys.argv[1:]
result = {}
for name, family, address in (
    ("pathname", socket.AF_UNIX, path),
    ("abstract", socket.AF_UNIX, "\0" + abstract),
    ("host_loopback", socket.AF_INET, ("127.0.0.1", int(port))),
    ("slirp_host_gateway", socket.AF_INET, ("10.0.2.2", int(port))),
):
    with socket.socket(family) as client:
        client.settimeout(0.5)
        try:
            client.connect(address)
            result[name] = "reachable"
        except OSError:
            result[name] = "denied"
result["host_proc"] = "denied" if not Path("/proc/" + host_pid + "/environ").exists() else "reachable"
try:
    os.fstat(int(fd))
    result["inherited_fd"] = "reachable"
except OSError:
    result["inherited_fd"] = "denied"
result["display_env"] = [name for name in ("DISPLAY", "WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "DBUS_SESSION_BUS_ADDRESS") if name in os.environ]
result["no_input_devices"] = not Path("/dev/input").exists() and not Path("/dev/uinput").exists()
result["native_media_hidden"] = not Path("/run/user/" + str(os.getuid()) + "/pipewire-0").exists()
result["scratch_backing_preserved"] = (Path.home() / ".cache/tmp").stat().st_dev == int(scratch_device)
result["default_scratch_private"] = tempfile.gettempdir() == str(Path.home() / ".cache/tmp")
print(json.dumps(result))
sys.exit(73)
'''
            environment = {key: value for key, value in os.environ.items() if not key.startswith("HERDR_")}
            environment.update(DISPLAY=":777", WAYLAND_DISPLAY=path,
                               HYPRLAND_INSTANCE_SIGNATURE="synthetic", DBUS_SESSION_BUS_ADDRESS="unix:path=" + path)
            child = subprocess.run(
                [sys.executable, str(DIRECTORY / "omp-display.py"), "--", sys.executable, "-c", code,
                 path, abstract_name[1:], str(os.getpid()), str(tcp.getsockname()[1]),
                 str(filesystem.fileno()), str(scratch_device)],
                env=environment, pass_fds=(filesystem.fileno(),), capture_output=True, text=True, timeout=20)
            self.assertEqual(child.returncode, 73, child.stderr)
            self.assertEqual(json.loads(child.stdout), {
                "pathname": "denied", "abstract": "denied", "host_loopback": "denied",
                "slirp_host_gateway": "denied", "host_proc": "denied", "inherited_fd": "denied",
                "display_env": [], "no_input_devices": True,
                "native_media_hidden": True,
                "scratch_backing_preserved": True,
                "default_scratch_private": True,
            })

    def test_hidden_caller_interpreter_bootstraps_without_exposing_hermes(self):
        hidden = Path.home() / ".hermes"
        hidden.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="omp-display-interpreter-", dir=hidden) as directory:
            interpreter = Path(directory) / "python3"
            interpreter.symlink_to("/usr/bin/python3")
            environment = {key: value for key, value in os.environ.items()
                           if not key.startswith(("HERDR_", "OMP_ENGINEER_DISPLAY"))}
            environment["DISPLAY"] = ":777"
            namespaces = [os.readlink(f"/proc/self/ns/{name}") for name in ("mnt", "pid", "net")]
            code = r'''
import json, os, sys
from pathlib import Path
print(json.dumps({
    "caller_interpreter_hidden": not Path(sys.argv[1]).exists(),
    "display_env_removed": "DISPLAY" not in os.environ,
    "private_namespaces": [
        os.readlink("/proc/self/ns/" + name) != parent
        for name, parent in zip(("mnt", "pid", "net"), sys.argv[2:])
    ],
}))
sys.exit(73)
'''
            child = subprocess.run(
                [str(interpreter), str(DIRECTORY / "omp-display.py"), "--",
                 "/usr/bin/python3", "-c", code, str(interpreter), *namespaces],
                env=environment, capture_output=True, text=True, timeout=25)
            self.assertEqual(child.returncode, 73, child.stderr)
            self.assertEqual(json.loads(child.stdout), {
                "caller_interpreter_hidden": True, "display_env_removed": True,
                "private_namespaces": [True, True, True],
            })

    def test_group_interrupt_is_single_and_term_reaches_command_for_graceful_flush(self):
        code = r'''
import signal, sys, time
count = 0
def interrupt(*_):
    global count
    count += 1
    print("INTERRUPTED", flush=True)
def terminate(*_):
    print("FLUSHED interrupts=" + str(count), flush=True)
    sys.exit(42)
signal.signal(signal.SIGINT, interrupt)
signal.signal(signal.SIGQUIT, interrupt)
signal.signal(signal.SIGTERM, terminate)
print("READY", flush=True)
time.sleep(30)
'''
        for interrupted in (signal.SIGINT, signal.SIGQUIT):
            with self.subTest(signal=interrupted):
                environment = {key: value for key, value in os.environ.items() if not key.startswith("HERDR_")}
                with subprocess.Popen([sys.executable, str(DIRECTORY / "omp-display.py"), "--",
                                       sys.executable, "-u", "-c", code],
                                      env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, start_new_session=True) as child:
                    try:
                        self.assertTrue(select.select([child.stdout], [], [], 10)[0])
                        self.assertEqual(child.stdout.readline().strip(), "READY")
                        os.killpg(child.pid, interrupted)
                        self.assertTrue(select.select([child.stdout], [], [], 5)[0])
                        self.assertEqual(child.stdout.readline().strip(), "INTERRUPTED")
                        child.send_signal(signal.SIGTERM)
                        # Network termination and bridge joins each have three-second cleanup bounds.
                        # This wait covers teardown, not a five-second graceful-command contract.
                        output, errors = child.communicate(timeout=15)
                        self.assertEqual(child.returncode, 42, errors)
                        self.assertEqual(output.strip(), "FLUSHED interrupts=1")
                    finally:
                        if child.poll() is None:
                            child.kill()
                            child.communicate(timeout=5)

    def test_internal_exec_and_gui_reject_forged_host_markers(self):
        environment = {**os.environ, "OMP_ENGINEER_DISPLAY": "isolated-v1",
                       "OMP_ENGINEER_DISPLAY_NS": os.readlink("/proc/self/ns/mnt")}
        for name, args in (("omp-display.py", ["--_exec", "/usr/bin/true"]),
                           ("omp-gui.py", ["--", "/usr/bin/true"])):
            with self.subTest(name=name):
                child = subprocess.run([sys.executable, str(DIRECTORY / name), *args],
                                       env=environment, capture_output=True, text=True, timeout=5)
                self.assertEqual(child.returncode, 1, child.stderr)


if __name__ == "__main__":
    unittest.main()
