import { defineTool } from "@earendil-works/pi-durable";
import { createReadTool } from "@earendil-works/pi-durable/tools";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { Type } from "typebox";

const exec = promisify(execFile);
const content = (text: string) => ({ content: [{ type: "text" as const, text }] });
export function pilotTools(cwd: string) {
	return [
		{ ...createReadTool(), replay: "safe" as const },
		defineTool({ name: "ls", description: "List a directory", replay: "safe",
			parameters: Type.Object({ path: Type.Optional(Type.String()) }),
			execute: async ({ path }) => content((await readdir(resolve(cwd, path ?? "."))).sort().join("\n")),
		}),
		defineTool({ name: "find", description: "Find file paths by glob", replay: "safe",
			parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }),
			execute: async ({ pattern, path }, _api, context) => {
				try { return content((await exec("rg", ["--files", "--glob", pattern, "--", resolve(cwd, path ?? ".")], { maxBuffer: 1024 * 1024, signal: context.abortSignal })).stdout); }
				catch (error) { if (error instanceof Error && "code" in error && error.code === 1) return content(""); throw error; }
			},
		}),
		defineTool({ name: "grep", description: "Search text with a regular expression", replay: "safe",
			parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }),
			execute: async ({ pattern, path }, _api, context) => {
				try { return content((await exec("rg", ["--line-number", "--", pattern, resolve(cwd, path ?? ".")], { maxBuffer: 1024 * 1024, signal: context.abortSignal })).stdout); }
				catch (error) { if (error instanceof Error && "code" in error && error.code === 1) return content(""); throw error; }
			},
		}),
	];
}
