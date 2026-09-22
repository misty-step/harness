import { spawnSync } from "node:child_process";

export type QuestionType = "noul" | "choice" | "score";

export type NoulQuestion = {
	type: "noul";
	instructions: string;
	criteria?: { true?: string; false?: string };
};

export type ChoiceQuestion = {
	type: "choice";
	instructions: string;
	criteria: Record<string, string | null>;
};

export type ScoreQuestion = {
	type: "score";
	instructions: string;
	criteria: string[];
};

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = {
	type: "noul";
	probability: number;
	confidence: number;
};

export type ChoiceAnswer = {
	type: "choice";
	choice: string;
	probabilities: Record<string, number>;
	/** Provider confidence; `undefined` when the API omits it — never fabricate. */
	confidence?: number;
};

export type ScoreAnswer = {
	type: "score";
	score: number;
	legend?: Record<string, string>;
	probabilities: Record<string, number>;
	/** Provider confidence; `undefined` when the API omits it — never fabricate. */
	confidence?: number;
};

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/**
 * Preserve a provider confidence value exactly. A missing or non-finite value
 * stays `undefined` so consumers can reject the answer instead of acting on a
 * fabricated default that could clear a gate the provider never set.
 */
function normalizeConfidence(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export type RuleFinding = {
	rule: string;
	category: "security" | "taste" | "pokayoke" | "strategy" | "verification";
	severity: "block" | "warning";
	message: string;
	evidence: string;
	probability: number;
	confidence: number;
};

export type ReviewVerdict = {
	passed: boolean;
	clean: boolean;
	enabled: boolean;
	provider: "typesafe" | "openrouter" | "heuristic" | "none";
	latencyMs: number;
	stats: {
		linesAdded: number;
		linesRemoved: number;
		filesChanged: number;
	};
	blocks: RuleFinding[];
	warnings: RuleFinding[];
	summary: string;
};

export interface SystemOneProvider {
	readonly name: "typesafe" | "openrouter" | "heuristic";
	evaluate(
		state: string,
		questions: Record<string, Question>,
		timeoutMs?: number,
	): Promise<Record<string, Answer>>;
}

/**
 * Categorized question batteries embodying harness engineering philosophies.
 */
export const SECURITY_BATTERY: Record<string, Question> = {
	credential_leak: {
		type: "noul",
		instructions:
			"Does this diff introduce an active API key, raw authentication token, private key, or password in plaintext?",
		criteria: {
			true: "Contains unmasked private key, secret token, or active API credential",
			false: "No unmasked credentials present",
		},
	},
	disk_secret_persistence: {
		type: "noul",
		instructions:
			"Does this diff write or persist live credentials to a file on disk rather than using runtime memory injection (pass-env, op run)?",
		criteria: {
			true: "Writes plaintext credentials to local file or renders secrets to disk",
			false: "Credentials injected into runtime memory or no secrets touched",
		},
	},
	authority_escalation: {
		type: "noul",
		instructions:
			"Does this diff or script invoke unverified root/sudo commands, modify system-wide sudoers/polkit policies, or bypass authentication boundaries?",
		criteria: {
			true: "Elevates privilege to root without sanitization or tampers with security policies",
			false: "Runs within ordinary user privileges and bounds",
		},
	},
	prompt_injection_risk: {
		type: "noul",
		instructions:
			"Does this diff take untrusted external content (web, issues, PR comments) and pass it into execution or unquoted instructions without boundary sanitization?",
		criteria: {
			true: "Exposes execution or instruction boundaries directly to untrusted input",
			false: "Treats external content as inert data",
		},
	},
};

export const TASTE_BATTERY: Record<string, Question> = {
	torvalds_taste: {
		type: "score",
		instructions:
			"Linus Torvalds taste criterion: is this a real, necessary, surgical change with no garbage, or an ugly hack that will rot?",
		criteria: [
			"Garbage or a clever hack that papers over the real bug",
			"Works, but ugly; would be rejected in a disciplined kernel-style review",
			"Clean, necessary, and no more than the problem requires",
		],
	},
	ousterhout_complexity: {
		type: "choice",
		instructions:
			"John Ousterhout complexity criterion: does this add complexity (special cases, shallow modules, leaked internals) or hide complexity behind a deep, simple interface?",
		criteria: {
			deep_module: "Deep module: simple interface, complexity hidden",
			acceptable_surface: "Acceptable: some new surface, still cohesive and self-contained",
			complexity_spreading: "Complexity spreading: special cases, shallow wrappers, or leaked internals",
		},
	},
	needless_abstraction: {
		type: "noul",
		instructions:
			"Does this diff introduce a helper, wrapper class, factory, or abstraction layer that is only used by a single caller?",
		criteria: {
			true: "Introduces single-caller indirection or speculative abstraction",
			false: "Inlines behavior or serves multiple independent callsites",
		},
	},
	weightless_code: {
		type: "noul",
		instructions:
			"Does this diff introduce code that performs no observable work (e.g. redundant defensive null checks on internal invariants, forwarders, mock echoes)?",
		criteria: {
			true: "Adds dead code, tautological type guards, or non-functional forwarders",
			false: "All added code performs observable contract work",
		},
	},
	incomplete_cutover: {
		type: "noul",
		instructions:
			"Does this diff introduce a new path while leaving deprecated aliases, shims, or obsolete paths behind rather than performing a clean cutover?",
		criteria: {
			true: "Leaves deprecated shims or duplicate paths active",
			false: "Performs clean cutover migrating all callers",
		},
	},
	accidental_churn: {
		type: "score",
		instructions:
			"Rate incidental churn: surgical is targeted; severe_sprawl is widespread unrelated reformatting or touching unaffected files.",
		criteria: [
			"Surgical and minimal change to relevant lines only",
			"Minor incidental whitespace or comment noise",
			"Moderate reformatting or touching adjacent functions",
			"Severe sprawl touching unrelated modules or widespread restyling",
		],
	},
};

export const POKAYOKE_BATTERY: Record<string, Question> = {
	pokayoke_mechanism: {
		type: "choice",
		instructions:
			"What is the mechanism of the fix or change in this diff? Pick the primary category.",
		criteria: {
			structural_type_or_shape: "Eliminates failure class structurally via types, shape, or API design",
			fail_closed_check: "Enforces strict fail-closed boundary validation before execution",
			removed_affordance: "Removes dangerous capability or API affordance entirely",
			suppressed_symptom: "Silences error, catches and ignores exception, or masks symptoms",
			warning_or_comment: "Adds a warning log, comment, or instruction instead of mechanical guard",
			feature_addition: "Standard feature or capability addition",
		},
	},
	preserves_root_cause: {
		type: "noul",
		instructions:
			"Does this diff handle an invalid state after it occurred (e.g. silencing an exception or null-checking a corrupted state) instead of eliminating the root cause?",
		criteria: {
			true: "Suppresses symptom or paper-overs invalid state downstream",
			false: "Pushes invariant upstream or makes invalid state unrepresentable",
		},
	},
	fails_open: {
		type: "noul",
		instructions:
			"Does this diff introduce or modify a boundary guard, parser, or security check in a way that fails open (allowing execution on invalid or unknown input) rather than failing closed?",
		criteria: {
			true: "Validation/guard fails open or permits execution on malformed/unknown input",
			false: "Fails closed, safely rejects invalid input, or diff does not modify boundary guards",
		},
	},
	tests_missing: {
		type: "noul",
		instructions:
			"Is this a non-trivial behavioral change that lacks any corresponding test in the diff or nearby test files?",
		criteria: {
			true: "Behavior changed and no test defense came with it",
			false: "Tests are included or change is purely docs/trivia",
		},
	},
};

export const STRATEGY_BATTERY: Record<string, Question> = {
	hickey_complecting: {
		type: "noul",
		instructions:
			"Rich Hickey: does this intertwine two concerns that could have remained independent (complecting), rather than composing simple things?",
		criteria: {
			true: "Two reasons to change are now braided in one place",
			false: "Concerns remain orthogonal and composed",
		},
	},
	erasure: {
		type: "noul",
		instructions:
			"Could this diff be erased entirely without a user noticing a lost capability (dead surface, speculative flexibility, or ornamental code)?",
		criteria: {
			true: "Deletable surface with no user capability at stake",
			false: "Every added line serves a necessary outcome",
		},
	},
	small_app: {
		type: "noul",
		instructions:
			"Does this diff grow a kernel/framework where a focused small tool or caller-owned script would be simpler and more inspectable?",
		criteria: {
			true: "Framework or kernel expansion instead of a focused tool",
			false: "Minimal focused mechanism",
		},
	},
	scope_creep: {
		type: "noul",
		instructions:
			"Does this diff bundle unrequested opportunistic refactoring, unrelated style fixes, or changes outside the stated task?",
		criteria: {
			true: "Unrelated files or features rode along with the change",
			false: "Diff remains focused on one cohesive objective",
		},
	},
	user_visible_impact: {
		type: "noul",
		instructions:
			"Does this change serve a user-visible capability (a requirement in USER_STORIES.md or verified contract), rather than harness trivia with no user outcome?",
		criteria: {
			true: "Serves a user capability, observable contract, or eliminates a failure class",
			false: "Harness trivia with no observable outcome",
		},
	},
};

export const VERIFICATION_BATTERY: Record<string, Question> = {
	test_asserts_implementation: {
		type: "noul",
		instructions:
			"Do the added tests merely assert internal wiring, mock calls, or parameter forwarding rather than observable consumer postconditions?",
		criteria: {
			true: "Asserts mocks, spy counts, or internal implementation details",
			false: "Asserts observable contract output and domain behavior",
		},
	},
	is_test_padding: {
		type: "noul",
		instructions:
			"Is any added test a tautology, a bare not-throw, or testing incidental wording rather than defending against a plausible regression?",
		criteria: {
			true: "Padding test that cannot fail on realistic regression",
			false: "High-signal test defending against plausible bug",
		},
	},
	plausible_bug_defense: {
		type: "score",
		instructions:
			"Rate how effectively added tests defend against realistic regressions: 0 is tautology; 3 is critical contract invariant.",
		criteria: [
			"Tautology or bare not-throw (zero regression defense)",
			"Tests implementation trivia that changes with refactors",
			"Defends observable consumer boundary",
			"Defends critical system contract or failure invariant",
		],
	},
};

export const MACRO_BATTERY: Record<string, Question> = {
	blast_radius: {
		type: "choice",
		instructions:
			"Classify the blast radius of this changeset based on the structural map of modified files and symbols.",
		criteria: {
			isolated_leaf: "Localized change affecting a single component, leaf utility, or isolated test",
			module_internal: "Internal module or feature implementation without breaking external public API contracts",
			cross_cutting: "Touches shared protocols, core configuration, authentication, or cross-cutting subsystems",
			architectural_shift: "Major refactor, framework expansion, or fundamental structural migration",
		},
	},
	primary_risk_area: {
		type: "choice",
		instructions:
			"Identify the primary risk domain that requires closest semantic scrutiny in this diff.",
		criteria: {
			credentials_or_auth: "Touches security, tokens, secrets, keyrings, or permissions",
			correctness_and_logic: "Touches business logic, decision gates, state transitions, or algorithm correctness",
			breaking_api_change: "Alters public types, signatures, CLI flags, or wire schemas",
			test_and_docs_only: "Low risk: changes are limited to tests, documentation, or static assets",
			low_risk_cosmetic: "Minimal risk: comments, typos, or minor styling adjustments",
		},
	},
	recommended_review_depth: {
		type: "choice",
		instructions:
			"What level of System One semantic review does this changeset warrant?",
		criteria: {
			fast_security_gate: "Security-only pass is sufficient (docs, tests, or trivial changes)",
			standard_review: "Standard multi-battery review across taste, pokayoke, and verification",
			deep_hierarchical_review: "Deep multi-chunk review with strict invariant enforcement",
		},
	},
};

export type BatteryName = "all" | "security" | "taste" | "pokayoke" | "strategy" | "verification" | "macro";

export const BATTERIES: Record<BatteryName, Record<string, Question>> = {
	security: SECURITY_BATTERY,
	taste: TASTE_BATTERY,
	pokayoke: POKAYOKE_BATTERY,
	strategy: STRATEGY_BATTERY,
	verification: VERIFICATION_BATTERY,
	macro: MACRO_BATTERY,
	all: {
		...SECURITY_BATTERY,
		...TASTE_BATTERY,
		...POKAYOKE_BATTERY,
		...STRATEGY_BATTERY,
		...VERIFICATION_BATTERY,
	},
};

export const HARNESS_BATTERY = BATTERIES.all;

/**
 * Native TypeSafe Jev Provider.
 */
export class TypeSafeJevProvider implements SystemOneProvider {
	readonly name = "typesafe" as const;

	constructor(
		private apiKey: string,
		private endpoint = "https://api.typesafe.ai/v1/systemone",
		private model = "jev-latest",
	) {}

	async evaluate(
		state: string,
		questions: Record<string, Question>,
		timeoutMs = 15000,
	): Promise<Record<string, Answer>> {
		const payload = {
			model: this.model,
			state,
			questions,
		};

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(this.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			if (!res.ok) {
				const errorText = await res.text();
				throw new Error(`TypeSafe API error ${res.status}: ${errorText}`);
			}

			const data = (await res.json()) as {
				model?: string;
				answers?: Record<
					string,
					| { type: "noul"; noul: number }
					| { type: "choice"; choice: string; probabilities: Record<string, number>; confidence?: number }
					| { type: "score"; score: number; legend?: Record<string, string>; probabilities: Record<string, number>; confidence?: number }
				>;
				usage?: { input_tokens: number; output_tokens: number };
			};

			const results: Record<string, Answer> = {};

			if (data.answers) {
				for (const [key, raw] of Object.entries(data.answers)) {
					if (raw.type === "noul") {
						const conf = Math.abs(raw.noul - 0.5) * 2;
						results[key] = {
							type: "noul",
							probability: raw.noul,
							confidence: conf,
						};
					} else if (raw.type === "choice") {
						results[key] = {
							type: "choice",
							choice: raw.choice,
							probabilities: raw.probabilities ?? {},
							confidence: normalizeConfidence(raw.confidence),
						};
					} else if (raw.type === "score") {
						results[key] = {
							type: "score",
							score: raw.score,
							legend: raw.legend,
							probabilities: raw.probabilities ?? {},
							confidence: normalizeConfidence(raw.confidence),
						};
					}
				}
			}

			return results;
		} finally {
			clearTimeout(timer);
		}
	}
}

/**
 * OpenRouter TypeSafe Jev Provider.
 */
export class OpenRouterJevProvider implements SystemOneProvider {
	readonly name = "openrouter" as const;

	constructor(
		private apiKey: string,
		private model = "typesafe/jev-1.13",
		private endpoint = "https://openrouter.ai/api/alpha/decisions",
	) {}

	async evaluate(
		state: string,
		questions: Record<string, Question>,
		timeoutMs = 15000,
	): Promise<Record<string, Answer>> {
		const payload = {
			model: this.model,
			state,
			questions,
		};

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(this.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
					"HTTP-Referer": "https://github.com/misty-step/harness",
					"X-Title": "Harness Semantic Diff Review",
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			if (!res.ok) {
				const errorText = await res.text();
				throw new Error(`OpenRouter Jev error ${res.status}: ${errorText}`);
			}

			const data = (await res.json()) as {
				model?: string;
				answers?: Record<
					string,
					| { type: "noul"; noul: number }
					| { type: "choice"; choice: string; probabilities: Record<string, number>; confidence?: number }
					| { type: "score"; score: number; legend?: Record<string, string>; probabilities: Record<string, number>; confidence?: number }
				>;
				usage?: { input_tokens: number; output_tokens: number };
			};

			const results: Record<string, Answer> = {};

			if (data.answers) {
				for (const [key, raw] of Object.entries(data.answers)) {
					if (raw.type === "noul") {
						const conf = Math.abs(raw.noul - 0.5) * 2;
						results[key] = {
							type: "noul",
							probability: raw.noul,
							confidence: conf,
						};
					} else if (raw.type === "choice") {
						results[key] = {
							type: "choice",
							choice: raw.choice,
							probabilities: raw.probabilities ?? {},
							confidence: normalizeConfidence(raw.confidence),
						};
					} else if (raw.type === "score") {
						results[key] = {
							type: "score",
							score: raw.score,
							legend: raw.legend,
							probabilities: raw.probabilities ?? {},
							confidence: normalizeConfidence(raw.confidence),
						};
					}
				}
			}

			return results;
		} finally {
			clearTimeout(timer);
		}
	}
}

/**
 * Deterministic Heuristic Engine.
 */
export class HeuristicEngine implements SystemOneProvider {
	readonly name = "heuristic" as const;

	async evaluate(
		state: string,
		questions: Record<string, Question>,
	): Promise<Record<string, Answer>> {
		const results: Record<string, Answer> = {};

		for (const [key, q] of Object.entries(questions)) {
			if (q.type === "noul") {
				let prob = 0.05;

				if (key === "credential_leak") {
					if (
						/(?:sk_live_[A-Za-z0-9]{24,}|ghp_[A-Za-z0-9]{30,}|BEGIN (?:RSA|OPENSSH) PRIVATE KEY|AIzaSy[A-Za-z0-9_-]{33}|xox[baprs]-[A-Za-z0-9-]+)/.test(
							state,
						)
					) {
						prob = 0.98;
					}
				} else if (key === "disk_secret_persistence") {
					if (/(?:fs\.writeFileSync|writeFile|>>\s*\.env|doppler secrets download)/.test(state)) {
						prob = 0.88;
					}
				} else if (key === "authority_escalation") {
					if (/(?:sudo\s+-S|chmod\s+777|\/etc\/sudoers|NOPASSWD:\s*ALL)/.test(state)) {
						prob = 0.92;
					}
				} else if (key === "prompt_injection_risk") {
					if (/(?:ignore previous instructions|system prompt|exfiltrate)/i.test(state)) {
						prob = 0.89;
					}
				} else if (key === "needless_abstraction") {
					if (
						/class\s+\w+[\s\S]*?\{[\s\S]*?return\s+\w+\.[a-zA-Z0-9_]+\([^)]*\);?[\s\S]*?\}/.test(state) ||
						/interface\s+I\w+Provider/.test(state)
					) {
						prob = 0.89;
					}
				} else if (key === "weightless_code") {
					if (/if\s*\([^)]*\)\s*return\s*;\s*\/\/\s*defensive/.test(state)) {
						prob = 0.86;
					}
				} else if (key === "incomplete_cutover") {
					if (/TODO:\s*remove|fallbackToOldPath/.test(state)) {
						prob = 0.85;
					}
				} else if (key === "preserves_root_cause") {
					if (
						/try\s*\{[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?\}/.test(
							state,
						)
					) {
						prob = 0.93;
					}
				} else if (key === "fails_open") {
					prob = 0.05;
				} else if (key === "tests_missing") {
					prob = 0.10;
				} else if (key === "hickey_complecting") {
					if (/complect|braided_state|intertwined/i.test(state)) {
						prob = 0.90;
					}
				} else if (key === "erasure") {
					if (/deletable_feature|speculative_flag/i.test(state)) {
						prob = 0.88;
					}
				} else if (key === "small_app") {
					if (/kernel_framework|monolithic_platform/i.test(state)) {
						prob = 0.89;
					}
				} else if (key === "scope_creep") {
					prob = 0.05;
				} else if (key === "user_visible_impact") {
					prob = 0.90;
				} else if (key === "test_asserts_implementation") {
					if (/(?:toHaveBeenCalledWith|calledTimes|spyOn\([^)]*\)\.mock)/.test(state)) {
						prob = 0.87;
					}
				} else if (key === "is_test_padding") {
					if (
						/(?:expect\([^)]*\)\.not\.toThrow\(\)|expect\(true\)\.toBe\(true\)|expect\([^)]*\)\.toBeDefined\(\))/.test(
							state,
						)
					) {
						prob = 0.94;
					}
				}

				results[key] = {
					type: "noul",
					probability: prob,
					confidence: 0.9,
				};
			} else if (q.type === "choice") {
				const optionKeys = Object.keys(q.criteria);
				let choice = optionKeys[0];

				if (key === "pokayoke_mechanism") {
					if (
						/try\s*\{[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?\}/.test(
							state,
						)
					) {
						choice = "suppressed_symptom";
					} else if (/console\.(?:warn|error)|logger\.warn/.test(state)) {
						choice = "warning_or_comment";
					} else if (/type\s+\w+\s*=|enum\s+\w+|readonly/.test(state)) {
						choice = "structural_type_or_shape";
					} else {
						choice = "feature_addition";
					}
				} else if (key === "ousterhout_complexity") {
					if (/class\s+\w+[\s\S]*?\{[\s\S]*?return\s+\w+\.[a-zA-Z0-9_]+\([^)]*\);?[\s\S]*?\}/.test(state)) {
						choice = "complexity_spreading";
					} else {
						choice = "deep_module";
					}
				}

				results[key] = {
					type: "choice",
					choice,
					probabilities: { [choice]: 0.85 },
					confidence: 0.88,
				};
			} else if (q.type === "score") {
				let score = 0;
				if (key === "accidental_churn") {
					const lines = state.split("\n").length;
					if (lines > 300) score = 3;
					else if (lines > 120) score = 2;
					else if (lines > 40) score = 1;
				} else if (key === "torvalds_taste") {
					score = /try\s*\{[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?\}/.test(state) ? 0 : 2;
				} else if (key === "plausible_bug_defense") {
					score = /(?:expect\([^)]*\)\.not\.toThrow\(\)|expect\(true\)\.toBe\(true\))/.test(state) ? 0 : 2;
				}

				results[key] = {
					type: "score",
					score,
					probabilities: { [String(score)]: 0.85 },
					confidence: 0.88,
				};
			}
		}

		return results;
	}
}

