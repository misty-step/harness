#!/usr/bin/env bun
// review-check: owned standalone launcher (misty-step/harness).
/**
 * review-check — the first screen of an operator review page, measured in a
 * real headless browser before the page is shared.
 *
 * The reader must understand the whole page without scrolling: the point, and
 * every ask, on the first screen of a laptop viewport, in short blocks. Detail
 * stays one click away in `<details>` or anchors; this check never asks for
 * evidence to be deleted, only for it to sit below the first screen.
 *
 * A page marks its parts: `data-review="point"` on the one-sentence point,
 * `data-review="ask"` on each thing the reader must decide or do, or one
 * `data-review="no-ask"` element saying nothing is asked. Pages that predate the
 * markers pass their own selectors with --point and --ask.
 *
 *   point-missing / ask-missing      nothing marked: the check cannot tell what
 *                                    the page is for or asks, so it refuses to guess.
 *   point-not-visible / ask-not-visible
 *                                    a marked element is hidden, closed inside
 *                                    <details>, or not wholly inside the first
 *                                    screen: the reader has to scroll to learn it.
 *   dense-block                      one block of visible text holds more words
 *                                    than a glance takes in: a paragraph, not a point.
 *   dense-screen                     the first screen as a whole holds more words
 *                                    than a glance takes in: a document, not a page.
 *
 * Exit 0 when every page passes, 1 when any finding exists, 2 when the check
 * itself could not run (no Chromium, page did not load): never a silent pass.
 * This tool never edits files and never calls a model. It drives Chromium over
 * the DevTools protocol with Bun's own WebSocket, so it has no dependencies.
 */

import type { Subprocess } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type Rule = "point-missing" | "point-not-visible" | "ask-missing" | "ask-not-visible" | "dense-block" | "dense-screen";

export type Finding = { page: string; rule: Rule; message: string };

export type Box = { text: string; visible: boolean; top: number; left: number; bottom: number; right: number };

/** What the browser saw: marked parts and every visible text block. */
export type Measure = {
	width: number;
	height: number;
	points: Box[];
	asks: Box[];
	noAsk: Box[];
	blocks: { text: string; words: number }[];
	screenWords: number;
};

export type Limits = { width: number; height: number; maxBlockWords: number; maxScreenWords: number };

/**
 * A 13-inch laptop browser: a 1366x768 screen less tab bar, address bar and
 * system panel leaves about 1280x640. Narrow and short on purpose; a page that
 * fits here fits any wider, taller window.
 *
 * maxBlockWords: about two lines at reading width. A paragraph is where the
 * reader gives up; the 2 Oct retro's first draft opened on a 90-word one.
 * maxScreenWords: a lid on a screen of many short blocks, set above the
 * densest recut that carried eight items and six asks (236 words).
 */
export const DEFAULT_LIMITS: Limits = { width: 1280, height: 640, maxBlockWords: 35, maxScreenWords: 300 };

const excerpt = (text: string, max = 60) => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function whereIsIt(box: Box, height: number, width: number): string | null {
	if (!box.visible) return "is hidden, folded, clipped or covered";
	if (box.bottom > height + 0.5) return `ends ${Math.ceil(box.bottom - height)}px below the first screen`;
	if (box.top < -0.5) return "starts above the first screen";
	if (box.right > width + 0.5 || box.left < -0.5) return "runs past the side of the first screen";
	return null;
}

/** Pure judgment of a measurement; the browser only supplies the measure. */
export function evaluate(page: string, measure: Measure, limits: Limits = DEFAULT_LIMITS): Finding[] {
	const findings: Finding[] = [];
	const add = (rule: Rule, message: string) => findings.push({ page, rule, message });
	const { width, height } = measure;
	if (measure.points.length === 0) add("point-missing", 'no element is marked data-review="point"');
	for (const box of measure.points) {
		const problem = whereIsIt(box, height, width);
		if (problem) add("point-not-visible", `the point "${excerpt(box.text)}" ${problem}`);
	}
	if (measure.asks.length === 0 && measure.noAsk.length === 0) add("ask-missing", 'no element is marked data-review="ask" or "no-ask"');
	for (const box of [...measure.asks, ...measure.noAsk]) {
		const problem = whereIsIt(box, height, width);
		if (problem) add("ask-not-visible", `the ask "${excerpt(box.text)}" ${problem}`);
	}
	for (const block of measure.blocks) {
		if (block.words > limits.maxBlockWords) {
			add("dense-block", `${block.words} words in one block, over ${limits.maxBlockWords}: "${excerpt(block.text)}"`);
		}
	}
	if (measure.screenWords > limits.maxScreenWords) {
		add("dense-screen", `${measure.screenWords} words on the first screen, over ${limits.maxScreenWords}`);
	}
	return findings;
}

