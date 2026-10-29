import { afterEach, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { lintPlugin, verifyAvailableInstalls, verifyInstall, verifyNativeInstall } from "./verify-plugin";

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
	const json = (path: string, value: unknown) => put(path, `${JSON.stringify(value)}\n`);
	const hooks = (variable: string) => ({ SessionStart: [{ hooks: [{ type: "command", command: `cat "$${variable}/rules/core.md"` }] }] });
	const marketplace = { name: "mistystack", owner: { name: "Fixture owner" }, plugins: [{ name: "mistystack", source: "./" }] };
	json(".claude-plugin/plugin.json", { name: "mistystack", agents: ["./adapters/claude/agents/fixture.md"], hooks: hooks("CLAUDE_PLUGIN_ROOT") });
	json(".claude-plugin/marketplace.json", marketplace);
	json(".codex-plugin/plugin.json", { name: "mistystack", version: "1.0.0", skills: "./skills/", hooks: "./adapters/codex/hooks.json" });
	json(".agents/plugins/marketplace.json", {
		name: "mistystack",
		plugins: [{ name: "mistystack", source: { source: "local", path: "./" }, policy: { installation: "AVAILABLE", authentication: "ON_USE" }, category: "Productivity" }],
	});
	json("adapters/codex/hooks.json", { hooks: hooks("PLUGIN_ROOT") });
	json(".omp-plugin/plugin.json", { name: "mistystack", version: "1.0.0", skills: "./skills" });
	json(".omp-plugin/marketplace.json", marketplace);
	json("package.json", { name: "mistystack", version: "1.0.0", keywords: ["pi-package"], omp: {}, pi: { skills: ["./skills"], extensions: ["./adapters/pi/core.ts"] } });
	put("adapters/claude/agents/fixture.md", "---\nname: fixture\ndescription: Fixture worker.\n---\nComplete the assigned task.\n");
	put("agents/fixture.md", "---\nname: fixture\ndescription: Fixture worker.\n---\nComplete the assigned task.\n");
	put("adapters/pi/core.ts", 'import { readFileSync } from "node:fs";\nexport default function core(pi) {\nconst core = readFileSync(new URL("../../rules/core.md", import.meta.url), "utf8");\npi.on("before_agent_start", event => ({ systemPrompt: `${event.systemPrompt}\\n${core}` }));\n}\n');
	return { root, put, skill, json };
}

test.each([
	".claude-plugin/plugin.json", ".claude-plugin/marketplace.json",
	".codex-plugin/plugin.json", ".agents/plugins/marketplace.json",
	".omp-plugin/plugin.json", ".omp-plugin/marketplace.json", "package.json",
])("requires a JSON object at native manifest %s", file => {
	const { root, put } = fixture();
	put(file, "{");
	expect(lintPlugin(root).errors.some(error => error.startsWith(`${file}:`))).toBe(true);
	put(file, "[]\n");
	expect(lintPlugin(root).errors).toContain(`${file}: must be a JSON object`);
	rmSync(join(root, file));
	expect(lintPlugin(root).errors).toContain(`${file}: missing manifest`);
});

test.each([
	[".claude-plugin/plugin.json", "name must be non-empty"],
	[".codex-plugin/plugin.json", "version must be non-empty"],
	[".omp-plugin/plugin.json", "version must be non-empty"],
	[".claude-plugin/marketplace.json", "owner.name must be non-empty"],
	[".agents/plugins/marketplace.json", "plugins must be a non-empty array"],
	[".omp-plugin/marketplace.json", "plugins must be a non-empty array"],
	["package.json", "keywords must include pi-package"],
])("checks required native manifest fields in %s", (file, error) => {
	const { root, json } = fixture();
	json(file, {});
	expect(lintPlugin(root).errors).toContain(`${file}: ${error}`);
});

test.each([".claude-plugin/plugin.json", ".codex-plugin/plugin.json", ".omp-plugin/plugin.json", "package.json"])(
	"rejects a second skills tree registered by %s",
	file => {
		const { root, put, skill, json } = fixture();
		put("other-skills/misty/SKILL.md", skill("misty"));
		const manifest = JSON.parse(readFileSync(join(root, file), "utf8"));
		if (file === "package.json") manifest.pi.skills = ["./other-skills"];
		else manifest.skills = "./other-skills";
		json(file, manifest);
		expect(lintPlugin(root).errors).toContain(`${file}: skills must reference the shared root skills/`);
	},
);

test.each([
	"adapters/claude/agents/fixture.md",
	"adapters/codex/hooks.json", "adapters/pi/core.ts",
])("rejects a missing declared native component %s", file => {
	const { root } = fixture();
	rmSync(join(root, file));
	expect(lintPlugin(root).errors.some(error => error.includes(`missing file ./${file}`))).toBe(true);
});

test("requires OMP's native root agents rather than an ignored manifest agents field", () => {
	const { root, json } = fixture();
	rmSync(join(root, "agents/fixture.md"));
	expect(lintPlugin(root).errors).toContain("agents/: no native OMP agents found");
	const manifest = JSON.parse(readFileSync(join(root, ".omp-plugin/plugin.json"), "utf8"));
	manifest.agents = ["./adapters/omp/agents/fixture.md"];
	json(".omp-plugin/plugin.json", manifest);
	expect(lintPlugin(root).errors).toContain(".omp-plugin/plugin.json: OMP discovers root agents/; manifest agents is unsupported");
});

test("an explicit OMP package manifest prevents fallback to pi's core extension", () => {
	const { root, json } = fixture();
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	delete manifest.omp;
	json("package.json", manifest);
	expect(lintPlugin(root).errors).toContain("package.json: omp must be an explicit object to prevent pi adapter fallback");
	manifest.omp = { extensions: ["./adapters/pi/core.ts"] };
	json("package.json", manifest);
	expect(lintPlugin(root).errors).toContain("package.json: omp.extensions must not register pi's core extension");
});

