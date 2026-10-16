# CLAUDE.md

Guidance for working in this repo: BYOK for VS Code (Claude Code and Codex account
switcher). See `README.md` for what it does and how to release.

## Two commands (what the owner says, and what to run)

- **"push to github"**: `powershell -File scripts\push-to-github.ps1 -Message "<one-line summary>"`
  Audits (clean install without scripts, tests, package, secret scan, changelog check), opens a
  branch and pull request, waits for both test jobs and SonarCloud, and squash-merges only if
  everything is green. If anything is red it stops and leaves the PR open. Add
  `-Trailer "Co-Authored-By: ..."` for the commit trailer.
  **README first (hive REQ-ROOT-DOC-001):** before running it, read `README.md` against the
  change. If anything a user sees or sets changed (feature, command, setting, default, install
  step, limit), update the README in the same change. If nothing needs to change, pass
  `-ReadmeUnchanged "<why>"`; the audit refuses a push that neither touches `README.md` nor
  carries that attestation. A release is never cut from a commit that skipped this.
- **"release to the marketplace"**: `powershell -File scripts\release-to-marketplace.ps1`
  Needs a clean, current, green `main` and a version that is not yet tagged or published. Tags
  `v<version>` (CI builds the GitHub Release), then publishes that exact `.vsix` with `az login`.

Both read machine settings (git dir, token file, personal strings to refuse) from
`scripts/local.ps1`, which is git-ignored; see `scripts/local.example.ps1`. A release always
follows a push: bump `version` and add its `CHANGELOG.md` section in the change you push.

## Rule: Sonar must pass before code lands on `main`

SonarCloud (project `Hiventiq_byok_vsc`, free for this public repo) runs on every push and
pull request. Its **Quality Gate must be green before anything reaches `main`**, and before
any tag, GitHub Release or Marketplace publish.

Sonar scans after a push, so it cannot block a push by itself. It can gate a pull request,
so the working rule is:

1. **Work on a branch**, never straight on `main`: `fix/...`, `feat/...`.
2. **Run the local checks first**: `npm ci --ignore-scripts`, `npm test`, `npm run package`.
3. **Push the branch and open a pull request.** Wait for all checks: both `Test` jobs and
   `SonarCloud Code Analysis`.
4. **Merge only when every check is green.** If Sonar fails, fix it on the branch; do not
   merge, and do not dismiss or bypass the gate.
5. **Never tag, release or publish while `main` is red.** Confirm the gate on `main` after
   the merge. If it is red anyway, fix forward before doing anything else.

Reading the result without a browser (public, no login):

    https://sonarcloud.io/api/qualitygates/project_status?projectKey=Hiventiq_byok_vsc
    https://sonarcloud.io/api/issues/search?componentKeys=Hiventiq_byok_vsc&resolved=false

### Patterns Sonar has already flagged here (avoid them)

- Workflows: `npm ci` must be `npm ci --ignore-scripts` (S6505).
- A promise that is not awaited must end with `.catch(...)` or be marked `void` (S9383);
  background refreshes in `extension.js` use `void refresh()` and `refresh` never rejects.
- Do not use an object literal as a default parameter; use a named, frozen constant (S7737).
- A function must not be written so every branch returns the same value (S3516); prefer
  returning a new value over mutating and returning the argument.

## Code layout (keep it)

`src/core` pure logic, no I/O. `src/data` files and HTTP. `src/services` business logic, one
provider per tool in `src/services/providers`. `src/ui` VS Code views. `src/extension.js`
wiring only. Business logic and pure helpers are never mixed in one function. Tests are in
`test/`, run with `npm test` (51 at the time of writing, all must pass).

## Releasing

See "Releasing" in `README.md`. Bump `version` and add a `## <version>` section to
`CHANGELOG.md`; the version tag, `package.json` and the changelog must agree.

## Security

Logins never leave the machine and must never be logged, committed or put in a test fixture:
test data uses fake `@x.com` addresses and fake tokens only. Do not add telemetry or any
network call beyond the Anthropic and OpenAI endpoints already used.
