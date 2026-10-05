// Builds the README's before/after images from tests/mock-showcase.html, using the real extension.
//
//   npm run showcase      writes docs/before.png, docs/after.png, docs/before-after.png and
//                         docs/social-preview.png (1280×640, for GitHub's Settings → Social preview)

const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const DOCS = path.join(ROOT, "docs");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-showcase.html"), "utf8");

const RULES = [
  ["2100-", "#fff3a8", "Microeconomics"], ["4410-", "#ffe2c6", "Corporate Finance"], ["3050-", "#e7defc", "Marketing"],
  ["3200-", "#d9e8ff", "Operations"], ["1500-", "#d2f0ec", "Accounting"]
].map(([match, bg, label]) => ({ match, bg, label, literal: true, ribbon: "rgb(78, 174, 119)" }));

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`; // single quotes: it goes inside style="…"
const img = (buf) => `data:image/png;base64,${buf.toString("base64")}`;

const beforeAfter = (before, after) => `
  <body style="margin:0;padding:28px 28px 30px;background:#f7f6f3;font-family:${FONT};color:#37352f">
    <div style="display:flex;gap:24px">
      ${[["Before", "One timetable feed, so every class is the same colour", before], ["After", "Right-click a class to give the whole course its own colour", after]].map(([tag, text, src]) => `
        <div style="flex:1;min-width:0">
          <div style="margin:0 2px 12px"><span style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#787774">${tag}</span>
            <div style="font-size:17px;font-weight:600;margin-top:3px">${text}</div></div>
          <img src="${src}" style="width:100%;display:block;border-radius:10px;box-shadow:0 0 0 1px rgba(15,15,15,.07),0 6px 20px rgba(15,15,15,.08)">
        </div>`).join("")}
    </div>
  </body>`;

const social = (before, after) => `
  <body style="margin:0;width:1280px;height:640px;overflow:hidden;background:#f7f6f3;font-family:${FONT};color:#37352f;display:flex;align-items:center">
    <div style="width:430px;padding:0 0 0 64px;flex:none">
      <div style="font-size:54px;font-weight:800;letter-spacing:-.03em">TwoTone</div>
      <div style="font-size:26px;font-weight:600;line-height:1.25;margin-top:14px">See your week at a glance</div>
      <div style="font-size:18px;line-height:1.4;color:#787774;margin-top:16px">Right-click any event to give it its own colour.</div>
    </div>
    <div style="position:relative;flex:1;height:640px">
      <img src="${before}" style="position:absolute;left:70px;top:56px;width:560px;border-radius:10px;box-shadow:0 0 0 1px rgba(15,15,15,.07),0 8px 24px rgba(15,15,15,.1)">
      <img src="${after}" style="position:absolute;left:210px;top:214px;width:560px;border-radius:10px;box-shadow:0 0 0 1px rgba(15,15,15,.07),0 14px 40px rgba(15,15,15,.2)">
    </div>
  </body>`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "twotone-showcase-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 860, height: 640 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  try {
    await ctx.route("https://calendar.notion.so/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: MOCK }));
    let [worker] = ctx.serviceWorkers();
    if (!worker) worker = await ctx.waitForEvent("serviceworker");

    const page = await ctx.newPage();
    await page.goto("https://calendar.notion.so/week/2026/10/5");
    await page.waitForTimeout(500);
    const before = await page.screenshot({ path: path.join(DOCS, "before.png") });

    await worker.evaluate((rules) => chrome.storage.local.set({ rules }), RULES);
    await page.waitForTimeout(400);
    const after = await page.screenshot({ path: path.join(DOCS, "after.png") });

    const sheet = await ctx.newPage();
    await sheet.setViewportSize({ width: 1480, height: 400 });
    await sheet.setContent(beforeAfter(img(before), img(after)));
    await sheet.waitForTimeout(200);
    await sheet.screenshot({ path: path.join(DOCS, "before-after.png"), fullPage: true });
    await sheet.close();

    // GitHub wants 1280×640, so this one is rendered at 1× on its own page.
    const flat = await chromium.launch({ channel: "chromium", headless: true });
    const card = await flat.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
    await card.setContent(social(img(before), img(after)));
    await card.waitForTimeout(200);
    await card.screenshot({ path: path.join(DOCS, "social-preview.png") });
    await flat.close();

    console.log("Wrote docs/before.png, docs/after.png, docs/before-after.png, docs/social-preview.png");
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
