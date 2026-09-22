import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join, posix } from "node:path";
import type {
  EvidenceAnchor,
  SemanticCandidate,
  TestEvidenceCandidate,
} from "./semantic-quality.ts";
import { isCredentialPath } from "./review.ts";

const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|(?:\.(?:test|spec))\.[^.\/]+$/i;
const MAX_ANCHOR_BYTES = 40_000;
const ANCHOR_CONTEXT_LINES = 8;
const MAX_ANCHOR_LINES = 160;
const ZERO_OID = /^0+$/;

export const SEMANTIC_EXTRACTION_VERSION = "semantic-quality-extraction/v1" as const;

export type SemanticSnapshot = {
  kind: "staged_tree" | "worktree_tree" | "outgoing_ref";
  tree: string;
  base?: string;
  ref?: string;
};

export type SemanticGitInput = {
  snapshot: SemanticSnapshot;
  candidates: SemanticCandidate[];
  changedPaths: string[];
  abstentions: Array<{ scope: string; reason: string }>;
  /** Includes both sides when a rename crosses a credential-classified path. */
  excludedPaths?: string[];
};

type GitResult = {
  stdout: Buffer;
  stderr: string;
  status: number;
};

function git(repo: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): GitResult {
  const result = spawnSync("git", args, {
    cwd: repo,
    env: { ...process.env, ...extraEnv },
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8").trim(),
    status: result.status ?? 1,
  };
}

function requireGit(repo: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Buffer {
  const result = git(repo, args, extraEnv);
  if (result.status !== 0) {
    throw new Error(`git ${args[0] ?? "command"} failed: ${result.stderr || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function objectExists(repo: string, object: string): boolean {
  return git(repo, ["cat-file", "-e", object]).status === 0;
}

function emptyTree(repo: string): string {
  return requireGit(repo, ["hash-object", "-t", "tree", "/dev/null"]).toString("utf8").trim();
}

function headTree(repo: string): string {
  return objectExists(repo, "HEAD^{tree}")
    ? requireGit(repo, ["rev-parse", "HEAD^{tree}"]).toString("utf8").trim()
    : emptyTree(repo);
}

function changedPaths(repo: string, baseTree: string, targetTree: string): string[] {
  const output = requireGit(repo, [
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
    baseTree,
    targetTree,
    "--",
  ]).toString("utf8");
  return output.split("\0").filter(Boolean);
}

function excludedPathsFromNameStatus(output: string): Set<string> {
  const tokens = output.split("\0").filter(Boolean);
  const excluded = new Set<string>();
  const addedPaths: string[] = [];
  let deletedCredentialPath = false;
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++]!;
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const source = tokens[index++];
      const target = tokens[index++];
      if (source && target && (isCredentialPath(source) || isCredentialPath(target))) {
        excluded.add(source);
        excluded.add(target);
      }
      continue;
    }
    const path = tokens[index++];
    if (!path) continue;
    if (kind === "A") addedPaths.push(path);
    if (kind === "D" && isCredentialPath(path)) deletedCredentialPath = true;
    if (isCredentialPath(path)) excluded.add(path);
  }
  // Git similarity detection is heuristic. A heavily rewritten credential rename
  // appears as a credential deletion plus an innocent-looking addition. In that
  // ambiguous shape, fail closed for every addition rather than send moved secret
  // material under a new path.
  if (deletedCredentialPath) {
    for (const path of addedPaths) excluded.add(path);
  }
  return excluded;
}

function excludedPathsForDiff(repo: string, baseTree: string, targetTree: string): Set<string> {
  const result = git(repo, ["diff", "--name-status", "-z", "-M", baseTree, targetTree, "--"]);
  return result.status === 0
    ? excludedPathsFromNameStatus(result.stdout.toString("utf8"))
    : new Set();
}

function worktreePaths(repo: string): string[] {
  return requireGit(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function worktreeExcludedPaths(repo: string, paths: string[]): Set<string> {
  const excluded = new Set(paths.filter(isCredentialPath));
  if (!objectExists(repo, "HEAD^{tree}")) return excluded;
  const renames = git(repo, ["diff", "--name-status", "-z", "-M", "HEAD", "--"]);
  if (renames.status === 0) {
    for (const path of excludedPathsFromNameStatus(renames.stdout.toString("utf8"))) {
      excluded.add(path);
    }
  }
  return excluded;
}

function stageWorktreePaths(
  repo: string,
  paths: string[],
  excludedPaths: ReadonlySet<string>,
  environment: NodeJS.ProcessEnv,
): void {
  const safePaths = paths.filter((path) => !isCredentialPath(path) && !excludedPaths.has(path));
  for (let index = 0; index < safePaths.length; index += 128) {
    requireGit(repo, ["add", "-A", "--", ...safePaths.slice(index, index + 128)], environment);
  }
}

type TreePathRead =
  | { status: "ok"; content: string }
  | { status: "excluded" | "missing" | "too_large" };

function readTreePathResult(
  repo: string,
  tree: string,
  path: string,
  excludedPaths: ReadonlySet<string> = new Set(),
): TreePathRead {
  if (isCredentialPath(path) || excludedPaths.has(path)) return { status: "excluded" };
  const result = git(repo, ["show", `${tree}:${path}`]);
  if (result.status !== 0) return { status: "missing" };
  if (result.stdout.length > MAX_ANCHOR_BYTES) return { status: "too_large" };
  return { status: "ok", content: result.stdout.toString("utf8") };
}

function readTreePath(
  repo: string,
  tree: string,
  path: string,
  excludedPaths: ReadonlySet<string> = new Set(),
): string | undefined {
  const result = readTreePathResult(repo, tree, path, excludedPaths);
  return result.status === "ok" ? result.content : undefined;
}

function anchor(path: string, content: string): EvidenceAnchor {
  const lines = content.length === 0 ? 1 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  return { path, startLine: 1, endLine: Math.max(1, lines), content };
}

function contentLines(content: string): string[] {
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines.length > 0 ? lines : [""];
}

function anchoredWindow(
  path: string,
  content: string,
  startLine: number,
  endLine: number,
): EvidenceAnchor {
  const lines = contentLines(content);
  const start = Math.max(1, Math.min(startLine, lines.length));
  const end = Math.max(start, Math.min(endLine, lines.length));
  return {
    path,
    startLine: start,
    endLine: end,
    content: lines.slice(start - 1, end).join("\n"),
    ...(start > 1 || end < lines.length ? { truncated: true } : {}),
  };
}

function changedTestAnchors(
  repo: string,
  base: string,
  tree: string,
  path: string,
  content: string,
): EvidenceAnchor[] {
  const diff = git(repo, ["diff", "--unified=0", base, tree, "--", path]);
  if (diff.status !== 0) return [anchor(path, content)];
  const lineCount = contentLines(content).length;
  const windows: Array<{ start: number; end: number }> = [];
  for (const match of diff.stdout.toString("utf8").matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const changedStart = Number(match[1]);
    const changedCount = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isInteger(changedStart) || !Number.isInteger(changedCount) || changedCount <= 0) continue;
    let start = Math.max(1, changedStart - ANCHOR_CONTEXT_LINES);
    const changedEnd = changedStart + changedCount - 1;
    const end = Math.min(lineCount, changedEnd + ANCHOR_CONTEXT_LINES);
    while (end - start + 1 > MAX_ANCHOR_LINES) {
      windows.push({ start, end: start + MAX_ANCHOR_LINES - 1 });
      start += MAX_ANCHOR_LINES;
    }
    windows.push({ start, end });
  }
  if (windows.length === 0) return [anchor(path, content)];
  const merged: Array<{ start: number; end: number }> = [];
  for (const window of windows) {
    const previous = merged.at(-1);
    if (previous && window.start <= previous.end + 1 && window.end - previous.start + 1 <= MAX_ANCHOR_LINES) {
      previous.end = Math.max(previous.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }
  return merged.map((window) => anchoredWindow(path, content, window.start, window.end));
}

function inferTargetPath(testPath: string): string {
  return testPath.replace(/\.(?:test|spec)(?=\.[^.\/]+$)/i, "").replace(/(^|\/)tests\//i, "$1src/");
}

const TEST_HELPER_CALLS = new Set([
  "describe",
  "expect",
  "it",
  "require",
  "test",
]);

function selectTargetAnchor(path: string, content: string, testContent: string): EvidenceAnchor {
  const symbols = [...testContent.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
    .map((match) => match[1]!)
    .filter((symbol) => !TEST_HELPER_CALLS.has(symbol));
  const lines = contentLines(content);
  for (const symbol of symbols) {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declaration = new RegExp(`\\b(?:class|function|const|let|var)\\s+${escaped}\\b|\\b${escaped}\\s*[:=]`);
    const index = lines.findIndex((line) => declaration.test(line));
    if (index >= 0) {
      return anchoredWindow(path, content, index + 1 - 16, index + 1 + 16);
    }
  }
  return anchoredWindow(path, content, 1, Math.min(lines.length, MAX_ANCHOR_LINES));
}

function relativeImports(content: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /\bfrom\s+["'](\.[^"']+)["']/g,
    /\brequire\(\s*["'](\.[^"']+)["']\s*\)/g,
    /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) imports.add(match[1]);
    }
  }
  return [...imports];
}

function importedPathCandidates(importerPath: string, specifier: string): string[] {
  const base = posix.normalize(posix.join(posix.dirname(importerPath), specifier));
  if (base.startsWith("../") || base === "..") return [];
  const extension = posix.extname(base);
  return extension
    ? [base]
    : [base, ...[".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"].map((suffix) => `${base}${suffix}`), `${base}/index.ts`, `${base}/index.js`];
}

function resolveImportedAnchor(
  repo: string,
  tree: string,
  importerPath: string,
  specifier: string,
  excludedPaths: ReadonlySet<string>,
): EvidenceAnchor | undefined {
  for (const path of importedPathCandidates(importerPath, specifier)) {
    const content = readTreePath(repo, tree, path, excludedPaths);
    if (content !== undefined) return anchor(path, content);
  }
  return undefined;
}

function dependencyAnchors(
  repo: string,
  tree: string,
  testPath: string,
  testContent: string,
  targetPath: string,
  excludedPaths: ReadonlySet<string>,
): EvidenceAnchor[] {
  const anchors: EvidenceAnchor[] = [];
  for (const specifier of relativeImports(testContent)) {
    const dependency = resolveImportedAnchor(repo, tree, testPath, specifier, excludedPaths);
    if (dependency && dependency.path !== targetPath) anchors.push(dependency);
    if (anchors.length >= 8) break;
  }
  return anchors;
}

function firstContract(
  repo: string,
  tree: string,
  excludedPaths: ReadonlySet<string>,
): EvidenceAnchor | undefined {
  for (const path of ["USER_STORIES.md", "AGENTS.md", "README.md"]) {
    const content = readTreePath(repo, tree, path, excludedPaths);
    if (content !== undefined) return anchor(path, content);
  }
  return undefined;
}

type TestCandidateExtraction = {
  candidates: TestEvidenceCandidate[];
  abstentions: Array<{ scope: string; reason: string }>;
};

function contextReason(role: "test" | "target", status: Exclude<TreePathRead["status"], "ok">): string {
  return status === "missing" ? `missing_${role}_context` : `${role}_context_${status}`;
}

function testCandidates(
  repo: string,
  base: string,
  tree: string,
  paths: string[],
  excludedPaths: ReadonlySet<string>,
): TestCandidateExtraction {
  const contract = firstContract(repo, tree, excludedPaths);
  const candidates: TestEvidenceCandidate[] = [];
  const abstentions: Array<{ scope: string; reason: string }> = [];
  for (const path of paths.filter((candidatePath) => TEST_PATH.test(candidatePath))) {
    const testRead = readTreePathResult(repo, tree, path, excludedPaths);
    if (testRead.status !== "ok") {
      abstentions.push({ scope: path, reason: contextReason("test", testRead.status) });
      continue;
    }
    const testContent = testRead.content;
    const excludedDependency = relativeImports(testContent).some((specifier) =>
      importedPathCandidates(path, specifier).some((candidatePath) => excludedPaths.has(candidatePath)),
    );
    if (excludedDependency) {
      abstentions.push({ scope: path, reason: "dependency_context_excluded" });
      continue;
    }
    let targetPath = inferTargetPath(path);
    let targetRead: TreePathRead = targetPath === path
      ? { status: "missing" }
      : readTreePathResult(repo, tree, targetPath, excludedPaths);
    if (targetRead.status !== "ok") {
      const testBase = posix.basename(path).replace(/\.(?:test|spec)(?=\.[^.\/]+$)/i, "");
      const imported = relativeImports(testContent)
        .map((specifier) => resolveImportedAnchor(repo, tree, path, specifier, excludedPaths))
        .filter((candidate): candidate is EvidenceAnchor => candidate !== undefined && candidate.path !== path);
      const matching = imported.find((candidate) => posix.basename(candidate.path) === testBase);
      const fallback = matching ?? imported[0];
      if (fallback) {
        targetPath = fallback.path;
        targetRead = { status: "ok", content: fallback.content };
      }
    }
    if (targetRead.status !== "ok") {
      abstentions.push({ scope: path, reason: contextReason("target", targetRead.status) });
      continue;
    }
    const targetContent = targetRead.content;
    const targetAnchor = selectTargetAnchor(targetPath, targetContent, testContent);
    const dependencies = dependencyAnchors(
      repo,
      tree,
      path,
      testContent,
      targetPath,
      excludedPaths,
    );
    for (const testAnchor of changedTestAnchors(repo, base, tree, path, testContent)) {
      candidates.push({
        id: `test:${tree}:${path}:${testAnchor.startLine}-${testAnchor.endLine}`,
        kind: "test_evidence",
        snapshot: tree,
        test: testAnchor,
        target: targetAnchor,
        contract,
        dependencyEvidence: dependencies,
      });
    }
  }
  return { candidates, abstentions };
}

export function gatherStagedSemanticInput(repo: string): SemanticGitInput {
  const tree = requireGit(repo, ["write-tree"]).toString("utf8").trim();
  if (!tree || ZERO_OID.test(tree)) throw new Error("git write-tree returned no immutable tree");
  const base = headTree(repo);
  const paths = changedPaths(repo, base, tree);
  const excludedPaths = excludedPathsForDiff(repo, base, tree);
  const extracted = testCandidates(repo, base, tree, paths, excludedPaths);
  return {
    snapshot: { kind: "staged_tree", tree, base },
    candidates: extracted.candidates,
    changedPaths: paths,
    abstentions: extracted.abstentions,
    excludedPaths: [...excludedPaths],
  };
}

export function withCompletionClaim(
  repo: string,
  input: SemanticGitInput,
  claim: string,
  receiptPaths: string[],
): SemanticGitInput {
  if (claim.trim().length === 0) {
    return {
      ...input,
      abstentions: [...input.abstentions, { scope: "completion_claim", reason: "missing_claim" }],
    };
  }
  const uniqueReceiptPaths = [...new Set(receiptPaths)];
  const excludedPaths = new Set(input.excludedPaths ?? []);
  const receiptAbstentions: Array<{ scope: string; reason: string }> = [];
  const evidence: EvidenceAnchor[] = [];
  for (const path of uniqueReceiptPaths) {
    const read = readTreePathResult(repo, input.snapshot.tree, path, excludedPaths);
    if (read.status !== "ok") {
      receiptAbstentions.push({ scope: path, reason: `receipt_${read.status}` });
      continue;
    }
    if (!input.changedPaths.includes(path)) {
      receiptAbstentions.push({ scope: path, reason: "receipt_not_changed_in_candidate" });
      continue;
    }
    evidence.push(anchor(path, read.content));
  }
  if (uniqueReceiptPaths.length === 0 || receiptAbstentions.length > 0) {
    return {
      ...input,
      abstentions: [
        ...input.abstentions,
        ...(uniqueReceiptPaths.length === 0
          ? [{ scope: "completion_claim", reason: "missing_receipts" }]
          : receiptAbstentions),
      ],
    };
  }
  const digest = createHash("sha256")
    .update(input.snapshot.tree)
    .update("\0")
    .update(claim)
    .update("\0")
    .update(uniqueReceiptPaths.join("\0"))
    .digest("hex")
    .slice(0, 16);
  return {
    ...input,
    candidates: [
      ...input.candidates,
      {
        id: `completion:${input.snapshot.tree}:${digest}`,
        kind: "completion_claim",
        snapshot: input.snapshot.tree,
        claim,
        evidence,
      },
    ],
  };
}

export function gatherWorktreeSemanticInput(repo: string): SemanticGitInput {
  const temporaryDirectory = mkdtempSync(join(process.env.TMPDIR ?? repo, "semantic-index-"));
  const temporaryIndex = join(temporaryDirectory, "index");
  const indexEnvironment = { GIT_INDEX_FILE: temporaryIndex };
  const pathsToStage = worktreePaths(repo);
  const worktreeExcluded = worktreeExcludedPaths(repo, pathsToStage);
  try {
    if (objectExists(repo, "HEAD^{tree}")) requireGit(repo, ["read-tree", "HEAD"], indexEnvironment);
    else requireGit(repo, ["read-tree", "--empty"], indexEnvironment);
    stageWorktreePaths(repo, pathsToStage, worktreeExcluded, indexEnvironment);
    const tree = requireGit(repo, ["write-tree"], indexEnvironment).toString("utf8").trim();
    if (!tree || ZERO_OID.test(tree)) throw new Error("temporary git index returned no immutable tree");
    const base = headTree(repo);
    const paths = changedPaths(repo, base, tree);
    const excludedPaths = excludedPathsForDiff(repo, base, tree);
    for (const path of worktreeExcluded) excludedPaths.add(path);
    const extracted = testCandidates(repo, base, tree, paths, excludedPaths);
    return {
      snapshot: { kind: "worktree_tree", tree, base },
      candidates: extracted.candidates,
      changedPaths: paths,
      abstentions: extracted.abstentions,
      excludedPaths: [...excludedPaths],
    };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export type PushUpdate = {
  localRef: string;
  localOid: string;
  remoteRef: string;
  remoteOid: string;
};

export type ParsedPushUpdates = {
  updates: PushUpdate[];
  abstentions: Array<{ scope: string; reason: string }>;
};

export function parsePrePushUpdates(text: string): ParsedPushUpdates {
  const updates: PushUpdate[] = [];
  const abstentions: Array<{ scope: string; reason: string }> = [];
  const oid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim().length === 0) return;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !oid.test(fields[1]!) || !oid.test(fields[3]!)) {
      abstentions.push({ scope: `pre_push_line_${index + 1}`, reason: "malformed_pre_push_line" });
      return;
    }
    updates.push({
      localRef: fields[0]!,
      localOid: fields[1]!,
      remoteRef: fields[2]!,
      remoteOid: fields[3]!,
    });
  });
  return { updates, abstentions };
}

function abstainedOutgoing(update: PushUpdate, reason: string): SemanticGitInput {
  return {
    snapshot: {
      kind: "outgoing_ref",
      tree: ZERO_OID.test(update.localOid) ? update.remoteOid : update.localOid,
      base: update.remoteOid,
      ref: update.remoteRef,
    },
    candidates: [],
    changedPaths: [],
    abstentions: [{ scope: update.remoteRef, reason }],
  };
}

function peelCommit(repo: string, object: string): string | undefined {
  const result = git(repo, ["rev-parse", `${object}^{commit}`]);
  return result.status === 0 ? result.stdout.toString("utf8").trim() : undefined;
}

export function gatherOutgoingSemanticInputs(
  repo: string,
  updates: PushUpdate[],
): SemanticGitInput[] {
  return updates.map((update) => {
    if (ZERO_OID.test(update.localOid)) return abstainedOutgoing(update, "deleted_ref");
    const head = peelCommit(repo, update.localOid);
    if (!head) return abstainedOutgoing(update, "missing_local_object");
    if (ZERO_OID.test(update.remoteOid)) return abstainedOutgoing(update, "new_ref_missing_base");
    const base = peelCommit(repo, update.remoteOid);
    if (!base) return abstainedOutgoing(update, "missing_base_object");
    const paths = changedPaths(repo, base, head);
    const excludedPaths = excludedPathsForDiff(repo, base, head);
    const extracted = testCandidates(repo, base, head, paths, excludedPaths);
    return {
      snapshot: { kind: "outgoing_ref", tree: head, base, ref: update.remoteRef },
      candidates: extracted.candidates,
      changedPaths: paths,
      abstentions: extracted.abstentions,
      excludedPaths: [...excludedPaths],
    };
  });
}
