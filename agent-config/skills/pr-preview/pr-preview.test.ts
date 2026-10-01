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
  console.log(JSON.stringify({state:state.closed ? "closed" : "open",head:"${sha}",base:"${base}",same_repo:true,private:true,repo:"example/product"}));
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
      const tags = [...command.matchAll(/'--tag' '([^']+)'/g)].map(x=>x[1]);
      state.vms.push({vm_name:vm,tags}); save();
    } else if (command.startsWith("'rm'")) {
      const vm = /'rm' '([^']+)'/.exec(command)[1];
      state.vms = state.vms.filter(x=>x.vm_name!==vm); save();
    }
  } else if (command.includes('cat "$HOME/pr-preview/status.json"')) {
    const vm = state.vms.at(-1).vm_name;
    console.log(JSON.stringify({...state.status,schema:1,sha:"${sha}",url:"https://"+vm+".exe.xyz"}));
  } else await Bun.stdin.text();
}
`;

async function run(status: Record<string, unknown>, options: { closed?: boolean; foreign?: boolean; owned?: boolean; down?: boolean } = {}) {
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
	writeFileSync(stateFile, JSON.stringify({ status, closed: options.closed, vms: initialVms }));
	const output = join(dir, "output");
	const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", script, options.down ? "down" : "up", "--repo", "example/product", "--pr", "7"], {
		cwd: dir,
		env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_TOKEN: "fixture-token", PR_PREVIEW_CHECKOUT: dir, PR_PREVIEW_OUTPUT_DIR: output, TMPDIR: dir },
		stdout: "pipe", stderr: "pipe",
	});
	const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { exit, facts: JSON.parse(readFileSync(join(output, "facts.json"), "utf8")), state: JSON.parse(readFileSync(stateFile, "utf8")), stdout, stderr };
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
