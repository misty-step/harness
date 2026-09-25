/**
 * Evaluation parity shim, loaded identically in every arm (OMP and the Pi arms).
 *
 * It records the first provider request's model settings (never content or
 * headers) to `PARITY_OUT` as evidence that every arm used the same model and
 * settings. Where the harnesses would otherwise differ in a model setting, the
 * runner names the setting to pin:
 *   PARITY_VERBOSITY   OpenAI Responses `text.verbosity`. Pi's Codex adapter always
 *                      sends "low" and OMP omits it, so Codex runs pin one value.
 *   PARITY_MAX_OUTPUT  One output-token ceiling in whichever field the request uses
 *                      (`max_output_tokens` for Responses, `max_completion_tokens`
 *                      for chat completions). On OpenRouter, Pi sends 384000 and
 *                      OMP sends none.
 *   PARITY_UPSTREAM    One OpenRouter upstream provider (slug), fallbacks off. In
 *                      the pilot, OMP's Responses requests and Pi's chat
 *                      completions reached different upstreams at different prices.
 * Harness-owned transport choices (which API a harness uses for a provider, tool
 * schemas) are recorded, not normalized.
 */
import { appendFileSync } from "node:fs";

const SETTINGS = ["model", "reasoning", "text", "temperature", "top_p", "service_tier", "store", "provider", "max_tokens", "max_completion_tokens", "max_output_tokens"];

export default function parity(pi: { on: (event: string, handler: (event: { payload?: unknown }) => unknown) => unknown }): void {
	let recorded = false;
	pi.on("before_provider_request", (event) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		if (!payload || typeof payload !== "object" || !("model" in payload)) return;
		const verbosity = process.env.PARITY_VERBOSITY;
		if (verbosity && "input" in payload) payload.text = { ...(payload.text as object | undefined), verbosity };
		const maxOutput = Number(process.env.PARITY_MAX_OUTPUT) || 0;
		if (maxOutput > 0 && "input" in payload) payload.max_output_tokens = maxOutput;
		if (maxOutput > 0 && "messages" in payload) {
			payload.max_completion_tokens = maxOutput;
			delete payload.max_tokens;
		}
		const upstream = process.env.PARITY_UPSTREAM;
		if (upstream) payload.provider = { ...(payload.provider as object | undefined), order: [upstream], allow_fallbacks: false };
		const out = process.env.PARITY_OUT;
		if (!recorded && out) {
			recorded = true;
			const settings: Record<string, unknown> = { api: "input" in payload ? "responses" : "messages" in payload ? "chat_completions" : "other" };
			for (const key of SETTINGS) if (key in payload) settings[key] = payload[key];
			appendFileSync(out, `${JSON.stringify(settings)}\n`);
		}
		return payload;
	});
}
