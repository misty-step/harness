import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const cli = join(import.meta.dir, "omp-install-scopes.ts");
const schema = "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";
const linear = { type: "http", url: "https://mcp.linear.app/mcp", auth: { token: "synthetic-auth" }, oauth: { clientId: "synthetic-client" } };
const roots: string[] = [];
type ScopeFixture = { root: string; agent: string; development: string };

function fixture(): ScopeFixture {
	const root = mkdtempSync(join(tmpdir(), "omp-scope-retirement-"));
	roots.push(root);
	const agent = join(root, "agent"), development = join(root, "development");
	mkdirSync(agent);
	mkdirSync(development);
	return { root, agent, development };
}

function put(path: string, content: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
}

function checkout(development: string, owner: string, name: string) {
	const root = join(development, owner, name);
	mkdirSync(join(root, ".omp"), { recursive: true });
	const git = Bun.spawnSync(["git", "init", "--quiet", root]);
	if (git.exitCode !== 0) throw new Error(git.stderr.toString());
	return root;
}

function run(files: ScopeFixture, ...args: string[]) {
	return Bun.spawnSync([process.execPath, cli, "--agent-dir", files.agent, "--development-root", files.development, ...args], {
		stdout: "pipe", stderr: "pipe", env: { ...process.env, OMP_TODOIST_OWNER: join(files.root, "missing-todoist") },
	});
}

