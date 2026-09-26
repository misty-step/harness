import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessFoundations, distillFoundationPackets, openGitSnapshot } from "./foundation-assess.ts";
import type { Answer, Question, SystemOneProvider } from "./engine.ts";

const scratch = mkdtempSync(join(tmpdir(), "foundation-assess-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function git(repo: string, ...args: string[]): void {
	const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
	if (run.status !== 0) throw new Error(`git ${args[0]}: ${run.stderr}`);
}

function fixture(files: Record<string, string>): string {
	const repo = mkdtempSync(join(scratch, "case-"));
	git(repo, "init", "-q");
	git(repo, "config", "user.email", "fixture@example.invalid");
	git(repo, "config", "user.name", "Fixture");
	for (const [path, contents] of Object.entries(files)) {
		const destination = join(repo, path);
		mkdirSync(join(destination, ".."), { recursive: true });
		writeFileSync(destination, contents);
	}
	git(repo, "add", ".");
	git(repo, "commit", "-qm", "fixture");
	return repo;
}

function stub(answer: (id: string, question: Question) => Answer, observe?: (state: string) => void): SystemOneProvider {
	return {
		name: "fixture", requestedModel: "typesafe/jev-1.13",
		async evaluateWithMetadata(state, questions) {
			observe?.(state);
			return { requestedModel: "typesafe/jev-1.13", resolvedModel: "typesafe/jev-1.13-20260917", answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, answer(id, question)])) };
		},
		async evaluate() { throw new Error("evaluateWithMetadata must be used for live model metadata"); },
	};
}

const absent = (): Answer => ({ type: "noul", probability: 0.02, confidence: 0.96 });

function sentryRepo(extra: Record<string, string> = {}): string {
	return fixture({
		"sentry-runtime.ts": "export const runtimeOptions = { release: process.env.GIT_SHA, environment: 'production', sendDefaultPii: false };\n",
		"sentry-init.ts": "import * as Sentry from '@sentry/node';\nimport { runtimeOptions } from './sentry-runtime';\nexport function initSentry() { Sentry.init({ ...runtimeOptions, dsn: process.env.SENTRY_DSN }); }\n",
		"sentry.server.config.ts": "import { initSentry } from './sentry-init';\ninitSentry();\n",
		"sentry.edge.config.ts": "import { initSentry } from './sentry-init';\ninitSentry();\n",
		...extra,
	});
}

