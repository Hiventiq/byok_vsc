"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const rules = require("../src/core/sharedAccounts");
const { createSharedStore } = require("../src/data/sharedStore");
const { createClaudeFiles } = require("../src/data/claudeFiles");
const { createVault } = require("../src/data/vault");
const { createAccountService } = require("../src/services/accountService");
const { createClaudeProvider } = require("../src/services/providers/claudeProvider");

const NOW = 1_000_000;
const creds = (token, extra = {}) => ({
  claudeAiOauth: { accessToken: token, refreshToken: `r-${token}`, expiresAt: NOW + 36_000_000, subscriptionType: "max", ...extra },
});
const config = (email) => ({ oauthAccount: { emailAddress: email, organizationName: `org-${email}` } });
const memento = () => { const m = new Map(); return { get: (k, d) => (m.has(k) ? m.get(k) : d), update: async (k, v) => void m.set(k, v) }; };
const secrets = () => { const m = new Map(); return { get: async (k) => m.get(k), store: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) }; };
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function setup(sharedDir) {
  const home = tmp("hbs-");
  fs.mkdirSync(path.join(home, ".claude"));
  const files = createClaudeFiles({ home, backupDir: path.join(home, "bk"), now: () => NOW });
  const calls = { refresh: 0 };
  const api = {
    fetchProfile: async () => ({ email: "", status: 200 }),
    fetchUsage: async () => ({ usage: { session_pct: 1, weekly_pct: 1 }, status: 200 }),
    refresh: async () => { calls.refresh++; return { creds: creds("refreshed", { expiresAt: NOW + 72_000_000 }) }; },
  };
  const vault = createVault({ secrets: secrets(), state: memento() });
  const shared = createSharedStore({ dir: sharedDir, now: () => NOW, env: {}, platform: "linux", pid: 1 });
  const service = createAccountService({ provider: createClaudeProvider({ files, api }), vault, now: () => NOW, shared });
  const login = (token, email) => { files.writeCreds(creds(token)); files.writeConfig(config(email)); };
  return { files, vault, service, shared, login, calls };
}

// What another tool (byok) would put in the folder.
const otherTool = (dir) => createSharedStore({ dir, now: () => NOW, env: {}, platform: "linux", pid: 2 });
const recordFor = (id, c) => rules.accountRecord({ provider: "claude-code", id, email: id, subscription: "max", creds: c, snapshot: null }, NOW, "byok");

test("rules: default dir, file names, newer-rotation and heartbeat freshness", () => {
  assert.match(rules.defaultDir({ LOCALAPPDATA: "C:\\L" }, "win32", "/h"), /Hiventiq[\\/]byok[\\/]accounts$/);
  assert.match(rules.defaultDir({}, "linux", "/h"), /\.local[\\/]share[\\/]hiventiq[\\/]byok[\\/]accounts$/);
  assert.strictEqual(rules.fileNameFor("A@x.com#1f2e"), "a@x.com_1f2e");
  const at = (ms) => ({ claudeAiOauth: { expiresAt: ms } });
  const expiresAtOf = (c) => c.claudeAiOauth.expiresAt;
  assert.strictEqual(rules.fileIsNewer(at(20), at(10), expiresAtOf), true);
  assert.strictEqual(rules.fileIsNewer(at(10), at(10), expiresAtOf), false);
  assert.strictEqual(rules.fileIsNewer(at(10), at(20), expiresAtOf), false);
  assert.strictEqual(rules.fileIsNewer({ claudeAiOauth: {} }, at(20), expiresAtOf), false);
  assert.strictEqual(rules.heartbeatIsFresh(rules.heartbeat(NOW, 7), NOW + 60_000), true);
  assert.strictEqual(rules.heartbeatIsFresh(rules.heartbeat(NOW, 7), NOW + 11 * 60_000), false);
  assert.strictEqual(rules.heartbeatIsFresh(null, NOW), false);
});

