import { createHash } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { DeliveryState, NativeAdapter, NativeResult, ReviewReceipt, RunState, TaskSpec } from "../summon/contract";
import { SummonError, SummonStore, validateTaskSpec } from "../summon/core";
import { command } from "./command";

/** Exact camelCase wire shape from mage/src/transport.rs::Envelope. */
export interface MageEnvelope {
	deliveryId: string; sessionId: string; sessionFile: string;
	kind: "commission" | "completion" | "decision"; payload: string;
	runId?: string; commissionRef?: string; inputId?: string;
}
type Vendor = "anthropic" | "google" | "openai";
interface LaneCommand { argv: string[]; vendor: Vendor; accountId: string }
export interface AdmissionRequest {
	commission: MageEnvelope;
	laneId: string;
	engineer: LaneCommand;
	reviewer: LaneCommand;
	usageReader: { argv: string[] };
	policy: { maxAgeMs: number; maxUsedPercent: number; readerTimeoutMs: number; commandTimeoutMs: number };
	authorization?: { authorized: boolean; digest: string; expiresAt: number; evidence: string[] };
	occupancy?: { laneId: string; status: "idle" | "occupied" | "unknown"; observedAt: number; evidence: string[] };
}
export interface AdmissionResult {
	status: "refused" | "unknown" | "block" | "pass";
	code: string;
	launches: { engineer: number; reviewer: number };
	run?: { runId: string; state: RunState; deliveryState: DeliveryState; deliveryDigest: string };
	review?: ReviewReceipt;
	envelope?: MageEnvelope;
}
class Refusal extends Error { constructor(public code: string) { super(code); } }
function requireThat(ok: unknown, code = "invalid_input"): asserts ok { if (!ok) throw new Refusal(code); }
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value); }
function evidence(value: unknown): boolean { return Array.isArray(value) && value.length > 0 && value.every(text); }
function canonical(value: any): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
}
function sha(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function commissionDigest(value: unknown): string {
	requireThat(object(value));
	const { commission, laneId, engineer, reviewer, usageReader, policy } = value;
	requireThat([commission, laneId, engineer, reviewer, usageReader, policy].every(item => item !== undefined));
	return sha(canonical({ commission, laneId, engineer, reviewer, usageReader, policy }));
}
function argv(value: unknown): boolean { return Array.isArray(value) && value.length > 0 && text(value[0]) && value.every(arg => typeof arg === "string" && !arg.includes("\0")); }
function integer(value: unknown, max: number): boolean { return Number.isInteger(value) && (value as number) > 0 && (value as number) <= max; }
function fresh(at: unknown, now: number, maxAge: number): boolean { return typeof at === "number" && Number.isFinite(at) && at <= now && at >= now - maxAge; }
function parse(value: unknown): { request: AdmissionRequest; task: TaskSpec } {
	requireThat(object(value));
	requireThat(Object.keys(value).every(key => ["commission", "laneId", "engineer", "reviewer", "usageReader", "policy", "authorization", "occupancy"].includes(key)));
	const e = value.commission;
	requireThat(object(e) && Object.keys(e).every(key => ["deliveryId", "sessionId", "sessionFile", "kind", "payload", "runId", "commissionRef", "inputId"].includes(key)));
	requireThat(text(e.deliveryId) && e.deliveryId.length <= 200 && text(e.sessionId) && text(e.sessionFile) && isAbsolute(e.sessionFile));
	requireThat(e.kind === "commission" && typeof e.payload === "string" && Buffer.byteLength(e.payload) > 0 && Buffer.byteLength(e.payload) < 128 * 1024);
	requireThat([e.runId, e.commissionRef, e.inputId].every(item => item === undefined || text(item)));
	const task = validateTaskSpec(JSON.parse(e.payload));
	requireThat(task.id === e.runId && !task.id.startsWith("cf1:") && task.checks.length === 1 && task.checks[0]!.type === "review");
	requireThat(text(value.laneId));
	for (const lane of [value.engineer, value.reviewer]) {
		requireThat(object(lane) && Object.keys(lane).every(key => ["argv", "vendor", "accountId"].includes(key)) && argv(lane.argv) && ["anthropic", "google", "openai"].includes(lane.vendor) && text(lane.accountId));
	}
	requireThat(value.engineer.vendor === (task.route.provider === "anthropic" ? "anthropic" : "google"), "invalid_route");
	requireThat(value.engineer.vendor !== value.reviewer.vendor, "same_vendor_review");
	requireThat(object(value.usageReader) && Object.keys(value.usageReader).every(key => key === "argv") && argv(value.usageReader.argv), "unknown_usage");
	const p = value.policy;
	requireThat(object(p) && Object.keys(p).every(key => ["maxAgeMs", "maxUsedPercent", "readerTimeoutMs", "commandTimeoutMs"].includes(key)));
	requireThat(integer(p.maxAgeMs, 300000) && typeof p.maxUsedPercent === "number" && p.maxUsedPercent > 0 && p.maxUsedPercent <= 90 && integer(p.readerTimeoutMs, 5000) && integer(p.commandTimeoutMs, 300000));
	return { request: value as unknown as AdmissionRequest, task };
}
function authorize(r: AdmissionRequest, now: number): void {
	const a = r.authorization;
	requireThat(object(a) && a.authorized === true && a.digest === commissionDigest(r) && typeof a.expiresAt === "number" && Number.isFinite(a.expiresAt) && a.expiresAt > now && evidence(a.evidence), "invalid_authorization");
}
function occupancy(r: AdmissionRequest, now: number): void {
	const o = r.occupancy;
	requireThat(object(o) && o.laneId === r.laneId && evidence(o.evidence) && fresh(o.observedAt, now, r.policy.maxAgeMs), "unknown_occupancy");
	requireThat(o.status !== "occupied", "lane_occupied");
	requireThat(o.status === "idle", "unknown_occupancy");
}
function checkUsage(value: unknown, r: AdmissionRequest, now: number): void {
	requireThat(object(value) && Array.isArray(value.readings) && value.readings.length === 2, "unknown_usage");
	for (const seat of [r.engineer, r.reviewer]) {
		const readings = value.readings.filter((reading: any) => object(reading) && reading.vendor === seat.vendor && reading.accountId === seat.accountId);
		requireThat(readings.length === 1, "unknown_usage");
		const reading = readings[0];
		requireThat(fresh(reading.observedAt, now, r.policy.maxAgeMs) && evidence(reading.evidence) && typeof reading.capped === "boolean" && typeof reading.usedPercent === "number" && Number.isFinite(reading.usedPercent) && reading.usedPercent >= 0 && reading.usedPercent <= 100, "unknown_usage");
	}
	// Validate ALL evidence before evaluating quota, preserving unknown evidence.
	requireThat(value.readings.every((reading: any) => !reading.capped && reading.usedPercent < r.policy.maxUsedPercent), "quota_exhausted");
}
function privateDir(path: string): void {
	requireThat(isAbsolute(path) && realpathSync(path) === path, "state_unavailable");
	const stat = lstatSync(path);
	requireThat(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid!(), "state_unavailable");
}
function exclusive(path: string, contents: unknown): void {
	const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
	try { writeFileSync(fd, `${JSON.stringify(contents)}\n`); fsyncSync(fd); }
	finally { closeSync(fd); }
	const parent = openSync(join(path, ".."), constants.O_RDONLY);
	try { fsyncSync(parent); } finally { closeSync(parent); }
}
function exists(path: string): boolean {
	try { lstatSync(path); return true; } catch (error: any) { if (error.code === "ENOENT") return false; throw error; }
}
function result(code: string, status: AdmissionResult["status"] = "refused"): AdmissionResult { return { status, code, launches: { engineer: 0, reviewer: 0 } }; }

export async function admit(value: unknown, stateDir: string): Promise<AdmissionResult> {
	let r: AdmissionRequest, task: TaskSpec;
	try {
		({ request: r, task } = parse(value));
		authorize(r, Date.now()); occupancy(r, Date.now());
	} catch (error) { return result(error instanceof Refusal ? error.code : "invalid_input"); }
	const response = result("unknown_usage");
	let guard: string | undefined;
	let attempted = false;
	let settled = false;
	let store: SummonStore | undefined;
	const finish = (status: AdmissionResult["status"], code: string): AdmissionResult => {
		response.status = status; response.code = code;
		if (attempted) {
			try {
				const inspection = store!.inspect(task.id);
				response.run = { runId: task.id, state: inspection.state, deliveryState: inspection.turns.at(-1)!.state, deliveryDigest: inspection.deliveryDigest };
				if (response.status === "pass" && (inspection.state !== "verified_delivery" || response.review?.deliveryDigest !== inspection.deliveryDigest)) {
					response.status = "block"; response.code = "delivery_changed";
				}
			} catch { response.status = "unknown"; response.code = "state_unavailable"; settled = false; }
			response.envelope = { ...r.commission, deliveryId: sha(`${r.commission.deliveryId}:completion`), kind: "completion", payload: JSON.stringify(response) };
		}
		return response;
	};
	try {
		try {
			privateDir(stateDir);
			const root = join(stateDir, "admission");
			mkdirSync(root, { mode: 0o700 });
		} catch (error: any) { if (error.code !== "EEXIST") throw new Refusal("state_unavailable"); }
		const root = join(stateDir, "admission"); privateDir(root);
		const marker = join(root, `task-${sha(task.id)}.attempt`);
		if (exists(marker)) return finish("unknown", "reconciliation_required");
		const lock = join(root, `lane-${sha(r.laneId)}.guard`);
		try { exclusive(lock, { runId: task.id, digest: commissionDigest(r) }); }
		catch (error: any) { throw new Refusal(error.code === "EEXIST" ? "lane_occupied" : "state_unavailable"); }
		guard = lock;
		store = new SummonStore(stateDir);
		try {
			store.status(task.id);
			return finish("unknown", "reconciliation_required");
		} catch (error) {
			if (!(error instanceof SummonError && error.code === "NOT_FOUND")) throw new Refusal("state_unavailable");
		}
		let usage: unknown;
		try { usage = await command(r.usageReader.argv, { runId: task.id, laneId: r.laneId, accounts: [r.engineer, r.reviewer].map(({ vendor, accountId }) => ({ vendor, accountId })) }, task.workspace, r.policy.readerTimeoutMs); }
		catch { throw new Refusal("unknown_usage"); }
		// Waiting on a reader cannot make earlier authority/occupancy evidence fresh.
		authorize(r, Date.now()); occupancy(r, Date.now()); checkUsage(usage, r, Date.now());
		const initial = store.start(task);
		// Existing native turns or steering belong to their owner, not this one-shot path.
		requireThat(initial.turns.length === 1 && initial.turns[0]!.state === "queued" && !initial.owner, "reconciliation_required");
		try { exclusive(marker, { runId: task.id, digest: commissionDigest(r) }); }
		catch (error: any) { throw new Refusal(error.code === "EEXIST" ? "reconciliation_required" : "state_unavailable"); }
		attempted = true;
		const adapter: NativeAdapter = {
			id: task.route.harness,
			capabilities: { resume: false, liveSteering: false, acknowledgement: "native-replay" },
			preflight: async () => {},
			invoke: async (request) => {
				response.launches.engineer++;
				const reply: any = await command(r.engineer.argv, { request, envelope: r.commission }, task.workspace, r.policy.commandTimeoutMs);
				requireThat(object(reply) && reply.vendor === r.engineer.vendor && object(reply.result));
				const native = reply.result;
				requireThat(typeof native.completed === "boolean" && typeof native.acknowledged === "boolean");
				requireThat(text(native.sessionId) && native.model === task.route.model);
				return native as NativeResult;
			},
		};
		try { await store.run(task.id, adapter); }
		catch { return finish("unknown", "engineer_uncertain"); }
		const delivery = store.inspect(task.id);
		if (!delivery.readyForReview) { settled = true; return finish("block", "delivery_changed"); }
		response.launches.reviewer++;
		let reply: any;
		try { reply = await command(r.reviewer.argv, { task, delivery, envelope: r.commission }, task.workspace, r.policy.commandTimeoutMs); }
		catch { return finish("unknown", "review_unknown"); }
		if (object(reply) && (reply.receipt === null || (object(reply.receipt) && ["unknown", "uncertain"].includes(reply.receipt.verdict)))) return finish("unknown", "review_unknown");
		settled = true;
		if (!object(reply) || reply.vendor !== r.reviewer.vendor || reply.vendor === r.engineer.vendor || !object(reply.receipt)) return finish("block", "invalid_review");
		const receipt = reply.receipt;
		if (receipt.runId !== task.id || receipt.checkId !== task.checks[0]!.id || receipt.deliveryDigest !== delivery.deliveryDigest || receipt.reviewer !== `${r.reviewer.vendor}:${r.reviewer.accountId}` || !evidence(receipt.evidence) || !["pass", "block"].includes(receipt.verdict)) return finish("block", "invalid_review");
		try {
			const reviewed = store.review(receipt);
			response.review = receipt;
			return finish(reviewed.state === "verified_delivery" ? "pass" : "block", reviewed.state === "verified_delivery" ? "verified_delivery" : "review_blocked");
		} catch { return finish("block", "delivery_changed"); }
	} catch (error) {
		const code = error instanceof Refusal ? error.code : "state_unavailable";
		return finish(attempted || code === "reconciliation_required" ? "unknown" : "refused", code);
	} finally {
		if (guard && (!attempted || settled)) {
			try { unlinkSync(guard); }
			catch { finish("unknown", "state_unavailable"); }
		}
	}
}
