// Smoke test for /marketing: page renders, slop check scores, calendar +
// repurposing map generate. Run: node scripts/marketing-smoke.mjs [port]
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
let pageErr = null;
page.on("pageerror", (e) => (pageErr = String(e).slice(0, 200)));
await page.goto(`http://localhost:${process.argv[2] ?? "3997"}/marketing`);
await page.waitForSelector("text=Marketing HQ", { timeout: 20000 });
// slop check flow
await page.fill("textarea", "In today's fast-paced world, this game-changer will unlock your potential — dive into it!");
await page.click("text=Check it");
await page.waitForSelector("text=/\\d+\\/100 human/", { timeout: 5000 });
const score = await page.locator("text=/\\d+\\/100 human/").first().textContent();
// calendar flow
await page.click("text=Content Calendar (2 weeks)");
await page.fill('input[placeholder*="your topic"]', "street food");
await page.click("text=Plan it");
await page.waitForSelector("text=Week 2", { timeout: 5000 });
// repurpose map renders
await page.click("text=Repurposing Map (one edit → every platform)");
await page.waitForSelector("text=TikTok / Reels / Shorts", { timeout: 5000 });
if (pageErr) { console.error("FAIL pageerror:", pageErr); process.exit(1); }
console.log(`PASS ✅  /marketing live — slop ${score?.trim()}, calendar + repurpose map render`);
await browser.close();
