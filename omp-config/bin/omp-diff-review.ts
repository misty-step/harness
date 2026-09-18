#!/usr/bin/env bun
/**
 * omp-diff-review — Continuous System One semantic code review & security gate.
 *
 * Evaluates code diffs against our standing harness guidance, security rules,
 * pokayoke invariants, and verification contracts in a single parallel pass.
 */

import {
	evaluateDiff,
	getGitDiff,
	resolveProvider,
	HARNESS_BATTERY,
	TypeSafeJevProvider,
	OpenRouterReflexProvider,
	HeuristicEngine,
	parseDiffStats,
} from "../extensions/diff-review/engine.ts";

import type {
	SystemOneProvider,
	ReviewVerdict,
	Question,
	NoulQuestion,
	ChoiceQuestion,
	ScoreQuestion,
	RuleFinding,
} from "../extensions/diff-review/engine.ts";

export {
	evaluateDiff,
	getGitDiff,
	resolveProvider,
	HARNESS_BATTERY,
	TypeSafeJevProvider,
	OpenRouterReflexProvider,
	HeuristicEngine,
	parseDiffStats,
};

export type {
	SystemOneProvider,
	ReviewVerdict,
	Question,
	NoulQuestion,
	ChoiceQuestion,
	ScoreQuestion,
	RuleFinding,
};

if (import.meta.main) {
	const args = process.argv.slice(2);
	let staged = false;
	let commit: string | undefined;
	let range: string | undefined;
	let path: string | undefined;
	let strict = false;
	let json = false;
	let providerOverride: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--staged") staged = true;
		else if (arg === "--strict") strict = true;
		else if (arg === "--json") json = true;
		else if (arg === "--commit" && args[i + 1]) commit = args[++i];
		else if (arg === "--range" && args[i + 1]) range = args[++i];
		else if (arg === "--path" && args[i + 1]) path = args[++i];
		else if (arg === "--provider" && args[i + 1]) providerOverride = args[++i];
		else if (arg === "-h" || arg === "--help") {
			console.log(`Usage: omp-diff-review [options]

Options:
  --staged               Review staged git changes
  --commit <hash>        Review a specific commit
  --range <A..B>         Review a commit range
  --path <file>          Limit review to a specific path
  --strict               Exit 1 if any blocks or warnings exist
  --provider <p>         Force provider: typesafe | openrouter | heuristic
  --json                 Output machine-readable JSON
  -h, --help             Show help
`);
			process.exit(0);
		}
	}

	const diffText = getGitDiff({ staged, commit, range, path });
	const provider = resolveProvider(providerOverride);
	const verdict = await evaluateDiff(diffText, { provider });

	if (json) {
		console.log(JSON.stringify(verdict, null, 2));
	} else {
		console.log(`\n=== OMP Semantic Diff Review (${verdict.provider}, ${verdict.latencyMs}ms) ===`);
		console.log(
			`Touched: +${verdict.stats.linesAdded} / -${verdict.stats.linesRemoved} in ${verdict.stats.filesChanged} file(s)\n`,
		);

		if (!verdict.enabled) {
			console.log(`\x1b[33m⚠ ${verdict.summary}\x1b[0m\n`);
			console.log(
				`To enable live System One evaluations, export TYPESAFE_API_KEY or OPENROUTER_API_KEY, or pass --provider heuristic for offline evaluation.\n`,
			);
			process.exit(0);
		}

		if (verdict.blocks.length > 0) {
			console.log(`\x1b[31m[!] BLOCKED VIOLATIONS (${verdict.blocks.length}):\x1b[0m`);
			for (const b of verdict.blocks) {
				console.log(`  \x1b[1m• [${b.category.toUpperCase()}] ${b.rule}\x1b[0m`);
				console.log(`    Message:  ${b.message}`);
				console.log(`    Evidence: ${b.evidence}`);
			}
			console.log("");
		}

		if (verdict.warnings.length > 0) {
			console.log(`\x1b[33m[?] ADVISORY WARNINGS (${verdict.warnings.length}):\x1b[0m`);
			for (const w of verdict.warnings) {
				console.log(`  \x1b[1m• [${w.category.toUpperCase()}] ${w.rule}\x1b[0m`);
				console.log(`    Message:  ${w.message}`);
				console.log(`    Evidence: ${w.evidence}`);
			}
			console.log("");
		}

		if (verdict.clean) {
			console.log(`\x1b[32m✔ Clean: Diff satisfies all harness principles.\x1b[0m\n`);
		} else if (verdict.passed) {
			console.log(`\x1b[33m✔ Passed with warnings.\x1b[0m\n`);
		} else {
			console.log(`\x1b[31m✖ Failed: Fix violations before committing or merging.\x1b[0m\n`);
		}
	}

	if (!verdict.passed || (strict && !verdict.clean)) {
		process.exit(1);
	}
}
