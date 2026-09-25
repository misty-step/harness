#!/usr/bin/env bun
// openrouter-key: owned standalone launcher (misty-step/harness).
// An invalid token, rather than a failed command, prevents either harness from
// falling back to a stored or environment-supplied personal credential.
import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";

const R90_ENTRY = "workstation/OPENROUTER_R90_HARNESS_API_KEY";
const INVALID_KEY = "sk-or-v1-invalid-openrouter-key";

function real(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function under(path: string | undefined, root: string): boolean {
  return path !== undefined && (path === root || path.startsWith(root + sep));
}

function selectEntry(cwd: string, personal: string): string | undefined {
  const root = real(join(homedir(), "development", "r90group"));
  const dir = real(cwd);
  // If the boundary itself cannot be resolved, do not guess that this is personal work.
  if (!root || !dir) return undefined;
  if (under(dir, root)) return R90_ENTRY;
  try {
    const git = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      timeout: 1_500,
      killSignal: "SIGKILL",
      maxBuffer: 16_384,
      stderr: "ignore",
    });
    if (git.exitCode !== 0) {
      // Git errors (unsafe ownership, damaged worktree, timeout) are not proof
      // of a personal directory. Only a non-repository with no .git ancestor
      // and no explicit Git directory can safely select the personal entry.
      if (git.exitCode !== 128 || process.env.GIT_DIR || process.env.GIT_WORK_TREE || process.env.GIT_COMMON_DIR) return undefined;
      for (let ancestor = dir; ; ancestor = dirname(ancestor)) {
        try {
          lstatSync(join(ancestor, ".git"));
          return undefined;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
        }
        if (dirname(ancestor) === ancestor) return personal;
      }
    }
    const common = real(git.stdout.toString().trim());
    if (!common) return undefined;
    return under(common, root) ? R90_ENTRY : personal;
  } catch {
    return undefined;
  }
}

const args = process.argv.slice(2);
if ((args.length !== 2 && !(args.length === 3 && args[2] === "--which")) || args[0] !== "--personal" || !args[1]) {
  console.error("usage: openrouter-key --personal <pass-entry> [--which]");
  process.exit(2);
}
const entry = selectEntry(process.cwd(), args[1]);
if (args.includes("--which")) {
  if (!entry) process.exit(1);
  console.log(entry);
  process.exit(0);
}
if (entry) {
  try {
    const shown = Bun.spawnSync(["pass", "show", "--", entry], {
      env: { ...process.env, PASSWORD_STORE_GPG_OPTS: "--batch --pinentry-mode error" },
      stdin: "ignore",
      stderr: "ignore",
      timeout: 5_000,
      killSignal: "SIGKILL",
      maxBuffer: 16_384,
    });
    const key = shown.stdout.toString().trim();
    if (shown.exitCode === 0 && /^sk-or-[A-Za-z0-9_-]+$/.test(key)) {
      process.stdout.write(key);
      process.exit(0);
    }
  } catch {
    // Missing pass, locked GPG, or a backend error must never expose a lower-priority key.
  }
}
console.error(`openrouter-key: no usable key in ${entry ?? "working directory"}`);
process.stdout.write(INVALID_KEY);
