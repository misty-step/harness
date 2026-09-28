import type { Provider } from "@earendil-works/pi-ai";

/** Extra account slots: slot id → built-in provider it clones. */
export const SLOTS: Readonly<Record<string, string>> = {
	"openai-codex-2": "openai-codex",
	"openai-codex-3": "openai-codex",
	"openai-codex-4": "openai-codex",
};

/**
 * A provider identical to `base` except for its id and name. Pi resolves a
 * request's credential by `model.provider`, so models are re-tagged with the
 * slot id: an untagged model would silently spend the base account. Requests
 * are built as the base provider, because pi-ai keys protocol handling such as
 * Codex tool-call ids on the provider id; the credential is already resolved
 * by then. The slot lists the catalog bundled with the installed Pi release.
 */
export function cloneProvider(base: Provider, id: string): Provider {
	const suffix = id.slice(base.id.length + 1);
	const asBase = <M extends { provider: string }>(model: M): M => ({ ...model, provider: base.id });
	return {
		...base,
		id,
		name: `${base.name} (account ${suffix})`,
		getModels: () => base.getModels().map((model) => ({ ...model, provider: id })),
		refreshModels: undefined,
		stream: (model, context, options) => base.stream(asBase(model), context, options),
		streamSimple: (model, context, options) => base.streamSimple(asBase(model), context, options),
	};
}
