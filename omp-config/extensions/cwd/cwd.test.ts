import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import registerCwdExtension, { formatCwdStatus, formatPath, refreshStatus } from "./index.ts";

describe("CWD path formatting", () => {
	test("formats parent/cwd for nested paths", () => {
		expect(formatPath("/home/user/development/misty-step/omp-config", "/home/user")).toBe(
			"misty-step/omp-config",
		);
		expect(formatPath("/a/b/c")).toBe("b/c");
		expect(formatPath("/a/b/c/")).toBe("b/c");
	});

	test("formats home directory as ~", () => {
		expect(formatPath("/home/user", "/home/user")).toBe("~");
		expect(formatPath("/home/user/", "/home/user")).toBe("~");
	});

	test("formats root directory as /", () => {
		expect(formatPath("/")).toBe("/");
	});

	test("formats single-level directory as folder name", () => {
		expect(formatPath("/opt")).toBe("opt");
	});

	test("formats status line with and without theme", () => {
		const raw = formatCwdStatus("/foo/bar/baz", undefined, "/home/user");
		expect(raw).toBe("\u2800 bar/baz");

		const mockTheme = {
			fg: (color: string, text: string) => `[fg:${color}]${text}[/fg]`,
			bold: (text: string) => `[b]${text}[/b]`,
		} as unknown as ExtensionContext["ui"]["theme"];

		const themed = formatCwdStatus("/foo/bar/baz", mockTheme, "/home/user");
		expect(themed).toBe("\u2800[fg:dim][/fg] [b]bar/baz[/b]");
	});
});

describe("CWD extension lifecycle", () => {
	test("updates status on session_start and turn_end, clears on session_shutdown", () => {
		const listeners = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
		const pi = {
			on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
				listeners.set(event, handler);
			},
		} as unknown as ExtensionAPI;

		registerCwdExtension(pi);

		expect(listeners.has("session_start")).toBe(true);
		expect(listeners.has("turn_end")).toBe(true);
		expect(listeners.has("session_shutdown")).toBe(true);

		const statuses = new Map<string, string | undefined>();
		const mockCtx = {
			hasUI: true,
			cwd: "/workspace/project/repo",
			ui: {
				setStatus: (key: string, value: string | undefined) => {
					statuses.set(key, value);
				},
				theme: {
					fg: (_color: string, text: string) => text,
					bold: (text: string) => text,
				},
			},
		} as unknown as ExtensionContext;

		listeners.get("session_start")?.({}, mockCtx);
		expect(statuses.get("cwd")).toBe("\u2800 project/repo");

		listeners.get("turn_end")?.({}, mockCtx);
		expect(statuses.get("cwd")).toBe("\u2800 project/repo");

		listeners.get("session_shutdown")?.({}, mockCtx);
		expect(statuses.get("cwd")).toBeUndefined();
	});

	test("skips status update when hasUI is false", () => {
		let called = false;
		const mockCtx = {
			hasUI: false,
			cwd: "/workspace/project/repo",
			ui: {
				setStatus: () => {
					called = true;
				},
			},
		} as unknown as ExtensionContext;

		refreshStatus(mockCtx);
		expect(called).toBe(false);
	});
});
