#!/usr/bin/env bun
/** Owner-scoped leases and landing evidence. Never destroys a Git resource. */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

type Kind = "worktree" | "exe.dev" | "exe.dev-worktree";
type Lease = { kind: Kind; target: string; owner?: string; created?: string; expires?: string };
type LeaseState = { own: Lease[]; foreign: Lease[]; needsReview: Lease[] };
type Landing = {
	owner: string; commonDir: string; canonical: string; target: string; branch: string | null;
	head: string; previousHeads?: string[]; created: string; updated: string; defaultBranch?: string; defaultCheckout?: boolean; parked?: { note: string; at: string };
};
type Worktree = { target: string; head: string; branch: string | null };
type Repository = { commonDir: string; canonical: string; target: string; branch: string | null; head: string; defaultBranch?: string };
type PullRequest = { number: number; state: "OPEN" | "CLOSED" | "MERGED"; headRefOid: string; baseRefName: string; mergeCommit: { oid: string } | null };
type LandingReport = Landing & { status: "landed" | "blocked" | "parked"; verification: "verified" | "unverified"; blockers: string[] };

const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function take(args: string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	if (i < 0) return undefined;
	const value = args[i + 1];
	if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
	args.splice(i, 2);
	return value;
}

function stat(pid: number): { parent: number; session: number; start: string; comm: string } | undefined {
	try {
		const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
		const end = raw.lastIndexOf(")");
		const fields = raw.slice(end + 2).trim().split(/\s+/);
		return { comm: raw.slice(raw.indexOf("(") + 1, end), parent: Number(fields[1]), session: Number(fields[3]), start: fields[19] };
	} catch { return undefined; }
}

function owner(): string {
	if (process.env.SESSION_CLOSE_OWNER) return process.env.SESSION_CLOSE_OWNER;
	let pid = process.ppid;
	const seen = new Set<number>();
	const session = stat(pid)?.session ?? pid;
	while (pid > 1 && !seen.has(pid)) {
		seen.add(pid);
		const info = stat(pid);
		if (!info) break;
		let argv0 = "";
		try { argv0 = basename(readFileSync(`/proc/${pid}/cmdline`).toString().split("\0")[0] ?? ""); } catch { /* comm remains authoritative */ }
		if (["omp", "pi"].includes(info.comm) || ["omp", "pi"].includes(argv0)) return `pid:${pid}:${info.start}`;
		pid = info.parent;
	}
	const leader = stat(session);
	if (!leader) throw new Error(`session leader ${session} is unavailable; set SESSION_CLOSE_OWNER for non-agent use`);
	return `pid:${session}:${leader.start}`;
}

function fileFor(dir: string, kind: Kind, target: string): string {
	const id = createHash("sha256").update(kind).update("\0").update(target).digest("hex").slice(0, 16);
	return join(dir, `${id}.json`);
}

function parseLease(raw: string, name: string): Lease | string {
	let value: unknown;
	try { value = JSON.parse(raw); } catch { return `${name}: not JSON`; }
	if (!value || typeof value !== "object") return `${name}: not an object`;
	const v = value as Record<string, unknown>;
	if (v.kind !== "worktree" && v.kind !== "exe.dev" && v.kind !== "exe.dev-worktree") return `${name}: invalid kind`;
	if (typeof v.target !== "string" || !v.target) return `${name}: invalid target`;
	if (v.owner !== undefined && (typeof v.owner !== "string" || !v.owner)) return `${name}: invalid owner`;
	for (const field of ["created", "expires"]) {
		if (v[field] !== undefined && (typeof v[field] !== "string" || !Number.isFinite(Date.parse(v[field])))) return `${name}: invalid ${field}`;
	}
	if (v.owner && (!v.created || !v.expires)) return `${name}: owned lease missing created or expires`;
	return { kind: v.kind, target: v.target, ...(v.owner ? { owner: v.owner as string } : {}), ...(v.created ? { created: v.created as string } : {}), ...(v.expires ? { expires: v.expires as string } : {}) };
}

