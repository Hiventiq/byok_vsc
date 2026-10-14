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

const NOW = 1_000_000;
const creds = (token, extra = {}) => ({
  claudeAiOauth: { accessToken: token, refreshToken: `r-${token}`, expiresAt: NOW + 3_600_000, subscriptionType: "max", ...extra },
});
const config = (email) => ({ theme: "dark", oauthAccount: { emailAddress: email, organizationName: `org-${email}` } });

function memento() {
  const map = new Map();
  return { get: (k, d) => (map.has(k) ? map.get(k) : d), update: async (k, v) => void map.set(k, v) };
}
function secrets() {
  const map = new Map();
  return { get: async (k) => map.get(k), store: async (k, v) => void map.set(k, v), delete: async (k) => void map.delete(k) };
}

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hb-"));
  fs.mkdirSync(path.join(home, ".claude"));
  const files = createClaudeFiles({ home, backupDir: path.join(home, "bk"), now: () => NOW });
  const usageByToken = { tok1: 10, tok2: 20 };
  const calls = { refresh: 0 };
  const api = {
    fetchProfile: async () => ({ email: "", status: 200 }),
    fetchUsage: async (token) => ({
      usage: { session_pct: usageByToken[token] ?? 0, weekly_pct: 1, session_resets_at: null, weekly_resets_at: null }, status: 200,
    }),
    refresh: async (c) => { calls.refresh++; return { creds: creds("refreshed") }; },
  };
  const vault = createVault({ secrets: secrets(), state: memento() });
  const service = createAccountService({ provider: createClaudeProvider({ files, api }), vault, now: () => NOW });
  const login = (token, email) => { files.writeCreds(creds(token)); files.writeConfig(config(email)); };
  return { home, files, api, vault, service, login, calls };
}

test("saveCurrent stashes the live login under its email", async () => {
  const { service, vault, login } = setup();
  login("tok1", "A@x.com");
  assert.deepStrictEqual(await service.saveCurrent(), { id: "a@x.com", email: "a@x.com" });
  assert.strictEqual((await vault.get("a@x.com")).creds.claudeAiOauth.accessToken, "tok1");
});

test("saveCurrent with no login or unknown email fails clearly", async () => {
  const { service, files } = setup();
  await assert.rejects(service.saveCurrent(), /No Claude login/);
  files.writeCreds(creds("tok1"));
  await assert.rejects(service.saveCurrent(), /Cannot tell which account/);
});

test("switchTo swaps credentials and identity, stashes the one it leaves, and backs up", async () => {
  const { service, files, vault, login } = setup();
  login("tok2", "b@x.com");
  await service.saveCurrent();
  login("tok1", "a@x.com"); // live is now A, unsaved
  const out = await service.switchTo("b@x.com");
  assert.strictEqual(out.changed, true);
  assert.strictEqual(files.readCreds().claudeAiOauth.accessToken, "tok2");
  assert.strictEqual(files.readConfig().oauthAccount.emailAddress, "b@x.com");
  assert.strictEqual(files.readConfig().theme, "dark"); // other config keys untouched
  assert.strictEqual((await vault.get("a@x.com")).creds.claudeAiOauth.accessToken, "tok1");
  assert.ok(fs.readdirSync(path.join(files.credsPath, "..", "..", "bk")).length >= 1);
});

test("switchTo the already-live account is a no-op", async () => {
  const { service, login } = setup();
  login("tok1", "a@x.com");
  await service.saveCurrent();
  assert.deepStrictEqual(await service.switchTo("a@x.com"), { changed: false });
});

test("switchTo refuses to overwrite a login it cannot identify", async () => {
  const { service, files, login } = setup();
  login("tok2", "b@x.com");
  await service.saveCurrent();
  fs.rmSync(files.configPath);
  files.writeCreds(creds("mystery"));
  await assert.rejects(service.switchTo("b@x.com"), /Cannot tell which account/);
  assert.strictEqual(files.readCreds().claudeAiOauth.accessToken, "mystery");
});

