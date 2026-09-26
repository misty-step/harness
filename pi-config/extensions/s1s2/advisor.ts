/**
 * The advisor battery (round 2): a stronger model that reviews System 2's work and returns short
 * guidance, while System 1 decides when it is consulted. One implementation serves every trigger
 * policy so the advisor's prompt, context, and delivery stay identical across arms:
 *
 *   every   review after every turn in the background, like OMP's watchdog; advice lands at the
 *           next step boundary, and a blocker on the final turn sends System 2 back once
 *   gated   Jev reads each turn's state and consults only when review could change the next
 *           step, plus two structural consults: after the first edit and before finishing
 *   tool    System 2 decides, through an `ask_advisor` tool (Claude Code's advisor pattern)
 *
 * The advisor is the only generative part of System 1 and never acts: it sees the task, a compact
 * log of System 2's actions, and the current diff, and its reply is advisory text. System 1 never
 * writes that text itself; every advisor failure leaves the run as it would be without an advisor.
 */
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { redactText } from "../../../agent-config/system-one/continuation.ts";
import type { Answer, Question } from "../../../agent-config/system-one/engine.ts";
import type { MonitorFacts } from "./sensors.ts";

export type AdvisorMode = "off" | "every" | "gated" | "tool";
export type Severity = "none" | "nit" | "concern" | "blocker";
export type Advice = { severity: Severity; advice: string };
export type AdvisorConfig = { mode: AdvisorMode; provider: string; model: string; thinking: string };

export const ADVISOR = {
	/** Consults per task in gated and tool modes. Gated reserves the last one for the review before finishing. */
	maxConsults: 6,
	/**
	 * Jev probability that a review would change the next step, needed for a gate consult. Set by the
	 * 2026-09-26 replay over 30 recorded Pi runs (eval/gate-replay.ts): 0.55 picks about two gate
	 * consults per run (1.9), about four consults with the first-edit and final reviews.
	 */
	gateMin: 0.55,
	/** Turns between gate-triggered consults; structural consults ignore it. */
	minGap: 3,
	/** Reply ceiling, reasoning included. */
	maxTokens: 6000,
	/** The setup sample's final reviews took 49 to 94 s, and one passed 120 s. */
	timeoutMs: 180_000,
	/** Work-log and diff budgets for one consult message (characters). */
	logChars: 40_000,
	diffChars: 16_000,
	/** Past this much conversation (characters), the next consult starts a fresh one from the task and the newest log lines. */
	contextChars: 200_000,
	/** Every mode: how long settling waits for the review of the final turn. */
	settleWaitMs: 90_000,
};

const MODES: readonly AdvisorMode[] = ["off", "every", "gated", "tool"];

/** `S1S2_ADVISOR` picks the mode; `S1S2_ADVISOR_MODEL` is `provider/model` (default MiMo-V2.6-Pro on OpenRouter). */
export function advisorConfig(env: Record<string, string | undefined> = process.env): AdvisorConfig {
	const raw = (env.S1S2_ADVISOR ?? "off").trim().toLowerCase();
	const mode = (MODES as readonly string[]).includes(raw) ? (raw as AdvisorMode) : "off";
	const spec = (env.S1S2_ADVISOR_MODEL ?? "openrouter/xiaomi/mimo-v2.6-pro").trim();
	const slash = spec.indexOf("/");
	return {
		mode,
		provider: slash > 0 ? spec.slice(0, slash) : "openrouter",
		model: slash > 0 ? spec.slice(slash + 1) : spec,
		thinking: (env.S1S2_ADVISOR_THINKING ?? "high").trim() || "high",
	};
}

export const ADVISOR_SYSTEM = [
	"You are the advisor: a senior software engineer reviewing the work of an AI coding agent (the executor) while it completes a task in a Git repository.",
	"You cannot run tools or read files. You see the task, a compact log of the executor's actions, and its current diff.",
	"Give guidance only when it would change what the executor does next for the better: a wrong or risky approach, a missed or misread requirement, a likely bug, an untested change, a simpler path, or a way out of a loop.",
	"Be concrete: name files, functions, commands, and the next step. Do not restate what the executor already knows. If the work is on track, say so with severity none.",
	'Reply with only this JSON: {"severity":"none"|"nit"|"concern"|"blocker","advice":"<at most 120 words; empty when severity is none>"}.',
	"blocker: continuing as is would produce broken or wrong work. concern: a material risk or gap worth acting on now. nit: minor.",
].join(" ");