function listLeases(dir: string): { leases: Lease[]; errors: string[] } {
	if (!existsSync(dir)) return { leases: [], errors: [] };
	const leases: Lease[] = [];
	const errors: string[] = [];
	for (const name of readdirSync(dir).sort()) {
		if (!name.endsWith(".json")) continue;
		const parsed = parseLease(readFileSync(join(dir, name), "utf8"), name);
		if (typeof parsed === "string") errors.push(parsed);
		else leases.push(parsed);
	}
	return { leases, errors };
}

function reviewReason(lease: Lease): string | undefined {
	if (!lease.owner) return "ownerless";
	if (lease.expires && Date.parse(lease.expires) <= Date.now()) return "expired";
	const match = /^pid:(\d+):(\d+)$/.exec(lease.owner);
	if (match && stat(Number(match[1]))?.start !== match[2]) return "orphaned";
	return undefined;
}

function add(dir: string, kind: Kind, target: string, hours: number): number {
	const { leases, errors } = listLeases(dir);
	if (errors.length) throw new Error(`corrupt leases: ${errors.join(", ")}`);
	const who = owner();
	const existing = leases.find((lease) => lease.kind === kind && lease.target === target);
	if (existing) {
		if (existing.owner !== who) throw new Error(`${target} already leased by ${existing.owner ?? "ownerless"}; review before reuse`);
		console.log(`already leased ${kind} ${target} owner ${who}`);
		return 0;
	}
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const created = new Date();
	const lease: Lease = { kind, target, owner: who, created: created.toISOString(), expires: new Date(created.getTime() + hours * 3600000).toISOString() };
	writeFileSync(fileFor(dir, kind, target), `${JSON.stringify(lease, null, 2)}\n`, { mode: 0o600, flag: "wx" });
	console.log(`leased ${kind} ${target} owner ${who}`);
	return 0;
}

function drop(dir: string, target: string): number {
	const { leases, errors } = listLeases(dir);
	if (errors.length) throw new Error(`corrupt leases: ${errors.join(", ")}`);
	const matches = leases.filter((lease) => lease.target === target);
	if (!matches.length) { console.error(`no lease for ${target}`); return 2; }
	for (const lease of matches) {
		rmSync(fileFor(dir, lease.kind, lease.target));
		console.log(`dropped ${lease.kind} ${target} owner ${lease.owner ?? "ownerless"}`);
	}
	return 0;
}

function command(args: string[], cwd?: string, accept: number[] = []): { code: number; out: string; err: string } {
	const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.error) throw new Error(`${args[0]}: ${result.error.message}`);
	const code = result.exitCode ?? 1;
	const out = result.stdout.toString();
	const err = result.stderr.toString();
	if (code !== 0 && !accept.includes(code)) throw new Error(`${args.join(" ")} exited ${code}: ${err.trim() || out.trim()}`);
	return { code, out, err };
}

function git(commonDir: string, args: string[], accept: number[] = []): { code: number; out: string; err: string } {
	return command(["git", "--git-dir", commonDir, ...args], undefined, accept);
}

function worktrees(commonDir: string): Worktree[] {
	const trees: Worktree[] = [];
	let fields: Record<string, string> = {};
	for (const field of git(commonDir, ["worktree", "list", "--porcelain", "-z"]).out.split("\0")) {
		if (!field) {
			if (!fields.worktree) continue;
			if (!isAbsolute(fields.worktree) || !oidPattern.test(fields.HEAD ?? "") || (fields.branch && !fields.branch.startsWith("refs/heads/"))) throw new Error("malformed git worktree list");
			trees.push({ target: resolve(fields.worktree), head: fields.HEAD, branch: fields.branch?.slice("refs/heads/".length) ?? null });
			fields = {};
		} else {
			const space = field.indexOf(" ");
			fields[space < 0 ? field : field.slice(0, space)] = space < 0 ? "" : field.slice(space + 1);
		}
	}
	if (!trees.length || Object.keys(fields).length) throw new Error("malformed git worktree list");
	return trees;
}

