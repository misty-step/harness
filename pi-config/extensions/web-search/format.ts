/**
 * Pure rendering for Exa search results — no runtime imports so it is
 * testable directly with `bun test`. index.ts is the harness-facing half
 * (same split as loc: analyze.ts pure, index.ts pi-specific).
 */

/** Per-result excerpt cap in snippet mode. */
export const SNIPPET_CHARS = 300;
/** Per-page text cap we ask Exa for in full-text mode. */
export const FULL_TEXT_CHARS = 4000;
/** Hard cap on the total text block returned to the model. */
export const RESULT_TOTAL_CHARS = 12000;

export type ExaResult = {
	url: string;
	title?: string;
	publishedDate?: string;
	highlights?: string[];
	text?: string;
};

export function clamp(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max).trimEnd()}…`;
}

/**
 * Render Exa results as compact numbered text.
 * Pure — covered by web-search.test.ts.
 */
export function formatResults(results: ExaResult[], fullText: boolean): string {
	const blocks: string[] = [];
	for (const [i, r] of results.entries()) {
		const lines: string[] = [];
		const title = (r.title ?? "").trim() || r.url;
		const date = r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : "";
		lines.push(`${i + 1}. ${title}${date}`);
		lines.push(`   ${r.url}`);
		let excerpt = "";
		if (fullText && (r.text ?? "").trim()) {
			excerpt = (r.text ?? "").trim();
		} else {
			excerpt = (r.highlights ?? []).join(" ").trim();
			if (!excerpt) excerpt = (r.text ?? "").trim();
		}
		if (excerpt) {
			lines.push(`   ${clamp(excerpt, fullText ? FULL_TEXT_CHARS : SNIPPET_CHARS)}`);
		}
		blocks.push(lines.join("\n"));
	}
	let out = blocks.join("\n\n");
	if (out.length > RESULT_TOTAL_CHARS) {
		out = `${out.slice(0, RESULT_TOTAL_CHARS).trimEnd()}\n… (output truncated)`;
	}
	return out;
}