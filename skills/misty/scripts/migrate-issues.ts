#!/usr/bin/env bun
// migrate-issues: move every open GitHub issue in scope to its own intent-only Entire trail.
//
// The snapshot file fixes the issue set on first use, so counts always compare against the
// initial issues, even after they close. The mapping file records an issue's trail as soon as
// it exists; a rerun resumes from it, and the provenance search finds a trail the mapping
// missed. A trail belongs to an issue only when its first body line is that issue's provenance
// line; any other occurrence of the URL is a mention and is never reused. An issue closes only
// after `entire trail show` proves its repository-scoped, intent-only trail keeps the title,
// body, type and priority. One writer, one mutation at a time; titles and bodies never reach
// the console.

import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const OWNER = "misty-step";
const EXTRA_REPOS = ["moomooskycow/daybook"];
const PROVENANCE = "Migrated from GitHub issue: ";
const LINK = "Migrated to Entire trail: ";
const CLOSE_REASON = "not planned";
// Entire applies this type when create omits --type (ProjectTrailCreateBody's default).
const DEFAULT_TYPE = "task";
const GH_LIMIT = 1000;
const PAGE_SIZE = 100;
const SNAPSHOT_SCHEMA = "migrate-issues.snapshot.v1";
const MAPPING_SCHEMA = "migrate-issues.mapping.v1";
const REPORT_SCHEMA = "migrate-issues.report.v1";
const ISSUE_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/;

type Issue = { url: string; repo: string; number: number; title: string; body: string; labels: string[] };
type Live = Issue & { state: string; comments: string[] };
type Trail = {
  id: string;
  number: number;
  url: string | null;
  title: string;
  body: string;
  type: string;
  priority: string;
  repoIds: string[] | null;
  changes: unknown[];
};
type Snapshot = { taken_at: string; repos: { repo: string; issues_enabled: boolean; open_issues: number }[]; issues: Issue[] };
type TrailRef = { number: number; id: string; url: string | null };
type Entry = {
  source: string;
  trail: TrailRef | null;
  origin: "created" | "reused" | null;
  closed_at: string | null;
  closed_without_trail: boolean;
  last_error: string | null;
  updated_at: string;
};
type Mapping = { schema: string; snapshot_sha256: string; issues: Record<string, Entry> };
type Json = Record<string, unknown>;

// Refused: this issue or run must not proceed. CliError: a gh or entire command failed.
// StateError: a local state file could not be written, so no further mutation may run.
class Refused extends Error {}
class CliError extends Error {}
class StateError extends Error {}
class UsageError extends Error {}

function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Refused(message);
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function items(value: unknown, what: string): unknown[] {
  need(Array.isArray(value), `${what} is not a list`);
  return value;
}

// ---- issue to trail: pure rules ----

// Labels state a type or a priority only when they name exactly one; otherwise none is set.
export function typeOf(labels: string[]): string | null {
  const found = new Set<string>();
  for (const label of labels) {
    const match = /^(?:type\s*[:/]\s*)?(bug|feature|enhancement|task)$/i.exec(label.trim());
    if (match) found.add(match[1].toLowerCase() === "enhancement" ? "feature" : match[1].toLowerCase());
  }
  return found.size === 1 ? [...found][0] : null;
}

const PRIORITIES = ["urgent", "high", "medium", "low"];

export function priorityOf(labels: string[]): string {
  const found = new Set<string>();
  for (const label of labels) {
    const text = label.trim().toLowerCase();
    const level = /^(?:priority\s*[:/]\s*)?p([0-3])$/.exec(text);
    const word = /^priority\s*[:/]\s*(urgent|high|medium|low)$/.exec(text);
    if (level) found.add(PRIORITIES[Number(level[1])]);
    else if (word) found.add(word[1]);
  }
  return found.size === 1 ? [...found][0] : "none";
}

// Line endings and trailing blank space are not intent; everything else stays verbatim.
function intent(text: string): string {
  return text.replace(/\r\n?/g, "\n").trimEnd();
}

// Deterministic, so a rerun sends the identical request under the same idempotency key.
export function trailBody(issue: { url: string; body: string; labels: string[] }): string {
  const parts = [PROVENANCE + issue.url];
  if (issue.labels.length > 0) parts.push(`GitHub labels: ${[...issue.labels].sort().join(", ")}`);
  const body = intent(issue.body);
  if (body !== "") parts.push("---", body);
  return parts.join("\n\n");
}

// The issue a trail claims: an exact provenance line, and only as the body's first line.
export function claimedSource(body: string): string | null {
  const first = body.replace(/\r\n?/g, "\n").split("\n", 1)[0];
  if (!first.startsWith(PROVENANCE)) return null;
  const source = first.slice(PROVENANCE.length);
  return ISSUE_URL.test(source) ? source : null;
}

// Whether text cites this exact issue URL (…/issues/1 is not cited by …/issues/10).
export function mentions(text: string, url: string): boolean {
  for (let at = text.indexOf(url); at !== -1; at = text.indexOf(url, at + 1)) {
    if (!/\d/.test(text.charAt(at + url.length))) return true;
  }
  return false;
}

