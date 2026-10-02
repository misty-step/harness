/** Source-only summon dispatch contract. No installer or live fleet caller selects it. */
export type HarnessId = "claude-code" | "antigravity";
export type TaskKind = "implementation" | "research";
export type RunState = "implementing" | "researching" | "awaiting_review" | "verified_delivery" | "waiting_input" | "interrupted" | "stopped";
export type DeliveryState = "queued" | "dispatching" | "acknowledged" | "answered" | "uncertain" | "failed";

export type DoneCheck =
	| { id: string; type: "command"; argv: string[] }
	| { id: string; type: "review"; criterion: string };

export interface TaskSpec {
	id: string;
	kind: TaskKind;
	brief: string;
	workspace: string;
	route: { harness: HarnessId; provider: "anthropic" | "google-antigravity"; model: string; effort: string };
	/** Commissioner-supplied policy; no universal shell command or Glass identity. */
	checks: DoneCheck[];
	/** Relative deliverable paths included in review freshness; no Git repository required. */
	outputs: string[];
	/** Opaque provenance only. Optional adapters may populate this; core does not query a tracker. */
	source?: { adapter: string; id: string };
}

export interface NativeRequest {
	runId: string;
	requestId: string;
	text: string;
	sessionId: string | null;
	task: TaskSpec;
}

export interface NativeEvent {
	type: "acknowledged" | "session" | "activity";
	sessionId?: string;
	requestId?: string;
}

export interface NativeResult {
	sessionId: string | null;
	completed: boolean;
	acknowledged: boolean;
	text: string;
	/** Native evidence only; absent counters and identities stay unknown. */
	model: string | null;
	usage: Record<string, number> | null;
}

export interface NativeAdapter {
	id: HarnessId;
	/** This groundwork deliberately queues steering between turns, never promises live interruption. */
	capabilities: { resume: boolean; liveSteering: false; acknowledgement: "native-replay" | "completion-only" };
	preflight(task: TaskSpec): Promise<void>;
	invoke(request: NativeRequest, onEvent: (event: NativeEvent) => void, signal?: AbortSignal): Promise<NativeResult>;
}

export interface ReviewReceipt {
	runId: string;
	checkId: string;
	/** Digest returned by inspect/check; steering or changed deliverables invalidate it. */
	deliveryDigest: string;
	verdict: "pass" | "block";
	reviewer: string;
	evidence: string[];
}
