import type { Api, AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream, Model, StreamOptions } from "@earendil-works/pi-ai";
import { spawn } from "node:child_process";
import { userInfo } from "node:os";

/** One owned child per call. No credential reads, HTTP listener, or client retry. */
export type NativeRun = (args: string[], input?: string, signal?: AbortSignal) => Promise<string>;
export async function runOmp(args: string[], input = "", signal?: AbortSignal, executable = "omp"): Promise<string> {
	signal?.throwIfAborted();
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const home = userInfo().homedir;
	const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
	delete env.PI_CODING_AGENT_DIR;
	delete env.OMP_PROFILE;
	delete env.PI_PACKAGE_DIR;
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
	options?: StreamOptions;
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
	if (reply.status !== 200) throw new Error(`OMP gateway ${reply.status}: ${JSON.stringify(reply.body)}`);
	return reply;
}

/** STDIO buffers the entire SSE reply. Forward native frames, never manufacture token chunks. */
export function nativeStream(r: NativeRequest, run: NativeRun = runOmp): AssistantMessageEventStream {
	void (async () => {
		try {
			const signal = r.options?.signal;
			signal?.throwIfAborted();
			if (r.model.api !== "openai-codex-responses" || !/^[a-zA-Z0-9_.-]+$/.test(r.model.id)) {
				throw new Error("OMP shared pool requires a literal Codex model id");
			}
			// Native selectorCandidates otherwise expands configured model/role fallback chains.
			const fallback = JSON.parse(await run(["config", "get", "retry.modelFallback", "--json"], "", signal));
			if (fallback.key !== "retry.modelFallback" || fallback.value !== false) {
				throw new Error("OMP model fallback must be disabled for subscription-only Pi inference");
			}
			const { apiKey: _key, signal: _signal, headers: _headers, ...options } = r.options ?? {};
			const id = crypto.randomUUID();
			const frame = { id, path: "/v1/pi/stream", body: {
				model: `openai-codex/${r.model.id}`, context: r.context, options, stream: true,
			} };
			const reply = response(await run(["auth-gateway", "stdio"], `${JSON.stringify(frame)}\n`, signal), id);
			signal?.throwIfAborted();
			if (typeof reply.body !== "string") throw new Error("OMP did not return native SSE");
			let terminal = false;
			for (const block of reply.body.split(/\r?\n\r?\n/)) {
				const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
				if (!data || data === "[DONE]") continue;
				if (terminal) throw new Error("OMP returned events after a terminal event");
				const record = JSON.parse(data);
				// Native encoder failures may carry only errorMessage, not an AssistantMessage.
				if (record.type === "error" && !record.error) throw new Error(record.errorMessage ?? "OMP stream failed");
				const event = record as AssistantMessageEvent;
				if (event.type === "done") {
					if (event.message.provider !== "openai-codex" || event.message.model !== r.model.id) {
						throw new Error("OMP returned a different provider/model than the held Codex route");
					}
					r.onServe?.(event.message);
				}
				terminal = event.type === "done" || event.type === "error";
				r.out.push(event);
			}
			if (!terminal) throw new Error("OMP SSE ended without a terminal event");
		} catch (error) {
			r.out.push(failure(r.model, error, r.options?.signal?.aborted === true));
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
