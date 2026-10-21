import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { apply, keyOf, prompt, renderEvent, replay, statusOf, type Comment, type Event, type State } from "./ship-loop.ts";

const CLI = join(import.meta.dir, "ship-loop.ts");
const FAKE_GH = join(import.meta.dir, "fake-gh.ts");
const PR = "https://github.com/misty-step/example/pull/7";
const TICKET = "https://github.com/misty-step/example/issues/3";
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const BASE = "origin/master";

function scratch(): string {
  const root = join(homedir(), ".cache", "tmp");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "ship-loop-test-"));
}

type Harness = { dir: string; store: string };

function harness(comments: Comment[] = []): Harness {
  const dir = scratch();
  const store = join(dir, "store.json");
  writeFileSync(store, JSON.stringify({ comments, next: comments.length + 100 }));
  return { dir, store };
}

function comments(h: Harness): Comment[] {
  return JSON.parse(readFileSync(h.store, "utf8")).comments;
}

async function cli(h: Harness, args: string[], payload?: unknown, env: Record<string, string> = {}) {
  let file: string | undefined;
  if (payload !== undefined) {
    file = join(h.dir, `payload-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, typeof payload === "string" ? payload : JSON.stringify(payload));
  }
  const proc = Bun.spawn(["bun", CLI, ...args, ...(file ? ["--file", file] : [])], {
    env: { ...process.env, SHIP_LOOP_GH: FAKE_GH, SHIP_LOOP_FAKE_STORE: h.store, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

const finding = (id: string, over: Record<string, unknown> = {}) => ({
  id, evidence: `evidence for ${id}`, introduced_by_diff: true, already_on_main: false, blocker_class: "broken_journey", ...over,
});

async function initPr(h: Harness) {
  return cli(h, ["init", "--pr", PR, "--ticket", TICKET, "--rigor", "standard", "--rigor-reason", "runtime change", "--base", BASE, "--sha", H1, "--builder-thread", "builder-1"]);
}

async function reportQa(h: Harness, findings: unknown[] = [], outcome = "ISSUES") {
  return cli(h, ["record", "--pr", PR, "--kind", "report"], {
    role: "qa", sha: H1, thread_id: "qa-1", report_url: "https://github.com/misty-step/example/pull/7#issuecomment-1", outcome, findings,
  });
}

async function reportReview(h: Harness, findings: unknown[] = []) {
  return cli(h, ["record", "--pr", PR, "--kind", "report"], {
    role: "review", sha: H1, thread_id: "review-1", report_url: "https://github.com/misty-step/example/pull/7#issuecomment-2", outcome: "ISSUES", findings,
  });
}

function status(h: Harness) {
  return cli(h, ["status", "--pr", PR, "--json"]).then((r) => ({ ...r, doc: JSON.parse(r.out) }));
}

test("init writes one ledger and status exposes phase, fix round, review threads and head", async () => {
  const h = harness();
  expect((await initPr(h)).code).toBe(0);
  const s = await status(h);
  expect(s.code).toBe(0);
  expect(s.doc.schema).toBe("ship-loop.status.v1");
  expect(s.doc.phase).toBe("verify");
  expect(s.doc.fix_round).toBe(0);
  expect(s.doc.review_thread_count).toBe(0);
  expect(s.doc.review_thread_ids).toEqual([]);
  expect(s.doc.source_head).toBe(H1);
});

test("init on an existing ledger resumes and never resets the round", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1")]);
  await reportReview(h);
  const judged = await cli(h, ["record", "--pr", PR, "--kind", "verdict"], {
    thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: ["qa:F1"], report_url: "https://github.com/misty-step/example/pull/7#issuecomment-3",
  });
  expect(judged.code).toBe(0);
  const before = comments(h).length;
  const resumed = await cli(h, ["init", "--pr", PR, "--ticket", TICKET, "--rigor", "standard", "--rigor-reason", "new thread", "--base", BASE, "--sha", H2, "--builder-thread", "builder-9"]);
  expect(resumed.code).toBe(0);
  expect(resumed.out).toContain("no reset");
  expect(comments(h).length).toBe(before);
  const s = await status(h);
  expect(s.doc.fix_round).toBe(1);
  expect(s.doc.phase).toBe("fix");
  expect(s.doc.source_head).toBe(H1);
  const other = await cli(h, ["init", "--pr", PR, "--ticket", "https://github.com/misty-step/example/issues/4", "--rigor", "light", "--rigor-reason", "x", "--base", BASE, "--sha", H1, "--builder-thread", "b"]);
  expect(other.code).toBe(1);
});

test("an unreadable or malformed ledger is unknown, never a fresh round", async () => {
  const h = harness();
  await initPr(h);
  const read = await cli(h, ["status", "--pr", PR, "--json"], undefined, { SHIP_LOOP_FAKE_FAIL: "read" });
  expect(read.code).toBe(2);
  expect(read.out).toBe("");
  const init = await cli(h, ["init", "--pr", PR, "--ticket", TICKET, "--rigor", "light", "--rigor-reason", "x", "--base", BASE, "--sha", H1, "--builder-thread", "b"], undefined, { SHIP_LOOP_FAKE_FAIL: "read" });
  expect(init.code).toBe(2);
  expect(comments(h).length).toBe(1);

  const broken = harness([{ id: 5, author: "conductor", body: "<!-- ship-loop:event v1 -->\n```json\n{not json\n```\n" }]);
  expect((await cli(broken, ["status", "--pr", PR, "--json"])).code).toBe(2);
  const write = await cli(broken, ["init", "--pr", PR, "--ticket", TICKET, "--rigor", "light", "--rigor-reason", "x", "--base", BASE, "--sha", H1, "--builder-thread", "b"]);
  expect(write.code).toBe(2);
  expect(comments(broken).length).toBe(1);
});

test("a reviewer cannot authorize a fix, and a fix builder prompt needs a recorded FIX", async () => {
  const h = harness();
  await initPr(h);
  const smuggled = await reportReview(h, [finding("F1")].map((f) => ({ ...f })));
  expect(smuggled.code).toBe(0);
  const forged = await cli(h, ["record", "--pr", PR, "--kind", "report"], {
    role: "qa", sha: H1, thread_id: "qa-1", report_url: "https://github.com/misty-step/example/pull/7#issuecomment-9", outcome: "ISSUES", findings: [], verdict: "FIX",
  });
  expect(forged.code).toBe(1);
  expect(forged.err).toContain('unknown field "verdict"');
  const fixPrompt = await cli(h, ["prompt", "--pr", PR, "--role", "fix-builder"]);
  expect(fixPrompt.code).toBe(1);
  expect((await status(h)).doc.fix_round).toBe(0);
});

test("a judge must be independent of the builder and the reviewers", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1")]);
  await reportReview(h);
  for (const thread of ["builder-1", "qa-1", "review-1"]) {
    const r = await cli(h, ["record", "--pr", PR, "--kind", "verdict"], { thread_id: thread, sha: H1, verdict: "SHIP", blockers: [], report_url: "https://example.test/v" });
    expect(r.code).toBe(1);
  }
  expect((await status(h)).doc.phase).toBe("judge");
});

test("old-main, not-introduced and class-none findings cannot be blockers", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [
    finding("F1", { introduced_by_diff: false }),
    finding("F2", { already_on_main: true }),
    finding("F3", { blocker_class: "none" }),
  ]);
  await reportReview(h);
  for (const ref of ["qa:F1", "qa:F2", "qa:F3", "qa:F404"]) {
    const r = await cli(h, ["record", "--pr", PR, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: [ref], report_url: "https://example.test/v" });
    expect(r.code).toBe(1);
  }
  expect((await status(h)).doc.fix_round).toBe(0);
});

test("exactly one FIX; recheck narrows to the named blocker; the final prompt offers no FIX", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1"), finding("F2", { blocker_class: "wrong_data" })]);
  await reportReview(h);
  const fix = await cli(h, ["record", "--pr", PR, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: ["qa:F1"], report_url: "https://example.test/v1" });
  expect(fix.code).toBe(0);
  expect((await status(h)).doc.fix_blockers).toEqual(["qa:F1"]);

  const builderPrompt = await cli(h, ["prompt", "--pr", PR, "--role", "fix-builder"]);
  expect(builderPrompt.out).toContain("`qa:F1`");
  expect(builderPrompt.out).not.toContain("qa:F2");

  const again = await cli(h, ["record", "--pr", PR, "--kind", "verdict"], { thread_id: "judge-2", sha: H1, verdict: "FIX", blockers: ["qa:F2"], report_url: "https://example.test/v2" });
  expect(again.code).toBe(1);

  const fixed = await cli(h, ["record", "--pr", PR, "--kind", "head"], { reason: "fix", sha: H2, thread_id: "builder-2" });
  expect(fixed.code).toBe(0);
  expect((await status(h)).doc.phase).toBe("recheck");

  const wrongThread = await cli(h, ["record", "--pr", PR, "--kind", "recheck"], { thread_id: "qa-recheck-1", reporter_thread_id: "review-1", sha: H2, report_url: "https://example.test/r", regressions: [], results: [{ blocker: "qa:F1", status: "fixed", evidence: "https://example.test/fixed" }] });
  expect(wrongThread.code).toBe(1);
  const extra = await cli(h, ["record", "--pr", PR, "--kind", "recheck"], { thread_id: "qa-recheck-1", reporter_thread_id: "qa-1", sha: H2, report_url: "https://example.test/r", regressions: [], results: [{ blocker: "qa:F1", status: "fixed", evidence: "https://example.test/fixed" }, { blocker: "qa:F2", status: "fixed", evidence: "https://example.test/fixed" }] });
  expect(extra.code).toBe(1);

  const recheck = await cli(h, ["record", "--pr", PR, "--kind", "recheck"], { thread_id: "qa-recheck-1", reporter_thread_id: "qa-1", sha: H2, report_url: "https://example.test/r", regressions: [], results: [{ blocker: "qa:F1", status: "fixed", evidence: "https://example.test/fixed" }] });
  expect(recheck.code).toBe(0);
  const finalPrompt = await cli(h, ["prompt", "--pr", PR, "--role", "final-judge"]);
  expect(finalPrompt.code).toBe(0);
  expect(finalPrompt.out).not.toMatch(/\bFIX\b/);

  const secondFix = await cli(h, ["record", "--pr", PR, "--kind", "verdict"], { thread_id: "judge-2", sha: H2, verdict: "FIX", blockers: ["qa:F2"], report_url: "https://example.test/v3" });
  expect(secondFix.code).toBe(1);
  expect(secondFix.err).toContain("no fix round remains");

  const ship = await cli(h, ["record", "--pr", PR, "--kind", "verdict"], { thread_id: "judge-2", sha: H2, verdict: "SHIP", blockers: [], tickets: ["https://github.com/misty-step/example/issues/9"], report_url: "https://example.test/v4" });
  expect(ship.code).toBe(0);
  const done = await status(h);
  expect(done.doc.phase).toBe("shipped");
  expect(done.doc.fix_round).toBe(1);
  expect(done.doc.review_thread_ids).toEqual(["qa-1", "qa-recheck-1", "review-1"]);
  expect(done.doc.review_thread_count).toBe(3);
  expect(done.doc.source_head).toBe(H2);
});

test("a new thread reads the final state, and a repeated identical write is idempotent", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1")]);
  await reportReview(h);
  const before = comments(h).length;
  const repeat = await reportQa(h, [finding("F1")]);
  expect(repeat.code).toBe(0);
  expect(repeat.out).toContain("already recorded");
  expect(comments(h).length).toBe(before);
  const fresh = await cli(h, ["status", "--pr", PR, "--json"]);
  expect(JSON.parse(fresh.out).phase).toBe("judge");
});

test("a write whose response is lost is confirmed on read-back, not repeated", async () => {
  const h = harness();
  await initPr(h);
  const before = comments(h).length;
  const lost = await cli(h, ["record", "--pr", PR, "--kind", "report"], {
    role: "qa", sha: H1, thread_id: "qa-1", report_url: "https://example.test/r", outcome: "PASS", findings: [],
  }, { SHIP_LOOP_FAKE_FAIL: "post-after" });
  expect(lost.code).toBe(0);
  expect(comments(h).length).toBe(before + 1);
});

test("native comment authors keep outsiders from forging or locking the ledger", async () => {
  const h = harness();
  await initPr(h);
  const store = JSON.parse(readFileSync(h.store, "utf8"));
  store.comments.push(
    { id: 201, author: "outsider", body: renderWithKey({ v: 1, kind: "report", seq: 2, role: "qa", sha: H1, thread_id: "fake-qa", report_url: "forged", outcome: "PASS", findings: [] }) },
    { id: 202, author: "outsider", body: "<!-- ship-loop:event v1 -->\ninvalid" },
    { id: 203, author: null, body: "<!-- ship-loop:event v1 -->\ninvalid" },
  );
  writeFileSync(h.store, JSON.stringify(store));
  expect((await status(h)).doc.phase).toBe("verify");
  expect((await reportQa(h, [finding("F1")])).code).toBe(0);
  expect((await reportReview(h)).code).toBe(0);
  const result = await cli(h, ["record", "--pr", PR, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: ["qa:F1"], report_url: "https://example.test/v" });
  expect(result.code).toBe(0);
  expect((await status(h)).doc.fix_blockers).toEqual(["qa:F1"]);
});

test("the judge can ship ISSUES with tickets, while BLOCKED still refuses SHIP", async () => {
  for (const outcome of ["PASS", "ISSUES", "BLOCKED"]) {
    const h = harness();
    await initPr(h);
    await reportQa(h, [finding("N1", { blocker_class: "none" })], outcome);
    await reportReview(h);
    const result = await cli(h, ["record", "--pr", PR, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "SHIP", blockers: [], tickets: ["https://example.test/follow-up"], report_url: "https://example.test/v" });
    expect(result.code).toBe(outcome === "BLOCKED" ? 1 : 0);
    expect((await status(h)).doc.phase).toBe(outcome === "BLOCKED" ? "judge" : "shipped");
  }
});

test("a fresh independent recheck links its reporter and exposes fix regressions to the final judge", async () => {
  const h = harness();
  await initPr(h);
  await reportQa(h, [finding("F1")]);
  await reportReview(h);
  await cli(h, ["record", "--pr", PR, "--kind", "verdict"], { thread_id: "judge-1", sha: H1, verdict: "FIX", blockers: ["qa:F1"], report_url: "https://example.test/v" });
  await cli(h, ["record", "--pr", PR, "--kind", "head"], { reason: "fix", sha: H2, thread_id: "builder-2" });
  const payload = { thread_id: "qa-recheck-1", reporter_thread_id: "qa-1", sha: H2, report_url: "https://example.test/recheck", results: [{ blocker: "qa:F1", status: "fixed", evidence: "https://example.test/fixed" }], regressions: [finding("R1", { evidence: "fix broke the build", blocker_class: "broken_build" })] };
  for (const thread_id of ["qa-1", "review-1", "judge-1", "builder-1", "builder-2"]) {
    expect((await cli(h, ["record", "--pr", PR, "--kind", "recheck"], { ...payload, thread_id })).code).toBe(1);
  }
  expect((await cli(h, ["record", "--pr", PR, "--kind", "recheck"], { ...payload, regressions: [finding("R1", { already_on_main: true })] })).code).toBe(1);
  expect((await cli(h, ["record", "--pr", PR, "--kind", "recheck"], payload)).code).toBe(0);
  const final = await cli(h, ["prompt", "--pr", PR, "--role", "final-judge"]);
  expect(final.code).toBe(0);
  expect(final.out).toContain("fix broke the build");
  expect(final.out).toContain("https://example.test/recheck");
  expect(final.out).toContain("REVERT or SPLIT");
  expect(final.out).not.toMatch(/\bFIX\b/);
  const result = await cli(h, ["record", "--pr", PR, "--kind", "verdict"], { thread_id: "judge-2", sha: H2, verdict: "SPLIT", blockers: [], report_url: "https://example.test/final" });
  expect(result.code).toBe(0);
  expect((await status(h)).doc.recheck.regressions[0].id).toBe("R1");
  expect((await status(h)).doc.phase).toBe("revert-split");
});

test("a light rigor PR takes one combined review and a standard PR refuses it", async () => {
  const light = harness();
  await cli(light, ["init", "--pr", PR, "--ticket", TICKET, "--rigor", "light", "--rigor-reason", "docs", "--base", BASE, "--sha", H1, "--builder-thread", "b"]);
  expect((await cli(light, ["prompt", "--pr", PR, "--role", "qa-review"])).code).toBe(0);
  expect((await cli(light, ["prompt", "--pr", PR, "--role", "qa"])).code).toBe(1);
});

test("replay keeps the lowest-id write for a sequence number and rejects a gap", () => {
  const init = (seq: number) => ({ v: 1, kind: "init", seq, key: "", ticket: TICKET, pr_url: PR, rigor: "light", rigor_reason: "docs", base: BASE, sha: H1, builder_thread_id: "b" });
  const first = JSON.parse(JSON.stringify(init(1)));
  const ledger = replay([{ id: 1, author: "conductor", body: renderWithKey(first) }], "conductor");
  expect(ledger.state?.phase).toBe("verify");
  const lostSeq2 = renderWithKey({ v: 1, kind: "report", seq: 2, role: "qa-review", sha: H1, thread_id: "x", report_url: "u", outcome: "PASS", findings: [] });
  const wonSeq2 = renderWithKey({ v: 1, kind: "report", seq: 2, role: "qa-review", sha: H1, thread_id: "qa-1", report_url: "u", outcome: "PASS", findings: [] });
  const dup = replay([{ id: 1, author: "conductor", body: renderWithKey(first) }, { id: 5, author: "conductor", body: wonSeq2 }, { id: 6, author: "conductor", body: lostSeq2 }], "conductor");
  expect(dup.last_seq).toBe(2);
  expect(dup.rejected).toEqual([6]);
  expect(dup.state?.phase).toBe("judge");
  expect(() => replay([{ id: 1, author: "conductor", body: renderWithKey(first) }, { id: 9, author: "conductor", body: renderWithKey({ v: 1, kind: "report", seq: 3, role: "qa-review", sha: H1, thread_id: "q", report_url: "u", outcome: "PASS", findings: [] }) }], "conductor")).toThrow(/gap/);
});

test("a carry needs an unchanged patch-id, and only moves head before the ruling", () => {
  const judged: State = {
    ticket: TICKET, pr_url: PR, rigor: "light", rigor_reason: "docs", base: BASE, head: H1, carried: [], phase: "judge",
    builder_threads: ["b"], judge_threads: [], reports: {}, recheck: null, fix_round: 0, fix: null, verdict: null,
  };
  const carry = (patchFrom: string, patchTo: string): Event => ({ v: 1, kind: "head", seq: 3, key: "", reason: "carry", from: H1, sha: H2, patch_id_from: patchFrom, patch_id_to: patchTo });
  expect(() => apply(judged, carry("p1", "p2"))).toThrow(/unchanged patch-id/);
  const moved = apply(judged, carry("p1", "p1"));
  expect(moved.head).toBe(H2);
  expect(moved.carried).toEqual([H1]);
  expect(moved.phase).toBe("judge");
  expect(() => apply({ ...judged, phase: "verify" }, carry("p1", "p1"))).toThrow(/before a ruling/);
});

test("statusOf reports a missing ledger as absent, not as a round", () => {
  const doc = statusOf({ state: null, last_seq: 0, accepted: [], rejected: [] }, PR);
  expect(doc.ledger).toBe("absent");
  expect(doc.phase).toBeNull();
  expect(doc.fix_round).toBe(0);
});

test("prompts name only the current phase's role and carry the head", () => {
  const s: State = {
    ticket: TICKET, pr_url: PR, rigor: "standard", rigor_reason: "runtime", base: BASE, head: H1, carried: [], phase: "verify",
    builder_threads: ["b"], judge_threads: [], reports: {}, recheck: null, fix_round: 0, fix: null, verdict: null,
  };
  expect(prompt(s, PR, "qa")).toContain(H1);
  expect(() => prompt(s, PR, "judge")).toThrow(/runs in phase judge/);
  expect(prompt(s, PR, "review")).toContain("independent code reviewer");
});

// Render an event exactly as the CLI would: its content key covers everything except seq.
function renderWithKey(body: Record<string, unknown>): string {
  const { seq, key: _key, ...rest } = body;
  return renderEvent({ ...rest, seq, key: keyOf(rest) } as Event);
}
