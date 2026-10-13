import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const landmark = process.env.LANDMARK_BIN;


afterEach(() => {
	for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

// Optional replay against the installed Landmark binary.
test.skipIf(!landmark)("US-015 a docs-only base advance invalidates a candidate before landing; regeneration recovers", () => {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true });
	const repo = mkdtempSync(join(scratch, "protected-release-"));
	roots.push(repo);
	const git = (...args: string[]) => {
		const result = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	};
	const commit = (message: string) => {
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", message);
	};
	const prepare = () => Bun.spawnSync([
		landmark!, "prepare-protected-release", "--repo-root", repo, "--repository", "owner/repo",
	], { stdout: "pipe", stderr: "pipe" });
	const changelog = join(repo, "CHANGELOG.md");
	const baseline = "# [0.1.0](https://github.com/owner/repo/releases/tag/v0.1.0) (2026-09-25)\n";
	git("init", "--quiet", "-b", "master");
	writeFileSync(changelog, baseline);
	commit("chore: baseline");
	git("tag", "v0.1.0");
	commit("fix: repair an observable defect");
	expect(prepare().exitCode).toBe(0);
	const candidate = readFileSync(changelog, "utf8");
	commit("chore(release): 0.1.1");
	expect(prepare().exitCode).toBe(0);

	// Equivalent candidate commit set to a release PR merging after a docs PR.
	commit("docs: clarify the operational census");
	const stale = prepare();
	expect(stale.exitCode).toBe(1);
	expect(readFileSync(changelog, "utf8")).toBe(candidate);

	// Withdraw only the unpublished candidate, then let its owner regenerate.
	writeFileSync(changelog, baseline);
	expect(prepare().exitCode).toBe(0);
	const refreshed = readFileSync(changelog, "utf8");
	expect(refreshed).not.toBe(candidate);
	expect(refreshed.replace(/source=[a-f0-9]+/, "source=DIGEST"))
		.toBe(candidate.replace(/source=[a-f0-9]+/, "source=DIGEST"));
	commit("chore(release): 0.1.1");
	expect(prepare().exitCode).toBe(0);
	git("tag", "v0.1.1");
	commit("fix: the next independently releasable change");
	const next = prepare();
	expect(next.exitCode).toBe(0);
	expect(JSON.parse(next.stdout.toString()).release_tag).toBe("v0.1.2");
});