function repository(path: string, required: boolean): Repository | undefined {
	const root = command(["git", "-C", path, "rev-parse", "--show-toplevel"], undefined, [128]);
	if (root.code) {
		if (!required && /not a git repository/i.test(root.err)) return undefined;
		throw new Error(`cannot inspect repository ${path}: ${root.err.trim()}`);
	}
	const target = realpathSync(root.out.trim());
	const commonDir = realpathSync(resolve(target, command(["git", "-C", target, "rev-parse", "--git-common-dir"]).out.trim()));
	const trees = worktrees(commonDir);
	const current = trees.find((tree) => tree.target === target);
	if (!current) throw new Error(`${target} is absent from git worktree list`);
	const localDefault = git(commonDir, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], [1]).out.trim();
	if (localDefault && !localDefault.startsWith("refs/remotes/origin/")) throw new Error("malformed local origin HEAD");
	return { commonDir, canonical: trees[0].target, ...current, ...(localDefault ? { defaultBranch: localDefault.slice("refs/remotes/origin/".length) } : {}) };
}

function landingFile(dir: string, landing: Pick<Landing, "owner" | "commonDir" | "target" | "branch">): string {
	const id = createHash("sha256").update(JSON.stringify([landing.owner, landing.commonDir, landing.target, landing.branch])).digest("hex").slice(0, 16);
	return join(dir, "landings", `${id}.json`);
}

function parseLanding(raw: string, name: string): Landing | string {
	let value: unknown;
	try { value = JSON.parse(raw); } catch { return `${name}: not JSON`; }
	if (!value || typeof value !== "object" || Array.isArray(value)) return `${name}: not an object`;
	const v = value as Record<string, unknown>;
	if (typeof v.owner !== "string" || !v.owner) return `${name}: invalid owner`;
	for (const field of ["commonDir", "canonical", "target"]) {
		if (typeof v[field] !== "string" || !isAbsolute(v[field] as string) || resolve(v[field] as string) !== v[field]) return `${name}: invalid ${field}`;
	}
	if (v.branch !== null && (typeof v.branch !== "string" || !v.branch || v.branch.startsWith("-") || /[\0\r\n]/.test(v.branch))) return `${name}: invalid branch`;
	if (v.defaultBranch !== undefined && (typeof v.defaultBranch !== "string" || !v.defaultBranch || /[\0\r\n]/.test(v.defaultBranch))) return `${name}: invalid defaultBranch`;
	if (v.defaultCheckout !== undefined && typeof v.defaultCheckout !== "boolean") return `${name}: invalid defaultCheckout`;
	if (typeof v.head !== "string" || !oidPattern.test(v.head)) return `${name}: invalid head`;
	if (v.previousHeads !== undefined && (!Array.isArray(v.previousHeads) || !v.previousHeads.every((head) => typeof head === "string" && oidPattern.test(head)))) return `${name}: invalid previousHeads`;
	for (const field of ["created", "updated"]) {
		if (typeof v[field] !== "string" || !Number.isFinite(Date.parse(v[field] as string))) return `${name}: invalid ${field}`;
	}
	let parked: Landing["parked"];
	if (v.parked !== undefined) {
		if (!v.parked || typeof v.parked !== "object" || Array.isArray(v.parked)) return `${name}: invalid parked state`;
		const p = v.parked as Record<string, unknown>;
		if (typeof p.note !== "string" || !p.note.trim() || typeof p.at !== "string" || !Number.isFinite(Date.parse(p.at))) return `${name}: invalid parking note or date`;
		parked = { note: p.note, at: p.at };
	}
	return { owner: v.owner, commonDir: v.commonDir as string, canonical: v.canonical as string, target: v.target as string, branch: v.branch as string | null, head: v.head, ...(Array.isArray(v.previousHeads) ? { previousHeads: v.previousHeads as string[] } : {}), created: v.created as string, updated: v.updated as string, ...(typeof v.defaultBranch === "string" ? { defaultBranch: v.defaultBranch } : {}), ...(typeof v.defaultCheckout === "boolean" ? { defaultCheckout: v.defaultCheckout } : {}), ...(parked ? { parked } : {}) };
}

function listLandings(dir: string): { landings: Landing[]; errors: string[] } {
	const path = join(dir, "landings");
	if (!existsSync(path)) return { landings: [], errors: [] };
	const landings: Landing[] = [];
	const errors: string[] = [];
	for (const name of readdirSync(path).sort()) {
		if (!name.endsWith(".json")) continue;
		const parsed = parseLanding(readFileSync(join(path, name), "utf8"), `landings/${name}`);
		if (typeof parsed === "string") errors.push(parsed);
		else if (basename(landingFile(dir, parsed)) !== name) errors.push(`landings/${name}: record identity does not match filename`);
		else landings.push(parsed);
	}
	return { landings, errors };
}

