#!/usr/bin/env bun
import { YAML } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

function markdownLinks(text: string) {
	const links = new Set<string>();
	Bun.markdown.render(text, {
		link: (children, { href }) => { links.add(href); return children; },
		image: (_children, { src }) => { links.add(src); return ""; },
	});
	return links;
}

function jsonObject(path: string): Record<string, unknown> {
	const value: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isRecord(value)) throw new Error("must be a JSON object");
	return value;
}

function lintManifests(root: string, errors: string[]) {
	const load = (file: string) => {
		try {
			return jsonObject(join(root, file));
		} catch (error) {
			errors.push(`${file}: ${existsSync(join(root, file)) ? error instanceof Error ? error.message : String(error) : "missing manifest"}`);
			return undefined;
		}
	};
	const required = (manifest: Record<string, unknown>, file: string, keys: string[]) => {
		for (const key of keys) if (!nonempty(manifest[key])) errors.push(`${file}: ${key} must be non-empty`);
	};
	const path = (file: string, value: unknown, kind: "file" | "directory") => {
		if (!nonempty(value)) {
			errors.push(`${file}: referenced ${kind} path must be non-empty`);
			return undefined;
		}
		const target = resolve(root, value);
		if (isAbsolute(value) || !inside(root, target)) {
			errors.push(`${file}: path must stay inside the plugin: ${value}`);
			return undefined;
		}
		if (!existsSync(target) || (kind === "file" ? !statSync(target).isFile() : !statSync(target).isDirectory())) {
			errors.push(`${file}: missing ${kind} ${value}`);
			return undefined;
		}
		if (!inside(realpathSync(root), realpathSync(target))) {
			errors.push(`${file}: path must stay inside the plugin: ${value}`);
			return undefined;
		}
		return target;
	};
	const paths = (file: string, value: unknown, kind: "file" | "directory") => {
		const entries = typeof value === "string" ? [value] : value;
		if (!Array.isArray(entries) || entries.length === 0) {
			errors.push(`${file}: must declare at least one ${kind} path`);
			return [];
		}
		return entries.map(entry => path(file, entry, kind)).filter((entry): entry is string => entry !== undefined);
	};
	const skills = (file: string, value: unknown) => {
		const targets = paths(`${file}: skills`, value, "directory");
		if (targets.length !== 1 || targets[0] !== resolve(root, "skills")) {
			errors.push(`${file}: skills must reference the shared root skills/`);
		}
	};
	const coreHooks = (file: string, value: unknown, variable: string) => {
		let config = value;
		if (typeof value === "string") {
			const target = path(`${file}: hooks`, value, "file");
			config = target ? load(relative(root, target)) : undefined;
		}
		const hooks = isRecord(config) ? isRecord(config.hooks) ? config.hooks : config : {};
		const starts = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
		let core = false;
		const reference = new RegExp(`\\$(?:\\{${variable}\\}|${variable})/([^\\s"'\\x60;|&<>]+)`, "g");
		for (const group of starts) {
			if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
			for (const hook of group.hooks) {
				if (!isRecord(hook) || hook.type !== "command" || !nonempty(hook.command)) continue;
				for (const match of hook.command.matchAll(reference)) {
					path(`${file}: SessionStart`, match[1], "file");
					if (match[1] === "rules/core.md") core = true;
				}
			}
		}
		if (!core) errors.push(`${file}: SessionStart must register $${variable}/rules/core.md`);
	};
	const marketplace = (file: string, codex: boolean) => {
		const manifest = load(file);
		if (!manifest) return;
		required(manifest, file, ["name"]);
		if (!codex && (!isRecord(manifest.owner) || !nonempty(manifest.owner.name))) {
			errors.push(`${file}: owner.name must be non-empty`);
		}
		if (!Array.isArray(manifest.plugins) || manifest.plugins.length === 0) {
			errors.push(`${file}: plugins must be a non-empty array`);
			return;
		}
		let found = false;
		for (const plugin of manifest.plugins) {
			if (!isRecord(plugin)) {
				errors.push(`${file}: plugin entry must be an object`);
				continue;
			}
			required(plugin, `${file}: plugin`, ["name"]);
			if (plugin.name === "mistystack") found = true;
			const source = codex && isRecord(plugin.source) ? plugin.source.path : plugin.source;
			if (codex && (!isRecord(plugin.source) || plugin.source.source !== "local")) {
				errors.push(`${file}: plugin source must be local`);
			}
			const target = path(`${file}: source`, source, "directory");
			if (target && target !== resolve(root)) errors.push(`${file}: plugin source must reference the repository root`);
			if (codex && (!isRecord(plugin.policy) || plugin.policy.installation !== "AVAILABLE" || plugin.policy.authentication !== "ON_USE")) {
				errors.push(`${file}: plugin policy must use installation AVAILABLE and authentication ON_USE`);
			}
			if (codex && !nonempty(plugin.category)) errors.push(`${file}: plugin category must be non-empty`);
		}
		if (!found) errors.push(`${file}: missing mistystack plugin`);
	};
	for (const [harness, file] of [
		["claude", ".claude-plugin/plugin.json"],
		["codex", ".codex-plugin/plugin.json"],
		["omp", ".omp-plugin/plugin.json"],
	] as const) {
		const manifest = load(file);
		if (!manifest) continue;
		required(manifest, file, harness === "claude" ? ["name"] : ["name", "version"]);
		if (manifest.name !== "mistystack") errors.push(`${file}: name must be mistystack`);
		if (harness === "claude" && manifest.version !== undefined && !nonempty(manifest.version)) {
			errors.push(`${file}: version must be non-empty when provided`);
		}
		skills(file, harness === "claude" && manifest.skills === undefined ? "./skills" : manifest.skills);
		if (harness === "claude") paths(`${file}: agents`, manifest.agents, "file");
		if (harness === "omp") {
			if (manifest.agents !== undefined) errors.push(`${file}: OMP discovers root agents/; manifest agents is unsupported`);
			const agents = [...new Bun.Glob("agents/*.md").scanSync({ cwd: root })].sort();
			if (agents.length === 0) errors.push("agents/: no native OMP agents found");
			else paths(`${file}: agents`, agents, "file");
		}
		if (harness === "claude") coreHooks(file, manifest.hooks, "CLAUDE_PLUGIN_ROOT");
		if (harness === "codex") {
			if (typeof manifest.hooks !== "string") errors.push(`${file}: hooks must reference a JSON file`);
			coreHooks(file, manifest.hooks, "PLUGIN_ROOT");
		}
		if (harness === "omp" && manifest.rules !== undefined) paths(`${file}: rules`, manifest.rules, "file");
	}
	marketplace(".claude-plugin/marketplace.json", false);
	marketplace(".agents/plugins/marketplace.json", true);
	marketplace(".omp-plugin/marketplace.json", false);
	const file = "package.json";
	const manifest = load(file);
	if (manifest) {
		required(manifest, file, ["name", "version"]);
		if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("pi-package")) {
			errors.push(`${file}: keywords must include pi-package`);
		}
		const pi = isRecord(manifest.pi) ? manifest.pi : {};
		if (!Array.isArray(pi.skills)) errors.push(`${file}: pi.skills must be an array`);
		skills(file, pi.skills);
		if (!Array.isArray(pi.extensions)) errors.push(`${file}: pi.extensions must be an array`);
		const extensions = paths(`${file}: pi.extensions`, pi.extensions, "file");
		if (!extensions.includes(resolve(root, "adapters/pi/core.ts"))) {
			errors.push(`${file}: pi.extensions must register adapters/pi/core.ts`);
		}
	}
	if (manifest && !isRecord(manifest.omp)) {
		errors.push(`${file}: omp must be an explicit object to prevent pi adapter fallback`);
	} else if (manifest && isRecord(manifest.omp) && manifest.omp.extensions !== undefined) {
		const value = manifest.omp.extensions;
		const extensions = Array.isArray(value) && value.length === 0 ? [] : paths(`${file}: omp.extensions`, value, "file");
		if (extensions.includes(resolve(root, "adapters/pi/core.ts"))) {
			errors.push(`${file}: omp.extensions must not register pi's core extension`);
		}
	}
}

