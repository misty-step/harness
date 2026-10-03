import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessId, NativeAdapter, NativeEvent, NativeRequest, NativeResult, TaskSpec } from "./contract";

const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_BYTES = 64 * 1024 * 1024;
const MAX_PROBE_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
// Only documented effort-capable first-party IDs; aliases never select another family.
// https://code.claude.com/docs/en/model-config#adjust-effort-level
const CLAUDE_MODELS: Record<string, true> = {
	"claude-opus-4-6": true, "claude-opus-4-7": true, "claude-opus-4-8": true, "claude-opus-5": true, "claude-opus-5-5": true,
	"claude-sonnet-4-6": true, "claude-sonnet-5": true, "claude-sonnet-5-5": true, "claude-fable-5": true, "claude-fable-5-1": true,
};
const CLAUDE_ALIASES: Record<string, true> = { opus: true, sonnet: true, fable: true };
const CLAUDE_SETTINGS = JSON.stringify({ forceLoginMethod: "claudeai", fallbackModel: [], switchModelsOnFlag: false });
const CLAUDE_CONFIG_ARGS = ["--setting-sources", "", "--settings", CLAUDE_SETTINGS];

type Options = { claudeBinary?: string; antigravityBinary?: string; displayScript?: string; timeoutMs?: number };
type ObjectRecord = Record<string, unknown>;

