#!/usr/bin/env bun
/**
 * review-check — advisory-only continuous diff review CLI (review-1).
 *
 * Reads a git change set, builds the bounded/redacted review contract, and
 * renders one compact line (plus machine JSON and JSONL logs). This tool is
 * advisory by construction: every path exits 0, and an unavailable provider is
 * always visible in the output.
 *
 * This file is intentionally not registered with any harness installer yet:
 * the pilot ships new files only, and installers reject non-builtin imports.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SystemOneProvider } from "../system-one/engine.ts";
import { resolveProvider } from "../system-one/engine.ts";
import type { ReviewOutcome } from "../system-one/review.ts";
import {
	REVIEW_SCHEMA,
	gatherGitChangeSet,
	redactText,
	renderLine,
	renderMachine,
	runReviewCheck,
} from "../system-one/review.ts";

const FOOTER = "advisory only — never gates commits, merges, or deploys. exit 0 always.";

type CliOptions = {
	repo: string;
	base?: string;
	head: string;
	staged: boolean;
	descFile?: string;
	live: boolean;
	mockFile?: string;
	rulesFile?: string;
	maxBytes?: number;
	json: boolean;
};

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = {
		repo: process.cwd(),
		head: "HEAD",
		staged: false,
		live: false,
		json: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--repo" && argv[i + 1]) options.repo = argv[++i];
		else if (arg === "--base" && argv[i + 1]) options.base = argv[++i];
		else if (arg === "--head" && argv[i + 1]) options.head = argv[++i];
		else if (arg === "--staged") options.staged = true;
		else if (arg === "--desc-file" && argv[i + 1]) options.descFile = argv[++i];
		else if (arg === "--live") options.live = true;
		else if (arg === "--mock" && argv[i + 1]) options.mockFile = argv[++i];
		else if (arg === "--rules" && argv[i + 1]) options.rulesFile = argv[++i];
		else if (arg === "--max-bytes" && argv[i + 1]) {
			const parsed = Number.parseInt(argv[++i], 10);
			if (Number.isFinite(parsed) && parsed > 0) options.maxBytes = parsed;
		} else if (arg === "--json") options.json = true;
	}
	return options;
}

function readDescription(options: CliOptions): string {
	if (!options.descFile) return "";
	// A missing or unreadable description degrades to "no PR text" rather than
	// withholding the deterministic checks; the diff review still runs.
	try {
		return readFileSync(options.descFile, "utf8");
	} catch {
		return "";
	}
}

function readRules(options: CliOptions): string | undefined {
	if (!options.rulesFile) return undefined;
	try {
		return readFileSync(options.rulesFile, "utf8");
	} catch {
		// Deterministic matches are optional context; an unreadable rules file
		// simply produces no matches rather than hiding the Jev review.
		return undefined;
	}
}

function mockProvider(file: string): SystemOneProvider {
	return {
		name: "heuristic",
		async evaluate() {
			const parsed = JSON.parse(readFileSync(file, "utf8")) as { answers?: unknown };
			const answers = parsed && typeof parsed === "object" ? parsed.answers : undefined;
			return answers && typeof answers === "object" ? (answers as Record<string, never>) : {};
		},
	};
}

function cacheDirOf(gitDir: string | undefined): string | undefined {
	return gitDir ? join(gitDir, "jev-review-cache") : undefined;
}

function appendLog(gitDir: string | undefined, outcome: ReviewOutcome): void {
	if (!gitDir) return;
	try {
		const dir = cacheDirOf(gitDir);
		if (!dir) return;
		mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, "log.jsonl"), `${redactText(JSON.stringify(outcome))}\n`);
	} catch {
		// Logging is best effort; the review result is already printed.
	}
}

function appendSecurityRequest(gitDir: string | undefined, outcome: ReviewOutcome): void {
	if (!gitDir) return;
	const request = outcome.security_request;
	if (!request || request.requested_action !== "security_review") return;
	try {
		const dir = cacheDirOf(gitDir);
		if (!dir) return;
		mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, "security-requests.jsonl"), `${redactText(JSON.stringify(request))}\n`);
	} catch {
		// The request line is also in the machine record; disk failure is non-fatal.
	}
}

function gitDirOf(repo: string): string | undefined {
	const result = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repo, encoding: "utf8" });
	if (result.status === 0) return result.stdout.trim();
	return undefined;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const repo = resolve(options.repo);

	if (!options.base) {
		console.log(
			redactText(
				`[jev-review ${REVIEW_SCHEMA} unresolved] jev unavailable (missing_base) — nothing assessed (advisory; never a gate)`,
			),
		);
		console.log(FOOTER);
		// Set the exit code instead of an immediate process.exit: a piped stdout
		// can be truncated by an early exit before its buffer drains.
		process.exitCode = 0;
		return;
	}

	const description = readDescription(options);
	const rulesText = readRules(options);
	const change = gatherGitChangeSet(repo, {
		base: options.base,
		head: options.head,
		staged: options.staged,
	});
	const cacheDir = cacheDirOf(change.gitDir);

	let provider: SystemOneProvider | null = null;
	let dryRun = false;
	if (options.mockFile) {
		provider = mockProvider(options.mockFile);
	} else if (options.live) {
		provider = resolveProvider("openrouter");
	} else {
		dryRun = true;
	}

	const outcome = change.ok
		? await runReviewCheck({
				repoDir: repo,
				repoLabel: change.repo,
				base: change.base.ref,
				head: change.head.ref,
				baseSha: change.base.sha,
				headSha: change.head.sha,
				staged: options.staged,
				stagedTree: change.stagedTree,
				description,
				provider,
				dryRun,
				rulesText,
				maxBytes: options.maxBytes,
				cacheDir,
				diffText: change.diffText,
				changedFiles: change.changedFiles,
			})
		: await runReviewCheck({
				repoDir: repo,
				base: options.base,
				head: options.head,
				staged: options.staged,
				description,
				provider,
				dryRun,
				rulesText,
				maxBytes: options.maxBytes,
			});

	console.log(redactText(renderLine(outcome)));
	if (options.json) console.log(redactText(renderMachine(outcome)));
	const gitDir = change.gitDir ?? gitDirOf(repo);
	appendLog(gitDir, outcome);
	appendSecurityRequest(gitDir, outcome);
	console.log(FOOTER);
	process.exitCode = 0;
}

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.log(
		redactText(
			`[jev-review ${REVIEW_SCHEMA} unresolved] jev unavailable (internal_error: ${message}) — nothing assessed (advisory; never a gate)`,
		),
	);
	console.log(FOOTER);
	process.exitCode = 0;
}