#!/usr/bin/env bun
import { YAML } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function document(path: string) {
	const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
	const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
	if (!match) throw new Error("missing YAML frontmatter");
	const frontmatter: unknown = YAML.parse(match[1]);
	if (!isRecord(frontmatter)) throw new Error("frontmatter must be a mapping");
	return { frontmatter, body: text.slice(match[0].length).trim() };
}

export function lintPlugin(root: string, strict = false) {
	const errors: string[] = [];
	const warnings: string[] = [];
	const skills = [...new Bun.Glob("skills/*/SKILL.md").scanSync({ cwd: root })].sort();
	if (skills.length === 0) errors.push("skills/: no SKILL.md files found");
	for (const file of skills) {
		try {
			const { frontmatter } = document(join(root, file));
			const name = basename(dirname(file));
			if (frontmatter.name !== name) errors.push(`${file}: name must equal directory ${name}`);
			if (!nonempty(frontmatter.description)) errors.push(`${file}: description must be non-empty`);
			const metadata = isRecord(frontmatter.metadata) ? frontmatter.metadata : {};
			for (const key of ["owner", "prevents", "source", "sunset"]) {
				if (!nonempty(metadata[key])) errors.push(`${file}: metadata.${key} must be non-empty`);
			}
		} catch (error) {
			errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	try {
		const { frontmatter, body } = document(join(root, "rules/core.md"));
		if (frontmatter.alwaysApply !== true) errors.push("rules/core.md: alwaysApply must be true");
		const lines = body.split("\n").length;
		if (lines > 20) errors.push(`rules/core.md: ${lines} body lines exceeds 20`);
	} catch (error) {
		errors.push(`rules/core.md: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (!existsSync(join(root, "skills/misty/SKILL.md"))) errors.push("skills/misty/SKILL.md: missing router");
	const references = new Map<string, string>();
	for (const file of new Bun.Glob("skills/misty/**/*.md").scanSync({ cwd: root })) {
		const text = readFileSync(join(root, file), "utf8");
		for (const match of text.matchAll(/skill:\/\/([a-z0-9-]+)(\/[^\s`)<>#]+)?/g)) {
			const target = join("skills", match[1], match[2]?.slice(1) || "SKILL.md");
			if (!existsSync(join(root, target))) references.set(target, file);
		}
		for (const match of text.matchAll(/`(principle-[a-z0-9-]+)`/g)) {
			const target = join("skills", match[1], "SKILL.md");
			if (!existsSync(join(root, target))) references.set(target, file);
		}
		for (const match of text.matchAll(/(?:\]\(|`)((?:\.\/)?playbooks\/[^\s`)]+\.md)/g)) {
			const target = resolve(dirname(join(root, file)), match[1]);
			if (!existsSync(target)) references.set(relative(root, target), file);
		}
	}
	for (const [target, file] of [...references].sort(([a], [b]) => a.localeCompare(b))) {
		(strict ? errors : warnings).push(`${file}: missing reference ${target}`);
	}
	return { skillCount: skills.length, errors, warnings };
}

function checked(command: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string) {
	const result = Bun.spawnSync(command, {
		cwd,
		env,
		stdin: input === undefined ? undefined : new TextEncoder().encode(input),
		stdout: "pipe",
		stderr: "pipe",
		timeout: 120_000,
		maxBuffer: 16 * 1024 * 1024,
	});
	if (!result.success) {
		throw new Error(`${command.join(" ")} failed (${result.exitCode ?? result.signalCode})\n${result.stdout.toString()}${result.stderr.toString()}`);
	}
	return result.stdout.toString();
}

