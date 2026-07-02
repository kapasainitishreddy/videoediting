import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("console", m => { if (m.type() === "error") console.error("[page]", m.text().slice(0,120)); });
await page.goto("http://localhost:3997/dev/xfade");
const results = await page.waitForFunction(() => window.testResults, null, { timeout: 240000 }).then(h => h.jsonValue());
console.log(JSON.stringify(results, null, 2));
await browser.close();
