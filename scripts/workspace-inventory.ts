#!/usr/bin/env bun
/** Inspect registered worktrees without changing branches, files, or Git metadata. */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const root = process.argv[2] && resolve(process.argv[2]);
if (!root || process.argv.length !== 3 || !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
	console.error("Usage: bun scripts/workspace-inventory.ts <development-directory>");
	process.exit(1);
}

const skipped: Record<string, true> = { ".git": true, ".jj": true, node_modules: true, target: true, ".next": true, ".venv": true, dist: true, build: true };
const repos: string[] = [];
let errors = 0;
function discover(dir: string): void {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		errors++;
		console.error(`  inventory failed to read ${dir}: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	if (entries.some((entry) => entry.name === ".git" && (entry.isDirectory() || entry.isFile()))) repos.push(dir);
	for (const entry of entries) {
		if (entry.isDirectory() && !Object.hasOwn(skipped, entry.name) && (!entry.name.startsWith(".") || entry.name === ".worktrees")) {
			discover(join(dir, entry.name));
		}
	}
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 15000,
		maxBuffer: 4 * 1024 * 1024,
	});
}

type Tree = { path: string; branch: string; prunable: boolean };
function parseWorktrees(output: string): Tree[] {
	return output.trim().split(/\n\n/).filter(Boolean).map((block) => {
		const lines = block.split("\n");
		const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
		if (!path) throw new Error("Git returned a worktree without a path");
		return {
			path,
			branch: lines.find((line) => line.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? "(detached)",
			prunable: lines.some((line) => line.startsWith("prunable ")),
		};
	});
}

discover(root);
repos.sort();
const seen = new Set<string>();
let linked = 0;
let dirty = 0;
let prunable = 0;

for (const repo of repos) {
	try {
		const commonDir = git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir").trim();
		if (seen.has(commonDir)) continue;
		seen.add(commonDir);
		console.log(`\n${relative(root, repo) || "."}`);
		const trees = parseWorktrees(git(repo, "worktree", "list", "--porcelain"));
		for (const [index, tree] of trees.entries()) {
			let state: string;
			if (tree.prunable) {
				prunable++;
				state = "prunable (Git registration)";
			} else {
				try {
					state = git(tree.path, "status", "--porcelain=v1", "--untracked-files=normal").trim() ? "dirty" : "clean";
					if (state === "dirty") dirty++;
				} catch {
					errors++;
					state = "status unavailable";
				}
			}
			if (index > 0) linked++;
			console.log(`  ${state}\t${tree.branch}\t${tree.path}`);
		}
	} catch (error) {
		errors++;
		console.error(`  inventory failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
console.log(`\n${seen.size} repositories; ${linked} linked worktrees; ${dirty} dirty; ${prunable} prunable; ${errors} errors`);
console.log("Clean means no Git-visible changes, not merged, published, inactive, or safe to remove. Ignored build outputs are not counted.");
if (errors) process.exitCode = 1;
