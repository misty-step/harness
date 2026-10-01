import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "pr-preview.ts");
const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "pr-preview-contract-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sha = "a".repeat(40);
const base = "b".repeat(40);

// The external CLI fixtures own mutable PR/VM state. Assertions concern the
// controller's publishable outcome and resource ownership, not command spelling.
const fixture = `#!${process.execPath}
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
const file = join(dirname(process.argv[1]), "state.json");
const state = JSON.parse(readFileSync(file, "utf8"));
const args = process.argv.slice(2);
const save = () => writeFileSync(file, JSON.stringify(state));
const kind = basename(process.argv[1]);
if (kind === "gh") {
  console.log(JSON.stringify({state:state.closed ? "closed" : "open",head:state.booted && state.headAfterBoot ? state.headAfterBoot : "${sha}",base:"${base}",same_repo:!state.fork,private:true,repo:"example/product"}));
} else if (kind === "git") {
  const command = args.find(x => ["fetch","rev-parse","ls-tree","bundle","archive","update-ref"].includes(x));
  if (command === "rev-parse") console.log(args.at(-1).endsWith("^{tree}") ? "c".repeat(40) : args.at(-1).endsWith("/base") ? "${base}" : "${sha}");
  if (command === "ls-tree") console.log("100755 blob "+"d".repeat(40)+"\\t.exe/preview");
  if (command === "bundle") writeFileSync(args[args.indexOf("bundle")+2], "fixture Git objects");
  if (command === "archive") process.stdout.write("fixture source stream");
} else if (kind === "ssh") {
  const command = args.at(-1);
  if (args.includes("exe.dev")) {
    if (command.startsWith("'ls'")) console.log(JSON.stringify({vms:state.vms}));
    else if (command.startsWith("'new'")) {
      const vm = /'--name' '([^']+)'/.exec(command)[1];
      if (state.vms.some(x=>x.vm_name===vm)) process.exit(1);
      const tags = [...command.matchAll(/'--tag' '([^']+)'/g)].map(x=>x[1]);
      state.vms.push({vm_name:vm,tags}); save();
    } else if (command.startsWith("'rm'")) {
      const vm = /'rm' '([^']+)'/.exec(command)[1];
      state.vms = state.vms.filter(x=>x.vm_name!==vm); save();
    }
  } else if (command.includes('cat "$HOME/pr-preview/status.json"')) {
    const vm = state.vms.at(-1).vm_name;
    console.log(JSON.stringify({...state.status,schema:1,sha:"${sha}",url:"https://"+vm+".exe.xyz"}));
  } else {
    if (command.includes("systemd-run")) { state.booted = true; save(); }
    await Bun.stdin.text();
  }
}
`;

async function run(status: Record<string, unknown>, options: { closed?: boolean; foreign?: boolean; owned?: boolean; down?: boolean; fork?: boolean; requestedSha?: string; headAfterBoot?: string } = {}) {
	const dir = mkdtempSync(join(root, "case-"));
	for (const name of ["gh", "git", "ssh"]) {
		writeFileSync(join(dir, name), fixture);
		chmodSync(join(dir, name), 0o755);
	}
	const id = createHash("sha256").update("example/product").update("\0").update("7").digest("hex").slice(0, 32);
	const vm = `pr-7-${id}`;
	const stateFile = join(dir, "state.json");
	const initialVms = options.foreign ? [{ vm_name: vm, tags: ["somebody-elses-resource"] }]
		: options.owned ? [{ vm_name: vm, tags: ["pr-preview", `pr-owner-${id}`] }] : [];
	writeFileSync(stateFile, JSON.stringify({ status, closed: options.closed, fork: options.fork, headAfterBoot: options.headAfterBoot, vms: initialVms }));
	const output = join(dir, "output");
	const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", script, options.down ? "down" : "up", "--repo", "example/product", "--pr", "7", ...(options.requestedSha ? ["--sha", options.requestedSha] : [])], {
		cwd: dir,
		env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_TOKEN: "fixture-token", PR_PREVIEW_CHECKOUT: dir, PR_PREVIEW_OUTPUT_DIR: output, TMPDIR: dir },
		stdout: "pipe", stderr: "pipe",
	});
	const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { exit, facts: JSON.parse(readFileSync(join(output, "facts.json"), "utf8")), state: JSON.parse(readFileSync(stateFile, "utf8")), output, stdout, stderr };
}
const ready = {
	state: "ready", data: "Synthetic fixture",
	readiness: { productionBuild: true, health: true },
};