/**
 * Runs inside the page. A reader sees an element only if it is what is painted at
 * its points: an ancestor's overflow, text-overflow, or anything laid over it
 * shows something else. That one test judges a marked part (its box and every
 * line of its text) and each word counted on the first screen, grouped under its
 * nearest block-level ancestor. Closed <details> content is not rendered, so it
 * counts for nothing and its marks report as hidden. Returned by value, so it
 * stays plain JSON.
 */
const PAGE_SCRIPT = (pointSelector: string, askSelector: string) => `(async () => {
	await document.fonts.ready;
	await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
	const vw = document.documentElement.clientWidth, vh = window.innerHeight;
	const visible = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
	const hasWord = (text) => /[\\p{L}\\p{N}]/u.test(text);
	const solid = (r) => r.width > 0 && r.height > 0;
	const onScreen = (r) => solid(r) && r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
	const wholly = (r) => r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5;
	const shows = (el, x, y) => {
		const hit = document.elementFromPoint(x, y);
		return hit !== null && el.contains(hit);
	};
	const painted = (el) => {
		const text = document.createRange();
		text.selectNodeContents(el);
		return [...el.getClientRects(), ...text.getClientRects()].filter(solid).every((r) => {
			const inset = Math.min(2, r.width / 2, r.height / 2);
			return [
				[r.left + r.width / 2, r.top + r.height / 2],
				[r.left + inset, r.top + inset], [r.right - inset, r.top + inset],
				[r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset],
			].every(([x, y]) => shows(el, x, y));
		});
	};
	const box = (el) => {
		const rect = el.getBoundingClientRect();
		let shown = visible(el) && solid(rect);
		if (shown && wholly(rect)) shown = painted(el);
		return { text: el.textContent || "", visible: shown, top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
	};
	const visibleWords = (node, owner) => {
		const range = document.createRange();
		range.selectNodeContents(node);
		if (![...range.getClientRects()].some(onScreen)) return 0;
		let count = 0;
		for (const match of node.data.matchAll(/\\S+/g)) {
			if (!hasWord(match[0])) continue;
			range.setStart(node, match.index);
			range.setEnd(node, match.index + match[0].length);
			const [r] = range.getClientRects();
			if (!r || !solid(r)) continue;
			const left = Math.max(r.left, 0), right = Math.min(r.right, vw), top = Math.max(r.top, 0), bottom = Math.min(r.bottom, vh);
			if (left < right && top < bottom && shows(owner, (left + right) / 2, (top + bottom) / 2)) count++;
		}
		return count;
	};
	const blocks = new Map();
	let screenWords = 0;
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const parent = node.parentElement;
		if (!parent || !hasWord(node.data) || parent.closest("script,style,noscript,template") || !visible(parent)) continue;
		const count = visibleWords(node, parent);
		if (count === 0) continue;
		let block = parent;
		while (block.parentElement && /^(inline|contents)/.test(getComputedStyle(block).display)) block = block.parentElement;
		screenWords += count;
		const entry = blocks.get(block) || { text: "", words: 0 };
		entry.text += " " + node.data;
		entry.words += count;
		blocks.set(block, entry);
	}
	return {
		width: vw, height: vh,
		points: [...document.querySelectorAll(${JSON.stringify(pointSelector)})].map(box),
		asks: [...document.querySelectorAll(${JSON.stringify(askSelector)})].map(box),
		noAsk: [...document.querySelectorAll('[data-review="no-ask"]')].map(box),
		blocks: [...blocks.values()],
		screenWords,
	};
})()`;

export function findChromium(env: Record<string, string | undefined> = process.env): string {
	const override = env.REVIEW_CHECK_CHROMIUM;
	if (override) {
		const found = Bun.which(override);
		if (!found) throw new Error(`REVIEW_CHECK_CHROMIUM is not an executable: ${override}`);
		return found;
	}
	for (const name of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
		const found = Bun.which(name);
		if (found) return found;
	}
	throw new Error("no Chromium found on PATH (chromium, chromium-browser, google-chrome); set REVIEW_CHECK_CHROMIUM");
}

type CdpMessage = { id?: number; method?: string; sessionId?: string; result?: unknown; error?: { message: string; code: number } };
type Settled = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/** Reject `promise` if it has not settled in `ms`, so a stuck page never hangs the check. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	const timeout = Promise.withResolvers<never>();
	const timer = setTimeout(() => timeout.reject(new Error(`${what} took more than ${ms}ms`)), ms);
	try {
		return await Promise.race([promise, timeout.promise]);
	} finally {
		clearTimeout(timer);
	}
}

/** One headless Chromium, driven over its DevTools WebSocket. */
class Browser {
	private socket!: WebSocket;
	private next = 0;
	private pending = new Map<number, Settled>();
	private waiters: { method: string; session: string; resolve: () => void }[] = [];
	private child!: Subprocess<"ignore", "ignore", "pipe">;
	// Chromium makes its singleton socket (<dir>/org.chromium.Chromium.XXXXXX/SingletonSocket) under $TMPDIR,
	// and a Unix socket path holds 107 bytes. A deep run-scoped TMPDIR would crash the launch, so the
	// disposable profile, which also serves as the browser's TMPDIR, moves to /tmp then.
	private profile = mkdtempSync(join(tmpdir().length <= 48 ? tmpdir() : "/tmp", "rc-"));
	private tail = "";

