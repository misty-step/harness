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
	options: string[];
};

export type ScoreQuestion = {
	type: "score";
	instructions: string;
	levels: string[];
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
	confidence: number;
};

export type ScoreAnswer = {
	type: "score";
	score: number;
	probabilities: Record<string, number>;
	confidence: number;
};

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type RuleFinding = {
	rule: string;
	category: "security" | "taste" | "pokayoke" | "verification";
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
 * Standing harness philosophy and security battery.
 */
export const HARNESS_BATTERY: Record<string, Question> = {
	// --- Security ---
	credential_leak: {
		type: "noul",
		instructions:
			"Does this diff introduce an active API key, raw authentication token, private key, or password in plaintext?",
	},
	disk_secret_persistence: {
		type: "noul",
		instructions:
			"Does this diff write or persist live credentials to a file on disk rather than using runtime memory injection (pass-env, op run)?",
	},
	authority_escalation: {
		type: "noul",
		instructions:
			"Does this diff or script invoke unverified root/sudo commands, modify system-wide sudoers/polkit policies, or bypass authentication boundaries?",
	},
	// --- Taste & Simplicity ---
	needless_abstraction: {
		type: "noul",
		instructions:
			"Does this diff introduce a helper, wrapper class, factory, or abstraction layer that is only used by a single caller?",
	},
	weightless_code: {
		type: "noul",
		instructions:
			"Does this diff introduce code that performs no observable work (e.g. redundant defensive null checks on internal invariants, forwarders, mock echoes)?",
	},
	incomplete_cutover: {
		type: "noul",
		instructions:
			"Does this diff introduce a new path while leaving deprecated aliases, shims, or obsolete paths behind rather than performing a clean cutover?",
	},
	accidental_churn: {
		type: "score",
		instructions:
			"Rate incidental churn: 0 is surgical and targeted; 3 is widespread unrelated reformatting or unnecessary touch of untouched files.",
		levels: ["surgical", "minor_noise", "moderate_churn", "severe_sprawl"],
	},
	// --- Pokayoke ---
	pokayoke_mechanism: {
		type: "choice",
		instructions:
			"What is the mechanism of the fix or change in this diff? Pick the primary category.",
		options: [
			"structural_type_or_shape",
			"fail_closed_check",
			"removed_affordance",
			"suppressed_symptom",
			"warning_or_comment",
			"feature_addition",
		],
	},
	preserves_root_cause: {
		type: "noul",
		instructions:
			"Does this diff handle an invalid state after it occurred (e.g. silencing an exception or null-checking a corrupted state) instead of eliminating the root cause?",
	},
	// --- Verification ---
	test_asserts_implementation: {
		type: "noul",
		instructions:
			"Do the added tests merely assert internal wiring, mock calls, or parameter forwarding rather than observable consumer postconditions?",
	},
	is_test_padding: {
		type: "noul",
		instructions:
			"Is any added test a tautology, a bare not-throw, or testing incidental wording rather than defending against a plausible regression?",
	},
};

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
				answers?: Record<string, unknown>;
				nouls?: Record<string, { noul: number; confidence?: number }>;
				choices?: Record<
					string,
					{ choice: string; probabilities: Record<string, number>; confidence?: number }
				>;
				scores?: Record<
					string,
					{ score: number; probabilities: Record<string, number>; confidence?: number }
				>;
			};

			const results: Record<string, Answer> = {};

			if (data.answers) {
				for (const [key, val] of Object.entries(data.answers)) {
					const answer = val as Record<string, unknown>;
					if (typeof answer.noul === "number") {
						results[key] = {
							type: "noul",
							probability: answer.noul,
							confidence: (answer.confidence as number) ?? 0.9,
						};
					} else if (typeof answer.choice === "string") {
						results[key] = {
							type: "choice",
							choice: answer.choice,
							probabilities: (answer.probabilities as Record<string, number>) ?? {},
							confidence: (answer.confidence as number) ?? 0.9,
						};
					} else if (typeof answer.score === "number") {
						results[key] = {
							type: "score",
							score: answer.score,
							probabilities: (answer.probabilities as Record<string, number>) ?? {},
							confidence: (answer.confidence as number) ?? 0.9,
						};
					}
				}
			}

			if (data.nouls) {
				for (const [k, v] of Object.entries(data.nouls)) {
					results[k] = {
						type: "noul",
						probability: v.noul,
						confidence: v.confidence ?? 0.9,
					};
				}
			}
			if (data.choices) {
				for (const [k, v] of Object.entries(data.choices)) {
					results[k] = {
						type: "choice",
						choice: v.choice,
						probabilities: v.probabilities ?? {},
						confidence: v.confidence ?? 0.9,
					};
				}
			}
			if (data.scores) {
				for (const [k, v] of Object.entries(data.scores)) {
					results[k] = {
						type: "score",
						score: v.score,
						probabilities: v.probabilities ?? {},
						confidence: v.confidence ?? 0.9,
					};
				}
			}

			return results;
		} finally {
			clearTimeout(timer);
		}
	}
}

