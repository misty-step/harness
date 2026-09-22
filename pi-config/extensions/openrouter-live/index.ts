/**
 * openrouter-live — close pi's model-availability gap without waiting for
 * pi.dev.
 *
 * pi refreshes its remote catalog from a pi.dev mirror of the provider's
 * public model list (4-hour interval, ETag-validated). omp queries
 * openrouter.ai directly, so on launch day it lists new OpenRouter models
 * in minutes while pi can lag by hours. This extension is the bridge: on
 * session start (at most every 2 h) and on demand via `/models-live`, it
 * fetches the live OpenRouter public list (key-free), maps it to the exact
 * entry shape pi's mirror serves, and appends the tool-capable models pi
 * does not already know to `~/.pi/agent/models.json` — the user overlay pi
 * merges on top of its builtins. It never removes models, never rewrites an
 * existing entry, refuses to act on an implausibly small list, and leaves
 * stock pi behavior fully intact when removed (ADR-022).
 *
 * The additive overlay is also a safety property: when pi.dev catches up,
 * the mirror entry replaces ours id-for-id through pi's own merge — no
 * cleanup of ours is ever required.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type LiveModelEntry,
	type OpenRouterModel,
	MIN_LIVE_MODELS,
	mapModel,
	mergeEntries,
	newModelIds,
	sanityOk,
} from "./live.ts";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const FETCH_TIMEOUT_MS = 15_000;
/** Background refresh cadence; pi.dev's own mirror refreshes every 4 h. */
const REFRESH_AFTER_MS = 2 * 60 * 60 * 1000;

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

const modelsJsonPath = () => path.join(agentDir(), "models.json");
const statusPath = () => path.join(agentDir(), "openrouter-live-status.json");

async function fetchLiveModels(): Promise<OpenRouterModel[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(OPENROUTER_MODELS_URL, { signal: controller.signal });
		if (!res.ok) throw new Error(`openrouter.ai HTTP ${res.status}`);
		const body = (await res.json()) as { data?: OpenRouterModel[] };
		if (!Array.isArray(body.data)) throw new Error("unexpected OpenRouter payload shape");
		return body.data;
	} finally {
		clearTimeout(timer);
	}
}

function lastCheckMs(): number {
	try {
		const parsed = JSON.parse(fs.readFileSync(statusPath(), "utf8")) as {
			lastCheckMs?: number;
		};
		return typeof parsed.lastCheckMs === "number" ? parsed.lastCheckMs : 0;
	} catch {
		return 0;
	}
}

function writeStatus(added: string[], total: number): void {
	fs.writeFileSync(
		statusPath(),
		JSON.stringify({ lastCheckMs: Date.now(), total, added }, null, 2) + "\n",
		{ mode: 0o600 },
	);
}

/**
 * Atomic additive merge into models.json. Existing entries and any foreign
 * keys in the file are preserved byte for byte; the previous file is kept as
 * models.json.bak. Only ever called with a sanity-checked live list.
 */
function appendModelsJson(fresh: readonly LiveModelEntry[]): string[] {
	const target = modelsJsonPath();
	let doc: unknown = {};
	try {
		doc = JSON.parse(fs.readFileSync(target, "utf8"));
	} catch {
		// missing or unreadable: start from the empty skeleton
	}
	const { doc: merged, addedIds } = mergeEntries(doc, fresh);
	if (addedIds.length === 0) return addedIds;
	if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
	const tmp = `${target}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
	fs.renameSync(tmp, target);
	return addedIds;
}

interface RefreshResult {
	/** Provider-qualified ids this run made visible to pi. */
	added: string[];
	/** Size of the live OpenRouter catalog, sanity-checked. */
	total: number;
}

let inFlight: Promise<RefreshResult> | null = null;

async function refreshNow(ctx: ExtensionContext): Promise<RefreshResult> {
	const live = await fetchLiveModels();
	// Fail closed: a blocked/partial LIST response would otherwise cause a
	// mass-add or a false "up to date" (poka-yoke, see live.ts header).
	if (!sanityOk(live)) {
		throw new Error(
			`refusing to act on a ${live.length}-model catalog (min ${MIN_LIVE_MODELS}): blocked request or schema change`,
		);
	}
	const known = new Set(
		ctx.modelRegistry.getAll().map((m) => `${m.provider}/${m.id}`),
	);
	const ids = newModelIds(live, known);
	const fresh = ids
		.map((id) => mapModel(live.find((m) => m.id === id)!))
		.filter((m): m is LiveModelEntry => m !== null);
	const added = fresh.length > 0 ? appendModelsJson(fresh) : [];
	if (added.length > 0) {
		// Pick up the overlay immediately in this session; pi itself reloads
		// models.json on every /model open, so other sessions self-heal.
		await ctx.modelRegistry.refresh();
	}
	writeStatus(added, live.length);
	return { added, total: live.length };
}

function refreshOnce(ctx: ExtensionContext): Promise<RefreshResult> {
	inFlight ??= refreshNow(ctx).finally(() => {
		inFlight = null;
	});
	return inFlight;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (Date.now() - lastCheckMs() < REFRESH_AFTER_MS) return;
		// Background path: silent on failure and on "up to date"; a model
		// actually landing is worth one info notification.
		void refreshOnce(ctx)
			.then((r) => {
				if (r.added.length > 0 && ctx.mode !== "print") {
					ctx.ui.notify(
						`openrouter-live: now visible (not yet in pi.dev mirror): ${r.added.join(", ")}`,
						"info",
					);
				}
			})
			.catch(() => {});
	});

	pi.registerCommand("models-live", {
		description:
			"Fetch OpenRouter's live model list now and add models pi's catalog lacks",
		async handler(_args, ctx) {
			try {
				const r = await refreshOnce(ctx);
				ctx.ui.notify(
					r.added.length > 0
						? `openrouter-live: added ${r.added.length}: ${r.added.join(", ")}`
						: `openrouter-live: up to date (${r.total} live, 0 new)`,
					r.added.length > 0 ? "info" : "warning",
				);
			} catch (err) {
				ctx.ui.notify(
					`openrouter-live: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			}
		},
	});
}