test("Claude defaults to root skills only when the skills field is omitted", () => {
	const { root, json } = fixture();
	expect(lintPlugin(root).errors).toEqual([]);
	const manifest = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8"));
	manifest.skills = null;
	json(".claude-plugin/plugin.json", manifest);
	expect(lintPlugin(root).errors).toContain(".claude-plugin/plugin.json: skills must reference the shared root skills/");
});

test.each(["claude", "codex"])("requires the %s SessionStart core registration", harness => {
	const { root, json } = fixture();
	const file = `.${harness}-plugin/plugin.json`;
	if (harness === "claude") {
		const manifest = JSON.parse(readFileSync(join(root, file), "utf8"));
		manifest.hooks = {};
		json(file, manifest);
	} else json("adapters/codex/hooks.json", { hooks: {} });
	expect(lintPlugin(root).errors.some(error => error.startsWith(`${file}: SessionStart must register`))).toBe(true);
});

test("requires the core extension, not just any existing pi extension", () => {
	const { root, put, json } = fixture();
	put("adapters/pi/unrelated.ts", "export const unrelated = true;\n");
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	manifest.pi.extensions = ["./adapters/pi/unrelated.ts"];
	json("package.json", manifest);
	expect(lintPlugin(root).errors).toContain("package.json: pi.extensions must register adapters/pi/core.ts");
});

test("rejects native paths escaping the plugin, including symlinks", () => {
	const { root, json } = fixture();
	const foreign = fixture().root;
	const file = ".claude-plugin/plugin.json";
	const manifest = JSON.parse(readFileSync(join(root, file), "utf8"));
	manifest.agents = ["../outside.md"];
	json(file, manifest);
	expect(lintPlugin(root).errors).toContain(`${file}: agents: path must stay inside the plugin: ../outside.md`);
	symlinkSync(join(foreign, "skills/misty/SKILL.md"), join(root, "adapters/claude/agents/escape.md"));
	manifest.agents = ["./adapters/claude/agents/escape.md"];
	json(file, manifest);
	expect(lintPlugin(root).errors).toContain(`${file}: agents: path must stay inside the plugin: ./adapters/claude/agents/escape.md`);
});

test("Codex marketplace policy and local source are required, not just its plugin name", () => {
	const { root, json } = fixture();
	json(".agents/plugins/marketplace.json", { name: "mistystack", plugins: [{ name: "mistystack", source: "./" }] });
	const errors = lintPlugin(root).errors;
	expect(errors).toContain(".agents/plugins/marketplace.json: plugin source must be local");
	expect(errors).toContain(".agents/plugins/marketplace.json: plugin policy must use installation AVAILABLE and authentication ON_USE");
});

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
		"Inline examples: `[missing](missing-inline.md)` and ``the `misty` skill``.",
		"Escaped example: \\[missing](missing-escaped.md).",
		"",
		"~~~markdown",
		"[missing](missing-fenced.md)",
		"[guide][reference]",
		"[reference]: missing-reference.md",
		"Use the `misty` skill.",
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

test.each([
	"``Use the `missing` skill.``",
	"```text\nUse the `missing` skill.\n```",
])("validates named skills even inside quoted instructions (%s)", body => {
	const { root, put, skill } = fixture();
	put("skills/misty/SKILL.md", skill("misty", body));
	expectStrictWarnings(root, ["skills/misty/SKILL.md: unknown skill missing (missing skills/missing/SKILL.md)"]);
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

test("missing native CLIs are explicit skips, not successful install proofs", async () => {
	const { root } = fixture();
	const results = await verifyAvailableInstalls(root, undefined, {});
	expect(results.map(result => result.harness)).toEqual(["claude", "codex", "omp", "pi"]);
	expect(results.every(result => result.status === "SKIP")).toBe(true);
	expect(results.some(result => result.status === "PASS")).toBe(false);
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

test.each(["claude", "codex", "pi"] as const)("refuses leaked %s state before installing and removes its scratch home", async harness => {
	const { root, put } = fixture();
	const trace = join(root, "native-commands");
	const state = join(root, "native-state");
	const executable = join(root, harness);
	const response = harness === "claude" ? '[{"id":"foreign","enabled":true}]' : JSON.stringify({ id: 1, result: { codexHome: root } });
	const leak = harness === "pi" ?
		`printf '%s\\n' '{"packages":["foreign-package"]}' > "$PI_CODING_AGENT_DIR/settings.json"\nprintf 'Foreign package\\n'` :
		`${harness === "codex" ? 'IFS= read -r request\n' : ""}printf '%s\\n' ${JSON.stringify(response)}`;
	put(harness, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(trace)}\nprintf '%s\\n' "$HOME" "$CLAUDE_CONFIG_DIR" "$CODEX_HOME" "$PI_CODING_AGENT_DIR" > ${JSON.stringify(state)}\n${leak}\n`);
	chmodSync(executable, 0o700);
	await expect(verifyNativeInstall(root, harness, executable)).rejects.toThrow("isolation refused");
	expect(readFileSync(trace, "utf8")).toBe(harness === "pi" ? "list --no-approve\n" : harness === "codex" ? "app-server --listen stdio://\n" : "plugin list --json\n");
	const [home, ...configs] = readFileSync(state, "utf8").trim().split("\n");
	expect(home).not.toBe(process.env.HOME);
	for (const config of configs) expect(config.startsWith(`${home}/`)).toBe(true);
	expect(existsSync(home)).toBe(false);
});
