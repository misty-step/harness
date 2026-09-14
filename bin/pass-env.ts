#!/usr/bin/env bun
// pass-env: owned standalone launcher (misty-step/omp-config)

import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";

class CliError extends Error {
	constructor(readonly code: string, message: string, readonly exitCode = 1) {
		super(message);
	}
}

type Mapping = { name: string; entry: string };
type Options =
	| { command: "help" }
	| { command: "list"; prefix: string; json: boolean }
	| { command: "run"; files: string[]; explicit: Mapping[]; argv: string[] };

function usage(): string {
	return `Usage:
  pass-env list [prefix] [--json]
  pass-env run [-f|--env-file reference-file]... [-e|--env NAME=entry]... -- command args...

list prints sorted entry names only, without decrypting (--json prints an array).
The store is PASSWORD_STORE_DIR or HOME/.password-store. Prefix is a literal
entry-name prefix, not a glob; a trailing slash restricts it to a directory.

Reference files (convention: .env.pass) contain NAME=pass-store/entry mappings.
Blank lines and full-line # comments are allowed. Files are data: no shell
execution, quotes, interpolation, export statements, or inline comments.
Files apply in order; explicit -e mappings override all files. Duplicate names
within one file are errors. At least one mapping and a command are required.

Each entry must be a regular, non-symlink .gpg file containing ONLY its value.
The whole UTF-8 plaintext is used, including all newlines and empty values;
NUL and invalid UTF-8 are rejected. Mapped values override inherited variables.
The child inherits other environment variables, cwd, and interactive stdio.
pass/GPG must already be installed and unlocked; this command never prompts
for an unlock. Unlock with ordinary pass/GPG outside this command if needed.

The launcher never prints plaintext. Child output is normal and unfiltered:
this prevents accidental launcher output, not disclosure by the child itself.`;
}

function validEntry(entry: string): boolean {
	return entry.length > 0 && !isAbsolute(entry) && !/[\\\x00-\x1f\x7f]/.test(entry)
		&& entry.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function mapping(input: string, location: string): Mapping {
	const equals = input.indexOf("=");
	const name = input.slice(0, equals).trim();
	const entry = input.slice(equals + 1).trim();
	if (equals < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
		throw new CliError("USAGE", `${location}: expected NAME=entry`, 2);
	}
	if (!validEntry(entry)) throw new CliError("USAGE", `${location}: invalid entry for ${name}`, 2);
	return { name, entry };
}

function parseArgs(args: string[]): Options {
	if (args.length === 0 || (args.length === 1 && ["--help", "-h"].includes(args[0]))) return { command: "help" };
	if (args.length === 2 && ["list", "run"].includes(args[0]) && ["--help", "-h"].includes(args[1])) return { command: "help" };
	if (args[0] === "list") {
		let prefix: string | undefined;
		let json = false;
		for (const arg of args.slice(1)) {
			if (arg === "--json") json = true;
			else if (prefix === undefined && !arg.startsWith("-")) prefix = arg;
			else throw new CliError("USAGE", "expected list [prefix] [--json]", 2);
		}
		if (prefix && !validEntry(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix)) {
			throw new CliError("USAGE", "invalid entry prefix", 2);
		}
		return { command: "list", prefix: prefix ?? "", json };
	}
	if (args[0] !== "run") throw new CliError("USAGE", "expected list or run; use --help for usage", 2);
	const files: string[] = [];
	const explicit: Mapping[] = [];
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			const argv = args.slice(index + 1);
			if (!argv[0] || (files.length === 0 && explicit.length === 0)) break;
			return { command: "run", files, explicit, argv };
		}
		if (!["-e", "--env", "-f", "--env-file"].includes(arg)) throw new CliError("USAGE", "unexpected run argument", 2);
		const value = args[++index];
		if (!value || value === "--") throw new CliError("USAGE", `${arg} requires a value`, 2);
		if (arg === "-e" || arg === "--env") explicit.push(mapping(value, "--env"));
		else files.push(value);
	}
	throw new CliError("USAGE", "run requires mappings and -- command args...", 2);
}

function mappings(options: Extract<Options, { command: "run" }>): Map<string, string> {
	const result = new Map<string, string>();
	for (let index = 0; index < options.files.length; index += 1) {
		const location = `reference file ${index + 1}`;
		let text: string;
		try {
			if (!statSync(options.files[index]).isFile()) throw new Error();
			text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(options.files[index]));
		} catch {
			throw new CliError("REFERENCE_FILE", `${location}: cannot read regular UTF-8 file`);
		}
		const seen = new Set<string>();
		for (const [lineIndex, raw] of text.split("\n").entries()) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const item = mapping(line, `${location}, line ${lineIndex + 1}`);
			if (seen.has(item.name)) throw new CliError("USAGE", `${location}: duplicate mapping ${item.name}`, 2);
			seen.add(item.name);
			result.set(item.name, item.entry);
		}
	}
	for (const item of options.explicit) result.set(item.name, item.entry);
	if (!result.size) throw new CliError("USAGE", "run requires at least one mapping", 2);
	return result;
}

