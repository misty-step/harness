import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const launcher = join(import.meta.dir, "openrouter-key.ts");
const r90Entry = "workstation/OPENROUTER_R90_HARNESS_API_KEY";
const personalEntry = "workstation/OPENROUTER_OMP_HARNESS_API_KEY";
const roots: string[] = [];

function git(...args: string[]): void {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "openrouter-key-test-"));
  roots.push(home);
  const r90 = join(home, "development", "r90group", "habitat");
  const personal = join(home, "development", "misty-step");
  const linked = join(home, "linked-habitat");
  const store = join(home, "store");
  const bin = join(home, "bin");
  mkdirSync(r90, { recursive: true });
  mkdirSync(personal, { recursive: true });
  mkdirSync(bin);
  for (const [entry, key] of [[r90Entry, "sk-or-v1-r90-synthetic"], [personalEntry, "sk-or-v1-personal-synthetic"]]) {
    const file = join(store, entry);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, key);
  }
  git("init", "-q", r90);
  git("-C", r90, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "fixture");
  git("-C", r90, "worktree", "add", "-q", "--detach", linked, "HEAD");
  writeFileSync(join(bin, "pass"), `#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(process.env.TEST_PASS_USED, "yes");
if (process.argv[2] !== "show" || process.argv[3] !== "--" || process.env.PASSWORD_STORE_GPG_OPTS !== "--batch --pinentry-mode error") process.exit(2);
// Integration: OS subprocess deadlines cannot be advanced with fake JS timers.
if (process.env.TEST_PASS_DELAY_MS) await Bun.sleep(Number(process.env.TEST_PASS_DELAY_MS));
try { process.stdout.write(readFileSync(join(process.env.TEST_PASS_STORE, process.argv[4]))); }
catch { process.exit(1); }
`, { mode: 0o700 });
  const used = join(home, "pass-used");
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, TEST_PASS_STORE: store, TEST_PASS_USED: used };
  const invoke = (cwd: string, which = false) => {
    const result = spawnSync(process.execPath, [launcher, "--personal", personalEntry, ...(which ? ["--which"] : [])], {
      cwd, env, encoding: "utf8", timeout: 10_000,
    });
    if (result.error) throw result.error;
    return result;
  };
  return { home, r90, personal, linked, store, used, env, invoke };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("R90 checkout and linked worktree use R90, while other directories use personal", () => {
  const f = fixture();
  for (const cwd of [f.r90, f.linked]) {
    const result = f.invoke(cwd);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("sk-or-v1-r90-synthetic");
  }
  for (const cwd of [f.personal, f.home]) {
    const result = f.invoke(cwd);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("sk-or-v1-personal-synthetic");
  }
});

test("missing and non-OpenRouter R90 keys produce an invalid auth token, never the available personal key", () => {
  const f = fixture();
  const keyFile = join(f.store, r90Entry);
  for (const content of [null, "not-a-key", "sk-or-v1-looks-valid\nnotes"] as const) {
    if (content === null) rmSync(keyFile);
    else writeFileSync(keyFile, content);
    const result = f.invoke(f.linked);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("sk-or-v1-invalid-openrouter-key");
    expect(result.stdout).not.toContain("personal-synthetic");
  }
});

test("damaged linked-worktree Git metadata cannot redirect billing to personal", () => {
  const f = fixture();
  writeFileSync(join(f.linked, ".git"), "gitdir: /missing-worktree-metadata");
  const result = f.invoke(f.linked);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("sk-or-v1-invalid-openrouter-key");
  expect(existsSync(f.used)).toBe(false);
});

test("slow R90 pass lookup returns invalid auth before Pi's command timeout", () => {
  const f = fixture();
  f.env.TEST_PASS_DELAY_MS = "6000";
  const result = f.invoke(f.linked);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("sk-or-v1-invalid-openrouter-key");
  expect(result.stdout).not.toContain("personal-synthetic");
}, 9_000);

test("--which reveals only the chosen entry name and never invokes pass", () => {
  const f = fixture();
  for (const [cwd, entry] of [[f.linked, r90Entry], [f.personal, personalEntry]]) {
    const result = f.invoke(cwd, true);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${entry}\n`);
    expect(result.stdout).not.toContain("sk-or-");
  }
  expect(existsSync(f.used)).toBe(false);
});
