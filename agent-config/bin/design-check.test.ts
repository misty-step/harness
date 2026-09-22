import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFiles, scanContent, scanFile } from "./design-check.ts";

const script = join(import.meta.dir, "design-check.ts");
const scratch = mkdtempSync(join(tmpdir(), "design-check-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function fixture(name: string, content: string): string {
	const path = join(scratch, name);
	writeFileSync(path, content);
	return path;
}

describe("scanContent", () => {
	test("clean html yields no findings", () => {
		const findings = scanContent("page.html", `<p>Everyone writes one secret answer.</p>`);
		expect(findings).toEqual([]);
	});

	test("html text with an em dash is a dash finding", () => {
		const findings = scanContent("page.html", `<p>Kindred <em>lobby</em> \u2014 round up your friends.</p>`);
		expect(findings.length).toBe(1);
		expect(findings[0]?.rule).toBe("dash");
		expect(findings[0]?.line).toBe(1);
	});

	test("html script and style blocks are skipped", () => {
		const html = `<script>const x = "\u2014 cookie backend";</script>\n<style>.a{content:"\u2014"}</style>`;
		expect(scanContent("page.html", html)).toEqual([]);
	});

	test("html attributes are scanned", () => {
		const findings = scanContent("page.html", `<img alt="Our backend dashboard">`);
		expect(findings.some((f) => f.rule === "vocabulary" && f.match.toLowerCase() === "backend")).toBe(true);
	});

	test("lorem ipsum is a placeholder finding", () => {
		const findings = scanContent("page.html", `<p>lorem ipsum dolor sit amet</p>`);
		expect(findings.some((f) => f.rule === "placeholder")).toBe(true);
	});

	test("markdown fenced code and inline code are skipped", () => {
		const md = "Prose line.\n```\nconst a = \"\u2014 cookie\";\n```\nInline `\u2014 token` stays.\nTail: a real \u2014 dash.";
		const findings = scanContent("notes.md", md);
		expect(findings.map((f) => f.line)).toEqual([6]);
	});

	test("tsx imports and identifiers do not trip the vocabulary list", () => {
		const tsx = `import { cookies } from "next/headers";\nconst reader = cookies();\nexport const session = getSession();`;
		expect(scanContent("page.tsx", tsx)).toEqual([]);
	});

	test("tsx string literals and jsx text are scanned", () => {
		const tsx = `export default function Page() {\n	return <p>The judge is not configured on the backend. Ask the operator.</p>;\n}\nconst fallback = "Your cookie is missing";`;
		const findings = scanContent("page.tsx", tsx);
		expect(findings.filter((f) => f.rule === "vocabulary").length).toBeGreaterThanOrEqual(3);
	});

	test("multi-line jsx text is scanned (review probe 1)", () => {
		const tsx = "export default function Page() {\n	return (\n		<p>\n			Ask the operator — the backend is down.\n		</p>\n	);\n}";
		const findings = scanContent("page.tsx", tsx);
		expect(findings.some((f) => f.rule === "dash" && f.line === 4)).toBe(true);
		expect(findings.some((f) => f.rule === "vocabulary" && f.line === 4)).toBe(true);
	});

	test("jsx text around an interpolation is scanned (review probe 2)", () => {
		const tsx = "const greeting = (name: string) => (\n	<p>The operator {name} greets you — ok?</p>\n);";
		const findings = scanContent("page.tsx", tsx);
		expect(findings.some((f) => f.rule === "vocabulary" && f.line === 2)).toBe(true);
		expect(findings.some((f) => f.rule === "dash" && f.line === 2)).toBe(true);
	});

	test("raw block closing on one line keeps trailing copy", () => {
		const html = `<script>var x = "— cookie backend";</script><p>Ask the operator</p>`;
		const findings = scanContent("page.html", html);
		expect(findings.length).toBe(1);
		expect(findings[0]?.rule).toBe("vocabulary");
	});

	test("raw block spanning lines keeps later markup", () => {
		const html = "<style>\n.a { color: red }\n</style>\n<p>Round up — the operator</p>";
		const findings = scanContent("page.html", html);
		expect(findings.length).toBe(2);
		expect(findings.every((f) => f.line === 4)).toBe(true);
	});

	test("exported copy constant is scanned, not treated as a module path", () => {
		const ts = 'export const message = "Get help from the operator";';
		const findings = scanContent("messages.ts", ts);
		expect(findings.some((f) => f.rule === "vocabulary")).toBe(true);
	});

	test("module specifiers stay skipped, including multi-line imports", () => {
		const ts = 'import {\n	cookies,\n} from "next/headers";\nexport { getSession } from "@/lib/backend";\nconst x = cookies();';
		expect(scanContent("page.ts", ts)).toEqual([]);
	});

	test("comments are not copy", () => {
		const ts = '// TODO: ask the operator\n/* const s = "cookie monster"; */\nconst real = "Round up your friends";';
		expect(scanContent("page.ts", ts)).toEqual([]);
	});

	test("generics and comparisons do not leak copy state", () => {
		const tsx = 'const ref = useRef<HTMLDivElement>(null);\nif (count < limit && size > 0) {\n	const label = computeLabel();\n}\nconst copy = "Round up your friends";';
		expect(scanContent("page.tsx", tsx)).toEqual([]);
	});

	test("jsx inside expressions and arrow returns is scanned", () => {
		const tsx = 'const items = list.map((item) => (\n	<li key={item.id}>{item.name} — round up</li>\n));\nconst hint = cond ? <span>Ask the operator</span> : null;';
		const findings = scanContent("page.tsx", tsx);
		expect(findings.some((f) => f.rule === "dash" && f.line === 2)).toBe(true);
		expect(findings.some((f) => f.rule === "vocabulary" && f.line === 4)).toBe(true);
	});

	test("template interpolation code is not copy", () => {
		const ts = "const label = `Your token is ${token} — welcome`;";
		const findings = scanContent("page.ts", ts);
		expect(findings.filter((f) => f.rule === "vocabulary").length).toBe(1);
		expect(findings.some((f) => f.rule === "dash")).toBe(true);
	});

	test("multi-line template literal copy is attributed per line", () => {
		const ts = "const m = `Ask the operator\n  — the backend is down.`;";
		const findings = scanContent("page.ts", ts);
		expect(findings.some((f) => f.rule === "vocabulary" && f.line === 1)).toBe(true);
		expect(findings.some((f) => f.rule === "dash" && f.line === 2)).toBe(true);
	});

	test("attribute values in code files scan as strings", () => {
		const tsx = '<Img alt="Our backend dashboard" />';
		const findings = scanContent("page.tsx", tsx);
		expect(findings.some((f) => f.rule === "vocabulary")).toBe(true);
	});

	test("entity dash forms are dash findings", () => {
		const html = "<p>A &mdash; B</p>\n<p>C &#8212; D</p>\n<p>E &#x2014; F</p>\n<p>G &ndash; H</p>\n<p>I &#8211; J</p>\n<p>K &#x2013; L</p>";
		const findings = scanContent("page.html", html);
		expect(findings.length).toBe(6);
		expect(findings.every((f) => f.rule === "dash")).toBe(true);
		expect(findings.map((f) => f.match)).toEqual(["&mdash;", "&#8212;", "&#x2014;", "&ndash;", "&#8211;", "&#x2013;"]);
	});

	test("suppression comment silences one line", () => {
		const findings = scanContent("page.html", `<p>Cookie notice \u2014 details</p> <!-- design-check: ignore -->`);
		expect(findings).toEqual([]);
	});

	test("--terms style extra terms extend the list", () => {
		const findings = scanContent("page.html", `<p>The caboodle is missing.</p>`, ["caboodle"]);
		expect(findings.length).toBe(1);
		expect(findings[0]?.match.toLowerCase()).toBe("caboodle");
	});
});

describe("collectFiles", () => {
	test("walks directories, filters extensions, skips node_modules", () => {
		mkdirSync(join(scratch, "collect/node_modules"), { recursive: true });
		fixture("collect/page.tsx", "export default () => null;");
		fixture("collect/page.html", "<p>hi</p>");
		fixture("collect/notes.bin", "ignored");
		fixture("collect/node_modules/page.tsx", "<p>skipped</p>");
		const files = collectFiles([join(scratch, "collect")]);
		expect(files.some((f) => f.endsWith("collect/page.tsx"))).toBe(true);
		expect(files.some((f) => f.endsWith("collect/page.html"))).toBe(true);
		expect(files.some((f) => f.endsWith(".bin"))).toBe(false);
		expect(files.some((f) => f.includes("node_modules"))).toBe(false);
	});
});

describe("cli", () => {
	test("exits 1 on findings, 0 with --advisory, and reports json", () => {
		const dirty = join(scratch, "cli");
		mkdirSync(dirty, { recursive: true });
		writeFileSync(join(dirty, "index.html"), `<p>Ask the operator \u2014 the backend is down.</p>`);
		const failed = spawnSync("bun", [script, dirty], { encoding: "utf8" });
		expect(failed.status).toBe(1);
		expect(failed.stdout).toContain("[vocabulary]");
		expect(failed.stdout).toContain("[dash]");
		const advisory = spawnSync("bun", [script, "--advisory", dirty], { encoding: "utf8" });
		expect(advisory.status).toBe(0);
		const machine = spawnSync("bun", [script, "--json", dirty], { encoding: "utf8" });
		const parsed = JSON.parse(machine.stdout) as { files: number; findings: { rule: string }[] };
		expect(parsed.files).toBe(1);
		expect(parsed.findings.length).toBeGreaterThanOrEqual(2);
	});

	test("clean fixture exits 0", () => {
		const clean = join(scratch, "clean");
		mkdirSync(clean, { recursive: true });
		writeFileSync(join(clean, "index.html"), `<p>Everyone writes one secret answer.</p>`);
		const result = spawnSync("bun", [script, clean], { encoding: "utf8" });
		expect(result.status).toBe(0);
	});

	test("scanFile reads from disk", () => {
		const path = fixture("scan-file.html", `<p>a token lives here</p>`);
		expect(scanFile(path).length).toBe(1);
	});
});