import { readFileSync, realpathSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";

// Installer-only: build trusted source, never execute it. Runtime dependencies
// must be Bun/builtins or source modules contained in this component.
const [entry, destination] = process.argv.slice(2);
if (!entry) throw new Error("usage: launcher-build.ts ENTRY [DESTINATION]");
const root = realpathSync(resolve(import.meta.dir, ".."));
const source = readFileSync(entry, "utf8");
const header = source.split("\n").slice(0, 2).join("\n");
const built = await Bun.build({
	entrypoints: [resolve(entry)],
	target: "bun",
	plugins: [{
		name: "owned-launcher-dependencies",
		setup(build) {
			build.onResolve({ filter: /.*/ }, ({ path, importer }) => {
				if (path === "bun" || isBuiltin(path)) return { path, external: true };
				if (importer && !path.startsWith(".")) throw new Error(`Launcher dependency must be owned local source: ${path}`);
				const file = realpathSync(resolve(importer ? dirname(importer) : root, path));
				const inside = relative(root, file);
				if (inside === ".." || inside.startsWith(`..${sep}`) || inside.startsWith(sep)) throw new Error(`Launcher dependency escapes agent-config: ${path}`);
				return { path: file };
			});
		},
	}],
});
if (!built.success) throw new AggregateError(built.logs, "Launcher build failed");
if (built.outputs.length !== 1) throw new Error("Launcher must build to one self-contained file");
if (destination) {
	const bundled = (await built.outputs[0].text()).replace(/^#![^\n]*\n/, "");
	await Bun.write(destination, `${header}\n${bundled}`);
}
