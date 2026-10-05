// TwoTone for Notion Calendar — content script
// Unofficial; not affiliated with Notion Labs, Inc.
//
// Every event in Notion Calendar is a <div data-event-chip-key="…">. Its fill comes from the
// CSS variable --background-color and its left bar from --ribbon-color-primary/secondary.
// We tag a chip with data-twotone="<hex>" and a generated stylesheet overrides ONLY
// --background-color, so the calendar's colour bar is never touched.
//
// Right-click an event → colour menu. Option/Alt + right-click → Notion's own menu.

(() => {
  if (window.__twotoneLoaded) return;
  window.__twotoneLoaded = true;

  const {
    HEX, DATE_PATH, MAX_GHOST, STORAGE_DEFAULTS, validSwatches,
    hsvToRgb, rgbToHsv, rgbToHex, hexToRgb, luminance, tidyEvents, PICKER_HTML, wirePicker
  } = globalThis.TwoTone;

  const CHIP = "[data-event-chip-key]";
  const IS_MAC = /mac/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");
  const ALT_HINT = IS_MAC ? "⌥ right-click" : "Alt + right-click";

  let swatches = STORAGE_DEFAULTS.swatches;
  let swatchesDark = STORAGE_DEFAULTS.swatchesDark;
  let rules = [];   // [{ match, bg, label }] — first match wins
  let events = {};  // { chipKey: { bg: "#rrggbb" | null, title } } — null = keep the calendar's colour
  let compiled = [];
  let ghostOpacity = 0; // 0 to 100

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

  // "2100-" → case-insensitive "contains"; "/2100|micro/i" → regex.
  // Rules made from the right-click menu are always literal, because their text comes from
  // event titles — which anyone who sends you an invite can choose.
  function compile(match, literal) {
    const m = String(match || "").trim();
    if (!m) return null;
    const last = m.lastIndexOf("/");
    if (!literal && m.length > 2 && m.startsWith("/") && last > 0) {
      try {
        return new RegExp(m.slice(1, last), (m.slice(last + 1) || "i").replace(/[gy]/g, ""));
      } catch {
        return null;
      }
    }
    return new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  // ---------------------------------------------------------------- state

  // Takes only the keys that changed. Updates what's painted; doesn't write to storage.
  function setState(patch) {
    if (Array.isArray(patch.rules)) rules = patch.rules;
    if (patch.events && typeof patch.events === "object") events = patch.events;
    if (typeof patch.ghostOpacity === "number") ghostOpacity = Math.max(0, Math.min(100, patch.ghostOpacity));
    if (validSwatches(patch.swatches)) swatches = patch.swatches;
    if (validSwatches(patch.swatchesDark)) swatchesDark = patch.swatchesDark;
    compiled = rules.map((x) => ({
      re: compile(x.match, x.literal),
      bg: String(x.bg || "").toLowerCase(),
      match: x.match
    }));
    colours.clear(); // paintAll re-adds the ones still in use
    stylesDirty = true;
    paintAll();
  }

  const save = (patch) => chrome.storage.local.set(patch);

  // ---------------------------------------------------------------- painting

  let styleEl = null;
  let stylesDirty = true;
  const colours = new Set();
  let peekMode = false;

  function setPeekMode(active) {
    peekMode = !!active;
    if (peekMode) {
      document.body.setAttribute("data-twotone-peek", "true");
      let hud = document.getElementById("twotone-peek-hud");
      if (!hud) {
        hud = document.createElement("div");
        hud.id = "twotone-peek-hud";
        hud.innerHTML = `<span>👁 Peek Mode Active</span><kbd>${IS_MAC ? "⌥H" : "Alt+H"}</kbd>`;
        document.body.appendChild(hud);
      }
    } else {
      document.body.removeAttribute("data-twotone-peek");
      const hud = document.getElementById("twotone-peek-hud");
      if (hud) hud.remove();
    }
  }

  window.addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "h" || e.key === "H" || e.code === "KeyH")) {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable);
      if (!isInput) {
        e.preventDefault();
        setPeekMode(!peekMode);
      }
    }
  }, true);

  function getTextColor(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return "#37352f";
    const [r, g, b] = rgb;
    const bgLum = luminance(r, g, b);

    // If the background is dark, use pure white text for readability
    if (bgLum < 0.32) return "#ffffff";

    const [h, s] = rgbToHsv(r, g, b);

    // If very desaturated (grey/slate), use Notion standard dark neutral
    if (s < 0.08) return "#37352f";

    // Match Notion's automatic chromatic text coloring
    let textS = 0.85;
    let textV = 0.65;

    if (h < 18 || h >= 345) { // Red
      textS = 0.88; textV = 0.65;
    } else if (h < 40) { // Orange
      textS = 0.92; textV = 0.65;
    } else if (h < 68) { // Yellow / Gold
      textS = 0.96; textV = 0.48;
    } else if (h < 115) { // Lime
      textS = 0.88; textV = 0.45;
    } else if (h < 155) { // Green
      textS = 0.88; textV = 0.45;
    } else if (h < 195) { // Teal
      textS = 0.90; textV = 0.48;
    } else if (h < 255) { // Blue
      textS = 0.86; textV = 0.68;
    } else if (h < 315) { // Purple
      textS = 0.90; textV = 0.62;
    } else { // Pink / Rose
      textS = 0.86; textV = 0.65;
    }

    const [tr, tg, tb] = hsvToRgb(h, textS, textV);
    return rgbToHex(tr, tg, tb);
  }

  // Notion fades a past event by desaturating and lightening its text, not by changing
  // opacity. Apply the same treatment to our own text colour so recoloured past events
  // match the calendar's own ones.
  function getPastTextColor(textHex) {
    const rgb = hexToRgb(textHex);
    if (!rgb) return textHex;
    const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    const [mr, mg, mb] = hsvToRgb(h, s * 0.32, Math.min(0.92, v + 0.26));
    return rgbToHex(mr, mg, mb);
  }

  function ensureStyles() {
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "twotone-styles";
      stylesDirty = true;
    }
    if (!styleEl.isConnected) (document.head || document.documentElement).appendChild(styleEl);
    if (!stylesDirty) return;
    stylesDirty = false;

    const op = (ghostOpacity / 100).toFixed(2);
    const hiddenRule = `
      ${CHIP}[data-twotone-hidden="true"]:not([data-twotone-ghost="true"]) {
        display: none !important;
      }
      ${CHIP}[data-twotone-hidden="true"][data-twotone-ghost="true"] {
        display: block !important;
        opacity: var(--twotone-ghost-opacity, ${op}) !important;
        filter: grayscale(75%) !important;
        outline: 1px dashed rgba(120, 119, 116, 0.4) !important;
        outline-offset: -2px !important;
      }
      ${CHIP}[data-twotone-hidden="true"][data-twotone-ghost="true"]:hover {
        opacity: calc(var(--twotone-ghost-opacity, ${op}) + 0.35) !important;
        filter: none !important;
      }
    `;

    styleEl.textContent = [
      ...[...colours].map((c) => {
        const textCol = getTextColor(c);
        const pastTextCol = getPastTextColor(textCol);
        return `${CHIP}[data-twotone="${c}"] { --background-color: #${c} !important; --foreground-color-primary: ${textCol} !important; --foreground-color-secondary: ${textCol} !important; --text-color: ${textCol} !important; color: ${textCol} !important; }\n${CHIP}[data-twotone="${c}"] * { color: inherit !important; }\n${CHIP}[data-twotone="${c}"][data-twotone-past="true"] { --foreground-color-primary: ${pastTextCol} !important; --foreground-color-secondary: ${pastTextCol} !important; --text-color: ${pastTextCol} !important; color: ${pastTextCol} !important; }`;
      }),
      hiddenRule,
      `body[data-twotone-peek="true"] ${CHIP}:not([data-twotone-hidden="true"]) { opacity: 0.45 !important; filter: grayscale(40%) !important; transition: opacity 0.15s ease, filter 0.15s ease; }`,
      `body[data-twotone-peek="true"] ${CHIP}:not([data-twotone-hidden="true"]):hover { opacity: 0.9 !important; filter: none !important; }`,
      `body[data-twotone-peek="true"] ${CHIP}[data-twotone-hidden="true"] { display: block !important; opacity: 1 !important; filter: none !important; outline: 2px dashed #2383e2 !important; outline-offset: -2px !important; box-shadow: 0 0 0 2px rgba(35, 131, 226, 0.25) !important; transition: opacity 0.15s ease, filter 0.15s ease; }`,
      `body[data-twotone-peek="true"] ${CHIP}[data-twotone-hidden="true"]:hover { outline-color: #1a62ab !important; }`,
      `#twotone-peek-hud { position: fixed; bottom: 16px; right: 16px; z-index: 2147483640; display: flex; align-items: center; gap: 8px; background: rgba(30, 30, 30, 0.88); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); color: #f7f6f3; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 500; padding: 6px 12px; border-radius: 20px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.1); pointer-events: none; animation: twotone-hud-fadein 0.2s ease-out; }`,
      `#twotone-peek-hud kbd { background: rgba(255, 255, 255, 0.2); padding: 1px 5px; border-radius: 4px; font-family: inherit; font-size: 11px; }`,
      `@keyframes twotone-hud-fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`
    ].join("\n");
  }

  function ensureColour(h) {
    if (colours.has(h)) return;
    colours.add(h);
    stylesDirty = true;
  }

  // ---------------------------------------------------------------- reading a chip's text

  const T = String.raw`\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}:\d{2}`;
  const TIME_ONLY = new RegExp(String.raw`^(?:${T}|\d{1,2})(?:\s*[–—-]\s*(?:${T}))?$`, "i");
  const TRAILING_TIME = new RegExp(String.raw`[\s,·]*(?:${T})(?:\s*[–—-]\s*(?:${T}))?\s*$`, "i");
  const TIME_RANGE = /(?<![\d:])(\d{1,2})(?::(\d{2}))?(?:\s*([ap])\.?m\.?)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?(?:\s*([ap])\.?m\.?)?(?![\d:])/gi;

  // When the event ends, in minutes after midnight — or null if the chip doesn't say, the
  // time is ambiguous ("3-4"), or the event runs past midnight.
  function endMinutes(text) {
    for (const m of text.matchAll(TIME_RANGE)) {
      const startHour = +m[1], startMin = m[2] ? +m[2] : 0, startP = m[3] && m[3].toLowerCase();
      const endHour = +m[4], endMin = m[5] ? +m[5] : 0, endP = m[6] && m[6].toLowerCase();
      if (endHour > 23 || endMin > 59) continue;
      if (endP) {
        if (endHour < 1 || endHour > 12) continue;
        const end = ((endHour % 12) + (endP === "p" ? 12 : 0)) * 60 + endMin;
        if (startP) {
          const start = ((startHour % 12) + (startP === "p" ? 12 : 0)) * 60 + startMin;
          if (start >= end) return null;
        } else if (endP === "a" && (startHour % 12) * 60 + startMin >= (endHour % 12) * 60 + endMin) {
          return null; // "11–1 AM" starts the evening before
        }
        return end;
      }
      if (!m[5] || startP) continue; // "3-4" or "11 AM–12:20": can't tell
      const end = endHour * 60 + endMin; // 24-hour clock
      if (startHour * 60 + startMin >= end) return null;
      return end;
    }
    return null;
  }

  // innerText needs layout, so remember what we worked out until the chip's text changes.
  const textCache = new WeakMap();

  function readChip(chip) {
    const text = chip.textContent || "";
    let c = textCache.get(chip);
    if (!c || c.text !== text) {
      const lines = (chip.innerText || text).split("\n").map((s) => s.trim()).filter(Boolean);
      const line = lines.find((l) => !TIME_ONLY.test(l)) || lines[0] || "";
      c = { text, title: line.replace(TRAILING_TIME, "").trim() || line, end: endMinutes(lines.join("\n")) };
      textCache.set(chip, c);
    }
    return c;
  }

  const titleOf = (chip) => readChip(chip).title;

  // Rules match the event's title only, not its time or location.
  function matchingRule(chip) {
    const title = titleOf(chip);
    return compiled.find((r) => r.re && HEX.test(r.bg) && r.re.test(title)) || null;
  }

  function isChipHidden(chip) {
    const key = chip.getAttribute("data-event-chip-key");
    return !!(key && hasOwn(events, key) && events[key] && events[key].hidden);
  }

  function colourFor(chip) {
    const key = chip.getAttribute("data-event-chip-key");
    if (key && hasOwn(events, key) && events[key] && hasOwn(events[key], "bg")) {
      const bg = events[key].bg;
      return HEX.test(bg || "") ? bg.toLowerCase() : null;
    }
    const r = matchingRule(chip);
    return r ? r.bg : null;
  }

  // When Notion paints a chip solid (e.g. while it's selected), its inline fill equals its
  // ribbon colour. Stand aside in that state so Notion's white-on-solid text stays readable.
  function isSolid(chip) {
    const bg = chip.style.getPropertyValue("--background-color").replace(/\s+/g, "");
    const rib = chip.style.getPropertyValue("--ribbon-color-primary").replace(/\s+/g, "");
    return !!bg && bg === rib;
  }

  // ---------------------------------------------------------------- which day is each column?

  // Month and weekday names in the page's language, the browser's, and English.
  let nameTables = null;

  function dateNames() {
    const langs = [...new Set([document.documentElement.lang, navigator.language, "en"].filter(Boolean))];
    const sig = langs.join(",");
    if (nameTables && nameTables.sig === sig) return nameTables;

    const months = new Map();
    const weekdays = new Set();
    const clean = (s) => s.toLowerCase().replace(/\./g, "").trim();
    for (const lang of langs) {
      try {
        for (const width of ["long", "short"]) {
          const fmt = new Intl.DateTimeFormat(lang, { month: width, timeZone: "UTC" });
          for (let m = 0; m < 12; m++) {
            const name = clean(fmt.format(new Date(Date.UTC(2021, m, 15))));
            if (name && !/^\d+$/.test(name) && !months.has(name)) months.set(name, m);
          }
        }
        const fmt = new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" });
        for (let d = 3; d < 10; d++) {
          const name = clean(fmt.format(new Date(Date.UTC(2021, 0, d))));
          if (name) weekdays.add(name);
        }
      } catch {
        // not a language tag Intl knows; the others still apply
      }
    }
    const W = [...weekdays].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const dayHeader = new RegExp(
      String.raw`(?<![\p{L}\p{N}])(?:${W})[\p{L}.]*[\s,·]*(\d{1,2})(?![\d:])|(?<![\d:])(\d{1,2})[\s,·.]*(?:${W})[\p{L}.]*`,
      "iu"
    );
    nameTables = { sig, months, dayHeader };
    return nameTables;
  }

  function monthsIn(text) {
    const { months } = dateNames();
    const found = [];
    for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      const m = months.get(w);
      if (m !== undefined && !found.includes(m)) found.push(m);
    }
    if (!found.length) {
      const cjk = text.match(/(\d{1,2})\s*月/);
      if (cjk && +cjk[1] >= 1 && +cjk[1] <= 12) found.push(+cjk[1] - 1);
    }
    return found;
  }

  function getCalendarHeaderDate() {
    let urlMonth = null;
    let urlYear = null;
    let urlDay = null;

    // 1. Try URL path (e.g. /week/2026/9/28 or /2026/10/1)
    const urlM = (location.pathname || "").match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (urlM) {
      urlYear = parseInt(urlM[1], 10);
      urlMonth = parseInt(urlM[2], 10) - 1;
      urlDay = parseInt(urlM[3], 10);
    }

    let foundMonth1 = urlMonth;
    let foundMonth2 = null;
    let foundYear = urlYear || new Date().getFullYear();

    // 2. Scan header elements
    const candidateEls = document.querySelectorAll("header, header *, [role='banner'], [role='banner'] *, nav, nav *, [class*='header' i], h1, h2, h3, button, span");
    for (const el of candidateEls) {
      if (el.children.length > 3) continue;
      const text = (el.textContent || "").trim();
      if (!text || text.length > 50) continue;
      if (el.closest("[class*='sidebar'], [class*='miniCalendar'], [class*='datePicker'], [class*='leftPane']")) continue;

      const yearMatch = text.match(/\b(20\d{2})\b/);
      if (yearMatch && !urlYear) {
        foundYear = parseInt(yearMatch[1], 10);
      }

      const monthsInText = monthsIn(text);
      if (monthsInText.length === 1) {
        const hMonth = monthsInText[0];
        if (urlMonth !== null) {
          if (urlMonth !== hMonth) {
            foundMonth1 = urlMonth;
            foundMonth2 = hMonth;
          }
        } else {
          foundMonth1 = hMonth;
        }
        if (yearMatch) break;
      } else if (monthsInText.length >= 2) {
        foundMonth1 = monthsInText[0];
        foundMonth2 = monthsInText[1];
        if (yearMatch) break;
      }
    }

    if (foundMonth1 === null) {
      foundMonth1 = new Date().getMonth();
      foundMonth2 = null;
    }

    return { month1: foundMonth1, month2: foundMonth2, year: foundYear, urlMonth, urlYear, urlDay };
  }

  function findDayColumns() {
    const headerDate = getCalendarHeaderDate();
    const { dayHeader } = dateNames();
    const dayIn = (s) => {
      const m = s.match(dayHeader);
      return m ? parseInt(m[1] || m[2], 10) : null;
    };
    const allEls = document.querySelectorAll(
      "header *, [role='columnheader'], [role='columnheader'] *, [class*='header' i] *, [class*='column' i] > :first-child, [class*='grid' i] [class*='head' i] *, h1, h2, h3, h4, th, div, span, button"
    );

    let rawCols = [];
    const maxTop = window.innerHeight * 0.22;
    for (const el of allEls) {
      if (el.children.length > 3) continue;

      // Cheapest checks first: this loop visits most of the page.
      const aria = el.getAttribute("aria-label") || "";
      let dayNum = aria ? dayIn(aria) : null;
      if (dayNum === null) {
        const raw = el.textContent || "";
        if (!raw || raw.length > 60 || !/\d/.test(raw)) continue;
        const txt = (el.innerText || raw).replace(/\s+/g, " ").trim();
        if (txt.length <= 25) dayNum = dayIn(txt);
      }
      if (dayNum === null || dayNum < 1 || dayNum > 31) continue;

      if (el.closest(CHIP)) continue;
      if (el.closest("aside, [class*='sidebar'], [class*='miniCalendar'], [class*='datePicker'], [class*='leftPane']")) continue;
      const rect = el.getBoundingClientRect();
      if (rect.left < 20 || rect.width < 35 || rect.height < 10 || rect.top > maxTop || rect.bottom < 20) continue;
      rawCols.push({ day: dayNum, left: rect.left, right: rect.right });
    }

    if (rawCols.length === 0) return [];

    rawCols.sort((a, b) => a.left - b.left);
    const deduped = [];
    for (const col of rawCols) {
      if (!deduped.some((d) => Math.abs(d.left - col.left) < 20)) {
        deduped.push(col);
      }
    }

    let rolloverIdx = -1;
    for (let i = 1; i < deduped.length; i++) {
      if (deduped[i].day < deduped[i - 1].day) {
        rolloverIdx = i;
        break;
      }
    }

    let startMonth = headerDate.month1;
    let startYear = headerDate.year;

    if (rolloverIdx > 0) {
      if (headerDate.urlMonth !== null && headerDate.urlMonth !== undefined) {
        startMonth = headerDate.urlMonth;
        if (headerDate.urlYear) startYear = headerDate.urlYear;
      } else if (headerDate.month2 !== null && headerDate.month2 !== undefined) {
        startMonth = headerDate.month1;
      } else {
        startMonth = (headerDate.month1 - 1 + 12) % 12;
        if (headerDate.month1 === 0) startYear--;
      }
    }

    const dayCols = [];
    let curMonth = startMonth;
    let curYear = startYear;
    let prevDay = 0;

    for (let i = 0; i < deduped.length; i++) {
      const col = deduped[i];
      if (prevDay > 0 && col.day < prevDay) {
        if (headerDate.month2 !== null && headerDate.month2 !== undefined) {
          curMonth = headerDate.month2;
        } else {
          curMonth = (curMonth + 1) % 12;
        }
        if (curMonth === 0 && prevDay > 20) {
          curYear++;
        }
      }
      prevDay = col.day;
      dayCols.push({
        day: col.day,
        month: curMonth,
        year: curYear,
        left: col.left,
        right: col.right
      });
    }

    return dayCols;
  }

  // Finding the columns means walking most of the page, so keep the answer until something
  // that could move them happens: navigation, a resize, a sideways scroll, or a re-render.
  let dayColsCache = null;
  let dayColsAt = 0;

  function invalidateDayColumns() {
    dayColsCache = null;
  }

  function getDayColumns() {
    if (!dayColsCache) {
      const cols = findDayColumns();
      dayColsAt = Date.now();
      if (!cols.length) return cols; // headers may not be rendered yet; look again next time
      dayColsCache = cols;
    }
    return dayColsCache;
  }

  function columnOf(chip, dayCols) {
    if (!dayCols || !dayCols.length) return null;
    const rect = chip.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    return dayCols.find((c) => midX >= c.left - 12 && midX <= c.right + 12) || null;
  }

  function parseColour(value) {
    const v = String(value || "").trim();
    if (!v) return null;
    if (v === "transparent") return [0, 0, 0, 0];
    const hex = hexToRgb(v);
    if (hex) return [...hex, 1];
    const m = /^rgba?\(/i.test(v) ? v.match(/[\d.]+/g) : null;
    return m && m.length >= 3 ? [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1] : null;
  }

  // The colour of the page behind the events, from Notion's own design token.
  function pageSurface() {
    const root = document.body || document.documentElement;
    return parseColour(getComputedStyle(root).getPropertyValue("--nds-surface-page"));
  }

  // Notion fades an event that's over by washing out its text colour (and its bar), in every
  // view. So when a chip carries Notion's colours, low contrast between its text and what's
  // behind it means "faded". Returns null when the chip doesn't say (older markup, or selected).
  function fadedByNotion(chip, surface) {
    const fg = parseColour(chip.style.getPropertyValue("--foreground-color-primary"));
    if (!fg || isSolid(chip)) return null;
    let bg = parseColour(chip.style.getPropertyValue("--background-color"));
    if (!bg || bg[3] < 0.5) bg = surface; // month view draws timed events with no fill
    if (!bg) return null;
    const a = luminance(fg[0], fg[1], fg[2]), b = luminance(bg[0], bg[1], bg[2]);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) < 3;
  }

  // Past = on an earlier day, or earlier today and already over. Worked out from the day
  // headers; used where Notion's own fading isn't available, and to decide what can be hidden.
  function isPastEvent(chip, dayCols) {
    const col = columnOf(chip, dayCols);
    if (!col) return false;
    const now = new Date();
    if (new Date(col.year, col.month, col.day, 23, 59, 59, 999).getTime() < now.getTime()) return true;
    if (col.year !== now.getFullYear() || col.month !== now.getMonth() || col.day !== now.getDate()) return false;
    const end = readChip(chip).end;
    return end !== null && now.getHours() * 60 + now.getMinutes() >= end;
  }

  // ---------------------------------------------------------------- applying it

  // Read everything first, then write, so painting many chips costs one layout rather than one each.
  function measure(chip, dayCols, surface) {
    const key = chip.getAttribute("data-event-chip-key");
    const ev = key && hasOwn(events, key) ? events[key] : null;
    const hidden = !!(ev && ev.hidden);
    const op = hidden ? (typeof ev.opacity === "number" ? ev.opacity : ghostOpacity) : 0;
    const c = isSolid(chip) ? null : colourFor(chip);
    const faded = fadedByNotion(chip, surface);
    return {
      past: faded === null ? isPastEvent(chip, dayCols) : faded,
      hidden,
      ghost: op > 0 ? (op / 100).toFixed(2) : "",
      want: c ? c.slice(1) : null
    };
  }

  function setAttr(el, name, value) {
    if (value === null) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  }

  function applyPlan(chip, plan) {
    setAttr(chip, "data-twotone-past", plan.past ? "true" : null);
    setAttr(chip, "data-twotone-hidden", plan.hidden ? "true" : null);
    setAttr(chip, "data-twotone-ghost", plan.ghost ? "true" : null);
    if (chip.style.getPropertyValue("--twotone-ghost-opacity") !== plan.ghost) {
      if (plan.ghost) chip.style.setProperty("--twotone-ghost-opacity", plan.ghost);
      else chip.style.removeProperty("--twotone-ghost-opacity");
    }
    if (plan.want) ensureColour(plan.want);
    setAttr(chip, "data-twotone", plan.want);
  }

  function paintChips(chips) {
    const dayCols = chips.length ? getDayColumns() : [];
    const surface = chips.length ? pageSurface() : null;
    const plans = chips.map((c) => measure(c, dayCols, surface));
    chips.forEach((c, i) => applyPlan(c, plans[i]));
    ensureStyles();
  }

  const paintAll = () => paintChips([...document.querySelectorAll(CHIP)]);

  let paintTimer = null;
  let isDraggingUser = false;

  window.addEventListener("mousedown", (e) => {
    if (e.button === 0) isDraggingUser = true;
  }, { capture: true, passive: true });

  window.addEventListener("mouseup", () => {
    if (isDraggingUser) {
      isDraggingUser = false;
      schedulePaintAll(false);
    }
  }, { capture: true, passive: true });

  function schedulePaintAll(force) {
    if (isDraggingUser && !force) return;
    if (paintTimer) return;
    paintTimer = setTimeout(() => {
      paintTimer = null;
      requestAnimationFrame(paintAll);
    }, 40);
  }

  // Runs before the browser paints, so re-rendered chips never flash their old colour.
  // Only the chips that changed are repainted.
  new MutationObserver((muts) => {
    if (isDraggingUser) return;
    const touched = new Set();
    let added = false;
    const chipAround = (node) => {
      const el = node.nodeType === 1 ? node : node.parentElement;
      return el ? el.closest(CHIP) : null;
    };
    for (const m of muts) {
      if (m.type === "childList") {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches(CHIP)) { touched.add(n); added = true; }
          for (const c of n.querySelectorAll(CHIP)) { touched.add(c); added = true; }
        }
        const inside = chipAround(m.target);
        if (inside) touched.add(inside);
      } else if (m.type === "attributes") {
        if (m.target.matches(CHIP)) touched.add(m.target);
      } else {
        const inside = chipAround(m.target);
        if (inside) touched.add(inside);
      }
    }
    // New chips usually mean Notion re-rendered the view, so the columns may have changed too.
    if (added && Date.now() - dayColsAt > 300) invalidateDayColumns();
    const chips = [...touched].filter((c) => c.isConnected);
    if (chips.length) paintChips(chips);
  }).observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["style"]
  });

  const repaintFromScratch = () => {
    invalidateDayColumns();
    schedulePaintAll(true);
  };
  window.addEventListener("popstate", repaintFromScratch);
  window.addEventListener("resize", repaintFromScratch);

  // Columns only move when something scrolls sideways.
  const lastScrollLeft = new WeakMap();
  window.addEventListener("scroll", (e) => {
    const t = e.target === document ? document.scrollingElement : e.target;
    if (!t || typeof t.scrollLeft !== "number") return;
    if (lastScrollLeft.get(t) !== t.scrollLeft) {
      lastScrollLeft.set(t, t.scrollLeft);
      invalidateDayColumns();
    }
  }, { capture: true, passive: true });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      invalidateDayColumns();
      paintAll();
    }
  }, 250);

  // Safety net, and what fades today's events as they finish.
  setInterval(() => {
    if (document.hidden || isDraggingUser) return;
    if (Date.now() - dayColsAt > 5000) invalidateDayColumns();
    paintAll();
  }, 2500);

  chrome.storage.local.get(STORAGE_DEFAULTS, (d) => {
    const tidy = tidyEvents(d.events);
    setState({ ...d, events: tidy.events });
    if (tidy.changed) save({ events: tidy.events });
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    const patch = {};
    if (ch.rules) patch.rules = ch.rules.newValue || [];
    if (ch.events) patch.events = ch.events.newValue || {};
    if (ch.ghostOpacity) patch.ghostOpacity = ch.ghostOpacity.newValue || 0;
    if (ch.swatches) patch.swatches = ch.swatches.newValue || STORAGE_DEFAULTS.swatches;
    if (ch.swatchesDark) patch.swatchesDark = ch.swatchesDark.newValue || STORAGE_DEFAULTS.swatchesDark;
    if (Object.keys(patch).length) setState(patch);
  });

  // ---------------------------------------------------------------- title helpers

  // Recognise a course code at the start of a title so one click can colour every session.
  //   "2100-Microeconomics (Lecture 4)" → { code: "2100", name: "Microeconomics", match: "2100-" }
  //   "BIO 101 Lab" / "CS-2100 Tutorial" → { code: "BIO 101", name: "", match: "BIO 101" }
  function courseOf(title) {
    let m = title.match(/^\s*(\d{3,5})\s*-\s*([A-Za-z][^([\]]*)/); // letter after the dash, so dates don't count
    if (m) return { code: m[1], name: m[2].trim(), match: m[1] + "-" };
    m = title.match(/^\s*([A-Z]{2,5}[ -]?\d{3,4}[A-Z]?)(?![\w])/);
    if (m) return { code: m[1], name: "", match: m[1] };
    return null;
  }

  // Is the calendar behind this chip dark? Looks for the first painted background on the way up.
  function isDarkBehind(chip) {
    const surface = pageSurface();
    if (surface && surface[3] > 0.5) return luminance(surface[0], surface[1], surface[2]) < 0.2;
    for (let el = chip.parentElement; el; el = el.parentElement) {
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (m && m.length >= 3 && (m.length < 4 || +m[3] > 0.5)) return luminance(+m[0], +m[1], +m[2]) < 0.2;
    }
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // ---------------------------------------------------------------- right-click menu

  let menu = null;      // { host, cleanup }
  let bypass = false;   // true while we re-send the right-click to Notion

  window.addEventListener("contextmenu", (e) => {
    if (bypass || e.altKey) return;
    const chip = e.target instanceof Element ? e.target.closest(CHIP) : null;
    if (!chip) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openMenu(chip, e);
  }, true);

  function closeMenu() {
    if (!menu) return;
    const { host, cleanup } = menu;
    menu = null;
    cleanup();
    host.remove();
  }

  function openMenu(chip, ev) {
    closeMenu();

    const key = chip.getAttribute("data-event-chip-key");
    const title = titleOf(chip);
    const course = courseOf(title);
    const hit = matchingRule(chip);
    const dark = isDarkBehind(chip);
    const palette = dark ? swatchesDark : swatches;
    // The calendar's own bar colour, used for previews here and in the manager
    const rawBar = getComputedStyle(chip).getPropertyValue("--ribbon-color-primary").trim();
    const barColour = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(rawBar) ? rawBar : "";
    const ribbon = barColour || "#9b9a97";

    let eventDateStr = "";
    let eventDatePath = "";
    const matchedCol = columnOf(chip, getDayColumns());
    if (matchedCol) {
      const d = new Date(matchedCol.year, matchedCol.month, matchedCol.day);
      eventDateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      eventDatePath = `${matchedCol.year}/${matchedCol.month + 1}/${matchedCol.day}`;
    }

    // What we remember about a single event, so the manager can list it
    const eventEntry = (extra) => {
      const prev = events[key] || {};
      return {
        ...prev,
        ...extra,
        title,
        ribbon: barColour,
        date: eventDateStr || prev.date || "",
        datePath: eventDatePath || prev.datePath || ""
      };
    };

    // Scopes, most useful first
    const scopes = [];
    if (hit && !(course && same(hit.match, course.match)) && !same(hit.match, title)) {
      scopes.push({ id: "rule", label: `Events matching “${hit.match}”`, match: hit.match });
    }
    if (course) {
      scopes.push({ id: "course", label: `All ${course.code}${course.name ? " " + course.name : ""} events`, match: course.match, name: course.name || course.code });
    } else if (title) {
      scopes.push({ id: "title", label: "All events with this title", match: title, name: title });
    }
    scopes.push({ id: "event", label: "Only this event" });

    // A title nothing else on the page shares is most likely a one-off, so default to just
    // this event rather than making a group out of it. Course codes still default to the course.
    const sharesTitle = () =>
      [...document.querySelectorAll(CHIP)].some((c) => c.getAttribute("data-event-chip-key") !== key && same(titleOf(c), title));
    const oneOff = !course && !sharesTitle();

    let scope =
      (key && hasOwn(events, key) && scopes.find((s) => s.id === "event")) ||
      (hit && scopes.find((s) => s.match && same(s.match, hit.match))) ||
      (oneOff && scopes.find((s) => s.id === "event")) ||
      scopes[0];

    const colourForScope = (s) => {
      if (s.id === "event") return key && hasOwn(events, key) ? events[key] && events[key].bg : null;
      const r = rules.find((x) => same(x.match, s.match));
      return r ? String(r.bg || "").toLowerCase() : null;
    };

    // ---- actions

    // What storage should look like once the current scope has this colour
    const patchFor = (colour) => {
      if (scope.id === "event") {
        return { events: { ...events, [key]: eventEntry({ bg: colour }) } };
      }
      const existing = rules.find((r) => same(r.match, scope.match));
      const rule = {
        match: scope.match,
        bg: colour,
        label: (existing && existing.label) || scope.name || scope.match,
        literal: existing ? !!existing.literal : true,
        ribbon: barColour || (existing && existing.ribbon) || ""
      };
      // A recoloured group keeps its place, because the order decides which group wins.
      const next = existing
        ? rules.filter((r) => r === existing || !same(r.match, scope.match)).map((r) => (r === existing ? rule : r))
        : [rule, ...rules];
      const evs = { ...events };
      const prev = evs[key];
      if (prev && (prev.hidden || typeof prev.opacity === "number")) {
        // this event should now follow its group's colour, but keep its hidden/ghost state
        const rest = { ...prev };
        delete rest.bg;
        evs[key] = rest;
      } else {
        delete evs[key]; // this event should now follow its group
      }
      return { rules: next, events: evs };
    };

    const apply = (colour) => {
      colour = colour.toLowerCase();
      if (!HEX.test(colour)) return;
      pending = null;
      save(patchFor(colour));
    };

    // Shows a colour on the page without writing it to storage; apply() makes it stick.
    let pending = null;
    const preview = (colour) => {
      colour = colour.toLowerCase();
      if (!HEX.test(colour)) return;
      pending = colour;
      setState(patchFor(colour));
    };

    const reset = () => {
      if (scope.id === "event") {
        const evs = { ...events };
        const prev = events[key] || {};
        if (prev.hidden) {
          evs[key] = { ...prev, bg: null };
        } else if (matchingRule(chip)) {
          evs[key] = { bg: null, title, ribbon: barColour, date: eventDateStr || prev.date || "", datePath: eventDatePath || prev.datePath || "" };
        } else {
          delete evs[key];
        }
        save({ events: evs });
      } else {
        save({ rules: rules.filter((r) => !same(r.match, scope.match)) });
      }
    };

    const openNotionMenu = () => {
      const { clientX, clientY, screenX, screenY, target } = ev;
      closeMenu();
      bypass = true;
      try {
        target.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, cancelable: true, composed: true, clientX, clientY, screenX, screenY, button: 2, buttons: 2
        }));
      } finally {
        bypass = false;
      }
    };

    // ---- DOM (in a shadow root so Notion's styles can't reach it)
    const host = document.createElement("div");
    host.id = "twotone-menu-host";
    const root = host.attachShadow({ mode: "open" });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        .menu { --bg: #fff; --ink: #37352f; --muted: #787774; --faint: #9b9a97; --tag: #f1f0ec; --hover: rgba(55,53,47,.06);
          --line: rgba(55,53,47,.09); --card: #f7f6f3; --card-hover: #eeedea; --box: #fbfbfa; --thumb: rgba(55,53,47,.2);
          --shadow: 0 0 0 1px rgba(15,15,15,.06), 0 3px 6px rgba(15,15,15,.1), 0 9px 24px rgba(15,15,15,.18); }
        .menu.dark { --bg: #252525; --ink: #e6e6e4; --muted: #a3a29e; --faint: #86857f; --tag: #383838; --hover: rgba(255,255,255,.07);
          --line: rgba(255,255,255,.1); --card: #303030; --card-hover: #3a3a3a; --box: #2c2c2c; --thumb: rgba(255,255,255,.25);
          --shadow: 0 0 0 1px rgba(255,255,255,.09), 0 3px 6px rgba(0,0,0,.3), 0 9px 24px rgba(0,0,0,.45); color-scheme: dark; }
        .menu { position: fixed; z-index: 2147483647; width: 248px; box-sizing: border-box; background: var(--bg); color: var(--ink);
          border-radius: 12px; padding: 6px; font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          box-shadow: var(--shadow); user-select: none; outline: none;
          max-height: calc(100vh - 16px); overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
        .menu::-webkit-scrollbar { width: 5px; }
        .menu::-webkit-scrollbar-thumb { background: var(--thumb); border-radius: 3px; }
        .menu::-webkit-scrollbar-track { background: transparent; }
        .menu * { box-sizing: border-box; font-family: inherit; }
        .menu :focus-visible { outline: 2px solid #2383e2; outline-offset: 1px; }
        .head { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 6px; gap: 8px; }
        .title { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; flex: 1; min-width: 0; }
        .brand-tag { flex: none; font-size: 10px; font-weight: 600; letter-spacing: 0.02em; color: var(--faint); background: var(--tag); padding: 1px 5px; border-radius: 4px; line-height: 1.3; user-select: none; }
        .scope { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 6px; cursor: pointer; }
        .scope span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .scope:hover, .item:hover { background: var(--hover); }
        .scope input { margin: 0; accent-color: #2383e2; flex: none; }
        .sep { height: 1px; background: var(--line); margin: 6px 2px; }
        .swatches { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; padding: 4px 8px 6px; }
        .sw { position: relative; height: 26px; padding: 0; border: 0; border-radius: 5px; cursor: pointer; overflow: hidden;
          box-shadow: inset 0 0 0 1px rgba(128,128,128,.18); transition: transform .08s; }
        .sw::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--rib); }
        .sw:hover { transform: scale(1.08); }
        .sw.on { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px #2383e2; }
        .custom { background: conic-gradient(from 90deg, #ffd6d6, #fff3b0, #d6f5d6, #d6ecff, #e6dcff, #ffd6ec, #ffd6d6); }
        .custom.set { background: var(--c); }
        .item { display: flex; width: 100%; align-items: center; gap: 8px; padding: 6px 8px; border: 0; background: none;
          border-radius: 6px; font: inherit; color: inherit; cursor: pointer; text-align: left; }
        .item[hidden] { display: none; }
        .item svg { flex: none; margin-right: 2px; }
        .item.notion { color: var(--faint); }
        .item.notion:hover { color: var(--muted); }
        .item .kbd { margin-left: auto; font-size: 11px; color: var(--faint); background: var(--tag); border-radius: 4px; padding: 1px 5px; }

        /* Ghost Opacity Slider in Menu */
        .ghost-box { margin: 4px 2px 6px; background: var(--box); border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; }
        .ghost-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
        .ghost-title { font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
        .ghost-val { font-size: 10.5px; font-weight: 600; color: var(--ink); background: var(--card-hover); padding: 1px 5px; border-radius: 4px; }
        .ghost-input { width: 100%; margin: 2px 0 0; cursor: pointer; accent-color: #2383e2; display: block; }

        /* Custom Picker Section */
        .picker-box { padding: 4px 6px 6px; }
        .tt-sat-area { position: relative; width: 100%; height: 96px; border-radius: 8px; cursor: crosshair; overflow: hidden; touch-action: none; }
        .tt-sat-white { position: absolute; inset: 0; background: linear-gradient(to right, #ffffff, rgba(255,255,255,0)); }
        .tt-sat-black { position: absolute; inset: 0; background: linear-gradient(to top, #000000, rgba(0,0,0,0)); }
        .tt-sat-pointer { position: absolute; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.35); transform: translate(-50%, -50%); pointer-events: none; }
        .tt-hue-area { position: relative; width: 100%; height: 12px; margin-top: 8px; border-radius: 6px; background: linear-gradient(to right, #ff0000 0%, #ffff00 16.66%, #00ff00 33.33%, #00ffff 50%, #0000ff 66.66%, #ff00ff 83.33%, #ff0000 100%); cursor: pointer; touch-action: none; }
        .tt-hue-thumb { position: absolute; top: 50%; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.35); transform: translate(-50%, -50%); pointer-events: none; }
        .tt-picker-sep { height: 1px; background: var(--line); margin: 9px 0 7px; }
        .tt-format-card { display: flex; width: 100%; justify-content: space-between; align-items: center; background: var(--card); border: 0; border-radius: 6px; padding: 5px 8px; margin-bottom: 6px; cursor: pointer; color: inherit; }
        .tt-format-card:hover { background: var(--card-hover); }
        .tt-format-label { font-size: 9px; font-weight: 600; letter-spacing: 0.05em; color: var(--muted); text-transform: uppercase; }
        .tt-format-select { display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: var(--ink); }
        .tt-inputs-hex, .tt-inputs-rgb { display: flex; gap: 6px; width: 100%; }
        .tt-input-card { flex: 1; min-width: 0; background: var(--card); border-radius: 6px; padding: 4px 6px; display: flex; flex-direction: column; }
        .tt-input-label { font-size: 9px; font-weight: 600; color: var(--muted); margin-bottom: 1px; text-transform: uppercase; }
        .tt-input-card input { width: 100%; border: none; background: transparent; padding: 0; font-size: 12px; font-weight: 500; font-family: inherit; color: var(--ink); outline: none; }
        .tt-input-card:focus-within { box-shadow: 0 0 0 1.5px #2383e2; background: var(--bg); }
      </style>
      <div class="menu" role="dialog" aria-label="TwoTone event colour" tabindex="-1">
        <div class="head">
          <div class="title"></div>
          <div class="brand-tag">twotone</div>
        </div>
        <div class="scopes" role="radiogroup" aria-label="Apply to"></div>
        <div class="sep"></div>
        <div class="swatches" role="group" aria-label="Colour"></div>
        <div class="picker-box" style="display:none;">${PICKER_HTML}</div>
        <div class="sep"></div>
        <button class="item hide" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          <span class="hide-text">Hide this event</span>
        </button>
        <div class="ghost-box" style="display:none;">
          <div class="ghost-head">
            <span class="ghost-title">Ghost Opacity</span>
            <span class="ghost-val">0% (Hidden)</span>
          </div>
          <input type="range" class="ghost-input" aria-label="Ghost opacity" min="0" max="${MAX_GHOST}" step="5" value="0" />
        </div>
        <button class="item reset" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          <span class="reset-text">Reset to calendar colour</span>
        </button>
        <button class="item manage" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span>Manage colours…</span>
        </button>
        <button class="item notion" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
          <span>Notion menu</span>
          <kbd class="kbd">${ALT_HINT}</kbd>
        </button>
      </div>`;

    const $ = (s) => root.querySelector(s);
    const menuEl = $(".menu");
    menuEl.classList.toggle("dark", dark);
    $(".title").textContent = title || "Event";
    $(".title").title = title;

    // scopes
    scopes.forEach((s) => {
      const row = document.createElement("label");
      row.className = "scope";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "scope";
      input.checked = s === scope;
      input.onchange = () => { scope = s; refresh(); };
      const text = document.createElement("span");
      text.textContent = s.label;
      text.title = s.label;
      row.append(input, text);
      $(".scopes").append(row);
    });

    // swatches
    const sw = $(".swatches");
    palette.forEach(([c, name]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sw";
      b.title = name;
      b.setAttribute("aria-label", name || c);
      b.dataset.c = c.toLowerCase();
      b.style.background = c;
      b.style.setProperty("--rib", ribbon);
      b.onclick = () => { apply(c); closeMenu(); };
      sw.append(b);
    });
    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "sw custom";
    custom.title = "Custom colour";
    custom.setAttribute("aria-label", "Custom colour");
    custom.setAttribute("aria-expanded", "false");
    custom.style.setProperty("--rib", ribbon);
    sw.append(custom);

    // custom picker: previews as you drag, saves when you let go or type a value
    const pickerBox = $(".picker-box");
    const showCustom = (hex) => {
      custom.classList.add("set");
      custom.style.setProperty("--c", hex);
    };
    const picker = wirePicker(pickerBox, {
      onInput: (hex) => { showCustom(hex); preview(hex); },
      onCommit: (hex) => apply(hex)
    });

    const clickX = ev.clientX;
    const clickY = ev.clientY;

    function reposition() {
      const r = menuEl.getBoundingClientRect();
      const x = Math.max(8, Math.min(clickX, window.innerWidth - r.width - 8));
      const y = Math.max(8, Math.min(clickY, window.innerHeight - r.height - 8));
      menuEl.style.left = x + "px";
      menuEl.style.top = y + "px";
    }

    custom.onclick = () => {
      const open = pickerBox.style.display !== "none";
      pickerBox.style.display = open ? "none" : "block";
      custom.classList.toggle("on", !open);
      custom.setAttribute("aria-expanded", String(!open));
      if (!open) picker.set(colourForScope(scope) || palette[0][0]);
      reposition();
    };

    // ghost slider: previews as you drag, saves when you let go
    const ghostInput = $(".ghost-input");
    const ghostVal = $(".ghost-val");
    const ghostLabel = (op) => (op === 0 ? "0% (Hidden)" : `${op}%`);
    ghostInput.addEventListener("input", () => {
      const op = parseInt(ghostInput.value, 10) || 0;
      ghostVal.textContent = ghostLabel(op);
      if (key) setState({ events: { ...events, [key]: eventEntry({ hidden: true, opacity: op }) } });
    });
    ghostInput.addEventListener("change", () => {
      if (key) save({ events });
    });

    function refresh() {
      const cur = colourForScope(scope);
      let known = false;
      sw.querySelectorAll(".sw[data-c]").forEach((b) => {
        const on = !!cur && b.dataset.c === cur;
        known = known || on;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      const isCustom = !!cur && HEX.test(cur) && !known;
      custom.classList.toggle("set", isCustom);
      if (isCustom) custom.style.setProperty("--c", cur);
      if (pickerBox.style.display !== "none") picker.set(cur || palette[0][0]);

      const resettable = scope.id === "event" ? key && hasOwn(events, key) && hasOwn(events[key], "bg") ? events[key].bg !== null : !!matchingRule(chip) : !!cur;
      $(".reset").hidden = !resettable;
      $(".reset .reset-text").textContent = scope.id === "event" ? "Reset this event to calendar colour" : "Remove this group colour";

      const isHid = isChipHidden(chip);
      if (isPastEvent(chip, getDayColumns())) {
        $(".hide").style.display = "none";
        $(".ghost-box").style.display = "none";
      } else {
        $(".hide").style.display = "flex";
        $(".hide .hide-text").textContent = isHid ? "Unhide this event" : "Hide this event";
        $(".ghost-box").style.display = isHid ? "block" : "none";
        const evOp = (key && events[key] && typeof events[key].opacity === "number") ? events[key].opacity : ghostOpacity;
        ghostInput.value = evOp;
        ghostVal.textContent = ghostLabel(evOp);
      }
    }

    const toggleHide = () => {
      if (isChipHidden(chip)) {
        const evObj = { ...(events[key] || {}) };
        delete evObj.hidden;
        delete evObj.opacity;
        // Keep the entry only if it still says something: a colour, or "not my group's colour"
        const keepsColour = HEX.test(evObj.bg || "") || (evObj.bg === null && matchingRule(chip));
        if (!keepsColour) {
          const next = { ...events };
          delete next[key];
          save({ events: next });
        } else {
          save({ events: { ...events, [key]: evObj } });
        }
      } else {
        save({ events: { ...events, [key]: eventEntry({ hidden: true }) } });
      }
    };

    refresh();

    $(".hide").onclick = () => { toggleHide(); closeMenu(); };
    $(".reset").onclick = () => { reset(); closeMenu(); };
    $(".manage").onclick = () => { closeMenu(); chrome.runtime.sendMessage({ type: "twotone-open-manager" }); };
    $(".notion").onclick = openNotionMenu;

    // Keyboard: ↑/↓ (and ←/→ across the swatches) move between controls, Tab stays inside,
    // Enter or Space activates.
    menuEl.addEventListener("keydown", (e) => {
      const at = root.activeElement;
      const typing = at && at.matches("input[type=text]");
      const sliding = at && at.matches("input[type=range]");
      const onSwatch = at && at.classList.contains("sw");
      if (e.key === "Enter" && at && at.matches("input[type=radio]")) {
        e.preventDefault();
        at.click();
        return;
      }
      let step = 0;
      if (e.key === "Tab") step = e.shiftKey ? -1 : 1;
      else if (typing) return; // arrows move the caret
      else if (e.key === "ArrowDown" || (e.key === "ArrowRight" && onSwatch)) step = 1;
      else if (e.key === "ArrowUp" || (e.key === "ArrowLeft" && onSwatch)) step = -1;
      else if (sliding) return; // ←/→ move the slider
      if (!step) return;
      e.preventDefault();
      const list = [...root.querySelectorAll("input, button")].filter((n) => n.getClientRects().length);
      if (!list.length) return;
      const i = list.indexOf(at);
      list[i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length].focus();
    });

    // Keep clicks/keys inside the menu away from Notion's own handlers
    ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "keydown", "keyup", "keypress", "wheel", "contextmenu"].forEach((type) =>
      host.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === "contextmenu") e.preventDefault();
      })
    );

    // Close on outside click, Escape, resize or outside scroll
    const onDown = (e) => { if (!e.composedPath().includes(host)) closeMenu(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); } };
    const onScroll = (e) => {
      if (e.target === host || (e.composedPath && e.composedPath().includes(host))) return;
      closeMenu();
    };
    const hadFocus = document.activeElement;
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", onScroll, true);
    const cleanup = () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", onScroll, true);
      if (pending) apply(pending); // closed mid-drag: keep what was on screen
      if (root.activeElement && hadFocus && hadFocus.isConnected && hadFocus.focus) hadFocus.focus({ preventScroll: true });
    };

    document.documentElement.appendChild(host);
    menu = { host, cleanup };

    // position at cursor, kept on-screen
    reposition();
    menuEl.focus({ preventScroll: true }); // so keys go to the menu, not to Notion's shortcuts
  }

  // "Show in calendar" from the manager: scroll to the event, or go to its day
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== "twotone-scroll-to-event") return;
    const key = String(msg.key || "");
    if (!peekMode && key && events[key] && events[key].hidden) {
      setPeekMode(true);
    }

    const chip = key ? document.querySelector(`[data-event-chip-key="${CSS.escape(key)}"]`) : null;
    if (chip) {
      chip.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      chip.style.transition = "transform 0.25s ease, box-shadow 0.25s ease";
      chip.style.transform = "scale(1.08)";
      chip.style.boxShadow = "0 0 0 4px #2383e2, 0 8px 24px rgba(35,131,226,0.45)";
      chip.style.zIndex = "999";
      setTimeout(() => {
        chip.style.transform = "";
        chip.style.boxShadow = "";
        chip.style.zIndex = "";
        chip.style.transition = "";
      }, 2200);
      sendResponse({ success: true, scrolled: true });
    } else if (msg.navigate && DATE_PATH.test(msg.datePath || "")) {
      sendResponse({ success: true, navigated: true });
      window.location.href = `${location.origin}/${msg.datePath}`;
    } else {
      sendResponse({ success: false, calendar: true });
    }
  });
})();
