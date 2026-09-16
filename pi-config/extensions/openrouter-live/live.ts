/**
 * Pure core for extensions/openrouter-live.
 *
 * pi's OpenRouter catalogue is not the OpenRouter catalogue: pi refreshes a
 * pi.dev mirror (every 4 h, ETag-validated) and merges its entries over its
 * built-in baseline. A brand-new OpenRouter model is therefore invisible to
 * pi until the mirror crawl catches up — omp, which queries
 * openrouter.ai directly, lists it in minutes while pi can lag by hours.
 *
 * This module is the bridge: it maps the live OpenRouter public API
 * (key-free) into the exact entry shape pi's mirror serves, keeps only the
 * models pi's own catalogue exposes (tool-capable), and computes which of
 * them pi does not know yet. `index.ts` owns the fetch, the models.json
 * write, and the UI; everything in here is pure and bun-tested, so the
 * decision layer never touches the network or the filesystem.
 *
 * Pokayoke rules baked in (incident: OpenRouter model 091, 2026-09-16):
 *  - fail closed on an implausibly small live catalog — the earlier
 *    standalone script twice re-added every built-in model when a
 *    `pi --list-models` capture came back empty; here the known set comes
 *    from the in-process registry, but a broken LIST response would cause
 *    the same disaster in the other direction (mass-add), so an abnormal
 *    size is a refusal, not a merge input.
 *  - additive merge only: existing entries are never rewritten, so a bad
 *    mapping can add noise but cannot clobber pi's curated metadata.
 */

/** One model as openrouter.ai/api/v1/models reports it (fields pi uses). */
export interface OpenRouterModel {
	id?: string;
	name?: string;
	/** Model-level context length; superseded by top_provider when present. */
	context_length?: number;
	pricing?: {
		prompt?: string | number;
		completion?: string | number;
		input_cache_read?: string | number;
		input_cache_write?: string | number;
	} | null;
	architecture?: { input_modalities?: string[] } | null;
	supported_parameters?: string[] | null;
	top_provider?: {
		context_length?: number | null;
		max_completion_tokens?: number | null;
	} | null;
}

/** One model as it belongs in ~/.pi/agent/models.json (providers.openrouter). */
export interface LiveModelEntry {
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	input: string[];
	reasoning: boolean;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
}

/**
 * Floor on a plausible Live OpenRouter model count. The public list has been
 * in the hundreds for two years; anything below this is a blocked request, a
 * paginated fragment, or a schema change — never the real catalogue.
 */
export const MIN_LIVE_MODELS = 50;

/** Refused maxTokens when a new model reports no top_provider cap (a
 * conservative cap only under-declares; pi.dev's crawler does the same for
 * router meta-models). */
const FALLBACK_MAX_TOKENS = 32768;

/** pi's mirror serves only models the agent can steer: `tools` support. */
export function isToolCapable(model: OpenRouterModel): boolean {
	return (model.supported_parameters ?? []).includes("tools");
}

export function sanityOk(models: readonly OpenRouterModel[]): boolean {
	return models.length >= MIN_LIVE_MODELS;
}

function perMillion(value: string | number | null | undefined): number {
	if (value === null || value === undefined || value === "") return 0;
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n < 0) return 0;
	// OpenRouter prices in USD per token; pi's cost block is per 1M tokens.
	return Math.round(n * 1_000_000 * 1e6) / 1e6;
}

/**
 * Map a live model to the models.json entry shape. Returns null for models
 * pi intentionally keeps out of the agent catalogue (no `tools` support) or
 * that carry no identity.
 *
 * Verified field-for-field against the pi.dev mirror it stands in for
 * (375 models in common on 2026-09-16):
 *  - contextWindow = top_provider.context_length, falling back to the
 *    model-level context_length (mirrors the crawler exactly).
 *  - maxTokens = top_provider.max_completion_tokens, falling back to
 *    FALLBACK_MAX_TOKENS (mirrors the crawler's behavior on the four
 *    openrouter/* meta-models, which carry no top_provider cap).
 *  - cost = raw per-token prices × 1e6 (mirrors the crawler's values; if
 *    they ever differ it is because the mirror is stale — we are fresher).
 *  - input = architecture.input_modalities restricted to text/image, text
 *    first (the mirror never serves "file").
 *  - reasoning = "reasoning" ∈ supported_parameters.
 */
export function mapModel(model: OpenRouterModel): LiveModelEntry | null {
	if (!model.id) return null;
	if (!isToolCapable(model)) return null;

	const tp = model.top_provider ?? {};
	const contextWindow =
		(tp.context_length ?? 0) > 0 ? tp.context_length! : model.context_length ?? 0;
	const maxTokens =
		(tp.max_completion_tokens ?? 0) > 0 ? tp.max_completion_tokens! : FALLBACK_MAX_TOKENS;

	const modalities = model.architecture?.input_modalities ?? ["text"];
	const input: string[] = [];
	if (modalities.includes("text")) input.push("text");
	if (modalities.includes("image")) input.push("image");

	return {
		id: model.id,
		name: model.name?.trim() ? model.name : model.id,
		contextWindow,
		maxTokens,
		input,
		reasoning: (model.supported_parameters ?? []).includes("reasoning"),
		cost: {
			input: perMillion(model.pricing?.prompt),
			output: perMillion(model.pricing?.completion),
			cacheRead: perMillion(model.pricing?.input_cache_read),
			cacheWrite: perMillion(model.pricing?.input_cache_write),
		},
	};
}

/**
 * Live tool-capable models pi does not know yet, sorted for determinism.
 * `known` holds provider-qualified ids exactly as the runtime catalog
 * reports them (e.g. "openrouter/stealth/union-alpha").
 */
export function newModelIds(
	live: readonly OpenRouterModel[],
	known: ReadonlySet<string>,
): string[] {
	const ids = new Set<string>();
	for (const model of live) {
		const entry = mapModel(model);
		if (entry && !known.has(`openrouter/${entry.id}`)) ids.add(entry.id);
	}
	return [...ids].sort();
}

/**
 * The additive merge, with no I/O. `doc` is the current models.json payload
 * of any shape; the result preserves every byte of it except that the
 * missing `fresh` ids are appended to providers.openrouter.models, in
 * `fresh` order. Existing entries are never touched.
 */
export function mergeEntries(
	doc: unknown,
	fresh: readonly LiveModelEntry[],
): { doc: Record<string, unknown>; addedIds: string[] } {
	const root: Record<string, unknown> =
		doc && typeof doc === "object" && !Array.isArray(doc) ? { ...(doc as object) } : {};
	const providers: Record<string, unknown> =
		root.providers && typeof root.providers === "object"
			? { ...(root.providers as object) }
			: {};
	const openrouter: Record<string, unknown> =
		providers.openrouter && typeof providers.openrouter === "object"
			? { ...(providers.openrouter as object) }
			: {};
	const existing = Array.isArray(openrouter.models)
		? (openrouter.models as LiveModelEntry[])
		: [];
	const have = new Set(existing.map((m) => m.id));
	const added = fresh.filter((m) => !have.has(m.id));
	openrouter.models = [...existing, ...added];
	providers.openrouter = openrouter;
	root.providers = providers;
	return { doc: root, addedIds: added.map((m) => m.id) };
}