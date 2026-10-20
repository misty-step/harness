import { afterEach, describe, expect, test } from "bun:test";
import {
	copyFileSync, cpSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
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
	copyFileSync(join(repo, "bin/launcher-build.ts"), join(source, "bin/launcher-build.ts"));
	copyFileSync(join(repo, "bin/t3-pool.ts"), join(source, "bin/t3-pool.ts"));
	cpSync(join(repo, "lib"), join(source, "lib"), { recursive: true });
	cpSync(join(repo, "t3-pool"), join(source, "t3-pool"), { recursive: true });
	copyFileSync(join(repo, "guidance/engineering.md"), join(source, "guidance/engineering.md"));
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
	for (const name of ["agent-ergonomics", "capture", "decide", "check-cadence", "verification-infrastructure"]) {
		put(files.target, `skills/${name}/SKILL.md`, `retired owned ${name}\n`);
	}
	put(files.home, ".local/bin/foreign-tool", "foreign executable\n");
	put(files.home, ".cache/tmp/foreign-cache", "foreign cache sentinel\n");
	put(files.home, ".fixture-bin/systemctl", '#!/bin/sh\n[ "$*" != "--user show-environment" ] || exit 0\nprintf "%s\\n" "$*" >> "$HOME/systemctl-calls"\n');
	chmodSync(join(files.home, ".fixture-bin/systemctl"), 0o700);
	return files;
}