/** One line of the advisor's work log. */
export type Card = { turn: number; text: string };

export function assistantCard(turn: number, text: string): Card | null {
	const trimmed = text.trim();
	return trimmed ? { turn, text: `[turn ${turn}] executor: ${trimmed.slice(0, 800)}` } : null;
}

export function toolCard(turn: number, summary: string, ok: boolean, output: string): Card {
	const firstProblem = ok ? "" : (output.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 200);
	return { turn, text: `[turn ${turn}] ${summary.slice(0, 240)} -> ${ok ? "ok" : `error${firstProblem ? `: ${firstProblem}` : ""}`}` };
}

export function noteCard(turn: number, who: string, text: string): Card {
	return { turn, text: `[turn ${turn}] ${who}: ${text.slice(0, 600)}` };
}

/** Newest log lines that fit the budget, oldest first, with the count of omitted older lines. */
function recentLines(cards: readonly Card[]): { lines: string[]; dropped: number } {
	const lines: string[] = [];
	let used = 0;
	for (let i = cards.length - 1; i >= 0; i--) {
		used += cards[i].text.length + 1;
		if (used > ADVISOR.logChars) break;
		lines.unshift(cards[i].text);
	}
	return { lines, dropped: cards.length - lines.length };
}

/**
 * One consult message. The first message of a conversation carries the task and the whole work
 * log that fits; later ones carry only log lines added since the previous consult, and the diff
 * only when it changed (`diff` null).
 */
export function composeConsult(task: string | null, cards: readonly Card[], diff: string | null, reason: string): string {
	const { lines, dropped } = recentLines(cards);
	const heading = task === null ? "New in the executor's work since your last review" : "Executor's work so far";
	const clipped = diff !== null && diff.length > ADVISOR.diffChars ? `${diff.slice(0, ADVISOR.diffChars)}\n[… ${diff.length - ADVISOR.diffChars} more characters]` : diff;
	const body = [
		...(task === null ? [] : [`Task:\n<<<\n${task.slice(0, 6000)}\n>>>`]),
		`${heading}${dropped > 0 ? ` (the oldest ${dropped} entries are omitted)` : ""}:\n${lines.join("\n") || "(nothing new)"}`,
		clipped === null ? "Current changes: unchanged since your last review." : `Current changes (git diff):\n<<<\n${clipped.trim() || "(no changes yet)"}\n>>>`,
		`Why you are consulted: ${reason}`,
	].join("\n\n");
	return redactText(body, body.length);
}

/**
 * The advisor's own append-only conversation, like OMP's Steward: each consult sends only what is
 * new, so earlier turns stay a cached prefix. `open` builds the next request; `close` keeps the
 * exchange on success and forgets it on failure, so the next consult resends that delta.
 */
export class AdvisorConversation {
	private messages: Message[] = [];
	private chars = 0;
	private cardsSent = 0;
	private diffSent: string | null = null;
	private pending: { user: Message; cards: number; diff: string; fresh: boolean } | null = null;

	open(task: string, cards: readonly Card[], diff: string, reason: string): Message[] {
		const fresh = this.messages.length === 0 || this.chars > ADVISOR.contextChars;
		const content = fresh ? composeConsult(task, cards, diff, reason) : composeConsult(null, cards.slice(this.cardsSent), diff === this.diffSent ? null : diff, reason);
		this.pending = { user: { role: "user", content, timestamp: Date.now() }, cards: cards.length, diff, fresh };
		return [...(fresh ? [] : this.messages), this.pending.user];
	}

	close(reply: AssistantMessage | null, replyText: string): void {
		const pending = this.pending;
		this.pending = null;
		if (!pending || !reply) return;
		if (pending.fresh) {
			this.messages = [];
			this.chars = 0;
		}
		this.messages.push(pending.user, reply);
		this.chars += (typeof pending.user.content === "string" ? pending.user.content.length : 0) + replyText.length;
		this.cardsSent = pending.cards;
		this.diffSent = pending.diff;
	}
}

const SEVERITIES: readonly Severity[] = ["none", "nit", "concern", "blocker"];

/**
 * The advisor's reply: the outermost JSON object that ends at the reply's last brace, or else the
 * severity and advice fields read one by one (the setup sample had a reply whose advice string never
 * closed). Null when no known severity is present.
 */
