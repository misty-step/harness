#!/usr/bin/env bun
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { approvedModels } from "./omp-roster.ts";

// The approved-model table lives in omp-roster.ts: that launcher deploys as one file, so it
// cannot import from here.

type Model = { provider: string; id: string; effort?: string };
type Selection = { selector: string; model: Model };

function mapping(value: unknown, location: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${location} must be a mapping`);
	}
	return value as Record<string, unknown>;
}

function selector(value: unknown, location: string): Selection {
	if (typeof value !== "string") throw new Error(`${location} must be a concrete model selector`);
	const match = /^([a-z0-9-]+)\/([a-z0-9][a-z0-9.-]*)(?::([a-z]+))?$/.exec(value);
	if (!match) throw new Error(`${location} must be a concrete model selector`);
	const [, provider, id, effort] = match;
	const levels = approvedModels[`${provider}/${id}`]?.efforts;
	if (!levels) throw new Error(`${location} selects an unapproved model: ${provider}/${id}`);
	if (effort && !levels.includes(effort)) throw new Error(`${location} has unsupported effort: ${effort}`);
	return { selector: value, model: { provider, id, ...(effort ? { effort } : {}) } };
}

function configuredSelectors(config: unknown): Map<string, Model> {
	const root = mapping(config, "config");
	const roles = mapping(root.modelRoles, "modelRoles");
	if (Object.keys(roles).length === 0) throw new Error("modelRoles must not be empty");
	const chains = mapping(mapping(root.retry, "retry").fallbackChains, "retry.fallbackChains");
	const selections = new Map<string, Model>();
	const add = (value: unknown, location: string) => {
		const parsed = selector(value, location);
		selections.set(parsed.selector, parsed.model);
	};
	for (const [role, value] of Object.entries(roles)) {
		if (!/^[a-z][a-z0-9-]*$/.test(role)) throw new Error(`Invalid model role: ${role}`);
		// OMP's built-in web route is not a chat model. No other role is exempt.
		if (role === "web" && value === "web/exa") continue;
		add(value, `modelRoles.${role}`);
	}
	for (const [key, chain] of Object.entries(chains)) {
		if (key.includes("/")) add(key, `retry.fallbackChains key ${key}`);
		else if (!Object.hasOwn(roles, key)) throw new Error(`Unknown retry.fallbackChains role: ${key}`);
		if (!Array.isArray(chain)) throw new Error(`retry.fallbackChains.${key} must be an array`);
		if (key === "web") {
			if (roles.web !== "web/exa") throw new Error("web recovery needs the web/exa search role");
			for (const [index, value] of chain.entries()) {
				if (typeof value !== "string" || !/^web\/[a-z][a-z0-9-]*$/.test(value)) {
					throw new Error(`retry.fallbackChains.web[${index}] must be a web search provider`);
				}
			}
			continue;
		}
		for (const [index, value] of chain.entries()) add(value, `retry.fallbackChains.${key}[${index}]`);
	}
	const task = root.task === undefined ? undefined : mapping(root.task, "task");
	if (task?.agentModelOverrides !== undefined) {
		const overrides = mapping(task.agentModelOverrides, "task.agentModelOverrides");
		for (const [agent, value] of Object.entries(overrides)) {
			if (!/^[a-z][a-z0-9-]*$/.test(agent)) throw new Error(`Invalid task agent override: ${agent}`);
			if (typeof value === "string" && value.startsWith("@")) {
				const role = value.slice(1);
				if (!Object.hasOwn(roles, role) || role === "web") {
					throw new Error(`task.agentModelOverrides.${agent} does not resolve to a chat role: ${value}`);
				}
			} else {
				add(value, `task.agentModelOverrides.${agent}`);
			}
		}
	}
	if (root.providers !== undefined) {
		const tinyModel = mapping(root.providers, "providers").tinyModel;
		if (tinyModel !== undefined && tinyModel !== null && tinyModel !== "") {
			throw new Error("providers.tinyModel selects an unapproved local model");
		}
	}
	return selections;
}

async function command(args: string[], timeoutMs: number, cwd?: string): Promise<string> {
	const child = Bun.spawn(["omp", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	let timedOut = false;
	const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
	try {
		const [stdout, , code] = await Promise.all([
			new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
		]);
		// OMP's stderr may include credentials or provider responses; never relay it.
		if (timedOut) throw new Error("OMP command timed out");
		if (code !== 0) throw new Error(`OMP command failed (exit ${code})`);
		return stdout;
	} finally {
		clearTimeout(timeout);
	}
}

function json(value: string, location: string): unknown {
	try { return JSON.parse(value) as unknown; }
	catch { throw new Error(`${location} returned invalid JSON`); }
}

function checkCatalog(data: unknown, selections: Map<string, Model>): void {
	const catalog = mapping(data, "OMP catalog");
	if (!Array.isArray(catalog.models)) throw new Error("OMP catalog has no models array");
	for (const [selector, model] of selections) {
		const matches = catalog.models.filter((item: unknown) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return false;
			const entry = mapping(item, "OMP catalog entry");
			return entry.selector === `${model.provider}/${model.id}` &&
				entry.provider === model.provider && entry.id === model.id && entry.kind === "chat";
		});
		if (matches.length !== 1) throw new Error(`No unique exact catalog entry for ${selector}`);
		const entry = mapping(matches[0], "OMP catalog entry");
		if (model.effort && (!Array.isArray(entry.thinking) || !entry.thinking.includes(model.effort))) {
			throw new Error(`Catalog does not support ${selector}'s effort`);
		}
	}
}

