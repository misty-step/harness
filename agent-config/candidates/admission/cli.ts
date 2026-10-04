import { admit, commissionDigest } from "./core";

async function input(): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const timer = setTimeout(() => { process.stdin.destroy(); reject(new Error("input_timeout")); }, 5000);
		process.stdin.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > 512 * 1024) { clearTimeout(timer); process.stdin.destroy(); reject(new Error("input_limit")); }
			else chunks.push(chunk);
		});
		process.stdin.on("error", reject);
		process.stdin.on("end", () => {
			clearTimeout(timer);
			try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { reject(error); }
		});
	});
}

try {
	const args = process.argv.slice(2);
	if (args.length === 1 && args[0] === "--digest") {
		console.log(JSON.stringify({ digest: commissionDigest(await input()) }));
	} else if (args.length === 2 && args[0] === "--state-dir") {
		const result = await admit(await input(), args[1]!);
		console.log(JSON.stringify(result));
		process.exitCode = result.status === "pass" ? 0 : result.status === "unknown" ? 3 : 2;
	} else { throw new Error("invalid_arguments"); }
} catch {
	console.log(JSON.stringify({ status: "refused", code: "invalid_input", launches: { engineer: 0, reviewer: 0 } }));
	process.exitCode = 2;
}
