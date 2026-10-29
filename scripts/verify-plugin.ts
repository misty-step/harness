#!/usr/bin/env bun
import { YAML } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
	// YAML 1.1 readers (Hermes/PyYAML) turn plain dates into non-JSON date objects.
	if (/^[ \t]*[\w-]+:[ \t]*(?:!!timestamp[ \t]+)?\d{4}-\d{2}-\d{2}(?=$|[Tt \t#])/m.test(match[1])) {
		throw new Error("quote YAML date values for JSON-compatible metadata");
	}
	const frontmatter: unknown = YAML.parse(match[1]);
	if (!isRecord(frontmatter)) throw new Error("frontmatter must be a mapping");
	return { frontmatter, body: text.slice(match[0].length).trim() };
}

function markdownReferences(text: string) {
	const links = new Set<string>();
	const names = new Set<string>();
	const collectNames = (children: string) => {
		// Only real code spans delimit skill names; inline examples stay literal.
		for (const match of children.matchAll(/\bthe\s+\0([^\0\r\n]+)\0\s+skill\b/gi)) names.add(match[1]);
		return "";
	};
	Bun.markdown.render(text, {
		link: (children, { href }) => { links.add(href); return children; },
		image: (_children, { src }) => { links.add(src); return ""; },
		codespan: children => `\0${children}\0`,
		code: () => "",
		html: () => "",
		paragraph: collectNames,
		heading: collectNames,
		listItem: collectNames,
		th: collectNames,
		td: collectNames,
	});
	return { links, names };
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
			if (name.startsWith("principle-") && frontmatter["disable-model-invocation"] !== true) {
				errors.push(`${file}: disable-model-invocation must be true`);
			}
			const metadata = isRecord(frontmatter.metadata) ? frontmatter.metadata : {};
			for (const key of ["owner", "prevents", "source"]) {
				if (!nonempty(metadata[key])) errors.push(`${file}: metadata.${key} must be non-empty`);
			}
			if (!nonempty(metadata.sunset)) errors.push(`${file}: metadata.sunset must be a non-empty string`);
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
	const names = new Set(skills.map(file => basename(dirname(file))));
	const references = new Set<string>();
	for (const file of [...new Bun.Glob("{skills,rules}/**/*").scanSync({ cwd: root, dot: true })].sort()) {
		const bytes = readFileSync(join(root, file));
		if (bytes.includes(0)) continue;
		const text = bytes.toString("utf8");
		if (!file.startsWith("skills/misty/harnesses/")) {
			for (const scheme of new Set(text.match(/(?:skill|xd):\/\//g))) {
				references.add(`${file}: harness-specific URI ${scheme} is only allowed in skills/misty/harnesses/`);
			}
		}
		const markdown = /\.md$/i.test(file)
			? markdownReferences(text)
			: { links: [], names: [...text.matchAll(/\bthe\s+`([^`\r\n]+)`\s+skill\b/gi)].map(match => match[1]) };
		for (const destination of markdown.links) {
			const path = destination.split(/[?#]/, 1)[0];
			if (!path || /^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(path)) continue;
			let decoded: string;
			try {
				decoded = decodeURIComponent(path);
			} catch {
				references.add(`${file}: invalid relative link ${destination} (malformed percent encoding)`);
				continue;
			}
			if (/^[/\\]/.test(decoded)) continue;
			const target = resolve(dirname(join(root, file)), decoded);
			if (!existsSync(target) || !statSync(target).isFile()) {
				references.add(`${file}: missing reference ${relative(root, target)}`);
			}
		}
		for (const name of markdown.names) {
			if (!names.has(name)) references.add(`${file}: unknown skill ${name} (missing skills/${name}/SKILL.md)`);
		}
	}
	(strict ? errors : warnings).push(...[...references].sort((a, b) => a.localeCompare(b)));
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

export function verifyInstall(root: string, omp: string, model: string) {
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
			"--no-context-files", "--tools", "read", "--model", model,
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
		const usage = "Usage: scripts/verify plugin [--strict] [--lint-only] [--model SELECTOR]";
		let strict = false;
		let lintOnly = false;
		let model: string | undefined;
		for (let index = 0; index < flags.length; index++) {
			switch (flags[index]) {
				case "--strict": strict = true; break;
				case "--lint-only": lintOnly = true; break;
				case "--model":
					model = flags[++index];
					if (!model || model.startsWith("--")) throw new Error(usage);
					break;
				case "--help":
				case "-h":
					console.log(`${usage}\nAll options are plugin-only; --strict fails on broken relative Markdown links, unknown skill names and harness-specific URIs outside skills/misty/harnesses/. --lint-only skips installation. The RPC model defaults to OMP's smol role; --model overrides it without inference.`);
					process.exit(0);
				default: throw new Error(usage);
			}
		}
		const root = resolve(import.meta.dir, "..");
		const omp = lintOnly ? undefined : Bun.which("omp");
		if (!lintOnly && !omp) throw new Error("omp is required for plugin verification; --lint-only explicitly skips the isolated install");
		const report = lintPlugin(root, strict);
		for (const warning of report.warnings) console.warn(`WARNING: ${warning}`);
		for (const error of report.errors) console.error(`ERROR: ${error}`);
		console.log(`Plugin structure: ${report.skillCount} skills, ${report.errors.length} errors, ${report.warnings.length} warnings`);
		if (report.errors.length > 0) process.exit(1);
		const tests = Bun.spawnSync([process.execPath, "test", "--max-concurrency=1"], {
			cwd: root, stdout: "inherit", stderr: "inherit",
		});
		if (!tests.success) process.exit(tests.exitCode || 1);
		if (lintOnly) console.log("Isolated install: skipped explicitly (--lint-only)");
		else {
			if (model === undefined) {
				const config: unknown = JSON.parse(checked([omp!, "config", "get", "modelRoles", "--json"], root, process.env));
				const roles = isRecord(config) && isRecord(config.value) ? config.value : {};
				if (!nonempty(roles.smol)) throw new Error("Configure OMP's modelRoles.smol or pass plugin --model SELECTOR for the inference-free RPC proof");
				model = roles.smol;
				console.log("RPC model: resolved from OMP's smol role (no inference)");
			}
			verifyInstall(root, omp!, model);
		}
		console.log("Verification complete: plugin");
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
