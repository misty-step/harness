import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";

/**
 * Names-only credential discovery at agent start. Authentication recovery is
 * governed by the standing guidance; tool output and agent prose do not
 * establish whether a credential is needed, so neither injects a reminder.
 */

const MARKER = "## Credential inventory (pass)";
const ON_DEMAND_SECTION = [
	MARKER,
	"",
	"Credential names are discoverable with `pass-env list [prefix]` (names only; no decryption).",
	"Check native tool auth first, then the pass inventory and the project's `.env.pass`.",
	"`skill://authenticated-commands` describes lookup and selective binding; the standing",
	"credential guidance covers the remaining sources before concluding a credential is unavailable.",
].join("\n");

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

export default function registerCredentialsExtension(pi: ExtensionAPI): void {
	let inventory: string[] | null = null;
	// Pin the experiment for this extension instance; do not rewrite a live prefix mid-session.
	const onDemand = process.env.OMP_CREDENTIAL_CONTEXT === "on-demand";

	pi.on("before_agent_start", (event) => {
		if (event.systemPrompt.includes(MARKER)) return;
		const names = onDemand ? [] : (inventory ??= loadInventory());
		if (!onDemand && names.length === 0) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${onDemand ? ON_DEMAND_SECTION : inventorySection(names)}` };
	});
}
