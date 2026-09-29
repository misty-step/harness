import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

test("US-019 exposes names on startup without interrupting unrelated work or auth-looking output", () => {
	const scratch = resolve(homedir(), ".cache/tmp");
	mkdirSync(scratch, { recursive: true });
	const dir = mkdtempSync(resolve(scratch, "credential-context-"));
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
			const failures = [
				["bash", true, "sentry-cli info", "401 Unauthorized"],
				["bash", true, "grep sentry.log", "grep failed: 401 Unauthorized (sentry)"],
				["bash", true, "curl https://example.test", "401 Unauthorized"],
			].map(([toolName, isError, command, text]) => handlers.get("tool_result")?.({toolName,isError,input:{command},content:[{type:"text",text}]}));
			const claim = handlers.get("message_end")?.({message:{role:"assistant",content:[{type:"text",text:"The pass store has no Strava entries; Sentry credentials are unavailable. SimpleFIN is documented here."}]}});
			console.log(JSON.stringify({first,second,failures,claim,messages,events:[...handlers.keys()]}));
		`;
		const env = { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, PASSWORD_STORE_DIR: `${dir}/store`, OMP_CREDENTIAL_CONTEXT: "on-demand" };
		const result = Bun.spawnSync(["bun", "-e", script], { env });
		expect(result.exitCode).toBe(0);
		const observed = JSON.parse(result.stdout.toString());
		expect(observed.first.systemPrompt).not.toContain("SENTRY_AUTH_TOKEN");
		expect(observed.first.systemPrompt).toContain("pass-env list");
		expect(observed.first.systemPrompt).toBe(observed.second.systemPrompt);
		expect(observed.events).toEqual(["before_agent_start"]);
		expect(observed.failures).toEqual([null, null, null]);
		expect(observed.messages).toEqual([]);
		expect(result.stdout.toString()).not.toContain("synthetic encrypted fixture");
		const ordinary = Bun.spawnSync(["bun", "-e", script], { env: { ...env, OMP_CREDENTIAL_CONTEXT: "" } });
		expect(ordinary.exitCode).toBe(0);
		expect(JSON.parse(ordinary.stdout.toString()).first.systemPrompt).toContain("workstation/SENTRY_AUTH_TOKEN");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
