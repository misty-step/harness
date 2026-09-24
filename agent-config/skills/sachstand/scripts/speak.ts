#!/usr/bin/env bun
// Speak a sachstand script aloud with Gemini 3.8 Flash-Lite TTS.
// Usage: pass-env run -e GEMINI_API_KEY=workstation/GEMINI_API_KEY -- bun speak.ts [--no-play] < script.txt
// Writes a private, unique WAV under ~/.cache/tts-play/, starts playback detached,
// and prints its path, length, and estimated cost when usage is available.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MODEL = "gemini-3.8-flash-lite-tts";
const VOICE = process.env.SACHSTAND_VOICE ?? "voice_mb4bkecb84v5"; // designed "Chief of Staff", stored until 2027-09-24
const STYLE = "brisk executive briefing: calm, crisp, confident; slight pause before each decision";
const USD_PER_M = { text: 0.5, audio: 6 }; // standard tier through 2026-12-31; doubles 2027-01-01

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isJson) : []);
const tokenCount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function fail(message: string): never {
  console.error(`sachstand speak: ${message}`);
  process.exit(1);
}

const key = process.env.GEMINI_API_KEY ?? fail("GEMINI_API_KEY missing; run through pass-env");
const script = (await Bun.stdin.text()).trim() || fail("empty script on stdin");

const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
  method: "POST",
  headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    store: false,
    input: [{
      type: "user_input",
      content: [{ type: "text", text: script, annotations: [{ type: "speech_metadata", style: STYLE }] }],
    }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: VOICE }] },
  }),
});
const body: unknown = await response.json().catch(() => ({}));
if (!response.ok || !isJson(body)) fail(`HTTP ${response.status}: ${JSON.stringify(body).slice(0, 400)}`);

const audio = list(body.steps).flatMap(step => list(step.content)).find(part => part.type === "audio");
if (typeof audio?.data !== "string") fail(`no audio in response (status ${String(body.status)})`);
const wav = Buffer.from(audio.data, "base64");

const dir = join(homedir(), ".cache", "tts-play");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const path = join(dir, `sachstand-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}-${randomUUID()}.wav`);
writeFileSync(path, wav, { flag: "wx", mode: 0o600 });

if (!Bun.argv.includes("--no-play")) {
  // Detached so the written brief can appear while the audio plays.
  const player = Bun.spawn(["setsid", "-f", "pw-play", path], { stdout: "ignore", stderr: "inherit" });
  if ((await player.exited) !== 0) fail(`could not start pw-play; audio kept at ${path}`);
}

const usage = isJson(body.usage) ? body.usage : {};
const inputTokens = tokenCount(usage.total_input_tokens);
const outputTokens = tokenCount(usage.total_output_tokens);
const seconds = (wav.length - 44) / wav.readUInt32LE(28); // RIFF byte rate at offset 28
const rateMultiplier = Date.now() < Date.UTC(2027, 0, 1) ? 1 : 2;
const cost = inputTokens !== undefined && outputTokens !== undefined
  ? ` · ~$${((inputTokens * USD_PER_M.text + outputTokens * USD_PER_M.audio) * rateMultiplier / 1e6).toFixed(6)} (standard tier estimate)`
  : " · cost unavailable (usage missing or invalid)";
console.log(`${path}\n${seconds.toFixed(0)}s${cost}`);
