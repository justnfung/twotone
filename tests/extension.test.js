// End-to-end test: loads the real extension into Chromium and runs it against
// tests/mock-calendar.html, served at https://calendar.notion.so so the content script injects.
//
//   npm test                 run the checks
//   npm run screenshots      run the checks and refresh the images in docs/
//
// The mock copies the parts of Notion Calendar's markup the extension relies on. It can't prove
// the extension works against today's real Notion Calendar, so check that by hand before a release.

const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const DOCS = path.join(ROOT, "docs");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-calendar.html"), "utf8");
const MOCK_PAST = fs.readFileSync(path.join(__dirname, "mock-past.html"), "utf8");
const SCREENSHOTS = process.argv.includes("--screenshots");

const COLOURS = {
  green: "rgb(226, 251, 228)", pink: "rgb(250, 222, 245)",
  orange: "rgb(255, 226, 198)", yellow: "rgb(255, 243, 168)", red: "rgb(253, 220, 216)",
  purple: "rgb(231, 222, 252)", blue: "rgb(217, 232, 255)", teal: "rgb(210, 240, 236)"
};

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? `  (got: ${detail})` : ""}`);
  if (!ok) failures++;
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "twotone-test-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 790, height: 540 },
    deviceScaleFactor: SCREENSHOTS ? 2 : 1,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });

  try {
    await ctx.route("https://calendar.notion.so/**", (r) =>
      r.fulfill({ status: 200, contentType: "text/html", body: r.request().url().includes("/past/") ? MOCK_PAST : MOCK }));
    let [worker] = ctx.serviceWorkers();
    if (!worker) worker = await ctx.waitForEvent("serviceworker");
    const extId = new URL(worker.url()).host;

    const page = await ctx.newPage();
    await page.goto("https://calendar.notion.so/2026/9/20");
    await page.waitForTimeout(600);

    // ---------------------------------------------------------------- helpers
    const fill = (key) => page.evaluate((k) => getComputedStyle(document.querySelector(`[data-event-chip-key="${k}"]`)).backgroundColor, key);
    const bar = (key) => page.evaluate((k) => getComputedStyle(document.querySelector(`[data-event-chip-key="${k}"]`), "::before").backgroundImage, key);
    const menuOpen = () => page.evaluate(() => !!document.getElementById("twotone-menu-host"));
    const notionMenuOpen = () => page.evaluate(() => document.getElementById("notion-menu").style.display === "block");
    const hideNotionMenu = () => page.evaluate(() => (document.getElementById("notion-menu").style.display = "none"));
    const rightClick = async (key) => { await page.click(`[data-event-chip-key="${key}"]`, { button: "right" }); await page.waitForTimeout(100); };
    const scopes = () => page.evaluate(() =>
      [...document.getElementById("twotone-menu-host").shadowRoot.querySelectorAll(".scope")].map((s) => ({ label: s.textContent, on: s.querySelector("input").checked })));
    const pickScope = (text) => page.evaluate((t) => {
      const s = [...document.getElementById("twotone-menu-host").shadowRoot.querySelectorAll(".scope")].find((x) => x.textContent.includes(t));
      s.querySelector("input").click();
    }, text);
    const menuClick = async (selector) => {
      await page.evaluate((s) => document.getElementById("twotone-menu-host").shadowRoot.querySelector(s).click(), selector);
      await page.waitForTimeout(200);
    };
    const swatch = (name) => menuClick(`.sw[title="${name}"]`);

    // ---------------------------------------------------------------- fresh install
    console.log("Fresh install");
    const stored = await worker.evaluate(() => chrome.storage.local.get(null));
    check("starts with no colours saved", !stored.rules && !stored.events, JSON.stringify(stored));
    check("events keep Notion's colours", (await fill("micro-4")) === COLOURS.green, await fill("micro-4"));

    // ---------------------------------------------------------------- course colours
    console.log("Colouring a course");
    await rightClick("micro-5");
    check("right-click opens the colour menu", await menuOpen());
    check("…instead of Notion's menu", !(await notionMenuOpen()));
    const s1 = await scopes();
    check("numbered course code detected and preselected", s1[0].label === "All 2100 Microeconomics events" && s1[0].on, JSON.stringify(s1));
    const hint = await page.evaluate(() => document.getElementById("twotone-menu-host").shadowRoot.querySelector(".kbd").textContent);
    check("shortcut hint matches the platform", hint === (process.platform === "darwin" ? "⌥ right-click" : "Alt + right-click"), hint);
    await swatch("Yellow");
    check("picking a colour closes the menu", !(await menuOpen()));
    check("clicked lecture is yellow", (await fill("micro-5")) === COLOURS.yellow, await fill("micro-5"));
    check("other lecture in the course is yellow", (await fill("micro-4")) === COLOURS.yellow, await fill("micro-4"));
    check("calendar's green bar is kept", (await bar("micro-4")).includes("rgb(76, 175, 92)"), await bar("micro-4"));
    check("other courses untouched", (await fill("mkt-6")) === COLOURS.green, await fill("mkt-6"));

    await rightClick("fin-3");
    await swatch("Orange");
    check("second course coloured", (await fill("fin-4")) === COLOURS.orange, await fill("fin-4"));

    await rightClick("bio-lab");
    const s2 = await scopes();
    check("lettered course code detected (BIO 101)", s2[0].label === "All BIO 101 events", JSON.stringify(s2));
    await swatch("Purple");
    check("BIO 101 Lecture follows BIO 101 Lab", (await fill("bio-lec")) === COLOURS.purple, await fill("bio-lec"));

    // ---------------------------------------------------------------- single events
    console.log("Single events");
    await rightClick("coffee");
    const s3 = await scopes();
    check("non-course event offers same-title + this-event", s3.map((s) => s.label).join(" | ") === "All events with this title | Only this event", JSON.stringify(s3));
    await pickScope("Only this event");
    await swatch("Blue");
    check("only that event is blue", (await fill("coffee")) === COLOURS.blue, await fill("coffee"));
    check("its pink bar is kept", (await bar("coffee")).includes("rgb(180, 60, 170)"), await bar("coffee"));
    check("other pink events untouched", (await fill("club")) === COLOURS.pink, await fill("club"));

    await rightClick("fin-3");
    await pickScope("Only this event");
    await menuClick(".reset");
    check("one session reset to calendar colour", (await fill("fin-3")) === COLOURS.green, await fill("fin-3"));
    check("rest of its course keeps the colour", (await fill("fin-4")) === COLOURS.orange, await fill("fin-4"));

    // ---------------------------------------------------------------- menu behaviour
    console.log("Menu behaviour");
    await rightClick("mkt-6");
    if (SCREENSHOTS) await page.screenshot({ path: path.join(DOCS, "menu.png") });
    const before = await page.evaluate(() => window.shortcutHits);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(50);
    check("Escape closes the menu", !(await menuOpen()));
    check("…without triggering Notion shortcuts", (await page.evaluate(() => window.shortcutHits)) === before);

    await rightClick("club");
    await page.mouse.click(780, 530);
    await page.waitForTimeout(50);
    check("clicking elsewhere closes the menu", !(await menuOpen()));

    await page.keyboard.down("Alt");
    await rightClick("club");
    await page.keyboard.up("Alt");
    check("Alt/Option + right-click opens Notion's menu", (await notionMenuOpen()) && !(await menuOpen()));
    await hideNotionMenu();

    await rightClick("club");
    await menuClick(".notion");
    check("'Notion menu' item hands the right-click to Notion", (await notionMenuOpen()) && !(await menuOpen()));
    await hideNotionMenu();

    // ---------------------------------------------------------------- Notion re-rendering
    console.log("When Notion re-renders");
    const firstFrame = await page.evaluate(() => new Promise((res) => {
      window.render();
      requestAnimationFrame(() => res(getComputedStyle(document.querySelector('[data-event-chip-key="micro-4"]')).backgroundColor));
    }));
    check("colours are back on the first frame after a rebuild", firstFrame === COLOURS.yellow, firstFrame);

    await page.evaluate(() => document.querySelector('[data-event-chip-key="fin-4"]').style.setProperty("--background-color", "rgb(76, 175, 92)"));
    await page.waitForTimeout(50);
    check("selected (solid) event is left to Notion", (await fill("fin-4")) === "rgb(76, 175, 92)", await fill("fin-4"));
    await page.evaluate(() => document.querySelector('[data-event-chip-key="fin-4"]').style.setProperty("--background-color", "rgb(226, 251, 228)"));
    await page.waitForTimeout(50);
    check("…and gets its colour back when deselected", (await fill("fin-4")) === COLOURS.orange, await fill("fin-4"));

    // ---------------------------------------------------------------- manager
    console.log("Manager");
    const mgr = await ctx.newPage();
    await mgr.setViewportSize({ width: 432, height: 420 });
    await mgr.goto(`chrome-extension://${extId}/popup.html`);
    await mgr.waitForTimeout(300);
    const counts = await mgr.evaluate(() => ({ groups: document.querySelectorAll("#rules .row").length, events: document.querySelectorAll("#events .row").length }));
    check("lists 3 groups and 2 single events", counts.groups === 3 && counts.events === 2, JSON.stringify(counts));
    if (SCREENSHOTS) await mgr.screenshot({ path: path.join(DOCS, "manager.png"), fullPage: true });
    await mgr.evaluate(() => {
      const row = [...document.querySelectorAll("#rules .row")].find((r) => r.querySelector(".match").value === "2100-");
      row.querySelector(".chip").click();
      const hexInput = document.querySelector(".tt-hex-val");
      hexInput.value = "#d2f0ec";
      hexInput.dispatchEvent(new Event("input"));
    });
    await mgr.waitForTimeout(400);
    check("editing a colour repaints the calendar live", (await fill("micro-4")) === COLOURS.teal, await fill("micro-4"));
    await mgr.evaluate(() => [...document.querySelectorAll("#rules .row")].find((r) => r.querySelector(".match").value === "2100-").querySelector(".del").click());
    await mgr.waitForTimeout(400);
    check("deleting a group restores Notion's colour", (await fill("micro-4")) === COLOURS.green, await fill("micro-4"));

    // ---------------------------------------------------------------- untrusted titles
    // Anyone who sends you an invite picks its title, so titles must never be treated as code.
    console.log("Untrusted event titles");
    await page.bringToFront();
    await rightClick("odd");
    await pickScope("All events with this title");
    await swatch("Red");
    check("title that looks like a regex is matched as plain text", (await fill("odd")) === COLOURS.red, await fill("odd"));
    check("…so it doesn't colour the events it would match as a regex",
      (await fill("club")) === COLOURS.pink && (await fill("coffee")) === COLOURS.blue, `${await fill("club")} / ${await fill("coffee")}`);

    // ---------------------------------------------------------------- course detection edge cases
    console.log("Course detection");
    const firstScopeFor = async (title) => {
      await page.evaluate((t) => {
        const c = document.querySelector('[data-event-chip-key="odd"]');
        c.firstChild.textContent = t;
      }, title);
      await page.waitForTimeout(50);
      await rightClick("odd");
      const label = (await scopes())[0].label;
      await page.keyboard.press("Escape");
      return label;
    };
    const cases = [
      ["CS-2100 Tutorial", "All CS-2100 events"],
      ["ECON2100 Midterm", "All ECON2100 events"],
      ["2026-09-21 Dentist", "All events with this title"],
      ["Office hours 3-4", "All events with this title"]
    ];
    for (const [title, want] of cases) {
      const got = await firstScopeFor(title);
      check(`"${title}" → ${want}`, got === want, got);
    }

    // ================================================================ newer behaviour
    // An extension page we keep open to read and write storage directly.
    await mgr.close();
    const ext = await ctx.newPage();
    await ext.goto(`chrome-extension://${extId}/popup.html`);
    await ext.waitForTimeout(200);
    const store = () => ext.evaluate(() => chrome.storage.local.get(null));
    const setStore = async (patch) => { await ext.evaluate((p) => chrome.storage.local.set(p), patch); await page.waitForTimeout(150); };
    const inMenu = (fn, arg) => page.evaluate(([f, a]) => new Function("root", "a", `return (${f})(root, a)`)(document.getElementById("twotone-menu-host").shadowRoot, a), [fn.toString(), arg]);
    const ruleFor = async (match) => ((await store()).rules || []).find((r) => r.match === match);
    await page.bringToFront();
    await page.evaluate(() => { document.querySelector('[data-event-chip-key="odd"]').firstChild.textContent = "/Club|Coffee/"; });

    // ---------------------------------------------------------------- default scope
    console.log("Default scope");
    const selectedScope = async (key) => {
      await rightClick(key);
      const on = (await scopes()).find((x) => x.on).label;
      await page.keyboard.press("Escape");
      return on;
    };
    check("a title nothing else shares defaults to only this event", (await selectedScope("club")) === "Only this event", await selectedScope("club"));
    await page.evaluate(() => { document.querySelector('[data-event-chip-key="odd"]').firstChild.textContent = "Club Meeting"; });
    await page.waitForTimeout(50);
    check("a title another event shares defaults to the group", (await selectedScope("club")) === "All events with this title", await selectedScope("club"));
    await page.evaluate(() => { document.querySelector('[data-event-chip-key="odd"]').firstChild.textContent = "/Club|Coffee/"; });
    await page.waitForTimeout(50);
    check("a course still defaults to the whole course", (await selectedScope("mkt-6")) === "All 3050 Marketing events", await selectedScope("mkt-6"));

    // ---------------------------------------------------------------- rules match titles only
    console.log("Rules match the title, not the time");
    const before1 = (await store()).rules;
    await setStore({ rules: [{ match: "PM", bg: "#d9e8ff", label: "", literal: false }, ...before1] });
    check("a rule for “PM” doesn't colour every afternoon event", (await fill("club")) === COLOURS.pink, await fill("club"));
    await setStore({ rules: [{ match: "club", bg: "#d9e8ff", label: "", literal: false }, ...before1] });
    check("…but a rule for a word in the title does", (await fill("club")) === COLOURS.blue, await fill("club"));
    await setStore({ rules: before1 });

    // ---------------------------------------------------------------- custom picker
    console.log("Custom picker");
    await rightClick("mkt-6");
    await menuClick(".custom");
    check("opening the picker doesn't colour anything", (await fill("mkt-6")) === COLOURS.green && !(await ruleFor("3050-")), await fill("mkt-6"));
    const sat = await inMenu((root) => { const r = root.querySelector(".tt-sat-area").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.mouse.move(sat.x + sat.w * 0.3, sat.y + sat.h * 0.2);
    await page.mouse.down();
    await page.mouse.move(sat.x + sat.w * 0.5, sat.y + sat.h * 0.3, { steps: 5 });
    await page.waitForTimeout(150);
    const dragFill = await fill("mkt-6");
    check("dragging previews the colour on the page", dragFill !== COLOURS.green, dragFill);
    check("…on the whole course", (await fill("mkt-6")) === dragFill);
    check("…without writing to storage yet", !(await ruleFor("3050-")));
    await page.mouse.up();
    await page.waitForTimeout(150);
    check("releasing saves it", !!(await ruleFor("3050-")), JSON.stringify((await store()).rules));
    await inMenu((root) => { const i = root.querySelector(".tt-hex-val"); i.value = "#d2f0ec"; i.dispatchEvent(new Event("input")); });
    await page.waitForTimeout(150);
    check("typing a hex value applies it", (await fill("mkt-6")) === COLOURS.teal && (await ruleFor("3050-")).bg === "#d2f0ec", await fill("mkt-6"));
    await page.keyboard.press("Escape");

    // ---------------------------------------------------------------- group order
    console.log("Group order");
    const order = async () => ((await store()).rules || []).map((r) => r.match).join(" | ");
    const orderBefore = await order();
    await rightClick("bio-lab");
    await swatch("Lime");
    check("recolouring a group keeps its place in the list", (await order()) === orderBefore && (await ruleFor("BIO 101")).bg === "#e4f5d6", `${orderBefore} → ${await order()}`);

    // ---------------------------------------------------------------- keyboard
    console.log("Keyboard");
    const hitsBefore = await page.evaluate(() => window.shortcutHits);
    await rightClick("mkt-6");
    check("menu takes keyboard focus", await inMenu((root) => !!root.activeElement && root.activeElement.classList.contains("menu")));
    await page.keyboard.press("ArrowDown");
    check("↓ moves to the first scope", await inMenu((root) => root.activeElement.type === "radio"));
    const radios = await inMenu((root) => root.querySelectorAll("input[type=radio]").length);
    for (let i = 0; i < radios; i++) await page.keyboard.press("ArrowDown");
    check("arrow keys reach the swatches", await inMenu((root) => root.activeElement.classList.contains("sw")));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    check("Enter picks the focused colour", !(await menuOpen()) && (await fill("mkt-6")) === COLOURS.yellow, await fill("mkt-6"));
    check("…and none of it reaches Notion's shortcuts", (await page.evaluate(() => window.shortcutHits)) === hitsBefore);

    // ---------------------------------------------------------------- dark mode
    console.log("Dark mode");
    await page.evaluate(() => { document.body.style.background = "#191919"; });
    await rightClick("club");
    const darkMenu = await inMenu((root) => ({ dark: root.querySelector(".menu").classList.contains("dark"), first: root.querySelector(".sw").dataset.c }));
    check("menu goes dark on a dark calendar and offers the dark palette", darkMenu.dark && darkMenu.first === "#7a4a1e", JSON.stringify(darkMenu));
    await swatch("Blue");
    const darkText = await page.evaluate(() => getComputedStyle(document.querySelector('[data-event-chip-key="club"]')).color);
    check("dark fills get white text", darkText === "rgb(255, 255, 255)", darkText);
    await page.evaluate(() => { document.body.style.background = ""; });
    await rightClick("club");
    await menuClick(".reset");

    // ---------------------------------------------------------------- hiding
    console.log("Hiding events");
    const shown = (key) => page.evaluate((k) => { const s = getComputedStyle(document.querySelector(`[data-event-chip-key="${k}"]`)); return { display: s.display, opacity: s.opacity }; }, key);
    await rightClick("club");
    await pickScope("Only this event");
    await menuClick(".hide");
    check("hidden event disappears", (await shown("club")).display === "none", JSON.stringify(await shown("club")));
    await page.keyboard.press("Alt+KeyH");
    await page.waitForTimeout(50);
    check("peek mode shows it again", (await shown("club")).display !== "none" && (await page.evaluate(() => !!document.getElementById("twotone-peek-hud"))));
    await page.keyboard.press("Alt+KeyH");
    await page.waitForTimeout(50);
    check("…and leaving peek mode hides it", (await shown("club")).display === "none");
    await setStore({ ghostOpacity: 40 });
    await page.mouse.move(780, 530); // hovering a ghost makes it more opaque
    check("ghost opacity shows hidden events faintly", (await shown("club")).opacity === "0.4", JSON.stringify(await shown("club")));
    await rightClick("club");
    await inMenu((root) => { const i = root.querySelector(".ghost-input"); i.value = "60"; i.dispatchEvent(new Event("input")); });
    await page.waitForTimeout(100);
    check("per-event ghost slider previews", (await shown("club")).opacity === "0.6", JSON.stringify(await shown("club")));
    check("…and only saves when released", (await store()).events.club.opacity === undefined);
    await inMenu((root) => root.querySelector(".ghost-input").dispatchEvent(new Event("change")));
    await page.waitForTimeout(100);
    check("…then it is saved", (await store()).events.club.opacity === 60, JSON.stringify((await store()).events.club));
    await menuClick(".hide");
    await page.mouse.move(780, 530);
    check("unhide restores the event", (await shown("club")).display !== "none" && (await shown("club")).opacity === "1" && !(await store()).events.club, JSON.stringify(await shown("club")));
    await setStore({ ghostOpacity: 0 });

    // ---------------------------------------------------------------- past events
    console.log("Past events");
    const today = new Date();
    const dayPath = (offset) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
    const beforePast = await store();
    await setStore({ rules: [{ match: "Session", bg: "#ffe2c6", label: "", literal: true }, ...beforePast.rules] });
    const past = await ctx.newPage();
    await past.goto(`https://calendar.notion.so/past/${dayPath(-1)}`);
    await past.waitForTimeout(600);
    const isPast = (key) => past.evaluate((k) => document.querySelector(`[data-event-chip-key="${k}"]`).getAttribute("data-twotone-past") === "true", key);
    check("yesterday's event is past", await isPast("past-ev"));
    check("tomorrow's event is not", !(await isPast("future-ev")));
    check("today's all-day event is not", !(await isPast("today-allday")));
    if (today.getHours() >= 2 && today.getHours() < 23) {
      check("today's finished event is past", await isPast("today-done"));
      check("today's running event is not", !(await isPast("today-live")));
    } else {
      console.log("  – skipped today's time-of-day checks (too close to midnight)");
    }
    check("a chip Notion has faded is past, whatever column it's in", await isPast("notion-over"));
    check("…including month view's unfilled chips", await isPast("notion-month-over"));
    check("a chip Notion hasn't faded is not", !(await isPast("notion-live")));
    const notionText = await past.evaluate(() => getComputedStyle(document.querySelector('[data-event-chip-key="notion-over"]')).getPropertyValue("--foreground-color-primary").trim());
    check("recoloured chips drive Notion's own text colour variable", /^#[0-9a-f]{6}$/.test(notionText), notionText);
    const pastMenu = async (key) => {
      await past.click(`[data-event-chip-key="${key}"]`, { button: "right" });
      await past.waitForTimeout(100);
    };
    const pastRoot = (fn) => past.evaluate((f) => new Function("root", `return (${f})(root)`)(document.getElementById("twotone-menu-host").shadowRoot), fn.toString());
    await pastMenu("past-ev");
    check("past events can't be hidden", await pastRoot((root) => root.querySelector(".hide").style.display === "none"));
    await past.keyboard.press("Escape");
    await pastMenu("future-ev");
    await pastRoot((root) => { [...root.querySelectorAll(".scope")].find((x) => x.textContent.includes("Only this event")).querySelector("input").click(); root.querySelector('.sw[title="Purple"]').click(); });
    await past.waitForTimeout(200);
    check("a single event remembers its day", (await store()).events["future-ev"].datePath === dayPath(1), JSON.stringify((await store()).events["future-ev"]));

    // ---------------------------------------------------------------- manager extras
    console.log("Manager: show in calendar");
    await ext.bringToFront();
    await ext.reload();
    await ext.waitForTimeout(300);
    await ext.evaluate(() => [...document.querySelectorAll("#events .row .title")].find((t) => t.textContent.includes("Future")).click());
    await past.waitForTimeout(500);
    const jumped = await past.evaluate(() => document.querySelector('[data-event-chip-key="future-ev"]').style.transform);
    check("clicking a single event's title highlights it in the calendar", jumped.includes("scale"), jumped);
    check("…in the tab that shows it, without moving the others", new URL(page.url()).pathname === "/2026/9/20", page.url());
    await ext.evaluate(() => chrome.storage.local.get("events").then((d) => chrome.storage.local.set({ events: { ...d.events, elsewhere: { bg: "#ffe2c6", title: "Elsewhere", datePath: "2027/1/5" } } })));
    await ext.waitForTimeout(300);
    await ext.evaluate(() => [...document.querySelectorAll(".row .title")].find((t) => t.textContent.includes("Elsewhere")).click());
    await past.waitForURL("**/2027/1/5", { timeout: 3000 }).catch(() => {});
    check("an event that isn't on screen opens its day instead", [page.url(), past.url()].some((u) => u.endsWith("/2027/1/5")), `${page.url()} ${past.url()}`);
    await past.close();

    console.log("Manager: editing");
    await ext.evaluate(() => [...document.querySelectorAll("#settings-events-list .row")].find((r) => r.querySelector(".chip.none")).querySelector(".chip").click());
    await ext.waitForTimeout(300);
    const fin3 = (await store()).events["fin-3"];
    check("opening the manager's picker doesn't set a colour", !!fin3 && fin3.bg === null, JSON.stringify(fin3));
    await ext.keyboard.press("Escape");
    await ext.evaluate(() => { const n = document.querySelector("#rules .name"); n.value = "Renamed"; n.dispatchEvent(new Event("input")); });
    await ext.close(); // straight away, before the debounced save would have fired
    const ext2 = await ctx.newPage();
    await ext2.goto(`chrome-extension://${extId}/popup.html`);
    await ext2.waitForTimeout(200);
    const afterClose = await ext2.evaluate(() => chrome.storage.local.get(null));
    check("an edit made just before the manager closes is still saved", afterClose.rules[0].label === "Renamed", afterClose.rules[0].label);

    console.log("Manager: tidying and backup");
    const tidied = await ext2.evaluate(() => {
      const d = new Date();
      const path = (days) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days); return `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`; };
      return TwoTone.tidyEvents({
        ancient: { bg: "#ffe2c6", datePath: path(-400) },
        recent: { bg: "#ffe2c6", datePath: path(-3) },
        hiddenPast: { bg: "#ffe2c6", hidden: true, opacity: 30, datePath: path(-3) },
        hiddenPastPlain: { bg: null, hidden: true, datePath: path(-3) },
        hiddenFuture: { bg: null, hidden: true, datePath: path(3) }
      }).events;
    });
    check("long-gone single events are dropped", !tidied.ancient && !!tidied.recent, JSON.stringify(tidied));
    check("past hidden events are un-hidden", tidied.hiddenPast && !tidied.hiddenPast.hidden && tidied.hiddenPast.opacity === undefined && !tidied.hiddenPastPlain, JSON.stringify(tidied));
    check("upcoming hidden events are kept", !!tidied.hiddenFuture && tidied.hiddenFuture.hidden === true);
    const backup = await ext2.evaluate(async () => {
      const state = await chrome.storage.local.get(TwoTone.STORAGE_DEFAULTS);
      const round = TwoTone.sanitizeImport(JSON.parse(JSON.stringify(TwoTone.exportData(state))));
      const hostile = TwoTone.sanitizeImport({ twotone: 1, rules: [{ match: "x", bg: "red;}", label: 7, ribbon: "url(x)" }, "junk"], events: { a: { bg: "#ABCDEF", title: 5, opacity: 500, datePath: "../x" } }, swatches: [1, 2] });
      return { same: JSON.stringify(round.rules.map((r) => [r.match, r.bg, r.label])) === JSON.stringify(state.rules.map((r) => [r.match, r.bg, r.label])) &&
          JSON.stringify(Object.entries(round.events).map(([k, e]) => [k, e.bg, e.title])) === JSON.stringify(Object.entries(state.events).map(([k, e]) => [k, e.bg, e.title])), notOurs: TwoTone.sanitizeImport({ rules: [] }), hostile };
    });
    check("a backup restores the same groups and events", backup.same);
    check("a file that isn't a backup is refused", backup.notOurs === null);
    check("a backup's values are checked before use",
      backup.hostile.rules.length === 1 && backup.hostile.rules[0].bg === "" && backup.hostile.rules[0].label === "" && backup.hostile.rules[0].ribbon === "" &&
      backup.hostile.events.a.bg === "#abcdef" && backup.hostile.events.a.title === "" && backup.hostile.events.a.opacity === 80 && backup.hostile.events.a.datePath === "" &&
      backup.hostile.swatches.length === 9, JSON.stringify(backup.hostile));
    await ext2.evaluate(() => { document.getElementById("settings-btn").click(); document.getElementById("tab-backup").click(); });
    const [download] = await Promise.all([ext2.waitForEvent("download"), ext2.evaluate(() => document.getElementById("btn-export").click())]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    check("export downloads a backup file", exported.twotone === 1 && exported.rules.length === afterClose.rules.length && /^twotone-backup-.*\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
    await ext2.evaluate(() => chrome.storage.local.set({ rules: [], events: {} }));
    await ext2.waitForTimeout(200);
    await ext2.setInputFiles("#import-file", await download.path());
    await ext2.waitForTimeout(200);
    await ext2.evaluate(() => document.getElementById("btn-import-confirm").click());
    await ext2.waitForTimeout(300);
    const restored = await ext2.evaluate(() => chrome.storage.local.get(null));
    check("import restores it", restored.rules.length === exported.rules.length && Object.keys(restored.events).length === Object.keys(exported.events).length, JSON.stringify(restored.rules));
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