	static async launch(timeoutMs: number): Promise<Browser> {
		const browser = new Browser();
		try {
			const args = [
				"--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
				// A cold start otherwise probes the network, the keyring and the update service before it serves a page.
				"--disable-background-networking", "--disable-component-update", "--disable-sync", "--metrics-recording-only",
				"--password-store=basic", "--use-mock-keychain", "--force-color-profile=srgb",
				"--remote-debugging-port=0", `--user-data-dir=${browser.profile}`, "about:blank",
			];
			if (process.getuid?.() === 0) args.unshift("--no-sandbox");
			browser.child = Bun.spawn([findChromium(), ...args], {
				stdout: "ignore", stderr: "pipe", detached: true, env: { ...process.env, TMPDIR: browser.profile },
			});
			for (const signal of ["SIGINT", "SIGTERM"] as const) {
				process.once(signal, () => {
					browser.kill();
					rmSync(browser.profile, { recursive: true, force: true });
					process.exit(130);
				});
			}
			const endpoint = await within(browser.devtoolsEndpoint(), timeoutMs, "Chromium opening DevTools");
			browser.socket = new WebSocket(endpoint);
			const opened = Promise.withResolvers<void>();
			browser.socket.onopen = () => opened.resolve();
			browser.socket.onerror = () => opened.reject(new Error(`cannot connect to Chromium DevTools at ${endpoint}`));
			await within(opened.promise, timeoutMs, "connecting to Chromium DevTools");
			browser.socket.onmessage = (event) => browser.onMessage(String(event.data));
			browser.socket.onclose = () => browser.failPending(new Error("Chromium closed the DevTools connection"));
			return browser;
		} catch (error) {
			await browser.close();
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(browser.tail ? `${reason}\n${browser.tail.trim()}` : reason);
		}
	}

	/** Resolves with the DevTools URL; keeps draining stderr so Chromium never blocks on a full pipe. */
	private devtoolsEndpoint(): Promise<string> {
		const endpoint = Promise.withResolvers<string>();
		void this.child.exited.then((code) => {
			endpoint.reject(new Error(`Chromium exited with code ${code} before DevTools opened`));
		});
		void (async () => {
			const decoder = new TextDecoder();
			for await (const chunk of this.child.stderr) {
				this.tail = (this.tail + decoder.decode(chunk)).slice(-2000);
				const match = this.tail.match(/DevTools listening on (ws:\/\/\S+)/);
				if (match) endpoint.resolve(match[1]);
			}
		})();
		return endpoint.promise;
	}

	private failPending(error: Error) {
		for (const settled of this.pending.values()) settled.reject(error);
		this.pending.clear();
	}

	private onMessage(raw: string) {
		const message = JSON.parse(raw) as CdpMessage;
		if (message.id !== undefined) {
			const settled = this.pending.get(message.id);
			if (!settled) return;
			this.pending.delete(message.id);
			if (message.error) settled.reject(new Error(`${message.error.message} (${message.error.code})`));
			else settled.resolve(message.result);
			return;
		}
		this.waiters = this.waiters.filter((waiter) => {
			if (waiter.method !== message.method || waiter.session !== message.sessionId) return true;
			waiter.resolve();
			return false;
		});
	}

	private send<T = Record<string, never>>(method: string, params: object = {}, session?: string): Promise<T> {
		const id = ++this.next;
		const settled = Promise.withResolvers<unknown>();
		this.pending.set(id, settled);
		this.socket.send(JSON.stringify({ id, method, params, sessionId: session }));
		return settled.promise as Promise<T>;
	}

	/** Open the url in a fresh tab sized to the viewport and evaluate the script there. */
	async inspect(url: string, limits: Limits, script: string, screenshot: string | undefined, timeoutMs: number): Promise<Measure> {
		const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
		try {
			return await within(this.measure(targetId, url, limits, script, screenshot), timeoutMs, url);
		} finally {
			await this.send("Target.closeTarget", { targetId }).catch(() => undefined);
		}
	}