function inside(root: string, target: string) {
	const path = relative(resolve(root), resolve(target));
	return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
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
		const links = /\.md$/i.test(file) ? markdownLinks(text) : [];
		for (const destination of links) {
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
		for (const [, name] of text.matchAll(/\bthe\s+`([a-z0-9-]+)`\s+skill\b/gi)) {
			if (!names.has(name)) references.add(`${file}: unknown skill ${name} (missing skills/${name}/SKILL.md)`);
		}
	}
	(strict ? errors : warnings).push(...[...references].sort((a, b) => a.localeCompare(b)));
	lintManifests(root, errors);
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

type Harness = "claude" | "codex" | "omp" | "pi";
const harnesses: Harness[] = ["claude", "codex", "omp", "pi"];

function isolated<T>(harness: Harness, proof: (project: string, env: NodeJS.ProcessEnv, scratch: string) => Promise<T>): Promise<T>;
function isolated<T>(harness: Harness, proof: (project: string, env: NodeJS.ProcessEnv, scratch: string) => T): T;
function isolated<T>(harness: Harness, proof: (project: string, env: NodeJS.ProcessEnv, scratch: string) => T | Promise<T>): T | Promise<T> {
	const scratchRoot = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratchRoot, { recursive: true });
	const scratch = realpathSync(mkdtempSync(join(scratchRoot, `mistystack-${harness}-`)));
	let deferredCleanup = false;
	try {
		const home = join(scratch, "home");
		const project = join(home, "project");
		const env = { ...process.env };
		for (const key of [
			"OMP_PROFILE", "PI_PROFILE", "PI_CONFIG_FILES", "PI_PROJECT_DIR", "PI_PACKAGE_DIR",
			"PI_CODING_AGENT_SESSION_DIR", "CLAUDE_CODE_PLUGIN_DIRS",
		]) delete env[key];
		Object.assign(env, {
			HOME: home,
			CLAUDE_CONFIG_DIR: join(home, ".claude"),
			CLAUDE_CODE_PLUGIN_CACHE_DIR: join(home, ".claude/plugins"),
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
			DISABLE_AUTOUPDATER: "1",
			CODEX_HOME: join(home, ".codex"),
			PI_CONFIG_DIR: harness === "omp" ? ".omp" : ".pi",
			PI_CODING_AGENT_DIR: join(home, harness === "omp" ? ".omp/agent" : ".pi/agent"),
			PI_OFFLINE: "1",
			PI_TELEMETRY: "0",
			TMPDIR: join(scratch, "tmp"),
			XDG_DATA_HOME: join(scratch, "data"),
			XDG_CACHE_HOME: join(scratch, "cache"),
			XDG_STATE_HOME: join(scratch, "state"),
			XDG_CONFIG_HOME: join(scratch, "config"),
			NO_COLOR: "1",
			FORCE_COLOR: "0",
		});
		for (const key of [
			"HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_PLUGIN_CACHE_DIR", "CODEX_HOME", "PI_CODING_AGENT_DIR",
			"TMPDIR", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME",
		]) {
			const path = env[key];
			if (!path || !inside(scratch, path) || resolve(path) === scratch) {
				throw new Error(`isolation refused: ${key} resolved outside scratch: ${path}`);
			}
			mkdirSync(path, { recursive: true });
			if (!inside(scratch, realpathSync(path))) throw new Error(`isolation refused: ${key} escapes scratch`);
		}
		mkdirSync(project, { recursive: true });
		const result = proof(project, env, scratch);
		if (result instanceof Promise) {
			deferredCleanup = true;
			return result.finally(() => rmSync(scratch, { recursive: true, force: true }));
		}
		return result;
	} finally {
		if (!deferredCleanup) rmSync(scratch, { recursive: true, force: true });
	}
}

