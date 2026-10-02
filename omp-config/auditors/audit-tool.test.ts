import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import register from "./audit-tool.ts";

// Any zod call chain; the schema itself is OMP's concern, not this extension's.
const zod: unknown = new Proxy(() => zod, { get: () => zod, apply: () => zod });

function load(env: Record<string, string | undefined>) {
	const saved = { ...process.env };
	Object.assign(process.env, env);
	for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key];
	const handlers: Record<string, (event: { toolName: string }) => unknown> = {};
	const tools: Record<string, { execute: (...args: unknown[]) => Promise<{ content: { text: string }[] }> }> = {};
	try {
		register({
			zod,
			on: (event: string, handler: (event: { toolName: string }) => unknown) => { handlers[event] = handler; },
			registerTool: (tool: { name: string }) => { tools[tool.name] = tool as never; },
		} as never);
	} finally {
		process.env = saved;
	}
	return { guard: handlers.tool_call, tools };
}

test("auditors can read and file, and every other tool is refused", () => {
	const { guard, tools } = load({ OMP_AUDIT_CONTEXT: "/run/context.json" });
	for (const tool of ["bash", "edit", "write", "task", "browser", "python", "ask"]) {
		expect(guard({ toolName: tool })).toEqual({ block: true, reason: expect.stringContaining("read-only") });
	}
	for (const tool of ["read", "grep", "glob", "audit_file"]) expect(guard({ toolName: tool })).toBeUndefined();
	expect(Object.keys(tools)).toEqual(["audit_file"]);
});

test("outside an audit run the guard still holds and nothing can be filed", () => {
	const { guard, tools } = load({ OMP_AUDIT_CONTEXT: undefined });
	expect(guard({ toolName: "bash" })).toMatchObject({ block: true });
	expect(Object.keys(tools)).toEqual([]);
});

test("a filing reaches the filer as JSON on stdin with fixed argv", async () => {
	const scratch = resolve(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true });
	const dir = mkdtempSync(resolve(scratch, "audit-tool-"));
	try {
		const filer = resolve(dir, "filer.py");
		writeFileSync(filer, "import json, sys\nprint(json.dumps({'argv': sys.argv[1:], 'request': json.load(sys.stdin)}))\n");
		const { tools } = load({ OMP_AUDIT_CONTEXT: `${dir}/context.json; rm -rf /`, OMP_AUDIT_FILER: filer });
		const request = { action: "file", gap: "sentry", area: "F2", title: "x: $(reboot)", body: "evidence `rm -rf`", priority: "high" };
		const result = await tools.audit_file.execute("id", request);
		const seen = JSON.parse(result.content[0].text);
		expect(seen.argv).toEqual(["file", "--context", `${dir}/context.json; rm -rf /`]);
		expect(seen.request).toEqual(request);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
