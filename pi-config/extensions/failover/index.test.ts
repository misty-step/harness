import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerFailover from "./index.ts";

test("US-014 rejects implicit paid startup selection before accepting a prompt", () => {
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
	ctx.model = { provider: "anthropic", id: "claude-sonnet-5-5" };
	expect(handlers.input({ text: "Build the feature", source: "interactive" }, ctx)).toBeUndefined();
	ctx.model = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(handlers.input({ text: "Review the design", source: "interactive" }, ctx)).toBeUndefined();
});
