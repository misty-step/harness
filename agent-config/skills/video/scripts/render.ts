// Deterministic frame renderer: seek the paused GSAP timeline to t = frame/fps, screenshot, repeat.
// usage: bun render.ts FILM_DIR OUTDIR FROM_SEC TO_SEC [workers=6] [query=""] [fps=60]   (FILM_DIR holds film.html)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs"; import { join, resolve } from "node:path";
const [filmDir, outDir, from, to, workersArg, query, fpsArg] = [Bun.argv[2], Bun.argv[3], Number(Bun.argv[4]), Number(Bun.argv[5]), Number(Bun.argv[6] ?? 6), Bun.argv[7] ?? "", Number(Bun.argv[8] ?? 60)];
const url = `file://${resolve(filmDir, "film.html")}${query ? "?" + query : ""}`;
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--allow-file-access-from-files", "--disable-web-security", "--force-color-profile=srgb", "--font-render-hinting=none"] });
const first = Math.round(from * fpsArg), last = Math.round(to * fpsArg); // [first, last)
let next = first; const t0 = Date.now(); let done = 0;
async function worker(k: number) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.error("pageerror", e.message)); p.on("console", (m) => { if (m.type() === "error") console.error("console", m.text()); });
  await p.goto(url); await p.waitForFunction("window.__built === true", null, { timeout: 60000 });
  while (true) {
    const f = next++; if (f >= last) break;
    await p.evaluate((t) => (window as any).__seek(t), f / fpsArg);
    await p.screenshot({ path: join(outDir, String(f).padStart(5, "0") + ".jpg"), type: "jpeg", quality: 96 });
    if (++done % 120 === 0) console.log(`${done}/${last - first} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await ctx.close();
}
await Promise.all(Array.from({ length: workersArg }, (_, k) => worker(k)));
await browser.close(); console.log(`rendered ${last - first} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`); process.exit(0);
