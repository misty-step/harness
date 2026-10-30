#!/usr/bin/env bun
// Test double for the gh and entire calls migrate-issues makes; state lives in $MIGRATE_ISSUES_FAKE_STORE.
// Like the real CLIs: gh lists stop at --limit (default 30); entire lists page newest first through
// nextPageToken, filter by --repo and --status, and omit changes; show omits empty changes; a
// repeated --idempotency-key replays its trail. store.fail fails the first call whose argv matches:
// "before" its effect, "after" it, or "comment" (issue close: comment posted, issue left open).
// Every call is appended to store.calls.
import { readFileSync, writeFileSync, writeSync } from "node:fs";

type Issue = { url: string; title: string; body: string; labels: string[]; state: "OPEN" | "CLOSED"; comments: string[]; reason?: string };
type Trail = {
  id: string;
  number: number;
  project: string;
  title: string;
  body: string;
  status: string;
  type: string;
  priority: string;
  repoIds: string[];
  changes?: unknown[];
  hidden?: boolean;
};
type Store = {
  repos: { nameWithOwner: string; hasIssuesEnabled?: boolean; isArchived?: boolean }[];
  issues: Issue[];
  onboarded: Record<string, string>;
  trails: Trail[];
  next: number;
  keys: Record<string, number>;
  pageSize?: number;
  hideCreated?: boolean;
  createOverrides?: Partial<Trail>;
  fail?: { match: string; when: "before" | "after" | "comment"; stderr?: string }[];
  calls: string[][];
};

const path = process.env.MIGRATE_ISSUES_FAKE_STORE;
if (!path) throw new Error("MIGRATE_ISSUES_FAKE_STORE is required");
const store = JSON.parse(readFileSync(path, "utf8")) as Store;
const args = process.argv.slice(2);
const save = () => writeFileSync(path, JSON.stringify(store));
store.calls.push(args);
save();

function flag(name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
    if (args[i] === `--${name}`) return args[i + 1];
  }
  return undefined;
}
function exit(code: number, message: string): never {
  writeSync(2, `${message}\n`);
  process.exit(code);
}
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const command = args.slice(0, 2).join(" ");
const failure = (store.fail ?? []).find((f) => new RegExp(f.match).test(args.join(" ")));
const failed = (fallback: string) => exit(1, failure?.stderr ?? fallback);
if (failure?.when === "before") failed(`HTTP 502: injected failure for ${command}`);
const after = () => {
  if (failure?.when === "after") failed(`HTTP 502: response lost for ${command}`);
};
if (command !== "issue close" && !args.includes("--json")) exit(2, `fake forge: ${command} without --json prints a table`);

const repoOf = (url: string) => url.split("/").slice(3, 5).join("/");
const issueJson = (i: Issue) => ({ url: i.url, number: Number(i.url.split("/").pop()), title: i.title, body: i.body, labels: i.labels.map((name) => ({ name })) });
const repoJson = (r: Store["repos"][number]) => ({ nameWithOwner: r.nameWithOwner, hasIssuesEnabled: r.hasIssuesEnabled ?? true, isArchived: r.isArchived ?? false });
const trailJson = ({ project, hidden: _hidden, changes, ...trail }: Trail) => ({
  ...trail, url: `https://entire.com/${project}/-/trails/${trail.number}`, ...(changes && changes.length > 0 ? { changes } : {}),
});
const onboarded = (repo: string) => store.onboarded[repo] ?? exit(1, `resolve processing placement for ${repo.slice(3)}: repo is not onboarded to Entire`);
const issueAt = (url: string) => store.issues.find((i) => i.url === url) ?? exit(1, `GraphQL: Could not resolve to an issue with the URL ${url}`);

if (command === "repo list") {
  const repos = store.repos.filter((r) => r.nameWithOwner.startsWith(`${args[2]}/`) && !(args.includes("--no-archived") && r.isArchived));
  print(repos.slice(0, Number(flag("limit") ?? 30)).map(repoJson));
} else if (command === "repo view") {
  print(repoJson(store.repos.find((r) => r.nameWithOwner === args[2]) ?? exit(1, `GraphQL: Could not resolve to a Repository with the name '${args[2]}'.`)));
} else if (command === "issue list") {
  if (flag("state") !== "open") exit(2, "fake gh: only open issue lists are supported");
  const repo = store.repos.find((r) => r.nameWithOwner === flag("repo"));
  if (repo?.hasIssuesEnabled === false) exit(1, `the '${repo.nameWithOwner}' repository has disabled issues`);
  const open = store.issues.filter((i) => repoOf(i.url) === flag("repo") && i.state === "OPEN");
  print(open.slice(0, Number(flag("limit") ?? 30)).map(issueJson));
} else if (command === "issue view") {
  const issue = issueAt(args[2]);
  print({ ...issueJson(issue), state: issue.state, comments: issue.comments.map((body) => ({ body, author: { login: "phaedrus" } })) });
} else if (command === "issue close") {
  const issue = issueAt(args[2]);
  const comment = flag("comment");
  if (comment !== undefined) issue.comments.push(comment);
  if (failure?.when === "comment") {
    save();
    failed("HTTP 502: closing failed after the comment");
  }
  issue.state = "CLOSED";
  issue.reason = flag("reason");
  save();
  after();
} else if (command === "trail list") {
  const repo = flag("repo");
  const status = flag("status");
  const repoId = repo === undefined ? undefined : onboarded(repo);
  const listed = store.trails
    .filter((t) => t.project === flag("project") && !t.hidden && (repoId === undefined || t.repoIds.includes(repoId)) && (status === undefined || t.status === status))
    .sort((a, b) => b.number - a.number);
  const size = Math.min(Number(flag("limit") ?? 50), store.pageSize ?? 100);
  const from = Number(flag("page-token") ?? 0);
  const items = listed.slice(from, from + size).map(({ project: _project, hidden: _hidden, changes: _changes, ...trail }) => trail);
  print({ items, nextPageToken: from + size < listed.length ? String(from + size) : null });
} else if (command === "trail show") {
  const trail = store.trails.find((t) => t.project === flag("project") && t.number === Number(args[2]));
  print(trailJson(trail ?? exit(1, `trail ${args[2]} not found`)));
} else if (command === "trail create") {
  if (!args.includes("--no-branch")) exit(2, "fake entire: create without --no-branch publishes a branch");
  const repo = flag("repo") ?? "";
  const project = flag("project") ?? "";
  const repoId = onboarded(repo);
  if (!repo.startsWith(`${project}/`)) exit(1, "--project must match the scoped repository's namespace");
  const key = flag("idempotency-key");
  let trail = key === undefined ? undefined : store.trails.find((t) => t.number === store.keys[key]);
  if (!trail) {
    const number = store.next++;
    trail = {
      id: `TRAIL${String(number).padStart(21, "0")}`, number, project, title: flag("title") ?? "", body: flag("body") ?? "",
      status: "open", type: flag("type") ?? "task", priority: flag("priority") ?? "none", repoIds: [repoId],
      ...(store.hideCreated ? { hidden: true } : {}), ...store.createOverrides,
    };
    store.trails.push(trail);
    if (key !== undefined) store.keys[key] = number;
    save();
  }
  after();
  print(trailJson(trail));
} else {
  exit(2, `fake forge: unexpected ${args.join(" ")}`);
}
