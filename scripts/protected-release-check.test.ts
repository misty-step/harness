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

// A read-only GitHub that knows which tags have published releases.
function github(published: Record<string, string>) {
	const reads: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			reads.push(path);
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

const check = (repoRoot: string, upstream: string) =>
	checkProtectedRelease({ landmark: landmark!, repoRoot, repository: "owner/repo", upstream });

test.skipIf(!landmark)("US-015 a published release passes the PR check without any write", async () => {
	const { repo, baseline } = fixture();
	const api = github({ "v0.1.0": baseline });
	const result = await check(repo, api.upstream);
	expect(result.ok).toBe(true);
	expect(result.writes).toEqual([]);
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
});
