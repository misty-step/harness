import { afterEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const cli = join(import.meta.dir, "pass-env.ts");
const roots: string[] = [];
type Fixture = { root: string; store: string; env: NodeJS.ProcessEnv; calls: string };

function fixture(entries: Record<string, string | Uint8Array> = { token: "synthetic-value" }): Fixture {
	const root = mkdtempSync(join(tmpdir(), "pass-env-test-"));
	roots.push(root);
	const store = join(root, ".password-store");
	const bin = join(root, "bin");
	const calls = join(root, "pass-called");
	mkdirSync(store);
	mkdirSync(bin);
	for (const [name, value] of Object.entries(entries)) {
		const file = join(store, `${name}.gpg`);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, value);
	}
	writeFileSync(join(bin, "pass"), `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
appendFileSync(process.env.TEST_PASS_CALLS, "called\\n");
if (process.argv[2] !== "show" || process.argv[3] !== "--" || process.argv.length !== 5) process.exit(7);
if (process.env.PASSWORD_STORE_GPG_OPTS !== "--batch --pinentry-mode error") process.exit(8);
// Deliberately drain backend stdin: the launcher must leave child stdin alone.
await Bun.stdin.text();
if (process.argv[4] === "broken") {
  process.stdout.write("synthetic-backend-plaintext");
  process.stderr.write("synthetic-backend-stderr");
  process.exit(9);
}
process.stdout.write(readFileSync(join(process.env.PASSWORD_STORE_DIR, process.argv[4] + ".gpg")));
`, { mode: 0o700 });
	return {
		root, store, calls,
		env: { ...process.env, HOME: root, PASSWORD_STORE_DIR: store, PATH: `${bin}:${process.env.PATH}`, TEST_PASS_CALLS: calls },
	};
}

function invoke(files: Fixture, args: string[], input = "") {
	const result = spawnSync(process.execPath, [cli, ...args], {
		cwd: files.root, env: files.env, input, encoding: "utf8", timeout: 10_000,
	});
	if (result.error) throw result.error;
	return result;
}

