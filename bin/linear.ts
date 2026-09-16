#!/usr/bin/env bun
/**
 * linear — a small Linear workspace client for backlog work.
 *
 * One primitive (`gql`) and a thin porcelain over it. Names resolve to ids by
 * reading the workspace, so nothing here hardcodes a project, team, state, or
 * label id; a rename upstream is not a code change.
 *
 * Two contracts, both deliberate:
 *
 *   Labels are authority, not taxonomy. `Agent: *` labels make an issue
 *   eligible for autonomous execution, so adding one requires the explicit
 *   `--authorize-agent-work` flag. Removing is always allowed: de-escalation
 *   cannot surprise anyone.
 *
 *   `--json` always prints a parseable object, success or failure, with the
 *   same failure-is-a-value shape. Consumers never parse prose or infer an
 *   outcome from an exit code alone.
 *
 * The credential is discovered from the environment or `pass` and is never
 * printed, logged, or included in an error message.
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const LINEAR_GRAPHQL = "https://api.linear.app/graphql";
export const CREDENTIAL_NAMES = [
  "LINEAR_API_KEY",
  "LINEAR_API_TOKEN",
  "LINEAR_KEY",
  "LINEAR_PERSONAL_API_KEY",
];
export const AUTHORITY_LABEL_PREFIX = "Agent:";

export class LinearFailure extends Error {
  kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

export function errorPayload(kind: string, message: string) {
  return { error: { kind, message } };
}

/** Authority labels enlist autonomous work. Adding them is never implicit. */
export function guardAuthorityLabels(added: string[], authorize: boolean): void {
  if (authorize) return;
  const enlisted = added.filter((name) => name.startsWith(AUTHORITY_LABEL_PREFIX));
  if (enlisted.length === 0) return;
  throw new LinearFailure(
    "authority-label",
    `refusing to add ${enlisted.join(", ")}: these labels make an issue eligible for ` +
      `autonomous execution. Re-run with --authorize-agent-work if that is the intent.`,
  );
}

export function filterForList(options: {
  project?: string;
  state?: string;
  label?: string;
  assignee?: string;
  all?: boolean;
}) {
  const filter: Record<string, unknown> = {};
  if (options.project) filter.project = { name: { eq: options.project } };
  if (options.state) filter.state = { name: { eq: options.state } };
  else if (!options.all) filter.state = { type: { nin: ["completed", "canceled"] } };
  if (options.label) filter.labels = { name: { eq: options.label } };
  if (options.assignee === "me") filter.assignee = { isMe: { eq: true } };
  return filter;
}

export function buildIssueCreateInput(resolved: {
  title: string;
  teamId: string;
  description?: string;
  projectId?: string;
  labelIds?: string[];
  stateId?: string;
  assigneeId?: string;
}) {
  const input: Record<string, unknown> = {
    title: resolved.title,
    teamId: resolved.teamId,
  };
  if (resolved.description !== undefined) input.description = resolved.description;
  if (resolved.projectId) input.projectId = resolved.projectId;
  if (resolved.labelIds?.length) input.labelIds = resolved.labelIds;
  if (resolved.stateId) input.stateId = resolved.stateId;
  if (resolved.assigneeId) input.assigneeId = resolved.assigneeId;
  return input;
}

export function buildIssueUpdateInput(resolved: {
  stateId?: string;
  addedLabelIds?: string[];
  removedLabelIds?: string[];
  assigneeId?: string | null;
}) {
  const input: Record<string, unknown> = {};
  if (resolved.stateId) input.stateId = resolved.stateId;
  if (resolved.addedLabelIds?.length) input.addedLabelIds = resolved.addedLabelIds;
  if (resolved.removedLabelIds?.length) input.removedLabelIds = resolved.removedLabelIds;
  if (resolved.assigneeId !== undefined) input.assigneeId = resolved.assigneeId;
  return input;
}

