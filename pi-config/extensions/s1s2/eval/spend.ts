// The evaluation boundary prices an upper bound, never a typical token estimate (US-030).
type Fields = Record<string, unknown>;
type Endpoint = { tag?: string; max_completion_tokens?: number | null; context_length?: number; pricing?: Fields & { overrides?: Fields[] } };
export type Bound = { cost: (inputTokenUpperBound: number) => number; ceiling: number; contextTokens: number };

const isFields = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const optional = (value: unknown, type: "string" | "number") => value === undefined || typeof value === type;

/** Only the shape priced below. One malformed endpoint rejects the listing: dropping it could drop the dearest rate. */
function isEndpoint(value: unknown): value is Endpoint {
	if (!isFields(value) || !optional(value.tag, "string") || !optional(value.context_length, "number")) return false;
	if (value.max_completion_tokens !== null && !optional(value.max_completion_tokens, "number")) return false;
	const pricing = value.pricing;
	return pricing === undefined || (isFields(pricing) && (pricing.overrides === undefined || (Array.isArray(pricing.overrides) && pricing.overrides.every(isFields))));
}

/** A listed USD price; an unreadable or negative one fails closed instead of counting as free. */
function usd(model: string, value: unknown): number {
	if (value === undefined) return 0;
	const price = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
	if (!Number.isFinite(price) || price < 0) throw new Error(`OpenRouter listed an unreadable price for ${model}: ${JSON.stringify(value)}`);
	return price;
}

/** From OpenRouter's raw endpoint listing: each token kind's dearest base or time-window rate, with the full completion ceiling. */
export function pricedBound(model: string, listing: unknown, tag?: string): Bound {
	const data = isFields(listing) ? listing.data : undefined;
	const endpoints = isFields(data) ? data.endpoints : undefined;
	if (!Array.isArray(endpoints) || !endpoints.every(isEndpoint)) throw new Error(`OpenRouter returned no valid endpoint list for ${model}`);
	const matched = endpoints.filter((endpoint) => !tag || endpoint.tag === tag || endpoint.tag?.startsWith(`${tag}/`));
	// Every matched endpoint must list what the bound multiplies; an omitted value would count as zero.
	const unlisted = matched.find((endpoint) => !((endpoint.context_length ?? 0) > 0) || endpoint.pricing?.prompt === undefined || endpoint.pricing?.completion === undefined);
	if (unlisted) throw new Error(`OpenRouter lists no context length or base prompt and completion rates for ${model}${unlisted.tag ? ` on ${unlisted.tag}` : ""}`);
	const rates = matched.flatMap((endpoint) => [endpoint.pricing ?? {}, ...(endpoint.pricing?.overrides ?? [])]);
	const price = (key: string) => Math.max(0, ...rates.map((rate) => usd(model, rate[key])));
	const ceiling = Math.max(0, ...matched.map((endpoint) => endpoint.max_completion_tokens ?? endpoint.context_length ?? 0));
	const contextTokens = Math.max(0, ...matched.map((endpoint) => endpoint.context_length ?? 0));
	// Input may bill at the cache-write rate, which can exceed the uncached prompt rate.
	const input = Math.max(price("prompt"), price("input_cache_write"));
	const output = Math.max(price("completion"), price("internal_reasoning"));
	if (matched.length === 0 || !(input > 0) || !(ceiling > 0)) throw new Error(`cannot bound the cost of ${model}${tag ? ` on ${tag}` : ""}`);
	const fixed = ceiling * output + price("request");
	return { cost: (inputTokenUpperBound) => inputTokenUpperBound * input + fixed, ceiling, contextTokens };
}

/** One UTF-8 byte per token is the conservative payload bound without a tokenizer. A typical
 * four-byte average would under-reserve. Jev's provider framing needs its whole context floor. */
export function worstCallUsd(bound: Bound, payloadBytes: number, jev: boolean): number {
	const payloadTokenUpperBound = payloadBytes; // Buffer.byteLength is an integer; one byte bounds one input token.
	return bound.cost(jev ? Math.max(payloadTokenUpperBound, bound.contextTokens) : payloadTokenUpperBound);
}
