import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ws = join(import.meta.dir, "ws.ts");
const leaseScript = join(import.meta.dir, "../skills/session-close/session-close.ts");
const roots: string[] = [];
const fakeSSH = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$WS_FAKE_ROOT/ssh-argv.log"
while [ "\${1:-}" = -o ]; do shift 2; done
if [ "\${1:-}" = -N ]; then
  shift
  [ "$1" = -L ] || exit 43
  forward="$2"; port="\${forward%%:*}"; shift 2
  [ "$1" = "$WS_PROJECT-ws.exe.xyz" ] || exit 44
  exec bun -e 'Bun.serve({hostname:"127.0.0.1",port:Number(process.argv[2].split(":")[0]),fetch:()=>new Response("{\\"Browser\\":\\"fake\\"}",{headers:{"content-type":"application/json"}})});' -- -L "$forward" "$1"
fi
host="$1"; shift
if [ "$host" = exe.dev ]; then
  case "$1" in
    ls) if [ -f "$WS_FAKE_ROOT/vm-created" ]; then printf '{"vms":[{"vm_name":"%s-ws"}]}\\n' "$WS_PROJECT"; else printf '{"vms":[]}\\n'; fi ;;
    new)
      # Like the real lobby: ssh joins argv, then tokens split on spaces outside double quotes; positionals are rejected.
      printf '%s' "$*" | bun -e 'const line = await Bun.stdin.text(); const tokens = line.match(/(?:[^\\s"]+|"[^"]*")+/g) ?? []; if (tokens.slice(1).some((t) => !t.startsWith("--"))) { console.log(JSON.stringify({ error: "\\"new\\" command has no subcommands and does not take positional arguments" })); process.exit(1); }' || exit 1
      touch "$WS_FAKE_ROOT/vm-created"; mkdir -p "$WS_FAKE_ROOT/vm"; printf '{"vm_name":"%s-ws"}\\n' "$WS_PROJECT" ;;
    tag) : ;;
    *) exit 41 ;;
  esac
  exit