export function renderIssueRows(nodes: any[]): string {
  if (nodes.length === 0) return "(no issues)";
  const width = (pick: (node: any) => string, cap: number) =>
    Math.min(cap, Math.max(...nodes.map((node) => pick(node).length)));
  const identifier = width((node) => node.identifier, 10);
  const state = width((node) => node.state?.name ?? "", 12);
  const labels = width((node) => labelNames(node).join(", "), 34);
  const fit = (text: string, available: number) =>
    text.length <= available ? text : `${text.slice(0, Math.max(0, available - 1))}…`;
  return nodes
    .map((node) => {
      const columns = [
        node.identifier.padEnd(identifier),
        (node.state?.name ?? "").padEnd(state),
        fit(labelNames(node).join(", "), labels).padEnd(labels),
        node.title,
      ];
      return columns.join("  ").trimEnd();
    })
    .join("\n");
}

export function labelNames(issue: any): string[] {
  return ((issue?.labels?.nodes ?? []) as any[])
    .map((node) => node?.name)
    .filter((name): name is string => typeof name === "string");
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const string = { type: "string" } as const;
const strings = { type: "string", multiple: true } as const;
const flag = { type: "boolean" } as const;

const COMMANDS: Record<string, { options: Record<string, any>; positional?: string }> = {
  ls: {
    options: {
      project: string,
      state: string,
      label: strings,
      assignee: string,
      limit: string,
      all: flag,
      json: flag,
    },
  },
  show: { options: { json: flag }, positional: "issue" },
  create: {
    options: {
      project: string,
      title: string,
      body: string,
      "body-file": string,
      label: strings,
      state: string,
      assignee: string,
      "dry-run": flag,
      json: flag,
      "authorize-agent-work": flag,
    },
  },
  update: {
    options: {
      state: string,
      "add-label": strings,
      "remove-label": strings,
      assignee: string,
      "dry-run": flag,
      json: flag,
      "authorize-agent-work": flag,
    },
    positional: "issue",
  },
  comment: {
    options: { body: string, "body-file": string, "dry-run": flag, json: flag },
    positional: "issue",
  },
  projects: { options: { json: flag } },
  labels: { options: { json: flag } },
  states: { options: { team: string, json: flag } },
  gql: { options: { vars: string, json: flag }, positional: "query" },
};

export const USAGE = `linear — small Linear workspace client

  linear ls [--project P] [--state S] [--label L] [--assignee me] [--limit N] [--all]
  linear show <ID>
  linear create --project P --title T [--body S | --body-file F]
                [--label L]... [--state S] [--assignee me] [--dry-run]
  linear update <ID> [--state S] [--add-label L]... [--remove-label L]...
                     [--assignee me|none] [--dry-run]
  linear comment <ID> [--body S | --body-file F] [--dry-run]
  linear projects | labels | states [--team KEY]
  linear gql <query | @file> [--vars '<json>' | --vars @file]

  Every command accepts --json. Adding an authority label (Agent: *) requires
  --authorize-agent-work.`;

export function parseCli(argv: string[]) {
  const command = argv[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { command: "help", values: {} as Record<string, any>, positionals: [] as string[] };
  }
  const spec = COMMANDS[command];
  if (!spec) {
    throw new LinearFailure("usage", `unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      options: spec.options,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new LinearFailure("usage", `${(error as Error).message}\n\n${USAGE}`);
  }
  const positionals = parsed.positionals as string[];
  if (spec.positional && positionals.length === 0) {
    throw new LinearFailure("usage", `${command} requires <${spec.positional}>\n\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new LinearFailure("usage", `${command} takes at most one <${spec.positional}>`);
  }
  return { command, values: parsed.values as Record<string, any>, positionals };
}

function bodyFrom(values: Record<string, any>): string | undefined {
  const inline = values.body;
  const file = values["body-file"];
  if (inline !== undefined && file !== undefined) {
    throw new LinearFailure("usage", "pass either --body or --body-file, not both");
  }
  if (file !== undefined) return readFileSync(file as string, "utf8");
  return inline as string | undefined;
}

// ---------------------------------------------------------------------------
// Credential
// ---------------------------------------------------------------------------

type RunResult = { status: number | null; stdout: string; error?: Error };

export function discoverCredential(
  env: Record<string, string | undefined>,
  run: (command: string, args: string[]) => RunResult,
) {
  for (const name of CREDENTIAL_NAMES) {
    const value = env[name];
    if (value) return { name, value: normalizeCredential(name, value) };
  }
  for (const name of CREDENTIAL_NAMES) {
    let result: RunResult;
    try {
      result = run("pass", ["show", "--", `workstation/${name}`]);
    } catch (error) {
      throw new LinearFailure(
        "credential",
        "cannot run pass; install it and configure the local password store",
      );
    }
    if ((result.status ?? 1) !== 0) continue;
    return { name, value: normalizeCredential(name, result.stdout) };
  }
  throw new LinearFailure(
    "credential",
    `no usable Linear credential in the environment or pass workstation/ ` +
      `(tried ${CREDENTIAL_NAMES.join(", ")}); check the entries and the GPG key`,
  );
}

function normalizeCredential(name: string, raw: string): string {
  const value = raw.trim();
  if (!value) throw new LinearFailure("credential", `credential ${name} is empty`);
  if (controlCharacters(value)) {
    throw new LinearFailure("credential", `credential ${name} contains control characters`);
  }
  return value;
}

export function controlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

function defaultRun(command: string, args: string[]): RunResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, PASSWORD_STORE_GPG_OPTS: "--batch --pinentry-mode error" },
  });
  return { status: result.status, stdout: result.stdout ?? "" };
}

