import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { evaluateDiff, getGitDiff, type ReviewVerdict, type BatteryName } from "./engine.ts";
import { jevProvider, logReview } from "./jev-key.ts";

const AUTO_REVIEW_MAX_CHARS = 20_000;
const RESULT_TYPE = "diff-review/report";

function formatStatus(verdict: ReviewVerdict, theme?: ExtensionContext["ui"]["theme"]): string {
	const statusIndent = "\u2800";
	if (!verdict.enabled) {
		return theme ? `${statusIndent}${theme.fg("dim", "diff: no-key")}` : `${statusIndent}diff: no-key`;
	}
	if (verdict.clean) {
		const icon = "✔";
		const text = "diff: clean";
		return theme ? `${statusIndent}${theme.fg("success", icon)} ${theme.bold(text)}` : `${statusIndent}${icon} ${text}`;
	}
	if (verdict.warnings.some((warning) => warning.rule === "provider_error")) {
		const text = "diff: review incomplete";
		return theme ? `${statusIndent}${theme.fg("warning", text)}` : `${statusIndent}${text}`;
	}
	if (verdict.blocks.length > 0) {
		const icon = "✖";
		const text = `diff: ${verdict.blocks.length} block(s)`;
		return theme ? `${statusIndent}${theme.fg("error", icon)} ${theme.bold(text)}` : `${statusIndent}${icon} ${text}`;
	}
	const icon = "⚠";
	const text = `diff: ${verdict.warnings.length} warn(s)`;
	return theme ? `${statusIndent}${theme.fg("warning", icon)} ${theme.bold(text)}` : `${statusIndent}${icon} ${text}`;
}

let inFlightReview: Promise<ReviewVerdict | null> | null = null;
let lastReviewedDiff: string | null = null;
let lastDeferredDiff: string | null = null;

export async function checkDiffReview(ctx: ExtensionContext): Promise<ReviewVerdict | null> {
	if (inFlightReview) return inFlightReview;

	inFlightReview = Promise.resolve().then(async () => {
		try {
			const diff = getGitDiff({});
			if (!diff.trim()) {
				lastReviewedDiff = null;
				lastDeferredDiff = null;
				if (ctx.hasUI) ctx.ui.setStatus("diff-review", undefined);
				return null;
			}
			if (diff.length > AUTO_REVIEW_MAX_CHARS && diff === lastReviewedDiff) return null;
			if (diff.length > AUTO_REVIEW_MAX_CHARS) {
				lastReviewedDiff = null;
				if (ctx.hasUI) ctx.ui.setStatus("diff-review", "diff: manual review required");
				else if (diff !== lastDeferredDiff) console.error("diff-review: manual review required; run /diff-review to cover the full working diff");
				lastDeferredDiff = diff;
				return null;
			}
			lastDeferredDiff = null;
			const resolution = await jevProvider();
			if (resolution.provider && diff === lastReviewedDiff) return null;
			const verdict = await evaluateDiff(diff, { provider: resolution.provider });
			logReview(verdict, resolution);
			lastReviewedDiff = verdict.enabled && !verdict.warnings.some((warning) => warning.rule === "provider_error")
				? diff
				: null;
			if (ctx.hasUI) {
				ctx.ui.setStatus("diff-review", formatStatus(verdict, ctx.ui.theme));
				if (verdict.blocks.length > 0) {
					const first = verdict.blocks[0];
					ctx.ui.notify(
						`diff-review: BLOCKED by [${first.category.toUpperCase()}] ${first.rule} (${first.evidence})`,
						"error",
					);
				}
			}
			return verdict;
		} catch {
			lastReviewedDiff = null;
			if (ctx.hasUI) ctx.ui.setStatus("diff-review", "diff: review unavailable");
			return null;
		} finally {
			inFlightReview = null;
		}
	});

	return inFlightReview;
}

export default function registerDiffReviewExtension(pi: ExtensionAPI): void {
	pi.registerCommand("diff-review", {
		description: "Run continuous System One semantic review and security gate on working tree diff",
		handler: async (args, ctx) => {
			const batteryName = (args?.trim() as BatteryName) || "all";
			lastReviewedDiff = null;
			if (ctx.hasUI) ctx.ui.setStatus("diff-review", "Reviewing diff…");
			try {
				const diff = getGitDiff({});
				if (!diff.trim()) {
					pi.sendMessage({
						customType: RESULT_TYPE,
						content: "No working tree diff to review. Working directory is clean.",
						display: true,
					});
					if (ctx.hasUI) ctx.ui.setStatus("diff-review", undefined);
					return;
				}

				const resolution = await jevProvider();
				const verdict = await evaluateDiff(diff, { provider: resolution.provider, batteryName });
				logReview(verdict, resolution);
				if (batteryName === "all" && verdict.enabled && !verdict.warnings.some((warning) => warning.rule === "provider_error")) {
					lastReviewedDiff = diff;
				}

				if (!verdict.enabled) {
					pi.sendMessage({
						customType: RESULT_TYPE,
						content: `## System One Diff Review (Disabled)\n\nThe dedicated OpenRouter Jev key is unavailable. It is read through \`pass-env\` from the names-only \`jev.env.pass\` beside this extension${resolution.reason ? ` (last attempt: ${resolution.reason})` : ""}. Unlock pass/GPG to review.`,
						display: true,
					});
					if (ctx.hasUI) ctx.ui.setStatus("diff-review", formatStatus(verdict, ctx.ui.theme));
					return;
				}

				let report = `## System One Diff Review (${verdict.provider}, ${verdict.latencyMs}ms)\n\n`;
				report += `**Stats:** +${verdict.stats.linesAdded} / -${verdict.stats.linesRemoved} across ${verdict.stats.filesChanged} file(s)\n\n`;
				report += `**Verdict:** ${verdict.summary}\n\n`;

				if (verdict.blocks.length > 0) {
					report += `### ❌ Blocked Violations (${verdict.blocks.length})\n`;
					for (const b of verdict.blocks) {
						report += `- **[${b.category.toUpperCase()}] ${b.rule}**: ${b.message}\n  *Evidence*: ${b.evidence}\n`;
					}
					report += "\n";
				}

				if (verdict.warnings.length > 0) {
					report += `### ⚠ Advisories (${verdict.warnings.length})\n`;
					for (const w of verdict.warnings) {
						report += `- **[${w.category.toUpperCase()}] ${w.rule}**: ${w.message}\n  *Evidence*: ${w.evidence}\n`;
					}
					report += "\n";
				}

				if (verdict.clean) {
					report += `✅ **Clean**: Diff satisfies all standing harness principles and security checks.\n`;
				}

				pi.sendMessage({ customType: RESULT_TYPE, content: report, display: true });
				if (ctx.hasUI) ctx.ui.setStatus("diff-review", formatStatus(verdict, ctx.ui.theme));
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.on("turn_end", async (_event, ctx) => {
		await checkDiffReview(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		lastReviewedDiff = null;
		lastDeferredDiff = null;
		if (!ctx.hasUI) return;
		try {
			ctx.ui.setStatus("diff-review", undefined);
		} catch {
			// Context may be inactive
		}
	});
}
