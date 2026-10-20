#!/usr/bin/env bun
// Runs master's protected publication check on the checked-out commit, so a stale
// or stranded CHANGELOG.md entry turns the pull request red instead of master.
// Landmark sees a local GitHub API: reads go to GitHub, writes are refused.

type Write = { method: string; path: string; tag?: string };

export type CheckOptions = {
	landmark: string;
	repoRoot: string;
	repository: string;
	upstream: string;
	token?: string;
	// The branch the checked-out commit merges into; defaults to HEAD itself.
	base?: string;
};

export type Cause = "infrastructure" | "awaiting-publication" | "stale-candidate" | "release-state";

export type CheckResult = {
	ok: boolean;
	verdict: string;
	cause?: Cause;
	advice?: string;
	writes: Write[];
	upstreamFailures: string[];
	stdout: string;
	stderr: string;
};

function git(repoRoot: string, ...args: string[]) {
	const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

function topVersion(repoRoot: string, rev: string) {
	const changelog = Bun.spawnSync(["git", "show", `${rev}:CHANGELOG.md`], { cwd: repoRoot, stdout: "pipe" });
	return changelog.stdout.toString().match(/^#+ \[([^\]]+)\]/m)?.[1];
}

// Statuses that say GitHub, the network or the token failed, not the changelog.
const infrastructureStatus = (status: number) => status === 401 || status === 403 || status === 429 || status >= 500;

// Only a confirmed stale, unpublished candidate may be withdrawn. An entry master just
// landed is still waiting for its tag, and any other disagreement is GitHub's state.
function diagnose(repoRoot: string, base: string): { cause: Cause; advice: string } {
	const version = topVersion(repoRoot, "HEAD");
	const tagged = version && git(repoRoot, "tag", "--list", `v${version}`) !== "";
	if (!version) {
		return { cause: "release-state", advice: "CHANGELOG.md names no release. Repair the state Landmark names above." };
	}
	if (tagged) {
		return {
			cause: "release-state",
			advice: `v${version} is already tagged, so its entry is not a candidate. If this change edited that entry, restore it from v${version}; otherwise repair the tag or GitHub Release Landmark names above. Do not withdraw the entry.`,
		};
	}
	const baseTip = git(repoRoot, "rev-parse", base);
	if (topVersion(repoRoot, baseTip) === version) {
		const landed = git(repoRoot, "log", "-1", "--format=%H", baseTip, "--", "CHANGELOG.md");
		if (landed === baseTip) {
			return {
				cause: "awaiting-publication",
				advice: `${base} just landed v${version} and has not tagged it yet. Do not change CHANGELOG.md: re-run this check after ${base}'s Verify and Release publishes v${version}, re-running that workflow first if it failed.`,
			};
		}
		return {
			cause: "stale-candidate",
			advice: `v${version} landed on ${base} at ${landed.slice(0, 12)} but was never published, and later commits stranded it. Withdraw that unpublished CHANGELOG.md entry on ${base} and let the release owner regenerate it.`,
		};
	}
	return {
		cause: "stale-candidate",
		advice: `This change carries an unpublished v${version} entry that no longer matches its commits. Withdraw it and let the release owner regenerate it.`,
	};
}

export async function checkProtectedRelease(options: CheckOptions): Promise<CheckResult> {
	const writes: Write[] = [];
	const upstreamFailures: string[] = [];
	const scope = `/repos/${options.repository}/`;
	const api = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const { pathname, search } = new URL(request.url);
			if (request.method !== "GET" && request.method !== "HEAD") {
				const body = await request.json().catch(() => ({}));
				writes.push({ method: request.method, path: pathname, tag: body?.tag_name });
				return Response.json({ message: "protected-release-check: writes refused" }, { status: 405 });
			}
			if (!pathname.startsWith(scope)) return Response.json({ message: "Not Found" }, { status: 404 });
			const headers: Record<string, string> = {
				Accept: "application/vnd.github+json",
				"User-Agent": "harness-protected-release-check",
			};
			if (options.token) headers.Authorization = `Bearer ${options.token}`;
			let response: Response;
			try {
				response = await fetch(`${options.upstream}${pathname}${search}`, { method: request.method, headers });
			} catch (error) {
				upstreamFailures.push(`${request.method} ${pathname}: ${error instanceof Error ? error.message : error}`);
				return Response.json({ message: "protected-release-check: GitHub unreachable" }, { status: 502 });
			}
			if (infrastructureStatus(response.status)) upstreamFailures.push(`${request.method} ${pathname}: HTTP ${response.status}`);
			return new Response(await response.arrayBuffer(), {
				status: response.status,
				headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
			});
		},
	});
	try {
		const child = Bun.spawn([
			options.landmark, "publish-protected-release",
			"--repo-root", options.repoRoot,
			"--repository", options.repository,
			"--github-token", "protected-release-check-placeholder",
			"--target-sha", git(options.repoRoot, "rev-parse", "HEAD"),
			"--api-base-url", `http://127.0.0.1:${api.port}`,
		], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/" } });
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
		]);
		const release = `POST ${scope}releases`;
		// Landmark only creates a release after the candidate check passes.
		const wouldPublish = writes.length === 1 && `${writes[0].method} ${writes[0].path}` === release;
		if (exitCode === 0 && writes.length === 0) {
			return { ok: true, verdict: "nothing to publish; changelog agrees with tags and releases", writes, upstreamFailures, stdout, stderr };
		}
		if (exitCode !== 0 && wouldPublish && upstreamFailures.length === 0) {
			return { ok: true, verdict: `candidate is fresh; master would publish ${writes[0].tag}`, writes, upstreamFailures, stdout, stderr };
		}
		const verdict = `publication check failed (exit ${exitCode})`;
		if (upstreamFailures.length > 0) {
			const advice = "GitHub's API, the token or the network failed, so the changelog was not judged. Do not change CHANGELOG.md: re-run this check once GitHub recovers.";
			return { ok: false, verdict, cause: "infrastructure", advice, writes, upstreamFailures, stdout, stderr };
		}
		return { ok: false, verdict, ...diagnose(options.repoRoot, options.base ?? "HEAD"), writes, upstreamFailures, stdout, stderr };
	} finally {
		api.stop(true);
	}
}

if (import.meta.main) {
	const landmark = process.env.LANDMARK_BIN;
	if (!landmark) {
		console.error("LANDMARK_BIN must name the pinned Landmark binary");
		process.exit(2);
	}
	const repoRoot = git(process.cwd(), "rev-parse", "--show-toplevel");
	const result = await checkProtectedRelease({
		landmark,
		repoRoot,
		repository: process.env.GITHUB_REPOSITORY ?? "misty-step/harness",
		upstream: process.env.GITHUB_API_URL ?? "https://api.github.com",
		token: process.env.GITHUB_TOKEN || undefined,
		base: process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined,
	});
	console.log(`Protected release check at ${git(repoRoot, "rev-parse", "HEAD")}: ${result.verdict}`);
	for (const write of result.writes) console.log(`Refused ${write.method} ${write.path}`);
	for (const failure of result.upstreamFailures) console.log(`Upstream failure: ${failure}`);
	if (!result.ok) {
		process.stderr.write(result.stderr);
		console.error(`Cause: ${result.cause}. ${result.advice}`);
		process.exit(1);
	}
}
