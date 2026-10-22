#!/usr/bin/env bun
// remote-run: owned standalone launcher (misty-step/harness)

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";

const HELP = `Usage: remote-run <command>
  vm new <name> [--cpu N] [--memory 8GB] [--disk 20GB] [--comment text]
                            create a tagged exe.dev VM and wait for ssh
  vm exec <name> -- <cmd...>  run in the VM (streams output, passes exit code)
  vm put <name> <local> <remote> | vm get <name> <remote> <local>   scp -r
  vm rm <name>              delete a VM this tool created (tag remote-run)
  build --image IMG [--dir .] [--fetch PATH ...] [--cpus N] [--memory 8g]
        [--timeout 30m] -- <cmd...>
                            rsync --dir (tracked + untracked-unignored files) to
                            hetzner-ci, run it unprivileged in docker at /work,
                            fetch paths into ~/.cache/tmp/remote-run/<id>/, and
                            remove the remote copy
Owner tag: $REMOTE_RUN_TAG, else $USER. Names match [a-z0-9-]+.`;

class Usage extends Error {}
class Fail extends Error {}

const SSH_OPTS = ["-o", "BatchMode=yes"];
const NAME = /^[a-z0-9-]+$/;
const TOOL_TAG = "remote-run";
const BUILD_HOST = "hetzner-ci";
const FORBIDDEN = /^--(privileged|device|pid|ipc|uts|userns|network|net|cap-add|security-opt|volume|mount|add-host|runtime|gpus)\b|^-v$|^-u$/;

export const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

function run(cmd: string, args: string[], opts: { capture?: boolean; input?: string } = {}) {
	return new Promise<{ code: number; out: string }>((done, fail) => {
		const child = spawn(cmd, args, { stdio: [opts.input === undefined ? "inherit" : "pipe", opts.capture ? "pipe" : "inherit", "inherit"] });
		let out = "";
		child.stdout?.on("data", (d) => { out += d; });
		if (opts.input !== undefined) child.stdin?.end(opts.input);
		child.on("error", fail);
		child.on("close", (code, signal) => done({ code: code ?? (signal ? 128 + (signal === "SIGINT" ? 2 : 15) : 1), out }));
		active = child;
	});
}
let active: ReturnType<typeof spawn> | undefined;

function ownerTag(): string {
	const tag = (process.env.REMOTE_RUN_TAG || process.env.USER || "").toLowerCase();
	if (!NAME.test(tag) || tag === TOOL_TAG) throw new Usage("owner tag must match [a-z0-9-]+ (set REMOTE_RUN_TAG)");
	return tag;
}

const vmName = (name: string | undefined) => {
	if (!name || !NAME.test(name)) throw new Usage("VM name must match [a-z0-9-]+");
	return name;
};

/** Parse `--flag value` options up to `--`; returns options, positionals and the rest after `--`. */
function parse(args: string[], valued: string[], repeatable: string[] = []) {
	const opts: Record<string, string[]> = {};
	const pos: string[] = [];
	let rest: string[] | undefined;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--") { rest = args.slice(i + 1); break; }
		if (a.startsWith("-")) {
			const key = a.replace(/^--/, "");
			if (FORBIDDEN.test(a)) throw new Usage(`${a} is not allowed: remote-run build runs unprivileged`);
			if (!a.startsWith("--") || !valued.includes(key)) throw new Usage(`unknown option ${a}`);
			const value = args[++i];
			if (value === undefined) throw new Usage(`${a} needs a value`);
			if (opts[key] && !repeatable.includes(key)) throw new Usage(`${a} given twice`);
			(opts[key] ??= []).push(value);
		} else pos.push(a);
	}
	return { opts, pos, rest };
}

async function listVms(): Promise<any[]> {
	const { code, out } = await run("ssh", [...SSH_OPTS, "exe.dev", "ls", "--json"], { capture: true });
	if (code !== 0) throw new Fail("ssh exe.dev ls --json failed");
	try { return JSON.parse(out).vms ?? []; } catch { throw new Fail("could not parse exe.dev ls output"); }
}

const vmHost = (name: string) => `${name}.exe.xyz`;
const VM_SSH = [...SSH_OPTS, "-o", "StrictHostKeyChecking=accept-new"];

