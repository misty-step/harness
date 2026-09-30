import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Materialize the same self-contained package shape that the OMP/Pi installers deploy.
test("diff review isolates its key and records per-process requests without ambient fallback", () => {
	const dir = mkdtempSync(join(tmpdir(), "jev-review-key-"));
	try {
		for (const file of ["engine.ts", "jev-key.ts"]) copyFileSync(join(import.meta.dir, file), join(dir, file));
		writeFileSync(join(dir, ["jev", "env", "pass"].join(".")), "OPENROUTER_API_KEY=workstation/review-fixture\n");
		const launcher = join(dir, "pass-env");
		writeFileSync(launcher, `#!/bin/sh
[ "$1" = run ] && [ "$2" = -f ] && [ "$4" = -- ] && [ "$5" = printenv ] && [ "$6" = OPENROUTER_API_KEY ] || exit 1
IFS= read -r binding < "$3"
[ "$binding" = 'OPENROUTER_API_KEY=workstation/review-fixture' ] || exit 1
printf '%s\\n' 'dedicated-review-fixture'
`);
		chmodSync(launcher, 0o700);
		writeFileSync(join(dir, "probe.ts"), `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jevProvider, logReview } from "./jev-key.ts";
const resolution = await jevProvider();
if (process.env.EXPECT_PASS === "0") {
  if (resolution.provider !== null || resolution.source !== "none") process.exit(1);
  console.log("no-key");
} else {
  if (!resolution.provider || resolution.source !== "pass-env") process.exit(2);
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    const payload = JSON.parse(String(init?.body));
    if (headers.get("Authorization") !== "Bearer dedicated-review-fixture" || payload.model !== "typesafe/jev-1.13") process.exit(3);
    return new Response(JSON.stringify({ model: "typesafe/jev-1.13-20260917", answers: { q: { type: "noul", noul: 0.1 } } }), { status: 200 });
  };
  await resolution.provider.evaluate("a short state", { q: { type: "noul", instructions: "Any leak?" } });
  logReview({ provider: "openrouter", latencyMs: 1, enabled: true, blocks: [], warnings: [] }, resolution);
  const record = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "diff-review.jsonl"), "utf8").trim());
  if (record.pid !== process.pid || record.key_source !== "pass-env" || record.requests_attempted_total !== 1 || record.responses_2xx_total !== 1) process.exit(4);
  console.log("dedicated-key");
}
`);
		for (const [bin, expected] of [[launcher, "dedicated-key"], [join(dir, "missing-pass-env"), "no-key"]]) {
			const result = spawnSync("bun", [join(dir, "probe.ts")], {
				cwd: dir,
				env: {
					...process.env,
					OPENROUTER_API_KEY: "ambient-other-key",
					TYPESAFE_API_KEY: "ambient-typesafe-key",
					MOCK_SYSTEM_ONE: "0",
					PASS_ENV_BIN: bin,
					EXPECT_PASS: expected === "no-key" ? "0" : "1",
					PI_CODING_AGENT_DIR: dir,
				},
				encoding: "utf8",
			});
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout.trim()).toBe(expected);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
