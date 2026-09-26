#!/usr/bin/env bun
/** Materialize a task manifest's hidden tests from the original merge commits. */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

type Command = { cwd: string; cmd: string };
type Relaxation = { file: string; find: string; replace: string };
type Task = {
	id: string; pr: number; size: "S" | "M" | "L"; base: string; merge: string;
	reference_files: string[]; reference_lines: { added: number; deleted: number };
	hidden: string[]; relaxed: string | null; relax: Relaxation[];
	grade: Command[]; regress: Command[];
	baseline: { regress_pass: boolean; hidden_fail_at_base: string };
	merge_hidden: string; statement: string;
};
type Manifest = { version: number; repo: string; tasks: Task[] };

function fail(message: string): never {
	throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}
function path(value: unknown): value is string {
	return text(value) && !isAbsolute(value) && !value.split("/").some((part) => part === "" || part === "." || part === ".." || part === "\\") && !value.includes("\\") && !value.includes("\0");
}
function paths(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(path);
}
function commands(value: unknown): value is Command[] {
	return Array.isArray(value) && value.length > 0 && value.every((item) => object(item) && (item.cwd === "." || path(item.cwd)) && text(item.cmd));
}
function manifest(value: unknown): value is Manifest {
	if (!object(value) || value.version !== 1 || !text(value.repo) || !Array.isArray(value.tasks) || value.tasks.length === 0) return false;
	const ids = new Set<string>();
	return value.tasks.every((item: unknown) => {
		if (!object(item)) return false;
		const hidden = item.hidden;
		if (!text(item.id) || !/^h\d+$/.test(item.id) || ids.has(item.id) || !Number.isInteger(item.pr) || item.pr !== Number(item.id.slice(1)) || !["S", "M", "L"].includes(String(item.size)) ||
			!text(item.base) || !/^[a-f0-9]{40}$/.test(item.base) || !text(item.merge) || !/^[a-f0-9]{40}$/.test(item.merge) ||
			!paths(item.reference_files) || !object(item.reference_lines) || !Number.isInteger(item.reference_lines.added) || !Number.isInteger(item.reference_lines.deleted) ||
			!paths(hidden) || hidden.length === 0 || new Set(hidden).size !== hidden.length ||
			!(item.relaxed === null || text(item.relaxed)) || !Array.isArray(item.relax) ||
			!item.relax.every((edit: unknown) => object(edit) && path(edit.file) && hidden.includes(edit.file) && text(edit.find) && typeof edit.replace === "string") ||
			!commands(item.grade) || !commands(item.regress) || !object(item.baseline) || typeof item.baseline.regress_pass !== "boolean" || !text(item.baseline.hidden_fail_at_base) || !text(item.merge_hidden) || !text(item.statement)) return false;
		ids.add(item.id);
		return true;
	});
}

function options(argv: string[]): { manifest: string; repo: string; out: string } {
	const options = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 2) {
		const key = argv[i];
		if (!(["--manifest", "--repo", "--out"].includes(key)) || options.has(key) || !argv[i + 1] || argv[i + 1].startsWith("--")) fail(`invalid argument ${key ?? "(missing)"}`);
		options.set(key, argv[i + 1]);
	}
	for (const key of ["--manifest", "--repo", "--out"]) if (!options.has(key)) fail(`missing ${key}`);
	return { manifest: resolve(options.get("--manifest")!), repo: resolve(options.get("--repo")!), out: resolve(options.get("--out")!) };
}

function main(): void {
	const args = options(process.argv.slice(2));
	const parsed: unknown = JSON.parse(readFileSync(args.manifest, "utf8"));
	if (!manifest(parsed)) fail(`invalid task manifest: ${args.manifest}`);
	const shallow = spawnSync("git", ["-C", args.repo, "rev-parse", "--is-shallow-repository"], { encoding: "utf8" });
	if (shallow.status !== 0 || shallow.stdout.trim() !== "false") fail(`--repo must be a full-history Git clone: ${args.repo}`);
	mkdirSync(args.out, { recursive: true, mode: 0o700 });
	chmodSync(args.out, 0o700);
	for (const task of parsed.tasks) {
		for (const file of task.hidden) {
			const shown = spawnSync("git", ["-C", args.repo, "show", `${task.merge}:${file}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
			if (shown.status !== 0 || shown.error) fail(`${task.id} ${file}: git show failed: ${shown.stderr || shown.error?.message}`);
			let content = shown.stdout;
			for (const edit of task.relax.filter((edit) => edit.file === file)) {
				const first = content.indexOf(edit.find);
				if (first < 0 || content.indexOf(edit.find, first + edit.find.length) !== -1) fail(`${task.id} ${file}: relaxation find must match exactly once: ${JSON.stringify(edit.find)}`);
				content = `${content.slice(0, first)}${edit.replace}${content.slice(first + edit.find.length)}`;
			}
			const destination = join(args.out, task.id, file);
			mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
			writeFileSync(destination, content, { mode: 0o600 });
		}
		console.log(`${task.id}: ${task.hidden.length} hidden file(s)`);
	}
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
