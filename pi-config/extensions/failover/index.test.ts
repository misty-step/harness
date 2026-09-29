import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerFailover from "./index.ts";

test("US-014 refuses unapproved prompts and summaries while preserving approved work and navigation", () => {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	registerFailover({ on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
		handlers[name] = handler;
	} } as unknown as ExtensionAPI);
	const notifications: string[] = [];
	const ctx = {
		hasUI: true,
		model: { provider: "openai-codex", id: "gpt-5.5" },
		ui: { notify(message: string) { notifications.push(message); } },
	};
	expect(handlers.input({ text: "Build the feature", source: "interactive" }, ctx)).toEqual({ action: "handled" });
	expect(handlers.session_before_compact({}, ctx)).toEqual({ cancel: true });
	expect(handlers.session_before_tree({ preparation: { userWantsSummary: true } }, ctx)).toEqual({ cancel: true });
	expect(handlers.session_before_tree({ preparation: { userWantsSummary: false } }, ctx)).toBeUndefined();
	// Operator decision 2026-09-28: Pi never touches Anthropic, directly or via OpenRouter.
	for (const model of [
		{ provider: "anthropic", id: "claude-sonnet-5-5" },
		{ provider: "anthropic", id: "claude-opus-5-5" },
		{ provider: "openrouter", id: "anthropic/claude-sonnet-4.5" },
		{ provider: "openrouter", id: "~anthropic/claude-opus-latest" },
	]) {
		ctx.model = model;
		expect(handlers.input({ text: "x", source: "interactive" }, ctx)).toEqual({ action: "handled" });
	}
	for (const model of [
		{ provider: "openai-pool", id: "gpt-6-astra" },
		{ provider: "xai-pool", id: "grok-4.7" },
		{ provider: "openrouter-pool", id: "~openai/gpt-astra-latest" },
		{ provider: "openai-codex", id: "gpt-6-astra" },
		{ provider: "xai", id: "grok-4.7" },
		{ provider: "openrouter", id: "~openai/gpt-astra-latest" },
	]) {
		ctx.model = model;
		expect(handlers.input({ text: "Build the feature", source: "interactive" }, ctx)).toBeUndefined();
		expect(handlers.session_before_compact({}, ctx)).toBeUndefined();
	}
	// US-045: a listed account slot runs its base's approved models; a custom
	// provider that merely looks like a slot stays refused.
	ctx.model = { provider: "openai-codex-2", id: "gpt-6-sol" };
	expect(handlers.input({ text: "Build the feature", source: "interactive" }, ctx)).toBeUndefined();
	ctx.model = { provider: "openai-codex-9", id: "gpt-6-sol" };
	expect(handlers.input({ text: "Build the feature", source: "interactive" }, ctx)).toEqual({ action: "handled" });
});
