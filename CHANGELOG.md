# Changelog

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
