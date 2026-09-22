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
	const root = mkdtempSync(join(tmpdir(), "agent-config-install-test-"));
	roots.push(root);
	const files = { root, source: join(root, "source"), target: join(root, "agent"), home: join(root, "home") };
	const source = files.source;
	mkdirSync(join(source, "bin"), { recursive: true });
	mkdirSync(join(source, "guidance"), { recursive: true });
	mkdirSync(join(source, "skills/authenticated-commands"), { recursive: true });
	copyFileSync(join(repo, "install"), join(source, "install"));
	copyFileSync(join(repo, "bin/pass-env.ts"), join(source, "bin/pass-env.ts"));
	copyFileSync(join(repo, "guidance/pokayoke.md"), join(source, "guidance/pokayoke.md"));
	copyFileSync(
		join(repo, "skills/authenticated-commands/SKILL.md"),
		join(source, "skills/authenticated-commands/SKILL.md"),
	);
	put(source, "AGENTS.md", "# Harness guidance\n\n<!-- shared guidance: agent-config -->\n");
	// Foreign live state that the installer must never touch.
	put(files.target, "settings.json", '{"foreign":"keep"}\n');
	put(files.target, "agents/foreign.md", "foreign agent\n");
	put(files.target, "skills/authenticated-commands/obsolete.txt", "stale owned content\n");
	put(files.target, "skills/foreign/SKILL.md", "foreign skill\n");
	put(files.home, ".local/bin/foreign-tool", "foreign executable\n");
	return files;
}

function invoke(files: Fixture, extra: string[] = []) {
	return Bun.spawnSync({
		cmd: [
			"/bin/sh", join(files.source, "install"),
			"--agent-dir", files.target, "--home", files.home,
			"--skill", "authenticated-commands", "--bin", "pass-env.ts",
			"--guidance", "pokayoke", "--guidance-source", join(files.source, "AGENTS.md"),
			...extra,
		],
		env: { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: files.home },
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

function withoutOwned(entries: Record<string, string>, ...owned: string[]) {
	return Object.fromEntries(Object.entries(entries).filter(
		([path]) => !owned.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
	));
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("install", () => {
	test("deploys the launcher, owned skill, and guidance without needing credentials", () => {
		const files = fixture();
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		const result = invoke(files);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		expect(withoutOwned(snapshot(files.target), "skills/authenticated-commands", "AGENTS.md"))
			.toEqual(withoutOwned(beforeAgent, "skills/authenticated-commands", "AGENTS.md"));
		expect(withoutOwned(snapshot(files.home), ".local/bin/pass-env"))
			.toEqual(withoutOwned(beforeHome, ".local/bin/pass-env"));
		expect(existsSync(join(files.target, "skills/authenticated-commands/obsolete.txt"))).toBe(false);
		expect(readFileSync(join(files.target, "skills/authenticated-commands/SKILL.md"), "utf8"))
			.toBe(readFileSync(join(files.source, "skills/authenticated-commands/SKILL.md"), "utf8"));
		const launcher = join(files.home, ".local/bin/pass-env");
		expect(readFileSync(launcher, "utf8")).toBe(readFileSync(join(files.source, "bin/pass-env.ts"), "utf8"));
		expect(lstatSync(launcher).mode & 0o777).toBe(0o700);
		expect(existsSync(join(files.home, ".password-store"))).toBe(false);
		const guidance = readFileSync(join(files.target, "AGENTS.md"), "utf8");
		expect(guidance).toContain("# Harness guidance");
		expect(guidance).toContain("## Pokayoke");
		expect(guidance).not.toContain("shared guidance: agent-config");
		expect(invoke(files).exitCode).toBe(0);
	});

	test("--check validates the whole selection and writes nothing", () => {
		const files = fixture();
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files, ["--check"]).exitCode).toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});

	test("missing launcher aborts a combined selection before writing guidance or home", () => {
		const files = fixture();
		rmSync(join(files.source, "bin/pass-env.ts"));
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});

	test("invalid launcher syntax cannot partially deploy the selection", () => {
		const files = fixture();
		put(files.source, "bin/pass-env.ts", "const invalid = ;\n");
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});

	test("symlinked launcher destination cannot overwrite an unrelated file", () => {
		const files = fixture();
		put(files.home, "unowned", "keep this file\n");
		const launcher = join(files.home, ".local/bin/pass-env");
		mkdirSync(dirname(launcher), { recursive: true });
		symlinkSync(join(files.home, "unowned"), launcher);
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});

	test("foreign launcher aborts before any selected component changes", () => {
		const files = fixture();
		put(files.home, ".local/bin/pass-env", "foreign executable\n");
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});

	test("guidance source without the marker aborts", () => {
		const files = fixture();
		put(files.source, "AGENTS.md", "# Harness guidance\n\nno marker here\n");
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});

	test("unknown skill name aborts before writing", () => {
		const files = fixture();
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files, ["--skill", "does-not-exist"]).exitCode).not.toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});
});
