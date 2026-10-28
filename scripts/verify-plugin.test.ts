import { afterEach, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { lintPlugin, verifyInstall } from "./verify-plugin";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const scratch = process.env.TMPDIR ?? join(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true });
	const root = mkdtempSync(join(scratch, "plugin-lint-"));
	roots.push(root);
	const put = (path: string, content: string) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	};
	const skill = (name: string, body = "Run the owned check.") => `---\nname: ${name}\ndescription: "When changing the consumer path."\n${name.startsWith("principle-") ? "disable-model-invocation: true\n" : ""}metadata:\n  owner: phaedrus\n  prevents: "A recorded consumer failure."\n  source: "owner/repo@0123456789abcdef/source"\n  sunset: "2026-11-27"\n---\n${body}\n`;
	put("skills/misty/SKILL.md", skill("misty"));
	put("rules/core.md", "---\nalwaysApply: true\n---\n# Core\n\n- Load misty.\n");
	return { root, put, skill };
}

function runPlugin(root: string, args: string[], path = "") {
	mkdirSync(join(root, "scripts"), { recursive: true });
	copyFileSync(join(import.meta.dir, "verify-plugin.ts"), join(root, "scripts/verify-plugin.ts"));
	const result = Bun.spawnSync([process.execPath, join(root, "scripts/verify-plugin.ts"), ...args], {
		cwd: root,
		env: { ...process.env, HOME: root, PATH: path },
		stdout: "pipe",
		stderr: "pipe",
	});
	return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

test("accepts matching skill metadata and resolved skill, leaf and playbook references", () => {
	const { root, put, skill } = fixture();
	put("skills/misty/SKILL.md", skill("misty", "Read [research](skill://research), `principle-proof` and [fix](playbooks/fix.md)."));
	put("skills/research/SKILL.md", skill("research"));
	put("skills/principle-proof/SKILL.md", skill("principle-proof"));
	put("skills/misty/playbooks/fix.md", "1. Read skill://research. Complete when the question is settled.\n");
	expect(lintPlugin(root, true)).toEqual({ skillCount: 3, errors: [], warnings: [] });
});

test("reports every missing metadata field and a mismatched directory name", () => {
	const { root, put } = fixture();
	put("skills/misty/SKILL.md", "---\nname: other\ndescription: ''\nmetadata: {}\n---\nBody.\n");
	expect(lintPlugin(root).errors).toEqual([
		"skills/misty/SKILL.md: name must equal directory misty",
		"skills/misty/SKILL.md: description must be non-empty",
		"skills/misty/SKILL.md: metadata.owner must be non-empty",
		"skills/misty/SKILL.md: metadata.prevents must be non-empty",
		"skills/misty/SKILL.md: metadata.source must be non-empty",
		"skills/misty/SKILL.md: metadata.sunset must be a non-empty string",
	]);
});

test.each(["2026-11-27", "2026-11-27 # YAML 1.1 timestamp", "2026-11-27T00:00:00Z", "!!timestamp 2026-11-27"])(
	"rejects a plain YAML date that Hermes cannot serialize (%s)",
	value => {
		const { root, put, skill } = fixture();
		put("skills/misty/SKILL.md", skill("misty").replace('sunset: "2026-11-27"', `sunset: ${value}`));
		expect(lintPlugin(root).errors).toEqual([
			"skills/misty/SKILL.md: quote YAML date values for JSON-compatible metadata",
		]);
	},
);

test.each(["42", "[2026, 11, 27]", "{year: 2026}", "false", "null"])(
	"requires metadata.sunset to parse as a non-empty string (%s)",
	value => {
		const { root, put, skill } = fixture();
		put("skills/misty/SKILL.md", skill("misty").replace('sunset: "2026-11-27"', `sunset: ${value}`));
		expect(lintPlugin(root).errors).toEqual([
			"skills/misty/SKILL.md: metadata.sunset must be a non-empty string",
		]);
	},
);

test("rejects invalid frontmatter rather than recovering a malformed skill", () => {
	const { root, put } = fixture();
	put("skills/misty/SKILL.md", "name: misty\n");
	expect(lintPlugin(root).errors).toEqual(["skills/misty/SKILL.md: missing YAML frontmatter"]);
});

test("requires a boolean alwaysApply core and at most twenty body lines", () => {
	const { root, put } = fixture();
	put("rules/core.md", `---\nalwaysApply: 'true'\n---\n${Array.from({ length: 21 }, (_, i) => `- Rule ${i}`).join("\n")}\n`);
	expect(lintPlugin(root).errors).toEqual([
		"rules/core.md: alwaysApply must be true",
		"rules/core.md: 21 body lines exceeds 20",
	]);
});

test("warns on dangling router and playbook references and makes them errors in strict mode", () => {
	const { root, put, skill } = fixture();
	put("skills/misty/SKILL.md", skill("misty", "Read [research](skill://research), `principle-proof` and [fix](playbooks/missing.md)."));
	put("skills/misty/playbooks/feature.md", "Read skill://misty/playbooks/missing-native.md and skill://research.\n");
	const warnings = lintPlugin(root).warnings;
	expect(warnings.map(warning => warning.slice(warning.indexOf("missing reference")))).toEqual([
		"missing reference skills/misty/playbooks/missing-native.md",
		"missing reference skills/misty/playbooks/missing.md",
		"missing reference skills/principle-proof/SKILL.md",
		"missing reference skills/research/SKILL.md",
	]);
	expect(lintPlugin(root).errors).toEqual([]);
	expect(lintPlugin(root, true)).toEqual({ skillCount: 1, errors: warnings, warnings: [] });
});

test("a missing router is an error even when another valid skill exists", () => {
	const { root, put, skill } = fixture();
	rmSync(join(root, "skills/misty/SKILL.md"));
	put("skills/research/SKILL.md", skill("research"));
	expect(lintPlugin(root).errors).toEqual(["skills/misty/SKILL.md: missing router"]);
});

test.each(["", "disable-model-invocation: false\n", "disable-model-invocation: 'true'\n"])(
	"requires boolean true to hide a principle leaf (%j)",
	invocation => {
		const { root, put, skill } = fixture();
		put("skills/principle-proof/SKILL.md", skill("principle-proof").replace("disable-model-invocation: true\n", invocation));
		expect(lintPlugin(root).errors).toEqual([
			"skills/principle-proof/SKILL.md: disable-model-invocation must be true",
		]);
	},
);

test("finds dangling skill references in leaves and other skills' supporting files", () => {
	const { root, put, skill } = fixture();
	put("skills/principle-proof/SKILL.md", skill("principle-proof", "Read skill://missing-leaf-target."));
	put("skills/research/SKILL.md", skill("research", "Read skill://missing-skill-target."));
	put("skills/research/sources.md", "Read [details](skill://missing-reference-target/details.md).\n");
	expect(lintPlugin(root, true).errors).toEqual([
		"skills/principle-proof/SKILL.md: missing reference skills/missing-leaf-target/SKILL.md",
		"skills/research/sources.md: missing reference skills/missing-reference-target/details.md",
		"skills/research/SKILL.md: missing reference skills/missing-skill-target/SKILL.md",
	]);
});

test("the plugin command fails when OMP is missing instead of skipping installation", () => {
	const { root } = fixture();
	const result = runPlugin(root, []);
	expect(result.code).toBe(1);
	expect(result.err).toContain("omp is required for plugin verification");
	expect(result.out).not.toContain("Verification complete");
});

test("strict lint failures exit nonzero before tests or installation", () => {
	const { root, put, skill } = fixture();
	put("skills/misty/SKILL.md", skill("misty", "Read skill://missing."));
	const result = runPlugin(root, ["--strict", "--lint-only"]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("missing reference skills/missing/SKILL.md");
	expect(result.out).toContain("1 errors");
	expect(result.out).not.toContain("Verification complete");
});

test("an escaping config path is refused before any install command", () => {
	const { root, put } = fixture();
	const trace = join(root, "omp-commands");
	const omp = join(root, "omp");
	put("omp", `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(trace)}\nprintf '%s\\n' ${JSON.stringify(join(root, "foreign-profile"))}\n`);
	chmodSync(omp, 0o700);
	expect(() => verifyInstall(root, omp, "fixture/model")).toThrow("isolation refused");
	expect(readFileSync(trace, "utf8")).toBe("config path\n");
});
