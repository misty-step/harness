import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MANAGED_MARKER, compileEntry, installPolicy, parsePolicy } from "./omp-secrets-policy.ts";

const policyPath = join(import.meta.dir, "..", "secrets.yml");
const policyText = await readFile(policyPath, "utf8");

// OMP's obfuscate mode replaces every regex match of eight or more characters.
function mask(text: string): string {
	let masked = text;
	for (const entry of parsePolicy(policyText)) {
		masked = masked.replace(compileEntry(entry), (match) => (match.length >= 8 ? "<masked>" : match));
	}
	return masked;
}

describe("harness secrets policy", () => {
	test("masks credential values in env-style lines as grep and read print them", () => {
		expect(mask(" 12:SUPABASE_ACCESS_TOKEN=placeholder-value-one")).toBe(" 12:SUPABASE_ACCESS_TOKEN=<masked>");
		expect(mask("*3:export OPENROUTER_MANAGEMENT_KEY=placeholder-value-two")).toBe(
			"*3:export OPENROUTER_MANAGEMENT_KEY=<masked>",
		);
		expect(mask('DB_PASSWORD="several words here"')).toBe("DB_PASSWORD=<masked>");
		expect(mask("DB_PASSWORD=abc#defghijkl")).toBe("DB_PASSWORD=<masked>");
		expect(mask('"STRIPE_SECRET": "placeholder-value"')).toBe('"STRIPE_SECRET": <masked>');
		// Joined at runtime so the repository's secret scanners do not flag the fixture.
		const url = ["DATABASE_URL=postgres://app", "placeholderpw@db.internal:5432/app"].join(":");
		expect(mask(url)).toBe("DATABASE_URL=postgres://app:<masked>@db.internal:5432/app");
	});

	test("leaves identifiers and ordinary values readable", () => {
		for (const line of [
			"VERCEL_TEAM_ID=team_placeholder",
			"QA_EMAIL=qa@example.com",
			"PASSWORD_MIN_LENGTH=12",
			"see https://example.com/docs/page",
		]) {
			expect(mask(line)).toBe(line);
		}
	});

	test("rejects a policy that would commit a literal secret or stop masking", () => {
		expect(() => parsePolicy(`${MANAGED_MARKER}\n- type: plain\n  content: literal-value-123\n`)).toThrow(
			"only regex entries",
		);
		expect(() => parsePolicy(`${MANAGED_MARKER}\n- type: regex\n  content: "(unclosed"\n`)).toThrow("entry 1");
		expect(() => parsePolicy("- type: regex\n  content: x+\n")).toThrow("must start with");
	});

	test("replaces a managed secrets.yml but never an unmanaged one", async () => {
		const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "secrets-policy-"));
		try {
			const dest = join(dir, "secrets.yml");
			expect(await installPolicy(policyPath, dest)).toBe("installed");
			expect(await readFile(dest, "utf8")).toBe(policyText);
			expect((await stat(dest)).mode & 0o777).toBe(0o600);
			expect(await installPolicy(policyPath, dest)).toBe("unchanged");
			const local = "- type: plain\n  content: machine-local-value\n";
			await writeFile(dest, local);
			await expect(installPolicy(policyPath, dest)).rejects.toThrow("not harness-managed");
			expect(await readFile(dest, "utf8")).toBe(local);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
