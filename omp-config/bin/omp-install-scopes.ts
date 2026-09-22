#!/usr/bin/env bun
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		"agent-dir": { type: "string" },
		"development-root": { type: "string" },
		"todoist-owner": { type: "string" },
		check: { type: "boolean", default: false },
	},
	strict: true,
});

if (!values["agent-dir"] || !values["development-root"]) {
	throw new Error("--agent-dir and --development-root are required");
}
const agentDir = resolve(values["agent-dir"]);
const developmentRoot = resolve(values["development-root"]);
const todoistOwner = resolve(
	values["todoist-owner"] ??
		process.env.OMP_TODOIST_OWNER ??
		join(developmentRoot, "moomooskycow/daybook/.agents/skills/todoist-cli"),
);
const definition = JSON.parse(await readFile(new URL("../workspace-mcp.json", import.meta.url), "utf8"));
const ownedServer = definition.mcpServers.linear;
const retiredOwnedSkills = ["parlor", "ast-grep", "now-next"] as const;

async function metadata(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function requireOrdinaryDirectory(path: string) {
	const entry = await metadata(path);
	if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
		throw new Error(`Refusing non-directory or symlinked configuration directory: ${path}`);
	}
}

async function textOrEmpty(path: string) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw error;
	}
}

const scopeFiles: Array<{ path: string; content: string }> = [];
const imports: Array<{ path: string; target: string; create: boolean; excludePath: string; excludes: string }> = [];
for (const owner of ["misty-step", "moomooskycow"]) {
	const scope = join(developmentRoot, owner);
	if (!(await metadata(scope))) continue;
	await requireOrdinaryDirectory(scope);
	const configDir = join(scope, ".omp");
	await requireOrdinaryDirectory(configDir);
	const configPath = join(configDir, "mcp.json");
	const configEntry = await metadata(configPath);
	if (configEntry && (!configEntry.isFile() || configEntry.isSymbolicLink())) {
		throw new Error(`Refusing non-file or symlinked scope definition: ${configPath}`);
	}
	const previousText = await textOrEmpty(configPath);
	const previous = previousText ? JSON.parse(previousText) : {};
	if (!previous || typeof previous !== "object" || Array.isArray(previous) ||
		(previous.mcpServers !== undefined && (!previous.mcpServers || typeof previous.mcpServers !== "object" || Array.isArray(previous.mcpServers)))) {
		throw new Error(`Invalid MCP configuration: ${configPath}`);
	}
	const existing = previous.mcpServers?.linear ?? {};
	const linear = { ...ownedServer, ...(existing.auth ? { auth: existing.auth } : {}), ...(existing.oauth ? { oauth: existing.oauth } : {}) };
	const content = `${JSON.stringify({ ...previous, $schema: definition.$schema, mcpServers: { ...previous.mcpServers, linear } }, null, 2)}\n`;
	if (content !== previousText) scopeFiles.push({ path: configPath, content });

	for (const project of await readdir(scope, { withFileTypes: true })) {
		if (!project.isDirectory() || project.name.startsWith(".")) continue;
		const root = join(scope, project.name);
		if (!(await metadata(join(root, ".git")))) continue;
		const localConfig = join(root, ".omp");
		await requireOrdinaryDirectory(localConfig);
		// The fallback leaves an existing primary project mcp.json untouched.
		const path = join(localConfig, ".mcp.json");
		const target = relative(localConfig, configPath);
		const entry = await metadata(path);
		if (entry && (!entry.isSymbolicLink() || await readlink(path) !== target)) {
			throw new Error(`Preserving existing project configuration; cannot install scoped import: ${path}`);
		}
		const git = Bun.spawn(["git", "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], { cwd: root, stdout: "pipe", stderr: "pipe" });
		const [excludeOutput, gitError, exitCode] = await Promise.all([new Response(git.stdout).text(), new Response(git.stderr).text(), git.exited]);
		if (exitCode !== 0) throw new Error(`Cannot resolve local Git exclusions for ${root}: ${gitError.trim()}`);
		const excludePath = excludeOutput.trim();
		const excludes = await textOrEmpty(excludePath);
		imports.push({ path, target, create: !entry, excludePath, excludes });
	}
}

const retiredPresent: string[] = [];
for (const name of retiredOwnedSkills) {
	if (await metadata(join(agentDir, "skills", name))) retiredPresent.push(name);
}
const todoistLive = join(agentDir, "skills", "todoist-cli");
const todoistPresent = Boolean(await metadata(todoistLive));
let todoistOwnerReady = false;
try {
	const ownerSkill = await readFile(join(todoistOwner, "SKILL.md"), "utf8");
	todoistOwnerReady = ownerSkill.trim().length > 0;
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const removeTodoist = todoistPresent && todoistOwnerReady && resolve(todoistLive) !== todoistOwner;
const todoistPlan = removeTodoist ? "retire" : todoistPresent ? "retain until owner SKILL.md exists" : "absent";
if (values.check) {
	console.log(`Scoped MCP plan: ${scopeFiles.length} definition updates, ${imports.filter(item => item.create).length} project imports; retire ${retiredPresent.join(",") || "none"}; todoist ${todoistPlan}`);
} else {
	for (const file of scopeFiles) {
		await mkdir(dirname(file.path), { recursive: true, mode: 0o700 });
		const temporary = `${file.path}.${process.pid}.tmp`;
		try {
			await writeFile(temporary, file.content, { mode: 0o600, flag: "wx" });
			await rename(temporary, file.path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
	for (const item of imports) {
		await mkdir(dirname(item.path), { recursive: true, mode: 0o700 });
		if (item.create) await symlink(item.target, item.path);
		const exclusion = "/.omp/.mcp.json";
		if (!item.excludes.split(/\r?\n/).includes(exclusion)) {
			await mkdir(dirname(item.excludePath), { recursive: true });
			await writeFile(item.excludePath, `${item.excludes}${item.excludes && !item.excludes.endsWith("\n") ? "\n" : ""}${exclusion}\n`);
		}
	}
	for (const name of retiredPresent) {
		await rm(join(agentDir, "skills", name), { recursive: true, force: true });
	}
	if (removeTodoist) await rm(todoistLive, { recursive: true, force: true });
	console.log(`Installed scoped MCP for ${imports.length} existing checkouts under misty-step/moomooskycow; no other development tree configured. Retired owned skills: ${retiredPresent.join(",") || "none"}; todoist ${todoistPlan}.`);
}