async function vm(args: string[]): Promise<number> {
	const [sub, ...rest] = args;
	switch (sub) {
		case "new": {
			const { opts, pos } = parse(rest, ["cpu", "memory", "disk", "comment"]);
			if (pos.length !== 1) throw new Usage("vm new <name> [options]");
			const name = vmName(pos[0]);
			const owner = ownerTag();
			for (const k of ["cpu", "memory", "disk"]) if (opts[k] && !/^\d+(\.\d+)?([KMGT]B?)?$/i.test(opts[k][0])) throw new Usage(`--${k} looks invalid`);
			const existing = (await listVms()).find((v) => v.vm_name === name);
			if (existing) {
				console.error(`VM ${name} already exists: ${existing.status} tags=${(existing.tags ?? []).join(",")} ${existing.comment ?? ""}`);
				return 1;
			}
			const comment = opts.comment?.[0] ?? "remote-run; disposable";
			if (!/^[^'\\\r\n]{1,200}$/.test(comment)) throw new Usage("--comment must be 1-200 characters without quotes, backslashes or newlines");
			// ssh joins the remote arguments with spaces and the exe.dev lobby re-splits them, so quote the free text.
			const newArgs = [...SSH_OPTS, "exe.dev", "new", `--name=${name}`, `--tag=${TOOL_TAG},${owner}`,
				`--comment='${comment}'`, "--json"];
			for (const k of ["cpu", "memory", "disk"]) if (opts[k]) newArgs.push(`--${k}=${opts[k][0]}`);
			const created = await run("ssh", newArgs, { capture: true });
			if (created.code !== 0) throw new Fail("ssh exe.dev new failed");
			const deadline = Date.now() + Number(process.env.REMOTE_RUN_WAIT_SECS ?? 180) * 1000;
			for (;;) {
				const probe = await run("ssh", [...VM_SSH, "-o", "ConnectTimeout=5", vmHost(name), "true"], { capture: true });
				if (probe.code === 0) break;
				if (Date.now() > deadline) throw new Fail(`VM ${name} created but ssh did not become ready`);
				await Bun.sleep(Number(process.env.REMOTE_RUN_POLL_MS ?? 3000));
			}
			console.log(vmHost(name));
			return 0;
		}
		case "exec": {
			const { pos, rest: cmd } = parse(rest, []);
			if (pos.length !== 1 || !cmd?.length) throw new Usage("vm exec <name> -- <command...>");
			return (await run("ssh", [...VM_SSH, vmHost(vmName(pos[0])), cmd.map(shellQuote).join(" ")])).code;
		}
		case "put":
		case "get": {
			const { pos } = parse(rest, []);
			if (pos.length !== 3) throw new Usage(`vm ${sub} <name> ${sub === "put" ? "<local> <remote>" : "<remote> <local>"}`);
			const host = vmHost(vmName(pos[0]));
			const [from, to] = sub === "put" ? [pos[1], `${host}:${pos[2]}`] : [`${host}:${pos[1]}`, pos[2]];
			return (await run("scp", ["-r", ...VM_SSH, from, to])).code;
		}
		case "rm": {
			const { pos } = parse(rest, []);
			if (pos.length !== 1) throw new Usage("vm rm <name>");
			const name = vmName(pos[0]);
			const found = (await listVms()).find((v) => v.vm_name === name);
			if (!found) throw new Fail(`VM ${name} not found`);
			if (!(found.tags ?? []).includes(TOOL_TAG)) throw new Fail(`refusing to delete ${name}: not tagged ${TOOL_TAG}, so remote-run did not create it`);
			return (await run("ssh", [...SSH_OPTS, "exe.dev", "rm", name])).code;
		}
		default:
			throw new Usage("vm <new|exec|put|get|rm>");
	}
}

async function build(args: string[]): Promise<number> {
	const { opts, pos, rest: cmd } = parse(args, ["image", "dir", "fetch", "cpus", "memory", "timeout"], ["fetch"]);
	if (pos.length || !cmd?.length) throw new Usage("build --image IMG [options] -- <command...>");
	const image = opts.image?.[0];
	if (!image || !/^[a-zA-Z0-9][a-zA-Z0-9._\/:@-]*$/.test(image)) throw new Usage("--image is required and must be an image reference");
	const cpus = opts.cpus?.[0] ?? "4";
	const memory = opts.memory?.[0] ?? "8g";
	const timeout = opts.timeout?.[0] ?? "30m";
	if (!/^\d+(\.\d+)?$/.test(cpus)) throw new Usage("--cpus must be a number");
	if (!/^\d+[bkmg]$/i.test(memory)) throw new Usage("--memory looks like 8g");
	if (!/^\d+[smh]$/.test(timeout)) throw new Usage("--timeout looks like 30m");
	const fetches = opts.fetch ?? [];
	for (const f of fetches) {
		if (isAbsolute(f) || normalize(f).startsWith("..") || /[\x00-\x1f]/.test(f)) throw new Usage(`--fetch ${f} must be relative to --dir`);
	}
	const dir = resolve(opts.dir?.[0] ?? ".");
	const files = spawnSync("git", ["-C", dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" });
	if (files.status !== 0) throw new Fail(`${dir} is not a git work tree`);
	const list = files.stdout.split("\0").filter((f) => f && existsSync(join(dir, f)));

	const id = `${basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40) || "work"}-${randomBytes(4).toString("hex")}`;
	const remoteDir = `agent-work/${id}`;
	const container = `remote-run-${id}`;
	const scratch = join(homedir(), ".cache", "tmp", "remote-run");
	const outDir = join(scratch, id);
	mkdirSync(outDir, { recursive: true });
	const listFile = join(scratch, `${id}.files`);
	writeFileSync(listFile, list.join("\0") + (list.length ? "\0" : ""));
	const rsyncSsh = ["-e", `ssh ${SSH_OPTS.join(" ")}`];

	let cleaned = false;
	const cleanup = async () => {
		if (cleaned) return;
		cleaned = true;
		rmSync(listFile, { force: true });
		const r = await run("ssh", [...SSH_OPTS, BUILD_HOST, `docker rm -f ${container} >/dev/null 2>&1; rm -rf ${shellQuote(remoteDir)}`]);
		if (r.code !== 0) console.error(`warning: could not remove ${BUILD_HOST}:~/${remoteDir}`);
	};
	let signalled = 0;
	for (const sig of ["SIGINT", "SIGTERM"] as const) {
		process.on(sig, () => {
			signalled = sig === "SIGINT" ? 130 : 143;
			active?.kill(sig);
		});
	}

	try {
		const mk = await run("ssh", [...SSH_OPTS, BUILD_HOST, `mkdir -p ${shellQuote(remoteDir)}`]);
		if (mk.code !== 0) throw new Fail(`could not create ${remoteDir} on ${BUILD_HOST}`);
		const sync = await run("rsync", ["-az", "--from0", `--files-from=${listFile}`, ...rsyncSsh, `${dir}/`, `${BUILD_HOST}:${remoteDir}/`]);
		if (sync.code !== 0) throw new Fail("rsync upload failed");
		if (signalled) return signalled;
		const docker = ["timeout", "--kill-after=10s", timeout, "docker", "run", "--rm", "--name", container,
			"--cpus", cpus, "--memory", memory, "--pids-limit", "4096", "--security-opt", "no-new-privileges",
			"-w", "/work", "-v", `"$HOME"/${shellQuote(remoteDir)}:/work`, image, ...cmd.map(shellQuote)].join(" ");
		const result = await run("ssh", [...SSH_OPTS, BUILD_HOST, docker]);
		let code = signalled || result.code;
		for (const f of fetches) {
			const target = join(outDir, dirname(f));
			mkdirSync(target, { recursive: true });
			const got = await run("rsync", ["-a", ...rsyncSsh, `${BUILD_HOST}:${remoteDir}/${f}`, `${target}/`]);
			if (got.code !== 0) { console.error(`warning: could not fetch ${f}`); code ||= 1; }
			else console.error(`fetched ${f} -> ${join(outDir, f)}`);
		}
		if (fetches.length) console.error(`fetched files are under ${outDir}`);
		return code;
	} finally {
		await cleanup();
	}
}

async function main(args: string[]): Promise<number> {
	if (args.length === 1 && ["--help", "-h", "help"].includes(args[0])) { console.log(HELP); return 0; }
	const [cmd, ...rest] = args;
	if (cmd === "vm") return vm(rest);
	if (cmd === "build") return build(rest);
	throw new Usage("unknown command");
}

if (import.meta.main) {
	try { process.exitCode = await main(process.argv.slice(2)); }
	catch (error) {
		if (error instanceof Usage) { console.error(`${error.message}\n\n${HELP}`); process.exitCode = 2; }
		else { console.error(error instanceof Fail ? error.message : `remote-run failed: ${(error as Error).message}`); process.exitCode = 1; }
	}
}
