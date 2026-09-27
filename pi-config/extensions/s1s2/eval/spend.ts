// The evaluation boundary prices an upper bound, never a typical token estimate (US-030).
type Rates = Record<string, unknown>;
export type Endpoint = { tag?: string; max_completion_tokens?: number | null; context_length?: number; pricing?: Rates & { overrides?: Rates[] } };
export type Bound = { cost: (inputTokenUpperBound: number) => number; ceiling: number; contextTokens: number };

/** Dearest endpoint/base or time-window rate, with its full completion ceiling. */
export function pricedBound(model: string, endpoints: readonly Endpoint[], tag?: string): Bound {
	const matched = endpoints.filter((endpoint) => !tag || endpoint.tag === tag || endpoint.tag?.startsWith(`${tag}/`));
	const rates = matched.flatMap((endpoint) => [endpoint.pricing ?? {}, ...(endpoint.pricing?.overrides ?? [])]);
	const price = (key: string) => Math.max(0, ...rates.map((rate) => Number(rate[key] ?? 0) || 0));
	const ceiling = Math.max(0, ...matched.map((endpoint) => endpoint.max_completion_tokens ?? endpoint.context_length ?? 0));
	const contextTokens = Math.max(0, ...matched.map((endpoint) => endpoint.context_length ?? 0));
	const input = price("prompt");
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
