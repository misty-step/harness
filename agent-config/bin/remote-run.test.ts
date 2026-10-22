import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "remote-run.ts");
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

const VMS = { vms: [
	{ vm_name: "mine", status: "running", tags: ["remote-run", "lane"], comment: "x" },
	{ vm_name: "pocket-kaylee", status: "running", tags: ["pocket-captain"], comment: "Serenity" },
	{ vm_name: "theirs", status: "running", tags: ["tach"], comment: "y" },
] };

// Stubs log argv as JSON lines; ssh answers `exe.dev ls --json` from $STUB_VMS and fails
// the first $STUB_SSH_FAILS VM probes.
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "remote-run-"));
	roots.push(root);
	const bin = join(root, "bin");
	mkdirSync(bin);
	mkdirSync(join(root, "home"));
	const stub = (name: string, body: string) => {
		writeFileSync(join(bin, name), `#!${process.execPath}\nimport { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";\nconst a = process.argv.slice(2);\nappendFileSync(process.env.STUB_LOG, JSON.stringify([${JSON.stringify(name)}, ...a]) + "\\n");\n${body}`);
		chmodSync(join(bin, name), 0o755);
	};
	stub("ssh", `
if (a.includes("ls") && a.includes("--json")) { console.log(JSON.stringify(JSON.parse(process.env.STUB_VMS))); process.exit(0); }
if (a.includes("true") && process.env.STUB_COUNT) {
  const n = existsSync(process.env.STUB_COUNT) ? Number(readFileSync(process.env.STUB_COUNT, "utf8")) : 0;
  writeFileSync(process.env.STUB_COUNT, String(n + 1));
  if (n < Number(process.env.STUB_SSH_FAILS)) process.exit(255);
}
if (a.at(-1)?.includes("exit3")) process.exit(3);
if (a.at(-1)?.includes("docker run") && process.env.STUB_DOCKER_CODE) process.exit(Number(process.env.STUB_DOCKER_CODE));
`);
	stub("scp", "");
	stub("rsync", `if (process.env.STUB_RSYNC_FAIL && a.some((x) => x.includes(process.env.STUB_RSYNC_FAIL))) process.exit(23);`);
	const log = join(root, "log");
	writeFileSync(log, "");
	const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: join(root, "home"), STUB_LOG: log, STUB_VMS: JSON.stringify(VMS),
		REMOTE_RUN_TAG: "lane", REMOTE_RUN_POLL_MS: "1", REMOTE_RUN_WAIT_SECS: "5", STUB_COUNT: join(root, "count") } as Record<string, string>;
	const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);
	return { root, env, calls };
}

