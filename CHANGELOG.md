# Changelog

## Unreleased

- `push-to-github.ps1` now refuses a change that leaves `README.md` untouched unless
  `-ReadmeUnchanged "<why>"` attests the README was reviewed and needs nothing (hive
  REQ-ROOT-DOC-001). The release script passes the attestation itself, since it runs on a
  clean `main` the push already gated. README: the Releasing steps say so.

## 0.4.0

- Saved logins are shared with the Hiventiq byok library on the same machine (byok REQ-BYOK-SHR-001). Both tools keep every saved Claude and Codex login in one per-user folder (`%LOCALAPPDATA%\Hiventiq\byok\accounts`, owner-only; `~/.local/share/hiventiq/byok/accounts` elsewhere), so each shows every account, and only one of them refreshes a token at a time: this extension while VS Code is open (it writes a heartbeat on every poll), byok when it is not. A login saved or refreshed in one appears in the other without a new sign-in; removing a login in one removes it in the other. The usage reading is shared the same way: whichever tool fetched last writes it to the login's file, and the other shows it instead of calling (the usage endpoint rate-limits per access token, which both now share), so the sidebar no longer shows `HTTP 429` for an account byok just read. Settings: `hiventiqByok.shareWithByok` (default on) and `hiventiqByok.sharedAccountsDir`. Fixes the "Needs sign-in (HTTP 400)" rows that appeared when byok had refreshed the same login.
- Saved logins are renewed an hour before they expire (while VS Code is open), one refresh per account at a time; a rotated token is saved before use and never spent twice; a login the vendor rejects for good is not retried until you sign in again; a rejected token that still looked valid is refreshed once and retried before the row says "Needs sign-in".
- The "Needs sign-in" row now says why (for example `HTTP 400`).
- `hiventiqByok.pollSeconds` (default 120, minimum 60) now also sets how long a usage reading is reused, and a change applies without a reload.
- The sidebar and commands are named "Hiventiq BYOK".
- README: an Install section, a worked example of which account auto-switch picks (and why it returns to the first account once its window resets), a first-run note, and the byok coordination advice as a short callout.

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
