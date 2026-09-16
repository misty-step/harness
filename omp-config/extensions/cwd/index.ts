import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { normalize, resolve, sep } from "node:path";

export function formatPath(cwd: string, home: string = homedir()): string {
	const normalizedCwd = normalize(resolve(cwd));
	const normalizedHome = normalize(resolve(home));

	if (normalizedCwd === normalizedHome) {
		return "~";
	}

	const parts = normalizedCwd.split(sep).filter(Boolean);
	if (parts.length === 0) {
		return "/";
	}
	if (parts.length === 1) {
		return parts[0];
	}

	return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function formatCwdStatus(
	cwd: string,
	theme?: ExtensionContext["ui"]["theme"],
	home: string = homedir(),
): string {
	// setStatus trims ordinary leading whitespace; U+2800 retains one blank terminal cell.
	const statusIndent = "\u2800";
	const folderIcon = "";
	const formatted = formatPath(cwd, home);

	if (theme) {
		return `${statusIndent}${theme.fg("dim", folderIcon)} ${theme.bold(formatted)}`;
	}
	return `${statusIndent}${folderIcon} ${formatted}`;
}

export function refreshStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus("cwd", formatCwdStatus(ctx.cwd, ctx.ui.theme));
}

export default function registerCwdExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		refreshStatus(ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		refreshStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!ctx.hasUI) return;
		try {
			ctx.ui.setStatus("cwd", undefined);
		} catch {
			// Context might be inactive at shutdown
		}
	});
}
