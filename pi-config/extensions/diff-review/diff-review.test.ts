import { describe, expect, test } from "bun:test";
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
});
