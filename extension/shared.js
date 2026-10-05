// TwoTone for Notion Calendar — helpers shared by the content script and the manager.
// Unofficial; not affiliated with Notion Labs, Inc.

(() => {
  if (globalThis.TwoTone) return;

  const HEX = /^#[0-9a-f]{6}$/i;
  const BAR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;
  const DATE_PATH = /^\d{4}\/\d{1,2}\/\d{1,2}$/;
  const MAX_GHOST = 80;
  const PRUNE_DAYS = 180; // single-event entries older than this are dropped

  // Pastels for light mode, deeper fills (which get white text) for dark mode.
  const DEFAULT_SWATCHES = [
    ["#ffe2c6", "Orange"], ["#fff3a8", "Yellow"], ["#fddcd8", "Red"], ["#fadcec", "Pink"], ["#e7defc", "Purple"],
    ["#d9e8ff", "Blue"], ["#d2f0ec", "Teal"], ["#e4f5d6", "Lime"], ["#ecebe7", "Grey"]
  ];
  const DEFAULT_SWATCHES_DARK = [
    ["#7a4a1e", "Orange"], ["#6b5a14", "Yellow"], ["#7a2e2a", "Red"], ["#73305a", "Pink"], ["#4a3a80", "Purple"],
    ["#27508a", "Blue"], ["#1f5c56", "Teal"], ["#3d5c22", "Lime"], ["#4a4a46", "Grey"]
  ];
  const cloneSwatches = (list) => list.map(([c, n]) => [c, n]);
  const validSwatches = (list) =>
    Array.isArray(list) && list.length === 9 && list.every((s) => Array.isArray(s) && HEX.test(s[0] || ""));

  const STORAGE_DEFAULTS = {
    rules: [], events: {}, ghostOpacity: 0, swatches: DEFAULT_SWATCHES, swatchesDark: DEFAULT_SWATCHES_DARK
  };

  // ---------------------------------------------------------------- colour math

  function hsvToRgb(h, s, v) {
    const f = (n, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
    return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, v];
  }

  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
  }

  function hexToRgb(hex) {
    hex = String(hex || "").trim().replace(/^#/, "");
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    const num = parseInt(hex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function luminance(r, g, b) {
    const toLinear = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }

  // ---------------------------------------------------------------- event dates

  function parseDateFromKey(k) {
    if (!k) return null;
    let m = String(k).match(/(\d{4})[-_]?(\d{1,2})[-_]?(\d{1,2})/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mNum = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      if (mNum >= 1 && mNum <= 12 && d >= 1 && d <= 31) return { year: y, month: mNum, day: d };
    }
    m = String(k).match(/(\d{10,13})/);
    if (m) {
      let ts = parseInt(m[1], 10);
      if (ts < 10000000000) ts *= 1000;
      const dt = new Date(ts);
      if (!isNaN(dt.getTime()) && dt.getFullYear() > 2000 && dt.getFullYear() < 2100) {
        return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate() };
      }
    }
    return null;
  }

  // The day we recorded when the event was coloured, as { year, month, day } (month is 1-based).
  function savedDay(e) {
    if (!e || !DATE_PATH.test(e.datePath || "")) return null;
    const [year, month, day] = e.datePath.split("/").map(Number);
    return { year, month, day };
  }

  function eventDay(e, k) {
    const saved = savedDay(e);
    if (saved) return saved;
    const parsed = parseDateFromKey(k);
    if (parsed) return parsed;
    const m = e && e.date ? String(e.date).match(/([A-Za-z]+)\s*(\d{1,2})/) : null;
    if (m) {
      const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const idx = names.findIndex((n) => m[1].toLowerCase().startsWith(n));
      if (idx !== -1) return { year: new Date().getFullYear(), month: idx + 1, day: parseInt(m[2], 10) };
    }
    return null;
  }

  const endOfDay = (d) => new Date(d.year, d.month - 1, d.day, 23, 59, 59, 999).getTime();

  function isEventPassed(e, k) {
    const d = eventDay(e, k);
    return !!d && endOfDay(d) < Date.now();
  }

  function eventTimestamp(e, k) {
    const d = e ? eventDay(e, k) : null;
    return d ? new Date(d.year, d.month - 1, d.day).getTime() : Infinity;
  }

  // Past events can't be hidden from the menu any more, so un-hide them, and drop single-event
  // entries that are long gone so storage doesn't grow forever. Returns a new object.
  function tidyEvents(events) {
    const out = {};
    let changed = false;
    const cutoff = Date.now() - PRUNE_DAYS * 86400000;
    for (const [k, value] of Object.entries(events || {})) {
      if (!value || typeof value !== "object") { changed = true; continue; }
      const saved = savedDay(value);
      if (saved && endOfDay(saved) < cutoff) { changed = true; continue; }
      if (value.hidden && isEventPassed(value, k)) {
        changed = true;
        if (value.bg === null || value.bg === undefined) continue;
        const rest = { ...value };
        delete rest.hidden;
        delete rest.opacity;
        out[k] = rest;
        continue;
      }
      out[k] = value;
    }
    return { events: out, changed };
  }

  // ---------------------------------------------------------------- backup

  const str = (v, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");

  function exportData(state) {
    return {
      twotone: 1,
      exportedAt: new Date().toISOString(),
      rules: state.rules,
      events: state.events,
      ghostOpacity: state.ghostOpacity,
      swatches: state.swatches,
      swatchesDark: state.swatchesDark
    };
  }

  // A backup file is just a file someone hands you, so rebuild everything field by field.
  function sanitizeImport(data) {
    if (!data || typeof data !== "object" || data.twotone !== 1) return null;
    const rules = (Array.isArray(data.rules) ? data.rules : [])
      .filter((r) => r && typeof r === "object" && typeof r.match === "string")
      .map((r) => ({
        match: str(r.match),
        bg: HEX.test(r.bg || "") ? r.bg.toLowerCase() : "",
        label: str(r.label),
        literal: !!r.literal,
        ribbon: BAR.test(r.ribbon || "") ? r.ribbon : ""
      }));
    const events = {};
    const src = data.events && typeof data.events === "object" && !Array.isArray(data.events) ? data.events : {};
    for (const [k, e] of Object.entries(src)) {
      if (!e || typeof e !== "object") continue;
      const next = {
        bg: HEX.test(e.bg || "") ? e.bg.toLowerCase() : null,
        title: str(e.title),
        ribbon: BAR.test(e.ribbon || "") ? e.ribbon : "",
        date: str(e.date, 40),
        datePath: DATE_PATH.test(e.datePath || "") ? e.datePath : ""
      };
      if (e.hidden) next.hidden = true;
      if (typeof e.opacity === "number") next.opacity = Math.max(0, Math.min(MAX_GHOST, Math.round(e.opacity)));
      events[str(k)] = next;
    }
    const palette = (list, fallback) =>
      validSwatches(list) ? list.map((s) => [s[0].toLowerCase(), str(s[1], 40)]) : cloneSwatches(fallback);
    return {
      rules,
      events,
      ghostOpacity: typeof data.ghostOpacity === "number" ? Math.max(0, Math.min(MAX_GHOST, Math.round(data.ghostOpacity))) : 0,
      swatches: palette(data.swatches, DEFAULT_SWATCHES),
      swatchesDark: palette(data.swatchesDark, DEFAULT_SWATCHES_DARK)
    };
  }

  // ---------------------------------------------------------------- custom colour picker

  const PICKER_HTML = `
    <div class="tt-sat-area">
      <div class="tt-sat-white"></div>
      <div class="tt-sat-black"></div>
      <div class="tt-sat-pointer"></div>
    </div>
    <div class="tt-hue-area">
      <div class="tt-hue-thumb"></div>
    </div>
    <div class="tt-picker-sep"></div>
    <button class="tt-format-card" type="button" title="Click to switch format">
      <span class="tt-format-label">FORMAT</span>
      <span class="tt-format-select">
        <span class="tt-format-mode">HEX</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      </span>
    </button>
    <div class="tt-inputs-hex">
      <label class="tt-input-card"><span class="tt-input-label">HEX</span><input class="tt-hex-val" type="text" maxlength="7" spellcheck="false" /></label>
    </div>
    <div class="tt-inputs-rgb" style="display:none;">
      <label class="tt-input-card"><span class="tt-input-label">R</span><input class="tt-rgb-r" type="text" inputmode="numeric" maxlength="3" /></label>
      <label class="tt-input-card"><span class="tt-input-label">G</span><input class="tt-rgb-g" type="text" inputmode="numeric" maxlength="3" /></label>
      <label class="tt-input-card"><span class="tt-input-label">B</span><input class="tt-rgb-b" type="text" inputmode="numeric" maxlength="3" /></label>
    </div>`;

  // Wires up a container holding PICKER_HTML.
  //   onInput(hex)  — every change, including each step of a drag (use for previews)
  //   onCommit(hex) — when a drag is released or a value is typed
  // Nothing is reported until the user actually changes the colour.
  function wirePicker(box, { onInput, onCommit } = {}) {
    const $ = (s) => box.querySelector(s);
    const satArea = $(".tt-sat-area"), satPointer = $(".tt-sat-pointer");
    const hueArea = $(".tt-hue-area"), hueThumb = $(".tt-hue-thumb");
    const hexGroup = $(".tt-inputs-hex"), rgbGroup = $(".tt-inputs-rgb");
    const hexInput = $(".tt-hex-val"), rInput = $(".tt-rgb-r"), gInput = $(".tt-rgb-g"), bInput = $(".tt-rgb-b");
    let h = 0, s = 0, v = 1, mode = "HEX";

    const focused = () => box.getRootNode().activeElement;
    const current = () => rgbToHex(...hsvToRgb(h, s, v));
    const clamp01 = (x) => Math.max(0, Math.min(1, x));

    function draw(skipSource) {
      const [r, g, b] = hsvToRgb(h, s, v);
      const hex = rgbToHex(r, g, b);
      const pureHue = `hsl(${Math.round(h)}, 100%, 50%)`;
      satArea.style.backgroundColor = pureHue;
      satPointer.style.left = `${clamp01(s) * 100}%`;
      satPointer.style.top = `${clamp01(1 - v) * 100}%`;
      satPointer.style.backgroundColor = hex;
      hueThumb.style.left = `${clamp01(h / 360) * 100}%`;
      hueThumb.style.backgroundColor = pureHue;
      if (skipSource !== "hex" && focused() !== hexInput) hexInput.value = hex.toUpperCase();
      if (skipSource !== "rgb") {
        if (focused() !== rInput) rInput.value = r;
        if (focused() !== gInput) gInput.value = g;
        if (focused() !== bInput) bInput.value = b;
      }
      return hex;
    }

    function changed(skipSource, commit) {
      const hex = draw(skipSource);
      if (onInput) onInput(hex);
      if (commit && onCommit) onCommit(hex);
    }

    function draggable(area, update) {
      let dragging = false;
      area.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        area.setPointerCapture(e.pointerId);
        dragging = true;
        update(e);
        changed();
      });
      area.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        update(e);
        changed();
      });
      const stop = (e) => {
        if (!dragging) return;
        try { area.releasePointerCapture(e.pointerId); } catch {}
        dragging = false;
        if (onCommit) onCommit(current());
      };
      area.addEventListener("pointerup", stop);
      area.addEventListener("pointercancel", stop);
    }

    draggable(satArea, (e) => {
      const rect = satArea.getBoundingClientRect();
      s = rect.width ? clamp01((e.clientX - rect.left) / rect.width) : 0;
      v = rect.height ? 1 - clamp01((e.clientY - rect.top) / rect.height) : 0;
    });
    draggable(hueArea, (e) => {
      const rect = hueArea.getBoundingClientRect();
      h = rect.width ? clamp01((e.clientX - rect.left) / rect.width) * 360 : 0;
      if (h >= 360) h = 0;
    });

    $(".tt-format-card").addEventListener("click", (e) => {
      e.stopPropagation();
      mode = mode === "HEX" ? "RGB" : "HEX";
      $(".tt-format-mode").textContent = mode;
      hexGroup.style.display = mode === "HEX" ? "flex" : "none";
      rgbGroup.style.display = mode === "RGB" ? "flex" : "none";
    });

    hexInput.addEventListener("input", () => {
      const rgb = hexToRgb(hexInput.value);
      if (!rgb) return;
      [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      changed("hex", true);
    });

    const onRgb = () => {
      const part = (el) => Math.max(0, Math.min(255, parseInt(el.value, 10) || 0));
      [h, s, v] = rgbToHsv(part(rInput), part(gInput), part(bInput));
      changed("rgb", true);
    };
    [rInput, gInput, bInput].forEach((el) => el.addEventListener("input", onRgb));

    return {
      // Show a colour without reporting it as a change
      set(hex) {
        const rgb = hexToRgb(hex);
        if (rgb) [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
        draw();
      }
    };
  }

  globalThis.TwoTone = {
    HEX, BAR, DATE_PATH, MAX_GHOST, PRUNE_DAYS,
    DEFAULT_SWATCHES, DEFAULT_SWATCHES_DARK, STORAGE_DEFAULTS, cloneSwatches, validSwatches,
    hsvToRgb, rgbToHsv, rgbToHex, hexToRgb, luminance,
    eventDay, isEventPassed, eventTimestamp, tidyEvents,
    exportData, sanitizeImport,
    PICKER_HTML, wirePicker
  };
})();
