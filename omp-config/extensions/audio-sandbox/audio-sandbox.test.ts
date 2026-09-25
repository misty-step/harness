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

test("US-026 revision keeps future imports first, is idempotent, and leaves host-only loads alone", () => {
	if (!python) throw new Error("python3 is required");
	const cell = "# typed\nfrom __future__ import annotations\nvalue: int = 7\nprint(value)";
	const routed = routePythonCell(cell);
	expect(run([python, "-c", routed]).trim()).toBe("7");
	expect(routePythonCell(routed)).toBe(routed);
	expect(routePythonCell("%load local://setup.py")).toBe("%load local://setup.py");
});

test("US-026 a %%bash cell exports the contract to its shell body", () => {
	const routed = routePythonCell("%%bash\nenv").split("\n");
	expect(routed[0]).toBe("%%bash");
	expect(routingKeys(run(["sh", "-c", routed.slice(1).join("\n")]))).toEqual({ ...AGENT_AUDIO_ENV });
	expect(routePythonCell(routed.join("\n"))).toBe(routed.join("\n"));
});
