import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const roots: string[] = [];
const landmark = process.env.LANDMARK_BIN;

function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a workflow mapping");
	return value as Record<string, unknown>;
}

function steps(job: Record<string, unknown>): Record<string, unknown>[] {
	if (!Array.isArray(job.steps)) throw new Error("Expected workflow steps");
	return job.steps.map(object);
}

// This is a required-check configuration contract, not an assertion about
// private source: a skipped/different validator lets the release race land.
test("US-015 required verify validates the merge candidate with the publisher's Landmark", () => {
	if (process.env.CI === "true") {
		expect(landmark, "CI must supply LANDMARK_BIN; the real release replay must not silently skip").toBeTruthy();
	}
	const ci = object(Bun.YAML.parse(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8")));
	const release = object(Bun.YAML.parse(readFileSync(join(root, ".github/workflows/landmark-release.yml"), "utf8")));
	const job = object(object(ci.jobs).verify);
	expect(ci.permissions).toEqual({ contents: "read" });
	expect(job.permissions).toBeUndefined();
	expect(job.if).toBeUndefined();
	expect(job["continue-on-error"]).toBeUndefined();
	const checkout = steps(job).find(step => typeof step.uses === "string" && step.uses.startsWith("actions/checkout@"));
	expect(object(checkout?.with)["fetch-depth"]).toBe(0);
	expect(object(checkout?.with)["persist-credentials"]).toBe(false);
	expect(object(checkout?.with).ref).toBeUndefined(); // PR default is the prospective merge, not just its head.
	const validator = steps(job).find(step => step.with && object(step.with).mode === "prepare-protected");
	expect(validator, "Required verify must reject stale protected release candidates before merge").toBeDefined();
	if (!validator) throw new Error("Missing release validator");
	expect(steps(job).indexOf(validator)).toBeGreaterThan(steps(job).indexOf(checkout!));
	expect(validator.if).toBeUndefined();
	expect(validator["continue-on-error"]).toBeUndefined();
	expect(object(validator.with).synthesis).toBe("false");
	for (const name of ["publish-landed-release", "prepare-release-pr"]) {
		const owner = steps(object(object(release.jobs)[name])).find(step => typeof step.uses === "string" && step.uses.startsWith("misty-step/landmark@"));
		expect(validator.uses).toBe(owner?.uses);
	}
});

afterEach(() => {
	for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

// CI receives the checksum-verified binary from the native Landmark action.
// Local offline checks retain the configuration contract; opt into this real
// binary replay with LANDMARK_BIN, using the same version as the action pin.
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
