import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { jevProvider, resetJevProviderForTests } from "./jev-key.ts";

const saved = { openrouter: process.env.OPENROUTER_API_KEY, typesafe: process.env.TYPESAFE_API_KEY };
let root = "";

// Emulates the pass-env contract: map NAME=entry from -f, inject a value, exec the command.
function fakeLauncher(behavior: "ok" | "locked"): string {
	const path = join(root, "pass-env");
	const body = behavior === "ok"
		? `name=$(grep -v '^#' "$3" | cut -d= -f1); export "$name=fixture-key-from-pass"; shift 4; exec "$@"`
		: `echo "DECRYPT: pass lookup failed; unlock outside this command" >&2; exit 1`;
	writeFileSync(path, `#!/bin/sh\necho call >> "${join(root, "calls")}"\n[ "$1" = run ] && [ "$2" = -f ] && [ "$4" = -- ] || exit 64\n${body}\n`);
	chmodSync(path, 0o755);
	return path;
}
const calls = () => readFileSync(join(root, "calls"), "utf8").trim().split("\n").length;

beforeEach(() => {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	root = mkdtempSync(join(scratch, "jev-key-"));
	writeFileSync(join(root, "jev.env.pass"), "# names only\nOPENROUTER_API_KEY=workstation/EXAMPLE\n");
	delete process.env.OPENROUTER_API_KEY;
	delete process.env.TYPESAFE_API_KEY;
	resetJevProviderForTests();
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (saved.openrouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved.openrouter;
	if (saved.typesafe === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = saved.typesafe;
	resetJevProviderForTests();
});

test("a pass-resolved key authenticates live Jev requests without entering the environment", async () => {
	const seen: string[] = [];
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: (request) => {
			seen.push(request.headers.get("authorization") ?? "");
			return Response.json({ model: "typesafe/jev-fixture", answers: { q: { type: "noul", noul: 0.2 } } });
		},
	});
	try {
		const options = { launcher: fakeLauncher("ok"), file: join(root, "jev.env.pass"), endpoint: `http://127.0.0.1:${server.port}/decisions` };
		const resolution = await jevProvider(options);
		expect(resolution.source).toBe("pass-env");
		const answers = await resolution.provider!.evaluate("state", { q: { type: "noul", instructions: "fixture" } } as never);
		expect(answers.q.type).toBe("noul");
		expect(seen).toEqual(["Bearer fixture-key-from-pass"]);
		expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
		await jevProvider(options);
		expect(calls()).toBe(1);
	} finally {
		server.stop(true);
	}
});

test("a locked store yields no provider with a visible reason, without retrying every turn", async () => {
	const options = { launcher: fakeLauncher("locked"), file: join(root, "jev.env.pass") };
	const first = await jevProvider(options);
	expect(first.provider).toBeNull();
	expect(first.source).toBe("none");
	expect(first.reason).toContain("unlock");
	await jevProvider(options);
	expect(calls()).toBe(1);
});

test("an environment key wins without invoking pass-env", async () => {
	process.env.OPENROUTER_API_KEY = "env-fixture-key";
	const launcher = fakeLauncher("ok");
	const resolution = await jevProvider({ launcher, file: join(root, "jev.env.pass") });
	expect(resolution.source).toBe("env");
	expect(resolution.provider?.name).toBe("openrouter");
	expect(() => readFileSync(join(root, "calls"))).toThrow();
});
