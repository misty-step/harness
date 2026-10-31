import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claimedSource, idempotencyKey, mentions, priorityOf, trailBody, typeOf } from "./migrate-issues.ts";

const CLI = join(import.meta.dir, "migrate-issues.ts");
const FAKE = join(import.meta.dir, "fake-forge.ts");
const SLOW = 60_000;
const ALPHA = "misty-step/alpha";
const DAYBOOK = "moomooskycow/daybook";
// Issue bodies carry this text; it may reach state files and trails, never the console.
const BODY_MARK = "body-text-kept-off-the-console";

type FakeIssue = { url: string; title: string; body: string; labels: string[]; state: "OPEN" | "CLOSED"; comments: string[]; reason?: string; blockedBy?: string[] };
type FakeTrail = {
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
  issues: FakeIssue[];
  onboarded: Record<string, string>;
  trails: FakeTrail[];
  next: number;
  keys: Record<string, number>;
  pageSize?: number;
  hideCreated?: boolean;
  createOverrides?: Partial<FakeTrail>;
  fail?: { match: string; when: "before" | "after" | "comment"; stderr?: string }[];
  calls: string[][];
};
type Outcome = {
  issue: string;
  step?: string;
  status?: string;
  trail: string | null;
  created?: boolean;
  reused?: boolean;
  type?: string | null;
  priority?: string | null;
  mentions?: number[];
  error?: string | null;
  expected_lines?: string[];
  missing_lines?: string[];
  preserved_body?: boolean;
};
type Report = { dry_run?: boolean; counts: Record<string, number>; issues: Outcome[]; open_not_in_snapshot?: string[]; blockers?: { counts: Record<string, number>; issues: Outcome[] } };
type World = { dir: string; store: string; snapshot: string; mapping: string };

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const issueUrl = (repo: string, n: number) => `https://github.com/${repo}/issues/${n}`;
const trailUrl = (n: number) => `https://entire.com/gh/misty-step/-/trails/${n}`;

function issue(repo: string, n: number, over: Partial<FakeIssue> = {}): FakeIssue {
  return { url: issueUrl(repo, n), title: `Issue ${n} in ${repo}`, body: `${BODY_MARK} for ${repo}#${n}\n\n- keep this line`, labels: [], state: "OPEN", comments: [], ...over };
}

function trail(n: number, over: Partial<FakeTrail> = {}): FakeTrail {
  return { id: `SEED${n}`, number: n, project: "gh/misty-step", title: `Existing trail ${n}`, body: "", status: "open", type: "task", priority: "none", repoIds: ["R-alpha"], ...over };
}

// A trail exactly as an earlier migration run would have created it for the issue.
function migrated(n: number, source: FakeIssue, over: Partial<FakeTrail> = {}): FakeTrail {
  return trail(n, { title: source.title, body: trailBody(source), type: typeOf(source.labels) ?? "task", priority: priorityOf(source.labels), ...over });
}

function world(seed: Partial<Store> = {}): World {
  const root = join(homedir(), ".cache", "tmp");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "migrate-issues-test-"));
  scratch.push(dir);
  const store: Store = {
    repos: [{ nameWithOwner: ALPHA }, { nameWithOwner: DAYBOOK }],
    issues: [],
    onboarded: { "gh/misty-step/alpha": "R-alpha", "gh/moomooskycow/daybook": "R-daybook" },
    trails: [],
    next: 100,
    keys: {},
    calls: [],
    ...seed,
  };
  writeFileSync(join(dir, "store.json"), JSON.stringify(store));
  return { dir, store: join(dir, "store.json"), snapshot: join(dir, "run", "snapshot.json"), mapping: join(dir, "run", "mapping.json") };
}

const read = (w: World): Store => JSON.parse(readFileSync(w.store, "utf8"));
const mappingOf = (w: World) => JSON.parse(readFileSync(w.mapping, "utf8")).issues;
const isWrite = (call: string[]) => (call[0] === "trail" && ["create", "update"].includes(call[1])) || (call[0] === "issue" && call[1] === "close");
const isCreate = (call: string[]) => call[0] === "trail" && call[1] === "create";
const named = (call: string[], flag: string) => call.find((arg) => arg.startsWith(`--${flag}=`))?.slice(flag.length + 3);

