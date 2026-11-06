# Releasing BYOK from the Mac (M5): the runbook

Everything runs on this Mac. No PC, no self-hosted runner, no M4. CI runs on GitHub-hosted
runners (`ubuntu-latest`, `windows-latest`). First proven 2026-11-05 (0.4.1).

## One-time setup (already done on the M5; check, do not redo)

| What | Where / how to check |
|---|---|
| PowerShell 7 | `/Users/m5/bin/pwsh` |
| Azure CLI | `brew install azure-cli`; `az account show` must say `kaigler@ijwk.com` (a member of the `hiventiq` publisher). If not signed in: `az login` (opens a browser, the owner completes it; the session lasts weeks). |
| GitHub token for the scripts | `scripts/local.ps1` (git-ignored) holds one line: `$script:TokenFile = "/Users/m5/hiventiq/projects/.github/txt.token"`. That is the same file `/Users/m5/bin/git-credential-hive` reads for `git push`. Never print or copy the token. Recreate `local.ps1` after a fresh clone. |
| No `VSCE_PAT` | Not used. Publishing is `vsce publish --azure-credential` from the `az` session. |
| No `gh` CLI | Not installed. The scripts call the GitHub API themselves. |

Scripts must be run with `pwsh -File scripts/<name>.ps1`, from `/Users/m5/hiventiq/byok_vsc`.

## The routine

1. **Bump and document.** Raise `version` in `package.json`, rename the `## Unreleased`
   section of `CHANGELOG.md` to that version (the owner chooses the number), and update
   `README.md` if anything a user sees or sets changed.
2. **Push.** The push script must start on `main` with the change **uncommitted**; it makes
   its own branch. If the work is already committed on a branch:
   `git checkout main && git merge --squash <branch>` (leaves it staged), then run:

       pwsh -File scripts/push-to-github.ps1 -Message "<summary> (<version>)" \
         -Trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"

   Add `-ReadmeUnchanged "<why>"` if the README needs nothing. It audits, opens the PR,
   waits for both `Test` jobs and SonarCloud, and squash-merges only if green.
3. **If a check is red,** it leaves the PR open. Read the failing log (see "Reading a CI
   log"), fix on the PR branch, commit, `git push`, then
   `pwsh -File scripts/resume-pr.ps1 -Number <PR#> -Trailer "..."`. If it reports the old
   failure, the new run is still going: run it again.
4. **Release.** On a clean `main` equal to `origin/main`:

       pwsh -File scripts/release-to-marketplace.ps1

   It tags `v<version>`, waits for the GitHub Release `.vsix`, publishes that exact file to
   the Marketplace via `az`, and waits for the listing to show the version.
5. **Verify.** `npx @vscode/vsce show hiventiq.hiventiq-byok` must show the new version.
6. **Install it locally** (the Extensions "check for updates" lags, and says "no updates"
   once installed):

       "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
         --install-extension hiventiq.hiventiq-byok --force

   Then **Developer: Reload Window**: the running window keeps the old code until reloaded.
   `code` is not on the shell PATH; use the full path above.

## See the local source working (no release needed)

    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --new-window \
      --user-data-dir /private/tmp/claude-501/byok-dev-profile \
      --extensions-dir /private/tmp/claude-501/byok-dev-exts \
      --extensionDevelopmentPath=/Users/m5/hiventiq/byok_vsc /Users/m5/hiventiq/byok_vsc

A throwaway profile, so no settings or theme carry over; it still reads the real logins.
Its logs: `/private/tmp/claude-501/byok-dev-profile/logs/*/window1/exthost/exthost.log`.

## Gotchas that cost time (all fixed or known)

- **A branch push alone runs no CI and no Sonar.** They run on pull requests; only the push
  script's PR gets checked. Never push straight to `main` to get around this (Sonar rule).
- **`$env:TEMP` does not exist on macOS.** Both scripts now use `[IO.Path]::GetTempPath()`.
- **Windows CI fails on Unix-permission asserts** (`mode & 0o777` is `0o666` there). Guard
  such tests with `process.platform !== "win32"`.
- **Do not pull the token out yourself** (`git credential fill`, reading the helper or the
  token file). The permission system blocks it as credential exploration. Let the scripts
  read it through `local.ps1`. To read a CI log, dot-source `scripts/lib.ps1` in a `pwsh`
  script and use `Invoke-GitHubApi` / `Get-GitHubToken` inside it.
- **Reading a CI log:** `GET /repos/Hiventiq/byok_vsc/actions/runs?head_sha=<sha>`, then
  `/actions/runs/<run>/jobs`, then `/actions/jobs/<job>/logs` (follows a redirect; the
  content is already text). `grep "not ok"` finds the failing test.
- **Publisher key for the M4 build runner** (`~/.ssh/id_ed25519_bzz_release`) has Windows
  line endings on this Mac; `tr -d '\r'` into a temp file before use. It is not needed to
  release this extension.
- **Version numbers are the owner's call.** Never choose or bump one unasked.
