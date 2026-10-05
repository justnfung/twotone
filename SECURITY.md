# Security policy

## Reporting a problem

Please report security problems privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Please don't open a public issue for security problems.

Include what you found, how to reproduce it, and what an attacker could do with it. You should hear back within a week.

## What's in scope

The extension is designed to be low-risk:

- It asks only for the `storage` permission.
- It runs only on `calendar.notion.so` and `calendar.notion.com`.
- It makes no network requests and loads no remote code.

Any way to break those guarantees is in scope. So is any way for an event title (which anyone who sends an invite controls) to run code, inject HTML or CSS, or slow the page down. Problems in Notion Calendar itself should go to Notion.

## Supported versions

Only the latest version on the `main` branch gets fixes.
