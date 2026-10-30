#!/usr/bin/env bun
// Test double for the `entire trail` calls ship-loop makes. State lives in $SHIP_LOOP_FAKE_STORE; when
// $SHIP_LOOP_FAKE_CALLS names a file, each invocation's arguments are appended to it as one JSON line.
// SHIP_LOOP_FAKE_FAIL is a comma list: read fails every read; post-after adds the finding, then fails the response;
// resolve fails every resolve. SHIP_LOOP_FAKE_RACE is another writer's event body, added just before this add.
// SHIP_LOOP_FAKE_ACTOR is the session's account; it defaults to the change author.
// Like Entire 0.12.2: finding commands need an explicit --trail and --project (a detached checkout has no branch
// to infer them from); lists are newest first and paged (two per page here); the default list shows only open,
// current findings; --include-dismissed without --status lists every status; a push (the store's `version`) makes
// earlier findings stale; the listing's `trail` is the change itself, carrying its parent trail's number, while
// `trail show` names the parent trail's author; a repeated --client-id returns the existing finding; and a blocked
// merge dry run exits non-zero after printing its JSON.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

type Finding = { id: string; body: string; actorId: string | null; status: string; version: number; clientId?: string };
type Change = { project: string; selector: string; trail: number; author: string | null; branch: string; merged?: boolean };
const store = process.env.SHIP_LOOP_FAKE_STORE;
if (!store) throw new Error("SHIP_LOOP_FAKE_STORE is required");
const args = process.argv.slice(2);
if (process.env.SHIP_LOOP_FAKE_CALLS) appendFileSync(process.env.SHIP_LOOP_FAKE_CALLS, JSON.stringify(args) + "\n");
const state = JSON.parse(readFileSync(store, "utf8")) as {
  findings: Finding[]; next: number; version: number; base_ref?: string; change: Change; trail_author?: string;
};
const fail = (process.env.SHIP_LOOP_FAKE_FAIL ?? "").split(",");
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const save = () => writeFileSync(store, JSON.stringify(state));
function refuse(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}
const command = args.slice(0, args[1] === "finding" ? 3 : 2).join(" ");
const { change } = state;
const [repo, number] = change.selector.split("/");

if (fail.includes("read") && !["trail finding add", "trail finding resolve"].includes(command)) refuse("HTTP 503: unavailable");
const selector = args[1] === "finding" ? flag("--trail") : args[2];
if (selector !== change.selector || flag("--project") !== change.project) {
  refuse(`no trail ${selector ?? "for the current branch"} in ${flag("--project") ?? "the origin's project"}`);
}

if (command === "trail show") {
  process.stdout.write(JSON.stringify({ number: change.trail, authorAccountId: state.trail_author ?? change.author ?? "" }) + "\n");
} else if (command === "trail merge") {
  process.stdout.write(JSON.stringify({ base: state.base_ref ?? "master", mergeable: false }) + "\n");
  process.exit(1);
} else if (command === "trail finding list") {
  const status = flag("--status") ?? (args.includes("--include-dismissed") ? "any" : "open");
  const freshness = flag("--freshness") ?? "current";
  const newest = state.findings
    .filter((f) => (status === "any" || status.split(",").includes(f.status)) &&
      (f.status !== "dismissed" || args.includes("--include-dismissed")) &&
      (freshness === "any" || (freshness === "stale") === (f.version < state.version)))
    .sort((a, b) => (a.id < b.id ? 1 : -1));
  const from = Number(flag("--cursor") ?? 0);
  const page = newest.slice(from, from + 2);
  const more = from + 2 < newest.length;
  const trail = {
    number: change.trail, url: `https://entire.com/${change.project}/${repo}/trails/${number}`,
    branch: change.merged ? "" : change.branch, originalBranch: change.branch, base: state.base_ref ?? "master",
    status: change.merged ? "merged" : "open", author: change.author === null ? null : { id: change.author, login: change.author },
  };
  process.stdout.write(JSON.stringify({ findings: page, has_more: more, ...(more ? { next_cursor: String(from + 2) } : {}), trail }) + "\n");
} else if (command === "trail finding add") {
  const clientId = flag("--client-id");
  const actorId = process.env.SHIP_LOOP_FAKE_ACTOR ?? change.author;
  let finding = state.findings.find((f) => clientId !== undefined && f.clientId === clientId);
  if (!finding) {
    const rival = process.env.SHIP_LOOP_FAKE_RACE;
    if (rival) state.findings.push({ id: String(state.next++).padStart(26, "0"), body: rival, actorId, status: "resolved", version: state.version });
    finding = { id: String(state.next++).padStart(26, "0"), body: flag("-m") ?? "", actorId, status: "open", version: state.version, clientId };
    state.findings.push(finding);
    save();
  }
  if (fail.includes("post-after")) refuse("HTTP 502: response lost");
  process.stdout.write(JSON.stringify(finding) + "\n");
} else if (command === "trail finding resolve") {
  const finding = state.findings.find((f) => f.id === args[3]);
  if (!finding) refuse(`no finding ${args[3]}`);
  if (fail.includes("resolve")) refuse("HTTP 503: resolve unavailable");
  finding.status = "resolved";
  save();
} else {
  refuse(`fake entire: unexpected ${args.join(" ")}`, 2);
}
