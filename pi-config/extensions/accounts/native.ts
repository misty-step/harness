import type { Api, AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream, Model, SimpleStreamOptions, StreamOptions } from "@earendil-works/pi-ai";
import { spawn } from "node:child_process";
import { userInfo } from "node:os";

const OWNER_ENV: Record<string, true> = {
	PATH: true, LANG: true, LC_ALL: true, LC_CTYPE: true, LC_MESSAGES: true, TZ: true, TMPDIR: true,
	XDG_CONFIG_HOME: true, XDG_DATA_HOME: true, XDG_STATE_HOME: true, XDG_CACHE_HOME: true, XDG_RUNTIME_DIR: true,
};
const BODY_FIELDS: Record<string, true> = { model: true, context: true, options: true, stream: true };
const CONTEXT_FIELDS: Record<string, true> = { systemPrompt: true, messages: true, tools: true };
const REASONING_LEVELS: Record<string, true> = { minimal: true, low: true, medium: true, high: true, xhigh: true };
// Pi 1.2 spreads AgentLoopConfig into provider options. These controls stay owned/executed by Pi.
const PI_LOOP_FIELDS: Record<string, true> = {
	model: true, toolExecution: true, beforeToolCall: true, afterToolCall: true, finishTurn: true,
	prepareRequest: true, prepareNextTurn: true, convertToLlm: true, transformContext: true, getApiKey: true,
	getSteeringMessages: true, getFollowUpMessages: true,
};

/** One owned child per call. No credential reads, HTTP listener, or client retry. */
export type NativeRun = (args: string[], input?: string, signal?: AbortSignal) => Promise<string>;
export async function runOmp(args: string[], input = "", signal?: AbortSignal, executable = "omp"): Promise<string> {
	signal?.throwIfAborted();
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const home = userInfo().homedir;
	const env: NodeJS.ProcessEnv = { HOME: home };
	for (const key in OWNER_ENV) {
		const value = process.env[key];
		if (value !== undefined) env[key] = value;
	}
	const child = spawn(executable, args, { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] });
	const stdout: Buffer[] = [], stderr: Buffer[] = [];
	let inputError: Error | undefined;
	const abort = () => child.kill("SIGKILL");
	signal?.addEventListener("abort", abort, { once: true });
	if (signal?.aborted) abort();
	child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
	child.stdin.on("error", (error: Error) => { inputError = error; child.kill("SIGKILL"); });
	child.on("error", (error) => { signal?.removeEventListener("abort", abort); reject(error); });
	child.on("close", (code) => {
		signal?.removeEventListener("abort", abort);
		if (signal?.aborted) { reject(signal.reason ?? new Error("Request aborted")); return; }
		if (inputError) { reject(inputError); return; }
		if (code !== 0) { reject(new Error(`OMP exited ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`)); return; }
		resolve(Buffer.concat(stdout).toString("utf8"));
	});
	child.stdin.end(input);
	return promise;
}

/** Pi's SDK folds system sections/tools; non-system history stays structured. */
export interface NativeContext {
	systemPrompt: string[];
	messages: unknown[];
	tools: unknown[];
}
interface NativeRequest {
	model: Model<Api>;
	context: NativeContext;
	options?: StreamOptions | SimpleStreamOptions;
	out: AssistantMessageEventStream;
	onServe?(message: AssistantMessage & { credentialId?: number }): void;
}

function failure(model: Model<Api>, error: unknown, aborted: boolean): AssistantMessageEvent {
	const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	const reason = aborted ? "aborted" : "error";
	return { type: "error", reason, error: {
		role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost },
		stopReason: reason, errorMessage: error instanceof Error ? error.message : String(error), timestamp: Date.now(),
	} };
}

function response(stdout: string, id: string): { status: number; body: unknown } {
	let ready = false;
	let reply: { status: number; body: unknown } | undefined;
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		const frame = JSON.parse(line);
		if (frame.ready === true) ready = true;
		if (frame.id === id) {
			if (reply) throw new Error("OMP returned duplicate response id");
			reply = frame;
		}
	}
	if (!ready || !reply) throw new Error("OMP ended without a ready/correlated response");
	return reply;
}