	private async measure(targetId: string, url: string, limits: Limits, script: string, screenshot: string | undefined): Promise<Measure> {
		const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
		await this.send("Emulation.setDeviceMetricsOverride", { width: limits.width, height: limits.height, deviceScaleFactor: 1, mobile: false }, sessionId);
		await this.send("Page.enable", {}, sessionId);
		const loaded = Promise.withResolvers<void>();
		this.waiters.push({ method: "Page.loadEventFired", session: sessionId, resolve: loaded.resolve });
		const { errorText } = await this.send<{ errorText?: string }>("Page.navigate", { url }, sessionId);
		if (errorText) throw new Error(`${url} did not load: ${errorText}`);
		await loaded.promise;
		const { result, exceptionDetails } = await this.send<{
			result: { value: Measure };
			exceptionDetails?: { text: string; exception?: { description?: string } };
		}>("Runtime.evaluate", { expression: script, awaitPromise: true, returnByValue: true }, sessionId);
		if (exceptionDetails) throw new Error(`page script failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
		if (screenshot) {
			const { data } = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png" }, sessionId);
			writeFileSync(screenshot, Buffer.from(data, "base64"));
		}
		return result.value;
	}

	/** SIGKILL the whole process group: Chromium's helpers outlive its main process and would rewrite the profile. */
	kill() {
		try {
			process.kill(-this.child.pid, "SIGKILL");
		} catch {
			// The group is already gone.
		}
	}

	async close() {
		try {
			this.socket?.close();
		} catch {
			// Already closed; the process group is killed next either way.
		}
		if (this.child) {
			this.kill();
			await this.child.exited;
		}
		rmSync(this.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
	}
}

export type Options = {
	pages: string[];
	viewport: { width: number; height: number };
	point: string;
	ask: string;
	screenshot?: string;
	json: boolean;
};

const USAGE = "usage: review-check [--viewport WxH] [--point SELECTOR] [--ask SELECTOR] [--screenshot FILE.png] [--json] <page.html|https://url>...";

export function parseArgs(argv: string[]): Options {
	const options: Options = {
		pages: [], viewport: { width: DEFAULT_LIMITS.width, height: DEFAULT_LIMITS.height },
		point: '[data-review="point"]', ask: '[data-review="ask"]', json: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = () => {
			const next = argv[++i];
			if (next === undefined) throw new Error(`${arg} needs a value\n${USAGE}`);
			return next;
		};
		if (arg === "--json") options.json = true;
		else if (arg === "--point") options.point = value();
		else if (arg === "--ask") options.ask = value();
		else if (arg === "--screenshot") options.screenshot = value();
		else if (arg === "--viewport") {
			const match = value().match(/^(\d+)x(\d+)$/);
			if (!match) throw new Error(`--viewport takes WIDTHxHEIGHT, for example 1280x640\n${USAGE}`);
			options.viewport = { width: Number(match[1]), height: Number(match[2]) };
		} else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}\n${USAGE}`);
		else options.pages.push(arg);
	}
	if (options.pages.length === 0) throw new Error(USAGE);
	if (options.screenshot && options.pages.length > 1) throw new Error("--screenshot takes exactly one page");
	return options;
}

export async function main(argv: string[]): Promise<number> {
	let options: Options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 2;
	}
	const limits: Limits = { ...DEFAULT_LIMITS, ...options.viewport };
	const timeoutMs = 30_000;
	let browser: Browser | undefined;
	try {
		browser = await Browser.launch(timeoutMs);
		const script = PAGE_SCRIPT(options.point, options.ask);
		const report: { page: string; measure: Measure; findings: Finding[] }[] = [];
		for (const page of options.pages) {
			const url = /^https?:\/\//.test(page) ? page : pathToFileURL(resolve(page)).href;
			const measure = await browser.inspect(url, limits, script, options.screenshot, timeoutMs);
			report.push({ page, measure, findings: evaluate(page, measure, limits) });
		}
		const failed = report.some((entry) => entry.findings.length > 0);
		if (options.json) {
			console.log(JSON.stringify(report, null, 2));
		} else {
			for (const { page, measure, findings } of report) {
				for (const finding of findings) console.log(`${page}: [${finding.rule}] ${finding.message}`);
				const longest = Math.max(0, ...measure.blocks.map((block) => block.words));
				const lowest = Math.round(Math.max(0, ...[...measure.points, ...measure.asks, ...measure.noAsk].map((box) => box.bottom)));
				const state = findings.length ? `${findings.length} finding(s)` : "ok";
				console.log(
					`review-check: ${page}: ${state} at ${measure.width}x${measure.height} ` +
					`(point ${measure.points.length}, asks ${measure.asks.length + measure.noAsk.length}, lowest ends ${lowest}px, ` +
					`${measure.screenWords} words, longest block ${longest})`,
				);
			}
		}
		return failed ? 1 : 0;
	} catch (error) {
		console.error(`review-check: internal_error: ${error instanceof Error ? error.message : String(error)}`);
		return 2;
	} finally {
		await browser?.close();
	}
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2));
