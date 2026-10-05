const {
  HEX, BAR, MAX_GHOST, DEFAULT_SWATCHES, DEFAULT_SWATCHES_DARK, STORAGE_DEFAULTS, cloneSwatches, validSwatches,
  eventDay, isEventPassed, eventTimestamp, tidyEvents, exportData, sanitizeImport, PICKER_HTML, wirePicker
} = globalThis.TwoTone;

let rules = [];
let events = {};
let ghostOpacity = 0;
let swatches = cloneSwatches(DEFAULT_SWATCHES);
let swatchesDark = cloneSwatches(DEFAULT_SWATCHES_DARK);

function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  children.forEach((c) => n.append(c));
  return n;
}

// ---------------------------------------------------------------- saving

// Only the keys that were edited here are written, so a change made from the calendar's
// right-click menu in the meantime isn't overwritten with this page's older copy.
const dirty = new Set();
let saveTimer = null;
const current = () => ({ rules, events, ghostOpacity, swatches, swatchesDark });

function save(...keys) {
  keys.forEach((k) => dirty.add(k));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 150);
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty.size) return;
  const all = current();
  const patch = {};
  dirty.forEach((k) => { patch[k] = all[k]; });
  dirty.clear();
  chrome.storage.local.set(patch);
}

// The popup can close the moment you click away; don't lose the last edit.
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

// ---------------------------------------------------------------- custom color picker

let activePicker = null;

function openColorPicker(anchorEl, currentColor, onPick) {
  if (activePicker) {
    activePicker.close();
  }

  const popover = document.createElement("div");
  popover.className = "tt-picker-popover";
  popover.innerHTML = `
    ${PICKER_HTML}
    <div class="tt-picker-sep"></div>
    <button class="tt-btn-remove-fill" type="button">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
      Reset to calendar colour
    </button>
  `;

  // Opening the picker only shows the current colour; nothing changes until you pick one.
  wirePicker(popover, { onInput: (hex) => onPick(hex.toLowerCase()) })
    .set(HEX.test(currentColor || "") ? currentColor : "#d9e8ff");

  popover.querySelector(".tt-btn-remove-fill").addEventListener("click", (e) => {
    e.stopPropagation();
    onPick(null);
    close();
  });

  // Prevent keyboard/clicks in popover from bubbling to outside handlers
  popover.addEventListener("click", (e) => e.stopPropagation());
  popover.addEventListener("mousedown", (e) => e.stopPropagation());

  document.body.appendChild(popover);
  placePopover(popover, anchorEl, 236, 250);

  const close = () => {
    window.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("keydown", onKey, true);
    popover.remove();
    if (activePicker?.popover === popover) activePicker = null;
  };

  const onOutside = (e) => {
    if (!popover.contains(e.target) && !anchorEl.contains(e.target)) {
      close();
    }
  };

  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  window.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("keydown", onKey, true);

  activePicker = { popover, close };
}

function placePopover(popover, anchorEl, width, height) {
  const rect = anchorEl.getBoundingClientRect();
  let left = rect.left;
  if (left + width > window.innerWidth - 8) {
    left = window.innerWidth - width - 8;
  }
  left = Math.max(8, left);

  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
  }

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

// ---------------------------------------------------------------- ghost slider popover

let activeGhostPicker = null;
const ghostLabel = (op) => (op === 0 ? "0% (Hidden)" : `${op}%`);

