const LIMIT = 512 * 1024;

/** A single bounded exchange, including pipe EOF (children may keep pipes open). */
export async function command(argv: string[], input: unknown, cwd: string, timeoutMs: number): Promise<unknown> {
	// Bun's byte-buffer stdin avoids JS pipe writes, which runner-01 refuses.
	const child = Bun.spawn(argv, { cwd, detached: true, stdin: Buffer.from(`${JSON.stringify(input)}\n`), stdout: "pipe", stderr: "ignore" });
	const reader = child.stdout.getReader();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const reply = (async () => {
		let size = 0;
		const chunks: Uint8Array[] = [];
		for (;;) {
			const { done, value: chunk } = await reader.read();
			if (done) break;
			size += chunk.length;
			if (size > LIMIT) throw new Error("command reply too large");
			chunks.push(chunk);
		}
		if (await child.exited !== 0) throw new Error("command did not return a definitive reply");
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	})();
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("command deadline")), timeoutMs);
	});
	try { return await Promise.race([reply, deadline]); }
	catch (error) {
		// POSIX owned process group only; no claim about external native work.
		try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
		throw error;
	} finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}
