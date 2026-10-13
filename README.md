# TwoTone for Notion Calendar

**Give Notion Calendar events your own colours. Right-click an event to recolour it, or every event like it.**

![Before and After: a week of classes recoloured by course](docs/before-after.png)

When timetable or team feeds arrive in [Notion Calendar](https://calendar.notion.so) as a single subscribed calendar, every event shares the same colour. TwoTone lets you recolour events by course or title while preserving Notion's original ribbon bar on the left so you still know where the event came from.

> **Note:** Unofficial extension. Not affiliated with or endorsed by Notion Labs, Inc.

---

## Features

- **Smart Course Recolouring:** Right-click any event to recolour just that event, all events with the same title, or its entire course (auto-detects codes like `BIO 101`, `CS-2100`, or `2100-Micro`).
- **Custom Palettes:** 9 curated presets + full hex picker, with automatic light and dark mode palettes.
- **Hide & Ghost Events:** Hide unwanted events or dim them into faint ghosts. Press <kbd>Alt</kbd>+<kbd>H</kbd> (<kbd>⌥H</kbd> on Mac) to peek at hidden items.
- **Colour Manager:** Click the extension icon to manage, rename, reorder, or delete rules, and jump directly to events in your calendar.
- **Backup & Restore:** Export and import your rules and palettes as a JSON file.
- **Native Menu Preserved:** Hold <kbd>Alt</kbd> (<kbd>⌥</kbd>) while right-clicking to access Notion's native context menu.
- **100% Private:** Requires only `storage` permission. No network calls, no analytics, no external scripts.

---

## Installation

1. Download the latest `twotone-x.x.x.zip` from [Releases](../../releases) (or clone this repo) and unzip it.
2. Go to `chrome://extensions` in any Chromium browser (Chrome, Brave, Edge, Arc).
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `extension/` folder.
5. Reload Notion Calendar.

---

## How It Works

TwoTone overrides only the `--background-color` CSS property on Notion event chips (`[data-event-chip-key]`) and automatically computes accessible text contrast, leaving Notion's ribbon bars (`--ribbon-color-primary`) intact. A `MutationObserver` repaints chips dynamically as you navigate.

---

## Development

```sh
npm install
npx playwright install chromium
npm test            # Run integration tests
npm run showcase    # Regenerate showcase assets
```

---

## License

[MIT](LICENSE)