function object(value: unknown, label: string): ObjectRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Native ${label} must be an object`);
	return value as ObjectRecord;
}

function session(value: unknown): string {
	if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(value)) throw new Error("Native session identity is missing or invalid");
	return value;
}

function stableUuid(key: string): string {
	const bytes = createHash("sha256").update(key).digest().subarray(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function claudeModel(model: string): string { return model.replace(/\[1m\]$/, ""); }

function claudeEffort(model: string, effort: string): void {
	const base = claudeModel(model);
	if (CLAUDE_ALIASES[base] !== true && CLAUDE_MODELS[base] !== true) throw new Error(`Unsupported Claude model: ${model}`);
	if (!EFFORTS.includes(effort) || (base.endsWith("-4-6") && effort === "xhigh")) {
		throw new Error(`Unsupported Claude effort ${effort} for ${model}`);
	}
}

function validateRoute(id: HarnessId, task: TaskSpec): void {
	if (task.route.harness !== id || task.route.provider !== (id === "claude-code" ? "anthropic" : "google-antigravity")) {
		throw new Error("Native harness/provider route mismatch");
	}
	if (!isAbsolute(task.workspace)) throw new Error("Native workspace must be absolute");
	if (id === "claude-code") claudeEffort(task.route.model, task.route.effort);
	else if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(task.route.model) || !["low", "medium", "high"].includes(task.route.effort)) {
		throw new Error("Unsupported Antigravity model slug or effort");
	}
}

function nativeEnvironment(): NodeJS.ProcessEnv {
	// Refuse a conflicting credential/route instead of silently falling back to a login.
	for (const [key, value] of Object.entries(process.env)) {
		if (value && (/^ANTHROPIC_/.test(key) || /^CLAUDE_CODE_(USE_|OAUTH_TOKEN)/.test(key))) {
			throw new Error(`Native subscription dispatch refuses credential/route override ${key}`);
		}
	}
	const env: NodeJS.ProcessEnv = { HOME: homedir(), PATH: "/usr/local/bin:/usr/bin:/bin", TERM: "dumb", NO_COLOR: "1", BROWSER: "false" };
	for (const key of ["USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "CLAUDE_CONFIG_DIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "OMP_ENGINEER_DISPLAY", "OMP_ENGINEER_DISPLAY_NS"]) {
		if (process.env[key]) env[key] = process.env[key];
	}
	// No inherited API keys, OAuth tokens, cloud selectors, desktop brokers, proxy
	// credentials or NODE_OPTIONS cross this allowlist. Preserve the boundary's
	// markers so it can reuse an existing private namespace only after its kernel
	// provenance checks pass; the environment alone never grants that authority.
	return env;
}

function nativeUsage(value: unknown): Record<string, number> | null {
	if (value === undefined || value === null) return null;
	const source = object(value, "usage");
	const usage: Record<string, number> = {};
	for (const [key, count] of Object.entries(source)) {
		if (typeof count !== "number") continue; // Nested native counters are not invented flat totals.
		if (!Number.isFinite(count) || count < 0) throw new Error(`Invalid native usage counter ${key}`);
		usage[key] = count;
	}
	return Object.keys(usage).length ? usage : null;
}

class Ndjson {
	private decoder = new TextDecoder("utf-8", { fatal: true });
	private pending = "";
	private pendingBytes = 0;
	private totalBytes = 0;
	constructor(private accept: (record: ObjectRecord) => void) {}
	push(chunk: Uint8Array): void {
		this.totalBytes += chunk.byteLength;
		if (this.totalBytes > MAX_STREAM_BYTES) throw new Error("Native NDJSON stream exceeds its bound");
		// Split bytes before decoding, so a large multi-record chunk cannot evade
		// the line bound and split UTF-8 code points survive arbitrary pipe chunks.
		let start = 0;
		for (let end = 0; end < chunk.byteLength; end++) {
			if (chunk[end] !== 10) continue;
			this.append(chunk.subarray(start, end));
			this.pending += this.decoder.decode();
			this.line();
			start = end + 1;
		}
		this.append(chunk.subarray(start));
	}
	private append(bytes: Uint8Array): void {
		this.pendingBytes += bytes.byteLength;
		if (this.pendingBytes > MAX_LINE_BYTES) throw new Error("Native NDJSON line exceeds its bound");
		this.pending += this.decoder.decode(bytes, { stream: true });
	}
	private line(): void {
		const line = this.pending;
		this.pending = "";
		this.pendingBytes = 0;
		if (!line.trim()) return;
		let parsed: unknown;
		try { parsed = JSON.parse(line); } catch { throw new Error("Malformed native NDJSON record"); }
		this.accept(object(parsed, "NDJSON record"));
	}
	finish(): void {
		this.pending += this.decoder.decode();
		if (this.pendingBytes) this.line();
	}
}

class TurnProtocol {
	private parser = new Ndjson(record => this.record(record));
	private sessionId: string | null = null;
	private initialized = false;
	private acknowledged = false;
	private terminal: ObjectRecord | null = null;
	private model: string | null = null;
	readonly expectedSession: string | null;
	readonly messageUuid: string;
	constructor(private id: HarnessId, private request: NativeRequest, private onEvent: (event: NativeEvent) => void) {
		this.expectedSession = request.sessionId ?? (id === "claude-code" ? stableUuid(`summon:session:${request.runId}`) : null);
		this.messageUuid = stableUuid(`summon:request:${request.runId}:${request.requestId}`);
		if (id === "claude-code" && !UUID.test(this.expectedSession!)) throw new Error("Claude native session must be a UUID");
		if (request.sessionId !== null) session(request.sessionId);
	}
	push(chunk: Uint8Array): void { this.parser.push(chunk); }
	private observeSession(value: unknown): void {
		const observed = session(value);
		if ((this.expectedSession && observed !== this.expectedSession) || (this.sessionId && observed !== this.sessionId)) {
			throw new Error("Native session changed or resume identity mismatched");
		}
		if (this.id === "claude-code" && !UUID.test(observed)) throw new Error("Claude native session must be a UUID");
		if (!this.sessionId) {
			this.sessionId = observed;
			this.onEvent({ type: "session", sessionId: observed });
		}
	}
	private observeModel(value: unknown): void {
		if (value === undefined || value === null) return;
		if (typeof value !== "string" || !value || value.length > 256) throw new Error("Invalid native model evidence");
		const selected = this.request.task.route.model;
		if (this.id === "antigravity") {
			if (value !== selected) throw new Error("Native model route mismatch");
			this.model = value;
			return;
		}
		const actual = claudeModel(value), wanted = claudeModel(selected);
		if (CLAUDE_ALIASES[actual] === true) {
			if (actual !== wanted) throw new Error("Native model route mismatch");
			return; // An unresolved native alias is not an actual model identity.
		}
		if (CLAUDE_ALIASES[wanted] === true ? !actual.startsWith(`claude-${wanted}-`) : actual !== wanted) {
			throw new Error("Native model route mismatch");
		}
		claudeEffort(actual, this.request.task.route.effort);
		this.model = value;
	}
	private record(record: ObjectRecord): void {
		if (this.terminal) throw new Error("Native record follows terminal result");
		if (record.error || record.is_error === true || (Array.isArray(record.errors) && record.errors.length > 0)) throw new Error("Native stream reports an error");
		if (this.id === "claude-code") this.claude(record);
		else this.antigravity(record);
		this.onEvent({ type: "activity" });
	}
	private claude(record: ObjectRecord): void {
		if (typeof record.type !== "string" || !record.type) throw new Error("Missing Claude record type");
		// Forwarded subagent/tool-result messages do not identify the root session
		// or acknowledge this commissioner's input.
		if (record.parent_tool_use_id !== undefined && record.parent_tool_use_id !== null) return;
		if (record.session_id !== undefined) this.observeSession(record.session_id);
		if (record.type === "system" && record.subtype === "init") {
			if (this.initialized) throw new Error("Duplicate native init");
			this.observeSession(record.session_id);
			if (!["none", "oauth"].includes(String(record.apiKeySource))) throw new Error("Claude stream is not subscription-authenticated");
			if (record.apiProvider !== undefined && record.apiProvider !== "firstParty") throw new Error("Native provider route mismatch");
			this.observeModel(record.model);
			this.initialized = true;
		} else if (record.type === "user" && record.isReplay === true && record.uuid === this.messageUuid) {
			this.observeSession(record.session_id);
			const message = object(record.message, "replayed user message");
			let content = message.content;
			if (Array.isArray(content)) {
				content = content.map(block => {
					const part = object(block, "replayed text block");
					if (part.type !== "text" || typeof part.text !== "string") throw new Error("Invalid native replay content");
					return part.text;
				}).join("");
			}
			if (message.role !== "user" || content !== this.request.text) throw new Error("Native replay payload mismatch");
			if (!this.acknowledged) {
				this.acknowledged = true;
				this.onEvent({ type: "acknowledged", sessionId: this.sessionId!, requestId: this.request.requestId });
			}
		} else if (record.type === "assistant") {
			const message = object(record.message, "assistant message");
			if (record.aborted === true || message.stop_reason === "refusal") throw new Error("Native assistant turn was aborted or refused");
			this.observeModel(message.model);
		} else if (record.type === "result") {
			this.observeSession(record.session_id);
			if (record.subtype !== "success" || record.is_error !== false || typeof record.result !== "string" || record.stop_reason === "refusal") {
				throw new Error("Claude terminal result is not successful");
			}
			if (record.user_message_uuid !== undefined && record.user_message_uuid !== this.messageUuid) throw new Error("Native terminal request identity mismatch");
			this.observeModel(record.model);
			this.terminal = record;
		} else if (record.type === "control_request" || record.type === "error") {
			throw new Error("Native turn requires unsupported control or reports an error");
		}
	}
	private antigravity(record: ObjectRecord): void {
		if (record.event === "init") {
			if (this.initialized) throw new Error("Duplicate native init");
			this.observeSession(record.conversation_id);
			const init = object(record.init, "Antigravity init");
			this.observeModel(init.model);
			this.initialized = true;
		} else if (record.event === "step_update") {
			const step = object(record.step_update, "Antigravity step");
			this.observeSession(step.conversation_id);
			// A DONE user_input step has no request UUID/payload receipt. Not an ACK.
			this.observeModel(step.model);
		} else if (record.event === "result") {
			const result = object(record.result, "Antigravity result");
			this.observeSession(result.conversation_id);
			if (result.status !== "SUCCESS" || result.error || typeof result.response !== "string") throw new Error("Antigravity terminal result is not successful");
			this.observeModel(result.model);
			this.terminal = result;
		} else throw new Error("Unsupported Antigravity output event");
	}
	finish(): NativeResult {
		this.parser.finish();
		if (!this.initialized || !this.sessionId || !this.terminal) throw new Error("Native stream lacks init, session identity or terminal completion");
		if (this.id === "claude-code" && !this.acknowledged) throw new Error("Native stream lacks matching replay acknowledgement");
		return {
			sessionId: this.sessionId, completed: true,
			acknowledged: this.acknowledged || this.id === "antigravity",
			text: (this.id === "claude-code" ? this.terminal.result : this.terminal.response) as string,
			model: this.model, usage: nativeUsage(this.terminal.usage),
		};
	}
}

// Read-only /proc identity snapshots prevent PID reuse from turning cancellation
// into authority over another process. Include setsid descendants, not just PGID.
function processIdentity(pid: number): string | null {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		return fields[0] === "Z" || fields[0] === "X" ? null : fields[19] ?? null;
	} catch { return null; }
}

function ownedTree(pid: number, identities = new Map<number, string>()): Map<number, string> {
	const identity = processIdentity(pid);
	if (!identity || identities.has(pid)) return identities;
	identities.set(pid, identity);
	try {
		for (const child of readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/)) {
			if (child) ownedTree(Number(child), identities);
		}
	} catch { /* A child may exit while the snapshot is read. */ }
	return identities;
}

async function stopOwnedTree(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (!child.pid) return;
	const pid = child.pid, identities = ownedTree(pid), identity = identities.get(pid);
	if (!identity) return;
	try { process.kill(pid, "SIGTERM"); } catch { /* Already exited. */ }
	const grace = Promise.withResolvers<void>();
	setTimeout(grace.resolve, 500);
	await grace.promise;
	if (processIdentity(pid) === identity) {
		for (const [descendant, stamp] of ownedTree(pid)) identities.set(descendant, stamp);
		try { process.kill(-pid, "SIGKILL"); } catch { /* Group may already be gone. */ }
	}
	for (const [descendant, stamp] of [...identities].reverse()) {
		if (processIdentity(descendant) === stamp) {
			try { process.kill(descendant, "SIGKILL"); } catch { /* Already exited. */ }
		}
	}
	// A signal or closed pipe is not observed descendant termination. Retain
	// captured identities until /proc reports exit; expiry is uncertainty.
	const deadline = performance.now() + 2000;
	while ([...identities].some(([descendant, stamp]) => processIdentity(descendant) === stamp)) {
		if (performance.now() >= deadline) throw new Error("Native owned descendant termination was not observed");
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

async function fencedProcess(binary: string, displayScript: string, args: string[], task: TaskSpec, env: NodeJS.ProcessEnv, timeoutMs: number, input: string, onChunk?: (chunk: Uint8Array) => void, signal?: AbortSignal): Promise<string> {
	if (signal?.aborted) throw new Error("Native invocation aborted before launch");
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const child = spawn("/usr/bin/python3", [displayScript, "--", binary, ...args], { cwd: task.workspace, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
	const stdout: Buffer[] = [], stderr: Buffer[] = [];
	let outBytes = 0, errBytes = 0, failure: Error | null = null, stopping: Promise<void> | null = null;
	const fail = (error: Error) => {
		if (failure) return;
		failure = error;
		stopping = stopOwnedTree(child).catch(error => {
			failure = new Error(`${failure!.message}; ${String(error)}`);
		});
	};
	const aborted = () => fail(new Error("Native invocation aborted; delivery may be uncertain"));
	const timer = setTimeout(() => fail(new Error("Native invocation timed out; delivery may be uncertain")), timeoutMs);
	signal?.addEventListener("abort", aborted, { once: true });
	if (signal?.aborted) aborted();
	child.stdout.on("data", (chunk: Buffer) => {
		if (failure) return;
		try {
			if (onChunk) onChunk(chunk);
			else {
				outBytes += chunk.length;
				if (outBytes > MAX_PROBE_BYTES) throw new Error("Native preflight output exceeds its bound");
				stdout.push(chunk);
			}
		} catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
	});
	child.stderr.on("data", (chunk: Buffer) => {
		const keep = Math.min(chunk.length, MAX_STDERR_BYTES - errBytes);
		if (keep > 0) { stderr.push(chunk.subarray(0, keep)); errBytes += keep; }
	});
	child.on("error", error => fail(error));
	child.stdin.on("error", error => fail(error));
	child.on("close", async (code, killedBy) => {
		clearTimeout(timer);
		signal?.removeEventListener("abort", aborted);
		await stopping;
		if (failure) { reject(failure); return; }
		if (code !== 0) {
			const diagnostics = Buffer.concat(stderr).toString("utf8").trim();
			reject(new Error(`Native command refused (exit ${code ?? killedBy ?? "unknown"})${diagnostics ? `: ${diagnostics}` : ""}`));
			return;
		}
		try { resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(stdout))); }
		catch { reject(new Error("Native preflight emitted invalid UTF-8")); }
	});
	child.stdin.end(input);
	return promise;
}

export function createNativeAdapter(id: HarnessId, options: Options = {}): NativeAdapter {
	if (id !== "claude-code" && id !== "antigravity") throw new Error("Unsupported native harness");
	const binary = id === "claude-code"
		? options.claudeBinary ?? join(homedir(), ".local/share/mise/installs/claude/latest/claude")
		: options.antigravityBinary ?? join(homedir(), ".local/bin/agy");
	const displayScript = options.displayScript ?? fileURLToPath(new URL("../../../omp-config/bin/omp-display.py", import.meta.url));
	const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error("Native timeout must be a positive bounded integer");

	async function preflight(task: TaskSpec, signal?: AbortSignal): Promise<NodeJS.ProcessEnv> {
		validateRoute(id, task);
		if (process.platform !== "linux") throw new Error("Native engineer boundary requires Linux");
		if (!isAbsolute(binary) || !isAbsolute(displayScript)) throw new Error("Native binary and display boundary paths must be absolute");
		accessSync(binary, constants.X_OK);
		accessSync(displayScript, constants.R_OK);
		const env = nativeEnvironment();
		const stdout = await fencedProcess(binary, displayScript, id === "claude-code" ? [...CLAUDE_CONFIG_ARGS, "auth", "status"] : ["models"], task, env, Math.min(timeoutMs, 30_000), "", undefined, signal);
		if (id === "claude-code") {
			let parsed: unknown;
			try { parsed = JSON.parse(stdout); } catch { throw new Error("Claude auth status is not valid JSON"); }
			const auth = object(parsed, "Claude auth status");
			if (auth.loggedIn !== true || auth.authMethod !== "claude.ai" || auth.apiProvider !== "firstParty" || !["pro", "max", "team", "enterprise"].includes(String(auth.subscriptionType))) {
				throw new Error("Claude native subscription login is required; API, cloud and unauthenticated routes are refused");
			}
		} else {
			const available = new Set(stdout.split(/\r?\n/).flatMap(line => {
				const match = /^([a-z0-9][a-z0-9._-]{0,127})[\t ]+\S/.exec(line);
				return match ? [match[1]!] : [];
			}));
			if (!available.has(task.route.model)) throw new Error("Antigravity native registry did not advertise the selected model; an existing native login is required");
		}
		return env;
	}

	return {
		id,
		capabilities: { resume: true, liveSteering: false, acknowledgement: id === "claude-code" ? "native-replay" : "completion-only" },
		async preflight(task) { await preflight(task); },
		async invoke(request, onEvent, signal) {
			if (!request.runId || !request.requestId || typeof request.text !== "string") throw new Error("Native request identity and text are required");
			const protocol = new TurnProtocol(id, request, onEvent);
			const input = `${JSON.stringify(id === "claude-code"
				? { type: "user", uuid: protocol.messageUuid, session_id: protocol.expectedSession, parent_tool_use_id: null, client_composed: true, message: { role: "user", content: request.text } }
				: { event: "user", message: { content: request.text } })}\n`;
			if (Buffer.byteLength(input) > MAX_LINE_BYTES) throw new Error("Native input exceeds its line bound");
			const env = await preflight(request.task, signal); // Never reuse stale authentication or registry proof.
			if (id === "claude-code") env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = "1";
			const args = id === "claude-code"
				? ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--replay-user-messages", ...CLAUDE_CONFIG_ARGS,
					"--safe-mode", "--no-chrome", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands", "--permission-mode", "acceptEdits", "--permission-prompts", "none",
					"--model", request.task.route.model, "--effort", request.task.route.effort,
					...(request.sessionId ? ["--resume", request.sessionId] : ["--session-id", protocol.expectedSession!])]
				: ["--input-format", "stream-json", "--output-format", "stream-json", "--sandbox", "--disable-slash-commands", "--mode", "accept-edits",
					"--model", request.task.route.model, "--effort", request.task.route.effort, ...(request.sessionId ? ["--conversation", request.sessionId] : [])];
			await fencedProcess(binary, displayScript, args, request.task, env, timeoutMs, input, chunk => protocol.push(chunk), signal);
			return protocol.finish();
		},
	};
}
