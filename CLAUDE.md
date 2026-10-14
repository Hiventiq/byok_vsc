# CLAUDE.md

Guidance for working in this repo: BYOK for VS Code (Claude Code and Codex account
switcher). See `README.md` for what it does and how to release.

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
