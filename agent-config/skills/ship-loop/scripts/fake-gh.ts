#!/usr/bin/env bun
// Test double for the `gh api` calls ship-loop makes. Comments live in $SHIP_LOOP_FAKE_STORE.
// SHIP_LOOP_FAKE_FAIL=read fails every read; =post-after writes, then fails the response.
import { readFileSync, writeFileSync } from "node:fs";

const store = process.env.SHIP_LOOP_FAKE_STORE;
if (!store) throw new Error("SHIP_LOOP_FAKE_STORE is required");
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(store, "utf8")) as { comments: { id: number; body: string }[]; next: number };
const fail = process.env.SHIP_LOOP_FAKE_FAIL;

if (args.includes("-X") && args.includes("POST")) {
  const body = JSON.parse(readFileSync(0, "utf8")).body as string;
  const id = state.next++;
  state.comments.push({ id, body });
  writeFileSync(store, JSON.stringify(state));
  if (fail === "post-after") {
    process.stderr.write("HTTP 502: response lost\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ id }) + "\n");
} else {
  if (fail === "read") {
    process.stderr.write("HTTP 503: unavailable\n");
    process.exit(1);
  }
  for (const c of state.comments) process.stdout.write(JSON.stringify([c.id, c.body]) + "\n");
}
