#!/usr/bin/env bun
/** Trusted controller only. PR code and dependency installation run exclusively on the disposable VM. */
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createReadStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

type Pull = { state: "open" | "closed"; head: string; base: string; same_repo: boolean; private: boolean; repo: string };
type Status = {
	schema: 1; sha: string; url: string; state: "ready" | "failed"; data?: string;
	phase?: string; reason?: string;
	readiness?: { productionBuild: boolean; health: boolean };
	login?: unknown;
};
const sshOptions = ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes", "-o", "IdentitiesOnly=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];
// Even an operator's SendEnv wildcard must not transport GH/model credentials.
const sshEnv = { HOME: process.env.HOME, PATH: process.env.PATH, USER: process.env.USER, LOGNAME: process.env.LOGNAME, SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK };
const oid = /^[0-9a-f]{40}$/;
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
function take(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	if (index < 0) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
	args.splice(index, 2);
	return value;
}
function command(argv: string[], cwd?: string, env = process.env): string {
	const result = spawnSync(argv[0]!, argv.slice(1), { cwd, env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${argv[0]} exited ${result.status}: ${result.stderr.trim()}`);
	return result.stdout;
}
function exited(child: ChildProcess): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	child.once("error", reject);
	child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${child.spawnfile} exited ${code ?? signal}`)));
	return promise;
}
function remoteArgs(host: string, script: string): string[] {
	return [...sshOptions, host, `bash --noprofile --norc -c ${quote(`set -eu\n${script}`)}`];
}
function lobby(args: string[]): string { return command(["ssh", ...sshOptions, "exe.dev", args.map(quote).join(" ")], undefined, sshEnv); }
function shell(host: string, script: string): string { return command(["ssh", ...remoteArgs(host, script)], undefined, sshEnv); }
async function send(host: string, script: string, input: Readable): Promise<void> {
	const child = spawn("ssh", remoteArgs(host, script), { env: sshEnv, stdio: ["pipe", "ignore", "inherit"] });
	try { await Promise.all([pipeline(input, child.stdin!), exited(child)]); }
	finally { if (child.exitCode === null) child.kill(); }
}
function parseStatus(raw: string, sha: string, url: string): Status {
	const status = JSON.parse(raw) as Status;
	if (!status || status.schema !== 1 || status.sha !== sha || status.url !== url ||
		!["ready", "failed"].includes(status.state) ||
		(status.data !== undefined && typeof status.data !== "string") ||
		(status.phase !== undefined && (typeof status.phase !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(status.phase))) ||
		(status.reason !== undefined && (typeof status.reason !== "string" || !status.reason)) ||
		(status.readiness !== undefined && (!status.readiness || typeof status.readiness.productionBuild !== "boolean" || typeof status.readiness.health !== "boolean")) ||
		(status.state === "ready" && (typeof status.data !== "string" || !status.readiness?.productionBuild || !status.readiness.health))) {
		throw new Error("Deployment status is invalid or belongs to another revision/target");
	}
	return status;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const action = args.shift();
	if (action === "help" || action === "--help" || !action) {
		console.log("bun pr-preview.ts up|down --repo OWNER/REPO --pr NUMBER [up: --sha HEAD_SHA]\nController env: PR_PREVIEW_CHECKOUT, PR_PREVIEW_OUTPUT_DIR; authenticated gh and pinned SSH known_hosts required.");
		return;
	}
	const repo = (take(args, "--repo") ?? "").toLowerCase();
	const pr = take(args, "--pr") ?? "";
	const requested = take(args, "--sha");
	if (!["up", "down"].includes(action) || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repo) ||
		!/^[1-9][0-9]*$/.test(pr) || !Number.isSafeInteger(Number(pr)) || args.length ||
		(requested !== undefined && (action !== "up" || !oid.test(requested)))) {
		throw new Error("Usage: up|down --repo OWNER/REPO --pr NUMBER [up: --sha HEAD_SHA]");
	}
	const id = createHash("sha256").update(repo).update("\0").update(pr).digest("hex").slice(0, 32);
	const vm = `pr-${pr}-${id}`;
	const ownerTag = `pr-owner-${id}`;
	const host = `vm+${vm}@vm.exe.xyz`;
	const url = `https://${vm}.exe.xyz`;
	const output = process.env.PR_PREVIEW_OUTPUT_DIR ? resolve(process.env.PR_PREVIEW_OUTPUT_DIR) : mkdtempSync(join(tmpdir(), "pr-preview-evidence-"));
	mkdirSync(output, { recursive: true, mode: 0o700 });
	console.error(`preview_output=${output}`);
	const facts: Record<string, unknown> = { schema: "pr-preview/1", action, repo, pr: Number(pr), vm, url, visibility: "private" };
	let vmCreated = false;
	if (action === "up") facts.story_qa = "agent-session-owned";
	function report(outcome: string, reason?: string): void {
		facts.outcome = outcome;
		if (reason) facts.reason = reason;
		const json = `${JSON.stringify(facts, null, 2)}\n`;
		writeFileSync(join(output, "facts.json"), json, { mode: 0o600 });
		// Machine facts only; the agent authors the PR's rationale and interpretation.
		writeFileSync(join(output, "comment.md"), `\`\`\`json\n${json.replaceAll("`", "\\u0060")}\`\`\`\n`, { mode: 0o600 });
		console.log(json);
	}
	function current(): Pull {
		const pull = JSON.parse(command(["gh", "api", `repos/${repo}/pulls/${pr}`, "--jq",
			"{state:.state,head:.head.sha,base:.base.sha,same_repo:(.head.repo.full_name==.base.repo.full_name),private:.base.repo.private,repo:.base.repo.full_name}"])) as Pull;
		if (!["open", "closed"].includes(pull.state) || !oid.test(pull.head) || !oid.test(pull.base) ||
			typeof pull.same_repo !== "boolean" || typeof pull.private !== "boolean" || typeof pull.repo !== "string" || pull.repo.toLowerCase() !== repo) {
			throw new Error("GitHub returned an invalid PR identity");
		}
		return pull;
	}
	function present(): boolean {
		const listing = JSON.parse(lobby(["ls", "--json"])) as { vms: { vm_name: string; tags?: string[] }[] };
		if (!Array.isArray(listing.vms) || !listing.vms.every((item) => typeof item.vm_name === "string")) throw new Error("Invalid exe.dev VM listing");
		const match = listing.vms.find((item) => item.vm_name === vm);
		if (!match) return false;
		if (!Array.isArray(match.tags) || !match.tags.includes("pr-preview") || !match.tags.includes(ownerTag)) {
			throw new Error(`${vm} is not owned by this repo/PR; refusing to adopt or delete it`);
		}
		return true;
	}
	try {
		let pull = current();
		facts.repository_private = pull.private;
		if (action === "down") {
			if (pull.state !== "closed") { report("skipped", "PR is open/reopened; preview retained"); return; }
			const exists = present();
			if (current().state !== "closed") { report("skipped", "PR reopened before deletion; preview retained"); return; }
			if (exists) lobby(["rm", vm]);
			report(exists ? "deleted" : "absent");
			return;
		}
		facts.sha = requested ?? pull.head;
		if (pull.state !== "open" || (requested !== undefined && requested !== pull.head)) {
			report("skipped", "PR closed or event head superseded; no VM mutation"); return;
		}
		if (!pull.same_repo) {
			facts.preview = "skipped";
			report("unsupported", "Fork PR execution is outside the approved trusted repository-writer boundary; no VM was provisioned"); return;
		}
		const sha = pull.head;
		const base = pull.base;
		const checkout = resolve(process.env.PR_PREVIEW_CHECKOUT ?? process.cwd());
		const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? command(["gh", "auth", "token"]).trim();
		const gitArgs = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];
		const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` };
		const git = (args: string[]) => command([...gitArgs, ...args], checkout, gitEnv).trim();
		const refs = `refs/pr-preview/${id}-${randomUUID()}`;
		const scratch = mkdtempSync(join(tmpdir(), "pr-preview-"));
		try {
			// Fetch objects, never check out or execute the PR on the controller.
			git(["fetch", "--quiet", "--no-tags", `https://github.com/${repo}.git`,
				`+refs/pull/${pr}/head:${refs}/head`, `+${base}:${refs}/base`]);
			if (git(["rev-parse", `${refs}/head`]) !== sha || git(["rev-parse", `${refs}/base`]) !== base) throw new Error("PR head/base changed while fetching");
			if (!git(["ls-tree", sha, "--", ".exe/preview"]).startsWith("100755 blob ")) throw new Error("Exact PR head must contain executable .exe/preview");
			const tree = git(["rev-parse", `${sha}^{tree}`]);
			facts.tree = tree;
			facts.base_sha = base;
			const bundle = join(scratch, "source.bundle");
			git(["bundle", "create", bundle, `${refs}/head`, `${refs}/base`]);
			pull = current();
			if (pull.state !== "open" || pull.head !== sha || pull.base !== base || !pull.same_repo) {
				report("skipped", "PR changed before deployment; no VM mutation"); return;
			}
			if (present()) lobby(["rm", vm]);
			lobby(["new", "--json", "--name", vm, "--tag", "pr-preview", "--tag", ownerTag,
				"--comment", `${repo} PR ${pr}; disposable synthetic preview`, "--no-email"]);
			vmCreated = true;
			if (!present()) throw new Error("Created VM is missing its repo/PR ownership tags");
			// Fresh VM state, private shares; account-level auto-attached authority remains operator-owned.
			lobby(["share", "set-private", vm]);
			lobby(["share", "port", vm, "8000"]);
			await send(host, 'mkdir -p "$HOME/pr-preview/app"; cat > "$HOME/pr-preview/source.bundle"', createReadStream(bundle));
			const archive = spawn(gitArgs[0]!, [...gitArgs.slice(1), "archive", "--format=tar", sha], { cwd: checkout, env: gitEnv, stdio: ["ignore", "pipe", "inherit"] });
			try {
				await Promise.all([send(host, 'tar -xf - -C "$HOME/pr-preview/app"', archive.stdout!), exited(archive)]);
			} finally { if (archive.exitCode === null) archive.kill(); }
			shell(host, `root="$HOME/pr-preview"
git -C "$root/app" init --quiet --template=
git -C "$root/app" -c core.hooksPath=/dev/null fetch --quiet --no-tags "$root/source.bundle" ${quote(`${refs}/head:refs/preview/head`)} ${quote(`${refs}/base:refs/preview/base`)}
git -C "$root/app" -c core.hooksPath=/dev/null checkout --quiet --detach --force ${quote(sha)}
test "$(git -C "$root/app" rev-parse HEAD)" = ${quote(sha)}
test "$(git -C "$root/app" rev-parse HEAD^{tree})" = ${quote(tree)}
rm -- "$root/source.bundle"
sudo systemd-run --quiet --unit=pr-preview --collect --uid="$(id -un)" \
  --property=Type=exec --property=KillMode=control-group --property=TimeoutStopSec=30 \
  --working-directory="$root/app" /usr/bin/env -i HOME="$HOME" USER="$(id -un)" \
  PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
  PREVIEW_REPO=${quote(repo)} PREVIEW_PR=${quote(pr)} PREVIEW_SHA=${quote(sha)} PREVIEW_BASE_SHA=${quote(base)} \
  PREVIEW_STATUS_FILE="$root/status.json" \
  /bin/bash "$root/app/.exe/preview" ${quote(url)}`);
			let status: Status | undefined;
			let failure: string | undefined;
			try {
				const raw = shell(host, `deadline=$((SECONDS + 1800))
while [ ! -f "$HOME/pr-preview/status.json" ]; do
  sudo systemctl is-active --quiet pr-preview || { printf "Preview service stopped before terminal status" >&2; exit 1; }
  [ "$SECONDS" -lt "$deadline" ] || { printf "Preview readiness deadline exceeded" >&2; exit 1; }
  sleep 2
done
cat "$HOME/pr-preview/status.json"`);
				status = parseStatus(raw, sha, url);
				writeFileSync(join(output, "status.json"), `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
				facts.preview = status.state;
				if (status.data) facts.data = status.data;
				if (status.readiness) facts.readiness = status.readiness;
				if (status.login) facts.login = status.login;
				if (status.phase) facts.phase = status.phase;
				if (status.reason) facts.reason = status.reason;
				if (status.state === "ready") shell(host, "sudo systemctl is-active --quiet pr-preview");
			} catch (error) { failure = error instanceof Error ? error.message : String(error); }
			pull = current();
			if (pull.state !== "open" || pull.head !== sha || pull.base !== base || !pull.same_repo) {
				if (present()) lobby(["rm", vm]);
				report("skipped", "PR changed during deployment; obsolete preview removed"); return;
			}
			const failed = failure || status?.state !== "ready";
			report(failed ? "failed" : "ready", failure ?? status?.reason ?? (status?.state === "failed" ? `Preview adapter failed in ${status.phase ?? "setup"}` : undefined));
			if (failed) process.exitCode = 1;
		} finally {
			try { git(["update-ref", "-d", `${refs}/head`]); git(["update-ref", "-d", `${refs}/base`]); }
			finally { rmSync(scratch, { recursive: true, force: true }); }
		}
	} catch (error) {
		if (vmCreated) {
			try {
				const latest = current();
				if (latest.state !== "open" || latest.head !== facts.sha || latest.base !== facts.base_sha || !latest.same_repo) {
					if (present()) lobby(["rm", vm]);
					facts.preview = "removed";
				}
			} catch (cleanup) { facts.cleanup_error = cleanup instanceof Error ? cleanup.message : String(cleanup); }
		}
		report("failed", error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
await main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
