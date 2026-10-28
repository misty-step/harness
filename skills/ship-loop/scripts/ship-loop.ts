#!/usr/bin/env bun
// ship-loop: the one entry point for a PR's review-round state.
//
// The PR's own comments are the only authority. Each accepted write is an
// append-only comment carrying one event; `replay` reduces them to state and
// `apply` refuses any event the workflow does not allow. The file keeps no
// round count, lock or local cache of its own, so a new thread, a succession
// or a retry reads the same state.

import { createHash } from "node:crypto";

export const STATUS_SCHEMA = "ship-loop.status.v1";
const MARKER = "<!-- ship-loop:event v1 -->";
const RIGORS = ["light", "standard", "critical"];
const BLOCKER_CLASSES = ["broken_journey", "wrong_data", "security_privacy", "data_loss", "broken_build", "irreversible", "none"];
const OUTCOMES = ["PASS", "ISSUES", "BLOCKED"];
const VERDICTS = ["SHIP", "FIX", "REVERT", "SPLIT"];
const FIX_ROUND_LIMIT = 1;

export type Phase = "verify" | "judge" | "fix" | "recheck" | "final-judge" | "shipped" | "revert-split";
export type Finding = {
  id: string;
  evidence: string;
  introduced_by_diff: boolean;
  already_on_main: boolean;
  blocker_class: string;
};
export type Report = { role: string; sha: string; thread_id: string; report_url: string; outcome: string; findings: Finding[] };
export type Recheck = {
  thread_id: string;
  reporter_thread_id: string;
  sha: string;
  report_url: string;
  results: { blocker: string; status: "fixed" | "not-fixed"; evidence: string }[];
  regressions: Finding[];
};
export type State = {
  ticket: string;
  pr_url: string;
  rigor: string;
  rigor_reason: string;
  base: string;
  head: string;
  carried: string[];
  phase: Phase;
  builder_threads: string[];
  judge_threads: string[];
  reports: Record<string, Report>;
  recheck: Recheck | null;
  fix_round: number;
  fix: null | { blockers: string[]; reporter_thread: string; judge_thread: string; sha: string };
  verdict: null | { verdict: string; sha: string; thread_id: string };
};
export type Event = Record<string, any> & { v: number; kind: string; seq: number; key: string };
export type Comment = { id: number; body: string; author: string | null };
export type Ledger = { state: State | null; last_seq: number; accepted: { id: number; event: Event }[]; rejected: number[] };

// Refused: the workflow forbids this write. LedgerError: the ledger cannot be trusted.
export class Refused extends Error {}
export class LedgerError extends Error {}

