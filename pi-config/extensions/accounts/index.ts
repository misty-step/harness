/**
 * accounts — extra subscription accounts per provider (ADR-024).
 *
 * Stock pi keys `auth.json` by provider id, so one provider holds one login.
 * Upstream declined core multi-account support and points at provider
 * extensions (earendil-works/pi#1391, #7814). This extension registers each
 * slot in `SLOTS` as a clone of a built-in provider under its own id
 * (`openai-codex-2`, …). The clone reuses the built-in login, refresh, and
 * streaming unchanged, so every slot gets its own `/login` entry, its own
 * `auth.json` key, and pi's own locked refresh. Pi owns these tokens: slots
 * never read or share another harness's credential store.
 *
 * Removing the extension removes the slots and leaves the base providers and
 * their stored logins untouched (stock behavior).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { SLOTS, cloneProvider } from "./slots.ts";

export default function accounts(pi: ExtensionAPI) {
	const builtins = builtinProviders();
	for (const [id, baseId] of Object.entries(SLOTS)) {
		const base = builtins.find((provider) => provider.id === baseId);
		// Fail closed per slot: a renamed or removed base provider drops its
		// slots rather than registering a provider that cannot authenticate.
		if (!base?.auth?.oauth) continue;
		pi.registerProvider(cloneProvider(base, id));
	}
}