function saveLanding(dir: string, landing: Landing): void {
	mkdirSync(join(dir, "landings"), { recursive: true, mode: 0o700 });
	const path = landingFile(dir, landing);
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(landing, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		renameSync(temporary, path);
	} finally { rmSync(temporary, { force: true }); }
}

function rememberHead(landing: Landing, head: string): void {
	if (landing.head === head) return;
	if (!ancestor(landing.commonDir, landing.head, head)) {
		landing.previousHeads = [...new Set([...(landing.previousHeads ?? []), landing.head])];
	}
	landing.head = head;
	landing.updated = new Date().toISOString();
}

function register(dir: string, landings: Landing[], repo: Repository, who: string): Landing {
	const existing = landings.find((item) => item.owner === who && item.commonDir === repo.commonDir && item.target === repo.target && item.branch === repo.branch);
	const now = new Date().toISOString();
	if (existing) {
		if (existing.head !== repo.head || existing.canonical !== repo.canonical) {
			rememberHead(existing, repo.head);
			existing.canonical = repo.canonical;
			existing.updated = now;
			saveLanding(dir, existing);
		}
		return existing;
	}
	const landing: Landing = { ...repo, owner: who, created: now, updated: now };
	landings.push(landing);
	saveLanding(dir, landing);
	return landing;
}

function leaseState(leases: Lease[], who: string, review: boolean): LeaseState {
	const own: Lease[] = [];
	const foreign: Lease[] = [];
	const needsReview: Lease[] = [];
	for (const lease of leases) {
		if (reviewReason(lease)) needsReview.push(lease);
		else if (!review) (lease.owner === who ? own : foreign).push(lease);
	}
	return { own, foreign, needsReview };
}

function printLeases(leases: Lease[], state: LeaseState, review: boolean): void {
	if (!leases.length) console.log("session-close: no recorded leases (other workspaces not checked)");
	for (const [label, items] of [["own open leases", state.own], ["foreign leases (info)", state.foreign]] as const) {
		if (!review && items.length) {
			console.log(`session-close: ${label}`);
			for (const lease of items) console.log(`  ${lease.kind}: ${lease.target} owner ${lease.owner}`);
		}
	}
	if (state.needsReview.length) {
		console.log("session-close: needs review (never auto-delete)");
		for (const lease of state.needsReview) console.log(`  ${lease.kind}: ${lease.target} owner ${lease.owner ?? "ownerless"} (${reviewReason(lease)})`);
	}
}

function inspectLeases(dir: string, json: boolean, review: boolean): number {
	const { leases, errors } = listLeases(dir);
	const state = leaseState(leases, review ? "" : owner(), review);
	const code = errors.length ? 1 : review ? (state.needsReview.length ? 3 : 0) : (state.own.length ? 2 : 0);
	if (json) console.log(JSON.stringify({ ok: code === 0, leases, ...state, ...(errors.length ? { errors } : {}) }, null, 2));
	else if (errors.length) console.log(`session-close: corrupt leases: ${errors.join(", ")}`);
	else printLeases(leases, state, review);
	return code;
}

type FreshRepository = { commonDir: string; canonical: string; trees: Worktree[]; defaultBranch: string; defaultHead: string; canonicalBlockers: string[]; prs: Map<string, PullRequest[]> };

function parseJSON(raw: string, context: string): unknown {
	try { return JSON.parse(raw); } catch { throw new Error(`${context}: malformed JSON`); }
}

