/**
 * pi-chrome — composer-centered status chrome.
 *
 * Nothing sits on the composer's bottom border. Session identity is
 * right-aligned on the top border (next to pi's built-in working spinner), and
 * everything else lives in the footer below the composer:
 *
 *   ─ ─────────────────────────  ds-v4.1-flash · ◆ xhigh ─
 *    type here
 *   ──────────────────────────────────────────────────────
 *      ~/r90/olympus (  main* +2 ~1 ↑1 ) · ◆ 43% · 3.7k LOC · 40 files · +412
 *                                        ctx 12%/200k · $0.06 · ↑162k ↓48k
 *
 * The footer is indented to the editor's text column (EDITOR_PAD_X) so the
 * decorations line up under the input. Remove this file (or set "extensions"
 * exclusions in settings) to restore the stock editor and footer.
 */

import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { resolve, sep } from "node:path";

const THINKING_GLYPH = "◆";

/** Keep every rail aligned with the composer's text column. */
const EDITOR_PAD_X = 2;

/** Nerd-font glyphs; the terminal already renders icons elsewhere. */
const ICONS = {
	folder: "\uf07b",
	branch: "\ue725",
	model: "\uf2db",
	gauge: "\uf0e4",
	cost: "\uf155",
};

/** Show the current directory plus its parent, home-relative when possible. */
function formatCwd(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	const resolved = resolve(cwd);
	const homeResolved = home ? resolve(home) : "";
	if (homeResolved && resolved === homeResolved) return "~";
	const parts = resolved.split(sep).filter(Boolean);
	if (parts.length === 0) return "/";
	const tail = parts.slice(-2).join(sep);
	if (homeResolved && resolved.startsWith(homeResolved + sep)) return `~${sep}${tail}`;
	return parts.length <= 2 ? resolved : `…${sep}${tail}`;
}

function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

type GitState = {
	branch: string | null;
	dirty: boolean;
	staged: number;
	unstaged: number;
	untracked: number;
	ahead: number;
	behind: number;
};

type Totals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	cacheHit?: number;
};

function computeTotals(ctx: ExtensionContext): Totals {
	const totals: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of ctx.sessionManager.getEntries()) {
		const message = entry.type === "message" ? (entry.message as any) : undefined;
		const usage = message?.usage ?? (entry as any).usage;
		if (!usage) continue;

		totals.input += usage.input ?? 0;
		totals.output += usage.output ?? 0;
		totals.cacheRead += usage.cacheRead ?? 0;
		totals.cacheWrite += usage.cacheWrite ?? 0;
		totals.cost += usage.cost?.total ?? 0;

		if (message?.role === "assistant") {
			const prompt = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
			if (prompt > 0) totals.cacheHit = (usage.cacheRead / prompt) * 100;
		}
	}
	return totals;
}

function sanitizeStatus(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

/** Location marker: `folder cwd (branch +staged ~unstaged ?untracked ↑ahead↓behind)`. */
function formatLocation(theme: ExtensionContext["ui"]["theme"], git: GitState, cwd: string): string {
	const { branch, dirty, staged, unstaged, untracked, ahead, behind } = git;
	let branchText = "";
	if (branch) {
		const branchColor = dirty ? "warning" : "success";
		const marks: string[] = [];
		if (staged) marks.push(theme.fg("success", `+${staged}`));
		if (unstaged) marks.push(theme.fg("warning", `~${unstaged}`));
		if (untracked) marks.push(theme.fg("muted", `?${untracked}`));
		if (ahead) marks.push(theme.fg("dim", `↑${ahead}`));
		if (behind) marks.push(theme.fg("dim", `↓${behind}`));
		const detail = marks.length ? ` ${marks.join(" ")}` : "";
		branchText = ` ${theme.fg("dim", "(")}${theme.fg("dim", ICONS.branch)} ${theme.fg(branchColor, branch + (dirty ? "*" : ""))}${detail}${theme.fg("dim", ")")}`;
	}
	return `${theme.fg("dim", ICONS.folder)} ${theme.fg("muted", formatCwd(cwd))}${branchText}`;
}

class ChromeEditor extends CustomEditor {
	private ctx: ExtensionContext;
	private getThinkingLevel: () => ReturnType<ExtensionAPI["getThinkingLevel"]>;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		ctx: ExtensionContext,
		getThinkingLevel: () => ReturnType<ExtensionAPI["getThinkingLevel"]>,
	) {
		super(tui, theme, keybindings, { paddingX: EDITOR_PAD_X, embedWorkingStatus: true });
		this.ctx = ctx;
		this.getThinkingLevel = getThinkingLevel;
	}

	/** Bottom border is deliberately empty; scrolled content still owns its ↓ marker. */
	protected renderBottomBorder(width: number, hiddenLineCount: number): string {
		return super.renderBottomBorder(width, hiddenLineCount);
	}

	/**
	 * Keep pi's working spinner on the left, and right-align the model +
	 * reasoning level on the same rule.
	 */
	protected renderTopBorder(width: number, hiddenLineCount: number): string {
		const base = super.renderTopBorder(width, hiddenLineCount);
		const thm = this.ctx.ui.theme;

		const model = this.ctx.model?.id?.split("/").pop() ?? "no model";
		const level = this.getThinkingLevel();
		const glyph = thm.getThinkingBorderColor(level)(THINKING_GLYPH);
		const label =
			` ${thm.fg("dim", ICONS.model)} ${thm.fg("accent", model)} ` +
			`${thm.fg("dim", "·")} ${glyph} ${thm.fg("muted", level)} `;
		const labelWidth = visibleWidth(label);

		// Leave the spinner's left block intact; only claim the right tail when
		// there is room for both.
		if (width < labelWidth + 12) return base;
		return truncateToWidth(base, width - labelWidth, "") + label;
	}
}

