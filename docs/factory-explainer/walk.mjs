// Real-browser contract walk. Sequential; no provider or factory calls.
// PLAYWRIGHT_MODULE and AXE_SCRIPT select existing installations, never fetch them.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const url = process.argv[2];
const out = resolve(process.argv[3] || ".browser-proof");
if (!url || !process.env.AXE_SCRIPT) throw new Error("Usage: AXE_SCRIPT=existing/axe.min.js PLAYWRIGHT_MODULE=existing/playwright node walk.mjs URL OUTPUT_DIRECTORY");
await mkdir(out, {recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_BIN || "/usr/bin/chromium",headless:true,args:["--disable-dev-shm-usage"]});
const results = [];
const linkChecks = [];
try {
  for (const spec of [
    {name:"desktop",viewport:{width:1280,height:640},isMobile:false,hasTouch:false},
    {name:"phone",viewport:{width:390,height:844},isMobile:true,hasTouch:true},
    {name:"narrow",viewport:{width:320,height:740},isMobile:true,hasTouch:true},
    {name:"tablet",viewport:{width:768,height:1024},isMobile:true,hasTouch:true}
  ]) {
    const context = await browser.newContext({...spec,reducedMotion:"reduce"});
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror",error => errors.push(error.message));
    const response = await page.goto(url,{waitUntil:"networkidle"});
    assert.equal(response.status(),200);
    await page.addScriptTag({path:process.env.AXE_SCRIPT});
    const check = async label => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`${spec.name}/${label}: page overflow`);
      assert.equal(await page.locator("dialog[open]").evaluateAll(nodes => nodes.some(n => n.scrollWidth > n.clientWidth)),false,`${label}: dialog overflow`);
      const failures = await page.evaluate(async () => (await axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations.map(v => ({id:v.id,nodes:v.nodes.map(n => n.target)})));
      assert.deepEqual(failures,[],`${spec.name}/${label}: axe violations`);
      results.push({viewport:spec.name,state:label,axeViolations:0});
    };
    await check("overview");
    await page.screenshot({path:`${out}/${spec.name}-first.png`});
    await page.screenshot({path:`${out}/${spec.name}-full.png`,fullPage:true});
    if (spec.name === "desktop") {
      assert.ok(await page.locator("footer").evaluate(n => n.getBoundingClientRect().bottom <= innerHeight),"Whole overview must fit one desktop screen");
    }
    if (spec.isMobile) {
      const small = await page.locator("main button").evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().height < 44).map(n => n.textContent.trim()));
      assert.deepEqual(small,[],"Phone controls need 44px touch height");
    }
    const open = async locator => spec.hasTouch ? locator.tap() : locator.click();
    // Every top-level topic renders, closes, and returns focus to its real opener.
    const ids = await page.locator(".shell [data-topic]").evaluateAll(nodes => [...new Set(nodes.map(n => n.dataset.topic))]);
    for (const id of ids) {
      const trigger = page.locator(`.shell [data-topic="${id}"]`).first();
      await open(trigger);
      await page.locator("dialog[open] #detail-title").waitFor();
      await check(id);
      if (spec.name === "desktop" || spec.name === "phone") await page.screenshot({path:`${out}/${spec.name}-${id}.png`});
      if (id === "sources") {
        const internal = await page.locator("#detail-body .source-links a").evaluateAll(nodes => nodes.map(node => node.href).filter(href => new URL(href).origin === location.origin));
        assert.ok(internal.length > 0, "Sources view needs a publication-internal link");
        for (const href of internal) {
          const response = await page.request.get(href);
          assert.equal(response.status(),200,`${spec.name}: internal Sources link does not resolve: ${new URL(href).pathname}`);
          const content = await response.text();
          assert.ok(content.includes("## Private immutable publication"),`${spec.name}: linked README lacks its publication section`);
          linkChecks.push({viewport:spec.name,path:new URL(href).pathname,status:response.status(),publicationSection:true});
        }
      }
      if (id === "summon") {
        for (const scenario of ["lost","steered","cancel","answered"]) {
          await open(page.locator(`[data-scenario="${scenario}"]`));
          assert.equal(await page.locator(`[data-scenario="${scenario}"]`).getAttribute("aria-pressed"),"true");
          assert.ok((await page.locator("#state-readout").textContent()).length > 80);
        }
        await page.screenshot({path:`${out}/${spec.name}-state-example.png`});
      }
      if (id === "packets") {
        await open(page.getByText("Illustrative recursive task: tap through its children",{exact:true}));
        await open(page.getByText("Engineer: candidate A",{exact:true}));
        await open(page.getByText("Consumer child: source unavailable",{exact:true}));
        await check("recursive-child-open");
        await page.screenshot({path:`${out}/${spec.name}-recursive.png`});
      }
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog").evaluate(n => n.open),false);
      assert.equal(await trigger.evaluate(n => document.activeElement === n),true,"Escape restores opener focus");
    }
    // The task sequence navigates in both directions and exposes genuine relationships.
    await open(page.locator('[data-step="0"]'));
    for (let i = 0; i < 6; i++) {
      assert.equal(await page.locator("#step-count").textContent(),`${i+1} / 6`);
      if (spec.name === "phone") await page.screenshot({path:`${out}/phone-journey-${i+1}.png`});
      if (i < 5) await open(page.locator("#next-detail"));
    }
    assert.equal(await page.locator("#next-detail").isDisabled(),true);
    await open(page.locator("#previous-detail"));
    assert.equal(await page.locator("#step-count").textContent(),"5 / 6");
    await open(page.locator('.related [data-topic="packets"]'));
    await page.locator("#detail-title").filter({hasText:"A packet preserves"}).waitFor();
    assert.equal(await page.locator(".dialog-nav").isVisible(),false);
    await open(page.locator("#close-detail"));
    // Native modal keeps background inert and keyboard cycling inside the dialog.
    await page.locator('[data-topic="summon"]').first().focus();
    await page.keyboard.press("Enter");
    for (let i=0;i<16;i++) {
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.closest("dialog[open]") !== null),true,"Modal keyboard focus escapes the open dialog");
    }
    assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),true);
    const animated = await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length);
    assert.equal(animated,0,"Reduced motion has running animations");
    await page.keyboard.press("Escape");
    assert.deepEqual(errors,[],"Browser JS errors");
    await context.close();
  }
  await writeFile(`${out}/receipt.json`,JSON.stringify({url,browser:"real Chromium",touch:"emulated touchscreen, not physical handset",reducedMotion:true,results,linkChecks},null,2));
  console.log(`PASS ${results.length} rendered states, ${linkChecks.length} internal link checks, four viewports, touch, keyboard, journeys, recursive drilldown, reduced motion and axe; ${out}`);
} finally { await browser.close(); }
