import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import registerDiffReviewExtension from "./index.ts";

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

	test("reviews and records in the session repository rather than the launcher directory", () => {
		const scratchBase = process.env.TMPDIR || join(homedir(), ".cache", "tmp");
		mkdirSync(scratchBase, { recursive: true });
		const fixture = mkdtempSync(join(scratchBase, "pi-diff-review-"));
		try {
			const git = (cwd: string, ...args: string[]) => {
				const result = spawnSync("git", args, { cwd, encoding: "utf8" });
				expect(result.status).toBe(0);
			};
			const launcher = join(fixture, "launcher");
			const reviewed = join(fixture, "reviewed");
			for (const repo of [launcher, reviewed]) {
				mkdirSync(repo);
				git(repo, "init", "-q");
				git(repo, "remote", "add", "origin", `https://github.com/misty-step/${repo === launcher ? "launcher" : "reviewed"}.git`);
				writeFileSync(join(repo, "source.ts"), "export const source = 'base';\n");
				git(repo, "add", "source.ts");
				git(repo, "-c", "core.hooksPath=/dev/null", "-c", "user.name=Fixture",
					"-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "base");
			}
			writeFileSync(join(launcher, "source.ts"), "export const source = 'launcher';\n");
			const bin = join(fixture, "bin");
			mkdirSync(bin);
			const log = join(fixture, "recorded.log");
			writeFileSync(join(bin, "outcome"), '#!/bin/sh\nprintf \'%s\\n\' "$PWD" "$*" > "$OUTCOME_CAPTURE_FILE"\n');
			chmodSync(join(bin, "outcome"), 0o755);
			const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH || ""}`, OUTCOME_CAPTURE_FILE: log };
			delete env.OPENROUTER_API_KEY;
			delete env.TYPESAFE_API_KEY;
			delete env.MOCK_SYSTEM_ONE;
			const script = `
				import { checkDiffReview } from ${JSON.stringify(join(import.meta.dir, "index.ts"))};
				const verdict = await checkDiffReview({ cwd: ${JSON.stringify(reviewed)}, hasUI: false });
				console.log(JSON.stringify(verdict));
			`;
			const clean = spawnSync(process.execPath, ["--eval", script], {
				cwd: launcher, env, encoding: "utf8", timeout: 30_000,
			});
			expect(clean.status).toBe(0);
			expect(JSON.parse(clean.stdout)).toBeNull();
			expect(existsSync(log)).toBe(false);

			writeFileSync(join(reviewed, "source.ts"), "export const source = 'reviewed';\n");
			const changed = spawnSync(process.execPath, ["--eval", script], {
				cwd: launcher, env, encoding: "utf8", timeout: 30_000,
			});
			expect(changed.status).toBe(0);
			expect(JSON.parse(changed.stdout)).toMatchObject({ enabled: false, stats: { filesChanged: 1 } });
			const [cwd, args] = readFileSync(log, "utf8").trim().split("\n");
			expect(cwd).toBe(reviewed);
			expect(args).toStartWith("record pi-diff-review --fail no-key --detail ");
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	}, 30_000);
});
