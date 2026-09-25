#!/usr/bin/env bun
/**
 * Deploy the agent audio sandbox (US-026).
 *
 *   install.ts host --home DIR [--check]    PipeWire sink, Claude Code env, live proof
 *   install.ts dotenv --file FILE [--check] Merge the contract into a dotenv file
 *
 * `host` writes a PipeWire drop-in that creates the silent sink whenever
 * PipeWire starts, and merges the contract into Claude Code's settings `env`.
 * Claude Code has no installer in this repository, so only these keys are
 * owned there. When the live daemon is reachable, it also creates the sink now
 * (no daemon restart, default device untouched) and proves routing: sandboxed
 * native and Pulse streams link only to the sink, and a stream aimed at a
 * missing sink links nowhere. The proof plays silence, so a failure is inaudible.
 *
 * `dotenv` owns one marked block in a dotenv file that a harness loads before
 * any tool runs (OMP's agent `.env`). A foreign definition of a contract key
 * fails closed instead of being shadowed or overwritten.
 *
 * --check validates every destination without writing or touching PipeWire.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { AGENT_AUDIO_ENV, AGENT_AUDIO_SINK } from "./env.ts";

const OWNER = "# owned by misty-step/harness agent-config audio-sandbox (US-026)";
const BLOCK_END = "# end agent-config audio-sandbox";

const SINK_ARGS = [
	"factory.name = support.null-audio-sink",
	`node.name = "${AGENT_AUDIO_SINK}"`,
	'node.description = "Agent sandbox (silent)"',
	"media.class = Audio/Sink",
	"audio.position = [ FL FR ]",
	// Lowest priority: any available hardware sink wins the default. WirePlumber
	// can still choose it when no hardware output is available at all.
	"priority.session = 0",
	"priority.driver = 0",
];

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function renderDropIn(): string {
	return [
		`${OWNER}; delete this file to revert.`,
		"# Silent sink for agent-spawned audio: nothing played here reaches a device.",
		"context.objects = [",
		"  { factory = adapter",
		"    args = {",
		...SINK_ARGS.map(arg => `      ${arg}`),
		"    }",
		"  }",
		"]",
		"",
	].join("\n");
}

/** Claude Code settings with the contract in `env`; every other key survives. */
export function mergeClaudeSettings(text: string | undefined): string {
	const settings: unknown = text === undefined ? {} : JSON.parse(text);
	if (!isObject(settings)) throw new Error("Claude Code settings must be a JSON object");
	const env = settings.env ?? {};
	if (!isObject(env)) throw new Error("Claude Code settings `env` must be an object");
	return `${JSON.stringify({ ...settings, env: { ...env, ...AGENT_AUDIO_ENV } }, null, 2)}\n`;
}

/** A dotenv file with exactly one owned block carrying the contract. */
export function mergeDotenv(text: string | undefined): string {
	const kept: string[] = [];
	let owned = false;
	for (const line of (text ?? "").split("\n")) {
		if (line.startsWith(OWNER)) owned = true;
		else if (owned) owned = line !== BLOCK_END;
		else {
			const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
			if (name && name in AGENT_AUDIO_ENV) throw new Error(`Refusing foreign definition of ${name} in the dotenv file`);
			kept.push(line);
		}
	}
	if (owned) throw new Error("Refusing a dotenv file whose audio-sandbox block has no end marker");
	while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
	const block = [
		`${OWNER}; remove this block to revert.`,
		...Object.entries(AGENT_AUDIO_ENV).map(([name, value]) => `${name}="${value}"`),
		BLOCK_END,
	];
	return `${[...kept, ...(kept.length > 0 ? [""] : []), ...block].join("\n")}\n`;
}