fi
[ "$host" = "$WS_PROJECT-ws.exe.xyz" ] || exit 42
mkdir -p "$WS_FAKE_ROOT/vm"
export HOME="$WS_FAKE_ROOT/vm"
cd "$HOME"
exec bash -c "$*"
`;
function sh(repo: string, args: string[], env?: Record<string, string>) {
	const result = Bun.spawnSync(args, { cwd: repo, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
	return { code: result.exitCode ?? 1, out: result.stdout.toString(), err: result.stderr.toString() };
}
function fixture() {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const root = mkdtempSync(join(scratch, "ws-contract-"));
	roots.push(root);
	const repo = join(root, "sample");
	const localHome = join(root, "home");
	const bin = join(root, "bin");
	mkdirSync(repo); mkdirSync(localHome); mkdirSync(bin);
	const fake = join(bin, "ssh");
	writeFileSync(fake, fakeSSH, { mode: 0o755 });
	const env = { HOME: localHome, PATH: `${bin}:${process.env.PATH}`, WS_FAKE_ROOT: root, WS_PROJECT: "sample", WS_SESSION_CLOSE_SCRIPT: leaseScript, SESSION_CLOSE_OWNER: "workspace-test-owner" };
	sh(repo, ["git", "init", "-q"]);
	writeFileSync(join(repo, ".gitignore"), "ignored.out\n");
	writeFileSync(join(repo, "tracked.txt"), "original\n");
	sh(repo, ["git", "add", ".gitignore", "tracked.txt"]);
	sh(repo, ["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "initial"]);
	const run = (args: string[], opts: { input?: string; extra?: Record<string, string> } = {}) => {
		const result = Bun.spawnSync(["bun", ws, ...args], { cwd: repo, env: { ...process.env, ...env, ...opts.extra }, stdin: opts.input === undefined ? undefined : new TextEncoder().encode(opts.input), stdout: "pipe", stderr: "pipe" });
		return { code: result.exitCode ?? 1, out: result.stdout.toString(), err: result.stderr.toString() };
	};
	return { root, repo, env, run, localHome };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("US-025 snapshot pushes untracked non-ignored files into detached remote worktree without touching local HEAD or index", () => {
	const { repo, root, run, env } = fixture();
	const head = sh(repo, ["git", "rev-parse", "HEAD"]).out.trim();
	const index = readFileSync(join(repo, ".git/index"));
	writeFileSync(join(repo, "tracked.txt"), "changed\n");
	writeFileSync(join(repo, "new.txt"), "untracked\n");
	writeFileSync(join(repo, "ignored.out"), "ignored\n");
	const before = sh(repo, ["git", "status", "--porcelain"]).out;
	expect(run(["init"]).code).toBe(0);
	expect(run(["init"]).code).toBe(0);
	const up = run(["up", "--task", "one"]);
	expect(up.code, up.err).toBe(0);
	expect(up.out).toMatch(/snapshot=[0-9a-f]{40} tree=[0-9a-f]{40}/);
	const worktree = join(root, "vm/ws/sample/tasks/one");
	expect(readFileSync(join(worktree, "tracked.txt"), "utf8")).toBe("changed\n");
	expect(readFileSync(join(worktree, "new.txt"), "utf8")).toBe("untracked\n");
	expect(readdirSync(worktree)).not.toContain("ignored.out");
	expect(sh(repo, ["git", "rev-parse", "HEAD"]).out.trim()).toBe(head);
	expect(readFileSync(join(repo, ".git/index"))).toEqual(index);
	expect(sh(repo, ["git", "status", "--porcelain"]).out).toBe(before);
	writeFileSync(join(worktree, "ignored.out"), "cache survives\n");
	writeFileSync(join(worktree, "stale.txt"), "removed on sync\n");
	writeFileSync(join(repo, "tracked.txt"), "second snapshot\n");
	const refreshed = run(["sync", "--task", "one"]);
	expect(refreshed.code, refreshed.err).toBe(0);
	expect(readFileSync(join(worktree, "tracked.txt"), "utf8")).toBe("second snapshot\n");
	expect(readFileSync(join(worktree, "ignored.out"), "utf8")).toBe("cache survives\n");
	expect(readdirSync(worktree)).not.toContain("stale.txt");
	expect(readFileSync(join(repo, ".git/index"))).toEqual(index);
	expect(sh(repo, ["git", "rev-parse", "HEAD"]).out.trim()).toBe(head);
	const leaseFiles = readdirSync(join(env.HOME, ".cache/tmp/omp-session-leases"));
	expect(leaseFiles).toHaveLength(1);
	expect(JSON.parse(readFileSync(join(env.HOME, ".cache/tmp/omp-session-leases", leaseFiles[0]), "utf8")).kind).toBe("exe.dev-worktree");
});

test("US-025 clean snapshot preserves the exact committed HEAD on the VM", () => {
	const { repo, root, run } = fixture();
	const head = sh(repo, ["git", "rev-parse", "HEAD"]).out.trim();
	expect(run(["init"]).code).toBe(0);
	const up = run(["up", "--task", "candidate"]);
	expect(up.code, up.err).toBe(0);
	expect(up.out).toContain(`snapshot=${head}`);
	expect(sh(join(root, "vm/ws/sample/tasks/candidate"), ["git", "rev-parse", "HEAD"]).out.trim()).toBe(head);
});

test("US-025 a linked worktree targets its repository's project VM, not its directory name", () => {
	const { repo, root, run } = fixture();
	expect(run(["init"]).code).toBe(0);
	const linked = join(root, "feature-branch-checkout");
	sh(repo, ["git", "worktree", "add", "-q", "-b", "feature", linked]);
	const status = Bun.spawnSync(["bun", ws, "status"], { cwd: linked, env: { ...process.env, HOME: join(root, "home"), PATH: `${join(root, "bin")}:${process.env.PATH}`, WS_FAKE_ROOT: root, WS_PROJECT: "sample" }, stdout: "pipe", stderr: "pipe" });
	expect(status.stdout.toString()).toContain("sample-ws.exe.xyz: ready");
});

test("US-025 env and command stdin reach only the command, exit propagates, and down gates evidence digests", () => {
	const { repo, root, run, env, localHome } = fixture();
	expect(run(["init"]).code).toBe(0);
	const up = run(["up", "--task", "one"]);
	expect(up.code, up.err).toBe(0);
	const secret = `one-time-${crypto.randomUUID()}`;
	const command = run(["run", "--task", "one", "--env", "TEST_SECRET", "--", "bash", "-c", "printf '%s\\n' \"$TEST_SECRET\"; cat"], { input: "input-data\n", extra: { TEST_SECRET: secret } });
	expect(command.code).toBe(0);
	expect(command.out).toContain(`${secret}\ninput-data\n`);
	expect(run(["run", "--task", "one", "--", "bash", "-c", "exit 37"]).code).toBe(37);
	const foreign = run(["down", "--task", "one"], { extra: { SESSION_CLOSE_OWNER: "another-owner" } });
	expect(foreign.code).not.toBe(0);
	expect(foreign.err).toContain("not leased to this session");
	expect(readFileSync(join(root, "ssh-argv.log"), "utf8")).not.toContain(secret);
	const evidence = join(root, "vm/ws/sample/evidence/one");
	mkdirSync(evidence, { recursive: true });
	writeFileSync(join(evidence, "result.txt"), "first\n");
	const refused = run(["down", "--task", "one"]);
	expect(refused.code).not.toBe(0);
	expect(refused.err).toContain("not pulled");
	expect(run(["pull", "--task", "one"]).code).toBe(0);
	expect(readFileSync(join(localHome, ".cache/tmp/ws/sample/one/result.txt"), "utf8")).toBe("first\n");
	writeFileSync(join(evidence, "result.txt"), "changed\n");
	const changed = run(["down", "--task", "one"]);
	expect(changed.code).not.toBe(0);
	expect(changed.err).toContain("changed");
	expect(run(["pull", "--task", "one"]).code).toBe(0);
	expect(run(["down", "--task", "one"]).code).toBe(0);
	expect(readdirSync(join(env.HOME, ".cache/tmp/omp-session-leases"))).toHaveLength(0);
	expect(readdirSync(join(root, "vm/ws/sample/tasks"))).not.toContain("one");
	expect(statSync(join(root, "vm/ws/sample/repo")).isDirectory()).toBe(true);
	// A forwarded value is not persisted anywhere in the fake VM or local workspace.
	const pending = [root];
	while (pending.length) {
		const directory = pending.pop()!;
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) pending.push(path);
			else if (entry.isFile()) expect(readFileSync(path).includes(secret)).toBe(false);
		}
	}
	expect(sh(repo, ["git", "status", "--porcelain"]).code).toBe(0);
});

test("US-025 setup bootstrap runs from the pushed snapshot only when its digest changes", () => {
	const { repo, root, run } = fixture();
	mkdirSync(join(repo, ".exe"));
	writeFileSync(join(repo, ".exe/setup.sh"), "echo first >> \"$HOME/setup-runs\"\n");
	expect(run(["init"]).code).toBe(0);
	expect(run(["init"]).code).toBe(0);
	const stamp = join(root, "vm/ws/sample/repo/.ws-setup-sha256");
	expect(readFileSync(join(root, "vm/setup-runs"), "utf8")).toBe("first\n");
	const first = readFileSync(stamp, "utf8");
	writeFileSync(join(repo, ".exe/setup.sh"), "echo second >> \"$HOME/setup-runs\"\n");
	const changed = run(["init"]);
	expect(changed.code, changed.err).toBe(0);
	expect(readFileSync(join(root, "vm/setup-runs"), "utf8")).toBe("first\nsecond\n");
	expect(readFileSync(stamp, "utf8")).not.toBe(first);
});

test("US-025 browser exposes CDP through one owned tunnel and stop removes that tunnel", async () => {
	const { repo, root, run, localHome } = fixture();
	writeFileSync(join(root, "bin/chromium"), "#!/bin/sh\nwhile :; do sleep 1; done\n", { mode: 0o755 });
	expect(run(["init"]).code).toBe(0);
	expect(run(["up", "--task", "one"]).code).toBe(0);
	const started = run(["browser", "--task", "one"]);
	expect(started.code, started.err).toBe(0);
	const url = started.out.match(/cdp_url=(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
	expect(url).toBeTruthy();
	expect((await fetch(`${url}/json/version`)).ok).toBe(true);
	const file = join(localHome, ".cache/tmp/ws/sample/one/tunnel.pid");
	const pid = readFileSync(file, "utf8");
	expect(run(["browser", "--task", "one"]).out).toContain(`cdp_url=${url}`);
	expect(readFileSync(file, "utf8")).toBe(pid);
	expect(run(["browser", "--task", "one", "--stop"]).code).toBe(0);
	expect(run(["down", "--task", "one"]).code).toBe(0);
	expect(sh(repo, ["git", "status", "--porcelain"]).code).toBe(0);
});
