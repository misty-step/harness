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

function expectStrictWarnings(root: string, warnings: string[]) {
	const report = lintPlugin(root);
	expect(report.errors).toEqual([]);
	expect(report.warnings).toEqual(warnings.toSorted((a, b) => a.localeCompare(b)));
	expect(lintPlugin(root, true)).toEqual({ skillCount: report.skillCount, errors: report.warnings, warnings: [] });
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

test("accepts relative inline and reference links, supporting files and named skills", () => {
	const { root, put, skill } = fixture();
	put("skills/misty/SKILL.md", skill("misty", [
		"Read [research](../research/SKILL.md#start) and apply the `principle-proof` skill.",
		"Read the `research` skill and [fix](playbooks/fix.md?raw=1#repair).",
		"Keep the [notice][license], [settings][] and [notes].",
		"Open [angle](<playbooks/fix complete.md>) and [encoded](playbooks/fix%20complete.md?raw=1#done).",
		"Open [parentheses](playbooks/fix(complete).md) and [root notice](../../LICENSE).",
		"",
		'[license]: ../research/LICENSE "MIT notice"',
		"[settings]: ../research/settings.json",
		"[notes]: playbooks/fix.md",
	].join("\n")));
	put("skills/research/SKILL.md", skill("research"));
	put("skills/principle-proof/SKILL.md", skill("principle-proof"));
	put("skills/research/LICENSE", "MIT notice.\n");
	put("skills/research/settings.json", "{}\n");
	put("skills/misty/playbooks/fix.md", "Read [research](../../research/SKILL.md).\n");
	put("skills/misty/playbooks/fix complete.md", "Completed fix.\n");
	put("skills/misty/playbooks/fix(complete).md", "Completed fix.\n");
	put("LICENSE", "Repository notice.\n");
	put("rules/core.md", "---\nalwaysApply: true\n---\nRead [router](../skills/misty/SKILL.md#misty).\n");
	expect(lintPlugin(root, true)).toEqual({ skillCount: 3, errors: [], warnings: [] });
});

test("does not treat illustrative Markdown, external links or same-file anchors as missing files", () => {
	const { root, put, skill } = fixture();
	put("skills/misty/SKILL.md", skill("misty", [
		"[web](https://example.com/missing.md), [mail](mailto:agent@example.com), [host](//example.com/missing.md).",
		"[absolute](/missing.md), [anchor](#missing), [query](?raw=1#missing) and [empty]().",
		"Inline examples: `[missing](missing-inline.md)` and ``the `unknown` skill``.",
		"Escaped example: \\[missing](missing-escaped.md).",
		"",
		"~~~markdown",
		"[missing](missing-fenced.md)",
		"[guide][reference]",
		"[reference]: missing-reference.md",
		"Use the `unknown` skill.",
		"~~~",
		"",
		"    [missing](missing-indented.md)",
		"",
		"> ```markdown",
		"> [missing](missing-quoted.md)",
		"> ```",
	].join("\n")));
	expect(lintPlugin(root, true)).toEqual({ skillCount: 1, errors: [], warnings: [] });
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

test.each([
	"skills/misty/SKILL.md",
	"skills/misty/playbooks/feature.md",
	"skills/principle-proof/SKILL.md",
	"rules/review.md",
])("warns on missing relative targets in %s and rejects them in strict mode", file => {
	const { root, put, skill } = fixture();
	const body = "Read [missing](missing.json?raw=1#proof).";
	put(file, file.endsWith("/SKILL.md") ? skill(file.split("/")[1], body) : body);
	expectStrictWarnings(root, [`${file}: missing reference ${join(dirname(file), "missing.json")}`]);
});

test("requires link targets to be files rather than existing directories", () => {
	const { root, put, skill } = fixture();
	put("skills/misty/SKILL.md", skill("misty", "Read [directory](playbooks/)."));
	put("skills/misty/playbooks/present.md", "Present file.\n");
	expectStrictWarnings(root, ["skills/misty/SKILL.md: missing reference skills/misty/playbooks"]);
});

test.each([
	["full", "Read [details][guide].\n\n[guide]: missing.md"],
	["collapsed", 'Read [guide][].\n\n[guide]: <missing.md> "Guide"'],
	["shortcut", "Read [guide].\n\n[guide]: missing.md"],
])("validates dangling %s reference-style Markdown links", (_style, body) => {
	const { root, put, skill } = fixture();
	put("skills/misty/SKILL.md", skill("misty", body));
	expectStrictWarnings(root, ["skills/misty/SKILL.md: missing reference skills/misty/missing.md"]);
});

test("reports malformed encoded reference destinations without crashing", () => {
	const { root, put, skill } = fixture();
	put("skills/misty/SKILL.md", skill("misty", "Read [details][guide].\n\n[guide]: notes%ZZ.md"));
	expectStrictWarnings(root, ["skills/misty/SKILL.md: invalid relative link notes%ZZ.md (malformed percent encoding)"]);
});

test.each([
	"skills/misty/SKILL.md",
	"skills/misty/playbooks/feature.md",
	"skills/principle-proof/SKILL.md",
	"rules/review.md",
])("validates named-skill phrases in %s with strict warning promotion", file => {
	const { root, put, skill } = fixture();
	const body = "Use the `missing` skill.";
	put(file, file.endsWith("/SKILL.md") ? skill(file.split("/")[1], body) : body);
	expectStrictWarnings(root, [`${file}: unknown skill missing (missing skills/missing/SKILL.md)`]);
});

test("validates skill names in generated brief source outside Markdown", () => {
	const { root, put } = fixture();
	put("skills/misty/brief.ts", 'export const brief = "Read the `missing` skill.";\n');
	expectStrictWarnings(root, ["skills/misty/brief.ts: unknown skill missing (missing skills/missing/SKILL.md)"]);
});

test("a named skill needs SKILL.md, not just a directory with supporting files", () => {
	const { root, put, skill } = fixture();
	put("skills/misty/SKILL.md", skill("misty", "Use the `empty` skill."));
	put("skills/empty/notes.md", "Not a skill entrypoint.\n");
	expectStrictWarnings(root, ["skills/misty/SKILL.md: unknown skill empty (missing skills/empty/SKILL.md)"]);
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

test.each([
	["skills/misty/SKILL.md", "skill://"],
	["skills/misty/playbooks/feature.md", "xd://"],
	["skills/release-watch/ship-loop.ts", "skill://"],
	["skills/release-watch/ship-loop.test.ts", "xd://"],
	["skills/setup-mistystack/SKILL.md", "skill://"],
	["rules/core.md", "xd://"],
	["rules/helper.ts", "skill://"],
	["skills/misty/harnesses-other/notes.md", "xd://"],
])("rejects literal harness URI in %s (%s) only in strict mode", (file, scheme) => {
	const { root, put, skill } = fixture();
	const body = file.endsWith(".ts") ? `export const target = ${JSON.stringify(`${scheme}example`)};\n` : `\`\`\`text\n${scheme}example\n\`\`\`\n`;
	put(file, file.endsWith("/SKILL.md") ? skill(file.split("/")[1], body) : file === "rules/core.md" ? `---\nalwaysApply: true\n---\n${body}` : body);
	expectStrictWarnings(root, [`${file}: harness-specific URI ${scheme} is only allowed in skills/misty/harnesses/`]);
});

test("allows both harness URI schemes only inside the disclosed harness directory", () => {
	const { root, put } = fixture();
	put("skills/misty/harnesses/omp.md", "Read [native](skill://misty), use `xd://lsp`, then return to [router](../SKILL.md).\n");
	put("skills/misty/harnesses/example.ts", 'export const targets = ["skill://misty", "xd://lsp"];\n');
	expect(lintPlugin(root, true)).toEqual({ skillCount: 1, errors: [], warnings: [] });
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
	put("skills/misty/SKILL.md", skill("misty", "Read [missing](missing.md)."));
	const result = runPlugin(root, ["--strict", "--lint-only"]);
	expect(result.code).toBe(1);
	expect(result.err).toContain("missing reference skills/misty/missing.md");
	expect(result.out).toContain("1 errors");
	expect(result.out).not.toContain("Verification complete");
});

test("plugin help explains strict lint without requiring OMP", () => {
	const { root } = fixture();
	const result = runPlugin(root, ["--help"]);
	expect(result.code).toBe(0);
	expect(result.out).toContain("--strict fails on broken relative Markdown links, unknown skill names and harness-specific URIs");
	expect(result.out).toContain("outside skills/misty/harnesses/");
	expect(result.out).toContain("--lint-only skips installation");
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