function readRegular(path: string): string | undefined {
	try {
		if (!lstatSync(path).isFile()) throw new Error(`Refusing non-regular destination: ${path}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	return readFileSync(path, "utf8");
}

function writeIfChanged(path: string, text: string, current: string | undefined): string {
	if (current === text) return "unchanged";
	const mode = current === undefined ? 0o600 : lstatSync(path).mode & 0o777;
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}`);
	writeFileSync(temp, text, { flag: "wx", mode });
	chmodSync(temp, mode);
	renameSync(temp, path);
	return current === undefined ? "created" : "updated";
}

// ---- Live PipeWire -------------------------------------------------------

export type PwObject = {
	id: number;
	type: string;
	props?: Json;
	info?: { props?: Json; "output-node-id"?: number; "input-node-id"?: number };
	metadata?: { key: string; value?: { name?: string } }[];
};

const isNode = (object: PwObject): boolean => object.type === "PipeWire:Interface:Node";

/** Sinks a process's playback stream links to; undefined while it has no stream. */
export function linkedSinks(objects: PwObject[], pid: number): string[] | undefined {
	const nodes = objects.filter(isNode);
	const clientPid = new Map(
		objects
			.filter(object => object.type === "PipeWire:Interface:Client")
			.map(client => [client.id, Number(client.info?.props?.["application.process.id"])]),
	);
	// Pulse clients carry the pid on the stream node; native clients carry it on the owning client.
	const streamPid = (node: PwObject): number =>
		Number(node.info?.props?.["application.process.id"] ?? clientPid.get(Number(node.info?.props?.["client.id"])));
	const stream = nodes.find(
		node => node.info?.props?.["media.class"] === "Stream/Output/Audio" && streamPid(node) === pid,
	);
	if (!stream) return undefined;
	const names = new Map(nodes.map(node => [node.id, String(node.info?.props?.["node.name"])]));
	const sinks = objects
		.filter(object => object.type === "PipeWire:Interface:Link" && object.info?.["output-node-id"] === stream.id)
		.map(link => names.get(Number(link.info?.["input-node-id"])) ?? `node ${link.info?.["input-node-id"]}`);
	return [...new Set(sinks)].sort();
}

/**
 * Undefined when routing held; otherwise what went wrong. With a missing target,
 * WirePlumber refuses the stream (measured: pw-play and paplay exit without a
 * node), so an unobserved stream is the fail-closed outcome. The routed proof
 * runs first with the same player and file, which rules out a player that
 * cannot start.
 */
export function routingFailure(expect: "sandbox" | "unlinked", sinks: string[] | undefined): string | undefined {
	if (expect === "unlinked") return sinks?.length ? `a stream aimed at a missing sink reached ${sinks.join(", ")}` : undefined;
	if (!sinks?.length) return "a sandboxed stream never linked";
	return sinks.length === 1 && sinks[0] === AGENT_AUDIO_SINK ? undefined : `a sandboxed stream reached ${sinks.join(", ")}`;
}

function run(argv: string[]): string | undefined {
	const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", timeout: 5000 });
	return result.exitCode === 0 ? result.stdout.toString() : undefined;
}

function graph(): PwObject[] {
	const dump = run(["pw-dump"]);
	if (dump === undefined) throw new Error("pw-dump failed");
	return JSON.parse(dump) as PwObject[];
}

const sinkPresent = (objects: PwObject[]): boolean =>
	objects.some(
		node =>
			isNode(node) &&
			node.info?.props?.["node.name"] === AGENT_AUDIO_SINK &&
			node.info?.props?.["media.class"] === "Audio/Sink",
	);

function defaultSinks(objects: PwObject[]): string {
	const defaults = objects.find(
		object => object.type === "PipeWire:Interface:Metadata" && object.props?.["metadata.name"] === "default",
	);
	return ["default.configured.audio.sink", "default.audio.sink"]
		.map(key => `${key}=${defaults?.metadata?.find(entry => entry.key === key)?.value?.name ?? "unset"}`)
		.join(" ");
}

async function ensureSink(): Promise<string> {
	if (sinkPresent(graph())) return "present";
	// object.linger keeps the node after pw-cli exits; the drop-in recreates it on the next PipeWire start.
	if (run(["pw-cli", "create-node", "adapter", `{ ${SINK_ARGS.join(" ")} object.linger = true }`]) === undefined) {
		throw new Error("pw-cli could not create the sandbox sink");
	}
	for (let attempt = 0; attempt < 20; attempt++) {
		if (sinkPresent(graph())) return "created";
		await Bun.sleep(100);
	}
	throw new Error("the sandbox sink did not appear after creation");
}

function silenceWav(seconds: number): Buffer {
	const rate = 48000;
	const channels = 2;
	const bytes = rate * channels * 2 * seconds;
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + bytes, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * channels * 2, 28);
	header.writeUInt16LE(channels * 2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(bytes, 40);
	return Buffer.concat([header, Buffer.alloc(bytes)]);
}

async function observe(player: string[], env: Json, expect: "sandbox" | "unlinked"): Promise<string | undefined> {
	const child = Bun.spawn(player, { env: { ...process.env, ...env } as Record<string, string>, stdout: "ignore", stderr: "ignore" });
	try {
		const deadline = Date.now() + (expect === "sandbox" ? 5000 : 2500);
		let sinks: string[] | undefined;
		while (Date.now() < deadline) {
			await Bun.sleep(200);
			sinks = linkedSinks(graph(), child.pid);
			if (sinks?.length) {
				await Bun.sleep(300);
				sinks = linkedSinks(graph(), child.pid);
				break;
			}
		}
		return routingFailure(expect, sinks);
	} finally {
		child.kill();
		await child.exited;
	}
}

async function proveLive(): Promise<void> {
	if (!Bun.which("pw-cli") || !Bun.which("pw-dump") || run(["pw-cli", "info", "0"]) === undefined) {
		console.log("audio-sandbox: PipeWire is not reachable; live sink and routing proof skipped");
		return;
	}
	const before = defaultSinks(graph());
	console.log(`audio-sandbox: live sink ${AGENT_AUDIO_SINK} ${await ensureSink()}`);
	const players = [["pw-play"], ["paplay"]].filter(([name]) => Bun.which(name));
	if (players.length === 0) throw new Error("no pw-play or paplay to prove routing");
	const root = process.env.TMPDIR || join(homedir(), ".cache", "tmp");
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const work = mkdtempSync(join(root, "agent-audio-proof-"));
	try {
		const wav = join(work, "silence.wav");
		writeFileSync(wav, silenceWav(6), { mode: 0o600 });
		const missing = `${AGENT_AUDIO_SINK}-missing-${randomUUID().slice(0, 8)}`;
		const missingEnv = Object.fromEntries(
			Object.entries(AGENT_AUDIO_ENV).map(([name, value]) => [name, value.replaceAll(AGENT_AUDIO_SINK, missing)]),
		);
		// Routed proofs run first: they show each player works, so an unlinked result is meaningful.
		const failures: string[] = [];
		for (const [name] of players) {
			const failure = await observe([name, wav], AGENT_AUDIO_ENV, "sandbox");
			if (failure) failures.push(`${name}: ${failure}`);
		}
		for (const [name] of players) {
			const failure = await observe([name, wav], missingEnv, "unlinked");
			if (failure) failures.push(`${name}: ${failure}`);
		}
		const after = defaultSinks(graph());
		if (after !== before) failures.push(`default sinks changed: ${before} -> ${after}`);
		if (failures.length > 0) throw new Error(`routing proof failed; ${failures.join("; ")}`);
		const names = players.map(([name]) => name).join(", ");
		console.log(`audio-sandbox: routing proven for ${names}: sandboxed -> ${AGENT_AUDIO_SINK}, missing sink -> unlinked; ${after}`);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

// ---- CLI -----------------------------------------------------------------

function option(args: string[], flag: string): string {
	const value = args[args.indexOf(flag) + 1];
	if (!args.includes(flag) || !value || value.startsWith("--")) throw new Error(`${flag} is required`);
	return value;
}

async function main(args: string[]): Promise<void> {
	const [command, ...rest] = args;
	const check = rest.includes("--check");
	const fileMerges: Record<string, (text: string | undefined) => string> = { dotenv: mergeDotenv };
	const merge = fileMerges[command];
	if (merge) {
		const file = option(rest, "--file");
		const current = readRegular(file);
		const next = merge(current);
		if (!check) console.log(`audio-sandbox: ${command} ${file} ${writeIfChanged(file, next, current)}`);
		return;
	}
	if (command !== "host") {
		throw new Error("usage: install.ts host --home DIR | dotenv --file FILE [--check]");
	}
	const home = option(rest, "--home");
	const dropIn = join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "pipewire", "pipewire.conf.d", "60-agent-sandbox.conf");
	const claude = join(process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "settings.json");
	const currentDropIn = readRegular(dropIn);
	if (currentDropIn !== undefined && !currentDropIn.startsWith(OWNER)) {
		throw new Error(`Refusing unowned PipeWire drop-in: ${dropIn}`);
	}
	const currentClaude = readRegular(claude);
	const nextClaude = mergeClaudeSettings(currentClaude);
	if (check) return;
	console.log(`audio-sandbox: PipeWire drop-in ${dropIn} ${writeIfChanged(dropIn, renderDropIn(), currentDropIn)}`);
	console.log(`audio-sandbox: Claude Code env ${claude} ${writeIfChanged(claude, nextClaude, currentClaude)}`);
	await proveLive();
}

if (import.meta.main) {
	await main(Bun.argv.slice(2)).catch((error: unknown) => {
		console.error(`audio-sandbox: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
