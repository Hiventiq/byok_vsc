# BYOK

By Hiventiq. Switch between your Claude Code and Codex accounts from VS Code.
Standalone: one extension, no service, no Python, no database.

> **Unofficial.** Not affiliated with, endorsed by, or sponsored by Anthropic or
> OpenAI. "Claude" is a trademark of Anthropic; "Codex" and "ChatGPT" are
> trademarks of OpenAI. This extension reads and writes the Claude Code and Codex
> CLIs' own login files on your machine and calls the same unofficial usage
> endpoints those tools use; those can change without notice. Check each vendor's
> terms for your plan before switching accounts. Your logins never leave your
> machine: they are stored in VS Code's SecretStorage.

- **Status bar** (always visible): the live account and its usage, one item per
  tool (Claude; Codex appears once you have a Codex login). Click it to switch.
  It tints amber near your limit and red when a login is dead.
- **Sidebar** ("Claude Accounts" in the Explorer): every account with usage bars
  and reset countdowns, grouped by tool once you use both.
- **Auto-switch** (off by default): move to your emptiest saved account of the
  same tool when the active one hits a threshold, with a cooldown and your
  sidebar order as the fallback order.

## Names and fallback order

Managed in the sidebar, no JSON. On each account row: the pencil sets a short
name (shown instead of the email), and the up/down arrows set the order
auto-switch tries accounts (top first). Right-click a row for the same actions.

## Use

1. Sign in the normal way (`claude login` and/or `codex login`), then click `+`
   in the sidebar (**Save Current Login**). It saves the live login of every tool
   that has one.
2. Repeat for each account (sign in as the next one, click `+`).
3. Click a status bar item, or an account row, to switch.

After a switch, start a new Claude conversation (or restart the Codex session) or
reload the window: both tools read their login when a session starts.

Some plans have only one usage window (for example weekly only); the extension
shows only the windows the account actually has.

## How it works

Claude: `~/.claude/.credentials.json` and the `oauthAccount` block of `~/.claude.json`.
Codex: `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`). Codex must store its login
in that file (its default); a login kept in the OS keychain is not supported.

Saved logins are kept in VS Code's SecretStorage (encrypted by your OS). Before every
switch it backs the files up (newest 10 kept) and saves the login it is leaving. It
refreshes only saved accounts' tokens, never the live one: the CLI owns that.

Usage comes from Anthropic's `/api/oauth/usage` and ChatGPT's `/backend-api/wham/usage`,
unofficial endpoints those tools use themselves.

## Privacy

Your logins never leave your machine: they are stored in VS Code's SecretStorage
(encrypted by your OS) and in the Claude/Codex CLIs' own files. The only network
calls go to Anthropic (`api.anthropic.com`, `console.anthropic.com`) and OpenAI
(`chatgpt.com`, `auth.openai.com`), the same endpoints those tools use. Nothing is
sent to Hiventiq or any third party, and there is no telemetry.

## Support

Issues and questions: https://github.com/Hiventiq/byok_vsc/issues

## License

Apache License 2.0 (see `LICENSE` and `NOTICE`). It includes an express patent grant
from contributors to everyone who uses the software.

## Develop

    npm install
    npm test
    npm run package      # builds the single minified file and a .vsix

Layout: `src/core` pure logic, `src/data` files and HTTP, `src/services` business
logic (one provider per tool in `services/providers`), `src/ui` VS Code views,
`src/extension.js` wiring only. Adding another tool means one provider file plus its
files/API modules.