/**
 * Resolve provider.
 */
export function resolveProvider(forced?: string): SystemOneProvider | null {
	if (forced === "heuristic" || forced === "mock" || process.env.MOCK_SYSTEM_ONE === "1") {
		return new HeuristicEngine();
	}

	if (forced === "typesafe" || (!forced && process.env.TYPESAFE_API_KEY)) {
		const key = process.env.TYPESAFE_API_KEY;
		if (key) return new TypeSafeJevProvider(key);
	}

	if (forced === "openrouter" || (!forced && process.env.OPENROUTER_API_KEY)) {
		const key = process.env.OPENROUTER_API_KEY;
		if (key) {
			const model = process.env.OPENROUTER_JEV_MODEL || "typesafe/jev-1.13";
			return new OpenRouterJevProvider(key, model);
		}
	}

	return null;
}

/**
 * Parse line statistics from git diff.
 */
export function parseDiffStats(diffText: string): {
	linesAdded: number;
	linesRemoved: number;
	filesChanged: number;
} {
	let added = 0;
	let removed = 0;
	const files = new Set<string>();

	for (const line of diffText.split("\n")) {
		if (line.startsWith("diff --git a/")) {
			const m = line.match(/^diff --git a\/(\S+)/);
			if (m) files.add(m[1]);
		} else if (line.startsWith("--- a/") && files.size === 0) {
			const m = line.match(/^--- a\/(\S+)/);
			if (m) files.add(m[1]);
		} else if (line.startsWith("+") && !line.startsWith("+++")) {
			added++;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			removed++;
		}
	}

	return {
		linesAdded: added,
		linesRemoved: removed,
		filesChanged: Math.max(files.size, diffText.trim() ? 1 : 0),
	};
}