function invoke(files: Fixture, extra: string[] = []) {
	return Bun.spawnSync({
		cmd: [
			"/bin/sh", join(files.source, "install"),
			"--agent-dir", files.target, "--home", files.home,
			"--skill", "authenticated-commands", "--bin", "pass-env.ts",
			"--guidance", "engineering", "--guidance-source", join(files.source, "AGENTS.md"),
			...extra,
		],
		env: { PATH: `${files.home}/.fixture-bin:${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: files.home },
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
	test("pool preflight is inert; deployment bundles its CLI, copies owned config and units, and leaves activation opt-in", () => {
		const files = fixture();
		const before = snapshot(files.home);
		expect(invoke(files, ["--t3-pool", "--check"]).exitCode).toBe(0);
		expect(snapshot(files.home)).toEqual(before);
		const deployed = invoke(files, ["--t3-pool"]);
		expect(deployed.stderr.toString()).toBe("");
		expect(deployed.exitCode).toBe(0);
		expect(readFileSync(join(files.home, "systemctl-calls"), "utf8")).toBe("--user daemon-reload\n");
		expect(readFileSync(join(files.home, ".config/t3-pool.json"), "utf8")).toBe(readFileSync(join(repo, "t3-pool/pools.json"), "utf8"));
		expect(readFileSync(join(files.home, ".config/systemd/user/t3-pool.timer"), "utf8")).toContain("OnUnitInactiveSec=90s");
		expect(readFileSync(join(files.target, "AGENTS.md"), "utf8")).toContain(readFileSync(join(repo, "guidance/engineering.md"), "utf8"));
		rmSync(files.source, { recursive: true });
		const smoke = Bun.spawnSync(["bun", join(files.home, ".local/bin/t3-pool"), "--help"]);
		expect(smoke.exitCode).toBe(0);
		expect(smoke.stdout.toString()).toContain("Usage: t3-pool");
	});

	test.each(["disabled", "enabled", "masked"])("pool reinstall preserves %s activation", (activation) => {
		const files = fixture();
		expect(invoke(files, ["--t3-pool"]).exitCode).toBe(0);
		if (activation === "masked") {
			rmSync(join(files.home, ".config/systemd/user/t3-pool.timer"));
			symlinkSync("/dev/null", join(files.home, ".config/systemd/user/t3-pool.timer"));
		}
		put(files.home, ".fixture-bin/systemctl", `#!/bin/sh
[ "$*" != "--user show-environment" ] || exit 0
[ "$*" != "--user is-enabled t3-pool.timer" ] || { echo ${activation}; exit 0; }
printf '%s\\n' "$*" >> "$HOME/systemctl-calls"
`);
		expect(invoke(files, ["--t3-pool"]).exitCode).toBe(0);
		expect(readFileSync(join(files.home, "systemctl-calls"), "utf8")).toBe("--user daemon-reload\n--user daemon-reload\n");
		if (activation === "masked") expect(readlinkSync(join(files.home, ".config/systemd/user/t3-pool.timer"))).toBe("/dev/null");
	});

	test("pool skips gracefully without a systemd user manager and still installs other primitives", () => {
		const files = fixture();
		put(files.home, ".fixture-bin/systemctl", "#!/bin/sh\nexit 1\n");
		const installed = invoke(files, ["--t3-pool"]);
		expect(installed.exitCode).toBe(0);
		expect(installed.stdout.toString()).toContain("Skipping T3 pool");
		expect(existsSync(join(files.home, ".local/bin/pass-env"))).toBe(true);
		expect(existsSync(join(files.home, ".local/bin/t3-pool"))).toBe(false);
		expect(existsSync(join(files.home, ".config/systemd/user/t3-pool.timer"))).toBe(false);
	});

	test.each(["systemctl", "flock"])("pool skips a standalone install without %s", (missing) => {
		const files = fixture();
		const minimal = join(files.root, "minimal-bin");
		mkdirSync(minimal);
		const dirnameTool = Bun.which("dirname");
		if (!dirnameTool) throw new Error("dirname missing");
		symlinkSync(dirnameTool, join(minimal, "dirname"));
		if (missing === "flock") symlinkSync(join(files.home, ".fixture-bin/systemctl"), join(minimal, "systemctl"));
		const installed = Bun.spawnSync({
			cmd: ["/bin/sh", join(files.source, "install"), "--home", files.home, "--t3-pool"],
			env: { HOME: files.home, PATH: minimal },
		});
		expect(installed.exitCode).toBe(0);
		expect(installed.stdout.toString()).toContain("Skipping T3 pool");
		expect(existsSync(join(files.home, ".local/bin/t3-pool"))).toBe(false);
	});

	test.each([".local/bin/t3-pool", ".config/t3-pool.json", ".config/systemd/user/t3-pool.service", ".config/systemd/user/t3-pool.timer"])("pool refuses foreign %s before any write", (path) => {
		const files = fixture();
		put(files.home, path, "foreign owner\n");
		const before = snapshot(files.home);
		expect(invoke(files, ["--t3-pool"]).exitCode).not.toBe(0);
		expect(snapshot(files.home)).toEqual(before);
	});

	test("pool refuses symlinked owned config before any write", () => {
		const files = fixture();
		mkdirSync(join(files.home, ".config"));
		symlinkSync(join(files.source, "t3-pool/pools.json"), join(files.home, ".config/t3-pool.json"));
		const before = snapshot(files.home);
		expect(invoke(files, ["--t3-pool"]).exitCode).not.toBe(0);
		expect(snapshot(files.home)).toEqual(before);
	});
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
		const launcher = join(files.home, ".local/bin/pass-env");
		expect(lstatSync(launcher).mode & 0o777).toBe(0o700);
		expect(existsSync(join(files.home, ".password-store"))).toBe(false);
		expect(invoke(files).exitCode).toBe(0);
	});

	test("leaves a foreign skills/foundation and skills/dev-exec alone", () => {
		const files = fixture();
		put(files.target, "skills/foundation/SKILL.md", "foreign foundation skill\n");
		put(files.target, "skills/dev-exec/SKILL.md", "foreign dev-exec skill\n");
		const result = invoke(files);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		expect(readFileSync(join(files.target, "skills/foundation/SKILL.md"), "utf8")).toBe("foreign foundation skill\n");
		expect(readFileSync(join(files.target, "skills/dev-exec/SKILL.md"), "utf8")).toBe("foreign dev-exec skill\n");
	});

	test("redeploys unchanged launchers without writing to their protected directory", () => {
		const files = fixture();
		expect(invoke(files).exitCode).toBe(0);
		const bin = join(files.home, ".local/bin");
		const launcher = join(bin, "pass-env");
		const before = lstatSync(launcher);
		chmodSync(bin, 0o500);
		try {
			const result = invoke(files);
			expect(result.stderr.toString()).toBe("");
			expect(result.exitCode).toBe(0);
			expect(lstatSync(launcher).ino).toBe(before.ino);
			expect(lstatSync(bin).mode & 0o777).toBe(0o500);
		} finally {
			chmodSync(bin, 0o700);
		}
	});

	test.each([
		{ replacement: "engineering-operations", retired: ["agent-ergonomics", "capture"] },
		{ replacement: "sachstand", retired: ["decide"] },
		{ replacement: "story-qa", retired: ["check-cadence", "verification-infrastructure"] },
	])("$replacement retires only its replaced procedures", ({ replacement, retired }) => {
		const files = fixture();
		cpSync(join(repo, "skills", replacement), join(files.source, "skills", replacement), { recursive: true });
		const before = snapshot(files.target);
		expect(invoke(files, ["--skill", replacement]).exitCode).toBe(0);
		for (const name of retired) expect(existsSync(join(files.target, "skills", name))).toBe(false);
		const owned = ["skills/authenticated-commands", `skills/${replacement}`, "AGENTS.md",
			...retired.map((name) => `skills/${name}`)];
		expect(withoutOwned(snapshot(files.target), ...owned)).toEqual(withoutOwned(before, ...owned));
	});

	test("--check validates the whole selection and writes nothing", () => {
		const files = fixture();
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files, ["--check"]).exitCode).toBe(0);
		expect(snapshot(files.target)).toEqual(beforeAgent);
		expect(snapshot(files.home)).toEqual(beforeHome);
	});

	test("bundled local modules survive removal of the source; foreign dependencies fail before writes", () => {
		const files = fixture();
		put(files.source, "bin/local.ts", '#!/usr/bin/env bun\n// local: owned standalone launcher (misty-step/harness).\nimport { value } from "../lib/value.ts";\nconsole.log(value);\n');
		put(files.source, "lib/value.ts", 'export const value = "owned capability";\n');
		expect(invoke(files, ["--bin", "local.ts"]).exitCode).toBe(0);
		rmSync(join(files.source, "lib"), { recursive: true });
		const smoke = Bun.spawnSync(["bun", join(files.home, ".local/bin/local")]);
		expect(smoke.exitCode).toBe(0);
		expect(smoke.stdout.toString().trim()).toBe("owned capability");
		put(files.source, "bin/local.ts", '#!/usr/bin/env bun\n// local: owned standalone launcher (misty-step/harness).\nimport "unowned-package";\n');
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files, ["--bin", "local.ts"]).exitCode).not.toBe(0);
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

	test("--guidance-file CLAUDE.md composes the same guidance into CLAUDE.md only", () => {
		const files = fixture();
		expect(invoke(files).exitCode).toBe(0);
		const agents = readFileSync(join(files.target, "AGENTS.md"), "utf8");
		rmSync(join(files.target, "AGENTS.md"));
		const result = invoke(files, ["--guidance-file", "CLAUDE.md"]);
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		expect(readFileSync(join(files.target, "CLAUDE.md"), "utf8")).toBe(agents);
		expect(existsSync(join(files.target, "AGENTS.md"))).toBe(false);
	});

	test("an unknown guidance file name aborts before writing", () => {
		const files = fixture();
		const beforeAgent = snapshot(files.target);
		const beforeHome = snapshot(files.home);
		expect(invoke(files, ["--guidance-file", "../settings.json"]).exitCode).not.toBe(0);
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
