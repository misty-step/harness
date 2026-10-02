#!/usr/bin/env bun
import { lstat, readFile, readdir, readlink, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
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
// This is the exact former installer footprint, not ownership of every server
// named linear. Custom transports, headers and other options remain foreign.
const retiredMcpSchema = "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";
function ownedLinear(server: unknown): boolean {
	return Boolean(server && typeof server === "object" && !Array.isArray(server) &&
		(server as Record<string, unknown>).type === "http" &&
		(server as Record<string, unknown>).url === "https://mcp.linear.app/mcp" &&
		Object.keys(server).every(key => ["type", "url", "auth", "oauth"].includes(key)));
}
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

const scopeFiles: Array<{ path: string; content: string | null }> = [];
const retiredImports: Array<{ path: string; excludePath: string; excludes: string }> = [];
const foreignLinear: string[] = [];

async function retireMcp(configPath: string): Promise<boolean> {
	const entry = await metadata(configPath);
	if (!entry) return false;
	if (!entry.isFile() || entry.isSymbolicLink()) {
		throw new Error(`Refusing non-file or symlinked scope definition: ${configPath}`);
	}
	const previousText = await readFile(configPath, "utf8");
	const previous = JSON.parse(previousText);
	if (!previous || typeof previous !== "object" || Array.isArray(previous) ||
		(previous.mcpServers !== undefined && (!previous.mcpServers || typeof previous.mcpServers !== "object" || Array.isArray(previous.mcpServers)))) {
		throw new Error(`Invalid MCP configuration: ${configPath}`);
	}
	const server = previous.mcpServers?.linear;
	if (server !== undefined && !ownedLinear(server)) {
		foreignLinear.push(configPath);
		return true;
	}
	if (server !== undefined) delete previous.mcpServers.linear;
	const emptyOwned = previous.$schema === retiredMcpSchema &&
		Object.keys(previous).every(key => key === "$schema" || key === "mcpServers") &&
		previous.mcpServers && Object.keys(previous.mcpServers).length === 0;
	if (emptyOwned) {
		scopeFiles.push({ path: configPath, content: null });
		return false;
	}
	if (server !== undefined) {
		scopeFiles.push({ path: configPath, content: `${JSON.stringify(previous, null, 2)}\n` });
	}
	return true;
}

await requireOrdinaryDirectory(agentDir);
await retireMcp(join(agentDir, "mcp.json"));
for (const owner of ["misty-step", "moomooskycow"]) {
	const scope = join(developmentRoot, owner);
	if (!(await metadata(scope))) continue;
	await requireOrdinaryDirectory(scope);
	const configDir = join(scope, ".omp");
	await requireOrdinaryDirectory(configDir);
	const configPath = join(configDir, "mcp.json");
	// An existing import still carries foreign servers/settings. Keep that
	// discovery path intact, but never create another tracker import.
	if (await retireMcp(configPath)) continue;

	for (const project of await readdir(scope, { withFileTypes: true })) {
		if (!project.isDirectory() || project.name.startsWith(".")) continue;
		const root = join(scope, project.name);
		if (!(await metadata(join(root, ".git")))) continue;
		const localConfig = join(root, ".omp");
		await requireOrdinaryDirectory(localConfig);
		const path = join(localConfig, ".mcp.json");
		const target = relative(localConfig, configPath);
		const entry = await metadata(path);
		if (!entry?.isSymbolicLink() || await readlink(path) !== target) continue;
		const git = Bun.spawn(["git", "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], { cwd: root, stdout: "pipe", stderr: "pipe" });
		const [excludeOutput, gitError, exitCode] = await Promise.all([new Response(git.stdout).text(), new Response(git.stderr).text(), git.exited]);
		if (exitCode !== 0) throw new Error(`Cannot resolve local Git exclusions for ${root}: ${gitError.trim()}`);
		const excludePath = excludeOutput.trim();
		const excludes = await textOrEmpty(excludePath);
		retiredImports.push({ path, excludePath, excludes });
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
	console.log(`Scoped MCP retirement plan: ${scopeFiles.length} definition retirements, ${retiredImports.length} owned project imports; preserve ${foreignLinear.length} foreign Linear definitions; retire ${retiredPresent.join(",") || "none"}; todoist ${todoistPlan}`);
} else {
	for (const file of scopeFiles) {
		if (file.content === null) {
			await rm(file.path);
			continue;
		}
		const temporary = `${file.path}.${process.pid}.tmp`;
		try {
			await writeFile(temporary, file.content, { mode: 0o600, flag: "wx" });
			await rename(temporary, file.path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
	for (const item of retiredImports) {
		await rm(item.path);
		const excludes = item.excludes.split("\n").filter(line => line.replace(/\r$/, "") !== "/.omp/.mcp.json").join("\n");
		if (excludes !== item.excludes) await writeFile(item.excludePath, excludes);
	}
	for (const name of retiredPresent) {
		await rm(join(agentDir, "skills", name), { recursive: true, force: true });
	}
	if (removeTodoist) await rm(todoistLive, { recursive: true, force: true });
	console.log(`Retired ${scopeFiles.length} owned MCP definitions and ${retiredImports.length} project imports under misty-step/moomooskycow; no other development tree configured. Preserved foreign Linear definitions: ${foreignLinear.join(",") || "none"}. Retired owned skills: ${retiredPresent.join(",") || "none"}; todoist ${todoistPlan}.`);
}