export interface FileDiffChunk {
	path: string;
	diff: string;
	linesAdded: number;
	linesRemoved: number;
}

export interface DiffChunk {
	id: string;
	diff: string;
	paths: string[];
}

/**
 * Split unified diff text into per-file chunks.
 */
export function splitDiffIntoFiles(diffText: string): FileDiffChunk[] {
	const chunks: FileDiffChunk[] = [];
	const lines = diffText.split("\n");
	let currentPath = "unknown";
	let currentLines: string[] = [];
	let added = 0;
	let removed = 0;

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			if (currentLines.length > 0) {
				chunks.push({
					path: currentPath,
					diff: currentLines.join("\n"),
					linesAdded: added,
					linesRemoved: removed,
				});
				currentLines = [];
				added = 0;
				removed = 0;
			}
			const match = line.match(/^diff --git a\/\S+ b\/(\S+)/);
			currentPath = match ? match[1] : "unknown";
		}
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		if (line.startsWith("-") && !line.startsWith("---")) removed++;
		currentLines.push(line);
	}
	if (currentLines.length > 0) {
		chunks.push({
			path: currentPath,
			diff: currentLines.join("\n"),
			linesAdded: added,
			linesRemoved: removed,
		});
	}
	return chunks;
}

function splitFileByHunks(file: FileDiffChunk, maxChunkChars: number): DiffChunk[] {
	const lines = file.diff.split("\n");
	const headerLines: string[] = [];
	let i = 0;
	while (i < lines.length && !lines[i].startsWith("@@ ")) {
		headerLines.push(lines[i]);
		i++;
	}
	const header = headerLines.join("\n");

	const hunks: string[] = [];
	let currentHunk: string[] = [];
	for (; i < lines.length; i++) {
		if (lines[i].startsWith("@@ ") && currentHunk.length > 0) {
			hunks.push(currentHunk.join("\n"));
			currentHunk = [];
		}
		currentHunk.push(lines[i]);
	}
	if (currentHunk.length > 0) {
		hunks.push(currentHunk.join("\n"));
	}

	if (hunks.length <= 1) {
		const slices: DiffChunk[] = [];
		let pos = 0;
		let idx = 1;
		while (pos < file.diff.length) {
			const sliceText = file.diff.slice(pos, pos + maxChunkChars);
			slices.push({
				id: `${file.path}-part-${idx++}`,
				diff: `[File: ${file.path} | Part ${idx - 1}]\n${sliceText}`,
				paths: [file.path],
			});
			pos += maxChunkChars;
		}
		return slices;
	}

	const result: DiffChunk[] = [];
	let batch: string[] = [];
	let batchLen = header.length;

	for (const hunk of hunks) {
		if (batchLen + hunk.length > maxChunkChars && batch.length > 0) {
			result.push({
				id: `${file.path}-hunks-${result.length + 1}`,
				diff: `${header}\n${batch.join("\n")}`,
				paths: [file.path],
			});
			batch = [];
			batchLen = header.length;
		}
		batch.push(hunk);
		batchLen += hunk.length + 1;
	}
	if (batch.length > 0) {
		result.push({
			id: `${file.path}-hunks-${result.length + 1}`,
			diff: `${header}\n${batch.join("\n")}`,
			paths: [file.path],
		});
	}
	return result;
}

