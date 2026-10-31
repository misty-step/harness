#!/usr/bin/env bun
// Test double for the `gh` calls ship-loop makes to find a pre-cutover v1 ledger on a change's pull request.
// Pull requests live in the `pulls` of $SHIP_LOOP_FAKE_STORE. SHIP_LOOP_FAKE_FAIL=gh fails every call; =gh-api
// fails only comment reads.
// Like gh: `pr list` filters by exact --head and by --state (default open) and stops at --limit (default 30);
// `api` returns one page of comments (two here) unless --paginate follows every page. The --jq filter is not
// evaluated: each comment prints as the [login, body] line ship-loop's filter selects.
import { readFileSync } from "node:fs";

type Pull = {
  number: number; url: string; state: string; headRefName: string; isCrossRepository: boolean; author: string;
  comments: { login: string; body: string }[];
};
const store = process.env.SHIP_LOOP_FAKE_STORE;
if (!store) throw new Error("SHIP_LOOP_FAKE_STORE is required");
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(store, "utf8")) as { change: { project: string; selector: string }; pulls?: Pull[] };
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
function refuse(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}
const fail = (process.env.SHIP_LOOP_FAKE_FAIL ?? "").split(",");
if (fail.includes("gh") || (fail.includes("gh-api") && args[0] === "api")) refuse("HTTP 503: GitHub unavailable");
const repo = `${state.change.project.replace(/^gh\//, "")}/${state.change.selector.split("/")[0]}`;
const pulls = state.pulls ?? [];

if (args[0] === "pr" && args[1] === "list") {
  if (flag("--repo") !== repo) refuse(`GraphQL: Could not resolve to a Repository with the name '${flag("--repo")}'`);
  const head = flag("--head");
  const wanted = flag("--state") ?? "open";
  const listed = pulls
    .filter((p) => (head === undefined || p.headRefName === head) && (wanted === "all" || p.state.toLowerCase() === wanted))
    .slice(0, Number(flag("--limit") ?? 30))
    .map(({ comments: _comments, author, ...pr }) => ({ ...pr, author: { login: author } }));
  process.stdout.write(JSON.stringify(listed) + "\n");
} else if (args[0] === "api") {
  const path = /^repos\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/comments(?:\?|$)/.exec(args.find((a) => a.startsWith("repos/")) ?? "");
  const pull = path && path[1] === repo ? pulls.find((p) => p.number === Number(path[2])) : undefined;
  if (!pull) refuse("HTTP 404: Not Found");
  const comments = args.includes("--paginate") ? pull.comments : pull.comments.slice(0, 2);
  for (const c of comments) process.stdout.write(JSON.stringify([c.login, c.body]) + "\n");
} else {
  refuse(`fake gh: unexpected ${args.join(" ")}`, 2);
}
