import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { evaluateDiff, getGitDiff, type ReviewVerdict, type BatteryName } from "./engine.ts";
import { jevProvider, logReview } from "./jev-key.ts";

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

export async function checkDiffReview(ctx: ExtensionContext): Promise<ReviewVerdict | null> {
	if (inFlightReview) return inFlightReview;

	inFlightReview = (async () => {
		try {
			const diff = getGitDiff({});
			if (!diff.trim()) {
				if (ctx.hasUI) ctx.ui.setStatus("diff-review", undefined);
				return null;
			}
			const resolution = await jevProvider();
			const verdict = await evaluateDiff(diff, { provider: resolution.provider });
			logReview(verdict, resolution);
			if (ctx.hasUI) {
				// A missing key is shown, never silently cleared.
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
			return null;
		} finally {
			inFlightReview = null;
		}
	})();

	return inFlightReview;
}

export default function registerDiffReviewExtension(pi: ExtensionAPI): void {
	pi.registerCommand("diff-review", {
		description: "Run continuous System One semantic review and security gate on working tree diff",
		handler: async (args, ctx) => {
			const batteryName = (args?.trim() as BatteryName) || "all";
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

				if (!verdict.enabled) {
					pi.sendMessage({
						customType: RESULT_TYPE,
						content: `## System One Diff Review (Disabled)\n\n${verdict.summary}\n\nThe OpenRouter Jev key is read at runtime through \`pass-env\` from the names-only \`jev.env.pass\` beside this extension${resolution.reason ? ` (last attempt: ${resolution.reason})` : ""}. Unlock pass/GPG, or set \`TYPESAFE_API_KEY\` or \`OPENROUTER_API_KEY\`.`,
						display: true,
					});
					if (ctx.hasUI) ctx.ui.setStatus("diff-review", formatStatus(verdict, ctx.ui.theme));
					return;
				}

				let report = `## System One Diff Review (${verdict.provider}, ${verdict.latencyMs}ms)\n\n`;
				report += `**Stats:** +${verdict.stats.linesAdded} / -${verdict.stats.linesRemoved} across ${verdict.stats.filesChanged} file(s)\n\n`;

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
		if (!ctx.hasUI) return;
		try {
			ctx.ui.setStatus("diff-review", undefined);
		} catch {
			// Context may be inactive
		}
	});
}
