/**
 * web-search — Exa-backed web search for pi.
 *
 * Registers a single tool, `web_search`, when EXA_API_KEY is present in the
 * environment (e.g. pi launched via `pass-env run -e EXA_API_KEY=... -- pi`).
 * Without the key the extension registers nothing: the session degrades to
 * stock pi behavior with no dead affordance.
 *
 * Zero dependencies beyond pi's runtime: one fetch to api.exa.ai. Failures
 * surface the HTTP status and the raw response body — never a bare
 * "search failed" — following the Cerebras 402 incident, where the body
 * carried the whole answer.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { FULL_TEXT_CHARS, formatResults, type ExaResult } from "./format.ts";

const SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_RESULTS = 5;
const MAX_RESULTS = 10;

export default function (pi: ExtensionAPI) {
	const apiKey = process.env.EXA_API_KEY?.trim();
	if (!apiKey) return; // no key -> no tool -> stock pi, nothing to clean up

	pi.registerTool({
		name: "web_search",
		label: "web_search",
		description:
			"Search the live web (Exa: neural + keyword). Returns ranked results with title, URL, " +
			"publish date, and a short highlighted snippet. Set full_text to true when a snippet is " +
			"not enough to also get Exa-extracted page text (costs more context).",
		parameters: Type.Object({
			query: Type.String({ description: "Search query in natural language" }),
			num_results: Type.Optional(
				Type.Number({
					minimum: 1,
					maximum: MAX_RESULTS,
					description: `Number of results to return (default ${DEFAULT_RESULTS})`,
				}),
			),
			full_text: Type.Optional(
				Type.Boolean({ description: "Also request page text extracted by Exa" }),
			),
		}),
		async execute(toolCallId, params, signal) {
			const query = String(params.query ?? "").trim();
			if (!query) {
				throw new Error("web_search: query is required");
			}
			const numResults = Math.min(
				MAX_RESULTS,
				Math.max(1, Math.round(Number(params.num_results) || DEFAULT_RESULTS)),
			);
			const fullText = Boolean(params.full_text);

			const request: Record<string, unknown> = { query, numResults };
			if (fullText) {
				request.contents = { text: { maxCharacters: FULL_TEXT_CHARS } };
			}

			const res = await fetch(SEARCH_URL, {
				method: "POST",
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(request),
				signal,
			});
			const raw = await res.text();
			if (!res.ok) {
				throw new Error(`web_search failed: HTTP ${res.status} ${raw.slice(0, 400)}`);
			}
			let data: { results?: ExaResult[] };
			try {
				data = JSON.parse(raw);
			} catch {
				throw new Error(
					`web_search failed: Exa returned non-JSON body (HTTP ${res.status}): ${raw.slice(0, 200)}`,
				);
			}
			const results = data.results ?? [];
			if (results.length === 0) {
				return { content: [{ type: "text", text: `No results for: ${query}` }], details: { results: [] } };
			}
			return {
				content: [{ type: "text", text: formatResults(results, fullText) }],
				details: { results: results.map((r) => ({ url: r.url, title: r.title })) },
			};
		},
	});
}