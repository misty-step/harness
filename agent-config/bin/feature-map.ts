#!/usr/bin/env bun
// feature-map: owned standalone launcher (misty-step/harness).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const usage = `Usage: feature-map <draft|compare> [options]
  draft --repo DIR --out DIR [--threshold P] [--endpoint URL] [--json]
      Draft one feature per live capability from tracked source areas using Jev.
  compare --draft DIR --repo DIR [--json]
      Compare draft and reference features/ by normalized source area and story grouping.
Options:
  --repo DIR       Git repository root (required)
  --out DIR        Draft output directory; never the repository's features/ (draft only)
  --draft DIR      Draft output directory (compare only)
  --threshold P    Minimum Noul yes probability (default: 0.20; draft only)
  --endpoint URL   Decisions API override for a local/test provider (draft only)
  --json           Print machine-readable result
  -h, --help       Show this help`;

// TypeSafe docs: models.md (64k aggregate tokens, 32k state + longest question),
// primitives/noul.md (Noul request/answer), concepts/state.md and api.md.
// Bound both question count and serialized request characters conservatively
// below the 64k-token model context, even with long acceptance criteria.
const MAX_QUESTIONS = 32;
const MAX_REQUEST_CHARS = 48_000;
const MODEL = "typesafe/jev-1.13";
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
// Small Scry code-signal calibration (one run): clear positives US-001/store
// 0.64, US-008/semantic 0.42, US-010/learning 0.20; irrelevant
// US-008/recovery 0.02 and US-010/deploy/cloudflare-hosting 0.02.
// Favor draft recall at 0.20; one repo is not a safe drift alarm calibration.
const DEFAULT_THRESHOLD = 0.20;
const H2 = ["Sub-features", "How to get to it (user POV)", "Driving it", "Gotchas"];

type Options = { command: "draft" | "compare"; repo: string; out?: string; draft?: string; threshold: number; endpoint?: string; json: boolean };
type Story = { id: string; capability: string; capability_index: number; statement: string; criteria: string[] };
type Area = { path: string; files: string[]; source: string };
type Feature = { file: string; stories: string[]; sources: string[]; title?: string };
type Question = { type: "noul"; instructions: string; criteria: { true: string; false: string } };
type Pair = { id: string; story: string; area: string; question: Question };
type Answer = { id: string; story: string; area: string; probability: number };
type Evidence = { path: string; source_signals: string };
type Batch = { pairs: Pair[]; state: Evidence };

function options(argv: string[]): Options | "help" {
	if (argv.length === 1 && ["-h", "--help"].includes(argv[0])) return "help";
	const [command, ...rest] = argv;
	if (command !== "draft" && command !== "compare") throw new Error("expected draft or compare");
	const parsed: Options = { command, repo: "", threshold: DEFAULT_THRESHOLD, json: false };
	let thresholdProvided = false;
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "-h" || arg === "--help") return "help";
		if (arg === "--json") { parsed.json = true; continue; }
		if (!["--repo", "--out", "--draft", "--threshold", "--endpoint"].includes(arg)) throw new Error(`unexpected argument: ${arg}`);
		const value = rest[++i];
		if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
		if (arg === "--repo") parsed.repo = resolve(value);
		else if (arg === "--out") parsed.out = resolve(value);
		else if (arg === "--draft") parsed.draft = resolve(value);
		else if (arg === "--endpoint") parsed.endpoint = value;
		else { parsed.threshold = Number(value); thresholdProvided = true; }
	}
	if (!parsed.repo) throw new Error("--repo DIR is required");
	if (command === "draft" && (!parsed.out || parsed.draft)) throw new Error("draft requires --out DIR and does not accept --draft");
	if (command === "compare" && (!parsed.draft || parsed.out || parsed.endpoint || thresholdProvided)) throw new Error("compare requires --draft DIR and accepts no draft options");
	if (!Number.isFinite(parsed.threshold) || parsed.threshold < 0 || parsed.threshold > 1) throw new Error("--threshold must be between 0 and 1");
	if (parsed.endpoint && !/^https?:\/\//.test(parsed.endpoint)) throw new Error("--endpoint must be an HTTP(S) URL");
	return parsed;
}

function git(repo: string, ...argv: string[]): string {
	const result = spawnSync("git", argv, { cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
	if (result.error || result.status !== 0) throw new Error(`git ${argv.join(" ")}: ${result.error?.message ?? result.stderr.trim()}`);
	return result.stdout;
}
function stories(repo: string): Story[] {
	const source = git(repo, "show", "HEAD:USER_STORIES.md");
	const parsed: Story[] = [];
	let capability = "";
	let capabilityIndex = -1;
	for (const part of source.split(/(?=^## (?:Capability:|US-\d{3}))/m)) {
		const title = part.match(/^## Capability:\s*(.+)/);
		if (title) { capability = title[1].trim(); capabilityIndex++; continue; }
		const id = part.match(/^## (US-\d{3})(?:\s|$)/)?.[1];
		if (!id || /\(retired\)/i.test(part.split("\n")[0]) || /^Retired:/mi.test(part) || /Superseded by US-\d{3}/i.test(part)) continue;
		if (!capability) throw new Error(`${id} has no preceding ## Capability: heading in USER_STORIES.md at HEAD`);
		const lines = part.split("\n");
		let field: "statement" | "criteria" | undefined;
		const statement: string[] = [];
		const criteria: string[] = [];
		for (const line of lines) {
			if (/^Statement:\s*/.test(line)) { field = "statement"; statement.push(line.replace(/^Statement:\s*/, "")); continue; }
			if (/^Criteria:\s*/.test(line)) { field = "criteria"; continue; }
			if (/^[A-Z][\w-]*:/.test(line) || /^##? /.test(line)) { field = undefined; continue; }
			if (field === "statement" && line.trim()) statement.push(line.trim());
			if (field === "criteria" && line.trim()) {
				if (/^\d+\. /.test(line)) criteria.push(line.trim());
				else if (criteria.length) criteria[criteria.length - 1] += ` ${line.trim()}`;
			}
		}
		if (!statement.length || !criteria.length) throw new Error(`${id} needs Statement: and numbered Criteria: at HEAD`);
		if (parsed.some((story) => story.id === id)) throw new Error(`duplicate story ${id}`);
		parsed.push({ id, capability, capability_index: capabilityIndex, statement: statement.join(" "), criteria });
	}
	if (!parsed.length) throw new Error("no live stories found in USER_STORIES.md at HEAD");
	return parsed;
}
function tracked(repo: string): string[] { return git(repo, "ls-files", "-z").split("\0").filter(Boolean).sort(); }
const code = /\.(?:go|rs|py|ts|tsx|js|jsx|mjs|cjs|java|kt|rb|php|swift|dart|sh|bash|html|css|vue|svelte|sql|c|cc|cpp|h|hpp)$/i;
function sourceFile(path: string): boolean {
	const parts = path.split("/");
	if (parts.some((part) => /^(?:node_modules|vendor|third_party|dist|build|coverage|fixtures?|testdata|__tests__|tests?|docs?|documentation|generated|__generated__|gen|\.git)$/i.test(part))) return false;
	const name = parts.at(-1)!;
	return code.test(name) && !/(?:^test_|_test\.|\.test\.|\.spec\.|_generated\.|\.generated\.|\.gen\.|^generated\.)/i.test(name)
		&& !/\.(?:min|map)\./.test(name);
}
function areas(files: string[]): Area[] {
	const grouped = new Map<string, string[]>();
	for (const file of files.filter(sourceFile)) {
		const dirs = file.split("/").slice(0, -1);
		const parent = dirs.slice(0, 3).join("/");
		const list = grouped.get(parent) ?? [];
		list.push(file);
		grouped.set(parent, list);
	}
	const result: Area[] = [];
	for (const [dir, paths] of grouped) {
		if (dir) result.push({ path: dir, files: paths, source: `${dir}/**` });
		if (paths.length === 1) result.push({ path: paths[0], files: paths, source: paths[0] });
	}
	if (!result.length) throw new Error("no tracked code source areas found (git ls-files)");
	return result.sort((a, b) => a.path.localeCompare(b.path, "en"));
}
function question(story: Story, area: Area): Question {
	return {
		type: "noul",
		instructions: `Does source area ${area.path} implement behavior this story needs? ${story.id} — ${story.statement} Criteria: ${story.criteria.join(" ")} Answer yes for substantive implementation of this behavior, including backend support; no for merely neighboring code or test/documentation evidence. Evaluate state.source_signals for this area against this story.`,
		criteria: {
			true: "The named source area implements behavior needed for this story.",
			false: "The named source area does not implement behavior needed for this story.",
		},
	};
}
function evidence(repo: string, area: Area): Evidence {
	const snippets: string[] = [];
	for (const file of area.files) {
		const source = git(repo, "show", `:${file}`);
		const lines = source.split("\n")
			.map((line) => line.trim())
			.filter((line) => /^(?:func |type |const |var |export |class |def |function |CREATE |ALTER |\w+\.(?:GET|POST|Handle|HandleFunc|Get|Post)|<(?:(?:a|form|button|h[1-6]|input|template)\b))/.test(line) || /(?:\/map|\/review|\/add|\/sources|\/concepts|\/goals|HTMX)/i.test(line))
			.slice(0, 16);
		snippets.push(`${file}: ${lines.join(" | ").slice(0, 750)}`);
	}
	return { path: area.path, source_signals: snippets.join("\n").slice(0, 16_000) };
}
function batches(pairs: Pair[], candidates: Area[], repo: string): Batch[] {
	const grouped: Batch[] = [];
	for (const area of candidates) {
		const state = evidence(repo, area);
		const fixed = JSON.stringify({ model: MODEL, state, questions: {} }).length;
		let batch: Pair[] = [];
		let chars = fixed;
		for (const pair of pairs.filter((candidate) => candidate.area === area.path)) {
			const size = JSON.stringify(pair.id).length + JSON.stringify(pair.question).length + 2;
			if (fixed + size > MAX_REQUEST_CHARS) throw new Error(`${pair.story}/${pair.area} question exceeds the Jev context budget`);
			if (batch.length && (batch.length === MAX_QUESTIONS || chars + size > MAX_REQUEST_CHARS)) {
				grouped.push({ pairs: batch, state });
				batch = [];
				chars = fixed;
			}
			batch.push(pair);
			chars += size;
		}
		if (batch.length) grouped.push({ pairs: batch, state });
	}
	return grouped;
}
function outputLocation(repo: string, out: string): void {
	const canonical = (path: string): string => {
		let ancestor = path;
		while (!existsSync(ancestor)) ancestor = dirname(ancestor);
		return resolve(realpathSync(ancestor), relative(ancestor, path));
	};
	const features = canonical(join(repo, "features"));
	const destination = canonical(out);
	if (destination === features || destination.startsWith(features + sep)) throw new Error("--out must be outside the repository's features/ directory");
	if (existsSync(out) && readdirSync(out).length) throw new Error(`--out ${out} is not empty; choose a fresh output directory`);
}
async function draft(opts: Options): Promise<Record<string, unknown>> {
	const key = process.env.OPENROUTER_API_KEY;
	if (!key && !opts.endpoint) throw new Error("OPENROUTER_API_KEY is missing; run through pass-env with .env.pass, or pass --endpoint URL for a local decisions provider");
	outputLocation(opts.repo, opts.out!);
	const head = git(opts.repo, "rev-parse", "HEAD").trim();
	const live = stories(opts.repo);
	const candidates = areas(tracked(opts.repo));
	const pairs: Pair[] = [];
	for (const story of live) for (const area of candidates) pairs.push({ id: `q${pairs.length}`, story: story.id, area: area.path, question: question(story, area) });
	const answers: Answer[] = [];
	const calls: { count: number; latency_ms: number; model: string }[] = [];
	for (const batch of batches(pairs, candidates, opts.repo)) {
		const questions = Object.fromEntries(batch.pairs.map(({ id, question }) => [id, question]));
		const started = performance.now();
		const response = await fetch(opts.endpoint ?? ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(key && !opts.endpoint ? { Authorization: `Bearer ${key}` } : {}), "HTTP-Referer": "https://github.com/misty-step/harness", "X-Title": "Harness Feature Map Pilot" },
			body: JSON.stringify({ model: MODEL, state: batch.state, questions }),
			signal: AbortSignal.timeout(60_000),
		});
		if (!response.ok) throw new Error(`Jev decisions HTTP ${response.status} in call ${calls.length + 1}: ${(await response.text()).slice(0, 400)}`);
		const payload = await response.json() as { model?: string; answers?: Record<string, { type?: string; noul?: number }> };
		const latency = Math.round(performance.now() - started);
		if (!payload.answers || typeof payload.answers !== "object") throw new Error(`Jev call ${calls.length + 1} returned no answers`);
		for (const pair of batch.pairs) {
			const answer = payload.answers[pair.id];
			if (answer?.type !== "noul" || typeof answer.noul !== "number" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new Error(`Jev call ${calls.length + 1} returned an invalid Noul answer for ${pair.story}/${pair.area}`);
			answers.push({ id: pair.id, story: pair.story, area: pair.area, probability: answer.noul });
		}
		calls.push({ count: batch.pairs.length, latency_ms: latency, model: payload.model ?? MODEL });
	}
	answers.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
	const byCapability = new Map<number, Story[]>();
	for (const story of live) {
		const group = byCapability.get(story.capability_index) ?? [];
		group.push(story);
		byCapability.set(story.capability_index, group);
	}
	const filenames = new Set<string>();
	const features: Feature[] = [];
	for (const group of byCapability.values()) {
		const capability = group[0].capability;
		const slug = capability.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "feature";
		let file = `${slug}.md`;
		for (let suffix = 2; filenames.has(file); suffix++) file = `${slug}-${suffix}.md`;
		filenames.add(file);
		const ids = new Set(group.map(({ id }) => id));
		const selected = new Set(answers.filter(({ story, probability }) => ids.has(story) && probability >= opts.threshold).map(({ area }) => area));
		const sources = candidates.filter(({ path }) => selected.has(path)).map(({ source }) => source);
		if (!sources.length) throw new Error(`no source area cleared threshold ${opts.threshold} for ${capability}; lower --threshold or review the story and source inventory`);
		features.push({ file, title: capability, stories: group.map(({ id }) => id), sources });
	}
	mkdirSync(opts.out!, { recursive: true });
	writeFileSync(join(opts.out!, "README.md"), `# Draft feature map\n\n${features.map(({ file, title, stories }) => `- [${title}](${file}): ${stories.join(", ")}.`).join("\n")}\n`);
	for (const feature of features) {
		writeFileSync(join(opts.out!, feature.file), `# ${feature.title}\n\nStories: ${feature.stories.join(", ")}\nSource: ${feature.sources.join(", ")}\n\n${H2.map((heading) => `## ${heading}\n\n(draft: fill from the product)\n`).join("\n")}`);
	}
	const result = { schema: "feature-map-draft/1", repo_head: head, model: MODEL, threshold: opts.threshold, question_count: answers.length, call_count: calls.length, latency_ms: calls.reduce((total, call) => total + call.latency_ms, 0), calls, stories: live, areas: candidates, answers, features };
	writeFileSync(join(opts.out!, "draft.json"), JSON.stringify(result, null, 2) + "\n");
	return { ok: true, out: opts.out, question_count: result.question_count, call_count: result.call_count, latency_ms: result.latency_ms, threshold: opts.threshold, features: features.length };
}

