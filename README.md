# twotone
Unofficial Chrome extension that lets you right-click any event in [Notion Calendar](https://calendar.notion.so) and give it its own fill colour. Calendar's colour bar on the left stays as it is, so you can still see which calendar an event belongs to at a glance.

## features
- **Right-click an event** to pick a colour for:
  - **every event in the same course.** Titles that start with a course code are recognised, like `2100-Microeconomics (Lecture 4)`, `BIO 101 Lab` or `CS-2100 Tutorial`.
  - **every event with the same title**, for events without a course code.
  - **only that one event.**
- **Reset** one event to its calendar colour while the rest of its course keeps theirs.
- **Manage everything** from the toolbar button: rename, recolour or delete, or add your own rules by hand.
- **Does not replace Notion's pop-up menu.** Single click opens Notion menu, right click opens twotone menu.

## installation
1. Download this repository: **Code → Download ZIP**, then unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the **`extension`** folder inside what you unzipped.
5. Reload Notion Calendar.

### [usage and permissions](usage-and-permissions)
