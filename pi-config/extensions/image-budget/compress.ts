/**
 * Best-effort image shrinking for extensions/image-budget. ffmpeg is the only
 * image codec pi-config can assume on this host; this module fails open — an
 * image it cannot shrink is returned untouched, and the request-time budget
 * (budget.ts) still holds the hard line.
 *
 * Shrinking here, at ingestion, is what keeps a long visual-QA session inside
 * the budget: pi's own `images.autoResize` caps dimensions at 2000px but keeps
 * the PNG lossless, so a Chromium screenshot still costs 1-2.5 MB — nearly two
 * orders of magnitude more than the same frame as a high-quality JPEG. The
 * session file shrinks with it.
 *
 * Scratch goes under TMPDIR (run-scoped, ADR-015) and never /tmp.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { decodedBytes, type ImageContent } from "./budget.ts";

/** Shrink images above this size; below it the wire cost is not worth a process. */
export const COMPRESS_THRESHOLD_BYTES = 600 * 1024;

/** Longest edge after scaling. Keeps UI text and contact sheets legible. */
export const MAX_EDGE_PX = 1536;

/** mjpeg quality (2 best .. 31 worst); 5 keeps UI text crisp at ~10% of PNG. */
const JPEG_QUALITY = "5";

const FFMPEG_TIMEOUT_MS = 20_000;

/** TMPDIR when the launch hook set it (ADR-015); the shared scratch root otherwise. */
function scratchRoot(): string {
	const fromEnv = process.env.TMPDIR?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), ".cache", "tmp");
}

/**
 * Re-encode `part` as a smaller JPEG, or return null when there is nothing
 * worth doing: the image is already small, ffmpeg is missing, or the result
 * would not be smaller. Callers keep the original on null.
 */
export async function shrinkImage(part: ImageContent): Promise<ImageContent | null> {
	const originalBytes = decodedBytes(part.data);
	if (originalBytes <= COMPRESS_THRESHOLD_BYTES) return null;

	const root = scratchRoot();
	await mkdir(root, { recursive: true });
	const dir = await mkdtemp(join(root, "pi-image-budget-"));
	try {
		const input = join(dir, "in");
		const output = join(dir, "out.jpg");
		await writeFile(input, Buffer.from(part.data, "base64"));
		await runFfmpeg([
			"-hide_banner",
			"-loglevel",
			"error",
			"-nostdin",
			"-i",
			input,
			"-frames:v",
			"1",
			"-map_metadata",
			"-1",
			"-vf",
			`scale='min(${MAX_EDGE_PX},iw)':'min(${MAX_EDGE_PX},ih)':force_original_aspect_ratio=decrease`,
			"-q:v",
			JPEG_QUALITY,
			"-y",
			output,
		]);
		const encoded = await readFile(output);
		if (encoded.length === 0 || encoded.length >= originalBytes) return null;
		return { type: "image", data: encoded.toString("base64"), mimeType: "image/jpeg" };
	} catch {
		return null;
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

function runFfmpeg(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
			if (stderr.length > 4000) stderr = stderr.slice(-4000);
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms`));
		}, FFMPEG_TIMEOUT_MS);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`));
		});
	});
}
