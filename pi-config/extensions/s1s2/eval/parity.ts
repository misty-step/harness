/**
 * Evaluation parity shim, loaded identically in every arm (OMP and both Pi arms).
 *
 * The harnesses already send the same model, reasoning effort, and storage
 * settings for OpenAI Responses requests. They differ in one model setting:
 * Pi always sends `text.verbosity: "low"`, while OMP omits it. This shim pins
 * verbosity to one explicit value in every arm and records the first request's
 * model settings (never content or headers) to `PARITY_OUT` as evidence.
 */
import { appendFileSync } from "node:fs";

const VERBOSITY = "medium";

export default function parity(pi: { on: (event: string, handler: (event: { payload?: unknown }) => unknown) => unknown }): void {
	let recorded = false;
	pi.on("before_provider_request", (event) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		if (!payload || typeof payload !== "object" || !("input" in payload)) return;
		payload.text = { ...(payload.text as object | undefined), verbosity: VERBOSITY };
		const out = process.env.PARITY_OUT;
		if (!recorded && out) {
			recorded = true;
			const settings = {
				model: payload.model,
				reasoning: payload.reasoning,
				text: payload.text,
				service_tier: payload.service_tier ?? null,
				store: payload.store,
				max_output_tokens: payload.max_output_tokens ?? null,
			};
			appendFileSync(out, `${JSON.stringify(settings)}\n`);
		}
		return payload;
	});
}
