import { afterEach, describe, expect, test } from "bun:test";
import {
	copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
	readlinkSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const repo = join(import.meta.dir, "..");
const roots: string[] = [];
type Fixture = { root: string; source: string; target: string; home: string };

function put(root: string, path: string, content: string) {
	const destination = join(root, path);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, content);
}

function fixture(): Fixture {
	const root = mkdtempSync(join(tmpdir(), "omp-install-secrets-test-"));
	roots.push(root);
	const files = {
		root, source: join(root, "source"), target: join(root, "live"), home: join(root, "home"),
	};
	mkdirSync(join(files.source, "bin"), { recursive: true });
	mkdirSync(join(files.source, "skills/authenticated-commands"), { recursive: true });
	copyFileSync(join(repo, "install"), join(files.source, "install"));
	copyFileSync(join(repo, "bin/pass-env.ts"), join(files.source, "bin/pass-env.ts"));
	copyFileSync(join(repo, "skills/authenticated-commands/SKILL.md"), join(files.source, "skills/authenticated-commands/SKILL.md"));
	for (const path of ["AGENTS.md", "WATCHDOG.md", "WATCHDOG.yml"]) {
		put(files.source, `global/${path}`, "pending source guidance\n");
		put(files.target, path, "live guidance\n");
	}
	put(files.target, "config.yml", "foreign: keep\n");
	put(files.target, "models.yml", "providers:\n  foreign: {}\n");
	put(files.target, "mcp.json", '{"mcpServers":{"foreign":{"url":"https://example.invalid"}}}\n');
	put(files.target, "skills/authenticated-commands/obsolete.txt", "stale owned content\n");
	put(files.target, "skills/foreign/SKILL.md", "foreign skill\n");
	put(files.target, "agents/foreign.md", "foreign agent\n");
	put(files.target, "extensions/foreign/index.ts", "foreign extension\n");
	put(files.home, ".local/bin/pass-env", readFileSync(join(repo, "bin/pass-env.ts"), "utf8"));
	put(files.home, ".local/bin/foreign-tool", "foreign executable\n");
	put(files.home, ".config/foreign/config", "foreign configuration\n");
	return files;
}

function invoke(files: Fixture, components = "secrets") {
	return Bun.spawnSync({
		cmd: ["/bin/sh", join(files.source, "install")],
		env: {
			PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
			HOME: files.home,
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
			entries[key] = "directory";
			for (const name of readdirSync(path)) visit(join(path, name));
		} else entries[key] = `file:${info.mode}:${readFileSync(path, "utf8")}`;
	}
	visit(root);
	return entries;
}

function withoutOwned(entries: Record<string, string>, prefix: string) {
	return Object.fromEntries(Object.entries(entries).filter(([path]) => path !== prefix && !path.startsWith(`${prefix}/`)));
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("secrets installation", () => {
	test("replaces only the launcher and owned skill without needing credentials", () => {
		const files = fixture();
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		const result = invoke(files);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		expect(withoutOwned(snapshot(files.target), "skills/authenticated-commands"))
			.toEqual(withoutOwned(beforeAgent, "skills/authenticated-commands"));
		expect(withoutOwned(snapshot(files.home), ".local/bin/pass-env"))
			.toEqual(withoutOwned(beforeHome, ".local/bin/pass-env"));
		expect(existsSync(join(files.target, "skills/authenticated-commands/obsolete.txt"))).toBe(false);
		expect(readFileSync(join(files.target, "skills/authenticated-commands/SKILL.md"), "utf8"))
			.toBe(readFileSync(join(files.source, "skills/authenticated-commands/SKILL.md"), "utf8"));
		const launcher = join(files.home, ".local/bin/pass-env");
		expect(readFileSync(launcher, "utf8")).toBe(readFileSync(join(files.source, "bin/pass-env.ts"), "utf8"));
		expect(lstatSync(launcher).mode & 0o777).toBe(0o700);
		expect(existsSync(join(files.home, ".password-store"))).toBe(false);
		expect(invoke(files).exitCode).toBe(0);
	});

	test("missing launcher aborts a combined selection before writing guidance or home", () => {
		const files = fixture();
		rmSync(join(files.source, "bin/pass-env.ts"));
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files, "guidance secrets").exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});

	test("invalid launcher syntax cannot partially deploy the selected components", () => {
		const files = fixture();
		put(files.source, "bin/pass-env.ts", "const invalid = ;\n");
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files, "guidance secrets").exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});

	test("symlinked launcher destination cannot overwrite an unrelated file", () => {
		const files = fixture();
		put(files.home, "unowned", "keep this file\n");
		const launcher = join(files.home, ".local/bin/pass-env");
		rmSync(launcher);
		symlinkSync(join(files.home, "unowned"), launcher);
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});

	test("foreign current or retired launcher aborts before any selected component changes", () => {
		for (const name of ["pass-env", "omp-secrets"]) {
			const files = fixture();
			put(files.home, `.local/bin/${name}`, "foreign executable\n");
			const beforeAgent = snapshot(files.target);
			const beforeHome = snapshot(files.home);
			expect(invoke(files, "guidance secrets").exitCode).not.toBe(0);
			expect(snapshot(files.target)).toEqual(beforeAgent);
			expect(snapshot(files.home)).toEqual(beforeHome);
		}
	});
});