/**
 * OpenRouter Fast Reflex Provider.
 */
export class OpenRouterReflexProvider implements SystemOneProvider {
	readonly name = "openrouter" as const;

	constructor(
		private apiKey: string,
		private model = "deepseek/deepseek-v4.1-flash",
		private endpoint = "https://openrouter.ai/api/v1/chat/completions",
	) {}

	async evaluate(
		state: string,
		questions: Record<string, Question>,
		timeoutMs = 15000,
	): Promise<Record<string, Answer>> {
		const prompt = `You are a System One semantic evaluator. Evaluate the following STATE against each QUESTION.
Return a single JSON object where each question key maps to its typed answer:
- For 'noul': { "type": "noul", "probability": 0.0 to 1.0, "confidence": 0.0 to 1.0 }
- For 'choice': { "type": "choice", "choice": "selected_option", "confidence": 0.0 to 1.0 }
- For 'score': { "type": "score", "score": integer_index, "confidence": 0.0 to 1.0 }

STATE:
"""
${state.slice(0, 32000)}
"""

QUESTIONS:
${JSON.stringify(questions, null, 2)}

Respond with valid JSON ONLY.`;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(this.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: this.model,
					messages: [{ role: "user", content: prompt }],
					temperature: 0.0,
					response_format: { type: "json_object" },
				}),
				signal: controller.signal,
			});

			if (!res.ok) {
				throw new Error(`OpenRouter API error ${res.status}: ${await res.text()}`);
			}

			const data = (await res.json()) as {
				choices?: Array<{ message?: { content?: string } }>;
			};
			const content = data.choices?.[0]?.message?.content?.trim();
			if (!content) throw new Error("Empty response from OpenRouter");

			const parsed = JSON.parse(content) as Record<string, Record<string, unknown>>;
			const results: Record<string, Answer> = {};

			for (const [key, q] of Object.entries(questions)) {
				const ans = parsed[key];
				if (!ans) continue;

				if (q.type === "noul") {
					results[key] = {
						type: "noul",
						probability: Number(ans.probability ?? ans.noul ?? 0.0),
						confidence: Number(ans.confidence ?? 0.85),
					};
				} else if (q.type === "choice") {
					results[key] = {
						type: "choice",
						choice: String(ans.choice ?? q.options[0]),
						probabilities: (ans.probabilities as Record<string, number>) ?? {},
						confidence: Number(ans.confidence ?? 0.85),
					};
				} else if (q.type === "score") {
					results[key] = {
						type: "score",
						score: Number(ans.score ?? 0),
						probabilities: (ans.probabilities as Record<string, number>) ?? {},
						confidence: Number(ans.confidence ?? 0.85),
					};
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
 * Used for unit tests, offline reproduction, and explicit dry-runs.
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
						/(?:\$\$[A-Z0-9_]+:[A-Z]\$\$|sk_live_|ghp_[A-Za-z0-9]{30,}|BEGIN (?:RSA|OPENSSH) PRIVATE KEY|AIzaSy[A-Za-z0-9_-]{33}|xox[baprs]-[A-Za-z0-9-]+)/.test(
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
				let choice = q.options[0];
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
 * Returns null if no live provider is credentialed and mock is not explicitly requested.
 * Prevents keyless live sessions from fabricating confidences.
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
		if (key) return new OpenRouterReflexProvider(key);
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

/**
 * Core Review Evaluator: Dispatches battery and applies strict thresholds.
 */
export async function evaluateDiff(
	diffText: string,
	options: {
		provider?: SystemOneProvider | null;
		battery?: Record<string, Question>;
		timeoutMs?: number;
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
				"Diff review disabled: neither TYPESAFE_API_KEY nor OPENROUTER_API_KEY is configured for System One evaluation.",
		};
	}

	const battery = options.battery ?? HARNESS_BATTERY;
	const start = Date.now();

	const answers = await provider.evaluate(diffText, battery, options.timeoutMs);
	const latencyMs = Date.now() - start;

	const blocks: RuleFinding[] = [];
	const warnings: RuleFinding[] = [];

	// Evaluate Rules against Hard & Soft Thresholds
	for (const [key, ans] of Object.entries(answers)) {
		if (ans.type === "noul") {
			const p = ans.probability;
			const conf = ans.confidence;

			if (key === "credential_leak" && p > 0.75) {
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
				blocks.push({
					rule: key,
					category: "security",
					severity: "block",
					message: "Unsanitized root/sudo execution or privilege boundary bypass.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "needless_abstraction" && p > 0.85) {
				blocks.push({
					rule: key,
					category: "taste",
					severity: "block",
					message: "Needless abstraction or single-caller wrapper violating simplicity guidance.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
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
				blocks.push({
					rule: key,
					category: "taste",
					severity: "block",
					message: "Incomplete cutover: introduced new path while leaving deprecated aliases/shims.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "preserves_root_cause" && p > 0.8) {
				blocks.push({
					rule: key,
					category: "pokayoke",
					severity: "block",
					message: "Fix suppresses symptom or silences error rather than eliminating root cause.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "test_asserts_implementation" && p > 0.8) {
				blocks.push({
					rule: key,
					category: "verification",
					severity: "block",
					message: "Test asserts internal implementation (mocks, wiring) instead of observable postconditions.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			} else if (key === "is_test_padding" && p > 0.85) {
				blocks.push({
					rule: key,
					category: "verification",
					severity: "block",
					message: "Test padding detected (tautology or bare not-throw). Delete padding.",
					evidence: `Probability: ${p.toFixed(2)}, Confidence: ${conf.toFixed(2)}`,
					probability: p,
					confidence: conf,
				});
			}
		} else if (ans.type === "choice") {
			if (key === "pokayoke_mechanism") {
				if (ans.choice === "suppressed_symptom") {
					blocks.push({
						rule: key,
						category: "pokayoke",
						severity: "block",
						message: "Pokayoke violation: bug fix silences error instead of structural prevention.",
						evidence: `Choice: ${ans.choice}, Confidence: ${ans.confidence.toFixed(2)}`,
						probability: 1.0,
						confidence: ans.confidence,
					});
				} else if (ans.choice === "warning_or_comment") {
					warnings.push({
						rule: key,
						category: "pokayoke",
						severity: "warning",
						message: "Advisory note: warning or comment added; prefer structural type/shape fix.",
						evidence: `Choice: ${ans.choice}, Confidence: ${ans.confidence.toFixed(2)}`,
						probability: 0.8,
						confidence: ans.confidence,
					});
				}
			}
		} else if (ans.type === "score") {
			if (key === "accidental_churn" && ans.score >= 2) {
				warnings.push({
					rule: key,
					category: "taste",
					severity: "warning",
					message: "Moderate or severe incidental churn detected across touched files.",
					evidence: `Score: ${ans.score} (${ans.probabilities ? JSON.stringify(ans.probabilities) : ""})`,
					probability: 0.75,
					confidence: ans.confidence,
				});
			}
		}
	}

	const passed = blocks.length === 0;
	const clean = blocks.length === 0 && warnings.length === 0;
	const summary = clean
		? `Review PASSED cleanly (${latencyMs}ms, ${provider.name}).`
		: passed
			? `Review PASSED with ${warnings.length} warning(s) (${latencyMs}ms, ${provider.name}).`
			: `Review BLOCKED by ${blocks.length} rule violation(s) (${latencyMs}ms, ${provider.name}).`;

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
 * Fetch git diff from repository.
 */
export function getGitDiff(options: {
	staged?: boolean;
	commit?: string;
	range?: string;
	path?: string;
}): string {
	const args = ["diff"];
	if (options.staged) {
		args.push("--cached");
	} else if (options.commit) {
		return (
			spawnSync("git", ["show", options.commit], { encoding: "utf8" }).stdout ?? ""
		);
	} else if (options.range) {
		args.push(options.range);
	} else {
		args.push("HEAD");
	}

	if (options.path) {
		args.push("--", options.path);
	}

	const res = spawnSync("git", args, { encoding: "utf8" });
	return res.stdout ?? "";
}