function linkComment(trailUrl: string): string {
  return `${LINK}${trailUrl}\n\nThis issue's title and body now live on that intent-only trail; continue the work there.`;
}

// Trail URLs the issue's comments already link with the migration comment.
function linkedTrails(comments: string[]): string[] {
  const links = comments
    .map((comment) => comment.replace(/\r\n?/g, "\n").split("\n", 1)[0])
    .filter((line) => line.startsWith(LINK))
    .map((line) => line.slice(LINK.length).trim());
  return [...new Set(links)];
}

export function idempotencyKey(url: string): string {
  return `github-issue-${createHash("sha256").update(url).digest("hex").slice(0, 40)}`;
}

const projectOf = (repo: string) => `gh/${repo.split("/")[0]}`;
const scopeOf = (repo: string) => `gh/${repo}`;

// Everything that must hold before the issue may close; an empty list means the trail keeps it.
function trailProblems(trail: Trail, issue: Issue, scopeId: string | null): string[] {
  const problems: string[] = [];
  if (claimedSource(trail.body) !== issue.url) problems.push("its first body line is not this issue's provenance line");
  if (trail.changes.length > 0) problems.push(`it has ${trail.changes.length} change(s), so it is not intent-only`);
  const ids = trail.repoIds ?? [];
  if (scopeId === null) problems.push(`no trail is listed under ${scopeOf(issue.repo)}, so its repository scope is unproven`);
  else if (ids.length !== 1 || ids[0] !== scopeId) problems.push(`it is scoped to [${ids.join(", ")}], not only ${scopeOf(issue.repo)} (${scopeId})`);
  if (trail.title.trim() !== issue.title.trim()) problems.push("its title differs from the issue title");
  if (!intent(trail.body).includes(intent(issue.body))) problems.push("its body does not contain the issue body");
  const type = typeOf(issue.labels) ?? DEFAULT_TYPE;
  if (trail.type !== type) problems.push(`its type is ${trail.type}, expected ${type}`);
  const priority = priorityOf(issue.labels);
  if (trail.priority !== priority) problems.push(`its priority is ${trail.priority}, expected ${priority}`);
  if (trail.url === null || !trail.url.startsWith("https://")) problems.push("entire printed no trail URL to link");
  return problems;
}

// ---- native boundary: gh and entire, one command at a time, no retries ----

type Run = (args: string[]) => Promise<string>;

const HIDDEN: Record<string, true> = { "--title": true, "--body": true, "--comment": true };
const REDACT = /\b(?:gh[opsur]_[A-Za-z0-9]{20,}|github_pat_\w{20,})|\bBearer\s+\S+/g;

// The command as reported: titles, bodies and comments are replaced by their length.
function shown(tool: string, args: string[]): string {
  const words = args.map((arg) => {
    const eq = arg.indexOf("=");
    if (eq > 0 && HIDDEN[arg.slice(0, eq)]) return `${arg.slice(0, eq)}=<${arg.length - eq - 1} chars>`;
    return /[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg;
  });
  return [tool, ...words].join(" ");
}

function spawn(bin: string, args: string[], command: string) {
  try {
    return Bun.spawn([bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (err) {
    throw new CliError(`${command} could not start: ${(err as Error).message}`);
  }
}

// A failure reports its command, exit code and stderr, never its stdout.
function runner(tool: string, bin: string, timeoutMs: number): Run {
  return async (args) => {
    const command = shown(tool, args);
    const proc = spawn(bin, args, command);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill(9);
    }, timeoutMs);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (timedOut) throw new CliError(`${command} timed out after ${timeoutMs / 1000}s; its outcome is unknown`);
    if (code !== 0) {
      const detail = err.replace(REDACT, "<redacted>").trim();
      throw new CliError(`${command} exited ${code}: ${detail.length > 1000 ? `${detail.slice(0, 1000)}...` : detail || "no stderr"}`);
    }
    return out;
  };
}

function parse(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(`${what} printed no JSON`);
  }
}

function toIssue(repo: string, raw: unknown): Issue {
  need(isRecord(raw) && typeof raw.url === "string" && ISSUE_URL.test(raw.url) && typeof raw.number === "number", `gh printed an issue in ${repo} without its canonical URL`);
  const labels = (Array.isArray(raw.labels) ? raw.labels : [])
    .map((label: unknown) => (isRecord(label) && typeof label.name === "string" ? label.name : ""))
    .filter((name) => name !== "");
  return {
    url: raw.url, repo, number: raw.number, labels: labels.sort(),
    title: typeof raw.title === "string" ? raw.title : "", body: typeof raw.body === "string" ? raw.body : "",
  };
}

function toTrail(raw: unknown, what: string): Trail {
  need(isRecord(raw) && typeof raw.id === "string" && typeof raw.number === "number", `${what} printed a trail without an id and number`);
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    id: raw.id, number: raw.number, url: typeof raw.url === "string" ? raw.url : null,
    title: text(raw.title), body: text(raw.body), type: text(raw.type), priority: text(raw.priority),
    repoIds: Array.isArray(raw.repoIds) ? raw.repoIds.map(String) : null,
    changes: Array.isArray(raw.changes) ? raw.changes : [],
  };
}

