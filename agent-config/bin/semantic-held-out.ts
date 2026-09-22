#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OpenRouterJevProvider, type SystemOneProvider } from "../system-one/engine.ts";
import {
  evaluateHeldOutFixture,
  type HeldOutFixture,
} from "../system-one/semantic-held-out-run.ts";

const REQUESTED_MODEL = "typesafe/jev-1.13";
const DEFAULT_FIXTURE = resolve(
  import.meta.dir,
  "..",
  "system-one",
  "fixtures",
  "semantic-quality",
  "held-out-public.json",
);

type CliOptions = {
  fixture: string;
  json: boolean;
  maxCases: number;
  timeoutMs: number;
};

function usage(): string {
  return [
    "Usage: semantic-held-out [options]",
    "  --fixture PATH       Held-out fixture. Defaults to held-out-public.json.",
    "  --max-cases N        Case budget. Default 24; hard maximum 64.",
    "  --timeout-ms N       Per-request timeout. Default 15000; hard maximum 60000.",
    "  --json               Print one machine-readable report.",
  ].join("\n");
}

function nextValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveFlag(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseArgs(args: string[]): CliOptions {
  let fixture = DEFAULT_FIXTURE;
  let json = false;
  let maxCases = 24;
  let timeoutMs = 15_000;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--fixture") fixture = resolve(nextValue(args, index++, argument));
    else if (argument === "--max-cases") {
      maxCases = positiveFlag(nextValue(args, index++, argument), argument);
    } else if (argument === "--timeout-ms") {
      timeoutMs = positiveFlag(nextValue(args, index++, argument), argument);
    } else if (argument === "--json") json = true;
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return { fixture, json, maxCases, timeoutMs };
}

function providerFromEnvironment(): SystemOneProvider | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key ? new OpenRouterJevProvider(key, REQUESTED_MODEL) : null;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(args);
  const fixture = JSON.parse(readFileSync(options.fixture, "utf8")) as HeldOutFixture;
  const report = await evaluateHeldOutFixture(fixture, providerFromEnvironment(), {
    maxCases: options.maxCases,
    timeoutMs: options.timeoutMs,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(
      [
        `semantic-held-out: ${report.result}`,
        `cases: ${report.evaluatedCaseCount}/${report.caseCount}`,
        `model validation: ${report.modelValidation}`,
        report.metrics
          ? `labels: ${report.metrics.exactMatches}/${report.metrics.labels}; false positives: ${report.metrics.falsePositives}; misses: ${report.metrics.misses}; abstentions: ${report.metrics.abstentions}`
          : `metrics: unavailable; ${report.unavailable.length} candidate(s) unavailable`,
      ].join("\n") + "\n",
    );
  }
  return report.result === "pass" ? 0 : report.result === "fail" ? 1 : 3;
}

if (import.meta.main) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`semantic-held-out: ${message}\n${usage()}\n`);
      process.exitCode = 2;
    });
}
