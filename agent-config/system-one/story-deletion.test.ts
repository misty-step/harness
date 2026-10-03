import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runStoryDeletionCheck } from "../bin/story-deletion-check.ts";
import { assessStoryDeletion } from "./story-deletion.ts";
import { SystemOneProviderError, type ChoiceAnswer, type ProviderEvaluation, type Question, type SystemOneProvider } from "./engine.ts";
import { DEFAULT_EXPECTED_RESOLVED_MODELS, DEFAULT_SEMANTIC_MODEL } from "./semantic-run.ts";

const scratch = mkdtempSync(join(tmpdir(), "story-deletion-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const statement = "When I own a document, I want to download its original contents, so I can keep a local copy.";
const criterion = "1. WHEN downloading a document, THE SYSTEM SHALL return its original contents\n   without modifying the document.";
const registry = `# Stories\n\n## Capability: Documents\n\n## US-001 Download a document\n\nStatement: ${statement}\n\nCriteria:\n${criterion}\n\nEvidence: src/download.ts\n`;
const implementation = "export function download(contents: string) { return contents; }\n";

function git(repo: string, ...args: string[]): string {
	return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
}

function files(repo: string, content: Record<string, string | Buffer>): void {
	for (const [path, value] of Object.entries(content)) {
		mkdirSync(dirname(join(repo, path)), { recursive: true });
		writeFileSync(join(repo, path), value);
	}
}

function commit(repo: string): string {
	git(repo, "add", "-A");
	git(repo, "commit", "-qm", "proposal");
	return git(repo, "rev-parse", "HEAD");
}

function repository(content: Record<string, string | Buffer> = { "USER_STORIES.md": registry, "src/download.ts": implementation }): { repo: string; base: string } {
	const repo = mkdtempSync(join(scratch, "case-"));
	git(repo, "init", "-q");
	git(repo, "config", "user.name", "Story Check Fixture");
	git(repo, "config", "user.email", "story-check@example.invalid");
	files(repo, content);
	return { repo, base: commit(repo) };
}

function transport(choice: "preserved" | "removes" | "uncertain" = "removes", confidence = 0.98, response?: (receipt: ProviderEvaluation) => ProviderEvaluation | Promise<ProviderEvaluation>) {
	const requests: Array<{ state: string; questions: Record<string, Question> }> = [];
	const top = (1 + 2 * confidence) / 3;
	const answer: ChoiceAnswer = { type: "choice", choice, confidence, probabilities: { preserved: choice === "preserved" ? top : (1 - top) / 2, removes: choice === "removes" ? top : (1 - top) / 2, uncertain: choice === "uncertain" ? top : (1 - top) / 2 } };
	const provider: SystemOneProvider = {
		name: "fixture", requestedModel: DEFAULT_SEMANTIC_MODEL,
		async evaluateWithMetadata(state, questions) {
			requests.push({ state, questions });
			const receipt: ProviderEvaluation = { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, answer])), requestedModel: DEFAULT_SEMANTIC_MODEL, resolvedModel: DEFAULT_EXPECTED_RESOLVED_MODELS[0], usage: { input_tokens: 500, output_tokens: 20, cost: 0.000021 } };
			return response ? await response(receipt) : receipt;
		},
		async evaluate() { throw new Error("A metadata-free evaluation must not be used."); },
	};
	return { provider, requests, answer };
}

async function cli(argv: string[], provider?: SystemOneProvider | null) {
	const lines: string[] = [];
	const errors: string[] = [];
	const stdout = spyOn(console, "log").mockImplementation((line) => { lines.push(String(line)); });
	const stderr = spyOn(console, "error").mockImplementation((line) => { errors.push(String(line)); });
	try { return { code: await runStoryDeletionCheck(argv, provider), lines, errors }; }
	finally { stdout.mockRestore(); stderr.mockRestore(); }
}

