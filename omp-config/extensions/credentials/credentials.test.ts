import { describe, expect, test } from "bun:test";
import { claimsUnavailable, isAuthFailure, matchEntries, serviceTokens } from "./index.ts";

const ENTRIES = [
	"workstation/SENTRY_AUTH_TOKEN",
	"workstation/DOUBLETAKE_CONVEX_DEPLOY_KEY",
	"workstation/DOUBLETAKE_OPENROUTER_API_KEY",
	"workstation/LINEAR_API_KEY",
	"workstation/OPENROUTER_R90_ALLIE_API_KEY",
];

describe("credential awareness", () => {
	test("reduces entry names to the words that identify a service", () => {
		expect(serviceTokens("workstation/DOUBLETAKE_CONVEX_DEPLOY_KEY")).toEqual(["doubletake", "convex", "deploy"]);
		expect(serviceTokens("workstation/SENTRY_AUTH_TOKEN")).toEqual(["sentry"]);
	});

	test("finds the entries a claim or failure is about, and not unrelated ones", () => {
		expect(matchEntries("No Sentry credentials were available, so source maps weren't uploaded.", ENTRIES)).toEqual([
			"workstation/SENTRY_AUTH_TOKEN",
		]);
		expect(matchEntries("✖ 401 Unauthorized: Invalid Convex deploy key", ENTRIES)).toEqual([
			"workstation/DOUBLETAKE_CONVEX_DEPLOY_KEY",
		]);
		expect(matchEntries("gh pr create failed", ENTRIES)).toEqual([]);
	});

	test("recognizes authentication failures in command output", () => {
		expect(isAuthFailure("401 Unauthorized: AuthenticationFailed: Invalid Convex deploy key")).toBe(true);
		expect(isAuthFailure("Error: SENTRY_AUTH_TOKEN is not set")).toBe(true);
		expect(isAuthFailure("Tests 77 passed (77)")).toBe(false);
	});

	test("recognizes a claim that a credential is unavailable", () => {
		expect(claimsUnavailable("No Sentry credentials were available, so source maps weren't uploaded.")).toBe(true);
		expect(claimsUnavailable("The harness has no reviewer key.")).toBe(true);
		expect(claimsUnavailable("Deployed with the stored token; source maps uploaded.")).toBe(false);
	});
});
