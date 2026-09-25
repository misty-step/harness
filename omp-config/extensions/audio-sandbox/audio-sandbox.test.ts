import { expect, test } from "bun:test";
import { AGENT_AUDIO_ENV } from "./env.ts";
import { routePythonCell } from "./index.ts";

// OMP's Python runner gets an allowlisted environment; model it with PATH and HOME only.
const runnerEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
const python = Bun.which("python3") ?? Bun.which("python");
const childEnvCell = 'import subprocess\nprint(subprocess.run(["env"], capture_output=True, text=True).stdout)';

function routingKeys(output: string): Record<string, string> {
	return Object.fromEntries(
		output
			.split("\n")
			.map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
			.filter(([name]) => name in AGENT_AUDIO_ENV),
	);
}

function run(argv: string[]): string {
	const result = Bun.spawnSync(argv, { env: runnerEnv, stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString();
}

test("US-026 a revised Python eval cell hands the contract to every process it spawns", () => {
	if (!python) throw new Error("python3 is required");
	expect(routingKeys(run([python, "-c", childEnvCell]))).toEqual({});
	expect(routingKeys(run([python, "-c", routePythonCell(childEnvCell)]))).toEqual({ ...AGENT_AUDIO_ENV });
});

test("US-026 revision keeps future imports first and is idempotent", () => {
	if (!python) throw new Error("python3 is required");
	const cell = "# typed\nfrom __future__ import annotations\nvalue: int = 7\nprint(value)";
	const routed = routePythonCell(cell);
	expect(run([python, "-c", routed]).trim()).toBe("7");
	expect(routePythonCell(routed)).toBe(routed);
});

test("US-026 a standalone local:// load is routed and loaded from its backing file", () => {
	if (!python) throw new Error("python3 is required");
	const routed = routePythonCell('%load "local://my notes/setup.py"', "/sessions/s1/local").split("\n");
	expect(routed).toHaveLength(2);
	expect(routingKeys(run([python, "-c", `${routed[0]}\n${childEnvCell}`]))).toEqual({ ...AGENT_AUDIO_ENV });
	expect(routed[1]).toBe('%load "/sessions/s1/local/my notes/setup.py"');
	expect(() => routePythonCell("%load local://../../etc/rc.py", "/sessions/s1/local")).toThrow("escapes");
	expect(() => routePythonCell("%load local://setup.py", null)).toThrow("cannot resolve local://");
});

test("US-026 a %%bash cell exports the contract to its shell body", () => {
	const routed = routePythonCell("%%bash\nenv").split("\n");
	expect(routed[0]).toBe("%%bash");
	expect(routingKeys(run(["sh", "-c", routed.slice(1).join("\n")]))).toEqual({ ...AGENT_AUDIO_ENV });
	expect(routePythonCell(routed.join("\n"))).toBe(routed.join("\n"));
});