describe("foundation assessment advisory", () => {
	test("follows an imported spread into init options from the committed Git snapshot", () => {
		const repo = sentryRepo();
		writeFileSync(join(repo, "sentry-runtime.ts"), "export const runtimeOptions = { release: 'uncommitted' };\n");
		const snapshot = openGitSnapshot(repo);
		expect(snapshot.ref).toBe("HEAD");
		const packet = distillFoundationPackets(repo, snapshot, "sentry").packets[0];
		expect(packet.state).toContain("release: process.env.GIT_SHA");
		expect(packet.state).not.toContain("uncommitted");
		expect(packet.coverage.hops_followed).toContainEqual({ from: "sentry-init.ts", to: "sentry-runtime.ts", symbol: "runtimeOptions" });
	});

	test("follows a spread's factory and a shorthand privacy hook through imports", () => {
		const repo = fixture({
			"sentry-init.ts": "import * as Sentry from '@sentry/nextjs';\nimport {\n  beforeSend,\n} from '@/lib/privacy';\nimport { getRuntimeOptions } from './runtime';\nconst runtimeOptions = getRuntimeOptions();\nSentry.init({ ...runtimeOptions, beforeSend });\n",
			"runtime.ts": "export function getRuntimeOptions() { return { sendDefaultPii: false }; }\n",
			"lib/privacy.ts": "export function beforeSend(event) { delete event.user; return event; }\nexport function beforeSendTransaction<T extends Event>(event: T): T { return event; }\n",
			"instrumentation-client.ts": "// Dynamic: keep the privacy module out of QA/dev when Sentry is disabled.\nimport * as Sentry from '@sentry/nextjs';\nconst { beforeSendTransaction } = await import('./lib/privacy');\nSentry.init({ beforeSendTransaction });\n",
		});
		const packet = distillFoundationPackets(repo, openGitSnapshot(repo), "sentry").packets[0];
		expect(packet.state).toContain("sendDefaultPii: false");
		expect(packet.state).toContain("delete event.user");
		expect(packet.coverage.hops_followed).toContainEqual({ from: "instrumentation-client.ts", to: "lib/privacy.ts", symbol: "beforeSendTransaction" });
		expect(packet.coverage.unresolved_symbols).toEqual([]);
	});

	test("captures server and edge wrapper invocations as separate call sites", () => {
		const repo = sentryRepo();
		const state = distillFoundationPackets(repo, openGitSnapshot(repo), "sentry").packets[0].state;
		expect(state).toContain('"path":"sentry.server.config.ts"');
		expect(state).toContain('"path":"sentry.edge.config.ts"');
		expect(state.match(/"kind":"wrapper_call:initSentry"/g)?.length).toBe(2);
	});

	test("follows a delegated Sentry initializer and its client/server entrypoints", () => {
		const repo = fixture({
			"src/sentry.ts": "import * as Sentry from '@sentry/nextjs';\nexport function scrub(event) { delete event.user; return event; }\nexport function initSentry(initializer = Sentry) { initializer.init({ enabled: true, beforeSend: scrub }); }\n",
			"instrumentation-client.ts": "import { initSentry } from './src/sentry';\ninitSentry();\n",
			"sentry.server.config.ts": "import { initSentry } from './src/sentry';\ninitSentry();\n",
		});
		const packet = distillFoundationPackets(repo, openGitSnapshot(repo), "sentry").packets[0];
		expect(packet.state).toContain("initializer.init({ enabled: true, beforeSend: scrub })");
		expect(packet.state).toContain("delete event.user");
		expect(packet.coverage.hops_followed).toContainEqual({ from: "src/sentry.ts", to: "instrumentation-client.ts", symbol: "initSentry" });
		expect(packet.coverage.hops_followed).toContainEqual({ from: "src/sentry.ts", to: "sentry.server.config.ts", symbol: "initSentry" });
	});

	test("retains complete plugin options including source-map deletion beyond line 40", () => {
		const config = ["import { withSentryConfig } from '@sentry/nextjs';", "export default withSentryConfig({}, {", ...Array.from({ length: 45 }, (_, n) => `  // configured option line ${n + 1}`), "  authToken: process.env.SENTRY_AUTH_TOKEN,", "  sourcemaps: { deleteSourcemapsAfterUpload: true },", "});"].join("\n");
		const repo = sentryRepo({ "next.config.ts": config });
		const packet = distillFoundationPackets(repo, openGitSnapshot(repo), "sentry").packets[0];
		expect(packet.state).toContain("deleteSourcemapsAfterUpload: true");
		expect(packet.facts.some((fact) => fact.includes("injects its release and uploads source maps"))).toBe(true);
	});

	test("resolves an imported bundler options object without dropping late sourcemap flags", () => {
		const repo = fixture({
			"build-options.ts": ["export const pluginOptions = {", ...Array.from({ length: 45 }, (_, n) => `  // build line ${n + 1}`), "  authToken: process.env.SENTRY_AUTH_TOKEN,", "  sourcemaps: { deleteSourcemapsAfterUpload: true },", "};"].join("\n"),
			"next.config.ts": "import { withSentryConfig } from '@sentry/nextjs';\nimport { pluginOptions } from './build-options';\nexport default withSentryConfig({}, pluginOptions);\n",
		});
		const packet = distillFoundationPackets(repo, openGitSnapshot(repo), "sentry").packets[0];
		expect(packet.state).toContain("deleteSourcemapsAfterUpload: true");
		expect(packet.coverage.hops_followed).toContainEqual({ from: "next.config.ts", to: "build-options.ts", symbol: "pluginOptions" });
	});

	test("records an unresolved option with every question it could affect", () => {
		const repo = sentryRepo({ "next.config.ts": "import * as Sentry from '@sentry/nextjs';\nimport { withSentryConfig } from '@sentry/nextjs';\nSentry.init({ ...missingOptions });\nexport default withSentryConfig({}, { ...missingOptions });\n" });
		const entry = distillFoundationPackets(repo, openGitSnapshot(repo), "sentry").packets[0].coverage.unresolved_symbols.find((item) => item.symbol === "missingOptions");
		expect(entry?.questions).toEqual(expect.arrayContaining(["release_set", "scrub_hook", "sourcemaps_uploaded", "sourcemaps_not_public"]));
	});

	test("applies inclusive thresholds, and Sentry excerpts never support an absence", async () => {
		const repo = sentryRepo({ "docs/postmortems/INCIDENT-1.md": "# Incident\n## Follow-up\nAdd a test.\n", "WATCHDOG.md": "1. Stop lost events\n" });
		const answers: Record<string, Answer> = {
			regression_check_named: { type: "noul", probability: 0.2, confidence: 0.9 },
			closes_class: { type: "noul", probability: 0.21, confidence: 0.9 },
			release_set: { type: "noul", probability: 0.02, confidence: 0.99 },
			environment_set: { type: "noul", probability: 0.79, confidence: 0.9 },
			prod_capture_on: { type: "noul", probability: 0.8, confidence: 0.9 },
			fix_kind: { type: "choice", choice: "automated_check", probabilities: { automated_check: 0.69 }, confidence: 0.69 },
			mechanical: { type: "choice", choice: "mechanical", probabilities: { mechanical: 0.7 }, confidence: 0.7 },
		};
		const record = await assessFoundations({ repo, snapshot: openGitSnapshot(repo), pack: "all", provider: stub((id) => answers[id] ?? { type: "noul", probability: 0.5, confidence: 0 }) });
		const outcomes = Object.fromEntries(record.packets.flatMap((packet) => packet.questions.map((question) => [question.id, question.outcome])));
		expect(outcomes).toMatchObject({ regression_check_named: "no_finding", closes_class: "escalate", release_set: "abstained", environment_set: "escalate", prod_capture_on: "finding", fix_kind: "escalate", mechanical: "finding" });
	});

	test("provider failure is unavailable, not an absent finding", async () => {
		const repo = sentryRepo();
		const provider: SystemOneProvider = { name: "fixture", async evaluate() { throw new Error("transport leaked-credential-123456789"); } };
		const record = await assessFoundations({ repo, snapshot: openGitSnapshot(repo), pack: "sentry", provider });
		expect(record.packets[0].questions.every((answer) => answer.outcome === "unavailable")).toBe(true);
		expect(JSON.stringify(record)).not.toContain("leaked-credential-123456789");
	});

	test("redacts planted credentials, including a multi-line key, before any provider receives a packet", async () => {
		const planted = "planted-secret-value-do-not-send-123456789";
		// Built at runtime like review-check's fixture, so the source holds no key block for the secret scanner.
		const [begin, end] = [["-----BEGIN", "PRIVATE KEY-----"].join(" "), ["-----END", "PRIVATE KEY-----"].join(" ")];
		const repo = sentryRepo({
			"next.config.ts": `withSentryConfig({}, { authToken: "${planted}" });\n`,
			"sentry-dsn.ts": "Sentry.init({ dsn: 'https://fixturepublickey@o0.ingest.example.invalid/1' });\n",
			"docs/postmortems/INCIDENT-2.md": ["# Incident", "## Follow-up", begin, "fakekeybodylineone0000000000000000", "fakekeybodylinetwo1111111111111111", end, "Rotate the key."].join("\n"),
			// The guard window before this init starts inside the key, past its BEGIN marker.
			"sentry-guarded.ts": ["import * as Sentry from '@sentry/node';", "export function initGuarded() {", `  /* ${begin}`, ...Array.from({ length: 50 }, (_, n) => `  fakeguardkeybody${String(n).padStart(2, "0")}aaaaaaaaaaaaaaaaaaaaaaaa`), `  ${end} */`, "  Sentry.init({ enabled: true });", "}"].join("\n"),
		});
		let seen = "";
		await assessFoundations({ repo, snapshot: openGitSnapshot(repo), pack: "all", provider: stub(absent, (state) => { seen += state; }) });
		expect(seen).toContain("[REDACTED:suspected-secret]");
		expect(seen).toContain("[REDACTED:sentry-dsn]");
		expect(seen).toContain("docs/postmortems/INCIDENT-2.md:7: Rotate the key.");
		for (const secret of ["fixturepublickey", planted, "fakekeybodylineone", "fakekeybodylinetwo", "fakeguardkeybody"]) expect(seen).not.toContain(secret);
	});

	test("captures whole live definitions and records what it cannot follow", async () => {
		const repo = fixture({
			"sentry-init.ts": "import * as Sentry from '@sentry/node';\nimport { options, environmentOptions } from './options';\nimport { getRelease, getPrivacy, getMode, getLong } from './release';\nimport defaults from './defaults';\n// Sentry.init({ environment: 'commented-init' });\nSentry.init(options);\nSentry.init(environmentOptions);\nSentry.init(getRelease());\nSentry.init(getPrivacy());\nSentry.init(getMode());\nSentry.init(getLong());\nSentry.init(defaults);\n",
			"defaults.ts": "// export default { environment: 'commented-default' };\nexport default { environment: 'live-default' };\n",
			"worker.py": "import sentry_sdk\n# sentry_sdk.init(environment='commented-python')\nsentry_sdk.init(environment='live-python')\n",
			"options.ts": "import { privacyOptions } from './privacy';\n// export const options = { environment: 'commented-out' };\nexport const options = { ...privacyOptions, environment: 'production' };\nexport const environmentOptions = process.env.CI\n  ? { environment: 'ci' }\n  : { environment: 'local' };\n",
			"release.ts": `export function getRelease(): { release: string } { return { release: 'x', sendDefaultPii: true }; }\nexport function getPrivacy(): { pii: boolean } // runtime options\n{\n  return { attachStacktrace: false, maxBreadcrumbs: 7 };\n}\nexport function getMode<T>(): T extends { strict: true } ? { mode: 'a' } : { mode: 'b' } /* by mode */ { return { maxValueLength: 9 } as never; }\nexport function getLong(): { long: true } // ${"a long explanation ".repeat(120)}\n{ return { maxValueLength: 11 } as never; }\n`,
		});
		const snapshot = openGitSnapshot(repo);
		const state = distillFoundationPackets(repo, snapshot, "sentry").packets[0].state;
		expect(state).toContain("maxValueLength: 9");
		expect(state).toContain("maxValueLength: 11");
		expect(state).toContain("sendDefaultPii: true");
		expect(state).toContain("maxBreadcrumbs: 7");
		for (const live of ["live-default", "live-python"]) expect(state).toContain(live);
		for (const commentedOut of ["commented-out", "commented-init", "commented-default", "commented-python"]) expect(state).not.toContain(commentedOut);
		const coverage = distillFoundationPackets(repo, snapshot, "sentry").packets[0].coverage;
		expect(coverage.unresolved_symbols.map((item) => item.symbol).sort()).toEqual(["environmentOptions", "privacyOptions"]);
	});

	test("keeps the conditions that decide whether Sentry initializes", () => {
		const repo = fixture({
			"sentry-init.ts": "import * as Sentry from '@sentry/node';\nexport function initSentry() {\n  if (!process.env.SENTRY_DSN) return;\n  Sentry.init({ enabled: true });\n}\n",
			"instrumentation.ts": "import { initSentry } from './sentry-init';\nif (process.env.NODE_ENV !== 'production') {\n  initSentry();\n}\n",
		});
		const state = distillFoundationPackets(repo, openGitSnapshot(repo), "sentry").packets[0].state;
		expect(state).toContain("if (!process.env.SENTRY_DSN) return;");
		expect(state).toContain("if (process.env.NODE_ENV !== 'production') {");
	});

	test("selects only relevant postmortem sections and excludes templates", () => {
		const repo = fixture({
			"docs/postmortems/INCIDENT-7.md": "# Incident\n## Timeline\nprivate distractor\n## What shipped\nCompleted safe parser\n## Follow-up\nAdd regression suite\n### Action items\nOwner change\n## Appendix\nprivate appendix\n",
			"docs/postmortems/TEMPLATE.md": "# Template\n## Follow-up\nnot an incident\n",
			"operations/incidents/README.md": "# Incidents\n## Follow-up\nHow to file one\n",
			"INCIDENT-TEMPLATE.md": "# Incident\n## Resolution\nFill in\n",
		});
		const packets = distillFoundationPackets(repo, openGitSnapshot(repo), "postmortems").packets;
		expect(packets.map((item) => item.source)).toEqual(["docs/postmortems/INCIDENT-7.md"]);
		expect(packets[0].state).toContain("Add regression suite");
		expect(packets[0].state).toContain("Completed safe parser");
		expect(packets[0].state).toContain("Owner change");
		expect(packets[0].state).not.toContain("private distractor");
		expect(packets[0].state).not.toContain("private appendix");
	});

	test("a capped incident never turns absent evidence into a clean answer", async () => {
		const repo = fixture({ "INCIDENT-long.md": `# Incident\n## Resolution\n${"Changed safe parser behavior. ".repeat(500)}\n` });
		const snapshot = openGitSnapshot(repo);
		const packet = distillFoundationPackets(repo, snapshot, "postmortems").packets[0];
		expect(packet.state.length).toBe(8000);
		expect(packet.state).toContain("[truncated: selected sections]");
		const result = await assessFoundations({ repo, snapshot, pack: "postmortems", provider: stub((_, q) => q.type === "choice" ? { type: "choice", choice: "automated_check", probabilities: { automated_check: 0.9 }, confidence: 0.9 } : absent()) });
		expect(result.packets[0].questions.find((item) => item.id === "regression_check_named")?.outcome).toBe("abstained");
	});

	test("ledger asks one question per written rule and reports prose it cannot split", () => {
		const repo = fixture({ "DOMAIN.md": "# Product\n## Invariants\n- Price nonnegative\n- Every task has owner\n## Another invariant\n\nNever rename SQL columns.\nNever add tenant_id.\n\n```ts\nnot a rule\n```\n## Details\n- unrelated\n", "WATCHDOG.md": "# Priorities\n1. Stop lost events\n2. Restore missing tests\n" });
		const { packets, unassessed } = distillFoundationPackets(repo, openGitSnapshot(repo), "ledger");
		expect(packets.map((packet) => packet.state)).toEqual(["Price nonnegative", "Every task has owner", "Stop lost events", "Restore missing tests"]);
		expect(unassessed.map((item) => item.source)).toEqual(["DOMAIN.md:7-8"]);
	});

	test("an unpinned or unapproved model never yields findings, and an unpinned one never receives a packet", async () => {
		const repo = sentryRepo();
		const answers = (questions: Record<string, Question>) => Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", probability: 0.95, confidence: 0.9 } as Answer]));
		const unapproved: SystemOneProvider = {
			name: "openrouter", requestedModel: "typesafe/jev-1.13",
			async evaluate() { throw new Error("metadata only"); },
			async evaluateWithMetadata(_state, questions) { return { requestedModel: "typesafe/jev-1.13", resolvedModel: "typesafe/jev-1.13-20991231", answers: answers(questions) }; },
		};
		let sent = 0;
		const unpinned: SystemOneProvider = {
			name: "openrouter", requestedModel: "other/model",
			async evaluate() { throw new Error("metadata only"); },
			async evaluateWithMetadata(_state, questions) { sent++; return { requestedModel: "other/model", resolvedModel: "typesafe/jev-1.13-20260917", answers: answers(questions) }; },
		};
		for (const provider of [unapproved, unpinned]) {
			const record = await assessFoundations({ repo, snapshot: openGitSnapshot(repo), pack: "sentry", provider });
			expect(record.packets[0].questions.every((answer) => answer.outcome === "abstained")).toBe(true);
		}
		expect(sent).toBe(0);
	});

	test("invalid invocation exits 2 through the actual CLI", () => {
		const cli = join(import.meta.dir, "../bin/foundation-assess.ts");
		for (const args of [["--repo"], ["--repo", "/does/not/exist"], ["--repo", "x", "--timeout-ms", "0"]]) {
			const run = spawnSync("bun", [cli, ...args], { encoding: "utf8" });
			expect(run.status).toBe(2);
		}
	});
});
