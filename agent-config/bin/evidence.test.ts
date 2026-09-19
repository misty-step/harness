import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EVIDENCE_QUESTIONS,
	PACKET_VERSION,
	QUESTION_PACK_VERSION,
	buildCompletionPacket,
	buildHandoffPacket,
	evaluateEvidenceFixture,
	evaluateEvidencePacket,
	renderEvidenceAdvice,
	type EvidenceFixture,
	type ProvenanceFinding,
} from "../system-one/evidence.ts";

const fixtureRoot = new URL("../system-one/fixtures/evidence/", import.meta.url);
const cli = join(import.meta.dir, "../system-one/evidence.ts");
const scratch: string[] = [];

const fixtureNames = [
	"completion-unsupported",
	"completion-clean",
	"handoff-dropped",
	"handoff-complete",
	"stale-revision",
	"missing-artifact",
	"weakened-acceptance",
	"contradictory-logs",
	"embedded-instructions",
	"duplicate-authority",
	"dedup-repeats",
	"provider-outage",
	"insufficient-context",
];

async function loadFixture(name: string): Promise<EvidenceFixture> {
	return (await Bun.file(new URL(`${name}.json`, fixtureRoot)).json()) as EvidenceFixture;
}

function ids(findings: ProvenanceFinding[]): string[] {
	return findings.map((finding) => finding.id);
}