export function verifyInstall(root: string, omp: string, model: string) {
	isolated("omp", (project, env) => {
		const configPath = checked([omp, "config", "path"], project, env).trim();
		if (resolve(configPath) !== resolve(env.PI_CODING_AGENT_DIR!)) {
			throw new Error(`isolation refused: omp config path resolved outside scratch: ${configPath}`);
		}
		console.log("Isolation: omp config path is inside scratch");
		console.log(checked([omp, "plugin", "marketplace", "add", root], project, env).trim());
		console.log(checked([omp, "plugin", "install", "--scope", "user", "mistystack@mistystack"], project, env).trim());
		const output = checked([
			omp, "launch", "--mode", "rpc", "--no-session", "--no-title", "--no-lsp", "--no-extensions",
			"--no-context-files", "--tools", "read,task", "--model", model,
		], project, env, '{"id":"plugin-proof","type":"get_state"}\n');
		const frames = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
		const response = frames.find(frame => frame.type === "response" && frame.id === "plugin-proof");
		if (response?.success !== true || !Array.isArray(response.data?.systemPrompt)) {
			throw new Error("OMP RPC get_state did not return the system prompt");
		}
		const task = Array.isArray(response.data.dumpTools) ? response.data.dumpTools.find((tool: { name?: string }) => tool.name === "task") : undefined;
		if (!nonempty(task?.description)) throw new Error("OMP RPC get_state did not expose the native task agent inventory");
		const agents = [...new Bun.Glob("agents/*.md").scanSync({ cwd: root })].sort();
		if (agents.length === 0) throw new Error("agents/: no native OMP agents found");
		for (const file of agents) {
			const { frontmatter } = document(join(root, file));
			if (!nonempty(frontmatter.name) || !task.description.includes(frontmatter.name)) {
				throw new Error(`${file}: OMP's native task inventory did not discover the agent`);
			}
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
		console.log(`Discovery: misty listed; ${agents.length} native task agents listed; working-tree skill readable; always-apply core injected`);
		console.log(core.split("\n").find(line => line.startsWith("- ")));
	});
}

function installedRoot(value: unknown, scratch: string, root?: string) {
	if (!nonempty(value) || !isAbsolute(value) || !existsSync(value)) {
		throw new Error(`native catalog did not return an existing absolute install path: ${value}`);
	}
	const installed = realpathSync(value);
	if (!inside(scratch, installed) && installed !== (root && realpathSync(root))) {
		throw new Error(`isolation refused: native install path resolved outside scratch: ${installed}`);
	}
	return installed;
}

function installedContent(root: string, installed: string) {
	const skills = [...new Bun.Glob("skills/*/SKILL.md").scanSync({ cwd: root })].sort();
	for (const file of [...skills, "rules/core.md"]) {
		const target = join(installed, file);
		if (!existsSync(target) || !readFileSync(target).equals(readFileSync(join(root, file)))) {
			throw new Error(`${file}: native install does not expose the working-tree content`);
		}
	}
	return skills.length;
}

function installedCoreHook(installed: string, harness: "claude" | "codex") {
	const manifest = jsonObject(join(installed, `.${harness}-plugin/plugin.json`));
	const skillPaths = typeof manifest.skills === "string" ? [manifest.skills] : manifest.skills;
	if (!(harness === "claude" && manifest.skills === undefined) &&
		(!Array.isArray(skillPaths) || skillPaths.length !== 1 || resolve(installed, String(skillPaths[0])) !== join(installed, "skills"))) {
		throw new Error(`${harness}: installed manifest does not register the shared skills/`);
	}
	let config = manifest.hooks;
	if (typeof config === "string") {
		const target = resolve(installed, config);
		if (!inside(installed, target)) throw new Error(`${harness}: installed hooks path escapes plugin`);
		config = jsonObject(target);
	}
	const hooks = isRecord(config) ? isRecord(config.hooks) ? config.hooks : config : {};
	const starts = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
	const variable = harness === "claude" ? "CLAUDE_PLUGIN_ROOT" : "PLUGIN_ROOT";
	const core = new RegExp(`\\$(?:\\{${variable}\\}|${variable})/rules/core\\.md(?=["'\\s]|$)`);
	if (!starts.some(group => isRecord(group) && Array.isArray(group.hooks) &&
		group.hooks.some(hook => isRecord(hook) && hook.type === "command" && nonempty(hook.command) && core.test(hook.command)))) {
		throw new Error(`${harness}: installed SessionStart core hook is not registered`);
	}
}

async function codexInventory(executable: string, project: string, env: NodeJS.ProcessEnv, inspect: boolean) {
	const child = Bun.spawn([executable, "app-server", "--listen", "stdio://"], {
		cwd: project, env, stdin: "pipe", stdout: "pipe", stderr: "pipe",
	});
	const stderr = new Response(child.stderr).text();
	const reader = child.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let complete = false;
	const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
	const request = async (id: number, method: string, params: Record<string, unknown>) => {
		child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		await child.stdin.flush();
		for (;;) {
			const newline = buffer.indexOf("\n");
			if (newline !== -1) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (!line.trim()) continue;
				const frame: unknown = JSON.parse(line);
				if (!isRecord(frame) || frame.id !== id) continue;
				if (frame.error !== undefined) throw new Error(`codex ${method}: ${JSON.stringify(frame.error)}`);
				return frame.result;
			}
			const chunk = await reader.read();
			if (chunk.done) throw new Error(`codex app-server closed before replying to ${method}`);
			buffer += decoder.decode(chunk.value, { stream: true });
		}
	};
	const entries = (result: unknown, key: string) => {
		if (!isRecord(result) || !Array.isArray(result.data)) throw new Error(`codex ${key}/list did not return data`);
		const rows = result.data.filter(isRecord).filter(row => row.cwd === project);
		if (rows.length !== 1 || !Array.isArray(rows[0].errors) || rows[0].errors.length !== 0 || !Array.isArray(rows[0][key])) {
			throw new Error(`codex ${key}/list failed for the isolated project: ${JSON.stringify(result)}`);
		}
		return (rows[0][key] as unknown[]).filter(isRecord);
	};
	try {
		const initialized = await request(1, "initialize", {
			clientInfo: { name: "mistystack-proof", version: "1" },
			capabilities: { experimentalApi: true },
		});
		if (!isRecord(initialized) || !nonempty(initialized.codexHome) ||
			!existsSync(initialized.codexHome) || realpathSync(initialized.codexHome) !== realpathSync(env.CODEX_HOME!)) {
			throw new Error(`isolation refused: codex app-server resolved another CODEX_HOME: ${JSON.stringify(initialized)}`);
		}
		child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
		await child.stdin.flush();
		const skills = inspect ? entries(await request(2, "skills/list", { cwds: [project], forceReload: true }), "skills") : [];
		const hooks = inspect ? entries(await request(3, "hooks/list", { cwds: [project] }), "hooks") : [];
		complete = true;
		return { skills, hooks };
	} finally {
		clearTimeout(timer);
		child.stdin.end();
		child.kill("SIGKILL");
		await child.exited;
		reader.releaseLock();
		const diagnostics = await stderr;
		if (!complete && diagnostics.trim()) console.error(diagnostics.trim());
	}
}