/**
 * Group file diffs into size-bounded bundles.
 */
export function bundleDiffChunks(files: FileDiffChunk[], maxChunkChars = 20000): DiffChunk[] {
	if (files.length === 0) return [];

	const chunks: DiffChunk[] = [];
	let currentBatch: FileDiffChunk[] = [];
	let currentLength = 0;

	for (const file of files) {
		if (file.diff.length > maxChunkChars) {
			if (currentBatch.length > 0) {
				chunks.push({
					id: `bundle-${chunks.length + 1}`,
					diff: currentBatch.map((f) => f.diff).join("\n\n"),
					paths: currentBatch.map((f) => f.path),
				});
				currentBatch = [];
				currentLength = 0;
			}
			const hunkChunks = splitFileByHunks(file, maxChunkChars);
			chunks.push(...hunkChunks);
			continue;
		}

		if (currentLength + file.diff.length > maxChunkChars && currentBatch.length > 0) {
			chunks.push({
				id: `bundle-${chunks.length + 1}`,
				diff: currentBatch.map((f) => f.diff).join("\n\n"),
				paths: currentBatch.map((f) => f.path),
			});
			currentBatch = [];
			currentLength = 0;
		}

		currentBatch.push(file);
		currentLength += file.diff.length;
	}

	if (currentBatch.length > 0) {
		chunks.push({
			id: `bundle-${chunks.length + 1}`,
			diff: currentBatch.map((f) => f.diff).join("\n\n"),
			paths: currentBatch.map((f) => f.path),
		});
	}

	return chunks;
}