function document(path: string) {
	return JSON.parse(readFileSync(path, "utf8"));
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("retires only the former MCP footprint and owned imports, with inert preflight and repeat installs", () => {
	const files = fixture();
	const global = join(files.agent, "mcp.json");
	const foreign = { type: "stdio", command: "foreign-server", args: ["keep"] };
	put(global, { $schema: schema, mcpServers: { linear, foreign }, disabledServers: ["foreign-disabled"], foreignSetting: "keep" });
	for (const owner of ["misty-step", "moomooskycow"]) {
		const project = checkout(files.development, owner, "project");
		put(join(files.development, owner, ".omp/mcp.json"), { $schema: schema, mcpServers: { linear } });
		symlinkSync("../../.omp/mcp.json", join(project, ".omp/.mcp.json"));
		put(join(project, ".omp/mcp.json"), { mcpServers: { foreign } });
		put(join(project, ".git/info/exclude"), "# foreign comment\n/foreign-local\n/.omp/.mcp.json\n");
	}
	const r90 = checkout(files.development, "r90group", "project");
	const r90Config = join(files.development, "r90group/.omp/mcp.json");
	put(r90Config, { $schema: schema, mcpServers: { linear } });
	symlinkSync("../../.omp/mcp.json", join(r90, ".omp/.mcp.json"));
	const originalGlobal = readFileSync(global, "utf8");
	const originalR90 = readFileSync(r90Config, "utf8");
	expect(run(files, "--check").exitCode).toBe(0);
	expect(readFileSync(global, "utf8")).toBe(originalGlobal);
	for (const owner of ["misty-step", "moomooskycow"]) {
		const project = join(files.development, owner, "project");
		expect(document(join(files.development, owner, ".omp/mcp.json")).mcpServers.linear).toEqual(linear);
		expect(readlinkSync(join(project, ".omp/.mcp.json"))).toBe("../../.omp/mcp.json");
		expect(readFileSync(join(project, ".git/info/exclude"), "utf8")).toContain("/.omp/.mcp.json");
	}
	expect(run(files).exitCode).toBe(0);
	expect(document(global)).toEqual({ $schema: schema, mcpServers: { foreign }, disabledServers: ["foreign-disabled"], foreignSetting: "keep" });
	for (const owner of ["misty-step", "moomooskycow"]) {
		const project = join(files.development, owner, "project");
		expect(existsSync(join(files.development, owner, ".omp/mcp.json"))).toBe(false);
		expect(() => readlinkSync(join(project, ".omp/.mcp.json"))).toThrow();
		expect(document(join(project, ".omp/mcp.json"))).toEqual({ mcpServers: { foreign } });
		expect(readFileSync(join(project, ".git/info/exclude"), "utf8")).toBe("# foreign comment\n/foreign-local\n");
	}
	expect(readFileSync(r90Config, "utf8")).toBe(originalR90);
	expect(readlinkSync(join(r90, ".omp/.mcp.json"))).toBe("../../.omp/mcp.json");
	expect(run(files).exitCode).toBe(0);
});

test("keeps the existing discovery path for foreign MCP servers and settings without creating new imports", () => {
	const files = fixture();
	const old = checkout(files.development, "misty-step", "old");
	const fresh = checkout(files.development, "misty-step", "fresh");
	const config = join(files.development, "misty-step/.omp/mcp.json");
	const foreign = { type: "http", url: "https://foreign.example/mcp", oauth: { clientId: "foreign" } };
	put(config, { $schema: schema, mcpServers: { linear, foreign }, disabledServers: ["foreign-disabled"] });
	symlinkSync("../../.omp/mcp.json", join(old, ".omp/.mcp.json"));
	put(join(old, ".git/info/exclude"), "/.omp/.mcp.json\n");
	expect(run(files).exitCode).toBe(0);
	expect(document(config)).toEqual({ $schema: schema, mcpServers: { foreign }, disabledServers: ["foreign-disabled"] });
	expect(readlinkSync(join(old, ".omp/.mcp.json"))).toBe("../../.omp/mcp.json");
	expect(readFileSync(join(old, ".git/info/exclude"), "utf8")).toBe("/.omp/.mcp.json\n");
	expect(existsSync(join(fresh, ".omp/.mcp.json"))).toBe(false);
});

test("does not claim foreign servers named linear, configuration files or import targets", () => {
	for (const server of [
		{ type: "http", url: "https://foreign.example/mcp" },
		{ ...linear, headers: { Authorization: "synthetic-foreign" } },
		{ type: "stdio", command: "foreign-linear" },
	]) {
		const files = fixture();
		const global = join(files.agent, "mcp.json");
		put(global, { mcpServers: { linear: server } });
		const project = checkout(files.development, "misty-step", "project");
		put(join(files.development, "misty-step/.omp/mcp.json"), { $schema: schema, mcpServers: { linear } });
		put(join(project, ".omp/.mcp.json"), "foreign fallback file\n");
		const other = checkout(files.development, "misty-step", "other");
		symlinkSync("../../foreign.json", join(other, ".omp/.mcp.json"));
		const before = readFileSync(global, "utf8");
		const result = run(files);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain(global);
		expect(readFileSync(global, "utf8")).toBe(before);
		expect(readFileSync(join(project, ".omp/.mcp.json"), "utf8")).toBe("foreign fallback file\n");
		expect(readlinkSync(join(other, ".omp/.mcp.json"))).toBe("../../foreign.json");
	}
});

test("refuses unsafe configurations before any retirement writes", () => {
	for (const unsafe of ["file-symlink", "directory-symlink", "invalid-document"]) {
		const files = fixture();
		const global = join(files.agent, "mcp.json");
		put(global, { $schema: schema, mcpServers: { linear } });
		const owner = join(files.development, "misty-step");
		mkdirSync(owner);
		const foreign = join(files.root, "foreign");
		if (unsafe === "directory-symlink") {
			mkdirSync(foreign);
			symlinkSync(foreign, join(owner, ".omp"));
		} else if (unsafe === "file-symlink") {
			put(foreign, { $schema: schema, mcpServers: { linear } });
			mkdirSync(join(owner, ".omp"));
			symlinkSync(foreign, join(owner, ".omp/mcp.json"));
		} else put(join(owner, ".omp/mcp.json"), { mcpServers: [] });
		const before = readFileSync(global, "utf8");
		expect(run(files).exitCode).not.toBe(0);
		expect(readFileSync(global, "utf8")).toBe(before);
	}
});

test("a fresh layout never installs tracker files or imports", () => {
	const files = fixture();
	const project = checkout(files.development, "misty-step", "project");
	expect(run(files).exitCode).toBe(0);
	expect(existsSync(join(files.agent, "mcp.json"))).toBe(false);
	expect(existsSync(join(files.development, "misty-step/.omp/mcp.json"))).toBe(false);
	expect(existsSync(join(project, ".omp/.mcp.json"))).toBe(false);
});
