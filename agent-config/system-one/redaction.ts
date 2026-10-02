/** Shared credential exclusion and full-text redaction before provider egress. */

export const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
// An orphan BEGIN marker (no END) leaves the key body behind if only the
// marker line is replaced. Redact from the marker to the end of the chunk:
// for orphaned key material, over-redaction is the safe direction.
export const PRIVATE_KEY_ORPHAN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g;
const AWS_KEY = /AKIA[0-9A-Z]{16}/g;
const GITHUB_TOKEN = /github_pat_[A-Za-z0-9_]{20,}|gh[pors]_[A-Za-z0-9]{20,}/g;
const OPENAI_TOKEN = /sk-[A-Za-z0-9_-]{20,}/g;
const SLACK_TOKEN = /xox[baprs]-[A-Za-z0-9-]{10,}/g;
const AUTHORIZATION_BEARER =
	/(\bAuthorization\s*[:=]\s*(?:["']?)Bearer\s+)[A-Za-z0-9._~+\/-]{12,}={0,2}/gi;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const SECRET_ASSIGNMENT =
	/((?:["']?)[A-Za-z0-9_.-]*(?:secret|token|password|passwd|api[_-]?key)[A-Za-z0-9_.-]*(?:["']?)\s*[:=]\s*)(?:"([^"\n]{12,})"|'([^'\n]{12,})'|([A-Za-z0-9_\-./+=]{12,}))/gi;

export const REDACTED = "[REDACTED:suspected-secret]";

/** Replace suspected-secret material with a fixed marker. Idempotent; never clips. */
export function redactText(text: string): string {
	return text
		.replace(PRIVATE_KEY_BLOCK, REDACTED)
		.replace(PRIVATE_KEY_ORPHAN, REDACTED)
		.replace(AWS_KEY, REDACTED)
		.replace(GITHUB_TOKEN, REDACTED)
		.replace(OPENAI_TOKEN, REDACTED)
		.replace(SLACK_TOKEN, REDACTED)
		.replace(AUTHORIZATION_BEARER, (_match, prefix: string) => `${prefix}${REDACTED}`)
		.replace(JWT_TOKEN, REDACTED)
		.replace(SECRET_ASSIGNMENT, (_match, prefix: string) => `${prefix}${REDACTED}`);
}

const CREDENTIAL_PATH_PATTERNS: RegExp[] = [
	/(^|\/)\.env$/i,
	/(^|\/)\.env\.[^/]+$/i,
	/\.pem$/i,
	/\.key$/i,
	/\.p12$/i,
	/(^|\/)id_rsa[^/]*$/i,
	/(^|\/)id_ed25519[^/]*$/i,
	/(^|\/)credentials[^/]*(?:\/|$)/i,
	/(^|\/)secrets[^/]*(?:\/|$)/i,
	/(^|\/)\.npmrc$/i,
	/(^|\/)\.netrc$/i,
	/(^|\/)kubeconfig[^/]*$/i,
	/(^|\/)\.git-credentials$/i,
	/\.keystore$/i,
];

export function isCredentialPath(path: string): boolean {
	return CREDENTIAL_PATH_PATTERNS.some((pattern) => pattern.test(path));
}
