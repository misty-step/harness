import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { lintPlugin } from "./verify-plugin";

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
	const skill = (name: string, body = "Run the owned check.") => `---\nname: ${name}\ndescription: "When changing the consumer path."\nmetadata:\n  owner: phaedrus\n  prevents: "A recorded consumer failure."\n  source: "owner/repo@0123456789abcdef/source"\n  sunset: 2026-11-27\n---\n${body}\n`;
	put("skills/misty/SKILL.md", skill("misty"));
	put("rules/core.md", "---\nalwaysApply: true\n---\n# Core\n\n- Load misty.\n");
	return { root, put, skill };
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
		"skills/misty/SKILL.md: metadata.sunset must be non-empty",
	]);
});

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
