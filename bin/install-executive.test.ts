import { afterEach, describe, expect, test } from "bun:test";
import {
	copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
	readlinkSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const repo = join(import.meta.dir, "..");
const roots: string[] = [];
type Fixture = { root: string; source: string; target: string };

function put(root: string, path: string, content: string) {
	const destination = join(root, path);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, content);
}

function fixture(): Fixture {
	const root = mkdtempSync(join(tmpdir(), "omp-install-executive-test-"));
	roots.push(root);
	const files = { root, source: join(root, "source"), target: join(root, "live") };
	mkdirSync(join(files.source, "bin"), { recursive: true });
	mkdirSync(join(files.source, "agents"));
	copyFileSync(join(repo, "install"), join(files.source, "install"));
	copyFileSync(join(repo, "bin/omp-merge-config.ts"), join(files.source, "bin/omp-merge-config.ts"));
	copyFileSync(join(repo, "agents/executive.md"), join(files.source, "agents/executive.md"));
	put(files.source, "config.yml", "task:\n  maxRecursionDepth: 5\n  enableLsp: false\nmodelRoles:\n  default: dirty/source-model\nsourceOnly: true\n");
	put(files.source, "extensions/executive/index.ts", 'import { policy } from "./policy";\nexport default function executive() { return policy; }\n');
	put(files.source, "extensions/executive/policy.ts", 'export const policy = "fixture-policy";\n');
	put(files.source, "extensions/executive/resources/.state.json", '{"keep":"nested asset"}\n');
	put(files.target, "config.yml", "task:\n  maxRecursionDepth: 1\n  enableLsp: true\nmodelRoles:\n  default: live/model\nforeign: keep\n");
	put(files.target, "extensions/executive/stale.ts", "obsolete owned module\n");
	put(files.target, "extensions/foreign/index.ts", "foreign extension\n");
	put(files.target, "agents/executive.md", "old executive\n");
	put(files.target, "agents/foreign.md", "foreign agent\n");
	put(files.target, "AGENTS.md", "live guidance\n");
	put(files.target, "WATCHDOG.md", "live watchdog\n");
	put(files.target, "WATCHDOG.yml", "live: watchdog\n");
	put(files.target, "models.yml", "providers:\n  foreign: {}\n");
	put(files.target, "mcp.json", '{"mcpServers":{"foreign":{"url":"https://example.invalid"}}}\n');
	put(files.target, "skills/foundation/SKILL.md", "live skill\n");
	put(files.target, "skills/foreign/SKILL.md", "foreign skill\n");
	return files;
}