function freshRepository(commonDir: string, canonical: string): FreshRepository {
	const trees = worktrees(commonDir);
	const remote = git(commonDir, ["ls-remote", "--symref", "origin", "HEAD"]).out;
	let defaultBranch: string | undefined;
	for (const line of remote.trim().split("\n").filter(Boolean)) {
		const symref = /^ref: (refs\/heads\/(.+))\tHEAD$/.exec(line);
		if (symref) {
			if (defaultBranch) throw new Error("origin HEAD has multiple symbolic targets");
			defaultBranch = symref[2];
		} else if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?\tHEAD$/.test(line)) throw new Error("malformed origin HEAD response");
	}
	if (!defaultBranch) {
		const metadata = parseJSON(command(["gh", "repo", "view", "--json", "defaultBranchRef"], canonical).out, "gh repo view");
		if (!metadata || typeof metadata !== "object" || !("defaultBranchRef" in metadata)) throw new Error("origin default branch is unknown");
		const ref = metadata.defaultBranchRef;
		if (!ref || typeof ref !== "object" || !("name" in ref) || typeof ref.name !== "string" || !ref.name) throw new Error("origin default branch is unknown");
		defaultBranch = ref.name;
	}
	git(commonDir, ["check-ref-format", `refs/heads/${defaultBranch}`]);
	git(commonDir, ["fetch", "--no-tags", "origin", `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`]);
	const defaultHead = git(commonDir, ["rev-parse", "--verify", `refs/remotes/origin/${defaultBranch}^{commit}`]).out.trim();
	if (!oidPattern.test(defaultHead)) throw new Error("malformed fetched origin default HEAD");
	const canonicalBlockers: string[] = [];
	const tree = trees.find((item) => item.target === canonical);
	if (!tree || !existsSync(canonical)) canonicalBlockers.push(`canonical checkout is missing: ${canonical}`);
	else {
		if (dirty(canonical)) canonicalBlockers.push(`dirty canonical checkout: ${canonical}`);
		if (tree.branch !== defaultBranch) canonicalBlockers.push(`canonical checkout is not on origin default ${defaultBranch}: ${canonical}`);
		if (tree.head !== defaultHead) canonicalBlockers.push(`canonical checkout is not at fetched origin/${defaultBranch}: ${canonical}`);
	}
	return { commonDir, canonical, trees, defaultBranch, defaultHead, canonicalBlockers, prs: new Map() };
}

function dirty(target: string): boolean {
	return command(["git", "-C", target, "status", "--porcelain=v1", "--untracked-files=all", "-z"]).out.length > 0;
}

function localHead(commonDir: string, branch: string): string | undefined {
	git(commonDir, ["check-ref-format", `refs/heads/${branch}`]);
	if (git(commonDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], [1]).code === 1) return undefined;
	const head = git(commonDir, ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]).out.trim();
	if (!oidPattern.test(head)) throw new Error(`malformed local HEAD for ${branch}`);
	return head;
}

function remoteBranch(repo: FreshRepository, branch: string): boolean {
	const ref = `refs/heads/${branch}`;
	const output = git(repo.commonDir, ["ls-remote", "--heads", "origin", ref]).out.trim();
	if (!output) return false;
	const lines = output.split("\n");
	if (lines.length !== 1 || lines[0].split("\t")[1] !== ref || !oidPattern.test(lines[0].split("\t")[0])) throw new Error(`malformed origin branch response for ${branch}`);
	return true;
}

function ancestor(commonDir: string, head: string, descendant: string): boolean {
	const result = git(commonDir, ["merge-base", "--is-ancestor", head, descendant], [1, 128]);
	if (result.code === 128) {
		if (/not a valid (?:commit|object) name|bad object/i.test(result.err)) return false;
		throw new Error(`git merge-base failed: ${result.err.trim()}`);
	}
	return result.code === 0;
}

function pullRequests(repo: FreshRepository, branch: string): PullRequest[] {
	const cached = repo.prs.get(branch);
	if (cached) return cached;
	const value = parseJSON(command(["gh", "pr", "list", "--state", "all", "--head", branch, "--limit", "1000", "--json", "number,state,headRefOid,baseRefName,mergeCommit"], repo.canonical).out, "gh pr list");
	if (!Array.isArray(value) || value.length >= 1000) throw new Error("gh pr list: malformed or incomplete PR response");
	for (const item of value) {
		if (!item || typeof item !== "object" || !Number.isSafeInteger(item.number) || item.number < 1 || !["OPEN", "CLOSED", "MERGED"].includes(item.state) || typeof item.headRefOid !== "string" || !oidPattern.test(item.headRefOid) || typeof item.baseRefName !== "string" || !item.baseRefName ||
			(item.mergeCommit !== null && (!item.mergeCommit || typeof item.mergeCommit !== "object" || typeof item.mergeCommit.oid !== "string" || !oidPattern.test(item.mergeCommit.oid))) ||
			(item.state === "MERGED" && item.mergeCommit === null)) throw new Error("gh pr list: malformed PR facts");
	}
	repo.prs.set(branch, value);
	return value;
}

