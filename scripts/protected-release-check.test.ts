import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkProtectedRelease } from "./protected-release-check";

const roots: string[] = [];
const servers: { stop(force?: boolean): void }[] = [];
const landmark = process.env.LANDMARK_BIN;

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
	for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true });
	const repo = mkdtempSync(join(scratch, "protected-release-check-"));
	roots.push(repo);
	const git = (...args: string[]) => {
		const result = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout.toString().trim();
	};
	const commit = (message: string) => {
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", message);
		return git("rev-parse", "HEAD");
	};
	const prepare = () => {
		const result = Bun.spawnSync([
			landmark!, "prepare-protected-release", "--repo-root", repo, "--repository", "owner/repo",
		], { stdout: "pipe", stderr: "pipe" });
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	};
	git("init", "--quiet", "-b", "master");
	writeFileSync(join(repo, "CHANGELOG.md"), "# [0.1.0](https://github.com/owner/repo/releases/tag/v0.1.0) (2026-09-25)\n");
	const baseline = commit("chore: baseline");
	git("tag", "v0.1.0");
	commit("fix: repair an observable defect");
	return { repo, git, commit, prepare, baseline };
}

// A read-only GitHub that knows which tags have published releases, or that is down.
function github(published: Record<string, string>, outage?: number) {
	const reads: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			reads.push(path);
			if (outage) return Response.json({ message: "unavailable" }, { status: outage });
			const ref = path.match(/^\/repos\/owner\/repo\/git\/ref\/tags\/(.+)$/);
			if (ref && published[ref[1]]) return Response.json({ object: { sha: published[ref[1]], type: "commit" } });
			const release = path.match(/^\/repos\/owner\/repo\/releases\/tags\/(.+)$/);
			if (release && published[release[1]]) {
				return Response.json({ id: 1, draft: false, target_commitish: "master", html_url: "https://example.invalid" });
			}
			return Response.json({ message: "Not Found" }, { status: 404 });
		},
	});
	servers.push(server);
	return { upstream: `http://127.0.0.1:${server.port}`, reads };
}