function invoke(files: Fixture, components = "executive") {
	return Bun.spawnSync({
		cmd: ["/bin/sh", join(files.source, "install")],
		env: {
			PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
			HOME: join(files.root, "home"),
			PI_CODING_AGENT_DIR: files.target,
			OMP_DEVELOPMENT_ROOT: join(files.root, "development"),
			OMP_INSTALL_COMPONENTS: components,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

function snapshot(root: string): Record<string, string> {
	const entries: Record<string, string> = {};
	function visit(path: string) {
		const info = lstatSync(path);
		const key = relative(root, path);
		if (info.isSymbolicLink()) entries[key] = `symlink:${readlinkSync(path)}`;
		else if (info.isDirectory()) {
			entries[key] = `directory:${info.mode}`;
			for (const name of readdirSync(path)) visit(join(path, name));
		} else entries[key] = `file:${info.mode}:${readFileSync(path, "utf8")}`;
	}
	visit(root);
	return entries;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("executive installation", () => {
	test("selectively replaces the owned package and leaf without deploying other source state", () => {
		const files = fixture();
		const before = snapshot(files.target);
		const result = invoke(files);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		expect(Bun.YAML.parse(readFileSync(join(files.target, "config.yml"), "utf8"))).toEqual({
			task: { maxRecursionDepth: 5, enableLsp: true },
			modelRoles: { default: "live/model" },
			foreign: "keep",
		});
		const after = snapshot(files.target);
		for (const path of [
			"extensions/foreign", "extensions/foreign/index.ts", "agents/foreign.md", "AGENTS.md",
			"WATCHDOG.md", "WATCHDOG.yml", "models.yml", "mcp.json", "skills", "skills/foundation",
			"skills/foundation/SKILL.md", "skills/foreign", "skills/foreign/SKILL.md",
		]) expect(after[path]).toBe(before[path]);
		expect(existsSync(join(files.target, "extensions/executive/stale.ts"))).toBe(false);
		for (const path of ["index.ts", "policy.ts", "resources/.state.json"]) {
			expect(readFileSync(join(files.target, "extensions/executive", path), "utf8"))
				.toBe(readFileSync(join(files.source, "extensions/executive", path), "utf8"));
		}
		expect(readFileSync(join(files.target, "agents/executive.md"), "utf8"))
			.toBe(readFileSync(join(files.source, "agents/executive.md"), "utf8"));
	});

	test("a missing package aborts the whole component selection before guidance writes", () => {
		const files = fixture();
		for (const path of ["AGENTS.md", "WATCHDOG.md", "WATCHDOG.yml"]) put(files.source, `global/${path}`, "new source guidance\n");
		rmSync(join(files.source, "extensions/executive"), { recursive: true });
		const before = snapshot(files.target);
		expect(invoke(files, "guidance executive").exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(before);
	});

	test("invalid selected config cannot partially install the package or agent", () => {
		const files = fixture();
		put(files.source, "config.yml", "task:\n  maxRecursionDepth: not-an-integer\n");
		const before = snapshot(files.target);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(before);
	});

	test("a missing local module fails package preflight before any deployment writes", () => {
		const files = fixture();
		rmSync(join(files.source, "extensions/executive/policy.ts"));
		const before = snapshot(files.target);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(before);
	});

	test("invalid TypeScript cannot replace the currently deployed package", () => {
		const files = fixture();
		put(files.source, "extensions/executive/policy.ts", "export const policy = ;\n");
		const before = snapshot(files.target);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(before);
	});

	test("invalid agent frontmatter fails before deployment", () => {
		const files = fixture();
		put(files.source, "agents/executive.md", "---\nname: executive\ndescription: [\n---\nDelegate work.\n");
		const before = snapshot(files.target);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(before);
	});

	test("a symlinked agent destination cannot overwrite an unowned file", () => {
		const files = fixture();
		const unowned = join(files.root, "unowned.md");
		writeFileSync(unowned, "do not replace\n");
		rmSync(join(files.target, "agents/executive.md"));
		symlinkSync(unowned, join(files.target, "agents/executive.md"));
		const before = snapshot(files.target);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(before);
		expect(readFileSync(unowned, "utf8")).toBe("do not replace\n");
	});

	test("all mode includes clean executive replacement and preserves foreign packages and settings", () => {
		const files = fixture();
		copyFileSync(join(repo, "bin/omp-install-scopes.ts"), join(files.source, "bin/omp-install-scopes.ts"));
		copyFileSync(join(repo, "bin/omp-grievances.ts"), join(files.source, "bin/omp-grievances.ts"));
		copyFileSync(join(repo, "bin/pass-env.ts"), join(files.source, "bin/pass-env.ts"));
		put(files.source, "skills/authenticated-commands/SKILL.md", readFileSync(join(repo, "skills/authenticated-commands/SKILL.md"), "utf8"));
		copyFileSync(join(repo, "workspace-mcp.json"), join(files.source, "workspace-mcp.json"));
		put(files.source, ".githooks/pre-push", readFileSync(join(repo, ".githooks/pre-push"), "utf8"));
		put(files.source, "models.yml", "providers:\n  owned: {}\n");
		put(files.source, "mcp.json", '{"mcpServers":{}}\n');
		put(files.source, "themes/fixture.json", '{"name":"fixture"}\n');
		put(files.source, "skills/owned/SKILL.md", "owned skill fixture\n");
		for (const path of ["AGENTS.md", "WATCHDOG.md", "WATCHDOG.yml"]) put(files.source, `global/${path}`, "owned guidance fixture\n");
		const before = snapshot(files.target);
		const result = invoke(files, "all");
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		expect(Bun.YAML.parse(readFileSync(join(files.target, "config.yml"), "utf8"))).toEqual({
			task: { maxRecursionDepth: 5, enableLsp: false },
			modelRoles: { default: "dirty/source-model" },
			sourceOnly: true,
			foreign: "keep",
		});
		expect(existsSync(join(files.target, "extensions/executive/stale.ts"))).toBe(false);
		expect(readFileSync(join(files.target, "extensions/executive/resources/.state.json"), "utf8"))
			.toBe('{"keep":"nested asset"}\n');
		expect(readFileSync(join(files.target, "agents/executive.md"), "utf8"))
			.toBe(readFileSync(join(files.source, "agents/executive.md"), "utf8"));
		const after = snapshot(files.target);
		for (const path of ["extensions/foreign", "extensions/foreign/index.ts", "agents/foreign.md", "skills/foreign", "skills/foreign/SKILL.md"]) {
			expect(after[path]).toBe(before[path]);
		}
	});
});