function mergedPRContains(repo: FreshRepository, pr: PullRequest, head: string): boolean {
	if (pr.state !== "MERGED" || pr.baseRefName !== repo.defaultBranch || !pr.mergeCommit || !ancestor(repo.commonDir, pr.mergeCommit.oid, repo.defaultHead)) return false;
	if (pr.headRefOid === head) return true;
	if (git(repo.commonDir, ["cat-file", "-e", `${pr.headRefOid}^{commit}`], [1, 128]).code === 0) return ancestor(repo.commonDir, head, pr.headRefOid);
	// GitHub retains PR heads after branch deletion, including remote update-branch commits.
	git(repo.commonDir, ["fetch", "--no-tags", "origin", `refs/pull/${pr.number}/head`]);
	const fetched = git(repo.commonDir, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]).out.trim();
	return fetched === pr.headRefOid && ancestor(repo.commonDir, head, fetched);
}

function landingFacts(landing: Landing, repo: FreshRepository, related: Landing[]): string[] {
	const blockers = [...repo.canonicalBlockers];
	const isFeature = landing.branch !== null && landing.branch !== repo.defaultBranch && !landing.defaultCheckout;
	const relevant = repo.trees.filter((tree) => tree.target === landing.target || (isFeature && tree.branch === landing.branch));
	const remaining = new Set(relevant.filter((tree) => tree.target !== repo.canonical).map((tree) => tree.target));
	if (landing.target !== repo.canonical && existsSync(landing.target)) remaining.add(landing.target);
	for (const target of remaining) blockers.push(`owned worktree remains: ${target}`);
	for (const tree of relevant) {
		if (tree.target !== repo.canonical && existsSync(tree.target) && dirty(tree.target)) blockers.push(`dirty owned checkout: ${tree.target}`);
	}
	let prs: PullRequest[] = [];
	if (isFeature) {
		if (localHead(repo.commonDir, landing.branch!)) blockers.push(`local feature branch remains: ${landing.branch}`);
		if (remoteBranch(repo, landing.branch!)) blockers.push(`origin feature branch remains: ${landing.branch}`);
		prs = pullRequests(repo, landing.branch!);
		if (prs.some((pr) => pr.state === "OPEN")) blockers.push(`open PR remains for branch: ${landing.branch}`);
	} else if (landing.branch === null) {
		for (const item of related) {
			if (item.branch && item.branch !== repo.defaultBranch && (item.target === landing.target || item.head === landing.head)) prs.push(...pullRequests(repo, item.branch));
		}
	}
	for (const head of new Set([landing.head, ...(landing.previousHeads ?? [])])) {
		if (!ancestor(repo.commonDir, head, repo.defaultHead) && !prs.some((pr) => mergedPRContains(repo, pr, head))) {
			blockers.push(`recorded HEAD is not merged into fetched origin/${repo.defaultBranch}: ${head}`);
		}
	}
	return blockers;
}

function retainedFacts(landing: Landing): string[] {
	const facts = ["Git/GitHub landing facts are unverified while parked"];
	if (!existsSync(landing.commonDir)) facts.push(`repository is unavailable: ${landing.commonDir}`);
	for (const target of new Set([landing.canonical, landing.target])) {
		if (!existsSync(target)) continue;
		facts.push(`checkout retained: ${target}`);
		try { if (dirty(target)) facts.push(`dirty retained checkout: ${target}`); }
		catch (error) { facts.push(`local checkout unverified: ${target}: ${error instanceof Error ? error.message : error}`); }
	}
	return facts;
}

