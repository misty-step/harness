import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerDiffReviewExtension, { checkDiffReview } from "./index.ts";

describe("Pi Diff Review Extension Lifecycle", () => {
	test("registers command and event hooks", () => {
		const commands = new Map<string, unknown>();
		const listeners = new Map<string, unknown>();

		const pi = {
			registerCommand: (name: string, def: unknown) => {
				commands.set(name, def);
			},
			on: (event: string, handler: unknown) => {
				listeners.set(event, handler);
			},
			sendMessage: () => {},
		} as unknown as ExtensionAPI;

		registerDiffReviewExtension(pi);

		expect(commands.has("diff-review")).toBe(true);
		expect(listeners.has("turn_end")).toBe(true);
		expect(listeners.has("session_shutdown")).toBe(true);
	});

	test("clears status on session_shutdown", () => {
		const listeners = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
		const pi = {
			registerCommand: () => {},
			on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
				listeners.set(event, handler);
			},
		} as unknown as ExtensionAPI;

		registerDiffReviewExtension(pi);

		const statuses = new Map<string, string | undefined>();
		const mockCtx = {
			hasUI: true,
			cwd: process.cwd(),
			ui: {
				setStatus: (key: string, value: string | undefined) => {
					statuses.set(key, value);
				},
			},
		} as unknown as ExtensionContext;

		listeners.get("session_shutdown")?.({}, mockCtx);
		expect(statuses.get("diff-review")).toBeUndefined();
	});

	test("shows manual-review status instead of judging an oversized working diff", async () => {
		const previousCwd = process.cwd();
		const previousMock = process.env.MOCK_SYSTEM_ONE;
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		const dir = mkdtempSync(join(tmpdir(), "pi-diff-review-"));
		const agentDir = mkdtempSync(join(tmpdir(), "pi-review-log-"));
		const statuses: string[] = [];
		const ctx = {
			hasUI: true,
			ui: {
				setStatus: (_key: string, status: string | undefined) => statuses.push(status ?? ""),
				notify: () => {},
			},
		} as unknown as ExtensionContext;
		try {
			spawnSync("git", ["init", "-q", dir], { stdio: "pipe" });
			spawnSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "initial"], { stdio: "pipe" });
			process.chdir(dir);
			process.env.MOCK_SYSTEM_ONE = "1";
			process.env.PI_CODING_AGENT_DIR = agentDir;
			writeFileSync(join(dir, "change.ts"), `export const data = "${"x".repeat(21_000)}";\n`);
			const headlessWarnings: string[] = [];
			const previousError = console.error;
			console.error = (message: unknown) => { headlessWarnings.push(String(message)); };
			try {
				const headless = { ...ctx, hasUI: false } as ExtensionContext;
				expect(await checkDiffReview(headless)).toBeNull();
				expect(await checkDiffReview(headless)).toBeNull();
			} finally {
				console.error = previousError;
			}
			expect(headlessWarnings).toEqual(["diff-review: manual review required; run /diff-review to cover the full working diff"]);
			expect(await checkDiffReview(ctx)).toBeNull();
			expect(statuses.at(-1)).toBe("diff: manual review required");
			writeFileSync(join(dir, "change.ts"), "export const data = 1;\n");
			expect(await checkDiffReview(ctx)).not.toBeNull();
			expect(statuses.at(-1)).not.toBe("diff: manual review required");
		} finally {
			process.chdir(previousCwd);
			if (previousMock === undefined) delete process.env.MOCK_SYSTEM_ONE;
			else process.env.MOCK_SYSTEM_ONE = previousMock;
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			rmSync(dir, { recursive: true, force: true });
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