test("saving a login writes it to the shared folder, and listing writes the heartbeat", async () => {
  const ctx = setup(tmp("hbs-shared-"));
  ctx.login("tok1", "a@x.com");
  await ctx.service.saveCurrent();
  const [record] = ctx.shared.readAll("claude-code");
  assert.strictEqual(record.account, "a@x.com");
  assert.strictEqual(record.creds.claudeAiOauth.accessToken, "tok1");
  assert.strictEqual(record.updated_by, "vscode");
  await ctx.service.list();
  assert.deepStrictEqual(ctx.shared.readHeartbeat(), { owner: "vscode", at: NOW, pid: 1 });
});

test("a login another tool put in the folder appears in the list without a sign-in", async () => {
  const dir = tmp("hbs-shared-");
  const ctx = setup(dir);
  ctx.login("tok1", "a@x.com");
  await ctx.service.saveCurrent();
  otherTool(dir).write("claude-code", recordFor("k@x.com", creds("tokK")));
  const rows = await ctx.service.list();
  assert.deepStrictEqual(rows.map((r) => r.email).sort(), ["a@x.com", "k@x.com"]);
  assert.strictEqual((await ctx.vault.get("k@x.com")).creds.claudeAiOauth.accessToken, "tokK");
});

test("a newer rotation in the folder replaces the vault copy; an older one is ignored", async () => {
  const dir = tmp("hbs-shared-");
  const ctx = setup(dir);
  ctx.login("tok2", "b@x.com");
  await ctx.service.saveCurrent();
  ctx.login("tok1", "a@x.com");
  await ctx.service.saveCurrent();
  const other = otherTool(dir);
  other.write("claude-code", recordFor("b@x.com", creds("older", { expiresAt: NOW + 1000 })));
  await ctx.service.list();
  assert.strictEqual((await ctx.vault.get("b@x.com")).creds.claudeAiOauth.accessToken, "tok2");
  other.write("claude-code", recordFor("b@x.com", creds("newer", { expiresAt: NOW + 99_000_000 })));
  await ctx.service.list();
  assert.strictEqual((await ctx.vault.get("b@x.com")).creds.claudeAiOauth.accessToken, "newer");
});

test("a rotated token is written to the folder; removing an account leaves a tombstone", async () => {
  const ctx = setup(tmp("hbs-shared-"));
  ctx.login("tok2", "b@x.com");
  await ctx.service.saveCurrent();
  const rec = await ctx.vault.get("b@x.com");
  rec.creds.claudeAiOauth.expiresAt = 0;
  await ctx.vault.put("b@x.com", rec);
  ctx.shared.write("claude-code", recordFor("b@x.com", rec.creds)); // the folder holds the same stale token
  ctx.login("tok1", "a@x.com");
  await ctx.service.saveCurrent();
  await ctx.service.list();
  assert.strictEqual(ctx.calls.refresh, 1);
  const file = ctx.shared.readAll("claude-code").find((r) => r.account === "b@x.com");
  assert.strictEqual(file.creds.claudeAiOauth.accessToken, "refreshed");
  await ctx.service.remove("b@x.com");
  const stone = ctx.shared.readAll("claude-code").find((r) => r.account === "b@x.com");
  assert.strictEqual(stone.deleted, true);
  assert.strictEqual(stone.expires_at, NOW + 72_000_000);
});

test("a tombstone from the other tool removes the vault copy, unless a later sign-in revived it", async () => {
  const dir = tmp("hbs-shared-");
  const ctx = setup(dir);
  ctx.login("tok2", "b@x.com");
  await ctx.service.saveCurrent();
  ctx.login("tok1", "a@x.com");
  await ctx.service.saveCurrent();
  const other = otherTool(dir);
  other.write("claude-code", rules.tombstone({ provider: "claude-code", id: "b@x.com", email: "b@x.com", expiresAt: NOW + 36_000_000 }, NOW, "byok"));
  await ctx.service.list();
  assert.strictEqual(ctx.vault.has("b@x.com"), false);
  ctx.login("tok3", "b@x.com");
  ctx.files.writeCreds(creds("tok3", { expiresAt: NOW + 99_000_000 })); // signed in again, later token
  await ctx.service.saveCurrent();
  await ctx.service.list();
  assert.strictEqual(ctx.vault.has("b@x.com"), true);
  assert.strictEqual(ctx.shared.readAll("claude-code").find((r) => r.account === "b@x.com").deleted, undefined);
});

