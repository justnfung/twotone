[twotone](https://github.com/justnfung/twotone/tree/main)

## using twotone

- **Right-click an event**, choose what the colour applies to, then pick a colour.
- Clicking a preset saves it straight away. The custom picker previews as you drag and saves when you close it.
- **Reset** appears in the menu once there's something to reset.
- Group rules match event titles. Plain text is a case-insensitive "contains" match (`2100-` matches every title containing `2100-`). In the manager you can also type a regular expression such as `/2100|micro/i`.
- When more than one group matches an event, the one nearest the top of the manager wins. A colour set for "only this event" always wins.

## privacy and permissions

- **Permissions:** `storage` only.
- **Runs on:** `calendar.notion.so` and `calendar.notion.com` only.
- **No network access.** The extension makes no requests, loads no remote code and has no analytics.
- **What's stored:** your colour rules and the title of each event you colour individually. This is kept in `chrome.storage.local` in your browser profile. This is not synced and is never sent anywhere. Removing twotone deletes them.
- The extension can read the text of the calendar page to match event titles.
