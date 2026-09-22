import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	analyzeRepo,
	formatLocReport,
	formatTrendReport,
	getCommitDeltas,
	getHeadHash,
	getTrendPoints,
	gitRoot,
	readLocCache,
	topLanguages,
	writeLocCache,
	type LocStats,
} from "./analyze.ts";

const RESULT_TYPE = "loc/report";

function formatNumber(value: number): string {
	return value.toLocaleString("en-US");
}

function formatCompactLoc(value: number): string {
	if (value < 1000) return formatNumber(value);
	const compact = (value / 1000).toFixed(1);
	return `${compact.endsWith(".0") ? compact.slice(0, -2) : compact}k`;
}

function formatNativeStatusLine(
	stats: LocStats,
	theme: ExtensionContext["ui"]["theme"],
): string {
	// setStatus trims ordinary leading whitespace; U+2800 retains one blank terminal cell.
	const statusIndent = "\u2800";
	const separator = theme.fg("dim", ` ${theme.sep.dot} `);
	const [top] = topLanguages(stats, 1);
	const share = stats.code > 0 && top ? Math.round((top[1].code / stats.code) * 100) : 0;
	const icon = top ? theme.getLangIconStyled(top[0]) : "";
	const parts = [
		statusIndent,
		icon,
		` ${share}%`,
		separator,
		theme.bold(formatCompactLoc(stats.code)),
		theme.fg("dim", " LOC"),
		separator,
		formatNumber(stats.files),
		theme.fg("dim", " files"),
	];
	return parts.join("");
}

function sendText(pi: ExtensionAPI, text: string): void {
	pi.sendMessage({ customType: RESULT_TYPE, content: text, display: true });
}

async function resolveStats(ctx: ExtensionContext): Promise<LocStats> {
	const cached = readLocCache(ctx.cwd);
	if (cached) return cached;
	const stats = await analyzeRepo(ctx.cwd);
	writeLocCache(ctx.cwd, stats);
	return stats;
}

const inFlightRefreshes = new Map<string, Promise<void>>();

export function triggerAsyncRefresh(ctx: ExtensionContext): Promise<void> | undefined {
	const root = gitRoot(ctx.cwd);
	if (!root) return;
	const headHash = getHeadHash(root);
	if (!headHash) return;
	const key = `${root}:${headHash}`;
	const existing = inFlightRefreshes.get(key);
	if (existing) return existing;

	const promise = (async () => {
		try {
			const stats = await analyzeRepo(root);
			if (stats.headHash === headHash) {
				writeLocCache(root, stats);
				if (ctx.hasUI && gitRoot(ctx.cwd) === root) {
					ctx.ui.setStatus("loc", formatNativeStatusLine(stats, ctx.ui.theme));
				}
			}
		} catch {
			// Non-fatal background calculation failure
		} finally {
			inFlightRefreshes.delete(key);
		}
	})();

	inFlightRefreshes.set(key, promise);
	return promise;
}

function refreshStatus(ctx: ExtensionContext, stats?: LocStats): void {
	if (!ctx.hasUI) return;
	const resolved = stats ?? readLocCache(ctx.cwd);
	if (!resolved || resolved.files === 0) {
		ctx.ui.setStatus("loc", undefined);
		if (!stats) triggerAsyncRefresh(ctx);
		return;
	}
	ctx.ui.setStatus("loc", formatNativeStatusLine(resolved, ctx.ui.theme));
}

export default function registerLocExtension(pi: ExtensionAPI): void {
	pi.registerCommand("loc", {
		description: "Show codebase LOC totals, language breakdown, and recent commit deltas",
		handler: async (_args, ctx) => {
			if (ctx.hasUI) ctx.ui.setStatus("loc", "Counting lines…");
			try {
				const stats = await resolveStats(ctx);
				const deltas = getCommitDeltas(ctx.cwd, 8);
				sendText(pi, formatLocReport(stats, deltas));
				refreshStatus(ctx, stats);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("loc-trend", {
		description: "Show a concise LOC trend across recent git tags or commits",
		getArgumentCompletions: (prefix) => {
			const trimmed = prefix.trim();
			if (!trimmed || /^\d+$/.test(trimmed)) {
				return [
					{ value: "5", label: "last 5 points" },
					{ value: "8", label: "last 8 points" },
					{ value: "10", label: "last 10 points" },
				];
			}
			return null;
		},
		handler: async (args, ctx) => {
			const count = Math.min(20, Math.max(3, Number(args.trim()) || 6));
			if (ctx.hasUI) ctx.ui.setStatus("loc", "Building trend…");
			try {
				sendText(pi, formatTrendReport(await getTrendPoints(ctx.cwd, count)));
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			} finally {
				refreshStatus(ctx);
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		refreshStatus(ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		refreshStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!ctx.hasUI) return;
		try {
			ctx.ui.setStatus("loc", undefined);
		} catch {
			// Extension context may already be inactive during shutdown.
		}
	});
}