test("a ready deployment cannot omit either production build or healthy application proof", async () => {
	for (const readiness of [{ productionBuild: false, health: true }, { productionBuild: true, health: false }]) {
		const result = await run({ ...ready, readiness });
		expect(result.exit).toBe(1);
		expect(result.facts.outcome).toBe("failed");
	}
});

test("a production-built healthy deployment leaves its owned preview running", async () => {
	const result = await run(ready);
	expect(result.exit, `${result.stdout}\n${result.stderr}`).toBe(0);
	expect(result.facts.outcome).toBe("ready");
	expect(result.state.vms.map((vm: { vm_name: string }) => vm.vm_name)).toContain(result.facts.vm);
});

test("an open or reopened PR retains its existing preview", async () => {
	const result = await run({}, { owned: true, down: true });
	expect(result.exit).toBe(0);
	expect(result.facts.outcome).toBe("skipped");
	expect(result.state.vms.map((vm: { vm_name: string }) => vm.vm_name)).toContain(result.facts.vm);
});

test("closing a PR destroys the preview only when both ownership tags match", async () => {
	const result = await run({}, { closed: true, owned: true, down: true });
	expect(result.exit).toBe(0);
	expect(result.facts.outcome).toBe("deleted");
	expect(result.state.vms).toEqual([]);
});

test("a coincident VM name is not authority to destroy somebody else's resource", async () => {
	const result = await run({}, { closed: true, foreign: true, down: true });
	expect(result.exit).toBe(1);
	expect(result.facts.outcome).toBe("failed");
	expect(result.state.vms).toEqual([{ vm_name: result.facts.vm, tags: ["somebody-elses-resource"] }]);
});

test("obsolete or closed up events cannot replace an existing preview", async () => {
	for (const options of [{ owned: true, closed: true }, { owned: true, requestedSha: "0".repeat(40) }]) {
		const result = await run(ready, options);
		expect(result.exit).toBe(0);
		expect(result.facts.outcome).toBe("skipped");
		expect(result.state.vms.map((vm: { vm_name: string }) => vm.vm_name)).toContain(result.facts.vm);
	}
});

test("fork execution is an explicit exception without provisioning a VM", async () => {
	const result = await run(ready, { fork: true });
	expect(result.exit).toBe(0);
	expect(result.facts.outcome).toBe("unsupported");
	expect(result.state.vms).toEqual([]);
});

test("replacement refuses a foreign resource even when the PR is open", async () => {
	const result = await run(ready, { foreign: true });
	expect(result.exit).toBe(1);
	expect(result.facts.outcome).toBe("failed");
	expect(result.state.vms).toEqual([{ vm_name: result.facts.vm, tags: ["somebody-elses-resource"] }]);
});

test("an existing owned preview is replaced rather than colliding with the new deployment", async () => {
	const result = await run(ready, { owned: true });
	expect(result.exit, `${result.stdout}\n${result.stderr}`).toBe(0);
	expect(result.facts.outcome).toBe("ready");
});

test("a head change during boot removes obsolete preview and never publishes ready", async () => {
	const result = await run(ready, { headAfterBoot: "f".repeat(40) });
	expect(result.exit).toBe(0);
	expect(result.facts.outcome).toBe("skipped");
	expect(result.state.vms).toEqual([]);
});

test("private candidate fields cannot leak through deployment facts or saved status", async () => {
	const canary = "private-auth-canary";
	const result = await run({ ...ready, login: { token: canary }, readiness: { ...ready.readiness, session: canary } });
	expect(result.exit, `${result.stdout}\n${result.stderr}`).toBe(0);
	expect(JSON.stringify(result.facts)).not.toContain(canary);
	expect(result.stdout).not.toContain(canary);
	expect(readFileSync(join(result.output, "status.json"), "utf8")).not.toContain(canary);
});

test("oversized candidate metadata cannot become an unpostable ready comment", async () => {
	const result = await run({ ...ready, data: "x".repeat(2001) });
	expect(result.exit).toBe(1);
	expect(result.facts.outcome).toBe("failed");
});
