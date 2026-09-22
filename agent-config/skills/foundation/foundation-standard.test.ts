import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const catalogPath = join(root, "foundation-standard-v1.json");
const standardPath = join(root, "foundation-standard-v1.md");
const skillPath = join(root, "SKILL.md");
const operatingPath = join(root, "operating-foundations.md");

const obligationIds = [
	"FND-CHG-001",
	"FND-CHG-002",
	"FND-TRN-001",
	"FND-OBS-001",
	"FND-ACT-001",
	"FND-DAT-001",
	"FND-PRF-001",
	"FND-USE-001",
];

describe("Foundation Standard v1", () => {
	test("ships one versioned catalog whose obligations are present in the authority", () => {
		const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
		const standard = readFileSync(standardPath, "utf8");
		expect(catalog.schema).toBe("foundation-standard/1");
		expect(catalog.id).toBe("misty-step.foundation");
		expect(catalog.version).toBe("1.0.0");
		expect(catalog.obligations.map((item: { id: string }) => item.id)).toEqual(obligationIds);
		for (const item of catalog.obligations) {
			expect(item.applies_when.length).toBeGreaterThan(0);
			expect(item.required_evidence.length).toBeGreaterThan(0);
			expect(item.exception_authority.length).toBeGreaterThan(0);
			expect(standard).toContain(`### ${item.id}`);
		}
		expect(catalog.approved_defaults.map((item: { id: string }) => item.id)).toEqual([
			"FND-DEF-SENTRY-001",
			"FND-DEF-ACTIVITY-001",
		]);
		expect(standard).toContain("Sentry is the approved default");
		expect(standard).toContain("existing first-party store");
		expect(standard).toContain("approved default");
	});

	test("keeps assessment procedure and operating pointer subordinate to the standard", () => {
		const skill = readFileSync(skillPath, "utf8");
		const operating = readFileSync(operatingPath, "utf8");
		expect(skill).toContain("foundation-standard-v1.md");
		expect(skill).toContain("assessment and repair procedure");
		expect(operating).toContain("foundation-standard-v1.md");
		expect(operating).toContain("does not redefine its obligations");
		const ompReadme = readFileSync(join(root, "../../../omp-config/README.md"), "utf8");
		expect(ompReadme).toContain("foundation-standard-v1.md");
		expect(ompReadme).toContain("assessment and repair procedure");
	});
});
