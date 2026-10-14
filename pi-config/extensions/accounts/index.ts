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
 * `openai-pool` delegates raw inference to `omp auth-gateway stdio`: OMP owns
 * its existing Codex grants, selection and recovery; Pi executes its tools.
 * Native STDIO buffers all events until completion. Other pools retain Pi-local
 * account rotation and `account-pool.json`. `/pool` distinguishes these owners.
 *
 * Removing the extension removes the slots and pools and leaves the base
 * providers and their stored logins untouched (stock behavior).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, type Api, type Model, type Provider } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileStore, rotate } from "./pool.ts";
import { POOLS, SLOTS, cloneProvider, poolMembers, poolProvider, subscriptionTier } from "./slots.ts";
import { nativeInventory, nativeStream } from "./native.ts";
type ProviderStream = Provider["stream"];

export default function accounts(pi: ExtensionAPI) {
	const builtins = builtinProviders();
	const store = fileStore(join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "account-pool.json"));
	let session: ExtensionContext | undefined;
	pi.on("session_start", async (_event, ctx) => {
		session = ctx;
		// Startup sometimes resolves the settings default before extension
		// providers exist and lands on the best authenticated model, Anthropic.
		// Pi never uses Anthropic (ADR-025), so take the default from the pool.
		if (ctx.model && ctx.model.provider !== "anthropic") return;
		const model = ctx.modelRegistry.find("openai-pool", "gpt-6.1-sol");
		if (model) await pi.setModel(model);
	});

	const find = (id: string) => builtins.find((provider) => provider.id === id);
	const isUsingOAuth = (model: Model<Api>) =>
		session?.modelRegistry.isUsingOAuth(model) ?? false;
	for (const id of ["openai", "openai-codex"]) {
		const base = find(id);
		if (base) pi.registerProvider(subscriptionTier(base, isUsingOAuth));
	}
	// Fail closed per slot and pool: a renamed or removed base provider drops
	// its slots rather than registering a provider that cannot authenticate.
	for (const [id, baseId] of Object.entries(SLOTS)) {
		const base = find(baseId);
		if (base) pi.registerProvider(subscriptionTier(cloneProvider(base, id), isUsingOAuth));
	}
	for (const [poolId, baseId] of Object.entries(POOLS)) {
		const base = find(baseId);
		if (!base) continue;
		if (poolId === "openai-pool") {
			const through: ProviderStream = (model, context, options) => nativeStream({
				model,
				context: {
					systemPrompt: [getCurrentSystemPrompt(context.messages)],
					tools: getCurrentTools(context.messages),
					messages: context.messages.filter((message) => message.role !== "system"),
				},
				options,
				out: createAssistantMessageEventStream(),
				onServe: (message) => session?.ui.setStatus("pool", `OMP ${message.provider}/${message.model}; credential ${message.credentialId ?? "unreported"}; buffered`),
			});
			pi.registerProvider(poolProvider(base, poolId, through, through));
			continue;
		}
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
		description: "Show native OMP Codex inventory and Pi-local other pools",
		handler: async (_args, ctx) => {
			const state = store.read();
			let lines: string[];
			try { lines = await nativeInventory(); }
			catch (error) { lines = [`openai-pool: OMP native owner unavailable: ${error instanceof Error ? error.message : String(error)}`]; }
			lines.push(...Object.entries(POOLS).filter(([id]) => id !== "openai-pool").flatMap(([poolId, baseId]) => [
				`${poolId} (Pi-local)`,
				...poolMembers(baseId).map((member) => {
					const until = state[member]?.blockedUntil ?? 0;
					const model = ctx.modelRegistry.getAll().find((m) => m.provider === member);
					const login = model && ctx.modelRegistry.hasConfiguredAuth(model) ? "signed in" : "no login";
					return `  ${member}: ${login}${until > Date.now() ? `, blocked until ${new Date(until).toLocaleString()}` : ""}`;
				}),
			]));
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