export function verifyInstall(root: string, omp: string) {
	const scratchRoot = join(homedir(), ".cache/tmp");
	mkdirSync(scratchRoot, { recursive: true });
	const scratch = mkdtempSync(join(scratchRoot, "mistystack-plugin-"));
	try {
		const home = join(scratch, "home");
		const project = join(home, "project");
		const env = { ...process.env };
		for (const key of ["OMP_PROFILE", "PI_PROFILE", "PI_CONFIG_FILES", "PI_PROJECT_DIR"]) delete env[key];
		Object.assign(env, {
			HOME: home,
			PI_CONFIG_DIR: ".omp",
			PI_CODING_AGENT_DIR: join(home, ".omp/agent"),
			TMPDIR: join(scratch, "tmp"),
			XDG_DATA_HOME: join(scratch, "data"),
			XDG_CACHE_HOME: join(scratch, "cache"),
			XDG_STATE_HOME: join(scratch, "state"),
			XDG_CONFIG_HOME: join(scratch, "config"),
		});
		for (const path of [env.PI_CODING_AGENT_DIR, env.TMPDIR, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.XDG_STATE_HOME, env.XDG_CONFIG_HOME, project]) {
			mkdirSync(path!, { recursive: true });
		}
		const configPath = checked([omp, "config", "path"], project, env).trim();
		if (resolve(configPath) !== resolve(env.PI_CODING_AGENT_DIR!)) {
			throw new Error(`isolation refused: omp config path resolved outside scratch: ${configPath}`);
		}
		console.log("Isolation: omp config path is inside scratch");
		console.log(checked([omp, "plugin", "marketplace", "add", root], project, env).trim());
		console.log(checked([omp, "plugin", "install", "--scope", "user", "mistystack@mistystack"], project, env).trim());
		const output = checked([
			omp, "launch", "--mode", "rpc", "--no-session", "--no-title", "--no-lsp", "--no-extensions",
			"--no-context-files", "--tools", "read", "--model", "openrouter/google/gemini-2.5-flash-lite",
		], project, env, '{"id":"plugin-proof","type":"get_state"}\n');
		const frames = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
		const response = frames.find(frame => frame.type === "response" && frame.id === "plugin-proof");
		if (response?.success !== true || !Array.isArray(response.data?.systemPrompt)) {
			throw new Error("OMP RPC get_state did not return the system prompt");
		}
		const prompt = response.data.systemPrompt.join("\n");
		const skillList = /<skills>([\s\S]*?)<\/skills>/.exec(prompt)?.[1];
		if (!skillList || !/^- misty:/m.test(skillList)) throw new Error("misty is missing from the model's skill list");
		const unexpected = [...skillList.matchAll(/^- ([^:\s]+):/gm)]
			.map(match => match[1]).filter(name => !existsSync(join(root, "skills", name, "SKILL.md")));
		if (unexpected.length > 0) throw new Error(`isolation leaked skills: ${unexpected.join(", ")}`);
		const core = document(join(root, "rules/core.md")).body;
		if (!prompt.includes(core)) throw new Error("the always-apply core body was not injected into the session");
		const installedMisty = checked([omp, "read", "skill://misty"], project, env);
		if (!installedMisty.includes(document(join(root, "skills/misty/SKILL.md")).body)) {
			throw new Error("skill://misty did not read the working-tree body");
		}
		for (const file of new Bun.Glob("skills/principle-*/SKILL.md").scanSync({ cwd: root })) {
			const { frontmatter } = document(join(root, file));
			if (frontmatter["disable-model-invocation"] === true && skillList.includes(basename(dirname(file)))) {
				throw new Error(`${file}: hidden principle leaked into the model's skill list`);
			}
		}
		const leaf = [...new Bun.Glob("skills/principle-*/SKILL.md").scanSync({ cwd: root })].sort()[0];
		if (leaf) {
			const name = basename(dirname(leaf));
			const content = checked([omp, "read", `skill://${name}`], project, env);
			if (!content.includes(document(join(root, leaf)).body)) throw new Error(`skill://${name} is not readable`);
			console.log("Principles: hidden from the model list and readable through skill://");
		}
		console.log("Discovery: misty listed; working-tree skill readable; always-apply core injected");
		console.log(core.split("\n").find(line => line.startsWith("- ")));
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	try {
		const flags = process.argv.slice(2);
		if (flags.some(flag => !["--strict", "--lint-only"].includes(flag))) {
			throw new Error("Usage: scripts/verify plugin [--strict] [--lint-only]");
		}
		const root = resolve(import.meta.dir, "..");
		const lintOnly = flags.includes("--lint-only");
		const omp = lintOnly ? undefined : Bun.which("omp");
		if (!lintOnly && !omp) throw new Error("omp is required for plugin verification; --lint-only explicitly skips the isolated install");
		const report = lintPlugin(root, flags.includes("--strict"));
		for (const warning of report.warnings) console.warn(`WARNING: ${warning}`);
		for (const error of report.errors) console.error(`ERROR: ${error}`);
		console.log(`Plugin structure: ${report.skillCount} skills, ${report.errors.length} errors, ${report.warnings.length} warnings`);
		if (report.errors.length > 0) process.exit(1);
		const tests = Bun.spawnSync([process.execPath, "test", "--max-concurrency=1", "scripts/verify-plugin.test.ts", "./skills/"], {
			cwd: root, stdout: "inherit", stderr: "inherit",
		});
		if (!tests.success) process.exit(tests.exitCode || 1);
		if (lintOnly) console.log("Isolated install: skipped explicitly (--lint-only)");
		else verifyInstall(root, omp!);
		console.log("Verification complete: plugin");
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
