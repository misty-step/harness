import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";

/**
 * Credential awareness. Agents keep concluding a credential is unavailable
 * without looking in the pass store. Three structural checks, names only
 * (nothing is ever decrypted):
 *
 * 1. Every agent start: the system prompt lists every pass entry name.
 * 2. Every bash result that looks like an auth failure: the entries matching
 *    the command or output are appended to the result.
 * 3. Every assistant message that claims a credential is missing: a follow-up
 *    names the matching entries, once per service per session.
 */

const MARKER = "## Credential inventory (pass)";
const REMINDER_TYPE = "credentials/reminder";

/** Tokens in entry names that say nothing about which service an entry is for. */
const GENERIC = new Set([
	"workstation", "archive", "api", "key", "keys", "token", "tokens", "secret", "secrets",
	"auth", "access", "personal", "production", "prod", "test", "admin", "management",
	"utility", "account", "id", "url", "user", "password", "pass", "the",
]);

export function loadInventory(): string[] {
	try {
		return execFileSync("pass-env", ["list"], { encoding: "utf8", timeout: 5000 })
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

/** Service-identifying words of one entry: `workstation/DOUBLETAKE_CONVEX_DEPLOY_KEY` → doubletake, convex, deploy. */
export function serviceTokens(entry: string): string[] {
	return entry
		.toLowerCase()
		.split(/[\/_\-.]+/)
		.filter((token) => token.length >= 4 && !GENERIC.has(token));
}

/** Entries whose service words all appear in the text, or whose single most specific word does. */
export function matchEntries(text: string, entries: readonly string[]): string[] {
	const haystack = text.toLowerCase();
	const words = new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean));
	return entries.filter((entry) => serviceTokens(entry).some((token) => words.has(token) || haystack.includes(token)));
}

const AUTH_FAILURE =
	/\b(401|403)\b|unauthori[sz]ed|forbidden|authentication ?failed|not (logged in|authenticated)|invalid [\w ]{0,20}(key|token|credential)|(api[ _]?key|token|credential|secret|dsn)s? (is |are )?(missing|not set|required|invalid|expired)|missing (api[ _]?key|token|credential|secret)/i;

export function isAuthFailure(text: string): boolean {
	return AUTH_FAILURE.test(text);
}

const UNAVAILABLE_CLAIM =
	/\b(no|without|missing|lacks?|lacking)\b[^.\n]{0,50}\b(credentials?|tokens?|keys?|secrets?|dsn|auth)\b|\b(credentials?|tokens?|keys?|secrets?|dsn|auth)\b[^.\n]{0,50}\b(unavailable|not available|(was|were|is|are)n['’]t available|not found|not configured|missing)\b/i;

export function claimsUnavailable(text: string): boolean {
	return UNAVAILABLE_CLAIM.test(text);
}

export function inventorySection(entries: readonly string[]): string {
	return [
		MARKER,
		"",
		"These pass entries exist on this machine (names only; values stay encrypted). A credential",
		"listed here is available: bind it with `pass-env run -e NAME=entry -- <command>`, or use a",
		"project's `.env.pass` with `pass-env run -f .env.pass -- <command>`. Before saying any",
		"credential is unavailable, check this list and `pass-env list <term>`, and check native",
		"logins (`gh auth status`, `wrangler whoami`, `~/.convex`). Public values such as a Sentry",
		"DSN can be read from the issuer's API with the stored token.",
		"",
		entries.join("\n"),
	].join("\n");
}

export function reminder(entries: readonly string[], context: "result" | "claim"): string {
	const lead =
		context === "result"
			? "Credential check: this looks like an authentication failure."
			: "Credential check: you said a credential is unavailable.";
	return entries.length > 0
		? `${lead} Matching pass entries: ${entries.join(", ")}. Bind with \`pass-env run -e NAME=<entry> -- <command>\`; if the stored value is rejected, say which entry failed rather than that none exists.`
		: `${lead} Run \`pass-env list <service>\` and check native logins before concluding it is unavailable.`;
}

function textOf(content: unknown): string {
	if (!Array.isArray(content)) return typeof content === "string" ? content : "";
	return content
		.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
		.join("\n");
}

export default function registerCredentialsExtension(pi: ExtensionAPI): void {
	let inventory: string[] | null = null;
	const entries = () => (inventory ??= loadInventory());
	const reminded = new Set<string>();

	pi.on("before_agent_start", (event) => {
		const names = entries();
		if (names.length === 0 || event.systemPrompt.includes(MARKER)) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${inventorySection(names)}` };
	});

	pi.on("tool_result", (event) => {
		if (event.toolName !== "bash") return;
		const output = textOf(event.content);
		if (!isAuthFailure(output)) return;
		const command = typeof event.input.command === "string" ? event.input.command : "";
		const matches = matchEntries(`${command}\n${output}`, entries());
		return {
			content: [...event.content, { type: "text", text: reminder(matches, "result") }],
		};
	});

	pi.on("message_end", (event) => {
		const message = event.message as { role?: string; content?: unknown };
		if (message.role !== "assistant") return;
		const text = textOf(message.content);
		if (!claimsUnavailable(text)) return;
		const matches = matchEntries(text, entries()).filter((entry) => !reminded.has(entry));
		const key = matches.length > 0 ? matches.join(",") : "general";
		if (reminded.has(key)) return;
		reminded.add(key);
		for (const entry of matches) reminded.add(entry);
		pi.sendMessage(
			{ customType: REMINDER_TYPE, content: reminder(matches, "claim"), display: true },
			{ deliverAs: "followUp", triggerTurn: true },
		);
	});
}