async function remoteRun(f: ReturnType<typeof fixture>, args: string[], extra: Record<string, string> = {}, cwd?: string) {
	const p = Bun.spawn([process.execPath, cli, ...args], { env: { ...f.env, ...extra }, cwd, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
	return { out, err, code };
}

test("help documents commands and unknown input exits 2", async () => {
	const f = fixture();
	const help = await remoteRun(f, ["--help"]);
	expect(help.code).toBe(0);
	for (const word of ["vm new", "vm exec", "vm put", "vm get", "vm rm", "build"]) expect(help.out).toContain(word);
	for (const bad of [["nope"], [], ["vm"], ["vm", "new", "Bad_Name"], ["vm", "new", "x", "--bogus", "1"], ["build", "--image", "alpine"], ["vm", "exec", "mine"]]) {
		const r = await remoteRun(f, bad);
		expect(r.code).toBe(2);
		expect(r.err).toContain("Usage:");
	}
	expect(f.calls()).toEqual([]);
});

test("vm new refuses an existing name and prints its state", async () => {
	const f = fixture();
	const r = await remoteRun(f, ["vm", "new", "theirs"]);
	expect(r.code).toBe(1);
	expect(r.err).toContain("already exists: running");
	expect(f.calls().some((c) => c.includes("new"))).toBe(false);
});

test("vm new creates a tagged VM, waits for ssh and prints the target", async () => {
	const f = fixture();
	const r = await remoteRun(f, ["vm", "new", "task-1", "--cpu", "2", "--memory", "8GB", "--disk", "20GB", "--comment", "demo"], { STUB_SSH_FAILS: "2" });
	expect(r.code).toBe(0);
	expect(r.out.trim()).toBe("task-1.exe.xyz");
	const calls = f.calls();
	expect(calls).toContainEqual(["ssh", "-o", "BatchMode=yes", "exe.dev", "new", "--name=task-1", "--tag=remote-run,lane", "--comment='demo'", "--json", "--cpu=2", "--memory=8GB", "--disk=20GB"]);
	expect(calls.filter((c) => c.includes("true")).length).toBe(3);
	expect(JSON.stringify(calls)).not.toContain("StrictHostKeyChecking=no\"");
});

test("vm new quotes the comment for the exe.dev lobby, defaults it, and refuses quotes", async () => {
	const f = fixture();
	expect((await remoteRun(f, ["vm", "new", "task-2", "--comment", "QA PR 476; disposable"])).code).toBe(0);
	expect(f.calls().find((c) => c.includes("--name=task-2"))).toContain("--comment='QA PR 476; disposable'");
	expect((await remoteRun(f, ["vm", "new", "task-3"])).code).toBe(0);
	expect(f.calls().find((c) => c.includes("--name=task-3"))).toContain("--comment='remote-run; disposable'");
	const bad = await remoteRun(f, ["vm", "new", "task-4", "--comment", "x' --image evil"]);
	expect(bad.code).toBe(2);
	expect(f.calls().some((c) => c.includes("--name=task-4"))).toBe(false);
});

test("vm exec passes the exit code and quotes arguments; put/get use scp -r", async () => {
	const f = fixture();
	const r = await remoteRun(f, ["vm", "exec", "mine", "--", "sh", "-c", "it's fine"]);
	expect(r.code).toBe(0);
	expect(f.calls().at(-1)).toEqual(["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "mine.exe.xyz", `'sh' '-c' 'it'\\''s fine'`]);
	expect((await remoteRun(f, ["vm", "exec", "mine", "--", "exit3"])).code).toBe(3);
	await remoteRun(f, ["vm", "put", "mine", "./a", "~/b"]);
	expect(f.calls().at(-1)).toEqual(["scp", "-r", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "./a", "mine.exe.xyz:~/b"]);
	await remoteRun(f, ["vm", "get", "mine", "~/b", "./a"]);
	expect(f.calls().at(-1)).toEqual(["scp", "-r", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "mine.exe.xyz:~/b", "./a"]);
});

test("vm rm only deletes VMs tagged remote-run, by exact name", async () => {
	const f = fixture();
	expect((await remoteRun(f, ["vm", "rm", "pocket-kaylee"])).err).toContain("not tagged remote-run");
	const refused = await remoteRun(f, ["vm", "rm", "theirs"]);
	expect(refused.code).toBe(1);
	expect(refused.err).toContain("not tagged remote-run");
	expect((await remoteRun(f, ["vm", "rm", "missing"])).code).toBe(1);
	expect((await remoteRun(f, ["vm", "rm", "mine*"])).code).toBe(2);
	expect(f.calls().some((c) => c.includes("rm"))).toBe(false);
	expect((await remoteRun(f, ["vm", "rm", "mine"])).code).toBe(0);
	expect(f.calls().at(-1)).toEqual(["ssh", "-o", "BatchMode=yes", "exe.dev", "rm", "mine"]);
});

function repo(f: ReturnType<typeof fixture>) {
	const dir = join(f.root, "proj");
	mkdirSync(dir);
	const git = (...a: string[]) => Bun.spawnSync(["git", "-C", dir, ...a]);
	git("init", "-q");
	writeFileSync(join(dir, "a.txt"), "a");
	writeFileSync(join(dir, "untracked.txt"), "u");
	writeFileSync(join(dir, "ignored.txt"), "i");
	writeFileSync(join(dir, ".gitignore"), "ignored.txt\n");
	git("add", "a.txt", ".gitignore");
	return dir;
}

test("build rejects privileged and host-affecting flags before any remote call", async () => {
	const f = fixture();
	for (const flag of ["--privileged", "--device", "--pid", "--ipc", "--network", "-v", "--cap-add", "--security-opt"]) {
		const r = await remoteRun(f, ["build", "--image", "alpine", flag, "x", "--", "true"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("not allowed");
	}
	expect((await remoteRun(f, ["build", "--image", "-v/:/h", "--", "true"])).code).toBe(2);
	expect((await remoteRun(f, ["build", "--image", "alpine", "--fetch", "../x", "--", "true"])).code).toBe(2);
	expect(f.calls()).toEqual([]);
});

test("build syncs git files, runs unprivileged docker, fetches and always cleans up", async () => {
	const f = fixture();
	const dir = repo(f);
	const r = await remoteRun(f, ["build", "--image", "alpine:3.22", "--dir", dir, "--fetch", "out/x.txt", "--cpus", "2", "--memory", "4g", "--timeout", "5m", "--", "sh", "-c", "echo 'hi'"], { STUB_DOCKER_CODE: "7" });
	expect(r.code).toBe(7);
	const calls = f.calls();
	const [, id] = /remote-run-(proj-[0-9a-f]{8})/.exec(JSON.stringify(calls))!;
	const remote = `agent-work/${id}`;
	const ssh = (cmd: string) => ["ssh", "-o", "BatchMode=yes", "hetzner-ci", cmd];
	expect(calls[0]).toEqual(ssh(`mkdir -p '${remote}'`));
	const upload = calls[1];
	expect(upload.slice(0, 3)).toEqual(["rsync", "-az", "--from0"]);
	expect(upload).toContain("-e");
	expect(upload).toContain("ssh -o BatchMode=yes");
	expect(upload.at(-1)).toBe(`hetzner-ci:${remote}/`);
	const filesFrom = upload.find((x) => x.startsWith("--files-from="))!;
	expect(filesFrom).toContain(`${id}.files`);
	expect(calls[2]).toEqual(ssh(`timeout --kill-after=10s 5m docker run --rm --name remote-run-${id} --cpus 2 --memory 4g --pids-limit 4096 --security-opt no-new-privileges -w /work -v "$HOME"/'${remote}':/work alpine:3.22 'sh' '-c' 'echo '\\''hi'\\'''`));
	expect(calls[3].slice(0, 2)).toEqual(["rsync", "-a"]);
	expect(calls[3].at(-2)).toBe(`hetzner-ci:${remote}/out/x.txt`);
	expect(calls[3].at(-1)).toBe(join(f.root, "home", ".cache/tmp/remote-run", id, "out") + "/");
	expect(calls.at(-1)).toEqual(ssh(`docker rm -f remote-run-${id} >/dev/null 2>&1; rm -rf '${remote}'`));
	expect(r.err).toContain(`fetched out/x.txt -> ${join(f.root, "home", ".cache/tmp/remote-run", id, "out/x.txt")}`);
	expect(JSON.stringify(calls)).not.toMatch(/privileged|--device|docker\.sock|--pid[ =]|--ipc|StrictHostKeyChecking/);
});

test("build uploads only tracked and untracked-unignored files and cleans up when upload fails", async () => {
	const f = fixture();
	const dir = repo(f);
	let r = await remoteRun(f, ["build", "--image", "alpine", "--dir", dir, "--", "true"], { STUB_RSYNC_FAIL: "hetzner-ci:agent-work" });
	expect(r.code).toBe(1);
	const calls = f.calls();
	expect(calls.some((c) => c.join(" ").includes("docker run"))).toBe(false);
	expect(calls.at(-1)?.at(-1)).toMatch(/rm -rf 'agent-work\/proj-[0-9a-f]{8}'$/);
	// the file list is removed with the run; list contents are checked via a fresh run that keeps the stub's argv
	const g = fixture();
	const dir2 = repo(g);
	const listProbe = join(g.root, "bin", "rsync");
	writeFileSync(listProbe, `#!${process.execPath}\nimport { appendFileSync, readFileSync } from "node:fs";\nconst ff = process.argv.find((x) => x.startsWith("--files-from="));\nif (ff) appendFileSync(process.env.STUB_LOG + ".list", readFileSync(ff.slice(13), "utf8"));\n`);
	chmodSync(listProbe, 0o755);
	r = await remoteRun(g, ["build", "--image", "alpine", "--dir", dir2, "--", "true"]);
	expect(r.code).toBe(0);
	expect(readFileSync(g.env.STUB_LOG + ".list", "utf8").split("\0").filter(Boolean).sort()).toEqual([".gitignore", "a.txt", "untracked.txt"]);
});