// ---------------------------------------------------------------------------
// Transport and workspace resolution
// ---------------------------------------------------------------------------

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const credential = discoverCredential(process.env, defaultRun);
  let response;
  try {
    response = await fetch(LINEAR_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: credential.value },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    throw new LinearFailure("network", `cannot reach Linear: ${(error as Error).message}`);
  }
  if (!response.ok) throw new LinearFailure("http", `Linear HTTP ${response.status}`);
  const payload: any = await response.json();
  if (payload.errors?.length) {
    throw new LinearFailure("graphql", String(payload.errors[0]?.message ?? "GraphQL error"));
  }
  return payload.data;
}

const metaCache = new Map<string, Promise<any>>();

function cached(key: string, load: () => Promise<any>) {
  const hit = metaCache.get(key);
  if (hit) return hit;
  const pending = load();
  metaCache.set(key, pending);
  return pending;
}

async function resolveProject(name: string) {
  return cached(`project:${name}`, async () => {
    const data = await gql(
      `query($name: String!) {
         projects(first: 10, filter: { name: { eq: $name } }) {
           nodes { id name teams { nodes { id key name } } }
         }
       }`,
      { name },
    );
    const project = data.projects.nodes[0];
    if (!project) throw new LinearFailure("not-found", `no project named ${name}`);
    const team = project.teams.nodes[0];
    if (!team) throw new LinearFailure("not-found", `project ${name} has no team`);
    return { id: project.id, name: project.name, teamId: team.id, teamKey: team.key };
  });
}

async function resolveLabelIds(names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const data = await cached("labels", () =>
    gql(`{ issueLabels(first: 250) { nodes { id name } } }`),
  );
  const byName = new Map(
    (data.issueLabels.nodes as any[]).map((node) => [node.name.toLowerCase(), node.id]),
  );
  return names.map((name) => {
    const id = byName.get(name.toLowerCase());
    if (!id) {
      const known = [...byName.keys()].sort().join(", ");
      throw new LinearFailure("not-found", `no label named ${name}; known labels: ${known}`);
    }
    return id as string;
  });
}

async function resolveStateId(teamId: string, name: string): Promise<string> {
  const data = await cached(`states:${teamId}`, () =>
    gql(
      `query($team: String!) {
         team(id: $team) { states { nodes { id name } } }
       }`,
      { team: teamId },
    ),
  );
  const states = data.team.states.nodes as any[];
  const match = states.find((state) => state.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    const known = states.map((state) => state.name).join(", ");
    throw new LinearFailure("not-found", `no state named ${name}; known states: ${known}`);
  }
  return match.id;
}

async function resolveIssue(keyOrId: string) {
  return cached(`issue:${keyOrId}`, async () => {
    const data = await gql(
      `query($id: String!) { issue(id: $id) { id identifier team { id } } }`,
      { id: keyOrId },
    );
    if (!data.issue) throw new LinearFailure("not-found", `no issue ${keyOrId}`);
    return data.issue as { id: string; identifier: string; team: { id: string } };
  });
}

