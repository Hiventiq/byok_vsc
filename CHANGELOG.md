# Changelog

## Unreleased

## 0.3.0

- Choose how usage looks: the new "Choose Display Style" button (paint icon in the Claude Accounts title bar) offers Bars (default), Rings, Rings + badges, and a graphical Panel with gradient bars. The settings behind it are `hiventiqByok.view`, `usageStyle`, `richTooltip` and `labelBadges`.
- Hovering an account shows a picture of its usage windows (Markdown tooltip with an SVG).
- Bars are now rounded segments (`▰▱`) with a green, amber or red dot, instead of grey blocks.
- Claude accounts whose plan includes Fable show a Fable weekly bar; accounts without it show none.
- When an account has a short name, its email is no longer shown beside it.
- Codex usage: when both rate-limit windows fall in the same length class (both short or both long), both are now kept instead of the second overwriting the first. Same fix as the byok library's `usage_windows.py`.
- Internal: the HTTP clients share their result shapes (`src/core/httpResult.js`), removing duplicated code; comments now point to the matching code in the Hiventiq byok library so the two are kept in step. No behavior change.

## 0.2.2

- New icon: the Hive logo.
- Internal: push and release scripts (`scripts/`), and fixes from code analysis (CI installs with `--ignore-scripts`, background refreshes can no longer reject, small clean-ups). No behavior change.

## 0.2.1

- Two accounts that share one email (for example a personal and an organization login) are now kept as separate accounts, told apart by their organization/workspace id. Rows show the organization name next to the email, and the pencil still gives each a short name.
- Existing saved accounts are unchanged.

## 0.2.0

- Codex support: switch ChatGPT/Codex accounts (`~/.codex/auth.json`) with the same status bar, sidebar, usage bars and auto-switch as Claude.
- A second status bar item appears once a Codex login exists; the sidebar groups accounts by tool.
- `+` (Save Current Login) saves the live login of every tool that has one.
- Usage windows are read by length, so plans with only a weekly window show only that window.
- Saved Claude accounts and preferences carry over unchanged.

## 0.1.0

- Status bar item: the live Claude Code account and its 5h / weekly usage; click to switch.
- Sidebar: every saved account with usage bars and reset countdowns; rename and reorder in place.
- Optional auto-switch at a usage threshold, with cooldown and the sidebar order as fallback order.
- Backs up the Claude credential files before every switch; refreshes only saved (not live) tokens.
- Follows Anthropic's `Retry-After` on rate limits and shows the last good reading meanwhile.
