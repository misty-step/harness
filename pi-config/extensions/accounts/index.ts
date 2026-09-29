/**
 * accounts — several accounts per provider, balanced (ADR-024, ADR-026).
 *
 * Stock pi keys `auth.json` by provider id, so one provider holds one login.
 * Upstream declined core multi-account support and points at provider
 * extensions (earendil-works/pi#1391, #7814). Each slot in `SLOTS` is a clone
 * of a built-in provider under its own id (`openai-codex-2`, …) that reuses
 * the built-in login, refresh and streaming, so every slot gets its own
 * `/login` entry, its own `auth.json` key and pi's own locked refresh.
 *
 * Each pool in `POOLS` (`openai-pool`, …) is a provider over the base plus its
 * slots. A request goes to one account; when that account hits a usage limit
 * before producing output it is blocked until its reset and the request moves
 * to the next. Blocks and last use are shared by all Pi sessions in
 * `account-pool.json`. `/pool` lists the accounts and their state.
 *
 * Removing the extension removes the slots and pools and leaves the base
 * providers and their stored logins untouched (stock behavior).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileStore, rotate } from "./pool.ts";
import { POOLS, SLOTS, cloneProvider, poolMembers, poolProvider } from "./slots.ts";

export default function accounts(pi: ExtensionAPI) {
	const builtins = builtinProviders();
	const store = fileStore(join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "account-pool.json"));
	let session: ExtensionContext | undefined;
	pi.on("session_start", (_event, ctx) => { session = ctx; });

	const find = (id: string) => builtins.find((provider) => provider.id === id);
	// Fail closed per slot and pool: a renamed or removed base provider drops
	// its slots rather than registering a provider that cannot authenticate.
	for (const [id, baseId] of Object.entries(SLOTS)) {
		const base = find(baseId);
		if (base) pi.registerProvider(cloneProvider(base, id));
	}
	for (const [poolId, baseId] of Object.entries(POOLS)) {
		const base = find(baseId);
		if (!base) continue;
		const members = poolMembers(baseId);
		const sticky: { member?: string } = {};
		const through = (kind: "stream" | "streamSimple"): NonNullable<typeof base.stream> => (model, context, options) => rotate({
			poolId, members, store, model, out: createAssistantMessageEventStream(),
			start: (member) => {
				const target = session?.modelRegistry.find(member, model.id);
				return target && session?.modelRegistry.hasConfiguredAuth(target)
					// Drop the pool's placeholder key: a caller-supplied key would beat the member's login.
					? session.modelRegistry[kind](target, context, { ...options, apiKey: undefined } as never)
					: undefined;
			},
			onServe: (member) => session?.ui.setStatus("pool", member),
		}, sticky);
		pi.registerProvider(poolProvider(base, poolId, through("stream"), through("streamSimple") as never));
	}

	pi.registerCommand("pool", {
		description: "Show each pooled account, its login and any block",
		handler: async (_args, ctx) => {
			const state = store.read();
			const lines = Object.entries(POOLS).flatMap(([poolId, baseId]) => [
				poolId,
				...poolMembers(baseId).map((member) => {
					const until = state[member]?.blockedUntil ?? 0;
					const model = ctx.modelRegistry.getAll().find((m) => m.provider === member);
					const login = model && ctx.modelRegistry.hasConfiguredAuth(model) ? "signed in" : "no login";
					return `  ${member}: ${login}${until > Date.now() ? `, blocked until ${new Date(until).toLocaleString()}` : ""}`;
				}),
			]);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