/** Reject callbacks/data that JSON would silently erase. */
function wireJson(value: unknown): string {
	const json = JSON.stringify(value, (key, item) => {
		if (typeof item === "function") throw new Error(`Unsupported callback in OMP native payload: ${key}`);
		return item;
	});
	if (json === undefined) throw new Error("OMP native payload must be a JSON object");
	return json;
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Local callbacks can be pending when Pi aborts; never dispatch after cancellation. */
async function abortable<T>(pending: T | Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return pending;
	const { promise, reject } = Promise.withResolvers<never>();
	const raced = Promise.race([pending, promise]);
	const abort = () => reject(signal.reason);
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	try {
		return await raced;
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

/** STDIO buffers the entire SSE reply. Forward native frames, never manufacture token chunks. */
export function nativeStream(r: NativeRequest, run: NativeRun = runOmp): AssistantMessageEventStream {
	void (async () => {
		const signal = r.options?.signal;
		try {
			signal?.throwIfAborted();
			const heldId = r.model.id, heldProvider = r.model.provider;
			if (r.model.api !== "openai-codex-responses" || !/^[a-zA-Z0-9_.-]+$/.test(heldId)) {
				throw new Error("OMP shared pool requires a literal Codex model id");
			}
			const { apiKey: _key, signal: _signal, headers: _headers, onPayload, onResponse, onProviderStreamEvent, ...provided } = r.options ?? {};
			const options: Record<string, unknown> = provided;
			for (const field in PI_LOOP_FIELDS) delete options[field];
			for (const callback of [onPayload, onResponse, onProviderStreamEvent]) {
				if (callback !== undefined && typeof callback !== "function") throw new Error("Unsupported OMP native callback");
			}
			const originalOptions: unknown = JSON.parse(wireJson(options));
			if (!object(originalOptions) || originalOptions.env !== undefined) throw new Error("OMP native owner does not accept Pi provider environment overrides");
			const selector = `openai-codex/${heldId}`;
			const body = { model: selector, context: r.context, options, stream: true };
			const replacement = onPayload ? await abortable(onPayload(body, r.model), signal) : undefined;
			signal?.throwIfAborted();
			const bodyJson = wireJson(replacement === undefined ? body : replacement);
			const checked: unknown = JSON.parse(bodyJson);
			if (r.model.id !== heldId || r.model.provider !== heldProvider || r.model.api !== "openai-codex-responses"
				|| !object(checked)
				|| checked.model !== selector || checked.stream !== true
				|| Object.keys(checked).some(key => !Object.hasOwn(BODY_FIELDS, key))) {
				throw new Error("Request hook must preserve the held literal Codex route and native streaming body");
			}
			const ctx = checked.context, opts = checked.options;
			if (!object(ctx)
				|| Object.keys(ctx).some(key => !Object.hasOwn(CONTEXT_FIELDS, key))
				|| !Array.isArray(ctx.systemPrompt) || !ctx.systemPrompt.every((prompt: unknown) => typeof prompt === "string")
				|| !Array.isArray(ctx.messages) || !Array.isArray(ctx.tools)
				|| !object(opts)) {
				throw new Error("Request hook must return native context/options, not an upstream vendor payload");
			}
			// Deliberately narrow: other native options remain held, not guessed or silently dropped.
			for (const key of new Set([...Object.keys(originalOptions), ...Object.keys(opts)])) {
				if ((Object.hasOwn(originalOptions, key) !== Object.hasOwn(opts, key)
					|| wireJson(originalOptions[key] ?? null) !== wireJson(opts[key] ?? null))
					&& key !== "maxTokens" && key !== "reasoning") {
					throw new Error(`Unsupported request-hook option transform: ${key}`);
				}
			}
			if (opts.maxTokens !== undefined && (typeof opts.maxTokens !== "number" || !Number.isSafeInteger(opts.maxTokens) || opts.maxTokens <= 0)
				|| opts.reasoning !== undefined && (typeof opts.reasoning !== "string" || !Object.hasOwn(REASONING_LEVELS, opts.reasoning))) {
				throw new Error("Invalid native maxTokens/reasoning request options");
			}
			// Native selectorCandidates otherwise expands configured model/role fallback chains.
			const fallback = JSON.parse(await run(["config", "get", "retry.modelFallback", "--json"], "", signal));
			if (fallback.key !== "retry.modelFallback" || fallback.value !== false) {
				throw new Error("OMP model fallback must be disabled for subscription-only Pi inference");
			}
			signal?.throwIfAborted();
			const id = crypto.randomUUID();
			// Dispatch the exact bytes validated above, even if callback-owned objects later change.
			const frame = `{"id":${JSON.stringify(id)},"path":"/v1/pi/stream","body":${bodyJson}}\n`;
			const reply = response(await run(["auth-gateway", "stdio"], frame, signal), id);
			// This is the gateway transport status, not upstream HTTP metadata (STDIO drops headers).
			if (onResponse) await abortable(onResponse({ status: reply.status, headers: {} }, r.model), signal);
			signal?.throwIfAborted();
			if (reply.status !== 200) throw new Error(`OMP gateway ${reply.status}: ${JSON.stringify(reply.body)}`);
			if (typeof reply.body !== "string") throw new Error("OMP did not return native SSE");
			let terminal = false;
			for (const block of reply.body.split(/\r?\n\r?\n/)) {
				const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
				if (!data || data === "[DONE]") continue;
				if (terminal) throw new Error("OMP returned events after a terminal event");
				const record = JSON.parse(data);
				if (onProviderStreamEvent) await abortable(onProviderStreamEvent(record, r.model), signal);
				signal?.throwIfAborted();
				// Native encoder failures may carry only errorMessage, not an AssistantMessage.
				if (record.type === "error" && !record.error) throw new Error(record.errorMessage ?? "OMP stream failed");
				const event = record as AssistantMessageEvent;
				if (event.type === "done") {
					if (event.message.provider !== "openai-codex" || event.message.model !== heldId) {
						throw new Error("OMP returned a different provider/model than the held Codex route");
					}
					r.onServe?.(event.message);
				}
				terminal = event.type === "done" || event.type === "error";
				r.out.push(event);
			}
			if (!terminal) throw new Error("OMP SSE ended without a terminal event");
		} catch (error) {
			r.out.push(failure(r.model, error, signal?.aborted === true));
		}
	})();
	return r.out;
}

/** Inventory only: no usage refresh, token output, or claim that every listed account has headroom. */
export async function nativeInventory(run: NativeRun = runOmp): Promise<string[]> {
	const stdout = await run(["usage", "accounts", "--json"], "", AbortSignal.timeout(10_000));
	const doc = JSON.parse(stdout) as { accounts: { provider: string; identityKey: string }[] };
	const accounts = doc.accounts.filter((account) => account.provider === "openai-codex");
	return [
		`openai-pool: OMP native shared Codex owner (${accounts.length} configured identities)`,
		...accounts.map((account) => `  ${account.identityKey}`),
		"  Quota availability unknown here (inventory only); Pi-local logins/blocks do not select this pool.",
		"  Native output is buffered until completion; successful replies carry the OMP credentialId.",
	];
}
