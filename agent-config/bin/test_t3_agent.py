"""Exercise the executable at a real HTTP boundary with synthetic credentials."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CLI = Path(__file__).with_name("t3-agent")
TOKEN = "synthetic-test-credential"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.requests.append(body)
        if self.headers.get("Authorization") != "Bearer " + TOKEN or self.server.fail:
            self.send_response(401)
            self.end_headers()
            return
        if body["method"] == "notifications/initialized":
            self.send_response(202)
            self.end_headers()
            return
        result = {"protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {"name": "test", "version": "1"}}
        if body["method"] == "tools/call":
            name = body["params"]["name"]
            if name == "reject":
                result = {"isError": True, "structuredContent": {"code": "forbidden", "message": TOKEN}}
            elif name == "t3_environment_read":
                result = {"structuredContent": {"serverVersion": "test-version"}}
            else:
                result = {"structuredContent": {"received": body["params"]["arguments"]}}
        reply = {"jsonrpc": "2.0", "id": body["id"], "result": result}
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Mcp-Session-Id", "synthetic-session")
        self.end_headers()
        self.wfile.write(("data: " + json.dumps(reply) + "\n\n").encode())


class CliTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.requests = []
        self.server.fail = False
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.config = self.root / "config.toml"
        self.config.write_text(f'[[servers]]\nid = "test"\nurl = "http://127.0.0.1:{self.server.server_port}/mcp"\ntoken_env = "TEST_T3_TOKEN"\n')
        self.env = {**os.environ, "TEST_T3_TOKEN": TOKEN + "\n"}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()
        self.directory.cleanup()

    def run_cli(self, *arguments, input=None):
        if "--notify" in arguments:
            arguments += ("--report-url", "https://example.test/review")
        return subprocess.run([sys.executable, str(CLI), "--config", str(self.config), *arguments],
                              env=self.env, text=True, input=input, capture_output=True, timeout=10)

    def test_call_accepts_stdin_and_sse_without_printing_credential(self):
        result = self.run_cli("--server", "test", "call", "t3_thread_send", "@-", input='{"message":"hello"}')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"received": {"message": "hello"}})
        self.assertNotIn(TOKEN, result.stdout + result.stderr)
        self.assertEqual(len(self.server.requests), 3)

    def test_tool_rejection_is_nonzero_redacted_and_never_retried(self):
        result = self.run_cli("--server", "test", "call", "reject")
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(TOKEN, result.stderr)
        calls = [r for r in self.server.requests if r["method"] == "tools/call"]
        self.assertEqual(len(calls), 1)

    def test_invalid_json_never_contacts_server(self):
        result = self.run_cli("--server", "test", "call", "t3_thread_send", "[]")
        self.assertEqual(result.returncode, 1)
        self.assertIn("invalid-arguments", result.stderr)
        self.assertEqual(self.server.requests, [])

    def test_servers_reads_no_credentials(self):
        self.env.pop("TEST_T3_TOKEN")
        result = self.run_cli("servers")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[0]["id"], "test")
        self.assertEqual(self.server.requests, [])

    def test_missing_credential_fails_without_issuance(self):
        self.env.pop("TEST_T3_TOKEN")
        result = self.run_cli("check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("credential-missing", result.stdout)
        self.assertEqual(self.server.requests, [])

    def native_profile(self):
        profile = self.root / "native"
        profile.mkdir()
        url = f"http://127.0.0.1:{self.server.server_port}/mcp"
        (profile / ".claude.json").write_text(json.dumps({"mcpServers": {"native-test": {"type": "http", "url": url}}}))
        (profile / ".credentials.json").write_text(json.dumps({"mcpOAuth": {"cached": {
            "serverName": "native-test", "serverUrl": url, "accessToken": TOKEN}}}))
        self.env.pop("TEST_T3_TOKEN")
        return profile

    def test_native_profile_calls_with_existing_oauth_cache(self):
        profile = self.native_profile()
        before = (profile / ".credentials.json").read_bytes()
        result = self.run_cli("--claude-profile", str(profile), "--server", "native-test", "call", "t3_thread_read", '{"threadId":"owned"}')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"received": {"threadId": "owned"}})
        self.assertNotIn(TOKEN, result.stdout + result.stderr)
        self.assertEqual((profile / ".credentials.json").read_bytes(), before)

    def test_native_discovery_does_not_read_credentials(self):
        profile = self.native_profile()
        (profile / ".credentials.json").unlink()
        result = self.run_cli("--claude-profile", str(profile), "servers")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[0]["id"], "native-test")
        self.assertEqual(self.server.requests, [])

    def test_native_cache_must_match_both_server_name_and_url(self):
        profile = self.native_profile()
        path = profile / ".credentials.json"
        value = json.loads(path.read_text())
        value["mcpOAuth"]["cached"]["serverUrl"] = "https://other.example/mcp"
        path.write_text(json.dumps(value))
        result = self.run_cli("--claude-profile", str(profile), "--server", "native-test", "check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("native-credential-missing", result.stdout)
        self.assertNotIn(TOKEN, result.stdout + result.stderr)
        self.assertEqual(self.server.requests, [])

    def test_socks_curl_receives_credential_only_on_stdin(self):
        proxy = self.root / "curl"
        receipt = self.root / "curl-argv"
        proxy.write_text(f'''#!{sys.executable}
import json,sys,os
from pathlib import Path
Path(os.environ["CURL_RECEIPT"]).write_text(json.dumps(sys.argv))
lines=sys.stdin.read().splitlines()
body=json.loads(json.loads(next(line[7:] for line in lines if line.startswith("data = "))))
result={{"structuredContent":{{"via":"socks"}}}}
print("HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n"+json.dumps({{"jsonrpc":"2.0","id":body.get("id"),"result":result}}))
''')
        proxy.chmod(0o700)
        self.env.update(PATH=str(self.root) + os.pathsep + self.env["PATH"], CURL_RECEIPT=str(receipt))
        result = self.run_cli("--server", "test", "--socks-proxy", "localhost:1055", "call", "t3_thread_read")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"via": "socks"})
        self.assertIn("--socks5-hostname", receipt.read_text())
        self.assertNotIn(TOKEN, receipt.read_text() + result.stdout + result.stderr)

    def test_health_posts_failure_once_then_recovery(self):
        home = self.root / "home"
        receipt = self.root / "posts"
        home.write_text('#!/bin/sh\ncat >> "$TEST_POSTS"\n')
        home.chmod(0o700)
        self.env.update(PATH=str(self.root) + os.pathsep + self.env["PATH"], TEST_POSTS=str(receipt))
        state = str(self.root / "health.json")
        self.server.fail = True
        result = self.run_cli("check", "--notify", "--state", state)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("http-401", receipt.read_text())
        self.run_cli("check", "--notify", "--state", state)
        self.assertEqual(receipt.read_text().count("http-401"), 1)
        self.server.fail = False
        result = self.run_cli("check", "--notify", "--state", state)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(receipt.read_text().count("recovered"), 1)


if __name__ == "__main__":
    unittest.main()