function openGhostSliderPopover(anchorEl, currentOp, isHidden, onUpdate) {
  if (activeGhostPicker) {
    activeGhostPicker.close();
  }
  if (activePicker) {
    activePicker.close();
  }

  let op = typeof currentOp === "number" ? currentOp : (isHidden ? 0 : ghostOpacity);
  const hidden = isHidden !== undefined ? isHidden : true;

  const popover = document.createElement("div");
  popover.className = "ghost-slider-popover";

  popover.innerHTML = `
    <div class="ghost-popover-head">
      <span class="ghost-popover-title">Ghost Opacity</span>
      <span class="ghost-popover-val">${hidden ? ghostLabel(op) : "Visible"}</span>
    </div>
    <input type="range" class="ghost-popover-input" aria-label="Ghost opacity" min="0" max="${MAX_GHOST}" step="5" value="${op}">
    <div class="ghost-popover-desc">${hidden ? "Faint ghost visibility when hidden" : "Event is currently visible"}</div>
  `;

  const inputEl = popover.querySelector(".ghost-popover-input");
  const valEl = popover.querySelector(".ghost-popover-val");

  inputEl.addEventListener("input", (e) => {
    e.stopPropagation();
    op = parseInt(inputEl.value, 10) || 0;
    valEl.textContent = ghostLabel(op);
    onUpdate(true, op);
  });

  popover.addEventListener("click", (e) => e.stopPropagation());
  popover.addEventListener("mousedown", (e) => e.stopPropagation());

  document.body.appendChild(popover);
  placePopover(popover, anchorEl, 190, 78);

  const close = () => {
    window.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("keydown", onKey, true);
    popover.remove();
    if (activeGhostPicker?.popover === popover) activeGhostPicker = null;
  };

  const onOutside = (e) => {
    if (!popover.contains(e.target) && !anchorEl.contains(e.target)) {
      close();
    }
  };

  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  window.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("keydown", onKey, true);

  activeGhostPicker = { popover, close };
}

function closePopovers() {
  if (activePicker) activePicker.close();
  if (activeGhostPicker) activeGhostPicker.close();
}

// ---------------------------------------------------------------- UI components

function chip(colour, ribbon, onPick) {
  const box = el("button", {
    type: "button",
    className: "chip" + (HEX.test(colour || "") ? "" : " none"),
    title: "Change colour"
  });
  box.style.border = "0";
  box.style.padding = "0";
  if (HEX.test(colour || "")) box.style.background = colour;
  if (BAR.test(ribbon || "")) box.style.setProperty("--bar", ribbon);

  box.onclick = (e) => {
    e.stopPropagation();
    openColorPicker(box, colour, (newColour) => {
      colour = newColour;
      if (newColour && HEX.test(newColour)) {
        box.classList.remove("none");
        box.style.background = newColour;
      } else {
        box.classList.add("none");
        box.style.background = "";
      }
      onPick(newColour);
    });
  };

  return box;
}

function handleIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 10 14");
  svg.setAttribute("fill", "currentColor");
  svg.innerHTML = `
    <circle cx="2.5" cy="2.5" r="1.3"/>
    <circle cx="7.5" cy="2.5" r="1.3"/>
    <circle cx="2.5" cy="7" r="1.3"/>
    <circle cx="7.5" cy="7" r="1.3"/>
    <circle cx="2.5" cy="11.5" r="1.3"/>
    <circle cx="7.5" cy="11.5" r="1.3"/>
  `;
  return el("div", { className: "handle", title: "Drag to reorder", draggable: true }, [svg]);
}

const opacitySlider = document.getElementById("ghost-opacity");
const opacityVal = document.getElementById("opacity-val");

function updateSliderUI() {
  opacitySlider.value = ghostOpacity;
  opacityVal.textContent = ghostLabel(ghostOpacity);
}

opacitySlider.oninput = () => {
  ghostOpacity = parseInt(opacitySlider.value, 10) || 0;
  updateSliderUI();
  save("ghostOpacity");
};

function getEventDateStr(e, k) {
  if (e && e.date) return e.date;
  const d = eventDay(e, k);
  return d ? new Date(d.year, d.month - 1, d.day).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
}

function getEventDatePath(e, k) {
  const d = eventDay(e, k);
  return d ? `${d.year}/${d.month}/${d.day}` : "";
}

