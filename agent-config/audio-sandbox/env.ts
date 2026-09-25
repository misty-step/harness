/**
 * Agent audio sandbox contract (US-026).
 *
 * An agent harness applies AGENT_AUDIO_ENV to its own process environment
 * when a session starts, so every process the session spawns plays into the
 * silent `agent-sandbox` sink and records from that sink's monitor instead of
 * the operator's speakers and microphone. `node.dont-fallback` is the
 * fail-closed half: when the sink is missing, a stream stays unlinked rather
 * than falling back to the operator's default device.
 *
 * The marker variable lists the routing keys, so a playback the operator asked
 * for (the spoken sachstand brief) leaves the sandbox explicitly and visibly.
 */
export const AGENT_AUDIO_SINK = "agent-sandbox";
export const AGENT_AUDIO_MARKER = "AGENT_AUDIO_SANDBOX";

const routing = {
	// PulseAudio-API clients: paplay, parecord, ffplay, ffmpeg, mpv, Chromium, Electron.
	PULSE_SINK: AGENT_AUDIO_SINK,
	PULSE_SOURCE: `${AGENT_AUDIO_SINK}.monitor`,
	PULSE_PROP: "node.dont-fallback=true",
	// Native PipeWire clients (pw-play, pw-record, mpv) and ALSA through
	// pipewire-alsa (aplay). PIPEWIRE_NODE overrides an explicit native target;
	// stream.capture.sink lets a default capture record the sink's monitor.
	PIPEWIRE_NODE: AGENT_AUDIO_SINK,
	PIPEWIRE_PROPS: "{ node.dont-fallback = true stream.capture.sink = true }",
};

export const AGENT_AUDIO_ENV: Readonly<Record<string, string>> = Object.freeze({
	...routing,
	[AGENT_AUDIO_MARKER]: Object.keys(routing).join(" "),
});

/** Route every process spawned from this environment to the sandbox sink. */
export function sandboxAgentAudio(env: Record<string, string | undefined> = process.env): void {
	Object.assign(env, AGENT_AUDIO_ENV);
}

/**
 * One POSIX line exporting the contract, for a harness that can only prefix
 * its shell commands. Values carry no single quotes, so plain quoting is exact.
 */
export function shellExports(): string {
	return `export ${Object.entries(AGENT_AUDIO_ENV)
		.map(([name, value]) => `${name}='${value}'`)
		.join(" ")}`;
}
