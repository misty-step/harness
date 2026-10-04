/** Local command record-player. No model, network, credential or native session. */
import { appendFileSync, chmodSync, writeFileSync } from "node:fs";

const [role, configJson = "{}"] = process.argv.slice(2);
const config = JSON.parse(configJson);
const input = JSON.parse(await Bun.stdin.text());
appendFileSync("launches.jsonl", `${JSON.stringify({ role, input })}\n`);
if (config.delay) await Bun.sleep(config.delay);
if (config.pipeHang) {
	Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdin: "ignore", stdout: "inherit", stderr: "ignore" });
	process.exit(0);
}
if (config.hang) await new Promise(() => {});
if (config.exit) process.exit(config.exit);
if (config.malformed) { console.log("not JSON"); process.exit(0); }
if (config.overflow) { console.log("x".repeat(512 * 1024 + 1)); process.exit(0); }
if (role === "usage") {
	const readings = input.accounts.map((seat: any) => ({ ...seat, observedAt: Date.now(), usedPercent: 20, capped: false, evidence: ["fixture-quota"], ...config.reading }));
	if (config.missing) readings.pop();
	if (config.duplicate) readings[1] = readings[0];
	console.log(JSON.stringify(config.reply ?? { readings }));
} else if (role === "engineer") {
	if (!config.noOutput) for (const output of input.request.task.outputs) writeFileSync(output, "fixture-delivery\n");
	console.log(JSON.stringify(config.reply ?? {
		vendor: config.vendor ?? (input.request.task.route.provider === "anthropic" ? "anthropic" : "google"),
		result: { sessionId: "fixture-native-session", completed: true, acknowledged: true, text: "fixture answer", model: input.request.task.route.model, usage: null, ...config.result },
	}));
} else if (role === "reviewer") {
	if (config.mutate) writeFileSync(input.task.outputs[0], "changed during review\n");
	if (config.lockCleanup) chmodSync(config.lockCleanup, 0o500);
	const receipt = {
		runId: input.task.id, checkId: input.task.checks[0].id, deliveryDigest: input.delivery.deliveryDigest,
		verdict: "pass", reviewer: "google:review-seat", evidence: ["fixture-independent-review"], ...config.receipt,
	};
	console.log(JSON.stringify(config.reply ?? { vendor: config.vendor ?? "google", receipt: config.unknown ? null : receipt }));
} else { process.exit(1); }