// Ask an open Notion Calendar tab to scroll to the event; if none of them is showing it, send
// one to the event's day. We can't see tab URLs without extra permissions, so every tab is
// asked and only the calendar ones answer.
function showInCalendar(k, e) {
  const msg = { type: "twotone-scroll-to-event", key: k, datePath: getEventDatePath(e, k) };
  const ask = (tab, extra) => new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { ...msg, ...extra }, (res) => resolve(chrome.runtime.lastError ? null : res || null));
  });
  const focus = (tab) => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  };
  chrome.tabs.query({}, async (tabs) => {
    tabs.sort((a, b) => Number(b.active) - Number(a.active));
    const calendars = [];
    for (const tab of tabs) {
      const res = await ask(tab);
      if (res && res.success) return focus(tab);
      if (res && res.calendar) calendars.push(tab);
    }
    if (calendars.length && msg.datePath && (await ask(calendars[0], { navigate: true }))) focus(calendars[0]);
  });
}

function createEventRow(e, k) {
  const fullTitle = e.title || k;
  const words = (e.title || "").trim().split(/\s+/).filter(Boolean);
  const shortTitle = words.length > 3 ? words.slice(0, 3).join(" ") + "…" : (e.title || "(untitled event)");

  const titleEl = el("div", { className: "title link", title: `${fullTitle} · Click to show in calendar`, tabIndex: 0 });
  titleEl.setAttribute("role", "link");
  titleEl.textContent = shortTitle;
  titleEl.onclick = () => showInCalendar(k, e);
  titleEl.onkeydown = (ev) => { if (ev.key === "Enter") showInCalendar(k, e); };

  // Ghost Button / Slider
  const ghostTitle = (hidden, op) => (hidden ? `Hidden (${op}% opacity) · Click to change ghost opacity` : "Click to hide / adjust ghost opacity");
  const isHidden = !!e.hidden;
  const ghostBtn = el("button", {
    className: "ghost-chip-btn" + (isHidden ? " is-hidden" : ""),
    type: "button",
    title: ghostTitle(isHidden, typeof e.opacity === "number" ? e.opacity : ghostOpacity)
  });
  ghostBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  `;
  ghostBtn.onclick = (ev) => {
    ev.stopPropagation();
    openGhostSliderPopover(ghostBtn, e.opacity, e.hidden, (newHidden, newOp) => {
      e.hidden = newHidden;
      e.opacity = newOp;
      ghostBtn.classList.toggle("is-hidden", newHidden);
      ghostBtn.title = ghostTitle(newHidden, newOp);
      save("events");
    });
  };

  const rowChildren = [chip(e.bg, e.ribbon, (c) => { e.bg = c; save("events"); }), ghostBtn];

  const dateStr = getEventDateStr(e, k);
  if (dateStr) {
    const dateBadge = el("span", { className: "date-badge", title: dateStr, textContent: dateStr });
    rowChildren.push(dateBadge);
  }

  const del = el("button", { className: "del", textContent: "✕", title: "Remove" });
  del.setAttribute("aria-label", `Remove ${fullTitle}`);
  del.onclick = () => {
    delete events[k];
    save("events");
    renderEvents();
  };

  rowChildren.push(titleEl, del);
  return el("div", { className: "row" }, rowChildren);
}

function renderRules() {
  const rl = document.getElementById("rules");
  rl.textContent = "";
  if (!rules.length) rl.append(el("div", { className: "empty", textContent: "None yet. Right-click an event and pick “All … events”." }));
  rules.forEach((r) => {
    const name = el("input", { type: "text", className: "name", value: r.label || "", placeholder: "Name" });
    name.setAttribute("aria-label", "Group name");
    name.oninput = () => { r.label = name.value; save("rules"); };
    const match = el("input", { type: "text", className: "match", value: r.match || "", placeholder: "Title contains…", title: "Plain text, or a regex like /2100|micro/i" });
    match.setAttribute("aria-label", "Title contains");
    match.oninput = () => { r.match = match.value; r.literal = false; save("rules"); };
    const del = el("button", { className: "del", textContent: "✕", title: "Remove" });
    del.setAttribute("aria-label", `Remove ${r.label || r.match || "group"}`);
    del.onclick = () => { rules = rules.filter((item) => item !== r); save("rules"); renderRules(); };
    const row = el("div", { className: "row" }, [handleIcon(), chip(r.bg, r.ribbon, (c) => { r.bg = c; save("rules"); }), name, match, del]);
    row._data = r;
    rl.append(row);
  });
}

// Single events are always listed soonest first, with past ones at the end.
function renderEvents() {
  const tidy = tidyEvents(events);
  if (tidy.changed) {
    events = tidy.events;
    save("events");
  }

  const keys = Object.keys(events).sort((a, b) => {
    const aPassed = isEventPassed(events[a], a);
    const bPassed = isEventPassed(events[b], b);
    if (aPassed !== bPassed) return aPassed ? 1 : -1;
    return eventTimestamp(events[a], a) - eventTimestamp(events[b], b);
  });

  const evl = document.getElementById("events");
  evl.textContent = "";
  const all = document.getElementById("settings-events-list");
  all.textContent = "";

  if (keys.length === 0) {
    evl.append(el("div", { className: "empty", textContent: "None yet. Right-click an event and pick “Only this event”." }));
    all.append(el("div", { className: "empty", textContent: "No single event overrides yet." }));
    return;
  }

  // Show top 3 soonest single events
  keys.slice(0, 3).forEach((k) => evl.append(createEventRow(events[k], k)));
  if (keys.length > 3) {
    const viewAllBtn = el("button", {
      className: "btn-view-all",
      type: "button",
      textContent: `View all (${keys.length}) single events →`
    });
    viewAllBtn.onclick = () => openSettings("events");
    evl.append(viewAllBtn);
  }

  keys.forEach((k) => all.append(createEventRow(events[k], k)));
}

function render() {
  renderRules();
  renderEvents();
}

function makeDraggable(container, onReorder) {
  let dragged = null;

  container.addEventListener("dragstart", (e) => {
    const h = e.target.closest(".handle");
    if (!h) {
      e.preventDefault();
      return;
    }
    const row = h.closest(".row");
    if (!row) {
      e.preventDefault();
      return;
    }
    dragged = row;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    const rect = row.getBoundingClientRect();
    if (e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(row, e.clientX - rect.left, e.clientY - rect.top);
    }
    requestAnimationFrame(() => {
      if (dragged) dragged.classList.add("dragging");
    });
  });

  container.addEventListener("dragend", () => {
    if (dragged) {
      dragged.classList.remove("dragging");
      dragged = null;
    }
    container.querySelectorAll(".row").forEach((r) => r.classList.remove("drag-over-top", "drag-over-bottom"));
  });

  container.addEventListener("dragover", (e) => {
    if (!dragged || !container.contains(dragged)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const row = e.target.closest(".row");
    container.querySelectorAll(".row").forEach((r) => {
      if (r !== row) r.classList.remove("drag-over-top", "drag-over-bottom");
    });

    if (!row || row === dragged) return;

    const rect = row.getBoundingClientRect();
    const isTop = e.clientY < rect.top + rect.height / 2;
    row.classList.toggle("drag-over-top", isTop);
    row.classList.toggle("drag-over-bottom", !isTop);
  });

  container.addEventListener("dragleave", (e) => {
    const row = e.target.closest(".row");
    if (row && !row.contains(e.relatedTarget)) {
      row.classList.remove("drag-over-top", "drag-over-bottom");
    }
  });

  container.addEventListener("drop", (e) => {
    if (!dragged || !container.contains(dragged)) return;
    e.preventDefault();

    const targetRow = e.target.closest(".row");
    if (targetRow && targetRow !== dragged) {
      const rect = targetRow.getBoundingClientRect();
      const isTop = e.clientY < rect.top + rect.height / 2;
      if (isTop) {
        container.insertBefore(dragged, targetRow);
      } else {
        container.insertBefore(dragged, targetRow.nextSibling);
      }
      onReorder();
    }

    container.querySelectorAll(".row").forEach((r) => r.classList.remove("drag-over-top", "drag-over-bottom"));
    if (dragged) dragged.classList.remove("dragging");
    dragged = null;
  });
}

// Group order matters (the first match wins), so groups can be dragged.
makeDraggable(document.getElementById("rules"), () => {
  const rows = Array.from(document.querySelectorAll("#rules .row"));
  rules = rows.map((r) => r._data).filter(Boolean);
  save("rules");
});

document.getElementById("add").onclick = () => {
  rules.unshift({ label: "", match: "", bg: "#d9e8ff" });
  save("rules");
  renderRules();
  document.querySelector("#rules .match")?.focus();
};

// ---------------------------------------------------------------- settings: palette

let paletteTheme = "light";
const paletteKey = () => (paletteTheme === "dark" ? "swatchesDark" : "swatches");

function renderPaletteSettings() {
  const grid = document.getElementById("palette-grid");
  grid.textContent = "";
  document.getElementById("palette-light").classList.toggle("active", paletteTheme === "light");
  document.getElementById("palette-dark").classList.toggle("active", paletteTheme === "dark");

  const key = paletteKey();
  const list = key === "swatchesDark" ? swatchesDark : swatches;
  list.forEach((sw) => {
    const [color, name] = sw;
    const slot = el("div", { className: "palette-slot" });

    const chipEl = el("button", { type: "button", className: "palette-chip", title: "Click to change color" });
    chipEl.style.border = "0";
    chipEl.style.backgroundColor = color;

    chipEl.onclick = (e) => {
      e.stopPropagation();
      openColorPicker(chipEl, sw[0], (newColor) => {
        if (newColor && HEX.test(newColor)) {
          sw[0] = newColor;
          chipEl.style.backgroundColor = newColor;
          hexEl.textContent = newColor.toUpperCase();
          save(key);
        }
      });
    };

    const nameInput = el("input", {
      type: "text",
      className: "palette-name-input",
      value: name || "",
      placeholder: "Color name"
    });
    nameInput.setAttribute("aria-label", "Color name");
    nameInput.oninput = () => {
      sw[1] = nameInput.value;
      save(key);
    };

    const hexEl = el("span", {
      className: "palette-hex",
      textContent: color.toUpperCase()
    });

    const info = el("div", { className: "palette-info" }, [nameInput, hexEl]);
    slot.append(chipEl, info);
    grid.append(slot);
  });
}

document.getElementById("palette-light").addEventListener("click", () => { paletteTheme = "light"; renderPaletteSettings(); });
document.getElementById("palette-dark").addEventListener("click", () => { paletteTheme = "dark"; renderPaletteSettings(); });

document.getElementById("btn-reset-palette").addEventListener("click", () => {
  if (paletteTheme === "dark") swatchesDark = cloneSwatches(DEFAULT_SWATCHES_DARK);
  else swatches = cloneSwatches(DEFAULT_SWATCHES);
  save(paletteKey());
  renderPaletteSettings();
});

// ---------------------------------------------------------------- settings: backup

const backupStatus = document.getElementById("backup-status");
const backupConfirm = document.getElementById("backup-confirm");
const importFile = document.getElementById("import-file");
let pendingImport = null;

function setBackupStatus(text, isError) {
  backupStatus.textContent = text;
  backupStatus.classList.toggle("error", !!isError);
}

function clearPendingImport() {
  pendingImport = null;
  backupConfirm.style.display = "none";
}

document.getElementById("btn-export").addEventListener("click", () => {
  flush();
  const blob = new Blob([JSON.stringify(exportData(current()), null, 2)], { type: "application/json" });
  const link = el("a", { href: URL.createObjectURL(blob), download: `twotone-backup-${new Date().toISOString().slice(0, 10)}.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setBackupStatus(`Exported ${rules.length} group(s) and ${Object.keys(events).length} single event(s).`);
});

