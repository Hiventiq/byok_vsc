"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createClaudeFiles } = require("../src/data/claudeFiles");
const { createVault } = require("../src/data/vault");
const { createAccountService } = require("../src/services/accountService");
const { createClaudeProvider } = require("../src/services/providers/claudeProvider");
const labels = require("../src/core/labels");

const NOW = 1_000_000;
const creds = (token) => ({ claudeAiOauth: { accessToken: token, refreshToken: `r-${token}`, expiresAt: NOW + 3_600_000, subscriptionType: "max" } });
const config = (email, org, orgName, account = "acct-1") => ({
  oauthAccount: { emailAddress: email, organizationUuid: org, organizationName: orgName, accountUuid: account },
});
const memento = () => { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), update: async (k, v) => void m.set(k, v) }; };
const secrets = () => { const m = new Map(); return { get: async (k) => m.get(k), store: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) }; };

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hbd-"));
  fs.mkdirSync(path.join(home, ".claude"));
  const files = createClaudeFiles({ home, backupDir: path.join(home, "bk"), now: () => NOW });
  const api = {
    fetchProfile: async () => ({ email: "", status: 200 }),
    fetchUsage: async (token) => ({ usage: { session_pct: token === "tokA" ? 10 : 20, weekly_pct: 1, session_resets_at: null, weekly_resets_at: null }, status: 200 }),
    refresh: async () => ({ error: "x", permanent: false }),
  };
  const vault = createVault({ secrets: secrets(), state: memento() });
  const service = createAccountService({ provider: createClaudeProvider({ files, api }), vault, now: () => NOW });
  const login = (token, cfg) => { files.writeCreds(creds(token)); files.writeConfig(cfg); };
  return { files, vault, service, login };
}

const personal = config("me@x.com", "org-personal-1111", "Me Personal");
const team = config("me@x.com", "org-team-2222", "Acme Team");

test("two logins with the same email are saved as two accounts, not one overwriting the other", async () => {
  const { service, vault, login } = setup();
  login("tokA", personal);
  const first = await service.saveCurrent();
  login("tokB", team);
  const second = await service.saveCurrent();
  assert.strictEqual(first.id, "me@x.com");
  assert.match(second.id, /^me@x\.com#[0-9a-f]{6}$/);
  assert.strictEqual(vault.list().length, 2);
  assert.strictEqual((await vault.get(first.id)).creds.claudeAiOauth.accessToken, "tokA");
  assert.strictEqual((await vault.get(second.id)).creds.claudeAiOauth.accessToken, "tokB");
});

test("list marks which of the two is live, flags both as duplicates, and tells them apart by organization", async () => {
  const { service, login } = setup();
  login("tokA", personal);
  await service.saveCurrent();
  login("tokB", team);
  await service.saveCurrent();
  const rows = await service.list();
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.duplicate && r.stored));
  const live = rows.find((r) => r.active);
  assert.strictEqual(live.detail, "Acme Team");
  assert.strictEqual(labels.displayName(live), "me@x.com (Acme Team)");
  assert.strictEqual(labels.displayName(rows.find((r) => !r.active)), "me@x.com (Me Personal)");
  assert.notStrictEqual(rows[0].key, rows[1].key);
});

test("switching between same-email accounts swaps the credentials and the identity block", async () => {
  const { service, files, login } = setup();
  login("tokA", personal);
  const a = await service.saveCurrent();
  login("tokB", team);
  const b = await service.saveCurrent();
  assert.deepStrictEqual(await service.switchTo(a.id), { changed: true });
  assert.strictEqual(files.readCreds().claudeAiOauth.accessToken, "tokA");
  assert.strictEqual(files.readConfig().oauthAccount.organizationName, "Me Personal");
  assert.deepStrictEqual(await service.switchTo(a.id), { changed: false });
  await service.switchTo(b.id);
  assert.strictEqual(files.readConfig().oauthAccount.organizationName, "Acme Team");
  assert.strictEqual((await service.list()).find((r) => r.active).id, b.id);
});

test("re-saving the same login does not create a third account", async () => {
  const { service, vault, login } = setup();
  login("tokA", personal);
  await service.saveCurrent();
  login("tokA2", personal); // same account, rotated token
  await service.saveCurrent();
  assert.strictEqual(vault.list().length, 1);
});

test("a single account is not flagged as a duplicate and keeps the plain email", async () => {
  const { service, login } = setup();
  login("tokA", personal);
  await service.saveCurrent();
  const [row] = await service.list();
  assert.strictEqual(row.duplicate, false);
  assert.strictEqual(labels.displayName(row), "me@x.com");
});

test("a legacy saved record (no stored discriminator) is still matched, and a different org splits off", async () => {
  const { service, vault, login } = setup();
  await vault.put("me@x.com", { email: "me@x.com", creds: creds("tokA"), snapshot: personal.oauthAccount, subscription: "max" });
  vault.list().forEach((meta) => delete meta.discriminator); // what a record saved before this feature looks like
  assert.ok(vault.list().every((m) => m.discriminator === undefined));
  login("tokA", personal);
  assert.strictEqual((await service.list()).find((r) => r.active).id, "me@x.com");
  login("tokB", team);
  const rows = await service.list();
  assert.strictEqual(rows.length, 2); // the saved personal one plus the unsaved live team one
  assert.strictEqual(rows.find((r) => r.active).stored, false);
});

test("same email but a different account id under the same org is also kept apart", async () => {
  const { service, vault, login } = setup();
  login("tokA", config("me@x.com", "org-1", "Org", "acct-1"));
  await service.saveCurrent();
  login("tokB", config("me@x.com", "org-1", "Org", "acct-2"));
  await service.saveCurrent();
  assert.strictEqual(vault.list().length, 2);
});