afterEach(() => {
	for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("evidence packets", () => {
	test("version constants and the bounded question pack are stable", () => {
		expect(PACKET_VERSION).toBe("evidence-1");
		expect(QUESTION_PACK_VERSION).toBe("evidence-questions-1");
		expect(Object.keys(EVIDENCE_QUESTIONS).sort()).toEqual([
			"completion::acceptance_weakened",
			"completion::claim_unsupported",
			"completion::evidence_sufficient",
			"completion::missing_evidence",
			"handoff::dropped_kind",
			"handoff::evidence_sufficient",
			"handoff::requirement_dropped",
		]);
	});

	test("completion-unsupported reports missing test evidence and an unsupported side effect", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("completion-unsupported"));
		expect(ids(verdict.deterministic)).toEqual(["missing_test_evidence", "unsupported_side_effect"]);
		expect(verdict.sufficient).toBe(false);
		expect(ids(verdict.findings)).toContain("completion::claim_unsupported");
		expect(ids(verdict.findings)).toContain("completion::missing_evidence");
		expect(ids(verdict.findings)).toContain("insufficient_evidence");
	});

	test("completion-clean stays quiet and sufficient", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("completion-clean"));
		expect(verdict.deterministic).toEqual([]);
		expect(verdict.findings).toEqual([]);
		expect(verdict.sufficient).toBe(true);
	});

	test("handoff-dropped surfaces requirement_dropped and the gap kind via the stub", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("handoff-dropped"));
		expect(verdict.deterministic).toEqual([]);
		expect(ids(verdict.findings)).toContain("handoff::requirement_dropped");
		expect(ids(verdict.findings)).toContain("handoff::dropped_kind");
		const dropped = verdict.findings.find((finding) => finding.id === "handoff::requirement_dropped");
		expect(dropped?.severity).toBe("lead");
		expect(dropped?.message).toContain("Ship the evidence packet builders");
	});

	test("handoff-complete stays quiet and sufficient", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("handoff-complete"));
		expect(verdict.deterministic).toEqual([]);
		expect(verdict.findings).toEqual([]);
		expect(verdict.sufficient).toBe(true);
	});

	test("stale-revision is a warning-level lead naming the revision ref", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("stale-revision"));
		const stale = verdict.deterministic.find((finding) => finding.id === "stale_revision");
		expect(stale?.severity).toBe("warning");
		expect(stale?.refs).toEqual(["revision-1"]);
		expect(ids(verdict.findings)).toEqual(["stale_revision"]);
	});

	test("missing-artifact follows the injected artifact probe", async () => {
		const fixture = await loadFixture("missing-artifact");
		const missing = await evaluateEvidenceFixture(fixture, { artifactExists: () => false });
		const finding = missing.deterministic.find((item) => item.id === "missing_artifact");
		expect(finding?.severity).toBe("lead");
		expect(finding?.message).toContain("artifacts/synthetic-transcript-not-present.txt");
		const present = await evaluateEvidenceFixture(fixture, { artifactExists: () => true });
		expect(ids(present.deterministic)).not.toContain("missing_artifact");
	});

	test("weakened-acceptance maps the stub answer to a semantic lead", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("weakened-acceptance"));
		const weakened = verdict.findings.find((finding) => finding.id === "completion::acceptance_weakened");
		expect(weakened?.severity).toBe("lead");
		expect(weakened?.message).toContain("Keep the acceptance check strict");
	});

	test("contradictory-logs names the failed reference", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("contradictory-logs"));
		const contradiction = verdict.deterministic.find((finding) => finding.id === "contradictory_evidence");
		expect(contradiction?.severity).toBe("warning");
		expect(contradiction?.refs).toEqual(["test-1"]);
		expect(ids(verdict.deterministic)).toEqual(["contradictory_evidence"]);
	});

	test("embedded-instructions flags untrusted text with the source ref id", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("embedded-instructions"));
		const embedded = verdict.deterministic.find((finding) => finding.id === "embedded_instructions");
		expect(embedded?.severity).toBe("warning");
		expect(embedded?.refs).toEqual(["brief-1"]);
		expect(embedded?.message).toContain("refs[0].summary");
		expect(embedded?.message).not.toContain("ignore previous instructions");
	});

	test("duplicate-authority flags two merge records from different sources", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("duplicate-authority"));
		const duplicate = verdict.deterministic.find(
			(finding) => finding.id === "duplicate_completion_authority",
		);
		expect(duplicate?.severity).toBe("lead");
		expect(duplicate?.refs).toEqual(["merge-1", "merge-2"]);
		expect(ids(verdict.deterministic)).toEqual(["duplicate_completion_authority"]);
	});

	test("dedup-repeats invents no authority and builders dedupe refs by id", async () => {
		const fixture = await loadFixture("dedup-repeats");
		const verdict = await evaluateEvidenceFixture(fixture);
		expect(ids(verdict.deterministic)).not.toContain("duplicate_completion_authority");
		const packet = fixture.packet;
		const built = buildCompletionPacket({
			taskId: packet.kind === "completion" ? packet.taskId : "T-000",
			requirements: packet.kind === "completion" ? packet.requirements : [],
			claimedOutcome: packet.kind === "completion" ? packet.claimedOutcome : { summary: "" },
			refs: packet.refs,
		});
		expect(built.refs.map((ref) => ref.id)).toEqual(["merge-1", "test-1"]);
		expect(built.refs[0].summary).toBe("pull request 12 merged");
	});

	test("provider-outage yields deterministic-only findings without throwing", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("provider-outage"));
		expect(verdict.sufficient).toBe(false);
		expect(verdict.raw).toEqual({});
		expect(ids(verdict.findings)).toEqual(["stale_revision"]);
		expect(verdict.summary).toContain("unavailable");
	});

	test("a throwing provider fails open", async () => {
		const fixture = await loadFixture("stale-revision");
		const verdict = await evaluateEvidencePacket(fixture.packet, {
			provider: {
				name: "heuristic",
				async evaluate() {
					throw new Error("synthetic provider outage");
				},
			},
		});
		expect(verdict.sufficient).toBe(false);
		expect(ids(verdict.findings)).toEqual(["stale_revision"]);
		expect(verdict.summary).toContain("unavailable");
	});

	test("a hanging provider times out and fails open", async () => {
		const fixture = await loadFixture("stale-revision");
		const verdict = await evaluateEvidencePacket(fixture.packet, {
			provider: { name: "heuristic", evaluate: () => new Promise(() => {}) },
			timeoutMs: 25,
		});
		expect(verdict.sufficient).toBe(false);
		expect(ids(verdict.findings)).toEqual(["stale_revision"]);
		expect(verdict.summary).toContain("timed out");
	});

	test("insufficient-context is flagged and never a reassuring pass", async () => {
		const verdict = await evaluateEvidenceFixture(await loadFixture("insufficient-context"));
		expect(ids(verdict.deterministic)).toEqual(["insufficient_context"]);
		expect(verdict.sufficient).toBe(false);
		expect(ids(verdict.findings)).toContain("insufficient_evidence");
	});

	test("builders enforce deterministic caps with explicit truncation markers", () => {
		const packet = buildCompletionPacket({
			taskId: "T-cap",
			requirements: Array.from({ length: 12 }, (_, index) => `R${index} ${"x".repeat(400)}`),
			exclusions: Array.from({ length: 9 }, (_, index) => `E${index} ${"y".repeat(260)}`),
			claimedOutcome: {
				summary: "s".repeat(1500),
				claims: Array.from({ length: 11 }, (_, index) => `C${index} ${"z".repeat(300)}`),
			},
			revision: { claimed: "abc1234", actual: "abc1234" },
			refs: Array.from({ length: 30 }, (_, index) => ({
				id: `ref-${index}`,
				kind: "tool" as const,
				summary: "synthetic ref",
				source: "synthetic-source",
			})),
		});
		expect(packet.requirements.length).toBeLessThanOrEqual(8);
		expect(packet.requirements.every((item) => item.length <= 280)).toBe(true);
		expect(packet.requirements.at(-1)).toContain("more");
		expect(packet.exclusions.length).toBeLessThanOrEqual(6);
		expect(packet.exclusions.every((item) => item.length <= 200)).toBe(true);
		expect(packet.claimedOutcome.claims.length).toBeLessThanOrEqual(8);
		expect(packet.claimedOutcome.claims.every((item) => item.length <= 240)).toBe(true);
		expect(packet.claimedOutcome.summary.length).toBeLessThanOrEqual(1200);
		expect(packet.claimedOutcome.summary.endsWith("…[truncated]")).toBe(true);
		expect(packet.refs.length).toBeLessThanOrEqual(24);
		expect(packet.refs.at(-1)?.id).toBe("refs-truncated");
		expect(packet.refs.at(-1)?.summary).toContain("...(");
	});

	test("builders keep the first ref copy's source intact", () => {
		const packet = buildHandoffPacket({
			sourceTask: {
				id: "T-source",
				requirements: ["Ship it"],
				exclusions: ["Do not modify scripts/verify"],
			},
			delegation: { assignee: "agent-1", title: "Ship it", body: "Ship the module." },
			refs: [
				{ id: "ref-1", kind: "tool", summary: "first", source: "workspace/first" },
				{ id: "ref-2", kind: "test", summary: "second", source: "ci/second" },
				{ id: "ref-1", kind: "tool", summary: "repeat", source: "workspace/repeat" },
			],
		});
		expect(packet.refs.map((ref) => ref.id)).toEqual(["ref-1", "ref-2"]);
		expect(packet.refs[0].summary).toBe("first");
		expect(packet.refs[0].source).toBe("workspace/first");
	});

	test("every fixture finding is a lead or warning and stays in the verdict", async () => {
		for (const name of fixtureNames) {
			const verdict = await evaluateEvidenceFixture(await loadFixture(name), {
				artifactExists: () => false,
			});
			for (const finding of verdict.deterministic) {
				expect(verdict.findings).toContainEqual(finding);
			}
			for (const finding of verdict.findings) {
				expect(["lead", "warning"]).toContain(finding.severity);
				expect(Array.isArray(finding.refs)).toBe(true);
			}
		}
	});

	test("renderEvidenceAdvice is terse and free of model probabilities", async () => {
		for (const name of ["completion-unsupported", "handoff-dropped", "weakened-acceptance"]) {
			const verdict = await evaluateEvidenceFixture(await loadFixture(name));
			const advice = renderEvidenceAdvice(verdict);
			expect(advice.length).toBe(verdict.findings.length);
			expect(advice.length).toBeGreaterThan(0);
			for (const line of advice) {
				expect(line).toMatch(/^evidence: [\w:]+ — .+\[refs: [^\]]+\]( \(verify: .+\))?$/);
				expect(line).not.toMatch(/\b0\.\d+/);
				expect(line).not.toMatch(/%/);
			}
		}
	});

	test("CLI check prints deterministic findings and exits 0; usage errors exit 2", async () => {
		const fixture = await loadFixture("stale-revision");
		const dir = mkdtempSync(join(tmpdir(), "evidence-cli-"));
		scratch.push(dir);
		const packetPath = join(dir, "packet.json");
		writeFileSync(packetPath, JSON.stringify(fixture.packet));
		const checked = spawnSync(process.execPath, [cli, "check", packetPath], {
			encoding: "utf8",
			timeout: 10_000,
		});
		if (checked.error) throw checked.error;
		expect(checked.status).toBe(0);
		const parsed = JSON.parse(checked.stdout) as ProvenanceFinding[];
		expect(ids(parsed)).toEqual(["stale_revision"]);
		const usage = spawnSync(process.execPath, [cli], { encoding: "utf8", timeout: 10_000 });
		if (usage.error) throw usage.error;
		expect(usage.status).toBe(2);
	});
});