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
};

export type CheckResult = {
	ok: boolean;
	verdict: string;
	writes: Write[];
	stdout: string;
	stderr: string;
};

function git(repoRoot: string, ...args: string[]) {
	const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

export async function checkProtectedRelease(options: CheckOptions): Promise<CheckResult> {
	const writes: Write[] = [];
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
			const response = await fetch(`${options.upstream}${pathname}${search}`, { method: request.method, headers });
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
			return { ok: true, verdict: "nothing to publish; changelog agrees with tags and releases", writes, stdout, stderr };
		}
		if (exitCode !== 0 && wouldPublish) {
			return { ok: true, verdict: `candidate is fresh; master would publish ${writes[0].tag}`, writes, stdout, stderr };
		}
		return { ok: false, verdict: `publication check failed (exit ${exitCode})`, writes, stdout, stderr };
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
	});
	console.log(`Protected release check at ${git(repoRoot, "rev-parse", "HEAD")}: ${result.verdict}`);
	for (const write of result.writes) console.log(`Refused ${write.method} ${write.path}`);
	if (!result.ok) {
		process.stderr.write(result.stderr);
		console.error("Withdraw a stranded or stale unpublished CHANGELOG.md entry and let the release owner regenerate it.");
		process.exit(1);
	}
}
