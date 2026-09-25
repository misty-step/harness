#!/usr/bin/env bun
// ws: owned standalone launcher (misty-step/harness).
/** Local checkout of record; remote VM receives disposable snapshots and task worktrees. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createServer } from "node:net";

const sshOptions = ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes"];
const utf8 = new TextDecoder();
function quote(s: string): string { return `'${s.replaceAll("'", "'\\''")}'`; }
function fail(message: string): never { throw new Error(message.replaceAll(/\s+/g, " ")); }
function take(args: string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	if (i < 0) return undefined;
	const value = args[i + 1];
	if (!value || value.startsWith("-")) fail(`${flag} requires a value`);
	args.splice(i, 2);
	return value;
}
function command(argv: string[], options: { cwd?: string; env?: Record<string, string>; input?: Uint8Array; quiet?: boolean; acceptCodes?: number[] } = {}): Uint8Array {
	const result = Bun.spawnSync(argv, { cwd: options.cwd, env: options.env ? { ...process.env, ...options.env } : process.env, stdin: options.input ?? undefined, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0 && !(options.acceptCodes ?? []).includes(result.exitCode ?? -1)) fail(`${argv[0]} exited ${result.exitCode}: ${utf8.decode(result.stderr).trim() || utf8.decode(result.stdout).trim()}`);
	if (!options.quiet && result.stderr.length) process.stderr.write(result.stderr);
	return result.stdout;
}
function git(repo: string, args: string[], options: { env?: Record<string, string>; input?: Uint8Array } = {}): string {
	return utf8.decode(command(["git", ...args], { cwd: repo, ...options })).trim();
}
function ssh(host: string, script: string, input?: Uint8Array): Uint8Array {
	return command(["ssh", ...sshOptions, host, script], { input });
}
function vmShell(script: string, input?: Uint8Array): Uint8Array {
	return ssh(vmHost, `bash -lc ${quote(script)}`, input);
}
function lobby(args: string[]): string {
	return utf8.decode(command(["ssh", ...sshOptions, "exe.dev", ...args])).trim();
}
function ensureTask(value: string | undefined): string {
	if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) || value === "." || value === "..") fail("--task requires a safe single path component");
	return value;
}
function listed(): boolean {
	let response: unknown;
	try { response = JSON.parse(lobby(["ls", "--json"])); } catch { fail("invalid VM listing; inspect ssh exe.dev ls --json"); }
	if (!response || typeof response !== "object" || !("vms" in response) || !Array.isArray(response.vms) ||
		!response.vms.every((vm: unknown) => vm && typeof vm === "object" && "vm_name" in vm && typeof vm.vm_name === "string")) {
		fail("invalid VM listing; inspect ssh exe.dev ls --json");
	}
	return response.vms.some((vm: { vm_name: string }) => vm.vm_name === vmName);
}
const repo = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
// Linked worktrees share one project VM: name it after the repository, not the worktree directory.
const commonDir = resolve(repo, git(repo, ["rev-parse", "--git-common-dir"]));
const project = basename(basename(commonDir) === ".git" ? dirname(commonDir) : commonDir).replace(/\.git$/, "");
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(project)) fail(`unsafe project name: ${project}`);
const vmName = `${project}-ws`;
const vmHost = `${vmName}.exe.xyz`;
const base = `ws/${project}`;
const localBase = join(homedir(), ".cache/tmp/ws", project);
const args = process.argv.slice(2);
const action = args.shift() ?? "help";
const task = ["up", "sync", "run", "pull", "browser", "attach", "down"].includes(action) ? ensureTask(take(args, "--task")) : undefined;
if (!["run", "pull", "browser"].includes(action) && args.length) fail(`unexpected argument ${args[0]}`);
if (action === "browser" && args.some((arg) => arg !== "--stop")) fail(`unexpected argument ${args.find((arg) => arg !== "--stop")}`);
const taskDir = task ? `${base}/tasks/${task}` : "";
const evidenceDir = task ? `${base}/evidence/${task}` : "";
// Resolve the VM home at runtime rather than assuming a username or image.
function remoteTarget(): string {
	return `${vmHost}:${utf8.decode(vmShell("printf %s \"$HOME\""))}/${taskDir}`;
}
function leaseScript(): string {
	const candidates = [
		process.env.WS_SESSION_CLOSE_SCRIPT,
		process.env.PI_CODING_AGENT_DIR && join(process.env.PI_CODING_AGENT_DIR, "skills/session-close/session-close.ts"),
		join(homedir(), ".omp/agent/skills/session-close/session-close.ts"),
		join(homedir(), ".pi/agent/skills/session-close/session-close.ts"),
	];
	const path = candidates.find((candidate) => candidate && existsSync(candidate));
	if (!path) fail("session-close.ts is missing; install the shared session-close skill first");
	return path;
}
function lease(args: string[]): string {
	return utf8.decode(command(["bun", leaseScript(), ...args], { acceptCodes: args.includes("check") ? [2] : [] })).trim();
}
function owned(): void {
	const data = JSON.parse(lease(["--json", "check"])) as { leases: { kind: string; target: string; owner?: string }[]; own: { kind: string; target: string }[] };
	if (!data.own.some((item) => item.kind === "exe.dev-worktree" && item.target === remoteTarget())) fail(`${taskDir} is not leased to this session; inspect session-close review`);
}
function ensureVM(): void {
	if (!listed()) fail(`${vmName} does not exist; run ws init`);
}
function ready(): void {
	for (let attempt = 0; attempt < 12; attempt++) {
		try { vmShell("true"); return; } catch { Bun.sleepSync(1000); }
	}
	fail(`${vmHost} did not accept SSH after 12 attempts; inspect ssh ${vmHost}`);
}
function snapshot(): { commit: string; tree: string } {
	const scratchParent = join(homedir(), ".cache/tmp/ws");
	mkdirSync(scratchParent, { recursive: true, mode: 0o700 });
	const scratch = mkdtempSync(join(scratchParent, "snapshot-"));
	try {
		const env = { GIT_INDEX_FILE: join(scratch, "index"), GIT_AUTHOR_NAME: "ws snapshot", GIT_AUTHOR_EMAIL: "ws@localhost", GIT_COMMITTER_NAME: "ws snapshot", GIT_COMMITTER_EMAIL: "ws@localhost" };
		let parent = "";
		try { parent = git(repo, ["rev-parse", "HEAD"]); } catch { /* unborn branch */ }
		if (parent) git(repo, ["read-tree", "HEAD"], { env });
		git(repo, ["add", "-A"], { env });
		const tree = git(repo, ["write-tree"], { env });
		// Story-walk receipts bind HEAD, so a clean tree must retain the exact commit.
		if (parent && git(repo, ["rev-parse", "HEAD^{tree}"]) === tree) return { commit: parent, tree };
		const commit = git(repo, ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `ws snapshot ${task}`], { env });
		return { commit, tree };
	} finally { rmSync(scratch, { recursive: true, force: true }); }
}
function sync(): void {
	ensureVM();
	const { commit, tree } = snapshot();
	// SSH transport and remote Git protocol; neither local HEAD nor index is modified.
	git(repo, ["-c", `core.sshCommand=ssh ${sshOptions.join(" ")}`, "push", "--force", `${vmHost}:${base}/repo`, `${commit}:refs/ws/${task}`]);
	vmShell(`cd ${quote(base + "/repo")} && if [ -f \"$HOME/${taskDir}/.git\" ]; then git -C \"$HOME/${taskDir}\" checkout --detach -f refs/ws/${task} && git -C \"$HOME/${taskDir}\" clean -fd; else mkdir -p ${quote(base + "/tasks")} && git worktree add --detach ${quote(`../tasks/${task}`)} refs/ws/${task}; fi`);
	console.log(`snapshot=${commit} tree=${tree}`);
}
function pathsForPull(paths: string[]): string[] {
	for (const path of paths) if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) fail(`unsafe evidence path: ${path}`);
	return paths;
}
function evidenceFiles(): string[] {
	const output = vmShell(`mkdir -p ${quote(evidenceDir)}; cd ${quote(evidenceDir)} && find . -type f -print0`);
	return utf8.decode(output).split("\0").filter(Boolean).map((item) => item.slice(2)).sort();
}
function evidenceBytes(path: string): Uint8Array {
	return vmShell(`cat -- ${quote(evidenceDir + "/" + path)}`);
}
function manifestPath(): string { return join(localBase, task!, "manifest.json"); }
function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function pull(paths: string[]): void {
	const all = evidenceFiles();
	const selected = paths.length ? all.filter((path) => paths.some((requested) => path === requested || path.startsWith(`${requested}/`))) : all;
	if (paths.some((path) => !selected.some((file) => file === path || file.startsWith(`${path}/`)))) fail("requested evidence path does not exist");
	const manifest: Record<string, string> = existsSync(manifestPath()) ? JSON.parse(readFileSync(manifestPath(), "utf8")) : {};
	for (const path of selected) {
		const bytes = evidenceBytes(path);
		const destination = join(localBase, task!, path);
		mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
		writeFileSync(destination, bytes, { mode: 0o600 });
		manifest[path] = digest(bytes);
		console.log(`pulled ${path} sha256=${manifest[path]}`);
	}
	mkdirSync(dirname(manifestPath()), { recursive: true, mode: 0o700 });
	writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}