function storePath(): string {
	const configured = process.env.PASSWORD_STORE_DIR;
	const home = process.env.HOME;
	if (!configured && !home) throw new CliError("STORE", "set PASSWORD_STORE_DIR or HOME");
	const root = resolve(configured || join(home!, ".password-store"));
	try {
		let current = parse(root).root;
		for (const part of relative(current, root).split(sep).filter(Boolean)) {
			current = join(current, part);
			if (!lstatSync(current).isDirectory()) throw new Error();
		}
	} catch {
		throw new CliError("STORE", "store must be an existing directory with no symlink components");
	}
	return root;
}

function validateEntry(root: string, name: string, entry: string): void {
	try {
		let current = root;
		const parts = `${entry}.gpg`.split("/");
		for (const [index, part] of parts.entries()) {
			current = join(current, part);
			const info = lstatSync(current);
			if (index === parts.length - 1 ? !info.isFile() : !info.isDirectory()) throw new Error();
		}
	} catch {
		throw new CliError("ENTRY", `${name}: entry must be an existing regular file with no symlink components`);
	}
}

function listEntries(root: string, prefix: string): string[] {
	const entries: string[] = [];
	function visit(directory: string, base: string): void {
		for (const item of readdirSync(directory, { withFileTypes: true })) {
			if (item.name === ".git") continue;
			const entry = base ? `${base}/${item.name}` : item.name;
			if (!validEntry(entry)) continue;
			if (item.isDirectory()) visit(join(directory, item.name), entry);
			else if (item.isFile() && entry.endsWith(".gpg")) {
				const name = entry.slice(0, -4);
				if (validEntry(name) && name.startsWith(prefix)) entries.push(name);
			}
		}
	}
	try {
		visit(root, "");
	} catch {
		throw new CliError("STORE", "cannot list store entries");
	}
	return entries.sort();
}

async function decrypt(root: string, name: string, entry: string): Promise<string> {
	let bytes: ArrayBuffer;
	try {
		const backend = Bun.spawn({
			cmd: ["pass", "show", "--", entry],
			env: { ...process.env, PASSWORD_STORE_DIR: root, PASSWORD_STORE_GPG_OPTS: "--batch --pinentry-mode error" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
		});
		const [output, status] = await Promise.all([new Response(backend.stdout).arrayBuffer(), backend.exited]);
		if (status !== 0) throw new Error();
		bytes = output;
	} catch {
		throw new CliError("DECRYPT", `${name}: pass lookup failed; check pass/GPG installation and unlock outside this command`);
	}
	try {
		const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		if (value.includes("\0")) throw new Error();
		return value;
	} catch {
		throw new CliError("VALUE", `${name}: entry must contain UTF-8 without NUL`);
	}
}

async function runChild(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
	let child: Bun.Subprocess<"inherit", "inherit", "inherit">;
	try {
		child = Bun.spawn({ cmd: argv, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
	} catch {
		throw new CliError("COMMAND", "could not start command");
	}
	const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;
	const handlers = signals.map((signal) => {
		const handler = () => { child.kill(signal); };
		process.on(signal, handler);
		return handler;
	});
	let code: number;
	try {
		code = await child.exited;
	} finally {
		signals.forEach((signal, index) => process.removeListener(signal, handlers[index]));
	}
	if (child.signalCode) process.kill(process.pid, child.signalCode);
	return code;
}

async function main(args: string[]): Promise<number> {
	const options = parseArgs(args);
	if (options.command === "help") {
		console.log(usage());
		return 0;
	}
	const root = storePath();
	if (options.command === "list") {
		const entries = listEntries(root, options.prefix);
		if (options.json) console.log(JSON.stringify(entries));
		else if (entries.length) console.log(entries.join("\n"));
		return 0;
	}
	const requested = mappings(options);
	for (const [name, entry] of requested) validateEntry(root, name, entry);
	const env: NodeJS.ProcessEnv = Object.assign(Object.create(null), process.env);
	const values = new Map<string, string>();
	for (const [name, entry] of requested) {
		let value = values.get(entry);
		if (value === undefined) {
			value = await decrypt(root, name, entry);
			values.set(entry, value);
		}
		env[name] = value;
	}
	return runChild(options.argv, env);
}

if (import.meta.main) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (error) {
		const failure = error instanceof CliError ? error : new CliError("INTERNAL", "command failed");
		console.error(`${failure.code}: ${failure.message}`);
		process.exitCode = failure.exitCode;
	}
}