async function scopeRepos(gh: Run): Promise<{ repo: string; issues_enabled: boolean }[]> {
  const owned = items(parse(await gh(["repo", "list", OWNER, "--no-archived", `--limit=${GH_LIMIT}`, "--json", "nameWithOwner,hasIssuesEnabled"]), "gh repo list"), "gh repo list");
  need(owned.length < GH_LIMIT, `gh repo list ${OWNER} returned ${owned.length} repositories, its limit; the listing may be truncated`);
  const repos = new Map<string, boolean>();
  for (const raw of owned) {
    need(isRecord(raw) && typeof raw.nameWithOwner === "string", "gh repo list printed a repository without its name");
    repos.set(raw.nameWithOwner, raw.hasIssuesEnabled !== false);
  }
  for (const name of EXTRA_REPOS) {
    const extra = parse(await gh(["repo", "view", name, "--json", "nameWithOwner,hasIssuesEnabled,isArchived"]), "gh repo view");
    need(isRecord(extra) && typeof extra.nameWithOwner === "string", `gh repo view ${name} printed no repository`);
    if (extra.isArchived !== true) repos.set(extra.nameWithOwner, extra.hasIssuesEnabled !== false);
  }
  return [...repos.keys()].sort().map((repo) => ({ repo, issues_enabled: repos.get(repo) === true }));
}

async function openIssues(gh: Run, repo: string): Promise<Issue[]> {
  const listed = items(parse(await gh(["issue", "list", `--repo=${repo}`, "--state=open", `--limit=${GH_LIMIT}`, "--json", "url,number,title,body,labels"]), "gh issue list"), "gh issue list");
  need(listed.length < GH_LIMIT, `gh issue list for ${repo} returned ${listed.length} issues, its limit; the listing may be truncated`);
  return listed.map((raw) => toIssue(repo, raw)).sort((a, b) => a.number - b.number);
}

async function viewIssue(gh: Run, issue: Issue): Promise<Live> {
  const raw = parse(await gh(["issue", "view", issue.url, "--json", "url,number,title,body,labels,state,comments"]), "gh issue view");
  need(isRecord(raw), "gh issue view printed no issue");
  const live = toIssue(issue.repo, raw);
  need(live.url === issue.url, `GitHub now reports this issue at ${live.url}`);
  const comments = (Array.isArray(raw.comments) ? raw.comments : [])
    .map((comment: unknown) => (isRecord(comment) && typeof comment.body === "string" ? comment.body : ""));
  return { ...live, state: typeof raw.state === "string" ? raw.state : "", comments };
}

async function closeIssue(gh: Run, url: string, comment: string | null): Promise<void> {
  await gh(["issue", "close", url, `--reason=${CLOSE_REASON}`, ...(comment === null ? [] : [`--comment=${comment}`])]);
}

// Every page and every status: omitting --status lists all lifecycle states.
async function listTrails(entire: Run, project: string, repo?: string): Promise<Trail[]> {
  const trails = new Map<string, Trail>();
  const tokens = new Set<string>();
  let token: string | null = null;
  do {
    const args = ["trail", "list", `--project=${project}`, ...(repo ? [`--repo=${repo}`] : []), "--json", `--limit=${PAGE_SIZE}`];
    if (token !== null) args.push(`--page-token=${token}`);
    const page = parse(await entire(args), "entire trail list");
    need(isRecord(page), "entire trail list printed no page");
    for (const raw of items(page.items, "entire trail list items")) {
      const trail = toTrail(raw, "entire trail list");
      trails.set(trail.id, trail);
    }
    token = typeof page.nextPageToken === "string" && page.nextPageToken !== "" ? page.nextPageToken : null;
    need(token === null || !tokens.has(token), "entire trail list repeated a page token");
    if (token !== null) tokens.add(token);
  } while (token !== null);
  return [...trails.values()];
}

async function showTrail(entire: Run, project: string, number: number): Promise<Trail> {
  const trail = toTrail(parse(await entire(["trail", "show", String(number), `--project=${project}`, "--json"]), "entire trail show"), "entire trail show");
  need(trail.number === number, `entire trail show ${number} printed trail ${trail.number}`);
  return trail;
}

async function createTrail(entire: Run, issue: Issue, live: Live): Promise<Trail> {
  const type = typeOf(live.labels);
  const out = await entire([
    "trail", "create", "--no-branch", `--repo=${scopeOf(issue.repo)}`, `--project=${projectOf(issue.repo)}`,
    `--title=${live.title}`, `--body=${trailBody(live)}`, ...(type === null ? [] : [`--type=${type}`]),
    `--priority=${priorityOf(live.labels)}`, `--idempotency-key=${idempotencyKey(issue.url)}`, "--json",
  ]);
  return toTrail(parse(out, "entire trail create"), "entire trail create");
}

