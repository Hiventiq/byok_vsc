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

- **Status bar**: the live account and its usage, one item per
  tool (Claude; Codex appears once you have a Codex login). Click it to switch.
  It tints amber near your limit and red when a login is dead.
- **Sidebar** ("Hiventiq BYOK" in the Explorer): every account with usage bars
  and reset countdowns, grouped by tool once you use both.
- **Auto-switch** (off by default): move to the first saved account of the same
  tool, in your sidebar order, that has room when the active one hits a
  threshold, with a cooldown. See "Which account auto-switch picks" below.

## Display style

The paint icon in the Hiventiq BYOK title bar (**Choose Display Style**) picks how
usage is drawn:

- **Bars** (default): text bars (`▰▱`) with a green, amber or red dot.
- **Rings**: a ring icon per row that fills to the percent.
- **Rings + badges**: rings plus a coloured percent badge on each account.
- **Panel**: graphical cards with gradient bars, replacing the tree.

Hovering an account shows a picture of its usage windows. The choice is stored in the
`hiventiqByok.view`, `usageStyle`, `richTooltip` and `labelBadges` settings, which you can
also set by hand. A Claude account whose plan includes Fable also shows a **Fable** weekly
bar; accounts without it show none.

## Names and fallback order

Managed in the sidebar, no JSON. On each account row: the pencil sets a short
name (shown instead of the email, which is then hidden), and the up/down arrows set the order
auto-switch tries accounts (top first). Right-click a row for the same actions.

### Which account auto-switch picks

When the active account's worst usage window reaches the threshold
(`hiventiqByok.warnAtPercent`), the extension switches to the **first account in your
sidebar order that has room**: saved, not the active one, not needing a sign-in, and
under the threshold. It checks the list from the top every time; it does not keep a
"where I was" pointer, so it is not a strict round-robin. A cooldown stops it switching
again straight away.

Example with three accounts in sidebar order A, B, C:

1. You are on **A**. A hits the threshold, so the extension switches to **B** (the first
   below A with room).
2. You work on B for four hours. During that time A's 5-hour window resets (the "resets
   in ..." countdown on its row reaches zero), so A is under the threshold again.
3. B hits the threshold. The extension looks from the top: A has room, so it switches
   back to **A**, not on to C.
4. C is used only when A and B are both over the threshold at the same moment.

Two things are separate here: the usage window reset is Anthropic's clock and is what
makes an account eligible again; the token refresh the extension does an hour before a
login expires keeps the login alive but has nothing to do with usage.

If the Hiventiq byok library's own auto-switch is also on, note that it uses a different
rule (the account with the most room left, needing at least its "min gain"), so keep
auto-switch on in only one of the two.

## Install

From the Marketplace: search for **BYOK** by Hiventiq in the Extensions view, or
install `hiventiq.hiventiq-byok` from the command line:

    code --install-extension hiventiq.hiventiq-byok

From a `.vsix` (a GitHub Release asset, or your own `npm run package` build):

    code --install-extension hiventiq-byok-<version>.vsix --force

Then reload the window (**Developer: Reload Window**). You also need the Claude Code
and/or Codex CLI installed and signed in at least once.

## Use

1. Sign in the normal way (`claude login` and/or `codex login`), then click `+`
   in the sidebar (**Save Current Login**). It saves the live login of every tool
   that has one.
2. Repeat for each account (sign in as the next one, click `+`).
3. Click a status bar item, or an account row, to switch.

If a login you just made does not show up, run **Hiventiq BYOK: Refresh Usage** (the
refresh icon in the sidebar title bar) or reload the window; the extension re-reads the
CLI files on every poll (`hiventiqByok.pollSeconds`, default 2 minutes).

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
refreshes only saved accounts' tokens, never the live one: the CLI owns that. Saved
tokens are renewed an hour before they expire while VS Code is open.

> **Also using the Hiventiq byok library?** Leave auto-switch on in only one of the
> two, and leave `hiventiqByok.shareWithByok` on so they share logins instead of
> signing each other out. Details follow.

If the Hiventiq byok library also runs on this machine, both keep every saved login in
one per-user folder (`%LOCALAPPDATA%\Hiventiq\byok\accounts` on Windows,
`~/.local/share/hiventiq/byok/accounts` elsewhere, owner-only), so each shows every
account and only one of them refreshes a token at a time: this extension while VS Code
is open, byok otherwise. A vendor refresh token can be used once, so two programs
refreshing the same login would otherwise sign each other out. Turn it off with
`hiventiqByok.shareWithByok`; `hiventiqByok.sharedAccountsDir` picks another folder
(it must match byok's `BYOK_SHARED_ACCOUNTS_DIR`).

Usage comes from Anthropic's `/api/oauth/usage` and ChatGPT's `/backend-api/wham/usage`,
unofficial endpoints those tools use themselves.

## Privacy

Your logins never leave your machine: they are stored in VS Code's SecretStorage
(encrypted by your OS), in the Claude/Codex CLIs' own files, and (unless turned off) in
the owner-only folder shared with the byok library, at the same protection level as the
CLIs' own credential files. The only network
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

## Releasing

Two scripts do the work (PowerShell, Windows). Settings for your machine go in
`scripts/local.ps1`; copy `scripts/local.example.ps1`.

1. Bump `version` in `package.json` and add a `## <version>` section to `CHANGELOG.md`.
2. `scripts\push-to-github.ps1 -Message "summary"` audits the change, opens a pull request,
   waits for the tests (Linux and Windows) and SonarCloud, and merges only if all are green.
3. `scripts\release-to-marketplace.ps1` checks that `main` is green, tags `v<version>` (the
   **CI and release** workflow builds the GitHub Release), then publishes that exact `.vsix`
   to the Marketplace with your `az login`.

Without the scripts: tag with `git tag v<version> && git push origin v<version>`, then run the
manual **Publish to Marketplace** workflow (needs the repository secret `VSCE_PAT`) or
`npx @vscode/vsce publish --azure-credential`.
