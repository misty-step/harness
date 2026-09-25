// The spoken brief is playback the operator asked for (US-020), so it leaves the
// agent audio sandbox (US-026) explicitly: every routing key the sandbox marker
// lists is dropped, and the operator's default device plays the brief.
export function operatorPlaybackEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const playback = { ...env };
  for (const name of env.AGENT_AUDIO_SANDBOX?.split(" ") ?? []) delete playback[name];
  delete playback.AGENT_AUDIO_SANDBOX;
  return playback;
}
