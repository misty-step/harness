import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "session-close.ts");
const roots: string[] = [];
function dir(): string {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true, mode: 0o700 });
	const root = mkdtempSync(join(scratch, "session-close-"));
	roots.push(root);
	return root;
}
function run(leaseDir: string, args: string[], owner = "test-owner", cwd = leaseDir, env: Record<string, string> = {}): { code: number; out: string; err: string } {
	const result = Bun.spawnSync(["bun", script, "--lease-dir", leaseDir, ...args], {
		cwd, env: { ...process.env, ...env, GIT_CEILING_DIRECTORIES: cwd, SESSION_CLOSE_OWNER: owner }, stdout: "pipe", stderr: "pipe",
	});
	return { code: result.exitCode ?? 1, out: result.stdout.toString(), err: result.stderr.toString() };
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("US-004 own leases block, foreign leases do not, and drop reports owner", () => {
	const leases = dir();
	expect(run(leases, ["check"]).out).toContain("no recorded leases");
	expect(run(leases, ["add", "--kind", "worktree", "--target", "/cache/tree"]).code).toBe(0);
	expect(run(leases, ["add", "--kind", "exe.dev", "--target", "qa.exe.xyz"]).code).toBe(0);
	const mine = run(leases, ["--json", "check"]);
	expect(mine.code).toBe(2);
	expect(JSON.parse(mine.out).own).toHaveLength(2);
	const other = run(leases, ["check"], "another-owner");
	expect(other.code).toBe(0);
	expect(other.out).toContain("foreign leases (info)");
	expect(run(leases, ["review"]).code).toBe(0);
	expect(run(leases, ["drop", "--target", "/cache/tree"], "another-owner").out).toContain("owner test-owner");
	expect(run(leases, ["drop", "--target", "qa.exe.xyz"]).code).toBe(0);
	expect(run(leases, ["check"]).code).toBe(0);
});

test("US-004 orphaned and expired leases require review, never block unrelated close", () => {
	const leases = dir();
	const pidStat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
	const start = Number(pidStat.slice(pidStat.lastIndexOf(")") + 2).trim().split(/\s+/)[19]);
	expect(run(leases, ["add", "--kind", "exe.dev-worktree", "--target", "vm.exe.xyz:/ws/task"], `pid:${process.pid}:${start + 999999}`).code).toBe(0);
	expect(run(leases, ["check"]).out).toContain("orphaned");
	const file = join(leases, readdirSync(leases)[0]);
	const lease = JSON.parse(readFileSync(file, "utf8"));
	expect(lease.created).toBeTruthy();
	expect(Date.parse(lease.expires) - Date.parse(lease.created)).toBe(48 * 3600000);
	lease.expires = "2000-01-01T00:00:00.000Z";
	writeFileSync(file, JSON.stringify(lease));
	expect(run(leases, ["review"]).out).toContain("expired");
	expect(run(leases, ["review"]).code).toBe(3);
	expect(run(leases, ["check"]).code).toBe(0);
});

test("US-004 nearest omp argv0 supplies a pid/starttime owner when no override is set", () => {
	const leases = dir();
	const pidFile = join(leases, "outer-pid");
	const command = `printf '%s' "$$" > "$LEASE_PID_FILE"; exec -a omp bun -e 'const result = Bun.spawnSync(["bun", process.env.LEASE_SCRIPT, "--lease-dir", process.env.LEASE_DIR, "add", "--kind", "worktree", "--target", "/task/tree"], {env: process.env, stdout:"pipe",stderr:"pipe"}); process.stderr.write(result.stderr); process.exit(result.exitCode)'`;
	const wrapped = Bun.spawnSync(["bash", "-c", command], {
		cwd: leases,
		env: { ...process.env, SESSION_CLOSE_OWNER: "", LEASE_PID_FILE: pidFile, LEASE_SCRIPT: script, LEASE_DIR: leases },
		stdout: "pipe", stderr: "pipe",
	});
	expect(wrapped.exitCode, wrapped.stderr.toString()).toBe(0);
	const file = readdirSync(leases).find((name) => name.endsWith(".json"))!;
	const saved = JSON.parse(readFileSync(join(leases, file), "utf8"));
	expect(saved.owner).toMatch(new RegExp(`^pid:${readFileSync(pidFile, "utf8")}:\\d+$`));
	expect(run(leases, ["review"]).code).toBe(3);
});

test("US-004 custom expiry is persisted and incomplete owned records fail closed", () => {
	const leases = dir();
	expect(run(leases, ["add", "--kind", "exe.dev", "--target", "vm.exe.xyz", "--expires-hours", "2"]).code).toBe(0);
	const file = join(leases, readdirSync(leases)[0]);
	const saved = JSON.parse(readFileSync(file, "utf8"));
	expect(Date.parse(saved.expires) - Date.parse(saved.created)).toBe(2 * 3600000);
	delete saved.expires;
	writeFileSync(file, JSON.stringify(saved));
	expect(run(leases, ["check"]).code).toBe(1);
});

test("US-004 legacy ownerless files need review while corrupt files fail closed", () => {
	const leases = dir();
	writeFileSync(join(leases, "legacy.json"), JSON.stringify({ kind: "worktree", target: "/old/tree" }));
	expect(run(leases, ["check"]).code).toBe(0);
	expect(run(leases, ["review"]).out).toContain("ownerless");
	expect(run(leases, ["review"]).code).toBe(3);
	writeFileSync(join(leases, "bad.json"), "{not json\n");
	expect(run(leases, ["check"]).code).toBe(1);
	expect(run(leases, ["review"]).code).toBe(1);
	expect(run(leases, ["drop", "--target", "/old/tree"]).code).toBe(1);
});

test("unknown lease kind and unknown drop target are rejected", () => {
	const leases = dir();
	expect(run(leases, ["add", "--kind", "container", "--target", "x"]).err).toContain("worktree, exe.dev or exe.dev-worktree");
	expect(run(leases, ["drop", "--target", "missing"]).code).toBe(2);
});

type Fixture = { root: string; leases: string; main: string; origin: string; outside: string; ghState: string; env: Record<string, string> };
type PR = { state: string; headRefOid: string; baseRefName: string; mergeCommit: { oid: string } | null };
type GhState = { prs?: Record<string, PR[]>; repo?: unknown; raw?: string; fail?: number };
const gitEnv = {
	GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
	GIT_AUTHOR_NAME: "Session closure fixture", GIT_AUTHOR_EMAIL: "session-close-fixture@example.invalid",
	GIT_COMMITTER_NAME: "Session closure fixture", GIT_COMMITTER_EMAIL: "session-close-fixture@example.invalid",
	GIT_AUTHOR_DATE: "2025-06-01T12:00:00Z", GIT_COMMITTER_DATE: "2025-06-01T12:00:00Z",
};

function gitAt(cwd: string, args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(`fixture git ${args.join(" ")}: ${result.stderr.toString()}`);
	return result.stdout.toString().trim();
}

function fixture(): Fixture {
	const root = dir();
	const leases = join(root, "leases");
	const origin = join(root, "origin.git");
	const seed = join(root, "seed");
	const main = join(root, "main");
	const outside = join(root, "outside");
	const bin = join(root, "bin");
	for (const path of [leases, outside, bin]) mkdirSync(path);
	gitAt(root, ["init", "--bare", "--initial-branch=main", origin]);
	gitAt(root, ["init", "--initial-branch=main", seed]);
	writeFileSync(join(seed, "base.txt"), "base\n");
	gitAt(seed, ["add", "base.txt"]);
	gitAt(seed, ["commit", "-m", "base"]);
	gitAt(seed, ["remote", "add", "origin", origin]);
	gitAt(seed, ["push", "origin", "main"]);
	gitAt(root, ["clone", origin, main]);
	const ghState = join(root, "gh-state.json");
	writeFileSync(ghState, JSON.stringify({ prs: {}, repo: { defaultBranchRef: { name: "main" } } }));
	writeFileSync(join(bin, "gh"), `#!/usr/bin/env bun
import { readFileSync } from "node:fs";
const state = JSON.parse(readFileSync(process.env.SESSION_CLOSE_TEST_GH_STATE, "utf8"));
const args = process.argv.slice(2);
if (state.fail) { console.error("GitHub authentication required"); process.exit(state.fail); }
if (state.raw !== undefined) { process.stdout.write(state.raw); process.exit(0); }
if (args[0] === "repo" && args[1] === "view") {
	console.log(JSON.stringify(state.repo ?? { defaultBranchRef: { name: "main" } }));
} else if (args[0] === "pr" && args[1] === "list" && args[args.indexOf("--state") + 1] === "all") {
	const head = args[args.indexOf("--head") + 1];
	console.log(JSON.stringify(state.prs?.[head] ?? []));
} else { console.error("unsupported gh protocol"); process.exit(1); }
`, { mode: 0o700 });
	return { root, leases, origin, main, outside, ghState, env: { ...gitEnv, PATH: `${bin}:${process.env.PATH}`, SESSION_CLOSE_TEST_GH_STATE: ghState } };
}

function cli(f: Fixture, args: string[], cwd = f.main, who = "test-owner"): { code: number; out: string; err: string } {
	return run(f.leases, args, who, cwd, f.env);
}

function ghState(f: Fixture, state: GhState): void {
	writeFileSync(f.ghState, JSON.stringify(state));
}

function feature(f: Fixture, branch = "feature"): { tree: string; head: string } {
	const tree = join(f.root, branch.replaceAll("/", "-"));
	gitAt(f.main, ["worktree", "add", "-b", branch, tree, "main"]);
	writeFileSync(join(tree, "feature.txt"), `${branch}\n`);
	gitAt(tree, ["add", "feature.txt"]);
	gitAt(tree, ["commit", "-m", `work on ${branch}`]);
	gitAt(tree, ["push", "origin", branch]);
	return { tree, head: gitAt(tree, ["rev-parse", "HEAD"]) };
}

function mergeFeature(f: Fixture, branch = "feature", squash = false): string {
	gitAt(f.main, ["merge", squash ? "--squash" : "--no-edit", branch]);
	if (squash) gitAt(f.main, ["commit", "-m", `squash ${branch}`]);
	gitAt(f.main, ["push", "origin", "main"]);
	return gitAt(f.main, ["rev-parse", "HEAD"]);
}

function removeFeature(f: Fixture, tree: string, branch = "feature"): void {
	gitAt(f.main, ["worktree", "remove", tree]);
	gitAt(f.main, ["branch", "-D", branch]);
	gitAt(f.main, ["push", "origin", "--delete", branch]);
}

test("clean default checkout is required and must match freshly fetched origin", () => {
	const f = fixture();
	writeFileSync(join(f.main, "untracked.txt"), "unfinished\n");
	const dirty = cli(f, ["--json", "check"]);
	expect(dirty.code, dirty.err).toBe(2);
	expect(JSON.parse(dirty.out).blockers).toContain(`dirty canonical checkout: ${f.main}`);
	rmSync(join(f.main, "untracked.txt"));
	expect(cli(f, ["check"]).code).toBe(0);
	writeFileSync(join(f.main, "base.txt"), "local-only default commit\n");
	gitAt(f.main, ["commit", "-am", "local default change"]);
	const ahead = cli(f, ["--json", "check"]);
	expect(ahead.code, ahead.err).toBe(2);
	expect(JSON.parse(ahead.out).blockers).toContain(`canonical checkout is not at fetched origin/main: ${f.main}`);
	gitAt(f.main, ["push", "origin", "main"]);
	expect(cli(f, ["check"]).code).toBe(0);
	expect(gitAt(f.main, ["branch", "--show-current"])).toBe("main");
	const publisher = join(f.root, "publisher");
	gitAt(f.root, ["clone", f.origin, publisher]);
	writeFileSync(join(publisher, "remote.txt"), "another engineer landed work\n");
	gitAt(publisher, ["add", "remote.txt"]);
	gitAt(publisher, ["commit", "-m", "remote default advances"]);
	gitAt(publisher, ["push", "origin", "main"]);
	const behind = cli(f, ["--json", "check"]);
	expect(behind.code, behind.err).toBe(2);
	expect(JSON.parse(behind.out).blockers).toContain(`canonical checkout is not at fetched origin/main: ${f.main}`);
	gitAt(f.main, ["pull", "--ff-only", "origin", "main"]);
	expect(cli(f, ["check"]).code).toBe(0);
});

test("local and live origin branches independently block even after merge and worktree removal", () => {
	const f = fixture();
	const work = feature(f, "topic/nested");
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	mergeFeature(f, "topic/nested");
	gitAt(f.main, ["worktree", "remove", work.tree]);
	let result = cli(f, ["--json", "check"]);
	expect(result.code, result.err).toBe(2);
	expect(JSON.parse(result.out).blockers).toContain("local feature branch remains: topic/nested");
	gitAt(f.main, ["branch", "-D", "topic/nested"]);
	gitAt(f.main, ["update-ref", "-d", "refs/remotes/origin/topic/nested"]);
	result = cli(f, ["--json", "check"]);
	expect(result.code, result.err).toBe(2);
	expect(JSON.parse(result.out).blockers).toContain("origin feature branch remains: topic/nested");
	expect(gitAt(f.main, ["ls-remote", "--heads", "origin", "refs/heads/topic/nested"])).toContain(work.head);
	gitAt(f.main, ["push", "origin", "--delete", "topic/nested"]);
	result = cli(f, ["--json", "check"], f.outside);
	expect(result.code, result.err).toBe(0);
	const landed = JSON.parse(result.out).ownLandings.find((item: { branch: string }) => item.branch === "topic/nested");
	expect(landed.status).toBe("landed");
	expect(landed.head).toBe(work.head);
	expect(landed.target).toBe(work.tree);
	expect(existsSync(work.tree)).toBe(false);
});

test("deleting unmerged worktree and branches cannot erase recorded work", () => {
	const f = fixture();
	const work = feature(f);
	const first = cli(f, ["--json", "check"], work.tree);
	expect(first.code, first.err).toBe(2);
	removeFeature(f, work.tree);
	const after = cli(f, ["--json", "check", "--repo", f.main], f.outside);
	expect(after.code, after.err).toBe(2);
	expect(JSON.parse(after.out).blockers).toContain(`recorded HEAD is not merged into fetched origin/main: ${work.head}`);
});

test("detached owned worktree and dirty evidence remain blockers after branches land and disappear", () => {
	const f = fixture();
	const work = feature(f);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	mergeFeature(f);
	gitAt(work.tree, ["checkout", "--detach"]);
	gitAt(f.main, ["branch", "-D", "feature"]);
	gitAt(f.main, ["push", "origin", "--delete", "feature"]);
	writeFileSync(join(work.tree, "evidence.txt"), "unpulled evidence\n");
	const dirty = cli(f, ["--json", "check"]);
	expect(dirty.code, dirty.err).toBe(2);
	expect(JSON.parse(dirty.out).blockers).toContain(`dirty owned checkout: ${work.tree}`);
	expect(JSON.parse(dirty.out).blockers).toContain(`owned worktree remains: ${work.tree}`);
	rmSync(join(work.tree, "evidence.txt"));
	const retained = cli(f, ["--json", "check"]);
	expect(retained.code, retained.err).toBe(2);
	expect(JSON.parse(retained.out).blockers).toContain(`owned worktree remains: ${work.tree}`);
	expect(existsSync(work.tree)).toBe(true);
	gitAt(f.main, ["worktree", "remove", work.tree]);
	expect(cli(f, ["check"]).code).toBe(0);
});

test("open PR blocks an otherwise completed direct merge", () => {
	const f = fixture();
	const work = feature(f);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	mergeFeature(f);
	removeFeature(f, work.tree);
	ghState(f, { prs: { feature: [{ state: "OPEN", headRefOid: work.head, baseRefName: "main", mergeCommit: null }] } });
	const open = cli(f, ["--json", "check"]);
	expect(open.code, open.err).toBe(2);
	expect(JSON.parse(open.out).blockers).toContain("open PR remains for branch: feature");
	ghState(f, { prs: { feature: [{ state: "CLOSED", headRefOid: work.head, baseRefName: "main", mergeCommit: null }] } });
	expect(cli(f, ["check"]).code).toBe(0);
});

test("squash proof requires the recorded branch lifetime, default base, and landed merge commit", () => {
	const f = fixture();
	const base = gitAt(f.main, ["rev-parse", "HEAD"]);
	const work = feature(f);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	const squash = mergeFeature(f, "feature", true);
	gitAt(work.tree, ["checkout", "--detach"]);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	removeFeature(f, work.tree);
	const valid: PR = { state: "MERGED", headRefOid: work.head, baseRefName: "main", mergeCommit: { oid: squash } };
	const wrongProofs: PR[] = [
		{ ...valid, headRefOid: base },
		{ ...valid, baseRefName: "release" },
		{ ...valid, mergeCommit: { oid: work.head } },
		{ ...valid, state: "CLOSED" },
	];
	for (const proof of wrongProofs) {
		ghState(f, { prs: { feature: [proof] } });
		const result = cli(f, ["--json", "check"]);
		expect(result.code, JSON.stringify(proof)).toBe(2);
		expect(JSON.parse(result.out).blockers).toContain(`recorded HEAD is not merged into fetched origin/main: ${work.head}`);
	}
	ghState(f, { prs: { feature: [valid] } });
	expect(cli(f, ["check"]).code).toBe(0);
});

test("latest local branch tip is persisted after original worktree loss and cannot reuse older PR proof", () => {
	const f = fixture();
	const work = feature(f);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	const squash = mergeFeature(f, "feature", true);
	writeFileSync(join(work.tree, "later.txt"), "new work after merge\n");
	gitAt(work.tree, ["add", "later.txt"]);
	gitAt(work.tree, ["commit", "-m", "later branch lifetime"]);
	const latest = gitAt(work.tree, ["rev-parse", "HEAD"]);
	gitAt(f.main, ["worktree", "remove", work.tree]);
	ghState(f, { prs: { feature: [{ state: "MERGED", headRefOid: work.head, baseRefName: "main", mergeCommit: { oid: squash } }] } });
	const refresh = cli(f, ["--json", "check"]);
	expect(refresh.code, refresh.err).toBe(2);
	expect(JSON.parse(refresh.out).ownLandings.find((item: { branch: string }) => item.branch === "feature").head).toBe(latest);
	gitAt(f.main, ["branch", "-D", "feature"]);
	gitAt(f.main, ["push", "origin", "--delete", "feature"]);
	const removed = cli(f, ["--json", "check"], f.outside);
	expect(removed.code, removed.err).toBe(2);
	expect(JSON.parse(removed.out).blockers).toContain(`recorded HEAD is not merged into fetched origin/main: ${latest}`);
});

test("switching a tracked checkout to another branch does not overwrite the first landing obligation", () => {
	const f = fixture();
	const work = feature(f, "first");
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	gitAt(work.tree, ["checkout", "-b", "second"]);
	writeFileSync(join(work.tree, "second.txt"), "second task\n");
	gitAt(work.tree, ["add", "second.txt"]);
	gitAt(work.tree, ["commit", "-m", "second task"]);
	gitAt(work.tree, ["push", "origin", "second"]);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	mergeFeature(f, "second");
	removeFeature(f, work.tree, "second");
	const firstRemains = cli(f, ["--json", "check"]);
	expect(firstRemains.code, firstRemains.err).toBe(2);
	expect(JSON.parse(firstRemains.out).blockers).toContain("local feature branch remains: first");
	expect(JSON.parse(firstRemains.out).blockers).toContain("origin feature branch remains: first");
	gitAt(f.main, ["branch", "-D", "first"]);
	gitAt(f.main, ["push", "origin", "--delete", "first"]);
	expect(cli(f, ["check"]).code).toBe(0);
});

test("lease introspection is read-only inside Git and does not need landing network facts", () => {
	const f = fixture();
	writeFileSync(join(f.main, "dirty.txt"), "unfinished\n");
	gitAt(f.main, ["remote", "set-url", "origin", join(f.root, "unavailable.git")]);
	ghState(f, { fail: 4 });
	expect(cli(f, ["add", "--kind", "exe.dev-worktree", "--target", "vm.exe.xyz:/ws/task"]).code).toBe(0);
	const result = cli(f, ["--json", "leases"]);
	expect(result.code, result.err).toBe(2);
	expect(JSON.parse(result.out).own[0].target).toBe("vm.exe.xyz:/ws/task");
	expect(existsSync(join(f.leases, "landings"))).toBe(false);
	expect(gitAt(f.main, ["status", "--porcelain"])).toContain("dirty.txt");
});

test("parking preserves resume note, dirty work and matching worktree lease while offline; VM leases still block", () => {
	const f = fixture();
	const work = feature(f);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	expect(cli(f, ["add", "--kind", "worktree", "--target", work.tree]).code).toBe(0);
	const note = "Resume feature: review dirty evidence, merge PR, then remove owned tree and branches.";
	expect(cli(f, ["park", "--repo", f.main, "--note", note]).code).toBe(0);
	writeFileSync(join(work.tree, "evidence.txt"), "retained evidence\n");
	writeFileSync(join(f.main, "canonical.txt"), "retained canonical work\n");
	gitAt(f.main, ["remote", "set-url", "origin", join(f.root, "unavailable.git")]);
	ghState(f, { fail: 4 });
	const parked = cli(f, ["--json", "check"], work.tree);
	expect(parked.code, parked.err).toBe(0);
	const data = JSON.parse(parked.out);
	expect(data.status).toBe("parked");
	expect(data.ownLandings[0].parked.note).toBe(note);
	expect(data.ownLandings[0].verification).toBe("unverified");
	expect(data.parkedLeases[0].note).toBe(note);
	expect(readFileSync(join(work.tree, "evidence.txt"), "utf8")).toBe("retained evidence\n");
	expect(cli(f, ["--json", "check"]).code).toBe(0);
	expect(cli(f, ["add", "--kind", "exe.dev", "--target", "vm.exe.xyz"]).code).toBe(0);
	expect(cli(f, ["check"]).code).toBe(2);
	expect(cli(f, ["drop", "--target", "vm.exe.xyz"]).code).toBe(0);
	expect(cli(f, ["unpark", "--repo", f.main]).code).toBe(0);
	expect(cli(f, ["check"]).code).toBe(1);
	gitAt(f.main, ["remote", "set-url", "origin", f.origin]);
	ghState(f, { prs: {} });
	const resumed = cli(f, ["--json", "check"]);
	expect(resumed.code, resumed.err).toBe(2);
	expect(JSON.parse(resumed.out).ownLandings.find((item: { branch: string }) => item.branch === "feature").parked).toBeUndefined();
	expect(JSON.parse(resumed.out).blockers).toContain(`dirty canonical checkout: ${f.main}`);
});

test("new feature work never inherits a parked canonical-default inspection", () => {
	const f = fixture();
	const work = feature(f);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	expect(cli(f, ["park", "--repo", f.main, "--note", "Resume original feature after dependency lands."]).code).toBe(0);
	expect(cli(f, ["--json", "check"]).code).toBe(0);
	gitAt(f.main, ["checkout", "-b", "new-feature"]);
	const active = cli(f, ["--json", "check"]);
	expect(active.code, active.err).toBe(2);
	const landings = JSON.parse(active.out).ownLandings;
	expect(landings.find((item: { branch: string }) => item.branch === "feature").status).toBe("parked");
	expect(landings.find((item: { branch: string }) => item.branch === "new-feature").status).toBe("blocked");
});

test("foreign landing records and unrelated foreign worktrees are informational and never mutated", () => {
	const f = fixture();
	const foreign = feature(f, "foreign");
	expect(cli(f, ["track"], foreign.tree, "foreign-owner").code).toBe(0);
	const files = readdirSync(join(f.leases, "landings"));
	const before = readFileSync(join(f.leases, "landings", files[0]), "utf8");
	writeFileSync(join(foreign.tree, "foreign-evidence.txt"), "do not touch\n");
	gitAt(f.main, ["remote", "set-url", "origin", join(f.root, "unavailable.git")]);
	ghState(f, { fail: 4 });
	const outside = cli(f, ["--json", "check"], f.outside);
	expect(outside.code, outside.err).toBe(0);
	expect(JSON.parse(outside.out).foreignLandings[0].owner).toBe("foreign-owner");
	gitAt(f.main, ["remote", "set-url", "origin", f.origin]);
	ghState(f, { prs: {} });
	const own = feature(f, "own");
	expect(cli(f, ["track"], own.tree).code).toBe(0);
	mergeFeature(f, "own");
	removeFeature(f, own.tree, "own");
	const landed = cli(f, ["--json", "check"]);
	expect(landed.code, landed.err).toBe(0);
	expect(readFileSync(join(f.leases, "landings", files[0]), "utf8")).toBe(before);
	expect(readFileSync(join(foreign.tree, "foreign-evidence.txt"), "utf8")).toBe("do not touch\n");
	expect(gitAt(f.main, ["show-ref", "--verify", "refs/heads/foreign"])).toContain(foreign.head);
});

test("own expired worktree lease review cannot bypass unlanded recorded Git work", () => {
	const f = fixture();
	const work = feature(f);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	expect(cli(f, ["add", "--kind", "worktree", "--target", work.tree]).code).toBe(0);
	const path = join(f.leases, readdirSync(f.leases).find((name) => name.endsWith(".json"))!);
	const expired = JSON.parse(readFileSync(path, "utf8"));
	expired.expires = "2000-01-01T00:00:00.000Z";
	writeFileSync(path, JSON.stringify(expired));
	const result = cli(f, ["--json", "check"]);
	expect(result.code, result.err).toBe(2);
	expect(JSON.parse(result.out).own).toHaveLength(0);
	expect(JSON.parse(result.out).needsReview[0].target).toBe(work.tree);
	expect(JSON.parse(result.out).blockers).toContain(`recorded HEAD is not merged into fetched origin/main: ${work.head}`);
});

test("corrupt landing storage fails closed even when parked, while leases command stays lease-only", () => {
	const f = fixture();
	const work = feature(f);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	expect(cli(f, ["park", "--repo", f.main, "--note", "Resume this feature after manual review."]).code).toBe(0);
	const path = join(f.leases, "landings", readdirSync(join(f.leases, "landings"))[0]);
	const corrupt = JSON.parse(readFileSync(path, "utf8"));
	corrupt.head = "not-a-commit";
	writeFileSync(path, JSON.stringify(corrupt));
	expect(cli(f, ["check"]).code).toBe(1);
	expect(cli(f, ["unpark", "--repo", f.main]).code).toBe(1);
	expect(cli(f, ["--json", "leases"]).code).toBe(0);
	expect(JSON.parse(readFileSync(path, "utf8")).head).toBe("not-a-commit");
});

test("invalid command arguments and missing owned targets cannot mutate records", () => {
	const f = fixture();
	expect(cli(f, ["add", "--kind", "worktree", "--target", "/never-created", "--unknown"]).code).toBe(1);
	expect(readdirSync(f.leases)).toEqual([]);
	expect(cli(f, ["track", "--unknown"]).code).toBe(1);
	expect(existsSync(join(f.leases, "landings"))).toBe(false);
	const work = feature(f);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	const path = join(f.leases, "landings", readdirSync(join(f.leases, "landings"))[0]);
	const before = readFileSync(path, "utf8");
	expect(cli(f, ["park", "--repo", f.main, "--note", "   "]).code).toBe(1);
	expect(cli(f, ["park", "--repo", f.main, "--note", "Resume safely", "--unknown"]).code).toBe(1);
	expect(cli(f, ["unpark", "--repo", f.main], f.main, "another-owner").code).toBe(2);
	expect(readFileSync(path, "utf8")).toBe(before);
	expect(cli(f, ["park", "--repo", f.main, "--note", "Resume safely"]).code).toBe(0);
	const parked = readFileSync(path, "utf8");
	expect(cli(f, ["unpark", "--repo", f.main, "--unknown"]).code).toBe(1);
	expect(readFileSync(path, "utf8")).toBe(parked);
	expect(cli(f, ["add", "--kind", "exe.dev", "--target", "vm.exe.xyz"]).code).toBe(0);
	expect(cli(f, ["drop", "--target", "vm.exe.xyz", "--unknown"]).code).toBe(1);
	expect(JSON.parse(cli(f, ["--json", "leases"]).out).own[0].target).toBe("vm.exe.xyz");
});

test("authoritative default comes from origin HEAD, with GitHub fallback only when it is unknown", () => {
	const f = fixture();
	gitAt(f.main, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/stale-local"]);
	expect(cli(f, ["check"]).code).toBe(0);
	gitAt(f.main, ["branch", "release"]);
	gitAt(f.main, ["push", "origin", "release"]);
	gitAt(f.origin, ["symbolic-ref", "HEAD", "refs/heads/release"]);
	const wrongDefault = cli(f, ["--json", "check"]);
	expect(wrongDefault.code, wrongDefault.err).toBe(2);
	expect(JSON.parse(wrongDefault.out).blockers).toContain(`canonical checkout is not on origin default release: ${f.main}`);
	gitAt(f.main, ["checkout", "release"]);
	expect(cli(f, ["check"]).code).toBe(0);
	gitAt(f.origin, ["symbolic-ref", "HEAD", "refs/heads/missing-default"]);
	ghState(f, { repo: { defaultBranchRef: { name: "release" } } });
	expect(cli(f, ["check"]).code).toBe(0);
	ghState(f, { repo: { defaultBranchRef: null } });
	expect(cli(f, ["check"]).code).toBe(1);
});

test("unparked GitHub authentication and malformed API facts fail closed", () => {
	const f = fixture();
	const work = feature(f);
	expect(cli(f, ["track"], work.tree).code).toBe(0);
	mergeFeature(f);
	removeFeature(f, work.tree);
	for (const state of [
		{ fail: 4 },
		{ raw: "" },
		{ raw: "not JSON" },
		{ raw: "{}" },
		{ raw: JSON.stringify([{ state: "MERGED", headRefOid: work.head, baseRefName: "main", mergeCommit: null }]) },
	]) {
		ghState(f, state);
		expect(cli(f, ["check"]).code, JSON.stringify(state)).toBe(1);
	}
	ghState(f, { prs: {} });
	expect(cli(f, ["check"]).code).toBe(0);
});
