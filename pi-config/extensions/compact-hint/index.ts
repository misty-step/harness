/**
 * compact-hint — advisory compaction boundary advice for pi (ADR-023).
 *
 * At a settled turn, asks System One (Jev, via OpenRouter) two atomic
 * questions — is the unit of work finished, is this hands-on work or
 * coordination — composes one score in code, and compares it to a floor that
 * relaxes as the context window fills (0.90 through 10% used, 0.50 by 90%).
 * When the score clears the floor, the operator gets one hint to run
 * /compact. With PI_COMPACT_HINT_AUTO=1 in a fully interactive session, the
 * same gate triggers ctx.compact() instead; every other mode is hint-only or
 * inert (print/json). COMPACT_ADVISER_DISABLE=1 silences the extension.
 *
 * Doctrine: advisory only, fail open, never a gate. No provider key, a
 * provider error, unusable answers, unknown usage, or an empty transcript all
 * mean silence — never a fabricated score and never automatic compaction.
 * The judgment itself lives in agent-config/system-one/compact.ts (deployed
 * beside this file); this extension is only the pi glue. Removing the
 * directory restores stock pi behavior.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildCompactState, compactDisabled, evaluateCompact, type CompactMessage } from "./compact.ts";
import { OpenRouterJevProvider } from "./engine.ts";
import { autoOptedIn, gate, hintLine, statusLine } from "./decide.ts";

const MIN_CONTEXT_TOKENS = 40_000;
const COOLDOWN_MS = 60_000;

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (
			block &&
			typeof block === "object" &&
			(block as { type?: unknown }).type === "text" &&
			typeof (block as { text?: unknown }).text === "string"
		) {
			parts.push((block as { text: string }).text);
		}
	}
	return parts.join("\n");
}

/** Recent conversation as the compact judge's state. Unknown entries are skipped. */
function transcript(ctx: ExtensionContext): { messages: CompactMessage[]; previousSummary: string } {
	const messages: CompactMessage[] = [];
	let previousSummary = "";
	for (const entry of ctx.sessionManager.buildContextEntries() as unknown[]) {
		const row = entry as { type?: unknown; message?: Record<string, unknown> };
		if (row?.type !== "message" || !row.message || typeof row.message.role !== "string") continue;
		const message = row.message;
		const text = textOf(message.content);
		if (message.role === "user") messages.push({ role: "user", text });
		else if (message.role === "assistant") messages.push({ role: "assistant", text });
		else if (message.role === "toolResult") {
			messages.push({
				role: "toolResult",
				text,
				tool: typeof message.toolName === "string" ? message.toolName : undefined,
				error: message.isError === true,
			});
		} else if (message.role === "compactionSummary" || message.role === "branchSummary") {
			if (typeof message.summary === "string" && !previousSummary) previousSummary = message.summary;
		}
	}
	return { messages, previousSummary };
}

/** pi's own OpenRouter credential first; the environment is the fallback. */
async function resolveKey(ctx: ExtensionContext): Promise<string | null> {
	const registry = ctx.modelRegistry as unknown as {
		getApiKeyForProvider?: (provider: string) => Promise<string | undefined>;
		getProviderAuth?: (provider: string) => Promise<{ auth?: { apiKey?: string } } | undefined>;
	};
	try {
		if (typeof registry.getApiKeyForProvider === "function") {
			const key = await registry.getApiKeyForProvider("openrouter");
			if (key) return key;
		}
		if (typeof registry.getProviderAuth === "function") {
			const auth = await registry.getProviderAuth("openrouter");
			const key = auth?.auth?.apiKey;
			if (key) return key;
		}
	} catch {
		// Fall through to the environment.
	}
	return process.env.OPENROUTER_API_KEY?.trim() || null;
}

export default function (pi: ExtensionAPI) {
	let lastJudgeMs: number | null = null;
	let lastVerdict: string | null = null;

	pi.on("agent_settled", async (_event, ctx) => {
		try {
			const usage = ctx.getContextUsage();
			const decision = gate({
				mode: ctx.mode,
				disabled: compactDisabled(),
				autoOptIn: autoOptedIn(),
				tokens: usage?.tokens ?? null,
				contextWindow: usage?.contextWindow ?? null,
				lastJudgeMs,
				nowMs: Date.now(),
				minContextTokens: MIN_CONTEXT_TOKENS,
				cooldownMs: COOLDOWN_MS,
			});
			if (decision.action === "skip") return;
			lastJudgeMs = Date.now();

			const { messages, previousSummary } = transcript(ctx);
			if (messages.length === 0) return;
			const { state } = buildCompactState(messages, { previousSummary });
			const key = await resolveKey(ctx);
			const verdict = await evaluateCompact({
				state,
				usage: decision.usage,
				tokens: usage?.tokens ?? null,
				provider: key ? new OpenRouterJevProvider(key) : null,
				minContextTokens: MIN_CONTEXT_TOKENS,
			});
			lastVerdict = verdict.qualified
				? `qualified (score ${verdict.score?.toFixed(2)}, floor ${verdict.floor?.toFixed(2)})`
				: `${verdict.reason}${verdict.score !== null ? ` (score ${verdict.score.toFixed(2)})` : ""}`;
			if (!verdict.qualified || !verdict.hint) return;

			const line = hintLine(usage?.percent ?? null, decision.auto);
			if (decision.auto) {
				ctx.ui.notify(`${line} Automatic compaction is on (PI_COMPACT_HINT_AUTO).`, "info");
				ctx.compact({
					onError: (error) => ctx.ui.notify(`compact-hint: automatic compaction failed: ${error.message}`, "warning"),
				});
				return;
			}
			ctx.ui.notify(line, "info");
		} catch {
			// Fail open: advice must never disturb a session.
			return;
		}
	});

	pi.registerCommand("compact-hint", {
		description: "Show compact-hint status (advisory System One compaction advice)",
		handler: async (_args, ctx) => {
			const usage = ctx.getContextUsage();
			ctx.ui.notify(
				statusLine({
					mode: ctx.mode,
					disabled: compactDisabled(),
					autoOptIn: autoOptedIn(),
					tokens: usage?.tokens ?? null,
					contextWindow: usage?.contextWindow ?? null,
					lastVerdict,
				}),
				"info",
			);
		},
	});
}