function markerCommand(files: Fixture): string[] {
	return ["--", process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(join(files.root, "child-started"))}, "started")`];
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("pass-env", () => {
	test("list reports sorted names and literal prefixes without invoking pass or following symlinks", () => {
		const files = fixture({ "team/z": "not printed", "team/a": "not printed", other: "not printed" });
		mkdirSync(join(files.store, "directory.gpg"));
		symlinkSync(join(files.store, "other.gpg"), join(files.store, "alias.gpg"));
		symlinkSync(join(files.store, "team"), join(files.store, "linked-team"));
		const result = invoke(files, ["list", "--json"]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual(["other", "team/a", "team/z"]);
		expect(invoke(files, ["list", "team/"]).stdout).toBe("team/a\nteam/z\n");
		expect(invoke(files, ["list", "team/*", "--json"]).stdout).toBe("[]\n");
		delete files.env.PASSWORD_STORE_DIR;
		expect(JSON.parse(invoke(files, ["list", "--json"]).stdout)).toEqual(["other", "team/a", "team/z"]);
		const alternate = join(files.root, "alternate-store");
		mkdirSync(alternate);
		writeFileSync(join(alternate, "configured.gpg"), "not printed");
		files.env.PASSWORD_STORE_DIR = alternate;
		expect(JSON.parse(invoke(files, ["list", "--json"]).stdout)).toEqual(["configured"]);
		expect(existsSync(files.calls)).toBe(false);
	});

	test("a missing later mapping starts neither backend lookup nor the child", () => {
		const files = fixture();
		const result = invoke(files, ["run", "-e", "FIRST=token", "-e", "SECOND=missing", ...markerCommand(files)]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("SECOND");
		expect(result.stdout).toBe("");
		expect(existsSync(files.calls)).toBe(false);
		expect(existsSync(join(files.root, "child-started"))).toBe(false);
	});

	test("reference files are data, never shell programs", () => {
		const files = fixture();
		const injected = join(files.root, "injected");
		const reference = join(files.root, ".env.pass");
		writeFileSync(reference, `TOKEN=$(touch ${injected})\n`);
		const result = invoke(files, ["run", "-f", reference, ...markerCommand(files)]);
		expect(result.status).toBe(1);
		expect(existsSync(injected)).toBe(false);
		expect(existsSync(join(files.root, "child-started"))).toBe(false);
		expect(result.stderr).not.toContain("$(touch");
	});

	test("files apply in order, explicit mappings win, and whole values survive exactly", () => {
		const multi = "\ufeff first line\r\n雪\nlast line\n\n";
		const files = fixture({ second: "second", last: "last\n", multi, empty: "" });
		const first = join(files.root, "first.pass");
		const second = join(files.root, "second.pass");
		writeFileSync(first, "# comment\n\nVALUE=missing-but-overridden\nFILE_ORDER=missing-but-overridden\nEMPTY=empty\n");
		writeFileSync(second, "VALUE=second\nFILE_ORDER=second\nMULTI=multi\n");
		files.env.VALUE = "inherited";
		files.env.KEEP_ME = "untouched";
		const result = invoke(files, [
			"run", "-e", "VALUE=last", "-f", first, "--env-file", second,
			"--", process.execPath, "-e",
			'console.log(JSON.stringify([process.env.VALUE, process.env.FILE_ORDER, process.env.MULTI, process.env.EMPTY, process.env.KEEP_ME]))',
		]);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual(["last\n", "second", multi, "", "untouched"]);
	});

	test("prototype-like variable names are delivered as ordinary environment entries", () => {
		const files = fixture();
		const result = invoke(files, ["run", "-e", "__proto__=token", "--", "printenv", "__proto__"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("synthetic-value\n");
		expect(result.stderr).toBe("");
	});

	test("duplicate names within a reference file fail before execution", () => {
		const files = fixture();
		const reference = join(files.root, ".env.pass");
		writeFileSync(reference, "TOKEN=token\nTOKEN=token\n");
		const result = invoke(files, ["run", "-f", reference, ...markerCommand(files)]);
		expect(result.status).toBe(2);
		expect(existsSync(files.calls)).toBe(false);
		expect(existsSync(join(files.root, "child-started"))).toBe(false);
	});

	test("unsafe paths, symlinks, and directories cannot be mistaken for secret values", () => {
		const files = fixture({ "nested/token": "synthetic" });
		mkdirSync(join(files.store, "directory.gpg"));
		symlinkSync(join(files.store, "nested/token.gpg"), join(files.store, "alias.gpg"));
		symlinkSync(join(files.store, "nested"), join(files.store, "linked"));
		for (const entry of ["../escape", "/absolute", "nested/../nested/token", "alias", "linked/token", "directory"]) {
			const result = invoke(files, ["run", "-e", `TOKEN=${entry}`, ...markerCommand(files)]);
			expect(result.status).not.toBe(0);
		}
		const alias = join(files.root, "alias-store");
		symlinkSync(files.store, alias);
		files.env.PASSWORD_STORE_DIR = alias;
		expect(invoke(files, ["run", "-e", "TOKEN=nested/token", ...markerCommand(files)]).status).toBe(1);
		expect(existsSync(files.calls)).toBe(false);
		expect(existsSync(join(files.root, "child-started"))).toBe(false);
	});

	test("backend failures and invalid plaintext never leak diagnostics or start the child", () => {
		const files = fixture({ broken: "unused", nul: "synthetic-nul\0value", invalid: new Uint8Array([0xff, 0xfe]) });
		for (const entry of ["broken", "nul", "invalid"]) {
			const result = invoke(files, ["run", "-e", `TOKEN=${entry}`, ...markerCommand(files)]);
			expect(result.status).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain("TOKEN");
			expect(result.stderr).not.toContain("synthetic-");
			expect(existsSync(join(files.root, "child-started"))).toBe(false);
		}
	});

	test("command cwd, argv, piped stdin, unfiltered output, and exit status are preserved", () => {
		const files = fixture();
		const result = invoke(files, [
			"run", "-e", "TOKEN=token", "--", process.execPath, "-e",
			'console.log(JSON.stringify([process.cwd(), process.argv.slice(1), await Bun.stdin.text(), process.env.TOKEN])); console.error("child-stderr"); process.exitCode = 37;',
			"--", "argument with spaces", "$(not evaluated)",
		], "child input\n");
		expect(result.status).toBe(37);
		expect(JSON.parse(result.stdout)).toEqual([files.root, ["argument with spaces", "$(not evaluated)"], "child input\n", "synthetic-value"]);
		expect(result.stderr).toBe("child-stderr\n");
	});

	test("a child killed by a signal leaves the launcher terminated by that signal", () => {
		const files = fixture();
		const result = invoke(files, ["run", "-e", "TOKEN=token", "--", process.execPath, "-e", 'process.kill(process.pid, "SIGTERM")']);
		expect(result.status).toBeNull();
		expect(result.signal).toBe("SIGTERM");
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("");
	});

	test("a signal sent to the launcher reaches its running child", async () => {
		const files = fixture();
		const child = spawn(process.execPath, [cli, "run", "-e", "TOKEN=token", "--", process.execPath, "-e",
			'process.on("SIGTERM", () => process.exit(42)); process.stdin.resume(); console.log("ready");',
		], { cwd: files.root, env: files.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
		const { promise, resolve: accept, reject } = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
		// Watchdog only: synchronize on ready output, never a guessed delay.
		// Real process-group cleanup prevents an orphan if forwarding regresses.
		const stop = () => {
			try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
		};
		const timer = setTimeout(() => { stop(); reject(new Error("launcher signal forwarding timed out")); }, 4000);
		child.once("error", reject);
		child.stdout!.once("data", () => child.kill("SIGTERM"));
		child.once("exit", (code, signal) => accept({ code, signal }));
		try {
			expect(await promise).toEqual({ code: 42, signal: null });
		} finally {
			clearTimeout(timer);
			stop();
		}
	});
});