export default function (pi: ExtensionAPI) {
	let activeTui: TUI | undefined;
	const gitState: GitState = {
		branch: null,
		dirty: false,
		staged: 0,
		unstaged: 0,
		untracked: 0,
		ahead: 0,
		behind: 0,
	};

	// One call yields dirty counts and upstream ahead/behind for the location.
	async function refreshGit(cwd: string): Promise<void> {
		const result = await pi
			.exec("git", ["status", "--porcelain=v2", "--branch"], { cwd, timeout: 2000 })
			.catch(() => undefined);
		const stdout = result?.stdout ?? "";

		let staged = 0;
		let unstaged = 0;
		let untracked = 0;
		let ahead = 0;
		let behind = 0;

		for (const line of stdout.split("\n")) {
			if (line.startsWith("# branch.ab ")) {
				const match = line.match(/\+(\d+)\s+-(\d+)/);
				if (match) {
					ahead = Number(match[1]);
					behind = Number(match[2]);
				}
			} else if (line.startsWith("? ")) {
				untracked += 1;
			} else if (line.startsWith("1 ") || line.startsWith("2 ")) {
				const xy = line.split(" ")[1] ?? "";
				if (xy[0] && xy[0] !== ".") staged += 1;
				if (xy[1] && xy[1] !== ".") unstaged += 1;
			}
		}

		gitState.staged = staged;
		gitState.unstaged = unstaged;
		gitState.untracked = untracked;
		gitState.ahead = ahead;
		gitState.behind = behind;
		gitState.dirty = staged + unstaged + untracked > 0;
		activeTui?.requestRender();
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		// Footer is the single lower rail: location + codebase on the left,
		// session economics on the right.
		ctx.ui.setFooter((tui, _theme, footerData) => {
			activeTui = tui;

			const syncBranch = () => {
				gitState.branch = footerData.getGitBranch();
				tui.requestRender();
			};
			syncBranch();
			const unsubscribe = footerData.onBranchChange(syncBranch);

			const component: Component & { dispose(): void } = {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					const thm = ctx.ui.theme;
					const totals = computeTotals(ctx);

					// Left: location, then extension statuses (loc, etc.).
					const statuses = Array.from(footerData.getExtensionStatuses().values())
						.map(sanitizeStatus)
						.filter(Boolean)
						.join(" · ");
					const location = formatLocation(thm, gitState, ctx.cwd);

					// Right: context window, cost, burn rate, then raw counters.
					const usage = ctx.getContextUsage();
					const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const percent = usage?.percent ?? null;
					const percentText =
						percent === null ? `?/${formatTokens(window)}` : `${percent.toFixed(1)}%/${formatTokens(window)}`;
					const percentColor =
						percent !== null && percent > 90 ? "error" : percent !== null && percent > 70 ? "warning" : "muted";
					const right: string[] = [
						`${thm.fg("dim", ICONS.gauge)} ${thm.fg(percentColor, `ctx ${percentText}`)}`,
					];
					if (totals.cost) {
						right.push(`${thm.fg("dim", ICONS.cost)} ${thm.fg("muted", `$${totals.cost.toFixed(3)}`)}`);
					}

					const counters: string[] = [];
					if (totals.input) counters.push(`↑${formatTokens(totals.input)}`);
					if (totals.output) counters.push(`↓${formatTokens(totals.output)}`);
					if (totals.cacheRead) counters.push(`R${formatTokens(totals.cacheRead)}`);
					if (totals.cacheWrite) counters.push(`W${formatTokens(totals.cacheWrite)}`);
					if ((totals.cacheRead || totals.cacheWrite) && totals.cacheHit !== undefined) {
						counters.push(`CH${totals.cacheHit.toFixed(1)}%`);
					}
					if (counters.length) right.push(thm.fg("dim", counters.join(" ")));

					const leftText =
						" ".repeat(EDITOR_PAD_X) +
						location +
						(statuses ? thm.fg("dim", " · ") + statuses : "");
					const rightText = right.join(thm.fg("dim", " · ")) + " ";
					const padding = " ".repeat(
						Math.max(1, width - visibleWidth(leftText) - visibleWidth(rightText)),
					);
					return [truncateToWidth(leftText + padding + rightText, width, "")];
				},
			};
			return component;
		});

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			activeTui = tui;
			return new ChromeEditor(tui, theme, keybindings, ctx, () => pi.getThinkingLevel());
		});

		void refreshGit(ctx.cwd);
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode === "tui") void refreshGit(ctx.cwd);
	});

	// Model/thinking live on the top border; re-render when either changes.
	pi.on("thinking_level_select", () => activeTui?.requestRender());
	pi.on("model_select", () => activeTui?.requestRender());
}