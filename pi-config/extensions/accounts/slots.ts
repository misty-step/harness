import type { Provider } from "@earendil-works/pi-ai";

/** Extra account slots: slot id → built-in provider it clones. */
export const SLOTS: Readonly<Record<string, string>> = {
	"openai-codex-2": "openai-codex",
	"openai-codex-3": "openai-codex",
	"openai-codex-4": "openai-codex",
};

/**
 * A provider identical to `base` except for its id and name. Pi resolves a
 * request's credential by `model.provider`, so models are re-tagged on every
 * read: an untagged model would silently spend the base account. The base
 * provider alone refreshes the shared catalog.
 */
export function cloneProvider(base: Provider, id: string): Provider {
	const suffix = id.slice(base.id.length + 1);
	return {
		...base,
		id,
		name: `${base.name} (account ${suffix})`,
		getModels: () => base.getModels().map((model) => ({ ...model, provider: id })),
		refreshModels: undefined,
	};
}
