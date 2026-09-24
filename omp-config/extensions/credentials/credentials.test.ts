import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { claimsUnavailable, isAuthFailure, matchEntries, serviceTokens } from "./index.ts";

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

	test("recognizes a claim that a credential is unavailable", () => {
		expect(claimsUnavailable("No Sentry credentials were available, so source maps weren't uploaded.")).toBe(true);
		expect(claimsUnavailable("The harness has no reviewer key.")).toBe(true);
		expect(claimsUnavailable("Deployed with the stored token; source maps uploaded.")).toBe(false);
	});
});

test("US-019 on-demand context stays stable while credential recovery remains targeted", () => {
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
			const failure = handlers.get("tool_result")({toolName:"bash", input:{command:"sentry-cli info"}, content:[{type:"text",text:"401 Unauthorized"}]});
			const claim = {message:{role:"assistant",content:[{type:"text",text:"Sentry credentials are unavailable."}]}};
			handlers.get("message_end")(claim); handlers.get("message_end")(claim);
			const knownCount = messages.length;
			for (const service of ["Obscure", "Obscure", "Unrelated", "Unrelated", "Sentry"]) {
				handlers.get("message_end")({message:{role:"assistant",content:[{type:"text",text:service+" credentials are unavailable."}]}});
			}
			console.log(JSON.stringify({first,second,failure,messages,knownCount}));
		`;
		const env = { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, PASSWORD_STORE_DIR: `${dir}/store`, OMP_CREDENTIAL_CONTEXT: "on-demand" };
		const result = Bun.spawnSync(["bun", "-e", script], { env });
		expect(result.exitCode).toBe(0);
		const observed = JSON.parse(result.stdout.toString());
		expect(observed.first.systemPrompt).not.toContain("SENTRY_AUTH_TOKEN");
		expect(observed.first.systemPrompt).toBe(observed.second.systemPrompt);
		expect(JSON.stringify(observed.failure)).toContain("workstation/SENTRY_AUTH_TOKEN");
		expect(JSON.stringify(observed.failure)).not.toContain("UNRELATED_KEY");
		expect(observed.knownCount).toBe(1);
		expect(observed.messages).toHaveLength(3);
		expect(JSON.stringify(observed.messages)).toContain("workstation/SENTRY_AUTH_TOKEN");
		expect(result.stdout.toString()).not.toContain("synthetic encrypted fixture");
		const ordinary = Bun.spawnSync(["bun", "-e", script], { env: { ...env, OMP_CREDENTIAL_CONTEXT: "" } });
		expect(ordinary.exitCode).toBe(0);
		const baseline = JSON.parse(ordinary.stdout.toString());
		expect(baseline.first.systemPrompt).toContain("workstation/SENTRY_AUTH_TOKEN");
		expect(baseline.knownCount).toBe(1);
		expect(baseline.messages).toHaveLength(3);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
