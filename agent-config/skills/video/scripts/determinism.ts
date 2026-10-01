import { chromium } from "playwright-core"; import { join } from "node:path"; import { createHash } from "node:crypto";
// usage: bun determinism.ts FILM_DIR ["scenes=s01"] "t1,t2,..."  (seek forward then backward, hashes must match)
const filmDir = Bun.argv[2]; const query = Bun.argv[3] ?? ""; const times = (Bun.argv[4] ?? "1,3.3,0.2,2.5").split(",").map(Number);
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--allow-file-access-from-files", "--disable-web-security", "--force-color-profile=srgb"] });
async function run(order: number[]) {
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await p.goto(`file://${join(require("node:path").resolve(filmDir), "film.html")}?${query}`); await p.waitForFunction("window.__built === true");
  const out: Record<number, string> = {};
  for (const t of order) { await p.evaluate((t) => (window as any).__seek(t), t); out[t] = createHash("md5").update(await p.screenshot({ type: "png" })).digest("hex").slice(0, 10); }
  return out;
}
const a = await run(times), c = await run([...times].reverse());
let bad = 0; for (const t of times) { const same = a[t] === c[t]; if (!same) bad++; console.log(t, a[t], c[t], same ? "same" : "DIFF"); }
console.log(bad === 0 ? "deterministic" : `NOT deterministic (${bad})`); await b.close(); process.exit(bad ? 1 : 0);