test("list reports usage, marks the active account, and syncs rotated live tokens", async () => {
  const { service, vault, login, files } = setup();
  login("tok1", "a@x.com");
  await service.saveCurrent();
  files.writeCreds(creds("tok1", { accessToken: "tok1", refreshToken: "rotated" }));
  const rows = await service.list();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].active, true);
  assert.strictEqual(rows[0].session_pct, 10);
  assert.strictEqual((await vault.get("a@x.com")).creds.claudeAiOauth.refreshToken, "rotated");
});

test("list refreshes an expired STASHED account, never the live one", async () => {
  const { service, vault, login, files, calls } = setup();
  login("tok2", "b@x.com");
  await service.saveCurrent();
  const stored = await vault.get("b@x.com");
  stored.creds.claudeAiOauth.expiresAt = 0;
  await vault.put("b@x.com", stored);
  login("tok1", "a@x.com");
  await service.saveCurrent();
  files.writeCreds(creds("tok1", { expiresAt: 0 })); // live token expired: CLI's job
  await service.list();
  assert.strictEqual(calls.refresh, 1);
  assert.strictEqual((await vault.get("b@x.com")).creds.claudeAiOauth.accessToken, "refreshed");
});

test("list shows an unsaved live login as stored:false", async () => {
  const { service, login } = setup();
  login("tok1", "a@x.com");
  const rows = await service.list();
  assert.deepStrictEqual([rows[0].stored, rows[0].active], [false, true]);
});

test("a 429 keeps the last good reading (marked stale) and backs off instead of retrying", async () => {
  const { home, files, vault, login } = setup();
  let clock = NOW;
  let fetches = 0;
  let limited = false;
  const api = {
    fetchProfile: async () => ({ email: "", status: 200 }),
    fetchUsage: async () => {
      fetches++;
      return limited
        ? { usage_error: "HTTP 429", status: 429, retryAfterMs: 0 }
        : { usage: { session_pct: 33, weekly_pct: 4, session_resets_at: null, weekly_resets_at: null }, status: 200 };
    },
    refresh: async () => ({ error: "x", permanent: false }),
  };
  const service = createAccountService({ provider: createClaudeProvider({ files, api }), vault, now: () => clock });
  login("tok1", "a@x.com");
  assert.strictEqual((await service.list())[0].session_pct, 33);
  limited = true;
  clock += 5 * 60 * 1000; // cache expired
  const [row] = await service.list();
  assert.strictEqual(row.session_pct, 33);
  assert.ok(row.stale_at);
  const before = fetches;
  clock += 30 * 1000;
  await service.list({ force: true }); // forced, but still inside the backoff window
  assert.strictEqual(fetches, before);
  assert.ok(home);
});

test("a 429 with no earlier reading says so instead of showing nothing", async () => {
  const { files, vault, login } = setup();
  const api = {
    fetchProfile: async () => ({ email: "", status: 200 }),
    fetchUsage: async () => ({ usage_error: "HTTP 429", status: 429, retryAfterMs: 0 }),
    refresh: async () => ({ error: "x", permanent: false }),
  };
  const service = createAccountService({ provider: createClaudeProvider({ files, api }), vault, now: () => NOW });
  login("tok1", "a@x.com");
  const [row] = await service.list();
  assert.strictEqual(row.session_pct, undefined);
  assert.match(row.usage_error, /429/);
  assert.strictEqual(row.needs_reauth, false);
});

test("backoff follows Retry-After, reports when to retry, and clears afterwards", async () => {
  const { files, vault, login } = setup();
  let clock = NOW;
  const api = {
    fetchProfile: async () => ({ email: "", status: 200 }),
    fetchUsage: async () => ({ usage_error: "HTTP 429", status: 429, retryAfterMs: 34000 }),
    refresh: async () => ({ error: "x", permanent: false }),
  };
  const service = createAccountService({ provider: createClaudeProvider({ files, api }), vault, now: () => clock });
  login("tok1", "a@x.com");
  assert.strictEqual(service.nextRetryInMs(), null);
  await service.list();
  assert.strictEqual(service.nextRetryInMs(), 34000);
  clock += 35000;
  assert.strictEqual(service.nextRetryInMs(), null);
});