function check(dir: string, json: boolean, repoPath: string, explicitRepo: boolean): number {
	const { leases, errors: leaseErrors } = listLeases(dir);
	const { landings, errors: landingErrors } = listLandings(dir);
	const errors = [...leaseErrors, ...landingErrors];
	if (errors.length) {
		if (json) console.log(JSON.stringify({ ok: false, status: "blocked", leases, landings, errors }, null, 2));
		else console.log(`session-close: corrupt records: ${errors.join(", ")}`);
		return 1;
	}
	const who = owner();
	const state = leaseState(leases, who, false);
	const repositories = new Map<string, FreshRepository>();
	const fresh = (commonDir: string, canonical: string): FreshRepository | undefined => {
		if (!existsSync(commonDir)) return undefined;
		let repo = repositories.get(commonDir);
		if (!repo) { repo = freshRepository(commonDir, canonical); repositories.set(commonDir, repo); }
		return repo;
	};
	const current = repository(repoPath, explicitRepo);
	let currentLanding: Landing | undefined;
	if (current) {
		const previous = landings.filter((item) => item.owner === who && item.commonDir === current.commonDir);
		const knownDefault = current.defaultBranch ?? previous.find((item) => item.defaultBranch)?.defaultBranch;
		const parkedDefaultInspection = previous.length > 0 && previous.every((item) => item.parked) && current.target === current.canonical && current.branch === knownDefault;
		if (!parkedDefaultInspection) currentLanding = register(dir, landings, current, who);
	}
	const mine = landings.filter((item) => item.owner === who);
	// Refresh while refs still exist, even when the originally recorded worktree is gone.
	for (const landing of mine) {
		if (landing.parked || !existsSync(landing.commonDir)) continue;
		const head = landing.branch ? localHead(landing.commonDir, landing.branch) : worktrees(landing.commonDir).find((tree) => tree.target === landing.target)?.head;
		if (head && head !== landing.head) { rememberHead(landing, head); saveLanding(dir, landing); }
	}
	const ownLandings: LandingReport[] = mine.map((landing) => {
		if (landing.parked) return { ...landing, status: "parked", verification: "unverified", blockers: retainedFacts(landing) };
		const repo = fresh(landing.commonDir, landing.canonical);
		if (repo && (landing.defaultBranch !== repo.defaultBranch || (landing.branch === repo.defaultBranch && !landing.defaultCheckout))) {
			landing.defaultBranch = repo.defaultBranch;
			if (landing.branch === repo.defaultBranch) landing.defaultCheckout = true;
			saveLanding(dir, landing);
		}
		const blockers = repo ? landingFacts(landing, repo, mine.filter((item) => item.commonDir === landing.commonDir)) : [`repository is unavailable: ${landing.commonDir}`];
		if (currentLanding === landing && current && repo) {
			if (dirty(current.target) && !blockers.some((item) => item.includes(current.target) && item.startsWith("dirty "))) blockers.push(`dirty current checkout: ${current.target}`);
			if (current.branch !== repo.defaultBranch) blockers.push(`current checkout is not on origin default ${repo.defaultBranch}: ${current.target}`);
			if (current.head !== repo.defaultHead) blockers.push(`current checkout is not at fetched origin/${repo.defaultBranch}: ${current.target}`);
		}
		return { ...landing, status: blockers.length ? "blocked" : "landed", verification: repo ? "verified" : "unverified", blockers };
	});
	const foreignLandings = landings.filter((item) => item.owner !== who);
	const parkedLeases = state.own.flatMap((lease) => {
		const matches = lease.kind === "worktree" ? mine.filter((item) => item.target === resolve(lease.target)) : [];
		return matches.length && matches.every((item) => item.parked) ? [{ ...lease, note: matches[0].parked!.note }] : [];
	});
	const blockers = state.own.filter((lease) => !parkedLeases.some((item) => item.kind === lease.kind && item.target === lease.target)).map((lease) => `own live lease remains: ${lease.kind} ${lease.target}`);
	for (const landing of ownLandings) if (landing.status === "blocked") blockers.push(...landing.blockers);
	const code = blockers.length ? 2 : 0;
	const status = code ? "blocked" : ownLandings.some((item) => item.status === "parked") ? "parked" : "done";
	if (json) console.log(JSON.stringify({ ok: code === 0, status, leases, ...state, ownLandings, foreignLandings, parkedLeases, blockers }, null, 2));
	else {
		printLeases(leases, state, false);
		for (const landing of ownLandings) {
			console.log(`session-close: ${landing.status} ${landing.branch ?? "(detached)"} ${landing.target} HEAD ${landing.head}`);
			if (landing.parked) console.log(`  resume: ${landing.parked.note}`);
			for (const fact of landing.blockers) console.log(`  ${landing.parked ? "retained" : "blocking"}: ${fact}`);
		}
		for (const lease of parkedLeases) console.log(`session-close: parked lease retained ${lease.target}; resume: ${lease.note}`);
		if (foreignLandings.length) console.log(`session-close: ${foreignLandings.length} foreign landing records (info; not checked or changed)`);
		console.log(`session-close: ${status}`);
	}
	return code;
}

