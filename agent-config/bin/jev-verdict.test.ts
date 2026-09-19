import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

const cli = `${import.meta.dir}/jev-verdict.ts`;

let server: ReturnType<typeof Bun.serve>;
let requests: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
let responder: () => Response = () =>
	Response.json({
		model: "typesafe/jev-1.13",
		answers: {
			complete: { type: "choice", choice: "finished", probabilities: { finished: 0.9, unfinished: 0.05, unclear: 0.05 }, confidence: 0.9 },
			overclaim: { type: "noul", noul: 0.05 },
			blocker: { type: "noul", noul: 0.04 },
		},
	});

beforeAll(() => {
	server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const body = (await request.json()) as Record<string, unknown>;
			requests.push({ body, headers: Object.fromEntries(request.headers.entries()) });
			return responder();
		},
	});
});

afterAll(() => server.stop(true));
afterEach(() => {
	requests = [];
	responder = () =>
		Response.json({
			model: "typesafe/jev-1.13",
			answers: {
				complete: { type: "choice", choice: "finished", probabilities: { finished: 0.9, unfinished: 0.05, unclear: 0.05 }, confidence: 0.9 },
				overclaim: { type: "noul", noul: 0.05 },
				blocker: { type: "noul", noul: 0.04 },
			},
		});
});

async function invoke(args: string[], env: Record<string, string | undefined> = {}, input = "") {
	// Async spawn, not spawnSync: the fixture server lives in this process, and
	// a blocked event loop could never answer the child's request.
	const child = Bun.spawn({
		cmd: [process.execPath, cli, ...args],
		env: { ...process.env, OPENROUTER_API_KEY: undefined, TYPESAFE_API_KEY: undefined, ...env },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	child.stdin.write(input);
	child.stdin.end();
	const [stdout, stderr] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	const status = await child.exited;
	return { status, stdout, stderr };
}

function endpointEnv(): Record<string, string> {
	return {
		OPENROUTER_API_KEY: "synthetic-test-key",
		OPENROUTER_JEV_ENDPOINT: `http://127.0.0.1:${server.port}/decisions`,
	};
}

describe("jev-verdict", () => {
	test("passes a finished, evidence-backed summary and sends one batched request", async () => {
		const result = await invoke(["--text", "Done: fixed the parser in src/parse.ts; bun test passed 12/12."], endpointEnv());
		expect(result.status).toBe(0);
		const verdict = JSON.parse(result.stdout);
		expect(verdict.verdict).toBe("pass");
		expect(verdict.reason).toBe("finished");
		expect(verdict.provider).toBe("openrouter");
		expect(verdict.model).toBe("typesafe/jev-1.13");
		expect(requests).toHaveLength(1);
		const body = requests[0].body as { model: string; state: Record<string, string>; questions: Record<string, unknown> };
		expect(body.model).toBe("typesafe/jev-1.13");
		expect(body.state.childSummary).toContain("src/parse.ts");
		expect(Object.keys(body.questions).sort()).toEqual(["blocker", "complete", "overclaim"]);
		expect(requests[0].headers.authorization).toBe("Bearer synthetic-test-key");
	});

	test("reads a summary from stdin", async () => {
		const result = await invoke([], endpointEnv(), "Finished the task.\n");
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).verdict).toBe("pass");
	});

	test("fails an unfinished summary without throwing", async () => {
		responder = () =>
			Response.json({
				answers: {
					complete: { type: "choice", choice: "unfinished", probabilities: { finished: 0.1, unfinished: 0.85, unclear: 0.05 }, confidence: 0.9 },
					overclaim: { type: "noul", noul: 0.1 },
					blocker: { type: "noul", noul: 0.1 },
				},
			});
		const result = await invoke(["--text", "Still working on the migration."], endpointEnv());
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "fail", reason: "unfinished" });
	});

	test("fails a blocked summary and treats overclaim as uncertain, not a pass", async () => {
		responder = () =>
			Response.json({
				answers: {
					complete: { type: "choice", choice: "finished", probabilities: { finished: 0.9, unfinished: 0.05, unclear: 0.05 }, confidence: 0.9 },
					overclaim: { type: "noul", noul: 0.1 },
					blocker: { type: "noul", noul: 0.9 },
				},
			});
		expect(JSON.parse((await invoke(["--text", "blocked"], endpointEnv())).stdout)).toMatchObject({ verdict: "fail", reason: "blocked" });

		responder = () =>
			Response.json({
				answers: {
					complete: { type: "choice", choice: "finished", probabilities: { finished: 0.9, unfinished: 0.05, unclear: 0.05 }, confidence: 0.9 },
					overclaim: { type: "noul", noul: 0.92 },
					blocker: { type: "noul", noul: 0.05 },
				},
			});
		expect(JSON.parse((await invoke(["--text", "claims without evidence"], endpointEnv())).stdout)).toMatchObject({
			verdict: "uncertain",
			reason: "overclaim",
		});
	});

	test("fails open on provider errors and unusable replies", async () => {
		responder = () => new Response("boom", { status: 503 });
		const errorResult = await invoke(["--text", "anything"], endpointEnv());
		expect(errorResult.status).toBe(0);
		expect(JSON.parse(errorResult.stdout)).toMatchObject({ verdict: "uncertain", reason: "provider-error" });

		responder = () => Response.json({ nonsense: true });
		expect(JSON.parse((await invoke(["--text", "anything"], endpointEnv())).stdout)).toMatchObject({
			verdict: "uncertain",
			reason: "provider-error",
		});
	});

	test("reports no-key without a network call", async () => {
		const result = await invoke(["--text", "anything"]);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "uncertain", reason: "no-key", provider: "none" });
		expect(requests).toHaveLength(0);
	});

	test("redacts credential shapes before sending and never echoes them", async () => {
		const fakeKey = ["sk", "live", "51Abcdef1234567890abcdef123456"].join("_");
		const result = await invoke(["--text", `Wrote OPENROUTER_API_KEY=${fakeKey} to the config.`], endpointEnv());
		expect(result.status).toBe(0);
		expect(result.stdout).not.toContain(fakeKey);
		expect(JSON.parse(result.stdout).redacted).toBe(true);
		const body = requests[0].body as { state: { childSummary: string } };
		expect(body.state.childSummary).not.toContain(fakeKey);
	});

	test("clips oversized summaries with a marker instead of refusing", async () => {
		const long = `start ${"x".repeat(40_000)} end`;
		const result = await invoke(["--text", long], endpointEnv());
		expect(result.status).toBe(0);
		const verdict = JSON.parse(result.stdout);
		expect(verdict.truncated).toBe(true);
		const body = requests[0].body as { state: { childSummary: string } };
		expect(Buffer.byteLength(body.state.childSummary, "utf8")).toBeLessThanOrEqual(32_000);
		expect(body.state.childSummary).toContain("truncated");
	});

	test("refuses CLI misuse with exit 2 and no verdict JSON", async () => {
		const result = await invoke(["--nope"]);
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("unexpected argument");
	});
});
