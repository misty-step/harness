import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Per-account state shared by every Pi process: block deadline and last pick. */
export type PoolState = Record<string, { blockedUntil?: number; lastUsed?: number }>;

const limit = /usage limit|limit exceeded|rate.?limit|too many requests|\b429\b|quota|insufficient|credit|\b402\b|exhaust|overloaded/i;
const MINUTE = 60_000;

/**
 * Epoch ms until which an account is blocked after a failed request, or
 * `undefined` when the failure is not a capacity failure (the caller then
 * surfaces it instead of rotating). Uses the provider's stated reset (`~N min`,
 * `retry after N s`) and otherwise a conservative default: 5 min for a rate
 * limit, 60 min for an exhausted allowance.
 */
export function blockedUntil(errorMessage: string | undefined, now: number): number | undefined {
	if (!errorMessage || !limit.test(errorMessage)) return undefined;
	const mins = errorMessage.match(/~(\d+)\s*min/i);
	if (mins) return now + Math.max(1, Number(mins[1])) * MINUTE;
	const secs = errorMessage.match(/retry.?after\D{0,10}(\d+)\s*s/i);
	if (secs) return now + Number(secs[1]) * 1000;
	return now + (/usage limit|limit exceeded|quota|credit|insufficient|exhaust|\b402\b/i.test(errorMessage) ? 60 : 5) * MINUTE;
}

/**
 * The account to use next: the sticky one while it stays usable (keeps prompt
 * caches warm), else the least recently used unblocked account, so concurrent
 * sessions spread across accounts.
 */
export function pickMember(members: readonly string[], state: PoolState, now: number, skip: ReadonlySet<string>, sticky?: string): string | undefined {
	const usable = members.filter((m) => !skip.has(m) && (state[m]?.blockedUntil ?? 0) <= now);
	if (sticky && usable.includes(sticky)) return sticky;
	return usable.sort((a, b) => (state[a]?.lastUsed ?? 0) - (state[b]?.lastUsed ?? 0))[0];
}

export interface PoolStore {
	read(): PoolState;
	update(member: string, patch: PoolState[string]): void;
}

export function fileStore(path: string): PoolStore {
	const read = (): PoolState => {
		try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}; } catch { return {}; }
	};
	return {
		read,
		update(member: string, patch: PoolState[string]) {
			const state = read();
			state[member] = { ...state[member], ...patch };
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(`${path}.${process.pid}`, JSON.stringify(state, null, 2), { mode: 0o600 });
			renameSync(`${path}.${process.pid}`, path);
		},
	};
}

export interface Rotation {
	/** Start a real request on the member; undefined when the member has no login. */
	start(member: string): AssistantMessageEventStream | undefined;
	store: PoolStore;
	members: readonly string[];
	poolId: string;
	model: { id: string; api: AssistantMessage["api"] };
	/** The stream handed back to Pi; the caller builds it so this module stays runtime-import free. */
	out: AssistantMessageEventStream;
	onServe?(member: string): void;
}

function failure(r: Rotation, message: string): AssistantMessage {
	const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	return {
		role: "assistant", content: [], api: r.model.api, provider: r.poolId, model: r.model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zero },
		stopReason: "error", errorMessage: message, timestamp: Date.now(),
	};
}

/**
 * One request through the pool. A member that fails on capacity before
 * producing any output is blocked until its reset and the same request moves
 * to the next member; any other failure, or one after output began, is passed
 * through unchanged.
 */
export function rotate(r: Rotation, sticky: { member?: string }): AssistantMessageEventStream {
	const { out } = r;
	void (async () => {
		const skip = new Set<string>();
		let lastError = "no account in the pool has a login";
		for (;;) {
			const now = Date.now();
			const member = pickMember(r.members, r.store.read(), now, skip, sticky.member);
			if (!member) break;
			const stream = r.start(member);
			skip.add(member);
			if (!stream) continue;
			if (sticky.member !== member) r.store.update(member, { lastUsed: now });
			sticky.member = member;
			r.onServe?.(member);
			let head: Parameters<typeof out.push>[0] | undefined;
			let emitted = false;
			for await (const event of stream) {
				if (event.type === "error" && !emitted) {
					lastError = event.error.errorMessage ?? lastError;
					const until = blockedUntil(lastError, Date.now());
					if (until === undefined) { out.push(event); return; }
					r.store.update(member, { blockedUntil: until });
					sticky.member = undefined;
					break;
				}
				if (event.type === "start" && !emitted) { head = event; continue; }
				if (head) { out.push(head); head = undefined; }
				emitted = true;
				out.push(event);
			}
			if (emitted) return;
		}
		out.push({ type: "error", reason: "error", error: failure(r, `${r.poolId}: every account is blocked or signed out (last: ${lastError})`) });
	})();
	return out;
}
