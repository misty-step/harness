#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  OpenRouterJevProvider,
  type Answer,
  type Question,
  type SystemOneProvider,
} from "../system-one/engine.ts";
import {
  gatherOutgoingSemanticInputs,
  gatherStagedSemanticInput,
  gatherWorktreeSemanticInput,
  parsePrePushUpdates,
  withCompletionClaim,
  type SemanticGitInput,
} from "../system-one/semantic-git.ts";
import { runSemanticQuality } from "../system-one/semantic-run.ts";

const REQUESTED_MODEL = "typesafe/jev-1.13";

type CliOptions = {
  repo: string;
  mode: "staged" | "worktree" | "outgoing";
  json: boolean;
  noCache: boolean;
  cacheDir?: string;
  fixture?: string;
  claim?: string;
  receipts: string[];
  timeoutMs: number;
};

type FixtureConfig = {
  requestedModel: string;
  resolvedModel: string;
  outcomes: {
    oracle: string;
    target: string;
    purpose: string;
    support: string;
  };
};

class FixtureProvider implements SystemOneProvider {
  readonly name = "fixture" as const;
  readonly requestedModel: string;
  readonly resolvedModels: ReadonlySet<string>;

  constructor(private fixture: FixtureConfig) {
    this.requestedModel = fixture.requestedModel;
    this.resolvedModels = new Set([fixture.resolvedModel]);
  }

  async evaluate(
    _state: string,
    questions: Record<string, Question>,
  ): Promise<Record<string, Answer>> {
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(questions)) {
      if (question.type !== "choice") throw new Error("semantic fixture only supports Choice questions");
      const suffix = key.split("_").at(-1) as "oracle" | "target" | "purpose" | "support";
      let choice = this.fixture.outcomes[suffix];
      if (!(choice in question.criteria)) {
        choice = "insufficient_evidence" in question.criteria
          ? "insufficient_evidence"
          : Object.keys(question.criteria)[0]!;
      }
      answers[key] = {
        type: "choice",
        choice,
        probabilities: Object.fromEntries(
          Object.keys(question.criteria).map((option) => [option, option === choice ? 1 : 0]),
        ),
        confidence: 1,
      };
    }
    return answers;
  }
}

function usage(): string {
  return [
    "Usage: semantic-check --repo PATH (--staged|--worktree|--outgoing) [options]",
    "  --json                 Print one machine-readable record.",
    "  --no-cache             Disable the local content-addressed cache.",
    "  --cache-dir PATH       Override the local cache directory.",
    "  --claim TEXT           Assess a completion claim.",
    "  --receipt PATH         Add an immutable receipt path. Repeatable.",
    "  --fixture PATH         Use explicit deterministic answers for tests and evals.",
  ].join("\n");
}

function nextValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(args: string[]): CliOptions {
  let repo = process.cwd();
  let mode: CliOptions["mode"] | undefined;
  let json = false;
  let noCache = false;
  let cacheDir: string | undefined;
  let fixture: string | undefined;
  let claim: string | undefined;
  const receipts: string[] = [];
  let timeoutMs = 15_000;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--repo") repo = nextValue(args, index++, argument);
    else if (argument === "--staged") mode = setMode(mode, "staged");
    else if (argument === "--worktree") mode = setMode(mode, "worktree");
    else if (argument === "--outgoing") mode = setMode(mode, "outgoing");
    else if (argument === "--json") json = true;
    else if (argument === "--no-cache") noCache = true;
    else if (argument === "--cache-dir") cacheDir = nextValue(args, index++, argument);
    else if (argument === "--fixture") fixture = nextValue(args, index++, argument);
    else if (argument === "--claim") claim = nextValue(args, index++, argument);
    else if (argument === "--receipt") receipts.push(nextValue(args, index++, argument));
    else if (argument === "--timeout-ms") {
      timeoutMs = Number(nextValue(args, index++, argument));
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be positive");
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  if (!mode) throw new Error("one of --staged, --worktree, or --outgoing is required");
  if (claim && receipts.length === 0) throw new Error("--claim requires at least one --receipt");
  return {
    repo: resolve(repo),
    mode,
    json,
    noCache,
    cacheDir,
    fixture,
    claim,
    receipts,
    timeoutMs,
  };
}

function setMode(
  current: CliOptions["mode"] | undefined,
  next: CliOptions["mode"],
): CliOptions["mode"] {
  if (current && current !== next) throw new Error("choose exactly one semantic-check mode");
  return next;
}

function defaultCacheDir(repo: string): string {
  const gitPath = execFileSync("git", ["rev-parse", "--git-path", "semantic-quality-cache"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  return isAbsolute(gitPath) ? gitPath : resolve(repo, gitPath);
}

function readFixture(path: string): FixtureProvider {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<FixtureConfig>;
  if (
    typeof parsed.requestedModel !== "string" ||
    typeof parsed.resolvedModel !== "string" ||
    !parsed.outcomes ||
    ["oracle", "target", "purpose", "support"].some(
      (key) => typeof parsed.outcomes![key as keyof FixtureConfig["outcomes"]] !== "string",
    )
  ) {
    throw new Error("invalid semantic fixture");
  }
  return new FixtureProvider(parsed as FixtureConfig);
}

function resolveSemanticProvider(options: CliOptions): SystemOneProvider | null {
  if (options.fixture) return readFixture(resolve(options.fixture));
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key ? new OpenRouterJevProvider(key, REQUESTED_MODEL) : null;
}

function gatherInputs(options: CliOptions): SemanticGitInput[] {
  let inputs: SemanticGitInput[];
  if (options.mode === "staged") inputs = [gatherStagedSemanticInput(options.repo)];
  else if (options.mode === "worktree") inputs = [gatherWorktreeSemanticInput(options.repo)];
  else {
    const parsed = parsePrePushUpdates(readFileSync(0, "utf8"));
    inputs = gatherOutgoingSemanticInputs(options.repo, parsed.updates);
    if (parsed.abstentions.length > 0 || inputs.length === 0) {
      inputs.push({
        snapshot: { kind: "outgoing_ref", tree: "unavailable" },
        candidates: [],
        changedPaths: [],
        abstentions:
          parsed.abstentions.length > 0
            ? parsed.abstentions
            : [{ scope: "pre_push", reason: "no_ref_updates" }],
      });
    }
  }
  if (options.claim) {
    inputs = inputs.map((input) =>
      withCompletionClaim(options.repo, input, options.claim!, options.receipts),
    );
  }
  return inputs;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(args);
  const provider = resolveSemanticProvider(options);
  const cacheEnabled = !options.noCache && process.env.CI !== "true";
  const result = await runSemanticQuality(gatherInputs(options), provider, {
    model: REQUESTED_MODEL,
    expectedProvider: options.fixture ? "fixture" : "openrouter",
    timeoutMs: options.timeoutMs,
    noCache: !cacheEnabled,
    cacheDir: cacheEnabled ? resolve(options.cacheDir ?? defaultCacheDir(options.repo)) : undefined,
  });
  if (options.json) process.stdout.write(`${JSON.stringify(result.record)}\n`);
  else process.stdout.write(`${result.humanLines.join("\n")}\n`);
  return 0;
}

if (import.meta.main) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`semantic-check: ${message}\n${usage()}\n`);
      process.exitCode = 2;
    });
}