// The repository's Entire ID: the one ID shared by every trail Entire lists under it.
async function repoScope(entire: Run, repo: string): Promise<string | null> {
  let shared: string[] | null = null;
  for (const trail of await listTrails(entire, projectOf(repo), scopeOf(repo))) {
    const ids = trail.repoIds ?? [];
    shared = shared === null ? [...ids] : shared.filter((id) => ids.includes(id));
  }
  if (shared === null) return null;
  need(shared.length === 1, `trails listed under ${scopeOf(repo)} share ${shared.length} repository IDs, so its scope is unproven`);
  return shared[0];
}

// Lists each project's trails once per run and keeps them current; a failed listing is not retried.
class Forge {
  private projects = new Map<string, Promise<Trail[]>>();
  private scopes = new Map<string, Promise<string | null>>();

  constructor(readonly gh: Run, readonly entire: Run) {}

  trails(project: string): Promise<Trail[]> {
    let list = this.projects.get(project);
    if (!list) {
      list = listTrails(this.entire, project);
      this.projects.set(project, list);
    }
    return list;
  }

  // Broad search by URL; only an exact provenance line is a claim.
  async lookup(issue: Issue): Promise<{ claims: Trail[]; mentions: number[] }> {
    const claims: Trail[] = [];
    const cited: number[] = [];
    for (const trail of await this.trails(projectOf(issue.repo))) {
      if (claimedSource(trail.body) === issue.url) claims.push(trail);
      else if (mentions(`${trail.title}\n${trail.body}`, issue.url)) cited.push(trail.number);
    }
    return { claims: claims.sort((a, b) => a.number - b.number), mentions: cited.sort((a, b) => a - b) };
  }

  async remember(project: string, trail: Trail): Promise<void> {
    (await this.trails(project)).push(trail);
  }

  // A repository with no trails yet is listed again once its first trail exists.
  async scope(repo: string): Promise<string | null> {
    const known = this.scopes.get(repo);
    if (known && (await known) !== null) return known;
    const loading = repoScope(this.entire, repo);
    this.scopes.set(repo, loading);
    return loading;
  }
}

// ---- local state: private files, written atomically before the next remote step ----

const now = () => new Date().toISOString();

// The files hold private issue bodies: a 0700 run directory under ~/.cache/tmp, 0600 files.
function privatePath(path: string, flag: string): string {
  const root = join(homedir(), ".cache", "tmp");
  const full = resolve(path);
  const rel = relative(root, dirname(full));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new UsageError(`${flag} must be a file in a run directory under ${root}`);
  }
  return full;
}

function writePrivate(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
    const temp = `${path}.${process.pid}.tmp`;
    rmSync(temp, { force: true });
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (err) {
    throw new StateError(`could not write ${path}: ${(err as Error).message}`);
  }
}

function readState(path: string, text: string): Json {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Refused(`${path} is not JSON: ${(err as Error).message}`);
  }
  need(isRecord(data), `${path} holds no object`);
  return data;
}

function storedSnapshot(path: string, text: string): Snapshot {
  const data = readState(path, text);
  need(data.schema === SNAPSHOT_SCHEMA && typeof data.taken_at === "string", `${path} is not a ${SNAPSHOT_SCHEMA} file`);
  const repos = items(data.repos, `${path} repos`).map((raw) => {
    need(isRecord(raw) && typeof raw.repo === "string" && typeof raw.issues_enabled === "boolean" && typeof raw.open_issues === "number", `${path} holds a malformed repository`);
    return { repo: raw.repo, issues_enabled: raw.issues_enabled, open_issues: raw.open_issues };
  });
  const issues = items(data.issues, `${path} issues`).map((raw) => {
    need(isRecord(raw) && typeof raw.repo === "string" && Array.isArray(raw.labels) &&
      raw.labels.every((label: unknown) => typeof label === "string"), `${path} holds a malformed issue`);
    return toIssue(raw.repo, { ...raw, labels: raw.labels.map((name: string) => ({ name })) });
  });
  return { taken_at: data.taken_at, repos, issues };
}

// The first run of any kind takes the snapshot; later runs never change it.
async function snapshotOf(path: string, gh: Run, mayTake: boolean, log: (line: string) => void) {
  const taken = !existsSync(path);
  if (taken) {
    need(mayTake, `no snapshot at ${path}; a dry run or migration takes it first`);
    const repos: Snapshot["repos"] = [];
    const issues: Issue[] = [];
    for (const { repo, issues_enabled } of await scopeRepos(gh)) {
      const open = issues_enabled ? await openIssues(gh, repo) : [];
      repos.push({ repo, issues_enabled, open_issues: open.length });
      issues.push(...open);
    }
    writePrivate(path, { schema: SNAPSHOT_SCHEMA, taken_at: now(), owner: OWNER, extra_repos: EXTRA_REPOS, repos, issues });
    log(`snapshot: ${issues.length} open issue(s) in ${repos.length} repositories written to ${path}`);
  }
  const text = readFileSync(path, "utf8");
  return { snapshot: storedSnapshot(path, text), sha: createHash("sha256").update(text).digest("hex"), taken };
}

