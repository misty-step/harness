import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { isAuthFailure, matchEntries, serviceTokens } from "./index.ts";

const ENTRIES = [
	"workstation/SENTRY_AUTH_TOKEN",
	"workstation/DOUBLETAKE_CONVEX_DEPLOY_KEY",
	"workstation/DOUBLETAKE_OPENROUTER_API_KEY",
	"workstation/LINEAR_API_KEY",
	"workstation/OPENROUTER_R90_ALLIE_API_KEY",
];

describe("credential awareness", () => {
	test("reduces entry names to the words that identify a service", () => {
		expect(serviceTokens("workstation/DOUBLETAKE_CONVEX_DEPLOY_KEY")).toEqual(["doubletake", "convex", "deploy"]);
		expect(serviceTokens("workstation/SENTRY_AUTH_TOKEN")).toEqual(["sentry"]);
	});

	test("finds the entries a claim or failure is about, and not unrelated ones", () => {
		expect(matchEntries("No Sentry credentials were available, so source maps weren't uploaded.", ENTRIES)).toEqual([
			"workstation/SENTRY_AUTH_TOKEN",
		]);
		expect(matchEntries("✖ 401 Unauthorized: Invalid Convex deploy key", ENTRIES)).toEqual([
			"workstation/DOUBLETAKE_CONVEX_DEPLOY_KEY",
		]);
		expect(matchEntries("gh pr create failed", ENTRIES)).toEqual([]);
	});

	test("recognizes authentication failures in command output", () => {
		expect(isAuthFailure("401 Unauthorized: AuthenticationFailed: Invalid Convex deploy key")).toBe(true);
		expect(isAuthFailure("Error: SENTRY_AUTH_TOKEN is not set")).toBe(true);
		expect(isAuthFailure("Tests 77 passed (77)")).toBe(false);
	});
});

test("US-019 on-demand context is stable; only a failed bash call with matching entries gets a hint; no turn is ever injected", () => {
	const dir = mkdtempSync(resolve(tmpdir(), "credential-context-"));
	try {
		mkdirSync(resolve(dir, "bin"));
		mkdirSync(resolve(dir, "store/workstation"), { recursive: true });
		symlinkSync(resolve(import.meta.dir, "../../../agent-config/bin/pass-env.ts"), resolve(dir, "bin/pass-env"));
		writeFileSync(resolve(dir, "store/workstation/SENTRY_AUTH_TOKEN.gpg"), "synthetic encrypted fixture");
		writeFileSync(resolve(dir, "store/workstation/UNRELATED_KEY.gpg"), "never decrypted");
		const script = `
			import register from ${JSON.stringify(resolve(import.meta.dir, "index.ts"))};
			const handlers = new Map(), messages = [];
			register({ on: (event, handler) => handlers.set(event, handler), sendMessage: (m) => messages.push(m) });
			const start = () => handlers.get("before_agent_start")({systemPrompt:"base"});
			const first = start();
			process.env.OMP_CREDENTIAL_CONTEXT = "full";
			const second = start();
			const result = (isError, command, text) => handlers.get("tool_result")({toolName:"bash", isError, input:{command}, content:[{type:"text",text}]});
			const failure = result(true, "sentry-cli info", "401 Unauthorized");
			const successfulGrep = result(false, "grep -r 401 sentry.log", "401 Unauthorized (sentry)");
			const unmatched = result(true, "curl https://example.test", "401 Unauthorized");
			const claim = handlers.has("message_end") ? handlers.get("message_end")({message:{role:"assistant",content:[{type:"text",text:"The pass store has no Strava entries; Sentry credentials are unavailable."}]}}) : undefined;
			console.log(JSON.stringify({first,second,failure,successfulGrep,unmatched,claim,messages}));
		`;
		const env = { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, PASSWORD_STORE_DIR: `${dir}/store`, OMP_CREDENTIAL_CONTEXT: "on-demand" };
		const result = Bun.spawnSync(["bun", "-e", script], { env });
		expect(result.exitCode).toBe(0);
		const observed = JSON.parse(result.stdout.toString());
		expect(observed.first.systemPrompt).not.toContain("SENTRY_AUTH_TOKEN");
		expect(observed.first.systemPrompt).toBe(observed.second.systemPrompt);
		expect(JSON.stringify(observed.failure)).toContain("workstation/SENTRY_AUTH_TOKEN");
		expect(JSON.stringify(observed.failure)).not.toContain("UNRELATED_KEY");
		expect(observed.successfulGrep).toBeUndefined();
		expect(observed.unmatched).toBeUndefined();
		expect(observed.messages).toEqual([]);
		expect(result.stdout.toString()).not.toContain("synthetic encrypted fixture");
		const ordinary = Bun.spawnSync(["bun", "-e", script], { env: { ...env, OMP_CREDENTIAL_CONTEXT: "" } });
		expect(ordinary.exitCode).toBe(0);
		expect(JSON.parse(ordinary.stdout.toString()).first.systemPrompt).toContain("workstation/SENTRY_AUTH_TOKEN");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
