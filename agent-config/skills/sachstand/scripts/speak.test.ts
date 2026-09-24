import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(process.env.TMPDIR ?? join(homedir(), ".cache/tmp"), "sachstand-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const preload = join(root, "provider.ts");
writeFileSync(preload, `
const wav = Buffer.alloc(44);
wav.writeUInt32LE(48000, 28);
Date.now = () => Number(process.env.TEST_TIME);
globalThis.fetch = async (_url, init) => {
  if (JSON.parse(init.body).store !== false) {
    throw new Error("Speech requests must disable provider-side storage");
  }
  return Response.json({
    steps: [{ content: [{ type: "audio", data: wav.toString("base64") }] }],
    usage: JSON.parse(process.env.TEST_USAGE!),
  });
};
`);

function speak(usage: unknown, date = "2026-12-31T23:59:59Z") {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--preload", preload, join(import.meta.dir, "speak.ts"), "--no-play"],
    env: { ...process.env, HOME: root, GEMINI_API_KEY: "synthetic-test-key", TEST_USAGE: JSON.stringify(usage), TEST_TIME: String(Date.parse(date)) },
    stdin: Buffer.from("Verification complete."),
  });
  expect(result.exitCode).toBe(0);
  const [path, description] = result.stdout.toString().trim().split("\n");
  return { path, description };
}

test("US-020 optional usage stays unknown, while a reported zero is a valid count", () => {
  const missing = speak({ total_input_tokens: 1000 });
  expect(missing.description).toContain("cost unavailable");
  const zero = speak({ total_input_tokens: 0, total_output_tokens: 1000 });
  expect(zero.description).toContain("~$0.006000");
});

test("US-020 speech estimates honor the published UTC rate boundary", () => {
  const usage = { total_input_tokens: 1000, total_output_tokens: 1000 };
  expect(speak(usage).description).toContain("~$0.006500");
  expect(speak(usage, "2027-01-01T00:00:00Z").description).toContain("~$0.013000");
});

test("US-020 repeated briefs preserve earlier audio and keep both files private", () => {
  const first = speak({});
  const original = statSync(first.path);
  const second = speak({});
  expect(second.path).not.toBe(first.path);
  expect(statSync(first.path).ino).toBe(original.ino);
  expect(statSync(first.path).mtimeMs).toBe(original.mtimeMs);
  expect(statSync(first.path).mode & 0o777).toBe(0o600);
  expect(statSync(second.path).mode & 0o777).toBe(0o600);
});
