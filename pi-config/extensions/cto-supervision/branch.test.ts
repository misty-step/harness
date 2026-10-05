import { expect, test } from "bun:test";
import { ACK_TOOL, EVENT, PASS, PRIMARY, SESSION, TIMER, WAKE, nextWake, snapshot, validateAck, wakeContent, type Event } from "./branch";

const event: Event = { schema: "cto-supervision.event/1", event_id: "original-completion", target_session_id: SESSION, kind: "completion", worker: "original-worker", commission_id: PRIMARY, source_ref: "original-native-message:abcd1234", summary: "Worker stopped at its existing hold" };
const original = { type: "custom", id: "11111111", customType: EVENT, data: event };
const pass = { pass_id: "original-pass", event_ids: [event.event_id], reason: "event" };
const intent = { type: "custom", id: "22222222", customType: PASS, data: pass };
const message = { type: "custom_message", id: "33333333", customType: WAKE, details: pass, content: "original wake", display: true };
const action = { type: "message", id: "44444444", message: { role: "toolResult", toolName: "bash", toolCallId: "original-action", isError: false, content: [{ type: "text", text: "original readback" }] } };
const input = { pass_id: pass.pass_id, action_entry_ids: [action.id], source_refs: ["original-board-readback:abcd1234"], summary: "Original owner retained; hold and next boundary sourced" };
// These are independent native-entry shapes, not copies of the state implementation.
const entries = (values: unknown[]) => values as Parameters<typeof snapshot>[0];

test("original events coalesce; may-have-sent is not inferred unsent on restart", () => {
	const inbox = entries([original, { ...original, id: "11111112" }]);
	expect(snapshot(inbox).pending.map(e => e.event_id)).toEqual(["original-completion"]);
	const recovered = snapshot(entries([...inbox, intent]));
	expect(recovered.pending).toHaveLength(0);
	expect(recovered.unacknowledged).toEqual(["original-pass"]);
	expect(() => validateAck(entries([...inbox, intent, action]), input)).toThrow("queued/busy is not ACK");
	expect(() => snapshot(entries([original, { ...original, data: { ...event, summary: "replacement" } }]))).toThrow("conflict");
});

test("new causes recover without old wake/ACK; claimed causes and missed ticks cannot replay", () => {
	const secondary = { ...original, id: "66666666", data: { ...event, event_id: "secondary-input" } };
	const timer = { type: "custom", id: "77777777", customType: TIMER, data: { op: "heartbeat", period_ms: 300000, scheduled_at_ms: 300000, fired_at_ms: 300000, elapsed_since_boot_ms: 300000 } };
	const latest = { ...timer, id: "88888888", data: { ...timer.data, scheduled_at_ms: 600000, fired_at_ms: 600000, elapsed_since_boot_ms: 600000 } };
	const old = entries([original, intent]); // no finalized original marker: UNKNOWN, not absent/unsent
	expect(nextWake(snapshot(old))).toBeUndefined();
	expect(nextWake(snapshot(entries([...old, secondary])))).toEqual({ event_ids: ["secondary-input"], reason: "event" });
	const branch = entries([...old, secondary, timer, latest]);
	const cause = nextWake(snapshot(branch))!;
	expect(cause).toEqual({ event_ids: ["secondary-input"], reason: "heartbeat", timer_entry_id: latest.id });
	const recovery = { ...intent, id: "99999999", data: { pass_id: "NEW-recovery", ...cause } };
	const recovered = entries([...branch, recovery]);
	expect(nextWake(snapshot(recovered))).toBeUndefined(); // latest fire coalesces the older missed tick
	expect(nextWake(snapshot(entries([...recovered, { ...latest, id: "aaaaaaaa" }])))).toBeUndefined(); // legacy identical firing, new entry ID
	expect(snapshot(recovered).unacknowledged).toEqual(["original-pass", "NEW-recovery"]);
	expect(snapshot(recovered).events.get(event.event_id)).toEqual(event);
});

test("pass ACK needs original successful action AFTER the finalized original wake", () => {
	expect(() => validateAck(entries([original, intent, message]), input)).toThrow("original successful");
	expect(() => validateAck(entries([original, intent, action, message]), input)).toThrow("original successful");
	expect(() => validateAck(entries([original, intent, message, { ...action, message: { ...action.message, isError: true } }]), input)).toThrow("original successful");
	expect(() => validateAck(entries([original, intent, message, { ...action, message: { ...action.message, toolName: "cto_supervision_inspect" } }]), input)).toThrow("original successful");
	const branch = entries([original, intent, message, action]);
	expect(validateAck(branch, input).message.id).toBe(message.id);
	expect(snapshot(branch).unacknowledged).toEqual([pass.pass_id]); // native action alone does not fake explicit CTO ACK
	const ack = { type: "message", id: "55555555", message: { role: "toolResult", toolName: ACK_TOOL, isError: false, details: { schema: "cto-supervision.ack/1", ...input } } };
	expect(snapshot(entries([...branch, ack])).unacknowledged).toEqual([]);
	expect(validateAck(entries([...branch, ack]), input).prior?.id).toBe(ack.id);
});

test("secondary completion cannot erase the original primary or another stopped owner", () => {
	const secondary = { ...original, id: "66666666", data: { ...event, event_id: "mage-advice-return", commission_id: "secondary-advisory-input" } };
	const branch = entries([original, secondary]);
	const state = snapshot(branch);
	expect(state.pending.map(e => e.event_id)).toEqual(["original-completion", "mage-advice-return"]);
	const secondaryPass = { pass_id: "secondary-pass", event_ids: ["mage-advice-return"], reason: "event" };
	const secondaryIntent = { ...intent, id: "77777777", data: secondaryPass };
	const secondaryWake = { ...message, id: "88888888", details: secondaryPass };
	const secondaryAck = { type: "message", id: "99999999", message: { role: "toolResult", toolName: ACK_TOOL, isError: false, details: { schema: "cto-supervision.ack/1", ...input, pass_id: secondaryPass.pass_id } } };
	const afterSecondary = snapshot(entries([original, intent, message, secondary, secondaryIntent, secondaryWake, action, secondaryAck]));
	expect(afterSecondary.unacknowledged).toEqual(["original-pass"]);
	expect(afterSecondary.events.get("original-completion")).toEqual(event);
	const heartbeat = wakeContent({ pass_id: "recovery-pass", event_ids: [], reason: "heartbeat" }, afterSecondary);
	const recoveryFacts = JSON.parse(heartbeat.split("\n").at(-1)!);
	expect(recoveryFacts.unacknowledged_pass_ids).toEqual(["original-pass"]);
	expect(recoveryFacts.retained_unacknowledged_count).toBe(1);
});