document.getElementById("btn-import").addEventListener("click", () => {
  // A toolbar popup closes when the file chooser opens, so do the import in a tab.
  if (chrome.extension.getViews({ type: "popup" }).includes(window)) {
    window.open(chrome.runtime.getURL("popup.html#backup"));
    return;
  }
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = "";
  clearPendingImport();
  if (!file) return;
  let data = null;
  try {
    data = sanitizeImport(JSON.parse(await file.text()));
  } catch {
    // not JSON; reported below
  }
  if (!data) {
    setBackupStatus("That file isn't a TwoTone backup.", true);
    return;
  }
  pendingImport = data;
  setBackupStatus(`Replace everything here with the backup's ${data.rules.length} group(s) and ${Object.keys(data.events).length} single event(s)?`);
  backupConfirm.style.display = "flex";
});

document.getElementById("btn-import-confirm").addEventListener("click", () => {
  if (!pendingImport) return;
  ({ rules, events, ghostOpacity, swatches, swatchesDark } = pendingImport);
  clearPendingImport();
  save("rules", "events", "ghostOpacity", "swatches", "swatchesDark");
  flush();
  updateSliderUI();
  render();
  renderPaletteSettings();
  setBackupStatus("Backup restored.");
});

document.getElementById("btn-import-cancel").addEventListener("click", () => {
  clearPendingImport();
  setBackupStatus("");
});

