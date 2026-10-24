import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "t3-runtime-mode.ts");
const token = "synthetic-bearer-never-print";
const roots: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];

function fixture(scenario = "success") {
	const root = mkdtempSync(join(tmpdir(), "t3-runtime-mode-"));
	roots.push(root);
	mkdirSync(join(root, "bin"));
	mkdirSync(join(root, "userdata"));
	writeFileSync(join(root, "bin/t3"), `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const root = process.env.T3CODE_HOME;
appendFileSync(root + "/calls", JSON.stringify(args) + "\\n");
const session = () => JSON.parse(readFileSync(root + "/session", "utf8"));
switch (args[2]) {
  case "issue": {
    const label = args[args.indexOf("--label") + 1];
    const value = { sessionId: "test-session", token: ${JSON.stringify(token)}, client: { label } };
    writeFileSync(root + "/session", JSON.stringify(value));
    if (process.env.TEST_SCENARIO === "lost-issue") {
      console.error(value.token); process.exit(9);
    }
    console.log(JSON.stringify(value)); break;
  }
  case "list": console.log(JSON.stringify([{ sessionId: "foreign", client: null }, session()])); break;
  case "revoke":
    if (process.env.TEST_SCENARIO === "revoke-failure") { console.error(session().token); process.exit(9); }
    writeFileSync(root + "/revoked", args[3]); break;
  default: process.exit(7);
}
`, { mode: 0o700 });
	return { root, env: { ...process.env, T3CODE_HOME: root, PATH: `${root}/bin:${process.env.PATH}`, TEST_SCENARIO: scenario } };
}

function runtime(root: string, origin: string) {
	writeFileSync(join(root, "userdata/server-runtime.json"), JSON.stringify({ origin }));
}

function fakeServer(root: string, reply: "success" | "failure" | "malformed" | "close" | "wait" | "deny" = "success") {
	const received: unknown[] = [];
	let connected = () => {};
	const ready = new Promise<void>((accept) => { connected = accept; });
	const server = Bun.serve({
		hostname: "127.0.0.1", port: 0,
		fetch(request, server) {
			received.push({ url: request.url, authorization: request.headers.get("authorization") });
			if (reply === "deny") return new Response(token, { status: 401 });
			if (server.upgrade(request)) return;
			return new Response("Bad upgrade", { status: 400 });
		},
		websocket: {
			open() { connected(); },
			message(socket, data) {
				const request: unknown = JSON.parse(String(data));
				received.push(request);
				if (typeof request !== "object" || request === null || !("_tag" in request) || request._tag !== "Request") return;
				if (reply === "wait") return;
				if (reply === "close") { socket.close(); return; }
				if (reply === "malformed") { socket.send("malformed " + token); return; }
				socket.send(JSON.stringify([
					{ _tag: "Ping" },
					{ _tag: "Exit", requestId: 999, exit: { _tag: "Success", value: { sequence: 999 } } },
					{ _tag: "Exit", requestId: 1, exit: reply === "failure"
						? { _tag: "Failure", cause: [{ _tag: "Fail", error: { message: token } }] }
						: { _tag: "Success", value: { sequence: 42 } } },
				]));
			},
		},
	});
	servers.push(server);
	runtime(root, server.url.origin);
	return { server, received, ready };
}

function start(files: ReturnType<typeof fixture>, args = ["mcp:test-thread", "full-access"]) {
	return Bun.spawn({ cmd: [process.execPath, cli, ...args], env: files.env, stdout: "pipe", stderr: "pipe" });
}

async function result(child: ReturnType<typeof start>) {
	const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(stdout + stderr).not.toContain(token);
	return { stdout, stderr, status };
}

function calls(root: string): string[][] {
	return readFileSync(join(root, "calls"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("CLI authenticates in a header, sends Effect frames, waits for its Exit and revokes before success", async () => {
	const files = fixture();
	const { server, received } = fakeServer(files.root);
	const output = await result(start(files));
	expect(output.status).toBe(0);
	expect(output.stderr).toBe("");
	expect(JSON.parse(output.stdout)).toEqual({ threadId: "mcp:test-thread", runtimeMode: "full-access", sequence: 42, sessionId: "test-session", revoked: true });
	expect(received[0]).toEqual({ url: `${server.url.origin}/ws?orchestrationProtocol=2`, authorization: `Bearer ${token}` });
	expect(received[1]).toEqual({
		_tag: "Request", id: 1, tag: "orchestration.dispatchCommand", headers: [],
		payload: { type: "thread.runtime-mode.set", threadId: "mcp:test-thread", runtimeMode: "full-access", commandId: expect.any(String) },
	});
	expect(readFileSync(join(files.root, "revoked"), "utf8")).toBe("test-session");
	const invocations = calls(files.root);
	expect(invocations).toHaveLength(2);
	expect(invocations[0]).toEqual(["auth", "session", "issue", "--scope", "orchestration:operate", "--ttl", "10m", "--label", expect.stringMatching(/^agent-runtime-mode:/), "--json", "--base-dir", files.root, "--log-level", "none"]);
	expect(invocations[1]).toEqual(["auth", "session", "revoke", "test-session", "--base-dir", files.root, "--log-level", "none"]);
	expect(JSON.stringify(invocations)).not.toContain(token);
});

for (const reply of ["failure", "malformed", "close", "deny"] as const) {
	test(`revokes on ${reply} without printing server credentials or claiming success`, async () => {
		const files = fixture();
		fakeServer(files.root, reply);
		const output = await result(start(files));
		expect(output.status).toBe(1);
		expect(output.stdout).toBe("");
		expect(readFileSync(join(files.root, "revoked"), "utf8")).toBe("test-session");
	});
}

test("revokes after SIGTERM while waiting for acknowledgement", async () => {
	const files = fixture();
	const { ready } = fakeServer(files.root, "wait");
	const child = start(files);
	await ready;
	child.kill("SIGTERM");
	const output = await result(child);
	expect(output.status).toBe(1);
	expect(readFileSync(join(files.root, "revoked"), "utf8")).toBe("test-session");
});

test("times out and revokes when the server never acknowledges", async () => {
	const files = fixture();
	fakeServer(files.root, "wait");
	const output = await result(start(files));
	expect(output.status).toBe(1);
	expect(output.stderr).toContain("Timed out waiting for T3 acknowledgement; command outcome is unknown");
	expect(readFileSync(join(files.root, "revoked"), "utf8")).toBe("test-session");
}, 20_000);

test("recovers and revokes by unique label if issuance loses its response", async () => {
	const files = fixture("lost-issue");
	fakeServer(files.root);
	const output = await result(start(files));
	expect(output.status).toBe(1);
	expect(calls(files.root).map((call) => call[2])).toEqual(["issue", "list", "revoke"]);
	expect(readFileSync(join(files.root, "revoked"), "utf8")).toBe("test-session");
});

test("failed revocation fails the command and identifies the recovery label", async () => {
	const files = fixture("revoke-failure");
	fakeServer(files.root);
	const output = await result(start(files));
	expect(output.status).toBe(1);
	expect(output.stdout).toBe("");
	expect(output.stderr).toContain("Session cleanup failed; revoke sessions labelled agent-runtime-mode:");
});

test("invalid args and remote origins never mint a session", async () => {
	const files = fixture();
	runtime(files.root, "http://example.com");
	for (const args of [[], ["mcp:test", "invalid"], ["mcp:test", "auto"], ["--bad", "auto"]]) {
		expect((await result(start(files, args))).status).toBe(1);
	}
	expect(() => calls(files.root)).toThrow();
});