/**
 * Filter question batteries to match the semantic domain of files in the chunk.
 */
export function routeBatteryForChunk(
	baseBattery: Record<string, Question>,
	paths: string[],
): Record<string, Question> {
	const isAllDocs =
		paths.length > 0 &&
		paths.every((p) => p.endsWith(".md") || p.endsWith(".txt") || p.startsWith("docs/"));
	const isAllTests =
		paths.length > 0 &&
		paths.every(
			(p) =>
				p.includes("test") ||
				p.endsWith(".test.ts") ||
				p.endsWith(".test.js") ||
				p.endsWith("_test.go") ||
				p.endsWith("_test.py"),
		);

	if (isAllDocs) {
		const routed = { ...baseBattery };
		delete routed.torvalds_taste;
		delete routed.ousterhout_complexity;
		delete routed.needless_abstraction;
		delete routed.incomplete_cutover;
		delete routed.fails_open;
		return routed;
	}

	if (isAllTests) {
		const routed = { ...baseBattery };
		delete routed.tests_missing;
		return routed;
	}

	return baseBattery;
}

/**
 * Generate a compact structural AST/symbol map of a diff for macro-level triage.
 */
export function generateStructuralMap(diffText: string): string {
	const files = splitDiffIntoFiles(diffText);
	const stats = parseDiffStats(diffText);

	let map = `# Structural Diff Map\n`;
	map += `Files changed: ${stats.filesChanged}, Additions: +${stats.linesAdded}, Deletions: -${stats.linesRemoved}\n\n`;
	map += `## File Manifest\n`;

	for (const f of files) {
		const isNew = f.diff.includes("new file mode");
		const isDeleted = f.diff.includes("deleted file mode");
		const status = isNew ? "added" : isDeleted ? "deleted" : "modified";

		const symbols: string[] = [];
		for (const line of f.diff.split("\n")) {
			if (line.startsWith("+") && !line.startsWith("+++")) {
				const trimmed = line.slice(1).trim();
				if (
					trimmed.startsWith("export function ") ||
					trimmed.startsWith("function ") ||
					trimmed.startsWith("export class ") ||
					trimmed.startsWith("class ") ||
					trimmed.startsWith("pub fn ") ||
					trimmed.startsWith("pub struct ") ||
					trimmed.startsWith("pub enum ") ||
					trimmed.startsWith("export interface ") ||
					trimmed.startsWith("export type ") ||
					trimmed.startsWith("export const ")
				) {
					const name = trimmed.split(/[(<{\s]/)[2] || trimmed.slice(0, 30);
					if (name && !symbols.includes(name)) symbols.push(name);
				}
			}
		}

		const symText = symbols.length > 0 ? ` (symbols: ${symbols.slice(0, 4).join(", ")})` : "";
		map += `- \`${f.path}\` [${status}] (+${f.linesAdded}/-${f.linesRemoved})${symText}\n`;
	}

	return map;
}


/**
 * Core Review Evaluator: Dispatches battery and applies confidence-gated thresholds.
 *
 * Epistemic Invariant (Confidence Gating):
 * - Security rules fail closed (probability alone can block to prevent active leakage).
 * - Taste, Strategy, Pokayoke, and Verification rules require high probability (> threshold)
 *   AND confidence >= 0.70 to trigger a hard block.
 * - Sub-threshold confidence (speculative or ambiguous classifications) is demoted to a warning
 *   so interactive turns are never halted on uncertain subjective models.
 */
export async function evaluateDiff(
	diffText: string,
	options: {
		provider?: SystemOneProvider | null;
		battery?: Record<string, Question>;
		batteryName?: BatteryName;
		timeoutMs?: number;
		chunkSize?: number;
	} = {},
): Promise<ReviewVerdict> {
	const stats = parseDiffStats(diffText);
	if (!diffText.trim()) {
		return {
			passed: true,
			clean: true,
			enabled: true,
			provider: "none",
			latencyMs: 0,
			stats,
			blocks: [],
			warnings: [],
			summary: "No diff to review.",
		};
	}

	const provider = options.provider !== undefined ? options.provider : resolveProvider();

	if (!provider) {
		return {
			passed: true,
			clean: true,
			enabled: false,
			provider: "none",
			latencyMs: 0,
			stats,
			blocks: [],
			warnings: [],
			summary:
				"Diff review disabled: neither OPENROUTER_API_KEY nor TYPESAFE_API_KEY is configured for System One evaluation.",
		};
	}

	const maxChunkChars = options.chunkSize ?? 20000;
	const files = splitDiffIntoFiles(diffText);
	const chunks =
		diffText.length <= maxChunkChars
			? [{ id: "single", diff: diffText, paths: files.map((f) => f.path) }]
			: bundleDiffChunks(files, maxChunkChars);

	const battery =
		options.battery ??
		(options.batteryName ? BATTERIES[options.batteryName] ?? HARNESS_BATTERY : HARNESS_BATTERY);
	const start = Date.now();

	const chunkResults = await Promise.all(
		chunks.map(async (chunk) => {
			const chunkBattery = options.battery ? options.battery : routeBatteryForChunk(battery, chunk.paths);
			try {
				const answers = await provider.evaluate(chunk.diff, chunkBattery, options.timeoutMs);
				return { chunk, answers, error: null };
			} catch (err) {
				return { chunk, answers: null, error: err };
			}
		}),
	);

	const latencyMs = Date.now() - start;
	const blocks: RuleFinding[] = [];
	const warnings: RuleFinding[] = [];

	for (const res of chunkResults) {
		if (res.error) {
			warnings.push({
				rule: "provider_error",
				category: "verification",
				severity: "warning",
				message: `System One provider error on ${res.chunk.id}: ${res.error instanceof Error ? res.error.message : String(res.error)}`,
				evidence: `Paths: ${res.chunk.paths.join(", ")}`,
				probability: 0,
				confidence: 0,
			});
			continue;
		}

		if (res.answers) {
			const findings = parseRuleFindings(res.answers);
			for (const b of findings.blocks) {
				if (!blocks.some((existing) => existing.rule === b.rule && existing.message === b.message)) {
					blocks.push(b);
				}
			}
			for (const w of findings.warnings) {
				if (!warnings.some((existing) => existing.rule === w.rule && existing.message === w.message)) {
					warnings.push(w);
				}
			}
		}
	}

	const passed = blocks.length === 0;
	const clean = blocks.length === 0 && warnings.length === 0;
	const chunkInfo = chunks.length > 1 ? ` across ${chunks.length} chunk(s)` : "";
	const summary = clean
		? `Review PASSED cleanly (${latencyMs}ms, ${provider.name}${chunkInfo}).`
		: passed
			? `Review PASSED with ${warnings.length} warning(s) (${latencyMs}ms, ${provider.name}${chunkInfo}).`
			: `Review BLOCKED by ${blocks.length} rule violation(s) (${latencyMs}ms, ${provider.name}${chunkInfo}).`;

	return {
		passed,
		clean,
		enabled: true,
		provider: provider.name,
		latencyMs,
		stats,
		blocks,
		warnings,
		summary,
	};
}

/**
 * Fetch git diff from repository (including untracked files by default).
 *
 * `range` is either a single rev expression ("A..B") or multiple rev-list
 * tokens (["SHA", "--not", "--remotes"]). A single expression goes to
 * `git diff` unchanged. A token array is a rev-list spec rendered as
 * standard per-commit patches (`git log -p`): `git diff` over several remote
 * tips emits a combined diff (--cc) the diff parsers cannot read, and joined
 * into one token the set is not a revision at all (git exits 128, empty
 * diff). Strings are never split here — only the caller knows the intended
 * token boundaries.
 */
export function getGitDiff(options: {
	staged?: boolean;
	commit?: string;
	range?: string | string[];
	path?: string;
	includeUntracked?: boolean;
	cwd?: string;
} = {}): string {
	const rangeTokens = Array.isArray(options.range)
		? options.range.filter((token) => token.length > 0)
		: options.range
			? [options.range]
			: undefined;
	const hasRange = !!rangeTokens && rangeTokens.length > 0;
	let args: string[];
	if (options.staged) {
		args = ["diff", "--cached"];
	} else if (options.commit) {
		return spawnSync("git", ["show", options.commit], { encoding: "utf8", cwd: options.cwd }).stdout ?? "";
	} else if (hasRange && rangeTokens && Array.isArray(options.range)) {
		args = ["log", "-p", ...rangeTokens];
	} else if (hasRange && rangeTokens) {
		args = ["diff", ...rangeTokens];
	} else {
		args = ["diff", "HEAD"];
	}

	if (options.path) {
		args.push("--", options.path);
	}

	const res = spawnSync("git", args, { encoding: "utf8", cwd: options.cwd });
	let diff = res.stdout ?? "";

	if (options.includeUntracked !== false && !options.staged && !options.commit && !hasRange) {
		const untrackedArgs = ["ls-files", "--others", "--exclude-standard"];
		if (options.path) {
			untrackedArgs.push("--", options.path);
		}
		const untrackedRes = spawnSync("git", untrackedArgs, { encoding: "utf8", cwd: options.cwd });
		const untrackedFiles = (untrackedRes.stdout ?? "")
			.split("\n")
			.map((f) => f.trim())
			.filter((f) => f.length > 0);

		for (const file of untrackedFiles) {
			const fileDiff = spawnSync("git", ["diff", "--no-index", "--", "/dev/null", file], {
				encoding: "utf8",
				cwd: options.cwd,
			});
			if (fileDiff.stdout) {
				diff += (diff.length > 0 ? "\n" : "") + fileDiff.stdout;
			}
		}
	}

	return diff;
}

/**
 * Parse System One decision answers into rule findings according to confidence thresholds.
 */
export function parseRuleFindings(answers: Record<string, Answer>): {
	blocks: RuleFinding[];
	warnings: RuleFinding[];
} {
	const blocks: RuleFinding[] = [];
	const warnings: RuleFinding[] = [];
	for (const [key, ans] of Object.entries(answers)) {
		if (ans.type === "noul") {
			const p = ans.probability;
			const conf = ans.confidence;
			const isHighConfidence = conf >= 0.7;

			if (key === "credential_leak" && p > 0.75) {
				// Security fails closed
				blocks.push({
					rule: key,
					category: "security",
					severity: "block",
					message: "Active credential, secret token, or private key detected in diff.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "disk_secret_persistence" && p > 0.8) {
				// Security fails closed
				blocks.push({
					rule: key,
					category: "security",
					severity: "block",
					message: "Runtime credential written to file on disk rather than memory injection.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "authority_escalation" && p > 0.8) {
				// Security fails closed
				blocks.push({
					rule: key,
					category: "security",
					severity: "block",
					message: "Unsanitized root/sudo execution or privilege boundary bypass.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "prompt_injection_risk" && p > 0.8) {
				// Security fails closed
				blocks.push({
					rule: key,
					category: "security",
					severity: "block",
					message: "Diff exposes execution/instruction boundary to unsanitized external input.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "needless_abstraction" && p > 0.85) {
				if (isHighConfidence) {
					warnings.push({
						rule: key,
						category: "taste",
						severity: "warning",
						message: "Needless abstraction or single-caller wrapper violating simplicity guidance.",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				} else {
					warnings.push({
						rule: key,
						category: "taste",
						severity: "warning",
						message: "Possible single-caller indirection (low confidence).",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				}
			} else if (key === "weightless_code" && p > 0.85) {
				warnings.push({
					rule: key,
					category: "taste",
					severity: "warning",
					message: "Weightless code: defensive checks on internal invariants or mock echoes.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "incomplete_cutover" && p > 0.8) {
				if (isHighConfidence) {
					warnings.push({
						rule: key,
						category: "taste",
						severity: "warning",
						message: "Incomplete cutover: introduced new path while leaving deprecated aliases/shims.",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				} else {
					warnings.push({
						rule: key,
						category: "taste",
						severity: "warning",
						message: "Possible incomplete cutover: verify old aliases/paths are cleaned up.",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				}
			} else if (key === "preserves_root_cause" && p > 0.8) {
				if (isHighConfidence) {
					warnings.push({
						rule: key,
						category: "pokayoke",
						severity: "warning",
						message: "Fix suppresses symptom or silences error rather than eliminating root cause.",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				} else {
					warnings.push({
						rule: key,
						category: "pokayoke",
						severity: "warning",
						message: "Advisory: check whether error handling masks underlying invalid state.",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				}
			} else if (key === "fails_open" && p > 0.75) {
				if (isHighConfidence) {
					warnings.push({
						rule: key,
						category: "pokayoke",
						severity: "warning",
						message: "Validation/guard fails open on invalid input instead of failing closed.",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				} else {
					warnings.push({
						rule: key,
						category: "pokayoke",
						severity: "warning",
						message: "Advisory: verify guard/validation fails closed on malformed input.",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				}
			} else if (key === "tests_missing" && p > 0.85) {
				warnings.push({
					rule: key,
					category: "pokayoke",
					severity: "warning",
					message: "Non-trivial behavioral change appears to lack corresponding test defense.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "hickey_complecting" && p > 0.85) {
				warnings.push({
					rule: key,
					category: "strategy",
					severity: "warning",
					message: "Hickey: two concerns look complected that could have stayed independent.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "erasure" && p > 0.85) {
				warnings.push({
					rule: key,
					category: "strategy",
					severity: "warning",
					message: "Erasure: surface looks deletable without losing a promised user outcome.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "small_app" && p > 0.85) {
				warnings.push({
					rule: key,
					category: "strategy",
					severity: "warning",
					message: "Small-app: looks like platform/kernel growth where a focused tool would do.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "scope_creep" && p > 0.85) {
				warnings.push({
					rule: key,
					category: "strategy",
					severity: "warning",
					message: "Scope creep detected: opportunistic unrelated changes bundled into this diff.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "user_visible_impact" && p < 0.2) {
				warnings.push({
					rule: key,
					category: "strategy",
					severity: "warning",
					message: "Diff appears to modify harness trivia without serving observable capability.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "test_asserts_implementation" && p > 0.8) {
				if (isHighConfidence) {
					warnings.push({
						rule: key,
						category: "verification",
						severity: "warning",
						message: "Test asserts internal implementation (mocks, wiring) instead of observable postconditions.",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				} else {
					warnings.push({
						rule: key,
						category: "verification",
						severity: "warning",
						message: "Advisory: test may assert internal wiring rather than observable postconditions.",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				}
			} else if (key === "is_test_padding" && p > 0.85) {
				if (isHighConfidence) {
					blocks.push({
						rule: key,
						category: "verification",
						severity: "block",
						message: "Test padding detected (tautology or bare not-throw). Delete padding.",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				} else {
					warnings.push({
						rule: key,
						category: "verification",
						severity: "warning",
						message: "Advisory: test may be padding (low regression defense).",
						evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: p,
						confidence: conf,
					});
				}
			}
		} else if (ans.type === "choice") {
			// Missing confidence is an unusable answer: it demotes, never gates.
			const conf = ans.confidence ?? 0;
			const isHighConfidence = conf >= 0.7;

			if (key === "pokayoke_mechanism") {
				if (ans.choice === "suppressed_symptom") {
					if (isHighConfidence) {
						warnings.push({
							rule: key,
							category: "pokayoke",
							severity: "warning",
							message: "Pokayoke violation: bug fix silences error instead of structural prevention.",
							evidence: `Choice: ${ans.choice}, Confidence: ${conf.toFixed(2)}`,
							probability: 1.0,
							confidence: conf,
						});
					} else {
						warnings.push({
							rule: key,
							category: "pokayoke",
							severity: "warning",
							message: "Advisory: check if bug fix silences error instead of structural prevention.",
							evidence: `Choice: ${ans.choice}, Confidence: ${conf.toFixed(2)}`,
							probability: 0.8,
							confidence: conf,
						});
					}
				} else if (ans.choice === "warning_or_comment") {
					warnings.push({
						rule: key,
						category: "pokayoke",
						severity: "warning",
						message: "Advisory note: warning or comment added; prefer structural type/shape fix.",
						evidence: `Choice: ${ans.choice}, Confidence: ${conf.toFixed(2)}`,
						probability: 0.8,
						confidence: conf,
					});
				}
			} else if (key === "ousterhout_complexity") {
				if (ans.choice === "complexity_spreading") {
					if (isHighConfidence) {
						warnings.push({
							rule: key,
							category: "taste",
							severity: "warning",
							message: "Ousterhout complexity spreading: introduces shallow wrappers or leaked internals.",
							evidence: `Choice: ${ans.choice}, Confidence: ${conf.toFixed(2)}`,
							probability: 0.9,
							confidence: conf,
						});
					} else {
						warnings.push({
							rule: key,
							category: "taste",
							severity: "warning",
							message: "Advisory: review whether added surface introduces shallow wrappers.",
							evidence: `Choice: ${ans.choice}, Confidence: ${conf.toFixed(2)}`,
							probability: 0.7,
							confidence: conf,
						});
					}
				}
			}
		} else if (ans.type === "score") {
			// Missing confidence is an unusable answer: it demotes, never gates.
			const conf = ans.confidence ?? 0;
			const isHighConfidence = conf >= 0.7;

			if (key === "accidental_churn" && ans.score >= 2) {
				warnings.push({
					rule: key,
					category: "taste",
					severity: "warning",
					message: "Moderate or severe incidental churn detected across touched files.",
					evidence: `Score: ${ans.score} (${ans.probabilities ? JSON.stringify(ans.probabilities) : ""})`,
					probability: 0.75,
					confidence: conf,
				});
			} else if (key === "torvalds_taste" && ans.score < 1.0) {
				if (isHighConfidence) {
					warnings.push({
						rule: key,
						category: "taste",
						severity: "warning",
						message: "Linus Torvalds taste violation: diff identified as clever hack or papered-over bug.",
						evidence: `Score: ${ans.score.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: 0.9,
						confidence: conf,
					});
				} else {
					warnings.push({
						rule: key,
						category: "taste",
						severity: "warning",
						message: "Advisory: Torvalds taste score is low (review if change is a papered-over hack).",
						evidence: `Score: ${ans.score.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
						probability: 0.7,
						confidence: conf,
					});
				}
			} else if (key === "plausible_bug_defense" && ans.score < 1.0) {
				warnings.push({
					rule: key,
					category: "verification",
					severity: "warning",
					message: "Test defense score is low: added test does not clearly defend against plausible regression.",
					evidence: `Score: ${ans.score.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: 0.8,
					confidence: conf,
				});
			}
		}
	}

	return { blocks, warnings };
}