function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Refused(message);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stable((value as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Hash the JSON-normalized body, so a write and its read-back compare equal.
export function keyOf(body: Record<string, unknown>): string {
  return createHash("sha256").update(stable(JSON.parse(JSON.stringify(body)))).digest("hex");
}

function fieldsOnly(o: Record<string, unknown>, allowed: string[], what: string) {
  for (const k of Object.keys(o)) need(allowed.includes(k), `${what} has unknown field "${k}"`);
}

function text(o: Record<string, unknown>, field: string): string {
  need(typeof o[field] === "string" && (o[field] as string).trim() !== "", `${field} is required`);
  return o[field] as string;
}

export function requiredRoles(rigor: string): string[] {
  return rigor === "light" ? ["qa-review"] : ["qa", "review"];
}

// Only these findings can be named as blockers by a judge.
export function eligible(f: Finding): boolean {
  return f.introduced_by_diff === true && f.already_on_main === false && f.blocker_class !== "none";
}

function validateFindings(list: unknown): Finding[] {
  need(Array.isArray(list), "findings must be an array");
  const ids = new Set<string>();
  for (const f of list as Record<string, unknown>[]) {
    fieldsOnly(f, ["id", "evidence", "introduced_by_diff", "already_on_main", "blocker_class"], "finding");
    const id = text(f, "id");
    need(!ids.has(id), `finding id ${id} repeats`);
    ids.add(id);
    text(f, "evidence");
    need(typeof f.introduced_by_diff === "boolean", `finding ${id}.introduced_by_diff must be a boolean`);
    need(typeof f.already_on_main === "boolean", `finding ${id}.already_on_main must be a boolean`);
    need(BLOCKER_CLASSES.includes(f.blocker_class as string), `finding ${id}.blocker_class is not a known class`);
  }
  return list as Finding[];
}

function checkThread(s: State, thread: string, excluded: string[], role: string) {
  need(thread.trim() !== "", `${role} thread_id is required`);
  need(!s.builder_threads.includes(thread) || role === "builder", `${role} thread is the builder thread; reviews and rulings need an independent thread`);
  need(!excluded.includes(thread), `${role} thread ${thread} is already recorded for another role`);
}

function reviewThreads(s: State): string[] {
  return [...new Set([...Object.values(s.reports).map((r) => r.thread_id), ...(s.recheck ? [s.recheck.thread_id] : [])])].sort();
}

// The single transition function. Returns the next state or throws Refused.
export function apply(s: State | null, e: Event): State {
  if (e.kind === "init") {
    need(s === null, "init after the ledger exists would reset it");
    fieldsOnly(e, ["v", "kind", "seq", "key", "ticket", "pr_url", "rigor", "rigor_reason", "base", "sha", "builder_thread_id"], "init");
    need(e.seq === 1, "init must be the first event");
    need(RIGORS.includes(e.rigor), `rigor must be one of ${RIGORS.join(", ")}`);
    text(e, "rigor_reason");
    need(/^[\w./-]+$/.test(e.base), "base must be a git ref");
    need(/^[0-9a-f]{40}$/.test(e.sha), "sha must be a full commit SHA");
    const builder = text(e, "builder_thread_id");
    return {
      ticket: text(e, "ticket"), pr_url: text(e, "pr_url"), rigor: e.rigor, rigor_reason: e.rigor_reason,
      base: e.base, head: e.sha, carried: [], phase: "verify", builder_threads: [builder], judge_threads: [],
      reports: {}, recheck: null, fix_round: 0, fix: null, verdict: null,
    };
  }
  need(s !== null, `${e.kind} before init`);
  const next: State = structuredClone(s);

  if (e.kind === "report") {
    fieldsOnly(e, ["v", "kind", "seq", "key", "role", "sha", "thread_id", "report_url", "outcome", "findings"], "report");
    need(next.phase === "verify", `reports are taken only in verify; this PR is in ${next.phase}`);
    need(requiredRoles(next.rigor).includes(e.role), `${e.role} is not a required review for ${next.rigor} rigor`);
    need(!next.reports[e.role], `${e.role} already reported at this head`);
    need(e.sha === next.head, `report is for ${e.sha}, but head is ${next.head}`);
    checkThread(next, text(e, "thread_id"), reviewThreads(next), e.role);
    text(e, "report_url");
    need(OUTCOMES.includes(e.outcome), `outcome must be one of ${OUTCOMES.join(", ")}`);
    const findings = validateFindings(e.findings);
    next.reports[e.role] = { role: e.role, sha: e.sha, thread_id: e.thread_id, report_url: e.report_url, outcome: e.outcome, findings };
    if (requiredRoles(next.rigor).every((r) => next.reports[r])) next.phase = "judge";
    return next;
  }

  if (e.kind === "verdict") {
    fieldsOnly(e, ["v", "kind", "seq", "key", "thread_id", "sha", "verdict", "blockers", "tickets", "report_url"], "verdict");
    need(next.phase === "judge" || next.phase === "final-judge", `verdicts are ruled in judge or final-judge; this PR is in ${next.phase}`);
    checkThread(next, text(e, "thread_id"), reviewThreads(next), "judge");
    text(e, "report_url");
    need(e.sha === next.head, `verdict is for ${e.sha}, but head is ${next.head}`);
    need(VERDICTS.includes(e.verdict), `verdict must be one of ${VERDICTS.join(", ")}`);
    need(Array.isArray(e.blockers) && e.blockers.every((b: unknown) => typeof b === "string"), "blockers must be an array of strings");
    const blockers: string[] = e.blockers;
    need(new Set(blockers).size === blockers.length, "blockers repeat");

    if (e.verdict === "FIX") {
      need(next.phase === "judge", "no fix round remains; the final judge rules SHIP with tickets or REVERT / SPLIT");
      need(next.fix_round < FIX_ROUND_LIMIT, "the fix round is already used");
      need(blockers.length > 0, "FIX must name exact blockers");
      const atHead = [next.head, ...next.carried];
      const reporters = new Set<string>();
      for (const ref of blockers) {
        const [role, ...rest] = ref.split(":");
        const id = rest.join(":");
        const report = next.reports[role];
        const finding = report && atHead.includes(report.sha) ? report.findings.find((f) => f.id === id) : undefined;
        need(finding, `${ref} is not a finding in the reports at this head`);
        need(eligible(finding), `${ref} is not an introduced, not-on-main finding with a blocker class`);
        reporters.add(report.thread_id);
      }
      need(reporters.size === 1, "FIX blockers must come from one reporter thread, which rechecks them");
      next.fix_round = 1;
      next.fix = { blockers, reporter_thread: [...reporters][0], judge_thread: e.thread_id, sha: next.head };
      next.phase = "fix";
    } else if (e.verdict === "SHIP") {
      need(blockers.length === 0, "SHIP cannot name blockers");
      if (next.fix) {
        // After a fix, the named-blocker recheck is the QA evidence for this head.
        need(next.recheck && next.recheck.results.every((r) => r.status === "fixed"), "SHIP after a fix round needs every named blocker rechecked as fixed");
      } else {
        const qa = next.reports.qa ?? next.reports["qa-review"];
        need(qa && ["PASS", "ISSUES"].includes(qa.outcome) && requiredRoles(next.rigor).every((role) => next.reports[role]?.outcome !== "BLOCKED"), "SHIP needs completed independent QA and review; BLOCKED reports cannot ship");
      }
      next.phase = "shipped";
    } else {
      next.phase = "revert-split";
    }
    next.verdict = { verdict: e.verdict, sha: e.sha, thread_id: e.thread_id };
    next.judge_threads.push(e.thread_id);
    return next;
  }

  if (e.kind === "recheck") {
    fieldsOnly(e, ["v", "kind", "seq", "key", "thread_id", "reporter_thread_id", "sha", "report_url", "results", "regressions"], "recheck");
    need(next.phase === "recheck" && next.fix, `rechecks run only after a fix; this PR is in ${next.phase}`);
    need(e.sha === next.head, `recheck is for ${e.sha}, but head is ${next.head}`);
    need(e.reporter_thread_id === next.fix.reporter_thread, "recheck must reference the blocking reporter's original thread");
    checkThread(next, text(e, "thread_id"), [...reviewThreads(next), ...next.judge_threads], "recheck");
    text(e, "report_url");
    need(Array.isArray(e.results), "results must be an array");
    const seen = e.results.map((r: { blocker: string }) => r.blocker);
    need(seen.length === next.fix.blockers.length && next.fix.blockers.every((b) => seen.includes(b)), "results must cover exactly the named blockers");
    for (const r of e.results as Record<string, unknown>[]) {
      fieldsOnly(r, ["blocker", "status", "evidence"], "recheck result");
      need(r.status === "fixed" || r.status === "not-fixed", "result status must be fixed or not-fixed");
      text(r, "evidence");
    }
    const regressions = validateFindings(e.regressions);
    need(regressions.every((f) => f.introduced_by_diff && !f.already_on_main), "recheck regressions must be introduced by the fix; unrelated findings belong in follow-ups");
    next.recheck = { thread_id: e.thread_id, reporter_thread_id: e.reporter_thread_id, sha: e.sha, report_url: e.report_url, results: e.results, regressions };
    next.phase = "final-judge";
    return next;
  }

  if (e.kind === "head") {
    // v1 carries have no bases; bases and refresh were added without changing old events' meaning.
    const added = e.reason === "carry" ? ["from_base", "to_base"] : e.reason === "refresh" ? ["base"] : [];
    fieldsOnly(e, ["v", "kind", "seq", "key", "reason", "sha", "thread_id", "from", "patch_id_from", "patch_id_to", ...added], "head");
    need(/^[0-9a-f]{40}$/.test(e.sha), "sha must be a full commit SHA");
    need(e.sha !== next.head, "head is already this SHA");
    if (e.reason === "fix") {
      need(next.phase === "fix", `a fix commit is accepted only in the fix phase; this PR is in ${next.phase}`);
      checkThread(next, text(e, "thread_id"), [...reviewThreads(next), ...next.judge_threads], "builder");
      next.builder_threads.push(e.thread_id);
      next.head = e.sha;
      next.carried = [];
      next.phase = "recheck";
      return next;
    }
    if (e.reason === "refresh") {
      // Only an unreviewed head may move without a patch-id; any report, ruling or fix keeps its head.
      need(next.phase === "verify" && Object.keys(next.reports).length === 0, `a refresh applies only before any report; this PR is in ${next.phase} with ${Object.keys(next.reports).length} report(s)`);
      need(e.from === next.head, `refresh is from ${e.from}, but head is ${next.head}`);
      need(/^[0-9a-f]{40}$/.test(e.base), "refresh base must be a full commit SHA");
      next.base = e.base;
      next.head = e.sha;
      return next;
    }
    need(e.reason === "carry", "head reason must be fix, carry or refresh");
    need(["judge", "final-judge", "shipped"].includes(next.phase), `a patch-identical carry applies before a ruling; this PR is in ${next.phase}`);
    need(e.from === next.head, `carry is from ${e.from}, but head is ${next.head}`);
    need(typeof e.patch_id_from === "string" && e.patch_id_from !== "", "carry needs the judged patch-id");
    need(e.patch_id_from === e.patch_id_to, "carry needs an unchanged patch-id; otherwise run a fix or re-verify");
    if ("from_base" in e || "to_base" in e) {
      need(/^[0-9a-f]{40}$/.test(e.from_base) && /^[0-9a-f]{40}$/.test(e.to_base), "carry bases must both be full commit SHAs");
      next.base = e.to_base;
    }
    next.carried.push(next.head);
    next.head = e.sha;
    return next;
  }

  throw new Refused(`unknown event kind ${e.kind}`);
}

// Parse and reduce the ledger. Malformed or gapped chains are LedgerError: unknown, never empty.
// A duplicate sequence number means a lost concurrent write: the lowest comment id wins, the rest are rejected.
export function replay(comments: Comment[], writer: string): Ledger {
  if (!writer.trim()) throw new LedgerError("PR author is unknown");
  const parsed = comments
    .filter((c) => c.author?.toLowerCase() === writer.toLowerCase() && c.body.startsWith(MARKER))
    .sort((a, b) => a.id - b.id)
    .map((c) => ({ id: c.id, event: parseEvent(c) }));
  let state: State | null = null;
  let next = 1;
  const accepted: Ledger["accepted"] = [];
  const rejected: number[] = [];
  for (const { id, event } of parsed) {
    if (event.seq < next) { rejected.push(id); continue; }
    if (event.seq > next) throw new LedgerError(`ledger gap: seq ${next} is missing before comment ${id}`);
    try {
      state = apply(state, event);
    } catch (err) {
      if (err instanceof Refused) throw new LedgerError(`ledger seq ${event.seq} (comment ${id}) is invalid: ${err.message}`);
      throw err;
    }
    accepted.push({ id, event });
    next++;
  }
  return { state, last_seq: next - 1, accepted, rejected };
}

function parseEvent(c: Comment): Event {
  const match = /^<!-- ship-loop:event v1 -->\n```json\n([\s\S]*)\n```\s*$/.exec(c.body);
  if (!match) throw new LedgerError(`comment ${c.id} has the ship-loop marker but no event block`);
  let event: any;
  try {
    event = JSON.parse(match[1]);
  } catch {
    throw new LedgerError(`comment ${c.id} holds malformed JSON`);
  }
  if (!event || typeof event !== "object" || !Number.isInteger(event.seq) || event.seq < 1 || typeof event.kind !== "string") {
    throw new LedgerError(`comment ${c.id} lacks a valid seq or kind`);
  }
  const { seq: _seq, key, ...body } = event;
  if (key !== keyOf(body)) throw new LedgerError(`comment ${c.id} fails its content key`);
  return event as Event;
}

export function renderEvent(event: Event): string {
  return `${MARKER}\n\`\`\`json\n${JSON.stringify(event, null, 2)}\n\`\`\`\n`;
}

// The status document the Heartbeat and conductors read. Field names are stable within v1.
export function statusOf(ledger: Ledger, pr: string) {
  const s = ledger.state;
  const ids = s ? reviewThreads(s) : [];
  return {
    schema: STATUS_SCHEMA,
    ledger: s ? "present" : "absent",
    pr,
    ticket: s?.ticket ?? null,
    rigor: s?.rigor ?? null,
    base: s?.base ?? null,
    phase: s?.phase ?? null,
    source_head: s?.head ?? null,
    carried_shas: s?.carried ?? [],
    fix_round: s?.fix_round ?? 0,
    fix_round_limit: FIX_ROUND_LIMIT,
    fix_blockers: s?.fix?.blockers ?? [],
    review_thread_ids: ids,
    review_thread_count: ids.length,
    builder_thread_ids: s?.builder_threads ?? [],
    recheck: s?.recheck ?? null,
    verdict: s?.verdict ?? null,
    last_seq: ledger.last_seq,
    rejected_writes: ledger.rejected.length,
  };
}

// ---- prompts: the only way a role receives its task ----

const QA_ROLE = { qa: "independent QA", review: "independent code reviewer", "qa-review": "independent combined QA and code reviewer" } as const;
type PromptRole = keyof typeof QA_ROLE | "judge" | "recheck" | "final-judge" | "fix-builder";
const ROLE_PHASE: Record<PromptRole, Phase> = { qa: "verify", review: "verify", "qa-review": "verify", judge: "judge", recheck: "recheck", "final-judge": "final-judge", "fix-builder": "fix" };
const COMMAND = `bun '${import.meta.path.replaceAll("'", "'\\''")}'`;

function blockerLines(s: State): string {
  const lines: string[] = [];
  for (const [role, report] of Object.entries(s.reports)) {
    if (!["qa", "review", "qa-review"].includes(role)) continue;
    for (const f of report.findings) {
      const ref = `${role}:${f.id}`;
      const flag = eligible(f) ? "eligible blocker" : "not eligible (follow-up or skip)";
      lines.push(`- \`${ref}\` [${f.blocker_class}, introduced=${f.introduced_by_diff}, on_main=${f.already_on_main}] ${flag}: ${f.evidence} (${report.report_url})`);
    }
  }
  return lines.length ? lines.join("\n") : "- none";
}

export function prompt(s: State, prUrl: string, role: PromptRole): string {
  need(ROLE_PHASE[role] === s.phase, `role ${role} runs in phase ${ROLE_PHASE[role]}; this PR is in ${s.phase}`);
  if (role in QA_ROLE) need(requiredRoles(s.rigor).includes(role), `${role} is not a required review for ${s.rigor} rigor`);
  const head = s.head;
  const header = `PR ${prUrl} at head ${head}. Ticket ${s.ticket}. Rigor ${s.rigor} (${s.rigor_reason}). Base ${s.base}.`;
  const reportJson = `{"role": "${role}", "sha": "${head}", "thread_id": "<your native thread id>", "report_url": "<link to your posted report>", "outcome": "PASS|ISSUES|BLOCKED", "findings": [{"id": "F1", "evidence": "file:line, concrete failure, evidence link", "introduced_by_diff": true, "already_on_main": false, "blocker_class": "broken_journey|wrong_data|security_privacy|data_loss|broken_build|irreversible|none"}]}`;
  const submit = (kind: string) => `Save the JSON payload to a file, then the conductor records it: \`${COMMAND} record --pr ${prUrl} --kind ${kind} --file <payload.json>\`. Use only the thread and report links you actually have. Label each claim measured, inferred or guess in the same sentence.`;

  if (role in QA_ROLE) {
    const who = QA_ROLE[role as keyof typeof QA_ROLE];
    const scope = role === "review"
      ? "Change nothing. Trace callers, config, migrations, deploy and rollback outside the diff for consequential effects."
      : "Read skill://verification and use the repository's verification skill for the changed real consumer path. Follow its account, evidence and cleanup contract; documents/internal changes need their own composition proof, not an unrelated product journey.";
    return [
      `You are the ${who} for ${header}`,
      "You did not build this change or rule on it. Check out the head in your own worktree.",
      scope,
      "Report every finding with evidence. Classify each one honestly: introduced_by_diff, already_on_main, and a blocker_class. Anything already on main, or not introduced by this diff, can never block.",
      "You cannot authorize a fix round, and you cannot issue a verdict. Only the judge rules.",
      "Verdict PASS, ISSUES or BLOCKED. Owner sign-in: PROVEN (link), UNPROVEN (access needed) or n/a (why). For each finding: the steps, expected result, actual result and evidence.",
      `Post your report on the PR, then return this JSON with exactly these fields:\n\`\`\`json\n${reportJson}\n\`\`\``,
      submit("report"),
    ].join("\n\n");
  }

  if (role === "judge") {
    return [
      `You are the independent judge for ${header}`,
      "You did not build, review or test this change. Your thread must not be any of: builder " + s.builder_threads.join(", ") + "; reviewers " + reviewThreads(s).join(", ") + ".",
      "Read skill://judge for the ruling and proof contract.",
      "Findings and eligibility:\n" + blockerLines(s),
      "Rule once. SHIP with no blockers after completed QA (PASS or ISSUES) and review at this head; BLOCKED cannot ship. Rule on the findings and name follow-up tickets for worthwhile work. FIX names the exact eligible blockers above from one reporter thread and is the only fix round this PR gets. REVERT or SPLIT drops or divides the unit.",
      `Post your verdict on the PR, then return this JSON:\n\`\`\`json\n{"thread_id": "<your native thread id>", "sha": "${head}", "verdict": "SHIP|FIX|REVERT|SPLIT", "blockers": ["qa:F1"], "tickets": ["<follow-up links>"], "report_url": "<link to your verdict>"}\n\`\`\``,
      submit("verdict"),
    ].join("\n\n");
  }

  if (role === "fix-builder") {
    need(s.fix, "no fix is authorized");
    const named = s.fix.blockers.map((b) => `- \`${b}\``).join("\n");
    return [
      `You are the builder for the single fix round on ${header}`,
      `Fix only these blockers, named by the judge's ruling:\n${named}`,
      "Do not fix anything else, and do not reopen review. New findings are follow-up tickets. Check out the PR branch, push one commit set, and keep the existing PR.",
      `When pushed, record the new head: \`${COMMAND} record --pr ${prUrl} --kind head\` with payload \`{"reason": "fix", "sha": "<new head sha>", "thread_id": "<your native thread id>"}\`. Label each claim measured, inferred or guess in the same sentence.`,
    ].join("\n\n");
  }

  if (role === "recheck") {
    need(s.fix, "no fix is authorized");
    const named = s.fix.blockers.map((b) => `- \`${b}\``).join("\n");
    return [
      `You are a new independent recheck thread continuing the blocking reporter's role on ${header}. Original reporter thread: ${s.fix.reporter_thread}.`,
      "For QA rechecks, read skill://verification. Retain proof for unchanged behavior.",
      `Verify that each blocker below is fixed and that nothing regressed. Do not hunt for new edge cases or reopen the full review. New unrelated findings are not yours to report here.\n${named}`,
      "Record only regressions introduced by the fix, using the same finding fields as the initial report. Use an empty regressions array if none. The final judge rules on them; this does not authorize another fix round.",
      `Return one result per blocker:\n\`\`\`json\n{"thread_id": "<your new native thread id>", "reporter_thread_id": "${s.fix.reporter_thread}", "sha": "${head}", "report_url": "<link>", "results": [{"blocker": "${s.fix.blockers[0]}", "status": "fixed|not-fixed", "evidence": "<link>"}], "regressions": []}\n\`\`\``,
      submit("recheck"),
    ].join("\n\n");
  }

  // final-judge: the fix round is spent, so no FIX option is offered.
  return [
    `You are the final judge for ${header}`,
    `The fix round is spent. Your thread must not be any of: builder ${s.builder_threads.join(", ")}; reviewers ${reviewThreads(s).join(", ")}.`,
    "Read skill://judge for the ruling and proof contract.",
    `Recheck report: ${s.recheck?.report_url ?? "missing"}. Recheck results: ${JSON.stringify(s.recheck?.results ?? [])}`,
    `Regressions introduced by the fix: ${JSON.stringify(s.recheck?.regressions ?? [])}`,
    "Rule once on the named fixes and reported regressions. SHIP only if every named blocker is fixed and no demonstrated blocking regression remains; record worthwhile nonblocking findings as follow-up tickets. REVERT or SPLIT otherwise.",
    `Return:\n\`\`\`json\n{"thread_id": "<your native thread id>", "sha": "${head}", "verdict": "SHIP|REVERT|SPLIT", "blockers": [], "tickets": ["<follow-up links>"], "report_url": "<link to your verdict>"}\n\`\`\``,
    submit("verdict"),
  ].join("\n\n");
}

// ---- native boundary: gh for reads and writes, git for patch-ids ----

export type Gh = {
  pullRequest(repo: string, n: number): Promise<{ author: string; baseRef: string | null }>;
  listComments(repo: string, n: number): Promise<Comment[]>;
  postComment(repo: string, n: number, body: string): Promise<number>;
};

async function runCmd(cmd: string[], stdin?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${cmd[0]} exited ${code}: ${err.trim()}`);
  return out;
}

export function ghBoundary(bin: string): Gh {
  return {
    async pullRequest(repo, n) {
      const pr = JSON.parse(await runCmd([bin, "api", `repos/${repo}/pulls/${n}`, "--jq", "{author: .user.login, baseRef: .base.ref}"]));
      if (typeof pr.author !== "string" || !/^[a-z0-9][a-z0-9-]*$/i.test(pr.author)) throw new LedgerError("PR author is unknown");
      return pr;
    },
    async listComments(repo, n) {
      const out = await runCmd([bin, "api", "--paginate", `repos/${repo}/issues/${n}/comments`, "--jq", ".[] | [.id, .body, .user.login] | @json"]);
      return out.split("\n").filter((l) => l.trim() !== "").map((l) => {
        const [id, body, author] = JSON.parse(l);
        return { id, body, author };
      });
    },
    async postComment(repo, n, body) {
      const out = await runCmd([bin, "api", "-X", "POST", `repos/${repo}/issues/${n}/comments`, "--input", "-"], JSON.stringify({ body }));
      const id = JSON.parse(out).id;
      if (!Number.isInteger(id)) throw new Error("gh did not return a comment id");
      return id;
    },
  };
}

export async function patchId(base: string, sha: string): Promise<string> {
  const out = await runCmd(["sh", "-c", `git diff '${base}...${sha}' | git patch-id --stable`]);
  const id = out.trim().split(/\s+/)[0] ?? "";
  if (id === "") throw new Error(`no patch-id for ${base}...${sha}`);
  return id;
}

// A ref the reader can name, resolved to the full commit SHA recorded in the ledger.
export async function commitOf(ref: string): Promise<string> {
  try {
    return (await runCmd(["git", "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
  } catch {
    throw new Refused(`${ref} is not a commit in this checkout; fetch it first`);
  }
}

// ---- command line ----

const HELP = `ship-loop: the one entry point for a PR's review-round state. Only the PR author's comments can write the ledger; other commenters' markers are ignored.

  init    --pr <url> --ticket <url> --rigor light|standard|critical --rigor-reason <text> --base <ref> --sha <head> --builder-thread <id>
          Creates the ledger once. On an existing ledger it resumes and never resets.
  status  --pr <url> [--json]
          --json prints the stable ${STATUS_SCHEMA} document: phase, fix_round, review_thread_ids, review_thread_count, source_head.
  prompt  --pr <url> --role qa|review|qa-review|judge|recheck|final-judge|fix-builder
          Prints the role's brief for the current phase. Refuses a role out of phase.
  record  --pr <url> --kind report|verdict|recheck|head [--file <payload.json>]
          Payload JSON comes from --file or stdin. Records only what the user supplied: native thread IDs and report links.
          A repeated identical write is a no-op.
          head payloads, run inside a checkout holding every named commit:
            {"reason":"fix","sha":<new head>,"thread_id":<builder thread>}   after a judge's FIX
            {"reason":"carry","from":<judged head>,"from_base":<its base>,"sha":<new head>,"to_base":<its base>}
              judge, final-judge or shipped; carries only if both stable patch-ids match
              from_base must resolve to the ledger's recorded base; to_base must resolve to origin/<GitHub PR base ref>
              fetch origin first; retarget a stacked PR on GitHub before carrying onto its new target
            {"reason":"refresh","from":<head>,"sha":<new head>,"base":<its base>}   verify only, before any report
          Bases may be refs; the event records their full commit SHAs.

Exit codes: 0 recorded or already recorded; 1 refused by the workflow; 2 ledger unreadable or write outcome unknown (never treat as round 0); 3 lost a concurrent write, run status and retry.
`;

const COMMANDS: Record<string, string[]> = {
  init: ["pr", "ticket", "rigor", "rigor-reason", "base", "sha", "builder-thread"],
  status: ["pr", "json"],
  prompt: ["pr", "role"],
  record: ["pr", "kind", "file"],
};

export type Deps = {
  gh: Gh;
  commit: (ref: string) => Promise<string>;
  patchId: (base: string, sha: string) => Promise<string>;
  out: (s: string) => void;
  err: (s: string) => void;
  stdin: () => Promise<string>;
};

export async function run(argv: string[], deps: Deps): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") { deps.out(HELP); return 0; }
  if (!Object.hasOwn(COMMANDS, cmd)) { deps.err(`unknown command: ${cmd}\n\n${HELP}`); return 1; }
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i];
    if (!name.startsWith("--")) { deps.err(`unexpected argument: ${name}\n`); return 1; }
    const key = name.slice(2);
    if (!COMMANDS[cmd].includes(key)) { deps.err(`unknown flag for ${cmd}: ${name}\n`); return 1; }
    if (key === "json") { flags[key] = true; continue; }
    const value = rest[++i];
    if (value === undefined) { deps.err(`${name} needs a value\n`); return 1; }
    flags[key] = value;
  }
  try {
    return await dispatch(cmd, flags, deps);
  } catch (err) {
    if (err instanceof Refused) { deps.err(`refused: ${err.message}\n`); return 1; }
    if (err instanceof LedgerError) { deps.err(`ledger unknown: ${err.message}. Not treated as a fresh round; repair or inspect the PR comments.\n`); return 2; }
    deps.err(`ledger unknown: ${(err as Error).message}\n`);
    return 2;
  }
}

function target(pr: unknown): { url: string; repo: string; n: number } {
  const m = typeof pr === "string" ? /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/.exec(pr) : null;
  if (!m) throw new Refused("--pr must be a GitHub pull request URL");
  return { url: pr as string, repo: m[1], n: Number(m[2]) };
}

async function dispatch(cmd: string, f: Record<string, string | true>, d: Deps): Promise<number> {
  const { url, repo, n } = target(f.pr);
  // Any read failure throws before a write can be attempted.
  const pr = await d.gh.pullRequest(repo, n);
  const writer = pr.author;
  const comments = await d.gh.listComments(repo, n);
  const ledger = replay(comments, writer);

  if (cmd === "status") {
    const doc = statusOf(ledger, url);
    if (f.json) d.out(JSON.stringify(doc, null, 2) + "\n");
    else d.out(ledger.state ? `${doc.phase} at ${doc.source_head}; fix round ${doc.fix_round}/${FIX_ROUND_LIMIT}; ${doc.review_thread_count} review thread(s)\n` : `no ship-loop ledger on ${url}\n`);
    return 0;
  }

  if (cmd === "prompt") {
    need(ledger.state, "no ledger yet: run init after the builder opens the PR");
    d.out(prompt(ledger.state, url, String(f.role) as PromptRole) + "\n");
    return 0;
  }

  if (cmd === "init") {
    const body = {
      v: 1, kind: "init", ticket: f.ticket, pr_url: url, rigor: f.rigor, rigor_reason: f["rigor-reason"],
      base: f.base, sha: f.sha, builder_thread_id: f["builder-thread"],
    };
    if (ledger.state) {
      need(ledger.state.ticket === f.ticket && ledger.state.pr_url === url, "the ledger belongs to another ticket or PR");
      d.out(`resumed: ledger exists at seq ${ledger.last_seq}; phase ${ledger.state.phase}; no reset\n`);
      return 0;
    }
    return await write(ledger, repo, n, writer, body, d);
  }

  // record
  need(ledger.state, "no ledger yet: run init first");
  const raw = typeof f.file === "string" ? await Bun.file(f.file).text() : await d.stdin();
  let payload: Record<string, any>;
  try { payload = JSON.parse(raw); } catch { throw new Refused("payload is not JSON"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Refused("payload must be an object");
  const kind = String(f.kind);
  if (!["report", "verdict", "recheck", "head"].includes(kind)) throw new Refused("kind must be report, verdict, recheck or head");
  // The flag sets the kind; a payload cannot override it.
  const body: Record<string, unknown> = { ...payload, v: 1, kind };
  // Each named revision must exist here; bases are recorded as the full SHAs the helper resolved.
  const commit = async (ref: unknown, field: string) => {
    need(typeof ref === "string" && ref.trim() !== "", `${field} is required`);
    return await d.commit(ref);
  };
  const exact = async (sha: unknown, field: string) => {
    need(/^[0-9a-f]{40}$/.test(String(sha)) && (await commit(sha, field)) === sha, `${field} must be the full SHA of a commit in this checkout`);
    return sha as string;
  };
  if (kind === "head" && payload.reason === "carry") {
    const [from, sha] = [await exact(payload.from, "from"), await exact(payload.sha, "sha")];
    body.from_base = await commit(payload.from_base, "from_base");
    body.to_base = await commit(payload.to_base, "to_base");
    // An exact accepted carry is still a no-op after it has moved the ledger's base.
    const retry = ledger.accepted.find(({ event }) => event.kind === "head" && event.reason === "carry" &&
      keyOf({ ...body, patch_id_from: event.patch_id_from, patch_id_to: event.patch_id_to }) === event.key);
    if (retry) return await write(ledger, repo, n, writer, {
      ...body, patch_id_from: retry.event.patch_id_from, patch_id_to: retry.event.patch_id_to,
    }, d);
    const recordedBase = await commit(ledger.state.base, "recorded base");
    need(body.from_base === recordedBase, "from_base must resolve to the ledger's recorded base");
    need(typeof pr.baseRef === "string" && pr.baseRef !== "", "GitHub PR base ref is unknown");
    const targetBase = await commit(`origin/${pr.baseRef}`, "PR target base");
    need(body.to_base === targetBase, `to_base must resolve to the PR target origin/${pr.baseRef}; retarget the PR on GitHub before carrying`);
    body.patch_id_from = await d.patchId(recordedBase, from);
    body.patch_id_to = await d.patchId(targetBase, sha);
  }
  if (kind === "head" && payload.reason === "refresh") {
    await exact(payload.sha, "sha");
    body.base = await commit(payload.base, "base");
  }
  return await write(ledger, repo, n, writer, body, d);
}

// Idempotent append: an identical accepted event is a no-op; otherwise validate, post, then read back.
async function write(ledger: Ledger, repo: string, n: number, writer: string, body: Record<string, unknown>, d: Deps): Promise<number> {
  const key = keyOf(body);
  const seen = ledger.accepted.find((a) => a.event.key === key);
  if (seen) { d.out(`already recorded at seq ${seen.event.seq}\n`); return 0; }
  const seq = ledger.last_seq + 1;
  const event = { ...body, seq, key } as Event;
  apply(ledger.state, event);
  let id: number;
  try {
    id = await d.gh.postComment(repo, n, renderEvent(event));
  } catch (err) {
    // The write may have landed. Read back before deciding: rerunning is safe because identical events are no-ops.
    const after = replay(await d.gh.listComments(repo, n), writer);
    if (after.accepted.some((a) => a.event.key === key)) { d.out(`recorded at seq ${seq} (confirmed after a failed response)\n`); return 0; }
    throw new Error(`write outcome unknown: ${(err as Error).message}`);
  }
  const after = replay(await d.gh.listComments(repo, n), writer);
  if (after.accepted.some((a) => a.id === id)) { d.out(`recorded at seq ${seq}\n`); return 0; }
  if (after.rejected.includes(id)) {
    d.err(`lost a concurrent write at seq ${seq}; nothing recorded. Run status and retry.\n`);
    return 3;
  }
  throw new Error(`comment ${id} is not in the ledger after write`);
}

if (import.meta.main) {
  const ghBin = process.env.SHIP_LOOP_GH ?? "gh";
  const code = await run(process.argv.slice(2), {
    gh: ghBoundary(ghBin),
    commit: commitOf,
    patchId,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    stdin: () => Bun.stdin.text(),
  });
  process.exit(code);
}
