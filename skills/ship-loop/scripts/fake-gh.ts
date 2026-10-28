#!/usr/bin/env bun
// Test double for the `gh api` calls ship-loop makes. Comments live in $SHIP_LOOP_FAKE_STORE.
// SHIP_LOOP_FAKE_FAIL=read fails every read; =post-after writes, then fails the response.
import { readFileSync, writeFileSync } from "node:fs";

const store = process.env.SHIP_LOOP_FAKE_STORE;
if (!store) throw new Error("SHIP_LOOP_FAKE_STORE is required");
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(store, "utf8")) as { comments: { id: number; body: string; author: string | null }[]; next: number; base_ref?: string };
const fail = process.env.SHIP_LOOP_FAKE_FAIL;

if (fail === "read" && !args.includes("POST")) {
  process.stderr.write("HTTP 503: unavailable\n");
  process.exit(1);
}
if (args.some((a) => /\/pulls\/\d+$/.test(a))) {
  process.stdout.write(JSON.stringify({ author: "conductor", baseRef: state.base_ref ?? "master" }) + "\n");
} else if (args.includes("-X") && args.includes("POST")) {
  const body = JSON.parse(readFileSync(0, "utf8")).body as string;
  const id = state.next++;
  state.comments.push({ id, body, author: "conductor" });
  writeFileSync(store, JSON.stringify(state));
  if (fail === "post-after") {
    process.stderr.write("HTTP 502: response lost\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ id }) + "\n");
} else {
  for (const c of state.comments) process.stdout.write(JSON.stringify([c.id, c.body, c.author]) + "\n");
}