describe("exact-commit story deletion policy", () => {
	test("unchanged and add-only proposals never call the decision transport", async () => {
		const { repo, base } = repository();
		const stub = transport();
		expect((await assessStoryDeletion({ repo, base, head: base, provider: stub.provider })).status).toBe("skipped");
		files(repo, { "src/help.ts": "export const help = 'Download your document';\n" });
		const result = await assessStoryDeletion({ repo, base, head: commit(repo), provider: stub.provider });
		expect(result.status).toBe("skipped");
		expect(stub.requests).toHaveLength(0);
	});

	test("identical bytes moved away from an entrypoint still require a capability judgment", async () => {
		const { repo, base } = repository();
		renameSync(join(repo, "src/download.ts"), join(repo, "src/save.ts"));
		const stub = transport("removes");
		const result = await assessStoryDeletion({ repo, base, head: commit(repo), provider: stub.provider });
		expect(result.status).toBe("hold");
		expect(result.findings[0].evidence.paths).toEqual(["src/download.ts", "src/save.ts"]);
		expect(stub.requests).toHaveLength(1);
	});

	test("a confident removal holds while the base story stays intact and records exact evidence", async () => {
		const { repo, base } = repository();
		rmSync(join(repo, "src/download.ts"));
		const head = commit(repo);
		// The checker must not take the contract from candidate working files.
		files(repo, { "USER_STORIES.md": "# Working tree has no contract\n" });
		const stub = transport();
		const result = await assessStoryDeletion({ repo, base, head, provider: stub.provider });
		expect(result.status).toBe("hold");
		expect(result.base).toBe(base);
		expect(result.head).toBe(head);
		expect(result.stories).toEqual([{ id: "US-001", statement, criteria: [criterion] }]);
		expect(result.findings[0]).toMatchObject({ storyId: "US-001", statement, criteria: [criterion], confidence: 0.98, evidence: { paths: ["src/download.ts"] } });
		expect(result.findings[0].evidence.diff).toContain(`-${implementation.trim()}`);
		expect(result.judgments["US-001"]).toEqual(stub.answer);
		expect(result.usage).toEqual({ input_tokens: 500, output_tokens: 20, cost: 0.000021 });
		expect(stub.requests).toHaveLength(1);
	});

	test.each(["delete", "retire", "weaken"])("same-proposal %s of the story cannot hide its base capability", async (change) => {
		const { repo, base } = repository();
		rmSync(join(repo, "src/download.ts"));
		if (change === "delete") rmSync(join(repo, "USER_STORIES.md"));
		else if (change === "retire") files(repo, { "USER_STORIES.md": registry.replace("Criteria:", "Retired: This PR retires downloads.\n\nCriteria:") });
		else files(repo, { "USER_STORIES.md": registry.replace(criterion, "1. THE SYSTEM MAY omit downloads.") });
		const stub = transport();
		const result = await assessStoryDeletion({ repo, base, head: commit(repo), provider: stub.provider });
		expect(result.status).toBe("hold");
		expect(result.stories[0].criteria).toEqual([criterion]);
		expect(result.findings[0].criteria).toEqual([criterion]);
		expect(result.findings[0].evidence.paths).toContain("USER_STORIES.md");
		expect(stub.requests).toHaveLength(1);
	});

	test("the full replacement is sent and a preserved capability judgment passes", async () => {
		const { repo, base } = repository();
		rmSync(join(repo, "src/download.ts"));
		const replacement = "export const saveDownload = (contents: string): string => contents;\n";
		files(repo, { "src/save.ts": replacement });
		const stub = transport("preserved");
		const result = await assessStoryDeletion({ repo, base, head: commit(repo), provider: stub.provider });
		expect(result.status).toBe("pass");
		expect(result.findings).toHaveLength(0);
		expect(stub.requests).toHaveLength(1);
		const proposal = JSON.parse(stub.requests[0].state).proposal;
		expect(proposal.patch).toContain(`-${implementation.trim()}`);
		expect(proposal.patch).toContain(`+${replacement.trim()}`);
	});

	test("removal probability, not distribution concentration, controls escalation; uncertain evidence remains non-blocking", async () => {
		const { repo, base } = repository();
		rmSync(join(repo, "src/download.ts"));
		const head = commit(repo);
		const loss = transport("removes", 0.8, (receipt) => ({ ...receipt, answers: {
			"US-001": { type: "choice", choice: "removes", confidence: 0.8, probabilities: { removes: 0.87, preserved: 0.11, uncertain: 0.02 } },
		} }));
		expect((await assessStoryDeletion({ repo, base, head, provider: loss.provider })).status).toBe("hold");
		const unsure = transport("uncertain");
		expect((await assessStoryDeletion({ repo, base, head, provider: unsure.provider })).status).toBe("pass");
	});

	test.each([
		{ name: "missing answer", mutate: (receipt: ProviderEvaluation) => ({ ...receipt, answers: {} }) },
		{ name: "wrong primitive", mutate: (receipt: ProviderEvaluation) => ({ ...receipt, answers: { "US-001": { type: "noul" as const, probability: 0.99, confidence: 0.98 } } }) },
		{ name: "missing confidence", mutate: (receipt: ProviderEvaluation) => ({ ...receipt, answers: { "US-001": { ...(receipt.answers["US-001"] as ChoiceAnswer), confidence: undefined } } }) },
		{ name: "incomplete distribution", mutate: (receipt: ProviderEvaluation) => ({ ...receipt, answers: { "US-001": { ...(receipt.answers["US-001"] as ChoiceAnswer), probabilities: { removes: 0.99 } } } }) },
		{ name: "unexpected resolved model", mutate: (receipt: ProviderEvaluation) => ({ ...receipt, resolvedModel: "typesafe/jev-unapproved" }) },
		{ name: "missing resolved model", mutate: (receipt: ProviderEvaluation) => ({ ...receipt, resolvedModel: undefined }) },
		{ name: "service outage", mutate: (_receipt: ProviderEvaluation): ProviderEvaluation => { throw new SystemOneProviderError("quota", "sensitive-provider-error-not-for-output"); } },
	])("$name is explicitly unavailable, never hold or pass", async ({ mutate }) => {
		const { repo, base } = repository();
		rmSync(join(repo, "src/download.ts"));
		const stub = transport("removes", 0.98, mutate);
		const result = await assessStoryDeletion({ repo, base, head: commit(repo), provider: stub.provider });
		expect(result.status).toBe("unavailable");
		expect(result.reason.length).toBeGreaterThan(0);
		expect(result.findings).toHaveLength(0);
		expect(result.stories[0].criteria).toEqual([criterion]);
		expect(stub.requests).toHaveLength(1);
		expect(JSON.stringify(result)).not.toContain("sensitive-provider-error-not-for-output");
	});

	test("later commits and working files cannot change an exact-head decision", async () => {
		const { repo, base } = repository();
		rmSync(join(repo, "src/download.ts"));
		const deletionHead = commit(repo);
		files(repo, { "src/download.ts": implementation });
		const restorationHead = commit(repo);
		files(repo, { "USER_STORIES.md": "# Candidate contract replaced locally\n" });
		const stub = transport();
		const result = await assessStoryDeletion({ repo, base, head: deletionHead, provider: stub.provider });
		expect(result.status).toBe("hold");
		expect(result.head).toBe(deletionHead);
		expect(JSON.parse(stub.requests[0].state).proposal.head).toBe(deletionHead);
		expect((await assessStoryDeletion({ repo, base, head: restorationHead, provider: stub.provider })).status).toBe("skipped");
		expect(stub.requests).toHaveLength(1);
	});

	test("deleted binary content is unavailable even when attributes force a text diff", async () => {
		const { repo, base } = repository({ "USER_STORIES.md": registry, ".gitattributes": "*.bin diff\n", "download.bin": Buffer.from([0, 1, 2, 3]) });
		rmSync(join(repo, "download.bin"));
		const stub = transport();
		const result = await assessStoryDeletion({ repo, base, head: commit(repo), provider: stub.provider });
		expect(result.status).toBe("unavailable");
		expect(stub.requests).toHaveLength(0);
	});

	test("deleted submodule content is unavailable, not a harmless omitted patch", async () => {
		const fixture = repository();
		git(fixture.repo, "update-index", "--add", "--cacheinfo", `160000,${fixture.base},download-module`);
		git(fixture.repo, "commit", "-qm", "base submodule");
		const base = git(fixture.repo, "rev-parse", "HEAD");
		git(fixture.repo, "update-index", "--force-remove", "download-module");
		git(fixture.repo, "commit", "-qm", "remove submodule");
		const stub = transport();
		const result = await assessStoryDeletion({ repo: fixture.repo, base, head: "HEAD", provider: stub.provider });
		expect(result.status).toBe("unavailable");
		expect(stub.requests).toHaveLength(0);
	});

	test("a deleted textual executable is assessed rather than silently skipped", async () => {
		const fixture = repository({ "USER_STORIES.md": registry, "download.sh": "#!/bin/sh\ncat \"$1\"\n" });
		chmodSync(join(fixture.repo, "download.sh"), 0o755);
		const base = commit(fixture.repo);
		rmSync(join(fixture.repo, "download.sh"));
		const stub = transport();
		const result = await assessStoryDeletion({ repo: fixture.repo, base, head: commit(fixture.repo), provider: stub.provider });
		expect(result.status).toBe("hold");
		expect(result.findings[0].evidence.paths).toContain("download.sh");
		expect(stub.requests).toHaveLength(1);
	});

	test("base retirement excludes only already-retired stories, not unmapped live capabilities", async () => {
		const retired = "\n## US-002 Old upload\n\nStatement: An old upload capability.\nRetired: before this proposal\n\nCriteria:\n1. THE SYSTEM SHALL upload.\n";
		const { repo, base } = repository({ "USER_STORIES.md": registry + retired, "src/download.ts": implementation, "features/download.md": "# Download\nSource: unrelated/\nStories: US-002\n" });
		rmSync(join(repo, "src/download.ts"));
		const stub = transport();
		const result = await assessStoryDeletion({ repo, base, head: commit(repo), provider: stub.provider });
		expect(result.status).toBe("hold");
		expect(result.stories.map((story) => story.id)).toEqual(["US-001"]);
		expect(Object.keys(stub.requests[0].questions)).toEqual(["US-001"]);
	});

	test("missing stories and oversized evidence are unavailable without sending a partial request", async () => {
		for (const content of [{ "src/download.ts": implementation }, { "USER_STORIES.md": registry, "src/download.ts": "export const old = true;\n".repeat(10_000) }]) {
			const { repo, base } = repository(content);
			rmSync(join(repo, "src/download.ts"));
			const stub = transport();
			const result = await assessStoryDeletion({ repo, base, head: commit(repo), provider: stub.provider });
			expect(result.status).toBe("unavailable");
			expect(stub.requests).toHaveLength(0);
			if ("USER_STORIES.md" in content) expect(result.stories[0].criteria).toEqual([criterion]);
		}
	});

	test("suspected credentials never leave the process and redacted evidence cannot produce clearance", async () => {
		const secret = "fixture-not-a-real-secret-123456789";
		const { repo, base } = repository({ "USER_STORIES.md": registry, "src/download.ts": `export const apiToken = '${secret}';\n${implementation}` });
		rmSync(join(repo, "src/download.ts"));
		const stub = transport("preserved");
		const result = await assessStoryDeletion({ repo, base, head: commit(repo), provider: stub.provider });
		expect(result.status).toBe("unavailable");
		expect(stub.requests).toHaveLength(1);
		expect(stub.requests[0].state).not.toContain(secret);
	});

	test("missing OpenRouter credentials never use another key or attempt a request", async () => {
		const { repo, base } = repository();
		rmSync(join(repo, "src/download.ts"));
		const head = commit(repo);
		const previous = { router: process.env.OPENROUTER_API_KEY, native: process.env.TYPESAFE_API_KEY };
		const network = spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected request"); });
		try {
			delete process.env.OPENROUTER_API_KEY;
			process.env["TYPESAFE_API_KEY"] = "unused";
			const result = await assessStoryDeletion({ repo, base, head });
			expect(result.status).toBe("unavailable");
			expect(result.stories[0].criteria).toEqual([criterion]);
			expect(network).not.toHaveBeenCalled();
		} finally {
			if (previous.router === undefined) delete process.env["OPENROUTER_API_KEY"]; else process.env["OPENROUTER_API_KEY"] = previous.router;
			if (previous.native === undefined) delete process.env["TYPESAFE_API_KEY"]; else process.env["TYPESAFE_API_KEY"] = previous.native;
			network.mockRestore();
		}
	});

	test("repository diff programs and working-tree attributes cannot alter exact-object evidence", async () => {
		const { repo, base } = repository({ "USER_STORIES.md": registry, ".gitattributes": "*.ts diff=untrusted\n", "src/download.ts": implementation });
		git(repo, "config", "diff.external", "false");
		git(repo, "config", "diff.untrusted.textconv", "false");
		rmSync(join(repo, "src/download.ts"));
		const head = commit(repo);
		files(repo, { ".gitattributes": "* -diff\n" });
		const stub = transport();
		const result = await assessStoryDeletion({ repo, base, head, provider: stub.provider });
		expect(result.status).toBe("hold");
		expect(result.findings[0].evidence.diff).toContain(`-${implementation.trim()}`);
		expect(stub.requests).toHaveLength(1);
	});
});

