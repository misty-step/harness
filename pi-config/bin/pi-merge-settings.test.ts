import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("deployment repairs recovery disables and retires owned Luna pins without erasing foreign state", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-settings-migration-"));
	try {
		const source = join(root, "source.json");
		const dest = join(root, "settings.json");
		writeFileSync(source, JSON.stringify({ retry: { enabled: true }, compaction: { enabled: true } }));
		writeFileSync(dest, JSON.stringify({
			retry: { enabled: false, maxRetries: 7 },
			compaction: { enabled: false, keepRecentTokens: 4000 },
			modelThinkingLevels: {
				"openai-pool/gpt-6-luna": "max",
				"openai-codex-2/gpt-6-luna": "max",
				"openai-pool/gpt-6.1-sol": "xhigh",
				"foreign/gpt-6-luna": "high",
			},
			lastChangelogVersion: "foreign-runtime-state",
		}));
		const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "pi-merge-settings.ts"), "--source", source, "--dest", dest]);
		expect(result.exitCode).toBe(0);
		const installed = JSON.parse(readFileSync(dest, "utf8"));
		expect(installed.retry).toEqual({ enabled: true, maxRetries: 7 });
		expect(installed.compaction).toEqual({ enabled: true, keepRecentTokens: 4000 });
		expect(installed.modelThinkingLevels).toEqual({
			"openai-pool/gpt-6.1-sol": "xhigh",
			"foreign/gpt-6-luna": "high",
		});
		expect(installed.lastChangelogVersion).toBe("foreign-runtime-state");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