async function down(): Promise<void> {
	owned();
	const manifest: Record<string, string> = existsSync(manifestPath()) ? JSON.parse(readFileSync(manifestPath(), "utf8")) : {};
	for (const path of evidenceFiles()) {
		if (!manifest[path]) fail(`evidence ${path} not pulled; run ws pull --task ${task}`);
		if (digest(evidenceBytes(path)) !== manifest[path]) fail(`remote evidence ${path} changed; run ws pull --task ${task}`);
		const local = join(localBase, task!, path);
		if (!existsSync(local) || digest(readFileSync(local)) !== manifest[path]) fail(`local evidence ${path} missing or changed; run ws pull --task ${task}`);
	}
	await browser(true);
	vmShell(`cd ${quote(base + "/repo")} && git worktree remove --force ${quote(`../tasks/${task}`)} && rm -rf -- ${quote(evidenceDir)}`);
	console.log(lease(["drop", "--target", remoteTarget()]));
	console.log(`down ${task} (VM retained)`);
}
async function run(remoteCommand: string[], names: string[]): Promise<number> {
	if (!remoteCommand.length) fail("run requires -- cmd");
	for (const name of names) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || process.env[name] === undefined || (process.env[name] ?? "").includes("\0")) fail(`--env ${name} must name a present NUL-free environment value`);
	// Bash consumes just the NUL-terminated environment header; command stdin follows untouched.
	const prologue = `while IFS= read -r -d '' entry; do [ -z "$entry" ] && break; export "$entry"; done; cd ${quote(taskDir)}; export WS_EVIDENCE="$HOME/${evidenceDir}"; mkdir -p "$WS_EVIDENCE"; exec bash -lc ${quote(remoteCommand.map(quote).join(" "))}`;
	const child = Bun.spawn(["ssh", ...sshOptions, vmHost, `bash -lc ${quote(prologue)}`], { stdin: "pipe", stdout: "inherit", stderr: "inherit" });
	const writer = child.stdin;
	if (!writer || typeof writer === "number") fail("ssh stdin unavailable");
	for (const name of names) await writer.write(new TextEncoder().encode(`${name}=${process.env[name]}\0`));
	await writer.write(new Uint8Array([0]));
	const pump = (async () => {
		try {
			for await (const chunk of Bun.stdin.stream()) await writer.write(chunk);
			await writer.end();
		} catch { /* command may exit before stdin closes */ }
	})();
	const code = await child.exited;
	void pump;
	return code;
}
async function browser(stop: boolean): Promise<void> {
	owned();
	const pidFile = join(localBase, task!, "tunnel.pid");
	if (stop) {
		if (existsSync(pidFile)) {
			const pid = Number(readFileSync(pidFile, "utf8"));
			try {
				const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8");
				if (argv.includes(vmHost) && argv.includes("-L")) process.kill(pid);
			} catch { /* stale tunnel */ }
			rmSync(pidFile);
		}
		vmShell(`file=${quote(taskDir + "/.ws-chromium.pid")}; if [ -f "$file" ]; then pid=$(cat "$file"); if [ -r "/proc/$pid/cmdline" ] && tr '\\0' ' ' < "/proc/$pid/cmdline" | grep -q 'chromium.*remote-debugging-port=9222'; then kill "$pid"; fi; rm -f "$file"; fi`);
		console.log(`browser stopped ${task}`);
		return;
	}
	if (existsSync(pidFile)) {
		const pid = Number(readFileSync(pidFile, "utf8"));
		try {
			const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8");
			const forward = /-L\0(\d+):127\.0\.0\.1:9222\0/.exec(argv);
			if (argv.includes(vmHost) && forward) {
				console.log(`cdp_url=http://127.0.0.1:${forward[1]}`);
				return;
			}
		} catch { /* stale tunnel */ }
		rmSync(pidFile);
	}
	vmShell(`mkdir -p ${quote(taskDir)}; file=${quote(taskDir + "/.ws-chromium.pid")}; if [ ! -f "$file" ] || ! kill -0 "$(cat "$file")" 2>/dev/null || ! tr '\\0' ' ' < "/proc/$(cat "$file")/cmdline" 2>/dev/null | grep -q 'chromium.*remote-debugging-port=9222'; then chromium --headless=new --no-sandbox --remote-debugging-port=9222 --user-data-dir="$HOME/${taskDir}/.ws-chromium" > /dev/null 2>&1 < /dev/null & echo $! > "$file"; fi`);
	const server = createServer();
	const listening = Promise.withResolvers<void>();
	server.listen(0, "127.0.0.1", listening.resolve);
	await listening.promise;
	const port = (server.address() as { port: number }).port;
	const closed = Promise.withResolvers<void>();
	server.close(closed.resolve);
	await closed.promise;
	const tunnel = Bun.spawn(["ssh", ...sshOptions, "-N", "-L", `${port}:127.0.0.1:9222`, vmHost], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
	mkdirSync(dirname(pidFile), { recursive: true, mode: 0o700 });
	writeFileSync(pidFile, String(tunnel.pid), { mode: 0o600 });
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
			if (response.ok) { console.log(`cdp_url=http://127.0.0.1:${port}`); return; }
		} catch { /* Chromium or tunnel is starting */ }
		await Bun.sleep(500);
	}
	await browser(true);
	fail(`CDP tunnel on ${vmHost} did not become ready; inspect remote chromium`);
}