function storedEntry(path: string, url: string, raw: unknown): Entry {
  need(isRecord(raw) && (raw.closed_at === null || typeof raw.closed_at === "string"), `${path} holds a malformed entry for ${url}`);
  let trail: TrailRef | null = null;
  if (raw.trail !== null && raw.trail !== undefined) {
    const stored = raw.trail;
    need(isRecord(stored) && typeof stored.number === "number" && typeof stored.id === "string", `${path} holds a malformed trail for ${url}`);
    trail = { number: stored.number, id: stored.id, url: typeof stored.url === "string" ? stored.url : null };
  }
  return {
    source: url,
    trail,
    origin: raw.origin === "created" || raw.origin === "reused" ? raw.origin : null,
    closed_at: raw.closed_at,
    closed_without_trail: raw.closed_without_trail === true,
    last_error: typeof raw.last_error === "string" ? raw.last_error : null,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
  };
}

class MappingFile {
  private constructor(readonly path: string, readonly data: Mapping, private readonly dryRun: boolean) {}

  static load(path: string, snapshotSha: string, dryRun: boolean): MappingFile {
    if (!existsSync(path)) return new MappingFile(path, { schema: MAPPING_SCHEMA, snapshot_sha256: snapshotSha, issues: {} }, dryRun);
    const data = readState(path, readFileSync(path, "utf8"));
    need(data.schema === MAPPING_SCHEMA && isRecord(data.issues), `${path} is not a ${MAPPING_SCHEMA} file`);
    need(data.snapshot_sha256 === snapshotSha, `${path} belongs to another snapshot; pair it with the snapshot it was made from`);
    const issues: Record<string, Entry> = {};
    for (const [url, raw] of Object.entries(data.issues)) issues[url] = storedEntry(path, url, raw);
    return new MappingFile(path, { schema: MAPPING_SCHEMA, snapshot_sha256: snapshotSha, issues }, dryRun);
  }

  get(url: string): Entry | undefined {
    return Object.hasOwn(this.data.issues, url) ? this.data.issues[url] : undefined;
  }

  // The source field is always the issue URL itself. A dry run never writes.
  set(url: string, change: Partial<Entry>): void {
    if (this.dryRun) return;
    const entry: Entry = this.get(url) ?? {
      source: url, trail: null, origin: null, closed_at: null, closed_without_trail: false, last_error: null, updated_at: "",
    };
    this.data.issues[url] = { ...entry, ...change, source: url, updated_at: now() };
    writePrivate(this.path, this.data);
  }
}

// ---- one issue ----

type Step = "closed" | "failed" | "already-migrated" | "closed-elsewhere" | "would-create" | "would-close" | "not-started";
type Result = {
  issue: string;
  step: Step;
  trail: string | null;
  created: boolean;
  reused: boolean;
  type: string | null;
  priority: string | null;
  mentions: number[];
  error: string | null;
};

const blank = (issue: Issue): Result => ({
  issue: issue.url, step: "failed", trail: null, created: false, reused: false, type: null, priority: null, mentions: [], error: null,
});
const ref = (trail: Trail): TrailRef => ({ number: trail.number, id: trail.id, url: trail.url });

