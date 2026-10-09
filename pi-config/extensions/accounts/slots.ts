import type { Provider } from "@earendil-works/pi-ai";

/** Extra account slots: slot id → built-in provider it clones. */
export const SLOTS: Readonly<Record<string, string>> = {
	"openai-2": "openai",
	"openai-3": "openai",
	"openai-4": "openai",
	"openai-codex-2": "openai-codex",
	"openai-codex-3": "openai-codex",
	"openai-codex-4": "openai-codex",
	"xai-2": "xai",
	"openrouter-2": "openrouter",
};

/** Pool id → built-in provider whose accounts it balances. */
export const POOLS: Readonly<Record<string, string>> = {
	"openai-pool": "openai-codex",
	"xai-pool": "xai",
	"openrouter-pool": "openrouter",
};

/** The base provider then its slots: every account of a pool, in order. */
export function poolMembers(baseId: string): string[] {
	const bases = baseId === "openai-codex" ? ["openai", baseId] : [baseId];
	return bases.flatMap((base) => [base, ...Object.keys(SLOTS).filter((slot) => SLOTS[slot] === base)]);
}

/**
 * A provider identical to `base` except for its id and name. Pi resolves a
 * request's credential by `model.provider`, so models are re-tagged with the
 * slot id: an untagged model would silently spend the base account. Requests
 * are built as the base provider, because pi-ai keys protocol handling such as
 * Codex tool-call ids on the provider id; the credential is already resolved
 * by then. The slot lists the catalog bundled with the installed Pi release.
 * A slot resolves an API key only from its own stored credential, never the ambient
 * environment the base reads, so it cannot double-count the base account.
 */
export function cloneProvider(base: Provider, id: string): Provider {
	const suffix = id.slice(base.id.length + 1);
	const asBase = <M extends { provider: string }>(model: M): M => ({ ...model, provider: base.id });
	const apiKey = base.auth.apiKey;
	return {
		...base,
		id,
		name: `${base.name} (account ${suffix})`,
		auth: !apiKey ? base.auth : {
			...base.auth,
			apiKey: {
				...apiKey,
				resolve: async ({ credential }) => credential?.key
					? { auth: { apiKey: credential.key }, source: "stored key" }
					: undefined,
			},
		},
		getModels: () => base.getModels().map((model) => ({ ...model, provider: id })),
		refreshModels: undefined,
		stream: (model, context, options) => base.stream(asBase(model), context, options),
		streamSimple: (model, context, options) => base.streamSimple(asBase(model), context, options),
	};
}

/**
 * A provider whose every request goes to one of `members` (see rotate in
 * pool.ts). It carries no credential of its own: each member keeps its login.
 */
export function poolProvider(base: Provider, id: string, stream: Provider["stream"], streamSimple: Provider["streamSimple"]): Provider {
	return {
		id,
		name: `${base.name} (pool)`,
		auth: { apiKey: { name: "Account pool", resolve: async () => ({ auth: { apiKey: "pool" }, source: "account pool" }) } },
		getModels: () => base.getModels().map((model) => ({ ...model, provider: id })),
		stream,
		streamSimple,
	};
}