test("a fresh usage reading in the folder is shown without a call; ours is written back", async () => {
  const dir = tmp("hbs-shared-");
  const ctx = setup(dir);
  ctx.login("tok2", "b@x.com");
  await ctx.service.saveCurrent();
  ctx.login("tok1", "a@x.com");
  await ctx.service.saveCurrent();
  let calls = 0;
  const api = { fetchUsage: async () => { calls++; return { usage: { session_pct: 7, weekly_pct: 1 }, status: 200 }; } };
  ctx.service.provider.fetchUsage = api.fetchUsage;
  const other = otherTool(dir);
  other.writeUsage("claude-code", "b@x.com", { session_pct: 42, weekly_pct: 3 }, NOW - 30_000);
  const rows = await ctx.service.list();
  assert.strictEqual(rows.find((r) => r.email === "b@x.com").session_pct, 42); // byok's reading, no call
  assert.strictEqual(rows.find((r) => r.email === "a@x.com").session_pct, 7);
  assert.strictEqual(calls, 1);
  assert.strictEqual(ctx.shared.read("claude-code", "a@x.com").usage.session_pct, 7); // ours shared
  assert.strictEqual(ctx.shared.read("claude-code", "a@x.com").creds.claudeAiOauth.accessToken, "tok1");
});

test("on a 429 with no reading of our own, the folder's older reading is shown as stale", async () => {
  const dir = tmp("hbs-shared-");
  const ctx = setup(dir);
  ctx.login("tok1", "a@x.com");
  await ctx.service.saveCurrent();
  ctx.service.provider.fetchUsage = async () => ({ usage_error: "HTTP 429", status: 429, retryAfterMs: 0 });
  otherTool(dir).writeUsage("claude-code", "a@x.com", { session_pct: 11, weekly_pct: 2 }, NOW - 60 * 60_000);
  const [row] = await ctx.service.list();
  assert.strictEqual(row.session_pct, 11);
  assert.strictEqual(row.stale_at, NOW - 60 * 60_000);
  assert.match(row.usage_error, /HTTP 429/);
});

test("a corrupt file in the folder is skipped, not fatal", async () => {
  const dir = tmp("hbs-shared-");
  const ctx = setup(dir);
  fs.mkdirSync(path.join(dir, "claude-code"), { recursive: true });
  fs.writeFileSync(path.join(dir, "claude-code", "bad.json"), "{not json");
  fs.writeFileSync(path.join(dir, "claude-code", "wrong.json"), JSON.stringify({ hello: 1 }));
  ctx.login("tok1", "a@x.com");
  assert.strictEqual((await ctx.service.list()).length, 1);
});

test("without a shared store the service behaves as before", async () => {
  const home = tmp("hbs-");
  fs.mkdirSync(path.join(home, ".claude"));
  const files = createClaudeFiles({ home, backupDir: path.join(home, "bk"), now: () => NOW });
  const api = { fetchProfile: async () => ({ email: "" }), fetchUsage: async () => ({ usage: {}, status: 200 }), refresh: async () => ({}) };
  const service = createAccountService({ provider: createClaudeProvider({ files, api }), vault: createVault({ secrets: secrets(), state: memento() }), now: () => NOW });
  files.writeCreds(creds("tok1")); files.writeConfig(config("a@x.com"));
  await service.saveCurrent();
  assert.strictEqual((await service.list()).length, 1);
});
