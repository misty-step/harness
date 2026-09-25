import { expect, test } from "bun:test";
import { AGENT_AUDIO_MARKER, shellExports } from "../../agent-config/audio-sandbox/env.ts";
import { mergeAudioPrefix } from "./pi-audio-prefix.ts";

const merge = (settings: Record<string, unknown> | undefined): Record<string, unknown> =>
	JSON.parse(mergeAudioPrefix(settings === undefined ? undefined : JSON.stringify(settings), shellExports(), AGENT_AUDIO_MARKER));
const refused = (prefix: string) => () =>
	mergeAudioPrefix(JSON.stringify({ shellCommandPrefix: prefix }), shellExports(), AGENT_AUDIO_MARKER);

test("US-026 pi's prefix is created, kept, and renewed while foreign keys survive", () => {
	expect(merge(undefined)).toEqual({ shellCommandPrefix: shellExports() });
	expect(merge({ defaultModel: "x", shellCommandPrefix: shellExports() })).toEqual({
		defaultModel: "x",
		shellCommandPrefix: shellExports(),
	});
	const stale = "export PULSE_SINK='old-sink' AGENT_AUDIO_SANDBOX='PULSE_SINK'";
	expect(merge({ shellCommandPrefix: stale }).shellCommandPrefix).toBe(shellExports());
});

test("US-026 any prefix pi-config did not write fails closed", () => {
	expect(refused("shopt -s expand_aliases")).toThrow("foreign shellCommandPrefix");
	expect(refused(`${shellExports()}; source ~/.pi/aliases`)).toThrow("foreign shellCommandPrefix");
	expect(refused(`export FOO='keep' ${shellExports().slice("export ".length)}`)).toThrow("foreign shellCommandPrefix");
	expect(refused(`${shellExports()} $(touch /tmp/x)`)).toThrow("foreign shellCommandPrefix");
	expect(refused("export PULSE_SINK='mine'")).toThrow("foreign shellCommandPrefix");
});
