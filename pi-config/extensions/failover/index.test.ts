import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerFailover from "./index.ts";

test("US-014 refuses paid prompts and summaries while preserving subscription work and navigation", () => {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	registerFailover({ on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
		handlers[name] = handler;
	} } as unknown as ExtensionAPI);
	const notifications: string[] = [];
	const ctx = {
		hasUI: true,
		model: { provider: "openrouter", id: "moonshotai/kimi-k2.6" },
		ui: { notify(message: string) { notifications.push(message); } },
	};
	expect(handlers.input({ text: "Build the feature", source: "interactive" }, ctx)).toEqual({ action: "handled" });
	expect(handlers.session_before_compact({}, ctx)).toEqual({ cancel: true });
	expect(handlers.session_before_tree({ preparation: { userWantsSummary: true } }, ctx)).toEqual({ cancel: true });
	expect(handlers.session_before_tree({ preparation: { userWantsSummary: false } }, ctx)).toBeUndefined();
	ctx.model = { provider: "anthropic", id: "claude-sonnet-5-5" };
	expect(handlers.input({ text: "Build the feature", source: "interactive" }, ctx)).toBeUndefined();
	expect(handlers.session_before_compact({}, ctx)).toBeUndefined();
	expect(handlers.session_before_tree({ preparation: { userWantsSummary: true } }, ctx)).toBeUndefined();
	ctx.model = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(handlers.input({ text: "Review the design", source: "interactive" }, ctx)).toBeUndefined();
	// US-045: an account slot follows its base model's policy, never widens it.
	ctx.model = { provider: "openai-codex-2", id: "gpt-6-sol" };
	expect(handlers.input({ text: "Build the feature", source: "interactive" }, ctx)).toBeUndefined();
	ctx.model = { provider: "openrouter-2", id: "moonshotai/kimi-k2.6" };
	expect(handlers.input({ text: "Build the feature", source: "interactive" }, ctx)).toEqual({ action: "handled" });
});
