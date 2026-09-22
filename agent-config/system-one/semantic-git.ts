import { spawnSync } from "node:child_process";
import type {
  EvidenceAnchor,
  SemanticCandidate,
  TestEvidenceCandidate,
} from "./semantic-quality.ts";

const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|(?:\.(?:test|spec))\.[^.\/]+$/i;
const MAX_ANCHOR_BYTES = 40_000;
const ZERO_OID = /^0+$/;

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

function readTreePath(repo: string, tree: string, path: string): string | undefined {
  const result = git(repo, ["show", `${tree}:${path}`]);
  if (result.status !== 0 || result.stdout.length > MAX_ANCHOR_BYTES) return undefined;
  return result.stdout.toString("utf8");
}

function anchor(path: string, content: string): EvidenceAnchor {
  const lines = content.length === 0 ? 1 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  return { path, startLine: 1, endLine: Math.max(1, lines), content };
}

function inferTargetPath(testPath: string): string {
  return testPath.replace(/\.(?:test|spec)(?=\.[^.\/]+$)/i, "").replace(/(^|\/)tests\//i, "$1src/");
}

function firstContract(repo: string, tree: string): EvidenceAnchor | undefined {
  for (const path of ["USER_STORIES.md", "AGENTS.md", "README.md"]) {
    const content = readTreePath(repo, tree, path);
    if (content !== undefined) return anchor(path, content);
  }
  return undefined;
}

function testCandidates(repo: string, tree: string, paths: string[]): TestEvidenceCandidate[] {
  const contract = firstContract(repo, tree);
  const candidates: TestEvidenceCandidate[] = [];
  for (const path of paths.filter((candidatePath) => TEST_PATH.test(candidatePath))) {
    const testContent = readTreePath(repo, tree, path);
    if (testContent === undefined) continue;
    const targetPath = inferTargetPath(path);
    const targetContent = readTreePath(repo, tree, targetPath);
    if (targetContent === undefined) continue;
    const testAnchor = anchor(path, testContent);
    candidates.push({
      id: `test:${path}:${testAnchor.startLine}-${testAnchor.endLine}`,
      kind: "test_evidence",
      snapshot: tree,
      test: testAnchor,
      target: anchor(targetPath, targetContent),
      contract,
      dependencyEvidence: [],
    });
  }
  return candidates;
}

export function gatherStagedSemanticInput(repo: string): SemanticGitInput {
  const tree = requireGit(repo, ["write-tree"]).toString("utf8").trim();
  if (!tree || ZERO_OID.test(tree)) throw new Error("git write-tree returned no immutable tree");
  const base = headTree(repo);
  const paths = changedPaths(repo, base, tree);
  return {
    snapshot: { kind: "staged_tree", tree, base },
    candidates: testCandidates(repo, tree, paths),
    changedPaths: paths,
    abstentions: [],
  };
}