function track(dir: string, repoPath: string, json: boolean): number {
	const { landings, errors } = listLandings(dir);
	if (errors.length) throw new Error(`corrupt landing records: ${errors.join(", ")}`);
	const landing = register(dir, landings, repository(repoPath, true)!, owner());
	if (json) console.log(JSON.stringify({ landing }, null, 2));
	else console.log(`tracked ${landing.branch ?? "(detached)"} ${landing.target} HEAD ${landing.head}${landing.parked ? ` (parked; resume: ${landing.parked.note})` : ""}`);
	return 0;
}

function park(dir: string, repoPath: string, note: string | undefined, json: boolean): number {
	const { landings, errors } = listLandings(dir);
	if (errors.length) throw new Error(`corrupt landing records: ${errors.join(", ")}`);
	const repo = repository(repoPath, true)!;
	const who = owner();
	const matches = landings.filter((item) => item.owner === who && item.commonDir === repo.commonDir);
	if (!matches.length) { console.error(`no owned landing records for ${repo.canonical}; track first`); return 2; }
	const now = new Date().toISOString();
	for (const landing of matches) {
		if (note !== undefined) landing.parked = { note, at: now };
		else delete landing.parked;
		landing.updated = now;
		saveLanding(dir, landing);
	}
	if (json) console.log(JSON.stringify({ status: note === undefined ? "resumed" : "parked", landings: matches }, null, 2));
	else console.log(`${note === undefined ? "resumed" : "parked"} ${matches.length} own landing record(s) for ${repo.canonical}${note === undefined ? "" : `; resume: ${note}`}`);
	return 0;
}

try {
	const args = process.argv.slice(2);
	const json = args.includes("--json");
	if (json) args.splice(args.indexOf("--json"), 1);
	const dir = resolve(take(args, "--lease-dir") ?? join(homedir(), ".cache/tmp/omp-session-leases"));
	const action = args.shift() ?? "check";
	let execute: () => number;
	if (action === "check" || action === "track" || action === "park" || action === "unpark") {
		const rawRepo = take(args, "--repo");
		const repoPath = resolve(rawRepo ?? process.cwd());
		if (action === "park") {
			const note = take(args, "--note")?.trim();
			if (!note) throw new Error("park requires a nonblank --note describing how to resume");
			execute = () => park(dir, repoPath, note, json);
		} else if (action === "unpark") execute = () => park(dir, repoPath, undefined, json);
		else if (action === "track") execute = () => track(dir, repoPath, json);
		else execute = () => check(dir, json, repoPath, rawRepo !== undefined);
	} else if (action === "leases" || action === "review") execute = () => inspectLeases(dir, json, action === "review");
	else if (action === "add") {
		const kind = take(args, "--kind");
		if (kind !== "worktree" && kind !== "exe.dev" && kind !== "exe.dev-worktree") throw new Error("--kind must be worktree, exe.dev or exe.dev-worktree");
		const target = take(args, "--target");
		if (!target) throw new Error("add requires --target");
		const raw = take(args, "--expires-hours") ?? "48";
		const hours = Number(raw);
		if (!Number.isFinite(hours) || hours <= 0 || hours > 1e6) throw new Error("--expires-hours requires a positive finite number");
		execute = () => add(dir, kind, target, hours);
	} else if (action === "drop") {
		const target = take(args, "--target");
		if (!target) throw new Error("drop requires --target");
		execute = () => drop(dir, target);
	} else throw new Error("Usage: session-close.ts check|track [--repo PATH] | leases|review | park --repo PATH --note TEXT | unpark --repo PATH | add --kind worktree|exe.dev|exe.dev-worktree --target T [--expires-hours N] | drop --target T");
	// Reject every unused argument before any store or Git mutation.
	if (args.length) throw new Error(`Unknown argument: ${args[0]}`);
	process.exit(execute());
} catch (error) {
	console.error(`session-close: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
