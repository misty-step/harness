import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..");
const canonical = "https://github.com/misty-step/harness/blob/master/";
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function markdown(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(dir, entry.name);
		return entry.isDirectory() ? markdown(path) : entry.name.endsWith(".md") ? [path] : [];
	});
}

// Focused contract for this repository's Markdown conventions, not a general
// Markdown parser or network crawler. Canonical master links resolve in this tree.
function errors(file: string, boundary = root, portable = false): string[] {
	const result: string[] = [];
	const text = readFileSync(file, "utf8").replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "");
	const targets = [
		...text.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g),
		...text.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm),
		...(portable ? text.matchAll(/`((?:\.\.\/)?(?:references|scripts|templates)\/[^`\s]+\.(?:md|sh|py|ts))`/g) : []),
	];
	for (const [, raw] of targets) {
		const target = decodeURIComponent(raw.split("#")[0]);
		if (!target) continue;
		let path: string, base = boundary;
		if (target.startsWith(canonical)) {
			base = root;
			path = resolve(root, target.slice(canonical.length));
		} else {
			if (/^[a-zA-Z][\w+.-]*:/.test(target)) continue;
			path = resolve(dirname(file), target);
		}
		const inside = (path: string) => {
			const name = relative(realpathSync(base), path);
			return name !== ".." && !name.startsWith(`..${sep}`) && !name.startsWith(sep);
		};
		if (!inside(path) || !existsSync(path) || !inside(realpathSync(path))) result.push(`${file}: ${raw}`);
	}
	return result;
}

function temp(): string {
	const dir = mkdtempSync(resolve(tmpdir(), "harness-references-"));
	scratch.push(dir);
	return dir;
}

test("tracked Markdown links resolve in the repository", () => {
	const files = Bun.spawnSync(["git", "ls-files", "-z", "*.md"], { cwd: root });
	expect(files.exitCode).toBe(0);
	expect(files.stdout.toString().split("\0").filter(Boolean).flatMap((file) => errors(resolve(root, file)))).toEqual([]);
});

test.each(["pi", "omp"])("US-021 / US-022 / US-023 / US-041: %s installs routed verification skills and the foundations", (consumer) => {
	const dir = temp();
	const home = resolve(dir, "home");
	const agent = resolve(home, "agent");
	mkdirSync(resolve(home, "development"), { recursive: true });
	const result = Bun.spawnSync([resolve(root, `${consumer}-config/install`)], {
		cwd: root,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: home,
			TMPDIR: dir,
			PI_CODING_AGENT_DIR: agent,
			OMP_DEVELOPMENT_ROOT: resolve(home, "development"),
			OMP_TODOIST_OWNER: resolve(home, "missing-todoist"),
		},
	});
	expect(result.exitCode).toBe(0);
	const audit = resolve(agent, "skills/test-audit");
	expect(readFileSync(resolve(audit, "SKILL.md"), "utf8")).toMatch(/^---\r?\nname: test-audit\r?\n/m);
	expect(existsSync(resolve(audit, "CAMPAIGN.md"))).toBe(true);
	expect(readFileSync(resolve(agent, "AGENTS.md"), "utf8")).toContain("skill://test-audit");
	for (const name of ["story-qa", "check-cadence"]) {
		expect(readFileSync(resolve(agent, `skills/${name}/SKILL.md`), "utf8")).toMatch(new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`));
		expect(readFileSync(resolve(agent, "AGENTS.md"), "utf8")).toContain(`skill://${name}`);
	}
	// OMP reads skill:// URIs; Pi cannot and hides this skill, so the plain path must resolve beside AGENTS.md too.
	const guidance = readFileSync(resolve(agent, "AGENTS.md"), "utf8");
	const [uri, path] = [/`skill:\/\/([^`\s]+\/constitution\.md)`/, /`([^`:\s]+\/constitution\.md)`/].map((pattern) => pattern.exec(guidance)?.[1] ?? "missing");
	expect(readFileSync(resolve(agent, "skills", uri), "utf8")).toMatch(/^# Foundations\r?\n/);
	expect(readFileSync(resolve(agent, path), "utf8")).toMatch(/^# Foundations\r?\n/);
	const failures = readdirSync(resolve(agent, "skills")).flatMap((name) => {
		const pkg = resolve(agent, "skills", name);
		return markdown(pkg).flatMap((file) => errors(file, pkg, true));
	});
	failures.push(...errors(resolve(agent, "AGENTS.md"), agent, true));
	expect(failures).toEqual([]);
});

test("guard rejects the original missing backtick reference, broken links, and package escapes", () => {
	const dir = temp();
	const pkg = resolve(dir, "skill"); mkdirSync(pkg);
	writeFileSync(resolve(dir, "outside.md"), "# Exists only in source\n");
	const file = resolve(pkg, "SKILL.md");
	for (const content of ["Read `references/dev-exec.md`.", "Read `scripts/missing.py`.", "Read `../scripts/missing.py`.", "[missing](references/absent.md)", "[outside](../outside.md)"]) {
		writeFileSync(file, content);
		expect(errors(file, pkg, true)).toHaveLength(1);
	}
	writeFileSync(resolve(pkg, "guide.md"), "# Guide\n");
	writeFileSync(file, "[local](guide.md)\n[canonical](https://github.com/misty-step/harness/blob/master/omp-config/references/dev-exec.md)\n[web](https://example.org/docs)\n");
	expect(errors(file, pkg, true)).toEqual([]);
});