// ---------------------------------------------------------------- settings panel

const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const TABS = ["palette", "events", "backup"];

function switchTab(tab) {
  TABS.forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle("active", t === tab);
    document.getElementById(`view-${t}`).style.display = t === tab ? "flex" : "none";
  });
}

TABS.forEach((t) => {
  document.getElementById(`tab-${t}`).addEventListener("click", () => switchTab(t));
  document.getElementById(`btn-done-${t}`).addEventListener("click", closeSettings);
});

function openSettings(initialTab) {
  switchTab(initialTab || "palette");
  renderPaletteSettings();
  settingsPanel.style.display = "flex";
  settingsBtn.classList.add("active");
  document.body.classList.add("settings-open");
}

function closeSettings() {
  closePopovers();
  settingsPanel.style.display = "none";
  settingsBtn.classList.remove("active");
  document.body.classList.remove("settings-open");
}

settingsBtn.addEventListener("click", () => {
  if (settingsPanel.style.display === "none" || !settingsPanel.style.display) {
    openSettings();
  } else {
    closeSettings();
  }
});

document.getElementById("settings-close").addEventListener("click", closeSettings);

// ---------------------------------------------------------------- loading and staying in sync

function load() {
  chrome.storage.local.get(STORAGE_DEFAULTS, (d) => {
    rules = Array.isArray(d.rules) ? d.rules : [];
    events = d.events && typeof d.events === "object" ? d.events : {};
    ghostOpacity = typeof d.ghostOpacity === "number" ? d.ghostOpacity : 0;
    swatches = validSwatches(d.swatches) ? d.swatches : cloneSwatches(DEFAULT_SWATCHES);
    swatchesDark = validSwatches(d.swatchesDark) ? d.swatchesDark : cloneSwatches(DEFAULT_SWATCHES_DARK);
    updateSliderUI();
    render();
    renderPaletteSettings();
    if (location.hash === "#backup") openSettings("backup");
  });
}