async function migrateIssue(issue: Issue, forge: Forge, mapping: MappingFile, dryRun: boolean): Promise<Result> {
  const result = blank(issue);
  try {
    const live = await viewIssue(forge.gh, issue);
    result.type = typeOf(live.labels);
    result.priority = priorityOf(live.labels);
    const { claims, mentions: cited } = await forge.lookup(issue);
    result.mentions = cited;
    need(claims.length < 2, `trails ${claims.map((t) => `#${t.number}`).join(", ")} each claim this issue; resolve the duplicate by hand`);
    const recorded = mapping.get(issue.url)?.trail ?? null;
    if (recorded) {
      need(claims[0]?.number === recorded.number, claims[0]
        ? `the mapping records trail #${recorded.number}, but trail #${claims[0].number} claims this issue`
        : `the mapping records trail #${recorded.number}, but no trail claims this issue`);
    }
    const project = projectOf(issue.repo);
    let trail = claims[0] ? await showTrail(forge.entire, project, claims[0].number) : null;
    const links = linkedTrails(live.comments);

    if (live.state !== "OPEN") {
      if (!trail) {
        mapping.set(issue.url, { closed_at: now(), closed_without_trail: true, last_error: null });
        return { ...result, step: "closed-elsewhere" };
      }
      // An earlier run closed it but stopped before recording the close.
      need(links.length === 1 && links[0] === trail.url, `the issue is closed but does not link only trail #${trail.number}`);
      mapping.set(issue.url, { trail: ref(trail), origin: mapping.get(issue.url)?.origin ?? "reused", closed_at: now(), last_error: null });
      return { ...result, step: "already-migrated", trail: trail.url };
    }

    await forge.scope(issue.repo); // a repository Entire cannot list fails before any write
    if (trail) {
      result.reused = true;
    } else {
      if (dryRun) return { ...result, step: "would-create" };
      const created = await createTrail(forge.entire, issue, live);
      result.created = true;
      mapping.set(issue.url, { trail: ref(created), origin: "created" });
      await forge.remember(project, created);
      trail = await showTrail(forge.entire, project, created.number);
    }
    const shownTrail = trail;
    mapping.set(issue.url, { trail: ref(shownTrail), origin: mapping.get(issue.url)?.origin ?? "reused" });
    result.trail = shownTrail.url;
    const problems = trailProblems(shownTrail, live, await forge.scope(issue.repo));
    need(problems.length === 0, `trail #${shownTrail.number} does not keep this issue: ${problems.join("; ")}`);
    const others = links.filter((url) => url !== shownTrail.url);
    need(others.length === 0, `the issue already links another trail: ${others.join(", ")}`);
    if (dryRun) return { ...result, step: "would-close" };
    await closeIssue(forge.gh, issue.url, links.length > 0 || shownTrail.url === null ? null : linkComment(shownTrail.url));
    mapping.set(issue.url, { closed_at: now(), last_error: null });
    return { ...result, step: "closed" };
  } catch (err) {
    if (err instanceof StateError) throw err;
    const error = (err as Error).message;
    mapping.set(issue.url, { last_error: error });
    return { ...result, step: "failed", error };
  }
}

type Check = { issue: string; status: "migrated" | "closed-elsewhere" | "open" | "mismatch"; trail: string | null; claims: number; problems: string[] };

async function verifyIssue(issue: Issue, forge: Forge, mapping: MappingFile): Promise<Check> {
  const check: Check = { issue: issue.url, status: "mismatch", trail: null, claims: 0, problems: [] };
  try {
    const live = await viewIssue(forge.gh, issue);
    const { claims } = await forge.lookup(issue);
    const recorded = mapping.get(issue.url)?.trail ?? null;
    check.claims = claims.length;
    if (claims.length > 1) check.problems.push(`trails ${claims.map((t) => `#${t.number}`).join(", ")} each claim this issue`);
    if (claims.length === 1) {
      const trail = await showTrail(forge.entire, projectOf(issue.repo), claims[0].number);
      check.trail = trail.url;
      check.problems.push(...trailProblems(trail, live, await forge.scope(issue.repo)));
      if (recorded && recorded.number !== trail.number) check.problems.push(`the mapping records trail #${recorded.number}`);
      const links = linkedTrails(live.comments);
      if (live.state !== "OPEN" && (links.length !== 1 || links[0] !== trail.url)) check.problems.push("the closed issue does not link only its trail");
    }
    if (claims.length === 0 && recorded) check.problems.push(`the mapping records trail #${recorded.number}, but no trail claims this issue`);
    if (live.state === "OPEN") check.status = "open";
    else if (check.problems.length > 0) check.status = "mismatch";
    else check.status = claims.length === 1 ? "migrated" : "closed-elsewhere";
  } catch (err) {
    if (err instanceof StateError) throw err;
    check.problems.push((err as Error).message);
  }
  return check;
}

// ---- runs ----

type Options = {
  snapshot: string;
  mapping: string;
  repos: string[] | "all";
  dryRun: boolean;
  verify: boolean;
  limit: number | null;
  maxFailures: number | null;
  timeoutMs: number;
};

type Deps = { ghBin: string; entireBin: string; out: (text: string) => void; err: (text: string) => void };

function select(snapshot: Snapshot, repos: string[] | "all"): Issue[] {
  if (repos === "all") return snapshot.issues;
  const scoped = new Set(snapshot.repos.map((r) => r.repo));
  for (const repo of repos) need(scoped.has(repo), `${repo} is not in the snapshot's scope`);
  return snapshot.issues.filter((issue) => repos.includes(issue.repo));
}

async function migrateRun(o: Options, gh: Run, entire: Run, d: Deps): Promise<number> {
  const log = (line: string) => d.err(`migrate-issues: ${line}\n`);
  const { snapshot, sha, taken } = await snapshotOf(o.snapshot, gh, true, log);
  const mapping = MappingFile.load(o.mapping, sha, o.dryRun);
  const forge = new Forge(gh, entire);
  const results: Result[] = [];
  let started = 0;
  let failed = 0;
  for (const issue of select(snapshot, o.repos)) {
    const entry = mapping.get(issue.url);
    if (entry?.closed_at) {
      results.push({ ...blank(issue), step: entry.trail ? "already-migrated" : "closed-elsewhere", trail: entry.trail?.url ?? null });
      continue;
    }
    if ((o.limit !== null && started >= o.limit) || (o.maxFailures !== null && failed >= o.maxFailures)) {
      results.push({ ...blank(issue), step: "not-started" });
      continue;
    }
    started++;
    const result = await migrateIssue(issue, forge, mapping, o.dryRun);
    if (result.step === "failed") failed++;
    const how = result.created ? " (created)" : result.reused ? " (existing trail)" : "";
    log(`${result.step.replace("-", " ")} ${issue.url}${result.trail ? ` -> ${result.trail}${how}` : ""}${result.error ? `: ${result.error}` : ""}`);
    results.push(result);
  }
  const count = (keep: (r: Result) => boolean) => results.filter(keep).length;
  const counts = {
    issues_found: results.length,
    trails_created: count((r) => r.created),
    trails_reused: count((r) => r.reused),
    issues_closed: count((r) => r.step === "closed"),
    failures: count((r) => r.step === "failed"),
    already_migrated: count((r) => r.step === "already-migrated"),
    closed_elsewhere: count((r) => r.step === "closed-elsewhere"),
    would_create: count((r) => r.step === "would-create"),
    would_close: count((r) => r.step === "would-close"),
    not_started: count((r) => r.step === "not-started"),
  };
  const about = { path: o.snapshot, taken_at: snapshot.taken_at, taken_now: taken, repositories: snapshot.repos.length, issues: snapshot.issues.length };
  d.out(`${JSON.stringify({
    schema: REPORT_SCHEMA, mode: o.dryRun ? "dry-run" : "migrate", dry_run: o.dryRun, selection: o.repos,
    snapshot: about, mapping: o.mapping, counts, issues: results,
  }, null, 2)}\n`);
  log(Object.entries(counts).map(([name, value]) => `${name}=${value}`).join(" "));
  return counts.failures > 0 ? 2 : 0;
}

async function verifyRun(o: Options, gh: Run, entire: Run, d: Deps): Promise<number> {
  const log = (line: string) => d.err(`migrate-issues: ${line}\n`);
  const { snapshot, sha } = await snapshotOf(o.snapshot, gh, false, log);
  const mapping = MappingFile.load(o.mapping, sha, true);
  const issues = select(snapshot, o.repos);
  const known = new Set(snapshot.issues.map((issue) => issue.url));
  const repos = o.repos === "all" ? (await scopeRepos(gh)).filter((r) => r.issues_enabled).map((r) => r.repo) : o.repos;
  const unsnapshotted: string[] = [];
  for (const repo of repos) {
    for (const open of await openIssues(gh, repo)) if (!known.has(open.url)) unsnapshotted.push(open.url);
  }
  const forge = new Forge(gh, entire);
  const checks: Check[] = [];
  for (const issue of issues) {
    const check = await verifyIssue(issue, forge, mapping);
    if (check.status === "open" || check.status === "mismatch") log(`${check.status} ${issue.url}${check.problems.length ? `: ${check.problems.join("; ")}` : ""}`);
    checks.push(check);
  }
  const selected = new Set(o.repos === "all" ? snapshot.repos.map((r) => r.repo) : o.repos);
  const outside: string[] = [];
  for (const project of new Set([...selected].map(projectOf))) {
    for (const trail of await forge.trails(project)) {
      const source = claimedSource(trail.body);
      const sourceRepo = source?.split("/").slice(3, 5).join("/") ?? "";
      if (source && !known.has(source) && (o.repos === "all" || selected.has(sourceRepo))) outside.push(`${project} trail ${trail.number} claims ${source}`);
    }
  }
  const count = (status: Check["status"]) => checks.filter((c) => c.status === status).length;
  const counts = {
    issues_found: checks.length,
    migrated: count("migrated"),
    closed_elsewhere: count("closed-elsewhere"),
    issues_open: count("open"),
    mismatches: count("mismatch"),
    trails_found: checks.filter((c) => c.claims === 1).length,
    duplicate_claims: checks.filter((c) => c.claims > 1).length,
    open_not_in_snapshot: unsnapshotted.length,
    claims_outside_snapshot: outside.length,
  };
  const about = { path: o.snapshot, taken_at: snapshot.taken_at, taken_now: false, repositories: snapshot.repos.length, issues: snapshot.issues.length };
  d.out(`${JSON.stringify({
    schema: REPORT_SCHEMA, mode: "verify", selection: o.repos, snapshot: about, mapping: o.mapping,
    counts, open_not_in_snapshot: unsnapshotted, claims_outside_snapshot: outside, issues: checks,
  }, null, 2)}\n`);
  log(Object.entries(counts).map(([name, value]) => `${name}=${value}`).join(" "));
  return counts.issues_open + counts.mismatches + counts.open_not_in_snapshot > 0 ? 2 : 0;
}

// ---- command line ----

const HELP = `migrate-issues: move open GitHub issues to intent-only Entire trails, one trail per issue.

  bun migrate-issues.ts --snapshot <file> --mapping <file> (--all | --repo <owner/name>...) [--dry-run]
      [--limit <n>] [--max-failures <n>] [--command-timeout <seconds>]
  bun migrate-issues.ts --snapshot <file> --mapping <file> (--all | --repo <owner/name>...) --verify
      [--command-timeout <seconds>]

Scope: every repository \`gh repo list ${OWNER} --no-archived\` returns, plus ${EXTRA_REPOS.join(", ")}.

  --snapshot <file>   Written once, by the first run of any kind: every open issue in scope with
                      its title, body and labels. Later runs and --verify use it unchanged.
  --mapping <file>    Each issue's trail, recorded as soon as the trail exists and before the issue
                      closes; reruns resume from it. A dry run never writes it. Both files must sit
                      in a run directory under ~/.cache/tmp, made 0700; the files are made 0600.
  --all | --repo      Which snapshot issues this run handles; --repo repeats.
  --dry-run           Every read the migration makes and no remote write; plans each issue.
  --limit <n>         Start at most n issues that still need work, then stop.
  --max-failures <n>  Start no further issues after n failures.
  --command-timeout <seconds>
                      Kill any one gh or entire command after this long (default 120). Its outcome
                      is then unknown; a rerun finds what it did.
  --verify            Read-only final scan: each selected snapshot issue, open issues missing from
                      the snapshot, and provenance claims on issues outside it.

Per issue: read it live; search its project's trails, all pages and statuses, for its URL. Only a
trail whose first body line is exactly "${PROVENANCE}<issue URL>" claims it. Two claims,
a claim with changes, or a claim that disagrees with the mapping fail closed. Without a claim,
create one --no-branch trail scoped to the issue's repository, with its title, provenance, labels
and body, the type and priority its labels state, and a --idempotency-key derived from its URL.
Close the issue as "${CLOSE_REASON}" with a comment linking the trail only after \`entire trail
show\` confirms provenance, no changes, repository scope, title, body, type and priority.
Run one migration at a time.

Output: progress and failures on stderr, with commands shown without titles, bodies or comments;
a ${REPORT_SCHEMA} JSON report on stdout with counts (issues_found, trails_created,
trails_reused, issues_closed, failures, ...) and every issue's plan or outcome.
Environment: MIGRATE_ISSUES_GH and MIGRATE_ISSUES_ENTIRE replace the gh and entire binaries.
Exit codes: 0 done; 1 not run or stopped (usage, state files, scope listing); 2 an issue failed, or
--verify found an open, mismatched or unsnapshotted issue.
`;

function whole(flag: string, text: string): number {
  if (!/^[1-9]\d*$/.test(text)) throw new UsageError(`${flag} takes a positive whole number`);
  return Number(text);
}

function parseArgs(argv: string[]): Options {
  let snapshot = "";
  let mapping = "";
  const repos: string[] = [];
  let all = false;
  let dryRun = false;
  let verify = false;
  let limit: number | null = null;
  let maxFailures: number | null = null;
  let timeout = 120;
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) throw new UsageError(`${name} needs a value`);
      return next;
    };
    if (name === "--snapshot") snapshot = value();
    else if (name === "--mapping") mapping = value();
    else if (name === "--repo") repos.push(value());
    else if (name === "--all") all = true;
    else if (name === "--dry-run") dryRun = true;
    else if (name === "--verify") verify = true;
    else if (name === "--limit") limit = whole(name, value());
    else if (name === "--max-failures") maxFailures = whole(name, value());
    else if (name === "--command-timeout") timeout = whole(name, value());
    else throw new UsageError(`unknown argument: ${name}`);
  }
  if (!snapshot || !mapping) throw new UsageError("--snapshot and --mapping are required");
  if (resolve(snapshot) === resolve(mapping)) throw new UsageError("--snapshot and --mapping must be different files");
  if (all === (repos.length > 0)) throw new UsageError("choose --all or one or more --repo <owner/name>");
  for (const repo of repos) if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new UsageError(`--repo takes owner/name, not ${repo}`);
  if (dryRun && verify) throw new UsageError("--dry-run and --verify are separate runs");
  if (verify && (limit !== null || maxFailures !== null)) throw new UsageError("--verify checks every selected issue; --limit and --max-failures bound migrations");
  return {
    snapshot: privatePath(snapshot, "--snapshot"), mapping: privatePath(mapping, "--mapping"), repos: all ? "all" : repos,
    dryRun, verify, limit, maxFailures, timeoutMs: timeout * 1000,
  };
}

async function main(argv: string[], d: Deps): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    d.out(HELP);
    return 0;
  }
  let o: Options;
  try {
    o = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    d.err(`migrate-issues: ${err.message}\n\n${HELP}`);
    return 1;
  }
  const gh = runner("gh", d.ghBin, o.timeoutMs);
  const entire = runner("entire", d.entireBin, o.timeoutMs);
  try {
    return o.verify ? await verifyRun(o, gh, entire, d) : await migrateRun(o, gh, entire, d);
  } catch (err) {
    d.err(`migrate-issues: stopped: ${(err as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  // exitCode, not exit(): a large report written to a pipe must drain before the process ends.
  process.exitCode = await main(process.argv.slice(2), {
    ghBin: process.env.MIGRATE_ISSUES_GH ?? "gh",
    entireBin: process.env.MIGRATE_ISSUES_ENTIRE ?? "entire",
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
