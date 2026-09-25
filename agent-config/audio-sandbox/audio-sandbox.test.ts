import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { operatorPlaybackEnv } from "../skills/sachstand/scripts/operator-audio.ts";
import { AGENT_AUDIO_ENV, AGENT_AUDIO_SINK, sandboxAgentAudio, shellExports } from "./env.ts";
import {
	linkedSinks,
	mergeClaudeSettings,
	mergeDotenv,
	mergeShellPrefix,
	type PwObject,
	routingFailure,
} from "./install.ts";

const scratch = mkdtempSync(join(process.env.TMPDIR || join(homedir(), ".cache", "tmp"), "audio-sandbox-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("US-026 Claude Code settings keep foreign keys and gain the whole contract", () => {
	const merged = JSON.parse(
		mergeClaudeSettings(
			JSON.stringify({ env: { OTEL_LOGS_EXPORTER: "otlp", PULSE_SINK: "stale" }, hooks: { SessionStart: [] }, model: "x" }),
		),
	);
	expect(merged.hooks).toEqual({ SessionStart: [] });
	expect(merged.model).toBe("x");
	expect(merged.env).toEqual({ OTEL_LOGS_EXPORTER: "otlp", ...AGENT_AUDIO_ENV });
	expect(JSON.parse(mergeClaudeSettings(undefined))).toEqual({ env: { ...AGENT_AUDIO_ENV } });
	expect(() => mergeClaudeSettings("[]")).toThrow("JSON object");
	expect(() => mergeClaudeSettings('{"env": ["PULSE_SINK"]}')).toThrow("`env` must be an object");
});

test("US-026 the dotenv block parses to the exact contract, stays single, and refuses foreign keys", () => {
	const once = mergeDotenv("# operator notes\nOPENROUTER_BASE_URL=https://example.test\n\n");
	expect(mergeDotenv(once)).toBe(once);
	expect(parseEnv(once)).toEqual({ OPENROUTER_BASE_URL: "https://example.test", ...AGENT_AUDIO_ENV });
	expect(parseEnv(mergeDotenv(undefined))).toEqual({ ...AGENT_AUDIO_ENV });
	expect(() => mergeDotenv("export PIPEWIRE_NODE=alsa_output.hw\n")).toThrow("foreign definition of PIPEWIRE_NODE");
	const unterminated = once.replace("# end agent-config audio-sandbox\n", "OPENROUTER_API_BASE=https://kept.test\n");
	expect(() => mergeDotenv(unterminated)).toThrow("no end marker");
});

test("US-026 the Pi shellCommandPrefix is owned: replaced when ours, refused when foreign", () => {
	const stale = JSON.stringify({ defaultModel: "x", shellCommandPrefix: "export AGENT_AUDIO_SANDBOX='PULSE_SINK' PULSE_SINK='old'" });
	expect(JSON.parse(mergeShellPrefix(stale))).toEqual({ defaultModel: "x", shellCommandPrefix: shellExports() });
	expect(JSON.parse(mergeShellPrefix(undefined))).toEqual({ shellCommandPrefix: shellExports() });
	expect(() => mergeShellPrefix(JSON.stringify({ shellCommandPrefix: "shopt -s expand_aliases" }))).toThrow("foreign shellCommandPrefix");
	const composed = `${shellExports()}; source ~/.pi/aliases`;
	expect(() => mergeShellPrefix(JSON.stringify({ shellCommandPrefix: composed }))).toThrow("foreign shellCommandPrefix");
});

test("US-026 the Pi shell prefix exports the exact contract to a POSIX shell", () => {
	const result = Bun.spawnSync(["sh", "-c", `${shellExports()}\nenv`], { env: { PATH: process.env.PATH } });
	expect(result.exitCode).toBe(0);
	const exported = Object.fromEntries(
		result.stdout
			.toString()
			.trim()
			.split("\n")
			.map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
			.filter(([name]) => name in AGENT_AUDIO_ENV),
	);
	expect(exported).toEqual({ ...AGENT_AUDIO_ENV });
});

const node = (id: number, props: Record<string, unknown>): PwObject => ({ id, type: "PipeWire:Interface:Node", info: { props } });
const link = (id: number, output: number, input: number): PwObject => ({
	id,
	type: "PipeWire:Interface:Link",
	info: { "output-node-id": output, "input-node-id": input },
});

test("US-026 the routing proof finds native and Pulse streams and rejects leaks and vacuous passes", () => {
	const graph: PwObject[] = [
		node(10, { "node.name": AGENT_AUDIO_SINK, "media.class": "Audio/Sink" }),
		node(11, { "node.name": "alsa_output.hw", "media.class": "Audio/Sink" }),
		// Native pw-play: the pid lives on the owning client, not the node.
		{ id: 20, type: "PipeWire:Interface:Client", info: { props: { "application.process.id": 4242 } } },
		node(21, { "node.name": "pw-play", "media.class": "Stream/Output/Audio", "client.id": 20 }),
		link(22, 21, 10),
		// Pulse client: the pid lives on the stream node.
		node(31, { "node.name": "paplay", "media.class": "Stream/Output/Audio", "application.process.id": 5151 }),
		link(32, 31, 11),
		link(33, 31, 10),
	];
	expect(linkedSinks(graph, 4242)).toEqual([AGENT_AUDIO_SINK]);
	expect(linkedSinks(graph, 5151)).toEqual([AGENT_AUDIO_SINK, "alsa_output.hw"]);
	expect(linkedSinks(graph, 9999)).toBeUndefined();

	expect(routingFailure("sandbox", [AGENT_AUDIO_SINK])).toBeUndefined();
	expect(routingFailure("sandbox", ["alsa_output.hw", AGENT_AUDIO_SINK])).toContain("alsa_output.hw");
	expect(routingFailure("sandbox", undefined)).toContain("never linked");
	expect(routingFailure("sandbox", [])).toContain("never linked");
	expect(routingFailure("unlinked", undefined)).toBeUndefined();
	expect(routingFailure("unlinked", ["alsa_output.hw"])).toContain("alsa_output.hw");
});

test("US-026 US-020 requested speech leaves the sandbox and keeps the rest of the environment", () => {
	const env: Record<string, string | undefined> = { PATH: "/usr/bin", HOME: "/home/op" };
	sandboxAgentAudio(env);
	expect(operatorPlaybackEnv(env)).toEqual({ PATH: "/usr/bin", HOME: "/home/op" });
	expect(operatorPlaybackEnv({ PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
});

test("US-026 host deploy refuses an unowned PipeWire drop-in before writing anything", () => {
	const home = join(scratch, "foreign-home");
	const dropIn = join(home, ".config", "pipewire", "pipewire.conf.d", "60-agent-sandbox.conf");
	mkdirSync(join(dropIn, ".."), { recursive: true });
	writeFileSync(dropIn, "context.objects = []\n");
	const result = Bun.spawnSync(["bun", join(import.meta.dir, "install.ts"), "host", "--home", home], {
		env: { PATH: process.env.PATH, HOME: home },
		stderr: "pipe",
	});
	expect(result.exitCode).toBe(1);
	expect(result.stderr.toString()).toContain("Refusing unowned PipeWire drop-in");
	expect(readFileSync(dropIn, "utf8")).toBe("context.objects = []\n");
	expect(() => readFileSync(join(home, ".claude", "settings.json"))).toThrow();
});
