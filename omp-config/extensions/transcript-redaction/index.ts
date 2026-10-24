import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Redacts credential-shaped values from tool results before OMP keeps them.
 *
 * OMP has no extension hook at its session-file write, so `tool_result` is the
 * nearest owned boundary: the patched content and details are what the model
 * sees and what the transcript stores. OMP's own `secrets` obfuscation masks
 * provider requests only, so a key printed by `read` or `bash` was stored raw.
 */
const PATTERNS: readonly [RegExp, string][] = [
	[/\bsk-[A-Za-z0-9_-]{20,}/g, "sk"], // OpenAI, Anthropic, OpenRouter
	[/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, "github"],
	[/\bAKIA[0-9A-Z]{16}\b/g, "aws"],
	[/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "slack"],
];

export function redact(text: string): string {
	return PATTERNS.reduce((out, [pattern, kind]) => out.replace(pattern, `[REDACTED:${kind}]`), text);
}

function redactDeep(value: unknown): unknown {
	if (typeof value === "string") return redact(value);
	if (Array.isArray(value)) return value.map(redactDeep);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)]));
	}
	return value;
}

export default function registerTranscriptRedaction(pi: ExtensionAPI): void {
	pi.on("tool_result", (event) => {
		const content = event.content.map((block) =>
			block.type === "text" ? { ...block, text: redact(block.text) } : block,
		);
		const details = redactDeep(event.details);
		if (JSON.stringify(content) === JSON.stringify(event.content) &&
			JSON.stringify(details) === JSON.stringify(event.details)) return;
		return { content, details: details as typeof event.details };
	});
}
