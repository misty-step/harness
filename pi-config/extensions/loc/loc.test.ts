import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeBuiltin, readLocCache, resolveLocCachePath } from "./analyze.ts";
import registerLocExtension, { triggerAsyncRefresh } from "./index.ts";

const roots: string[] = [];

function git(root: string, ...args: string[]): string {
	const result = Bun.spawnSync({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "omp-loc-test-"));
	roots.push(root);
	git(root, "init", "-q");
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src", "app.ts"), "const value = 1;\n// comment\n\n");
	writeFileSync(join(root, "README.md"), "# Fixture\n\nBody\n");
	writeFileSync(join(root, "ignored.png"), "not really an image\n");
	writeFileSync(join(root, "résumé.md"), "Non-ASCII path\n");
	git(root, "add", ".");
	git(root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture");
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LOC analysis", () => {
	test("counts the committed snapshot through one batch object reader", async () => {
		const root = fixture();
		writeFileSync(join(root, "src", "app.ts"), "dirty working tree content\n");

		const stats = await analyzeBuiltin(root);

		expect(stats).toMatchObject({
			files: 3,
			total: 10,
			code: 4,
			comment: 1,
			blank: 5,
			source: "builtin",
			headHash: git(root, "rev-parse", "HEAD"),
		});
		expect(stats.byLanguage).toMatchObject({
			Markdown: { files: 2, total: 6, code: 3, comment: 0, blank: 3 },
			TypeScript: { files: 1, total: 4, code: 1, comment: 1, blank: 2 },
		});
	});

	test("passive hooks stay cache-only while the explicit command can analyze", async () => {
		const root = fixture();
		const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const messages: unknown[] = [];
		registerLocExtension({
			registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) {
				commands.set(name, command);
			},
			on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(event, handler);
			},
			sendMessage(message: unknown) {
				messages.push(message);
			},
		} as never);
		const statuses: Array<string | undefined> = [];
		const ctx = {
			cwd: root,
			hasUI: true,
			ui: {
				setStatus(_key: string, value: string | undefined) {
					statuses.push(value);
				},
				notify(message: string) {
					throw new Error(message);
				},
				theme: {
					sep: { dot: "·" },
					fg(_role: string, text: string) {
						return text;
					},
					bold(text: string) {
						return text;
					},
					getLangIconStyled(language: string) {
						return language;
					},
				},
			},
		};

		await handlers.get("session_start")?.({}, ctx);
		expect(statuses).toEqual([undefined]);
		expect(messages).toHaveLength(0);

		await commands.get("loc")?.handler("", ctx);
		expect(messages).toHaveLength(1);
		expect(statuses.at(-1)).toContain("4 LOC");
		expect(readLocCache(root)).not.toBeNull();
	});

	test("in-process async worker populates cache and updates status", async () => {
		const root = fixture();
		const statuses: Array<string | undefined> = [];
		const ctx = {
			cwd: root,
			hasUI: true,
			ui: {
				setStatus(_key: string, value: string | undefined) {
					statuses.push(value);
				},
				theme: {
					sep: { dot: "·" },
					fg(_role: string, text: string) {
						return text;
					},
					bold(text: string) {
						return text;
					},
					getLangIconStyled(language: string) {
						return language;
					},
				},
			},
		};

		expect(readLocCache(root)).toBeNull();
		const promise = triggerAsyncRefresh(ctx as never);
		expect(promise).toBeDefined();
		await promise;

		expect(readLocCache(root)).not.toBeNull();
		expect(statuses.at(-1)).toContain("4 LOC");
	});

	test("resolveLocCachePath resolves to per-worktree gitdir in linked worktree", () => {
		const root = fixture();
		const wtDir = join(tmpdir(), `omp-loc-wt-${Date.now()}`);
		git(root, "worktree", "add", "-b", "wt-branch", wtDir);
		roots.push(wtDir);

		const cachePath = resolveLocCachePath(wtDir);
		expect(cachePath).not.toBeNull();
		expect(cachePath).toContain("worktrees");
		expect(cachePath?.endsWith("loc_cache")).toBe(true);
	});
});