function change(w: World, edit: (store: Store) => void) {
  const store = read(w);
  edit(store);
  writeFileSync(w.store, JSON.stringify(store));
}

async function cli(w: World, args: string[], files: { snapshot?: string; mapping?: string } = {}) {
  const proc = Bun.spawn(["bun", CLI, "--snapshot", files.snapshot ?? w.snapshot, "--mapping", files.mapping ?? w.mapping, ...args], {
    env: { ...process.env, MIGRATE_ISSUES_GH: FAKE, MIGRATE_ISSUES_ENTIRE: FAKE, MIGRATE_ISSUES_FAKE_STORE: w.store },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const report = out.trim() === "" ? null : (JSON.parse(out) as Report);
  return { code, out, err, report };
}

test("labels state a type or a priority only when they name exactly one", () => {
  const types = [["bug"], ["type:bug"], ["Type: Feature"], ["enhancement"], ["task"], ["type:chore", "initiative"], ["bug", "enhancement"]];
  expect(types.map((labels) => typeOf(labels))).toEqual(["bug", "bug", "feature", "feature", "task", null, null]);
  const priorities = [["priority:p0"], ["p1"], ["P2"], ["priority:P3"], ["priority: high"], ["now", "next", "backlog"], ["p1", "priority:P2"], ["p1", "priority:P1"]];
  expect(priorities.map((labels) => priorityOf(labels))).toEqual(["urgent", "high", "medium", "low", "high", "none", "none", "high"]);
});

test("provenance is the exact first body line; copied text never claims an issue or cites a longer URL", () => {
  const source = issueUrl(ALPHA, 4);
  const copied = `Migrated from GitHub issue: ${issueUrl(ALPHA, 6)}`;
  const body = trailBody({ url: source, body: `See ${issueUrl(ALPHA, 5)}\r\n\r\n${copied}\r\n`, labels: ["b", "a"] });
  expect(body).toBe(`Migrated from GitHub issue: ${source}\n\nGitHub labels: a, b\n\n---\n\nSee ${issueUrl(ALPHA, 5)}\n\n${copied}`);
  expect(claimedSource(body)).toBe(source);
  expect(claimedSource(`Notes\nMigrated from GitHub issue: ${source}`)).toBeNull();
  expect(claimedSource(`Migrated from GitHub issue: ${source} (copy)`)).toBeNull();
  expect(trailBody({ url: source, body: "", labels: [] })).toBe(`Migrated from GitHub issue: ${source}`);
  expect(mentions(`fixes ${issueUrl(ALPHA, 40)}`, source)).toBe(false);
  expect(mentions(`fixes ${source}.`, source)).toBe(true);
});

test("a dry run snapshots each open issue in scope once, plans every trail and writes nothing remote", async () => {
  const w = world({
    repos: [
      { nameWithOwner: ALPHA },
      { nameWithOwner: "misty-step/quiet", hasIssuesEnabled: false },
      { nameWithOwner: "misty-step/attic", isArchived: true },
      { nameWithOwner: DAYBOOK },
    ],
    issues: [
      issue(ALPHA, 2),
      issue(ALPHA, 1, { labels: ["bug", "priority:P1"] }),
      issue(ALPHA, 3, { state: "CLOSED" }),
      issue("misty-step/attic", 1),
      issue(DAYBOOK, 7, { labels: ["p2"] }),
    ],
    trails: [trail(1)],
  });
  const run = await cli(w, ["--all", "--dry-run"]);
  expect(run.code).toBe(0);
  expect(read(w).calls.filter(isWrite)).toEqual([]);
  expect(existsSync(w.mapping)).toBe(false);
  expect(statSync(w.snapshot).mode & 0o777).toBe(0o600);
  expect(statSync(join(w.dir, "run")).mode & 0o777).toBe(0o700);
  const snapshot = JSON.parse(readFileSync(w.snapshot, "utf8"));
  expect(snapshot.issues.map((i: FakeIssue) => i.url)).toEqual([issueUrl(ALPHA, 1), issueUrl(ALPHA, 2), issueUrl(DAYBOOK, 7)]);
  expect(snapshot.issues[0].body).toBe(`${BODY_MARK} for ${ALPHA}#1\n\n- keep this line`);
  expect(run.report?.dry_run).toBe(true);
  expect(run.report?.counts).toMatchObject({ issues_found: 3, trails_created: 0, trails_reused: 0, issues_closed: 0, failures: 0, would_create: 3 });
  expect(run.report?.issues.map((r) => [r.issue, r.step, r.type, r.priority])).toEqual([
    [issueUrl(ALPHA, 1), "would-create", "bug", "high"],
    [issueUrl(ALPHA, 2), "would-create", null, "none"],
    [issueUrl(DAYBOOK, 7), "would-create", null, "medium"],
  ]);
  expect(run.out + run.err).not.toContain(BODY_MARK);
}, SLOW);

test("the snapshot reads past gh's default list size and refuses a listing that may be truncated", async () => {
  const empty = Array.from({ length: 30 }, (_, i) => ({ nameWithOwner: `misty-step/empty-${String(i).padStart(2, "0")}` }));
  const w = world({ repos: [...empty, { nameWithOwner: ALPHA }, { nameWithOwner: DAYBOOK }], issues: Array.from({ length: 31 }, (_, i) => issue(ALPHA, i + 1)), trails: [trail(1)] });
  const run = await cli(w, ["--repo", ALPHA, "--dry-run"]);
  expect(run.code).toBe(0);
  expect(run.report?.counts.issues_found).toBe(31);
  expect(JSON.parse(readFileSync(w.snapshot, "utf8")).repos).toHaveLength(32);

  const full = world({ issues: Array.from({ length: 1000 }, (_, i) => issue(ALPHA, i + 1, { body: "" })) });
  const refused = await cli(full, ["--all", "--dry-run"]);
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("may be truncated");
  expect(existsSync(full.snapshot)).toBe(false);
}, SLOW);

test("the trail search reads every page and status, so an existing claim is reused, not duplicated", async () => {
  const source = issue(ALPHA, 1);
  const w = world({ pageSize: 2, issues: [source], trails: [migrated(1, source, { status: "closed" }), ...[2, 3, 4, 5, 6].map((n) => trail(n))] });
  const run = await cli(w, ["--all", "--dry-run"]);
  expect(run.code).toBe(0);
  expect(run.report?.issues[0]).toMatchObject({ step: "would-close", reused: true, trail: trailUrl(1) });
  const pages = read(w).calls.filter((c) => c[0] === "trail" && c[1] === "list" && named(c, "repo") === undefined);
  expect(pages.map((c) => named(c, "page-token") ?? null)).toEqual([null, "2", "4"]);
  expect(read(w).calls.filter(isWrite)).toEqual([]);
  expect(existsSync(w.mapping)).toBe(false);
}, SLOW);

test("each issue becomes one repo-scoped intent-only trail with its title, body, type and priority, then closes with a link", async () => {
  const issues = [
    issue(ALPHA, 1, { labels: ["bug", "priority:P1"], body: `${BODY_MARK} one\r\n\r\n- [ ] keep\r\n` }),
    issue(ALPHA, 2, { labels: ["enhancement", "p3", "needs-discussion"] }),
    issue(ALPHA, 3),
    issue(ALPHA, 4, { labels: ["bug", "type:feature", "p1", "priority:P2"] }),
  ];
  const w = world({ issues, trails: [trail(1)] });
  const run = await cli(w, ["--all"]);
  expect(run.code).toBe(0);
  expect(run.report?.counts).toMatchObject({ issues_found: 4, trails_created: 4, trails_reused: 0, issues_closed: 4, failures: 0 });
  const store = read(w);
  const creates = store.calls.filter(isCreate);
  expect(creates.every((c) => c.includes("--no-branch"))).toBe(true);
  expect(creates.map((c) => [named(c, "repo"), named(c, "project"), named(c, "title"), named(c, "type"), named(c, "priority"), named(c, "idempotency-key")])).toEqual([
    ["gh/misty-step/alpha", "gh/misty-step", issues[0].title, "bug", "high", idempotencyKey(issues[0].url)],
    ["gh/misty-step/alpha", "gh/misty-step", issues[1].title, "feature", "low", idempotencyKey(issues[1].url)],
    ["gh/misty-step/alpha", "gh/misty-step", issues[2].title, undefined, "none", idempotencyKey(issues[2].url)],
    ["gh/misty-step/alpha", "gh/misty-step", issues[3].title, undefined, "none", idempotencyKey(issues[3].url)],
  ]);
  expect(named(creates[0], "body")).toBe(`Migrated from GitHub issue: ${issues[0].url}\n\nGitHub labels: bug, priority:P1\n\n---\n\n${BODY_MARK} one\n\n- [ ] keep`);
  expect(named(creates[2], "body")).toBe(`Migrated from GitHub issue: ${issues[2].url}\n\n---\n\n${issues[2].body}`);
  const mapping = mappingOf(w);
  for (const closed of store.issues) {
    const created = store.trails.find((t) => claimedSource(t.body) === closed.url);
    expect(created).toMatchObject({ project: "gh/misty-step", repoIds: ["R-alpha"] });
    expect(closed).toMatchObject({ state: "CLOSED", reason: "not planned" });
    expect(closed.comments).toHaveLength(1);
    expect(closed.comments[0].split("\n")[0]).toBe(`Migrated to Entire trail: ${trailUrl(created?.number ?? 0)}`);
    expect(mapping[closed.url]).toMatchObject({ source: closed.url, origin: "created", trail: { number: created?.number, url: trailUrl(created?.number ?? 0) } });
    expect(typeof mapping[closed.url].closed_at).toBe("string");
  }
  expect(statSync(w.mapping).mode & 0o777).toBe(0o600);
  expect(run.out + run.err).not.toContain(BODY_MARK);
}, SLOW);

test("an issue stays open when its trail does not keep the issue's intent, ticket shape or repository scope", async () => {
  const source = issue(ALPHA, 1, { labels: ["bug", "p1"] });
  const variants: [Partial<FakeTrail>, string][] = [
    [{ body: `Migrated from GitHub issue: ${source.url}` }, "its body does not contain the issue body"],
    [{ body: `Context first\n\n${trailBody(source)}` }, "its first body line is not this issue's provenance line"],
    [{ title: "Retitled" }, "its title differs from the issue title"],
    [{ type: "feature" }, "its type is feature, expected bug"],
    [{ priority: "low" }, "its priority is low, expected high"],
    [{ changes: [{ id: "C1", repository: "alpha", number: 3 }] }, "it has 1 change(s), so it is not intent-only"],
    [{ repoIds: ["R-daybook"] }, "it is scoped to [R-daybook], not only gh/misty-step/alpha (R-alpha)"],
  ];
  for (const [override, problem] of variants) {
    const w = world({ issues: [source], trails: [trail(1)], createOverrides: override });
    const run = await cli(w, ["--all"]);
    expect(run.code).toBe(2);
    expect(run.report?.counts).toMatchObject({ trails_created: 1, issues_closed: 0, failures: 1 });
    expect(run.report?.issues[0].error).toContain(problem);
    expect(read(w).issues[0].state).toBe("OPEN");
    expect(read(w).calls.some((c) => c[0] === "issue" && c[1] === "close")).toBe(false);
    expect(mappingOf(w)[source.url]).toMatchObject({ origin: "created", trail: { number: 100 }, closed_at: null });
  }
}, SLOW);

test("a rerun resumes from the mapping written at creation: same trail, one link comment, then a quiet skip", async () => {
  const source = issue(ALPHA, 1);
  const unshown = world({ issues: [source], trails: [trail(1)], fail: [{ match: "^trail show", when: "before" }] });
  expect((await cli(unshown, ["--all"])).code).toBe(2);
  expect(mappingOf(unshown)[source.url]).toMatchObject({ origin: "created", trail: { number: 100 }, closed_at: null });
  expect(read(unshown).calls.some((c) => c[0] === "issue" && c[1] === "close")).toBe(false);

  const w = world({ issues: [source], trails: [trail(1)], fail: [{ match: "^issue close", when: "comment" }] });
  const first = await cli(w, ["--all"]);
  expect(first.code).toBe(2);
  expect(mappingOf(w)[source.url]).toMatchObject({ source: source.url, origin: "created", trail: { number: 100 }, closed_at: null });
  expect(read(w).issues[0]).toMatchObject({ state: "OPEN" });
  expect(read(w).issues[0].comments).toHaveLength(1);

  change(w, (store) => {
    store.fail = [];
  });
  const before = read(w).calls.length;
  const second = await cli(w, ["--all"]);
  expect(second.code).toBe(0);
  expect(second.report?.counts).toMatchObject({ trails_created: 0, trails_reused: 1, issues_closed: 1, failures: 0 });
  const store = read(w);
  expect(store.trails.filter((t) => claimedSource(t.body) === source.url)).toHaveLength(1);
  expect(store.issues[0].state).toBe("CLOSED");
  expect(store.issues[0].comments).toHaveLength(1);
  const close = store.calls.slice(before).find((c) => c[0] === "issue" && c[1] === "close");
  expect(close).toBeDefined();
  expect(named(close ?? [], "comment")).toBeUndefined();

  const quiet = store.calls.length;
  const third = await cli(w, ["--all"]);
  expect(third.code).toBe(0);
  expect(third.report?.counts).toMatchObject({ already_migrated: 1, issues_closed: 0, trails_created: 0 });
  expect(read(w).calls.slice(quiet)).toEqual([]);

  // A crash after the close but before its mapping write: the rerun sees the link and records it.
  const saved = JSON.parse(readFileSync(w.mapping, "utf8"));
  saved.issues[source.url].closed_at = null;
  writeFileSync(w.mapping, JSON.stringify(saved));
  const crashed = read(w).calls.length;
  const observed = await cli(w, ["--all"]);
  expect(observed.code).toBe(0);
  expect(observed.report?.issues[0]).toMatchObject({ step: "already-migrated", trail: trailUrl(100) });
  expect(read(w).calls.slice(crashed).filter(isWrite)).toEqual([]);
  expect(typeof mappingOf(w)[source.url].closed_at).toBe("string");
}, SLOW);

test("a recorded trail that no longer claims its issue fails closed instead of creating another", async () => {
  const source = issue(ALPHA, 1);
  const w = world({ issues: [source], trails: [trail(1)], fail: [{ match: "^issue close", when: "before" }] });
  expect((await cli(w, ["--all"])).code).toBe(2);
  change(w, (store) => {
    store.fail = [];
    for (const t of store.trails) if (t.number === 100) t.body = "Rewritten by hand";
  });
  const run = await cli(w, ["--all"]);
  expect(run.code).toBe(2);
  expect(run.report?.issues[0].error).toContain("the mapping records trail #100, but no trail claims this issue");
  expect(read(w).trails).toHaveLength(2);
  expect(read(w).issues[0].state).toBe("OPEN");
}, SLOW);

test("a create whose response was lost is found by provenance, or replayed by its idempotency key while lists lag", async () => {
  const source = issue(ALPHA, 1);
  const found = world({ issues: [source], trails: [trail(1)], fail: [{ match: "^trail create", when: "after" }] });
  const lost = await cli(found, ["--all"]);
  expect(lost.code).toBe(2);
  expect(lost.report?.issues[0].error).toContain("entire trail create --no-branch");
  expect(mappingOf(found)[source.url].trail).toBeNull();
  change(found, (store) => {
    store.fail = [];
  });
  const resumed = await cli(found, ["--all"]);
  expect(resumed.code).toBe(0);
  expect(resumed.report?.counts).toMatchObject({ trails_created: 0, trails_reused: 1, issues_closed: 1 });
  expect(read(found).trails).toHaveLength(2);

  const lagging = world({ issues: [source], trails: [trail(1)], hideCreated: true, fail: [{ match: "^trail create", when: "after" }] });
  expect((await cli(lagging, ["--all"])).code).toBe(2);
  change(lagging, (store) => {
    store.fail = [];
  });
  const replayed = await cli(lagging, ["--all"]);
  expect(replayed.code).toBe(0);
  expect(replayed.report?.counts).toMatchObject({ trails_created: 1, issues_closed: 1 });
  const store = read(lagging);
  expect(store.trails).toHaveLength(2);
  expect(store.calls.filter(isCreate).map((c) => named(c, "idempotency-key"))).toEqual([idempotencyKey(source.url), idempotencyKey(source.url)]);
}, SLOW);

test("only the first-line provenance claims an issue: mentions are ignored, and duplicate or changed claims fail closed", async () => {
  const one = issue(ALPHA, 1);
  const two = issue(ALPHA, 2);
  const three = issue(ALPHA, 3, { body: `${BODY_MARK} three\n\nBlocked by: ${one.url}` });
  const four = issue(ALPHA, 4);
  const w = world({
    issues: [one, two, three, four],
    trails: [
      trail(1, { title: "fix(alpha): repair", body: `Closes ${one.url}`, changes: [{ id: "C1" }] }),
      migrated(2, three),
      migrated(3, two),
      migrated(4, two, { title: "Copy of issue 2" }),
      trail(5, { body: trailBody({ url: issueUrl(ALPHA, 10), body: "", labels: [] }) }),
      migrated(6, four, { changes: [{ id: "C2" }] }),
    ],
  });
  const run = await cli(w, ["--all"]);
  expect(run.code).toBe(2);
  const outcome = Object.fromEntries((run.report?.issues ?? []).map((r) => [r.issue, r]));
  expect(outcome[one.url]).toMatchObject({ step: "closed", created: true, mentions: [1, 2] });
  expect(outcome[two.url]).toMatchObject({ step: "failed", created: false });
  expect(outcome[two.url].error).toContain("trails #3, #4 each claim this issue");
  expect(outcome[three.url]).toMatchObject({ step: "closed", reused: true, trail: trailUrl(2) });
  expect(outcome[four.url]).toMatchObject({ step: "failed", reused: true });
  expect(outcome[four.url].error).toContain("it has 1 change(s), so it is not intent-only");
  expect(run.report?.counts).toMatchObject({ trails_created: 1, trails_reused: 2, issues_closed: 2, failures: 2 });
  const store = read(w);
  expect(store.calls.filter(isCreate).map((c) => named(c, "title"))).toEqual([one.title]);
  expect(store.issues.map((i) => i.state)).toEqual(["CLOSED", "OPEN", "CLOSED", "OPEN"]);
}, SLOW);

test("a failed command stops only its issue, and its error names the command without issue text or credentials", async () => {
  const token = ["gh", "p_", "A".repeat(36)].join("");
  const w = world({
    issues: [issue(ALPHA, 1, { body: `${BODY_MARK} plan` }), issue(ALPHA, 2)],
    trails: [trail(1)],
    fail: [{ match: "^trail create .*--title=Issue 1 in", when: "before", stderr: `HTTP 403: denied for ${token}` }],
  });
  const run = await cli(w, ["--all"]);
  expect(run.code).toBe(2);
  expect(run.report?.counts).toMatchObject({ issues_found: 2, trails_created: 1, issues_closed: 1, failures: 1 });
  const error = run.report?.issues[0].error ?? "";
  expect(error).toContain("entire trail create --no-branch --repo=gh/misty-step/alpha --project=gh/misty-step");
  expect(error).toMatch(/--title=<\d+ chars> --body=<\d+ chars>/);
  expect(error).toContain("exited 1: HTTP 403: denied for <redacted>");
  expect(run.err).toContain(error);
  for (const hidden of [BODY_MARK, token, "Issue 1 in"]) expect(run.out + run.err).not.toContain(hidden);
  expect(read(w).issues.map((i) => i.state)).toEqual(["OPEN", "CLOSED"]);
}, SLOW);

test("a repository Entire has not onboarded fails its issues before any write, and the dry-run plan says so", async () => {
  const w = world({
    repos: [{ nameWithOwner: ALPHA }, { nameWithOwner: "misty-step/offline" }, { nameWithOwner: DAYBOOK }],
    issues: [issue("misty-step/offline", 1), issue(ALPHA, 1)],
    trails: [trail(1)],
  });
  const plan = await cli(w, ["--all", "--dry-run"]);
  expect(plan.code).toBe(2);
  expect(plan.report?.issues.map((r) => [r.issue, r.step])).toEqual([[issueUrl(ALPHA, 1), "would-create"], [issueUrl("misty-step/offline", 1), "failed"]]);
  expect(plan.report?.issues[1].error).toContain("repo is not onboarded to Entire");
  const run = await cli(w, ["--all"]);
  expect(run.code).toBe(2);
  expect(read(w).calls.filter((c) => isCreate(c) && named(c, "repo") === "gh/misty-step/offline")).toEqual([]);
  expect(read(w).issues.map((i) => i.state)).toEqual(["OPEN", "CLOSED"]);
}, SLOW);

test("--limit and --max-failures bound a long run and leave untouched issues for the next run", async () => {
  const w = world({ issues: [1, 2, 3].map((n) => issue(ALPHA, n)), trails: [trail(1)] });
  const limited = await cli(w, ["--all", "--limit", "1"]);
  expect(limited.code).toBe(0);
  expect(limited.report?.counts).toMatchObject({ issues_found: 3, issues_closed: 1, not_started: 2 });
  change(w, (store) => {
    store.fail = [{ match: "^trail create", when: "before" }];
  });
  const before = read(w).calls.length;
  const bounded = await cli(w, ["--all", "--max-failures", "1"]);
  expect(bounded.code).toBe(2);
  expect(bounded.report?.counts).toMatchObject({ already_migrated: 1, failures: 1, not_started: 1 });
  expect(read(w).calls.slice(before).filter(isCreate)).toHaveLength(1);
}, SLOW);

test("--verify is read-only and accounts for every snapshot issue, including one closed elsewhere", async () => {
  const w = world({ issues: [issue(ALPHA, 1, { labels: ["bug"] }), issue(ALPHA, 2), issue(DAYBOOK, 3, { labels: ["P2"] })], trails: [trail(1)] });
  expect((await cli(w, ["--all", "--dry-run"])).code).toBe(0);
  change(w, (store) => {
    store.issues[1].state = "CLOSED";
  });
  const run = await cli(w, ["--all"]);
  expect(run.code).toBe(0);
  expect(run.report?.counts).toMatchObject({ issues_found: 3, trails_created: 2, issues_closed: 2, closed_elsewhere: 1 });
  expect(read(w).trails.find((t) => t.project === "gh/moomooskycow")).toMatchObject({ repoIds: ["R-daybook"], priority: "medium" });

  const before = read(w).calls.length;
  const verified = await cli(w, ["--all", "--verify"]);
  expect(verified.code).toBe(0);
  expect(verified.report?.counts).toMatchObject({
    issues_found: 3, migrated: 2, closed_elsewhere: 1, trails_found: 2, issues_open: 0, mismatches: 0,
    duplicate_claims: 0, open_not_in_snapshot: 0, claims_outside_snapshot: 0,
  });
  expect(read(w).calls.slice(before).filter(isWrite)).toEqual([]);

  change(w, (store) => {
    store.issues[0].state = "OPEN";
    store.issues.push(issue(ALPHA, 9));
  });
  const gaps = await cli(w, ["--all", "--verify"]);
  expect(gaps.code).toBe(2);
  expect(gaps.report?.counts).toMatchObject({ issues_found: 3, migrated: 1, issues_open: 1, open_not_in_snapshot: 1 });
  expect(gaps.report?.open_not_in_snapshot).toEqual([issueUrl(ALPHA, 9)]);
}, SLOW);

test("state files stay in a private run directory under ~/.cache/tmp, the snapshot stays fixed and a mapping stays with it", async () => {
  const w = world({ issues: [issue(ALPHA, 1)], trails: [trail(1)] });
  const outside = join("/tmp", `migrate-issues-${process.pid}`, "snapshot.json");
  const refused = await cli(w, ["--all", "--dry-run"], { snapshot: outside });
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("must be a file in a run directory under");
  expect(existsSync(outside)).toBe(false);
  expect(read(w).calls).toEqual([]);

  expect((await cli(w, ["--all"])).code).toBe(0);
  change(w, (store) => {
    store.issues.push(issue(ALPHA, 2));
  });
  const again = await cli(w, ["--all"]);
  expect(again.report?.counts).toMatchObject({ issues_found: 1, already_migrated: 1 });
  const mixed = await cli(w, ["--all", "--dry-run"], { snapshot: join(w.dir, "other", "snapshot.json") });
  expect(mixed.code).toBe(1);
  expect(mixed.err).toContain("belongs to another snapshot");
}, SLOW);

test("native blockedBy pages become mapped trail lines after later blocker issues are migrated", async () => {
  const source = issue(ALPHA, 1, { body: `${BODY_MARK}\n\nKeep #44 verbatim.`, blockedBy: [issueUrl(ALPHA, 2), issueUrl(ALPHA, 3), issueUrl(ALPHA, 99)] });
  const w = world({ issues: [source, issue(ALPHA, 2), issue(ALPHA, 3)], trails: [trail(1)] });
  const run = await cli(w, ["--all"]);
  expect(run.code, run.err).toBe(0);
  expect(run.report?.blockers?.counts).toMatchObject({ trails_checked: 3, expected_lines: 2, trails_updated: 1, lines_added: 2, missing_lines: 0, failures: 0 });
  const store = read(w);
  const moved = store.trails.find((t) => claimedSource(t.body) === source.url)!;
  expect(moved.body).toBe(`${trailBody(source)}\n\nBlocked by: ${trailUrl(101)}\nBlocked by: ${trailUrl(102)}`);
  expect(moved.body).not.toContain("Blocked by: https://github.com/");
  const pages = store.calls.filter((c) => c[0] === "api" && c[1] === "graphql" && c.includes("number=1"));
  expect(pages.map((c) => c.find((arg) => arg.startsWith("cursor=")) ?? null)).toEqual([null, "cursor=2"]);
}, SLOW);

test("the corrective blocker pass is dry-run first, append-only, idempotent and independently verifiable", async () => {
  const source = issue(ALPHA, 1);
  const w = world({ issues: [source, issue(ALPHA, 2)], trails: [trail(1)] });
  expect((await cli(w, ["--all"])).code).toBe(0);
  const original = `${trailBody(source).replaceAll("\n", "\r\n")}\r\n\r\n## Operator acceptance\r\nKeep #44 and these spaces. \t`;
  change(w, (store) => {
    store.issues[0].blockedBy = [issueUrl(ALPHA, 2)];
    store.trails.find((t) => t.number === 100)!.body = original;
  });
  const snapshot = readFileSync(w.snapshot, "utf8");
  const mapping = readFileSync(w.mapping, "utf8");
  let before = read(w).calls.length;
  const plan = await cli(w, ["--all", "--sync-blockers", "--dry-run"]);
  expect(plan.code, plan.err).toBe(0);
  expect(plan.report?.counts).toMatchObject({ trails_checked: 2, trails_needing_update: 1, missing_lines: 1, trails_updated: 0, lines_added: 0 });
  expect(read(w).calls.slice(before).filter(isWrite)).toEqual([]);
  expect(read(w).trails.find((t) => t.number === 100)!.body).toBe(original);
  const missing = await cli(w, ["--all", "--sync-blockers", "--verify"]);
  expect(missing.code).toBe(2);
  expect(missing.report?.counts.missing_lines).toBe(1);
  const ordinaryVerify = await cli(w, ["--all", "--verify"]);
  expect(ordinaryVerify.code).toBe(2);
  expect(ordinaryVerify.report?.blockers?.counts.missing_lines).toBe(1);

  const live = await cli(w, ["--all", "--sync-blockers"]);
  expect(live.code, live.err).toBe(0);
  expect(live.report?.counts).toMatchObject({ trails_checked: 2, trails_updated: 1, lines_added: 1, missing_lines: 0, failures: 0 });
  expect(live.report?.issues.find((r) => r.issue === source.url)?.preserved_body).toBe(true);
  expect(read(w).trails.find((t) => t.number === 100)!.body).toBe(`${original}\n\nBlocked by: ${trailUrl(101)}`);
  before = read(w).calls.length;
  const rerun = await cli(w, ["--all", "--sync-blockers"]);
  expect(rerun.code).toBe(0);
  expect(rerun.report?.counts).toMatchObject({ trails_updated: 0, lines_added: 0, missing_lines: 0 });
  const verified = await cli(w, ["--all", "--sync-blockers", "--verify"]);
  expect(verified.code).toBe(0);
  expect(verified.report?.counts).toMatchObject({ expected_lines: 1, missing_lines: 0, failures: 0 });
  expect(read(w).calls.slice(before).filter(isWrite)).toEqual([]);
  expect(readFileSync(w.snapshot, "utf8")).toBe(snapshot);
  expect(readFileSync(w.mapping, "utf8")).toBe(mapping);
}, SLOW);

test("a native blocker read failure cannot masquerade as an empty dependency graph", async () => {
  const w = world({ issues: [issue(ALPHA, 1)], trails: [trail(1)] });
  expect((await cli(w, ["--all"])).code).toBe(0);
  change(w, (store) => {
    store.fail = [{ match: "^api graphql", when: "before", stderr: "HTTP 503: unavailable" }];
  });
  const before = read(w).calls.length;
  const run = await cli(w, ["--all", "--sync-blockers"]);
  expect(run.code).toBe(2);
  expect(run.report?.counts).toMatchObject({ failures: 1, trails_updated: 0, lines_added: 0 });
  expect(run.report?.issues[0].error).toContain("gh api graphql");
  expect(read(w).calls.slice(before).filter(isWrite)).toEqual([]);
}, SLOW);