async function resolveAssignee(value: string | undefined): Promise<string | undefined | null> {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  if (value === "me") {
    const data = await cached("viewer", () => gql(`{ viewer { id name } }`));
    return data.viewer.id as string;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const ISSUE_FIELDS = `
  id identifier title url description
  state { name type }
  labels { nodes { name } }
  assignee { name }
  project { name }
  updatedAt
`;

async function commandList(values: Record<string, any>) {
  const limit = values.limit ? Number.parseInt(values.limit, 10) : 50;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new LinearFailure("usage", "--limit must be a positive integer");
  }
  const labels: string[] = values.label ?? [];
  if (labels.length > 1) {
    throw new LinearFailure("usage", "ls accepts one --label; use --label repeatedly only on create/update");
  }
  const data = await gql(
    `query($filter: IssueFilter, $first: Int) {
       issues(first: $first, filter: $filter, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } }
     }`,
    { filter: filterForList({ ...values, label: labels[0] }), first: limit },
  );
  return { issues: data.issues.nodes };
}

async function commandShow(values: Record<string, any>, positionals: string[]) {
  const data = await gql(
    `query($id: String!) {
       issue(id: $id) {
         ${ISSUE_FIELDS}
         comments(first: 20) { nodes { body createdAt user { name } } }
       }
     }`,
    { id: positionals[0] },
  );
  if (!data.issue) throw new LinearFailure("not-found", `no issue ${positionals[0]}`);
  return { issue: data.issue };
}

async function commandCreate(values: Record<string, any>) {
  if (!values.project) throw new LinearFailure("usage", "create requires --project");
  if (!values.title) throw new LinearFailure("usage", "create requires --title");
  const labels: string[] = values.label ?? [];
  guardAuthorityLabels(labels, Boolean(values["authorize-agent-work"]));
  const project = await resolveProject(values.project);
  const input = buildIssueCreateInput({
    title: values.title,
    teamId: project.teamId,
    description: bodyFrom(values),
    projectId: project.id,
    labelIds: await resolveLabelIds(labels),
    stateId: values.state ? await resolveStateId(project.teamId, values.state) : undefined,
    assigneeId: (await resolveAssignee(values.assignee)) ?? undefined,
  });
  if (values["dry-run"]) return { dryRun: input };
  const data = await gql(
    `mutation($input: IssueCreateInput!) {
       issueCreate(input: $input) { success issue { id identifier title url } }
     }`,
    { input },
  );
  if (!data.issueCreate.success) throw new LinearFailure("graphql", "issueCreate failed");
  return { issue: data.issueCreate.issue };
}

async function commandUpdate(values: Record<string, any>, positionals: string[]) {
  const added: string[] = values["add-label"] ?? [];
  const removed: string[] = values["remove-label"] ?? [];
  guardAuthorityLabels(added, Boolean(values["authorize-agent-work"]));
  if (!["state", "add-label", "remove-label", "assignee"].some((key) => values[key] !== undefined)) {
    throw new LinearFailure("usage", "update requires at least one of --state, --add-label, --remove-label, --assignee");
  }
  const issue = await resolveIssue(positionals[0]);
  const stateId = values.state
    ? await resolveStateId(issue.team.id, values.state)
    : undefined;
  const input = buildIssueUpdateInput({
    stateId,
    addedLabelIds: await resolveLabelIds(added),
    removedLabelIds: await resolveLabelIds(removed),
    assigneeId: await resolveAssignee(values.assignee),
  });
  if (values["dry-run"]) return { dryRun: { id: issue.id, input } };
  const data = await gql(
    `mutation($id: String!, $input: IssueUpdateInput!) {
       issueUpdate(id: $id, input: $input) {
         success issue { id identifier url state { name } labels { nodes { name } } }
       }
     }`,
    { id: issue.id, input },
  );
  if (!data.issueUpdate.success) throw new LinearFailure("graphql", "issueUpdate failed");
  return { issue: data.issueUpdate.issue };
}

async function commandComment(values: Record<string, any>, positionals: string[]) {
  const body = bodyFrom(values);
  if (!body) throw new LinearFailure("usage", "comment requires --body or --body-file");
  const issue = await resolveIssue(positionals[0]);
  const input = { issueId: issue.id, body };
  if (values["dry-run"]) return { dryRun: input };
  const data = await gql(
    `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { url } } }`,
    { input },
  );
  if (!data.commentCreate.success) throw new LinearFailure("graphql", "commentCreate failed");
  return { comment: data.commentCreate.comment };
}

async function commandProjects() {
  const data = await gql(
    `{ projects(first: 50) { nodes { id name teams { nodes { key name } } } } }`,
  );
  return { projects: data.projects.nodes };
}

async function commandLabels() {
  const data = await cached("labels", () =>
    gql(`{ issueLabels(first: 250) { nodes { id name } } }`),
  );
  return { labels: data.issueLabels.nodes };
}

async function commandStates(values: Record<string, any>) {
  const data = await gql(
    values.team
      ? `query($key: String!) {
           teams(first: 10, filter: { key: { eq: $key } }) {
             nodes { key name states { nodes { id name type } } }
           }
         }`
      : `{ teams(first: 20) { nodes { key name states { nodes { id name type } } } } }`,
    values.team ? { key: values.team } : {},
  );
  return { teams: data.teams.nodes };
}

async function commandGql(values: Record<string, any>, positionals: string[]) {
  const raw = positionals[0];
  const query = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
  let variables: Record<string, unknown> = {};
  if (values.vars) {
    const text = values.vars.startsWith("@")
      ? readFileSync(values.vars.slice(1), "utf8")
      : values.vars;
    variables = JSON.parse(text);
  }
  return await gql(query, variables);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function human(command: string, result: any): string {
  switch (command) {
    case "ls":
      return renderIssueRows(result.issues);
    case "show": {
      const issue = result.issue;
      const lines = [
        `${issue.identifier}  ${issue.title}`,
        `${issue.state?.name ?? ""}${issue.assignee?.name ? `  @${issue.assignee.name}` : ""}${
          issue.project?.name ? `  ${issue.project.name}` : ""
        }`,
        `labels: ${labelNames(issue).join(", ") || "(none)"}`,
        issue.url,
        "",
        issue.description ?? "",
      ];
      const comments = issue.comments?.nodes ?? [];
      if (comments.length) {
        lines.push("", "comments:");
        for (const comment of comments) {
          lines.push(`  ${comment.user?.name ?? "(unknown)"} ${comment.createdAt}: ${comment.body}`);
        }
      }
      return lines.join("\n");
    }
    case "projects":
      return result.projects
        .map((project: any) => `${project.name}  [${project.teams.nodes.map((t: any) => t.key).join(", ")}]`)
        .join("\n");
    case "labels":
      return result.labels.map((label: any) => label.name).join("\n");
    case "states":
      return result.teams
        .map(
          (team: any) =>
            `${team.key} ${team.name}\n` +
            team.states.nodes.map((state: any) => `  ${state.name}  (${state.type})`).join("\n"),
        )
        .join("\n");
    default:
      return JSON.stringify(result, null, 2);
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function dispatch(cli: ReturnType<typeof parseCli>) {
  const { command, values, positionals } = cli;
  switch (command) {
    case "help":
      return undefined;
    case "ls":
      return await commandList(values);
    case "show":
      return await commandShow(values, positionals);
    case "create":
      return await commandCreate(values);
    case "update":
      return await commandUpdate(values, positionals);
    case "comment":
      return await commandComment(values, positionals);
    case "projects":
      return await commandProjects();
    case "labels":
      return await commandLabels();
    case "states":
      return await commandStates(values);
    case "gql":
      return await commandGql(values, positionals);
    default:
      throw new LinearFailure("usage", `unknown command ${command}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  let cli;
  try {
    cli = parseCli(argv);
  } catch (error) {
    const failure = error as LinearFailure;
    process.stderr.write(`linear: ${failure.message}\n`);
    return 1;
  }
  if (cli.command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  try {
    const result = await dispatch(cli);
    if (cli.values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`${human(cli.command, result)}\n`);
    return 0;
  } catch (error) {
    const failure =
      error instanceof LinearFailure
        ? error
        : new LinearFailure("internal", (error as Error).message);
    if (cli.values.json) process.stdout.write(`${JSON.stringify(errorPayload(failure.kind, failure.message))}\n`);
    else process.stderr.write(`linear: ${failure.message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}