export async function verifyNativeInstall(root: string, harness: Exclude<Harness, "omp">, executable: string) {
	root = resolve(root);
	await isolated(harness, async (project, env, scratch) => {
		const id = "mistystack@mistystack";
		if (harness === "claude") {
			const before: unknown = JSON.parse(checked([executable, "plugin", "list", "--json"], project, env));
			if (!Array.isArray(before) || before.length !== 0) throw new Error("isolation refused: claude catalog is not empty before install");
			console.log(checked([executable, "plugin", "marketplace", "add", root, "--scope", "user"], project, env).trim());
			console.log(checked([executable, "plugin", "install", id, "--scope", "user"], project, env).trim());
			const catalog: unknown = JSON.parse(checked([executable, "plugin", "list", "--json"], project, env));
			const plugin = Array.isArray(catalog) ? catalog.find(entry => isRecord(entry) && entry.id === id) : undefined;
			if (!isRecord(plugin) || plugin.enabled !== true) throw new Error("claude native catalog did not enable mistystack");
			const cached = installedRoot(plugin.installPath, scratch, root);
			const installed = plugin.readFromFolder === undefined ? cached : installedRoot(plugin.readFromFolder, scratch, root);
			const count = installedContent(root, installed);
			installedCoreHook(installed, harness);
			const details = checked([executable, "plugin", "details", id], project, env);
			const skills = /Skills\s*\((\d+)\)([\s\S]*?)(?:\n\s*(?:Agents|Hooks|Commands|MCP|LSP|Projected)\b|$)/i.exec(details);
			if (!skills || Number(skills[1]) !== count || !/\bmisty\b/.test(skills[2]) || !/Hooks\s*\([1-9]\d*\)[\s\S]*?\bSessionStart\b/.test(details)) {
				throw new Error(`claude native component inventory did not register skills and the SessionStart hook\n${details}`);
			}
			console.log(details.trim());
			console.log(`PASS claude: ${count} installed skills; native inventory registers SessionStart core hook (no inference)`);
		} else if (harness === "codex") {
			await codexInventory(executable, project, env, false);
			const before: unknown = JSON.parse(checked([executable, "plugin", "list", "--json"], project, env));
			if (!isRecord(before) || !Array.isArray(before.installed) || before.installed.length !== 0) {
				throw new Error("isolation refused: codex catalog is not empty before install");
			}
			console.log(checked([executable, "plugin", "marketplace", "add", root, "--json"], project, env).trim());
			const result = checked([executable, "plugin", "add", id, "--json"], project, env);
			console.log(result.trim());
			const added: unknown = JSON.parse(result);
			if (!isRecord(added) || added.pluginId !== id) throw new Error("codex add did not return the installed plugin identity");
			const installed = installedRoot(added.installedPath, scratch);
			const catalog: unknown = JSON.parse(checked([executable, "plugin", "list", "--json"], project, env));
			const plugin = isRecord(catalog) && Array.isArray(catalog.installed) ?
				catalog.installed.find(entry => isRecord(entry) && entry.pluginId === id) : undefined;
			if (!isRecord(plugin) || plugin.installed !== true || plugin.enabled !== true) {
				throw new Error("codex native catalog did not install and enable mistystack");
			}
			const count = installedContent(root, installed);
			installedCoreHook(installed, harness);
			const inventory = await codexInventory(executable, project, env, true);
			const listed = inventory.skills.filter(skill => skill.pluginId === id && skill.enabled === true);
			for (const file of new Bun.Glob("skills/*/SKILL.md").scanSync({ cwd: root })) {
				const name = basename(dirname(file));
				if (!listed.some(skill => skill.name === `mistystack:${name}` && skill.path === join(installed, file))) {
					throw new Error(`codex native skills/list did not discover ${name} from the installed plugin`);
				}
			}
			if (listed.length !== count) throw new Error("codex native skills/list returned unexpected plugin skills");
			const hook = inventory.hooks.find(hook => hook.pluginId === id && hook.enabled === true &&
				hook.eventName === "sessionStart" && hook.handlerType === "command" && nonempty(hook.command) &&
				/\$(?:\{PLUGIN_ROOT\}|PLUGIN_ROOT)\/rules\/core\.md(?:["'\s]|$)/.test(hook.command) &&
				nonempty(hook.sourcePath) && inside(installed, hook.sourcePath));
			if (!hook) throw new Error("codex native hooks/list did not register the installed SessionStart core hook");
			console.log(`PASS codex: enabled native catalog entry; skills/list discovers ${count} skills; hooks/list registers SessionStart (trust: ${hook.trustStatus}; no inference or hook execution)`);
		} else {
			const settingsPath = join(env.PI_CODING_AGENT_DIR!, "settings.json");
			checked([executable, "list", "--no-approve"], project, env);
			if (existsSync(settingsPath)) {
				const settings = jsonObject(settingsPath);
				if (Array.isArray(settings.packages) && settings.packages.length !== 0) throw new Error("isolation refused: pi packages are not empty before install");
			}
			console.log(checked([executable, "install", root, "--no-approve"], project, env).trim());
			const catalog = checked([executable, "list", "--no-approve"], project, env);
			console.log(catalog.trim());
			const settings = jsonObject(settingsPath);
			const source = Array.isArray(settings.packages) && settings.packages.length === 1 && typeof settings.packages[0] === "string"
				? resolve(dirname(settingsPath), settings.packages[0]) : undefined;
			if (source !== root || !catalog.split("\n").some(line => line.trim() === root)) {
				throw new Error("pi native settings/list did not register the local package");
			}
			// Native local installs reference this directory in place rather than copying it.
			const installed = installedRoot(source, scratch, root);
			const count = installedContent(root, installed);
			const manifest = jsonObject(join(installed, "package.json"));
			const pi = isRecord(manifest.pi) ? manifest.pi : {};
			if (!Array.isArray(pi.skills) || pi.skills.length !== 1 || resolve(installed, String(pi.skills[0])) !== join(installed, "skills") ||
				!Array.isArray(pi.extensions) || !pi.extensions.some(path => typeof path === "string" && resolve(installed, path) === join(installed, "adapters/pi/core.ts")) ||
				!existsSync(join(installed, "adapters/pi/core.ts"))) {
				throw new Error("pi installed package does not register skills/ and the core extension");
			}
			const output = checked([
				executable, "--mode", "rpc", "--no-session", "--offline", "--no-context-files", "--no-mcp", "--no-approve",
			], project, env, '{"id":"plugin-proof","type":"get_commands"}\n');
			const frames: unknown[] = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
			const response = frames.find(frame => isRecord(frame) && frame.id === "plugin-proof");
			const data = isRecord(response) && response.success === true && isRecord(response.data) ? response.data : {};
			const commands = Array.isArray(data.commands) ? data.commands.filter(isRecord).filter(command => command.source === "skill") : [];
			for (const file of new Bun.Glob("skills/*/SKILL.md").scanSync({ cwd: root })) {
				const name = basename(dirname(file));
				if (!commands.some(command => command.name === `skill:${name}` && isRecord(command.sourceInfo) &&
					command.sourceInfo.path === join(installed, file) && command.sourceInfo.origin === "package")) {
					throw new Error(`pi native get_commands did not discover ${name} from the installed package`);
				}
			}
			if (commands.length !== count) throw new Error("pi native get_commands returned unexpected skills");
			console.log(`PASS pi: native get_commands discovers ${count} installed skills; package registers the core extension (no inference; extension invocation not exercised)`);
		}
	});
}

export async function verifyAvailableInstalls(
	root: string,
	model?: string,
	executables: Partial<Record<Harness, string>> = Object.fromEntries(harnesses.map(harness => [harness, Bun.which(harness)]).filter(([, executable]) => executable)),
) {
	const results: { harness: Harness; status: "PASS" | "SKIP" }[] = [];
	for (const harness of harnesses) {
		const executable = executables[harness];
		if (!executable) {
			console.log(`SKIP ${harness}: CLI not found on PATH; isolated install not exercised`);
			results.push({ harness, status: "SKIP" });
			continue;
		}
		if (harness === "omp") {
			if (model === undefined) {
				const config: unknown = JSON.parse(checked([executable, "config", "get", "modelRoles", "--json"], root, process.env));
				const roles = isRecord(config) && isRecord(config.value) ? config.value : {};
				if (!nonempty(roles.smol)) throw new Error("Configure OMP's modelRoles.smol or pass plugin --model SELECTOR for the inference-free RPC proof");
				model = roles.smol;
				console.log("RPC model: resolved from OMP's smol role (no inference)");
			}
			verifyInstall(root, executable, model);
			console.log("PASS omp: isolated native install, skill/agent discovery and fresh-session core injection (no inference)");
		} else {
			await verifyNativeInstall(root, harness, executable);
		}
		results.push({ harness, status: "PASS" });
	}
	return results;
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
					console.log(`${usage}\nAll options are plugin-only; --strict fails on broken relative Markdown links, unknown skill names and harness-specific URIs outside skills/misty/harnesses/. --lint-only skips installation for every harness. Available Claude, Codex, OMP and pi CLIs use isolated native installs; missing CLIs report SKIP, not PASS. The RPC model defaults to OMP's smol role; --model overrides it without inference.`);
					process.exit(0);
				default: throw new Error(usage);
			}
		}
		const root = resolve(import.meta.dir, "..");
		const report = lintPlugin(root, strict);
		for (const warning of report.warnings) console.warn(`WARNING: ${warning}`);
		for (const error of report.errors) console.error(`ERROR: ${error}`);
		console.log(`Plugin structure: ${report.skillCount} skills, ${report.errors.length} errors, ${report.warnings.length} warnings`);
		if (report.errors.length > 0) process.exit(1);
		const tests = Bun.spawnSync([process.execPath, "test", "--max-concurrency=1"], {
			cwd: root, stdout: "inherit", stderr: "inherit",
		});
		if (!tests.success) process.exit(tests.exitCode || 1);
		if (lintOnly) {
			for (const harness of harnesses) console.log(`SKIP ${harness}: --lint-only; isolated install not exercised`);
		} else {
			const results = await verifyAvailableInstalls(root, model);
			console.log(`Native installs: ${results.filter(result => result.status === "PASS").length} PASS, ${results.filter(result => result.status === "SKIP").length} SKIP`);
		}
		console.log("Verification complete: plugin");
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
