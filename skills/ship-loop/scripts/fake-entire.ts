#!/usr/bin/env bun
// Test double for the `entire trail` calls ship-loop makes. Findings live in $SHIP_LOOP_FAKE_STORE.
// SHIP_LOOP_FAKE_FAIL=read fails every read; =post-after adds the finding, then fails the response.
// Like the real CLI, lists are newest first and paged (two per page here), a repeated --client-id
// returns the existing finding, and a blocked merge dry run exits non-zero after printing its JSON.
import { readFileSync, writeFileSync } from "node:fs";

type Finding = { id: string; body: string; actorId: string | null; status: string; clientId?: string };
const store = process.env.SHIP_LOOP_FAKE_STORE;
if (!store) throw new Error("SHIP_LOOP_FAKE_STORE is required");
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(store, "utf8")) as { findings: Finding[]; next: number; base_ref?: string };
const fail = process.env.SHIP_LOOP_FAKE_FAIL;
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const save = () => writeFileSync(store, JSON.stringify(state));
const command = args.slice(0, args[1] === "finding" ? 3 : 2).join(" ");
const writes = ["trail finding add", "trail finding resolve"];

if (fail === "read" && !writes.includes(command)) {
  process.stderr.write("HTTP 503: unavailable\n");
  process.exit(1);
}
if (command === "trail show") {
  process.stdout.write(JSON.stringify({ number: 1, authorAccountId: "conductor" }) + "\n");
} else if (command === "trail merge") {
  process.stdout.write(JSON.stringify({ base: state.base_ref ?? "master", mergeable: false }) + "\n");
  process.exit(1);
} else if (command === "trail finding list") {
  const newest = [...state.findings].sort((a, b) => (a.id < b.id ? 1 : -1));
  const from = Number(flag("--cursor") ?? 0);
  const page = newest.slice(from, from + 2);
  const more = from + 2 < newest.length;
  process.stdout.write(JSON.stringify({ findings: page, has_more: more, ...(more ? { next_cursor: String(from + 2) } : {}) }) + "\n");
} else if (command === "trail finding add") {
  const clientId = flag("--client-id");
  let finding = state.findings.find((f) => clientId !== undefined && f.clientId === clientId);
  if (!finding) {
    finding = { id: String(state.next++).padStart(26, "0"), body: flag("-m") ?? "", actorId: "conductor", status: "open", clientId };
    state.findings.push(finding);
    save();
  }
  if (fail === "post-after") {
    process.stderr.write("HTTP 502: response lost\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(finding) + "\n");
} else if (command === "trail finding resolve") {
  const finding = state.findings.find((f) => f.id === args[3]);
  if (!finding) {
    process.stderr.write(`no finding ${args[3]}\n`);
    process.exit(1);
  }
  finding.status = "resolved";
  save();
} else {
  process.stderr.write(`fake entire: unexpected ${args.join(" ")}\n`);
  process.exit(2);
}