// Stay in sync if you right-click events while the manager is open in a tab. A key with an
// unsaved edit here is left alone; its own write is about to land.
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  const differs = (k, mine) => ch[k] && !dirty.has(k) && JSON.stringify(ch[k].newValue) !== JSON.stringify(mine);
  const typingIn = (selector) => !!document.activeElement?.matches(`${selector} input[type=text]`);

  if (differs("ghostOpacity", ghostOpacity)) {
    ghostOpacity = typeof ch.ghostOpacity.newValue === "number" ? ch.ghostOpacity.newValue : 0;
    updateSliderUI();
  }
  if ((differs("swatches", swatches) || differs("swatchesDark", swatchesDark)) && !typingIn("#palette-grid")) {
    if (ch.swatches && validSwatches(ch.swatches.newValue)) swatches = ch.swatches.newValue;
    if (ch.swatchesDark && validSwatches(ch.swatchesDark.newValue)) swatchesDark = ch.swatchesDark.newValue;
    closePopovers();
    renderPaletteSettings();
  }
  if (differs("events", events)) {
    events = ch.events.newValue && typeof ch.events.newValue === "object" ? ch.events.newValue : {};
    closePopovers();
    renderEvents();
  }
  if (differs("rules", rules) && !typingIn("#rules")) {
    rules = Array.isArray(ch.rules.newValue) ? ch.rules.newValue : [];
    closePopovers();
    renderRules();
  }
});

load();