test("US-015 CI replays the same Landmark that publishes", () => {
	const workflows = join(import.meta.dir, "../.github/workflows");
	const ci = readFileSync(join(workflows, "ci.yml"), "utf8");
	const release = readFileSync(join(workflows, "landmark-release.yml"), "utf8");
	const pinned = [...release.matchAll(/uses: misty-step\/landmark@[0-9a-f]{40} # v(\S+)/g)].map((match) => match[1]);
	expect(pinned.length).toBeGreaterThan(0);
	expect(new Set(pinned)).toEqual(new Set([ci.match(/LANDMARK_VERSION: '(\S+)'/)?.[1]]));
});

test("US-015 master publication does not wait on the live PR check", () => {
	const workflows = join(import.meta.dir, "../.github/workflows");
	const ci = readFileSync(join(workflows, "ci.yml"), "utf8");
	const release = readFileSync(join(workflows, "landmark-release.yml"), "utf8");
	expect(release).toMatch(/verify:\n\s+uses: \.\/\.github\/workflows\/ci\.yml/);
	const step = ci.split("\n      - ").find((block) => block.includes("protected-release-check.ts"));
	expect(step).toContain("if: github.event_name == 'pull_request'");
	const replays = ci.split("\n      - ").filter((block) => /Install the pinned Landmark|scripts\/check all/.test(block));
	expect(replays.length).toBe(2);
	for (const block of replays) expect(block).not.toContain("if:");
});

const check = (repoRoot: string, upstream: string, base?: string) =>
	checkProtectedRelease({ landmark: landmark!, repoRoot, repository: "owner/repo", upstream, base });

// A protected release that master published, followed by an ordinary change.
function publishedRelease() {
	const repo = fixture();
	repo.prepare();
	const release = repo.commit("chore(release): 0.1.1");
	repo.git("tag", "v0.1.1");
	repo.commit("fix: the next independently releasable change");
	return { ...repo, release };
}

test.skipIf(!landmark)("US-015 a markerless baseline passes the PR check without any write", async () => {
	const { repo, baseline } = fixture();
	const api = github({ "v0.1.0": baseline });
	const result = await check(repo, api.upstream);
	expect(result.ok).toBe(true);
	expect(result.writes).toEqual([]);
});

test.skipIf(!landmark)("US-015 a published protected release reconciles against GitHub and passes without any write", async () => {
	const { repo, baseline, release } = publishedRelease();
	const api = github({ "v0.1.0": baseline, "v0.1.1": release });
	const result = await check(repo, api.upstream);
	expect(result.ok).toBe(true);
	expect(result.writes).toEqual([]);
	expect(api.reads).toContain("/repos/owner/repo/git/ref/tags/v0.1.1");
	expect(api.reads).toContain("/repos/owner/repo/releases/tags/v0.1.1");
});

for (const [name, upstream] of [
	["an HTTP 503", (published: Record<string, string>) => github(published, 503).upstream],
	["an HTTP 401", (published: Record<string, string>) => github(published, 401).upstream],
	["a refused connection", () => "http://127.0.0.1:9"],
] as const) {
	test.skipIf(!landmark)(`US-015 ${name} from GitHub advises a retry, not a withdrawal`, async () => {
		const { repo, baseline, release } = publishedRelease();
		const result = await check(repo, upstream({ "v0.1.0": baseline, "v0.1.1": release }));
		expect(result.ok).toBe(false);
		expect(result.cause).toBe("infrastructure");
		expect(result.upstreamFailures.length).toBeGreaterThan(0);
		expect(result.advice).toContain("re-run this check once GitHub recovers");
		expect(result.advice).not.toContain("Withdraw");
	});
}

test.skipIf(!landmark)("US-015 a PR based on a just-landed release advises a re-run after master publishes", async () => {
	const { repo, git, commit, prepare, baseline } = fixture();
	prepare();
	commit("chore(release): 0.1.1");
	git("switch", "--quiet", "-c", "feature");
	commit("fix: a change opened before the tag lands");
	const result = await check(repo, github({ "v0.1.0": baseline }).upstream, "master");
	expect(result.ok).toBe(false);
	expect(result.cause).toBe("awaiting-publication");
	expect(result.advice).toContain("re-run this check after master's Verify and Release publishes v0.1.1");
	expect(result.advice).not.toContain("Withdraw");
});

test.skipIf(!landmark)("US-015 a PR carrying its own stale candidate advises withdrawing it", async () => {
	const { repo, git, commit, prepare, baseline } = fixture();
	git("switch", "--quiet", "-c", "feature");
	prepare();
	commit("chore(release): 0.1.1");
	commit("fix: land after the candidate was generated");
	const result = await check(repo, github({ "v0.1.0": baseline }).upstream, "master");
	expect(result.ok).toBe(false);
	expect(result.cause).toBe("stale-candidate");
	expect(result.advice).toContain("This change carries an unpublished v0.1.1 entry");
});

test.skipIf(!landmark)("US-015 a fresh release candidate passes because master would publish it; the write is refused", async () => {
	const { repo, commit, prepare, baseline } = fixture();
	prepare();
	commit("chore(release): 0.1.1");
	const api = github({ "v0.1.0": baseline });
	const result = await check(repo, api.upstream);
	expect(result.ok).toBe(true);
	expect(result.verdict).toContain("v0.1.1");
	expect(result.writes).toEqual([{ method: "POST", path: "/repos/owner/repo/releases", tag: "v0.1.1" }]);
});

test.skipIf(!landmark)("US-015 a landed candidate stranded by a later change turns the PR red", async () => {
	const { repo, commit, prepare, baseline } = fixture();
	prepare();
	commit("chore(release): 0.1.1");
	commit("fix: land after the untagged release");
	const api = github({ "v0.1.0": baseline });
	const result = await check(repo, api.upstream);
	expect(result.ok).toBe(false);
	expect(result.writes).toEqual([]);
	expect(result.stderr).toContain("protected release changelog differs from classified candidate commits");
	expect(result.cause).toBe("stale-candidate");
	expect(result.advice).toContain("Withdraw that unpublished CHANGELOG.md entry");
});

test.skipIf(!landmark)("US-015 a tagged release missing its GitHub Release turns the PR red", async () => {
	const { repo, git, commit, prepare, baseline } = fixture();
	prepare();
	commit("chore(release): 0.1.1");
	git("tag", "v0.1.1");
	commit("fix: the next independently releasable change");
	const api = github({ "v0.1.0": baseline });
	const result = await check(repo, api.upstream);
	expect(result.ok).toBe(false);
	expect(result.writes).toEqual([]);
	expect(api.reads).toContain("/repos/owner/repo/releases/tags/v0.1.1");
	expect(result.stderr).toContain("previous protected release is not published at its tagged commit");
	expect(result.cause).toBe("release-state");
	expect(result.advice).toContain("v0.1.1 is already tagged");
	expect(result.advice).not.toContain("Withdraw");
});