try {
	let code = 0;
	if (action === "help" || action === "--help") console.log("Usage: ws init | up --task T | sync --task T | run --task T [--env NAME]... -- cmd | pull --task T [paths] | browser --task T [--stop] | attach --task T | status | down --task T");
	else if (action === "init") {
		// ssh joins argv into one lobby command line; the lobby splits on spaces outside double quotes.
		if (!listed()) lobby(["new", `--name=${vmName}`, "--tag=ws", '--comment="Owned project workspace; operator standing approval 2026-09-25"', "--json"]);
		ready();
		vmShell(`mkdir -p ${quote(base)}; if [ ! -d ${quote(base + "/repo/.git")} ]; then git init ${quote(base + "/repo")}; fi`);
		// Bootstrap uses a pushed snapshot; no mutation of the canonical index or HEAD.
		const setup = join(repo, ".exe/setup.sh");
		if (existsSync(setup)) {
			const sha = digest(readFileSync(setup));
			const stamped = utf8.decode(vmShell(`cat ${quote(base + "/repo/.ws-setup-sha256")} 2>/dev/null || true`)).trim();
			if (stamped !== sha) {
				const { commit } = snapshot();
				git(repo, ["-c", `core.sshCommand=ssh ${sshOptions.join(" ")}`, "push", "--force", `${vmHost}:${base}/repo`, `${commit}:refs/ws/setup`]);
				vmShell(`set -euo pipefail; cd ${quote(base + "/repo")}; if [ -e ../setup/.git ]; then git -C ../setup checkout --detach -f refs/ws/setup; else git worktree add --detach ../setup refs/ws/setup; fi; (cd ../setup && bash .exe/setup.sh); git worktree remove --force ../setup; printf %s ${quote(sha)} > .ws-setup-sha256`);
			}
		}
		console.log(`ready ${vmHost}`);
	} else if (action === "up") {
		leaseScript(); ensureVM();
		const leaseTarget = remoteTarget();
		const data = JSON.parse(lease(["--json", "check"])) as { leases: { target: string; kind: string }[]; own: { target: string; kind: string }[] };
		if (data.leases.some((item) => item.target === leaseTarget && item.kind === "exe.dev-worktree") && !data.own.some((item) => item.target === leaseTarget && item.kind === "exe.dev-worktree")) fail(`${task} has a foreign or stale lease; review it before up`);
		console.log(lease(["add", "--kind", "exe.dev-worktree", "--target", leaseTarget]));
		sync();
	} else if (action === "sync") { owned(); sync(); }
	else if (action === "run") {
		owned();
		const names: string[] = [];
		while (args[0] === "--env") names.push(ensureTask(take(args, "--env")));
		if (args.shift() !== "--") fail("run requires -- cmd");
		code = await run(args, names);
		args.length = 0;
	} else if (action === "pull") { owned(); pull(pathsForPull(args)); args.length = 0; }
	else if (action === "browser") { const stop = args.includes("--stop"); if (stop) args.splice(args.indexOf("--stop"), 1); await browser(stop); }
	else if (action === "attach") {
		owned();
		const child = Bun.spawn(["ssh", ...sshOptions, "-t", vmHost, `bash -lc ${quote(`cd ${quote(taskDir)} && export WS_EVIDENCE="$HOME/${evidenceDir}" && exec bash -l`)}`], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
		code = await child.exited;
	} else if (action === "status") { console.log(listed() ? `${vmHost}: ready` : `${vmHost}: absent (run ws init)`); }
	else if (action === "down") await down();
	else fail(`unknown command ${action}; run ws --help`);
	if (args.length) fail(`unexpected argument ${args[0]}`);
	process.exit(code);
} catch (error) {
	console.error(`ws: ${error instanceof Error ? error.message.replaceAll(/\s+/g, " ") : error}`);
	process.exit(1);
}