function globRegex(pattern: string): RegExp {
	let regex = "^";
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];
		if (ch === "*" && pattern[i + 1] === "*") { i++; if (pattern[i + 1] === "/") { i++; regex += "(?:.*/)?"; } else regex += ".*"; }
		else if (ch === "*") regex += "[^/]*";
		else regex += ch.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
	}
	return new RegExp(`${regex}$`);
}
function map(dir: string): Feature[] {
	if (!existsSync(join(dir, "README.md"))) throw new Error(`${dir}/README.md is missing`);
	const index = readFileSync(join(dir, "README.md"), "utf8");
	const files = readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md").sort();
	if (!files.length) throw new Error(`no feature files in ${dir}`);
	return files.map((file) => {
		if (!index.includes(`(${file})`) && !index.includes(`(./${file})`)) throw new Error(`${file} is not linked from ${dir}/README.md`);
		const body = readFileSync(join(dir, file), "utf8");
		const storyLine = body.match(/^Stories:\s*(.+)$/m)?.[1];
		const sourceLine = body.match(/^Source:\s*(.+)$/m)?.[1];
		if (!storyLine || !sourceLine) throw new Error(`${dir}/${file} needs Stories: and Source: lines`);
		return { file, stories: storyLine.split(",").map((s) => s.trim()), sources: sourceLine.split(",").map((s) => s.trim()) };
	});
}
function compare(opts: Options): Record<string, unknown> {
	const live = stories(opts.repo);
	const candidates = areas(tracked(opts.repo));
	const draftMap = map(opts.draft!);
	const referenceMap = map(join(opts.repo, "features"));
	function byStory(features: Feature[]): Map<string, Set<string>> {
		const result = new Map<string, Set<string>>();
		for (const feature of features) {
			const matched = candidates.filter((area) => feature.sources.some((source) => {
				const pattern = globRegex(source);
				return area.files.some((file) => pattern.test(file));
			})).map(({ path }) => path);
			for (const story of feature.stories) {
				const set = result.get(story) ?? new Set<string>();
				for (const area of matched) set.add(area);
				result.set(story, set);
			}
		}
		return result;
	}
	const left = byStory(draftMap), right = byStory(referenceMap);
	const ids = live.map(({ id }) => id);
	for (const id of ids) if (!left.has(id) || !right.has(id)) throw new Error(`${id} is missing from ${!left.has(id) ? "draft" : "reference"} features`);
	function together(features: Feature[], a: string, b: string): boolean {
		return features.some(({ stories }) => stories.includes(a) && stories.includes(b));
	}
	let truePositives = 0, draftTotal = 0, referenceTotal = 0, matchedGrouping = 0;
	const rows = ids.map((id) => {
		const draftAreas = left.get(id)!, referenceAreas = right.get(id)!;
		const intersection = [...draftAreas].filter((area) => referenceAreas.has(area)).length;
		const agreement = ids.filter((other) => other !== id && together(draftMap, id, other) === together(referenceMap, id, other)).length;
		truePositives += intersection;
		draftTotal += draftAreas.size;
		referenceTotal += referenceAreas.size;
		matchedGrouping += agreement;
		return { id, draft_areas: [...draftAreas].sort(), reference_areas: [...referenceAreas].sort(), true_positives: intersection, precision: draftAreas.size ? intersection / draftAreas.size : referenceAreas.size ? 0 : 1, recall: referenceAreas.size ? intersection / referenceAreas.size : 1, grouping: { matched: agreement, total: ids.length - 1, agreement: ids.length > 1 ? agreement / (ids.length - 1) : 1 } };
	});
	return { ok: true, stories: rows, overall: { true_positives: truePositives, draft_areas: draftTotal, reference_areas: referenceTotal, precision: draftTotal ? truePositives / draftTotal : referenceTotal ? 0 : 1, recall: referenceTotal ? truePositives / referenceTotal : 1, grouping_agreement: ids.length > 1 ? matchedGrouping / (ids.length * (ids.length - 1)) : 1 } };
}

try {
	const opts = options(process.argv.slice(2));
	if (opts === "help") console.log(usage);
	else {
		const result = opts.command === "draft" ? await draft(opts) : compare(opts);
		if (opts.json) console.log(JSON.stringify(result));
		else if (opts.command === "draft") console.log(`feature-map draft: ${result.question_count} questions, ${result.call_count} calls, ${result.latency_ms} ms, threshold ${result.threshold}; ${result.out}`);
		else {
			for (const row of result.stories as { id: string; precision: number; recall: number; grouping: { agreement: number } }[]) console.log(`${row.id}: precision ${row.precision.toFixed(3)}, recall ${row.recall.toFixed(3)}, grouping ${row.grouping.agreement.toFixed(3)}`);
			const overall = result.overall as { precision: number; recall: number; grouping_agreement: number };
			console.log(`overall: precision ${overall.precision.toFixed(3)}, recall ${overall.recall.toFixed(3)}, grouping ${overall.grouping_agreement.toFixed(3)}`);
		}
	}
} catch (error) {
	console.error(`feature-map: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