export function parseAdvice(text: string): Advice | null {
	const end = text.lastIndexOf("}");
	for (let start = end < 0 ? -1 : text.lastIndexOf("{", end); start >= 0; start = start === 0 ? -1 : text.lastIndexOf("{", start - 1)) {
		let value: unknown;
		try {
			value = JSON.parse(text.slice(start, end + 1));
		} catch {
			continue; // widen to an earlier brace
		}
		if (!value || typeof value !== "object") continue;
		const record = value as Record<string, unknown>;
		const severity = typeof record.severity === "string" ? record.severity.trim().toLowerCase() : "";
		if (!(SEVERITIES as readonly string[]).includes(severity)) continue;
		const advice = typeof record.advice === "string" ? record.advice.trim() : "";
		return { severity: severity as Severity, advice: severity === "none" ? "" : advice.slice(0, 1500) };
	}
	const severity = /"severity"\s*:\s*"(none|nit|concern|blocker)"/i.exec(text)?.[1].toLowerCase() as Severity | undefined;
	if (!severity) return null;
	const raw = /"advice"\s*:\s*"((?:[^"\\]|\\.)*)/s.exec(text)?.[1] ?? "";
	let advice = raw;
	try {
		advice = JSON.parse(`"${raw.replace(/\\$/, "")}"`) as string;
	} catch {
		advice = raw.replace(/\\n/g, "\n").replace(/\\"/g, '"');
	}
	return { severity, advice: severity === "none" ? "" : advice.trim().slice(0, 1500) };
}

export function worthDelivering(advice: Advice | null): advice is Advice {
	return !!advice && advice.severity !== "none" && advice.advice.length > 0;
}

export function adviceMessage(advice: Advice): string {
	return `S1 advisor (${advice.severity}): ${advice.advice}`;
}

// ----------------------------------------------------------------- gate --

/** The gate's view of one turn. It omits consult history, so a replay over recorded runs asks exactly what the live gate asks. */
export type GateState = {
	task: string;
	turn: number;
	recent_actions: { turn: number; action: string; kind: string; ok: boolean }[];
	executor_last_message: string;
	facts: { identical_failed_calls_in_last_8: number; consecutive_failed_calls: number; turns_since_last_edit: number; edits_so_far: number };
};

export function gateState(
	task: string,
	turn: number,
	actions: readonly { turn: number; summary: string; ok: boolean; kind: string }[],
	facts: MonitorFacts,
	extra: { lastMessage: string; editsSoFar: number },
): GateState {
	return {
		task: redactText(task, 1500),
		turn,
		recent_actions: actions.slice(-12).map((action) => ({ turn: action.turn, action: redactText(action.summary, 200), kind: action.kind, ok: action.ok })),
		executor_last_message: redactText(extra.lastMessage, extra.lastMessage.length).slice(-800),
		facts: {
			identical_failed_calls_in_last_8: facts.repeatedFailures,
			consecutive_failed_calls: facts.errorStreak,
			turns_since_last_edit: facts.turnsSinceEdit,
			edits_so_far: extra.editsSoFar,
		},
	};
}

export const GATE_QUESTIONS: Record<string, Question> = {
	consult: {
		type: "noul",
		instructions:
			"Would a short review of the agent's work by a stronger senior engineer right now likely change what the agent does next for the better? " +
			"Yes when it is about to commit to an approach, keeps repeating failing attempts, has just made a large or risky change, seems to misread `task`, or is ignoring failing checks. " +
			"No when it is making routine progress on a clear plan.",
	},
};

export function gateProbability(answers: Record<string, Answer>): number | undefined {
	const answer = answers.consult;
	return answer?.type === "noul" ? answer.probability : undefined;
}

// ------------------------------------------------------ System 2 contract --

export const TOOL_DESCRIPTION =
	"Consult the advisor, a stronger model that sees the task, a log of your actions, and your current diff, and returns short guidance. " +
	"Use it before committing to an approach, when an error keeps recurring, and before declaring the task done. It cannot run tools. At most 6 consultations per task.";

export function advisorContract(mode: AdvisorMode): string {
	switch (mode) {
		case "every":
		case "gated":
			return 'An advisor, a stronger model, reviews your work and may add notes that start with "S1 advisor". Weigh them like any evidence; you decide.';
		case "tool":
			return "You can call the ask_advisor tool to consult a stronger model before committing to an approach, when an error keeps recurring, and before declaring the task done.";
		default:
			return "";
	}
}