describe("story-deletion-check consumer", () => {
	test("hold is the only assessment status with a nonzero CLI exit", async () => {
		const { repo, base } = repository();
		rmSync(join(repo, "src/download.ts"));
		const head = commit(repo);
		const args = ["--repo", repo, "--base", base, "--head", head, "--json"];
		for (const [provider, status, code] of [[transport().provider, "hold", 1], [transport("preserved").provider, "pass", 0], [null, "unavailable", 0]] as const) {
			const result = await cli(args, provider);
			expect(result.code).toBe(code);
			expect(JSON.parse(result.lines[0]).status).toBe(status);
		}
		const skipped = await cli(["--repo", repo, "--base", base, "--head", base, "--json"], null);
		expect(skipped.code).toBe(0);
		expect(JSON.parse(skipped.lines[0]).status).toBe("skipped");
	});

	test("invalid invocation, nonexistent Git revisions and authorization flags exit 2", async () => {
		const { repo, base } = repository();
		for (const args of [[], ["--repo", repo, "--base", base, "--head", "nonexistent-ref"], ["--repo", repo, "--base", base, "--head", base, "--approved-by-phaedrus"]]) {
			const result = await cli(args, null);
			expect(result.code).toBe(2);
			expect(result.lines).toHaveLength(0);
			expect(result.errors).toHaveLength(1);
		}
	});
});
