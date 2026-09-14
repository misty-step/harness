import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

export type Role = "main" | "executive" | "worker";

// These are concurrency limits, not dollar/request budgets. Main is not a
// worker and does not occupy an executive slot. Waiting executives retain a
// scope slot but NEVER acquire a worker-turn slot. No queue is added here.
export const LIMITS = Object.freeze({ activeWorkerTurns: 4, liveExecutives: 4 });
export const PLAN_ENTRY = "misty-step.omp-config.executive.plan";
export const MAX_PLAN_CHARS = 8_000;

export const EXECUTIVE_TOOLS: ReadonlySet<string> = new Set([
	"read", "grep", "glob", "ast_grep", "web_search", "task", "hub", "todo", "ask", "yield", "executive_control",
]);

const PEER_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
	send: new Set(["op", "to", "message", "replyTo", "await", "timeoutMs"]),
	wait: new Set(["op", "from", "ids", "timeoutMs"]),
	inbox: new Set(["op", "peek"]),
	list: new Set(["op", "status", "limit"]),
	jobs: new Set(["op"]),
	cancel: new Set(["op", "ids"]),
};

/** Validate the object that will execute, not only the original tool_call event. */
export function assertPeerHub(input: Record<string, unknown>): void {
	const fields = typeof input.op === "string" ? PEER_FIELDS[input.op] : undefined;
	if (!fields) throw new Error("Executive policy: hub only permits peer messaging and owned-job coordination.");
	for (const key of Object.keys(input)) {
		// Intent is native harness metadata, never a process argument. Nulls are
		// emitted by some provider schemas; they carry no dispatch value.
		if (key !== "i" && input[key] != null && !fields.has(key)) {
			throw new Error(`Executive policy: hub argument ${key} is outside the peer-only contract.`);
		}
	}
	if (input.op === "send" && (typeof input.to !== "string" || !input.to.trim())) {
		throw new Error("Executive policy: hub send requires an explicit peer recipient.");
	}
}

const READ_SCHEMES = new Set([
	"http", "https", "artifact", "local", "skill", "rule", "agent", "history", "omp", "issue", "pr", "attachment",
]);

/** Native read/search bookkeeping is allowed; this is not a zero-I/O sandbox. */
export function assertReadTarget(input: Record<string, unknown>): void {
	if (input.path == null) return;
	if (typeof input.path !== "string") throw new Error("Executive policy: read/search path must be a string.");
	for (const target of input.path.split(";")) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(target.trim());
		} catch {
			throw new Error("Executive policy: malformed encoded read/search path.");
		}
		const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(decoded)?.[1]?.toLowerCase();
		if (scheme && !READ_SCHEMES.has(scheme)) {
			throw new Error(`Executive policy: ${scheme} resources must be inspected by a worker.`);
		}
		// SQLite's native reader can create WAL bookkeeping and accepts raw SQL.
		// Delegate SQL, including encoded selectors, rather than treat it as pure.
		if (/\.(?:sqlite3?|db3?)(?=[:?#]|$)/i.test(decoded) && /[?&]q=/i.test(decoded)) {
			throw new Error("Executive policy: raw SQLite queries must be delegated to a worker.");
		}
	}
}

export function assertExecutiveTool(role: Role, name: string, input: Record<string, unknown>): void {
	if (role === "worker") return;
	if (!EXECUTIVE_TOOLS.has(name)) {
		throw new Error(`Executive policy: ${name} is not an executive capability; delegate implementation to a worker.`);
	}
	if (name === "hub") assertPeerHub(input);
	if (name === "read" || name === "grep" || name === "glob") assertReadTarget(input);
}

/** Only permit leases are held here; identities/status/results remain native. */
export class Admission {
	readonly workers = new Set<AgentSession>();
	readonly executives = new Set<AgentSession>();

	enter(role: Role, session: AgentSession): void {
		if (role === "main") return;
		const slots = role === "executive" ? this.executives : this.workers;
		const limit = role === "executive" ? LIMITS.liveExecutives : LIMITS.activeWorkerTurns;
		if (slots.has(session)) return;
		if (slots.size >= limit) {
			throw new Error(`Executive policy: ${role === "executive" ? "live executive scope" : "active worker turn"} limit reached (${limit}); retry only after an existing scope/turn settles.`);
		}
		slots.add(session);
	}

	endTurn(session: AgentSession): void {
		this.workers.delete(session);
	}

	leave(session: AgentSession): void {
		this.workers.delete(session);
		this.executives.delete(session);
	}
}

const POLICY_START = "<executive-scope-policy>";
const POLICY_END = "</executive-scope-policy>";
const ROLE_POLICY = `${POLICY_START}
Main and nested executives are delegating scope owners. This policy supersedes conflicting default Role, Delegation, Workflow, and worker-agent directions requiring inline implementation, two slices before delegation, or personal execution of verification/cleanup. Generated safety, approval, user-intent, context, evidence, and nonconflicting engineering rules remain in force.
Own scope and acceptance; delegate implementation, integration, and executable proof. Native OMP and Herdr are valid delegation and execution channels, including spawning agents and dispatching work. One bounded implementation slice warrants one worker; read-only answers need none. Use a nested executive only for an independently decomposable outcome. Assign clear ownership, constraints, acceptance evidence, and stop/escalation boundaries. Parallelize independent work, not shared mutation or dependencies. Continue routine authorized corrections through acceptance; ask about material choices or authority and honor explicit stops.
Executives use native read/search and coordination tools only, with peer-only hub: no writes, shell/eval, browser/computer, devices, process hub operations, unknown tools, or implementation disguised as a brief. Workers retain ordinary capabilities; route Herdr CLI operations through a capable native worker. Native task/hub manage native execution, delivery, patch integration, parking, and revival. Respect configured native recursion depth.
Process-local admission permits 4 active native worker turns and 4 live native executive scopes, excluding Main. Waiting executives need no worker permit. Excess native starts or revivals are rejected, not queued; these are concurrency limits, not monetary budgets. Cancel an unused executive before replacing it at capacity.
executive_control plan persists only this node's remaining-scope brief. Status describes native activity, not acceptance; rely on native enforcement only with ready: true and policy: enforced. Native admission, lifecycle, and cancellation do not account for Herdr agents: track their ownership, readiness, results, and cleanup through Herdr. Judge deliverable evidence, account for all owned work, and report failures/blockers before completion.
executive_control cancel closes only an owned native descendant subtree or all owned native descendants. Require settled: true, including for obsolete native work before completion; separately confirm cleanup of owned Herdr work. On native cleanup failure, inspect status and retry the same scope; do not resume other activity while admission remains closed. A turn abort is not a whole-tree stop. Wait only when blocked; finish at acceptance and resume only for actual input or results, never a continuation loop.
${POLICY_END}`;

/** Preserve generated blocks; replace only this extension's own prior block on cold revival. */
export function executivePrompt(blocks: string[]): string[] {
	const prior = /<executive-scope-policy>[\s\S]*?<\/executive-scope-policy>/g;
	return [...blocks.map(block => block.replace(prior, "")).filter(block => block.length > 0), ROLE_POLICY];
}
