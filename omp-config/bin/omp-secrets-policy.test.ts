import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MANAGED_MARKER, compileEntry, installPolicy, parsePolicy } from "./omp-secrets-policy.ts";

const policyPath = join(import.meta.dir, "..", "secrets.yml");
const policyText = await readFile(policyPath, "utf8");

// Assert the secret spans, not a copy of OMP's masking implementation.
function values(text: string): string[] {
	return parsePolicy(policyText).flatMap((entry) => [...text.matchAll(compileEntry(entry))].map((match) => match[0]));
}

describe("harness secrets policy", () => {
	test("matches complete credential values, including whitespace, bare keywords, and leading underscores", () => {
		const secret = ["fixture", "password"].join("-");
		for (const name of ["KEY", "TOKEN", "SECRET", "PASSWORD", "PASS", "AUTH", "CREDENTIAL", "PRIVATE", "DB_PASSWORD", "_API_KEY"]) {
			expect(values([name, secret].join("="))).toEqual([secret]);
		}
		expect(values([" 12:SUPABASE_ACCESS_TOKEN", secret].join("="))).toEqual([secret]);
		expect(values(["*3:export OPENROUTER_MANAGEMENT_KEY", secret].join("="))).toEqual([secret]);
		expect(values(["DB_PASSWORD", `"${secret} with spaces"`].join("="))).toEqual([`"${secret} with spaces"`]);
		expect(values(["DB_PASSWORD", `'${secret} with spaces'`].join("="))).toEqual([`'${secret} with spaces'`]);
		expect(values(['"STRIPE_SECRET"', `"${secret}"`].join(": "))).toEqual([`"${secret}"`]);
		const spaced = `${secret} with spaces`;
		expect(values(["DB_PASSWORD", spaced].join("="))).toEqual([spaced]);
	});

	test("matches the entire URL password through its final authority delimiter", () => {
		const secret = ["fixture", "password@segment"].join("-");
		const url = ["postgres://app", `${secret}@db.internal:5432/app`].join(":");
		expect(values(["DATABASE_URL", url].join("="))).toEqual([secret]);
		expect(values(["https://app", `${secret}@example.com?email=x@y`].join(":"))).toEqual([secret]);
	});

	test("keeps ordinary values, short credentials, and following lines outside the match", () => {
		for (const line of [
			"VERCEL_TEAM_ID=team_placeholder",
			"QA_EMAIL=qa@example.com",
			"PASSWORD_MIN_LENGTH=12",
			["KEY", "1234567"].join("="),
			["KEY", '"1234567"'].join("="),
			"see https://example.com/docs/page",
			["KEY", "\nordinary value on the next line"].join("="),
		]) {
			expect(values(line)).toEqual([]);
		}
		expect(values([["KEY", "12345678"].join("="), "QA_EMAIL=qa@example.com"].join("\n"))).toEqual(["12345678"]);
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