function checkResponse(output: string, selector: string, model: Model): void {
	let assistants = 0;
	let completed = false;
	for (const line of output.split("\n")) {
		if (!line.trim()) continue;
		const event = mapping(json(line, "OMP print mode"), "OMP print event");
		if (event.type === "agent_end") completed = event.isTerminal === true;
		if (event.type !== "message_end") continue;
		const message = mapping(event.message, "OMP message_end.message");
		if (message.role !== "assistant") continue; // The user's echo is not a model response.
		assistants++;
		if (message.provider !== model.provider || message.model !== model.id) {
			throw new Error(`OMP routed ${selector} to a different provider/model`);
		}
		if (message.stopReason !== "stop") throw new Error(`OMP did not complete ${selector} successfully`);
	}
	if (!completed || assistants !== 1) throw new Error(`OMP did not finish exactly one assistant response for ${selector}`);
}

async function probe(configPath: string, selections: Map<string, Model>): Promise<void> {
	const catalog = json(await command(["models", "--json", "--no-extensions", "--config", configPath], 15_000), "OMP catalog");
	checkCatalog(catalog, selections);
	const scratch = join(homedir(), ".cache/tmp");
	await mkdir(scratch, { recursive: true });
	const cwd = await mkdtemp(join(scratch, "omp-model-policy-"));
	try {
		const overlay = join(cwd, "probe.yml");
		// A recovery hop or same-model retry must not turn a provider rejection
		// into a successful probe.
		await writeFile(overlay, "retry:\n  enabled: false\n  modelFallback: false\nadvisor:\n  enabled: false\n", { mode: 0o600 });
		for (const [chosen, model] of selections) {
			let output: string;
			try {
				output = await command([
				"--mode", "json", "--print", "--model", chosen, "--config", configPath,
				"--config", overlay, "--max-time", "25s", "--no-session", "--no-tools",
				"--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-title",
				"--system-prompt", "Reply only OK.", "Reply exactly OK.",
				], 35_000, cwd);
			} catch (error) {
				throw new Error(`Probe ${chosen}: ${(error as Error).message}`);
			}
			checkResponse(output, chosen, model);
		}
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	let values: { config?: string; probe?: boolean };
	try {
		({ values } = parseArgs({ options: { config: { type: "string" }, probe: { type: "boolean", default: false } }, strict: true }));
	} catch {
		throw new Error("Usage: omp-model-policy.ts [--config PATH] [--probe]");
	}
	const configPath = resolve(values.config ?? fileURLToPath(new URL("../config.yml", import.meta.url)));
	let text: string;
	try { text = await readFile(configPath, "utf8"); }
	catch { throw new Error(`Cannot read model policy config: ${configPath}`); }
	let config: unknown;
	try { config = Bun.YAML.parse(text); }
	catch { throw new Error(`Invalid YAML in model policy config: ${configPath}`); }
	const selections = configuredSelectors(config);
	if (values.probe) await probe(configPath, selections);
	console.log(`Model policy OK: ${selections.size} unique selector/effort combinations${values.probe ? " probed" : " checked"}`);
}

try { await main(); }
catch (error) {
	console.error(`omp-model-policy: ${(error as Error).message}`);
	process.exitCode = 1;
}
