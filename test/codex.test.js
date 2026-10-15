"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { decodeJwtPayload } = require("../src/core/jwt");
const codexIdentity = require("../src/core/codexIdentity");
const { parseCodexUsage } = require("../src/core/usageParse");
const { createCodexFiles } = require("../src/data/codexFiles");
const { createOpenaiApi } = require("../src/data/openaiApi");
const { createVault } = require("../src/data/vault");
const { createAccountService } = require("../src/services/accountService");
const { createCodexProvider } = require("../src/services/providers/codexProvider");

const NOW = 1_700_000_000_000;
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (claims) => `${b64({ alg: "none" })}.${b64(claims)}.sig`;
const AUTH = "https://api.openai.com/auth";

const creds = (email, { exp = NOW / 1000 + 3600, plan = "pro", accountId, refresh = `r-${email}` } = {}) => ({
  tokens: {
    id_token: jwt({ email, [AUTH]: { chatgpt_plan_type: plan } }),
    access_token: jwt({ exp, [AUTH]: { chatgpt_account_id: `acct-${email}` } }),
    refresh_token: refresh,
    ...(accountId ? { account_id: accountId } : {}),
  },
  last_refresh: "2026-01-01T00:00:00.000Z",
});

test("jwt: decodes claims, rejects junk", () => {
  assert.deepStrictEqual(decodeJwtPayload(jwt({ a: 1 })), { a: 1 });
  for (const bad of [undefined, "", "a.b", "a.!!!.c", 5]) assert.strictEqual(decodeJwtPayload(bad), null);
});

test("codexIdentity: email, plan, account id, expiry, refresh merge", () => {
  const c = creds(" Me@X.com ");
  assert.strictEqual(codexIdentity.emailOf(c), "me@x.com");
  assert.strictEqual(codexIdentity.subscriptionOf(c), "ChatGPT Pro");
  assert.strictEqual(codexIdentity.accountIdOf(c), "acct- Me@X.com ");
  assert.strictEqual(codexIdentity.accountIdOf(creds("a@x.com", { accountId: "explicit" })), "explicit");
  assert.strictEqual(codexIdentity.isExpired(c, NOW), false);
  assert.strictEqual(codexIdentity.isExpired(creds("a@x.com", { exp: NOW / 1000 - 5 }), NOW), true);
  assert.strictEqual(codexIdentity.isExpired({ tokens: {} }, NOW), false);
  const fresh = codexIdentity.withRefreshed(c, { access_token: "new-a", refresh_token: "new-r" }, NOW);
  assert.deepStrictEqual([fresh.tokens.access_token, fresh.tokens.refresh_token], ["new-a", "new-r"]);
  assert.strictEqual(fresh.tokens.id_token, c.tokens.id_token); // untouched when not returned
  assert.strictEqual(fresh.last_refresh, new Date(NOW).toISOString());
  assert.strictEqual(codexIdentity.emailOf({}), "");
});

test("parseCodexUsage maps primary to 5h and secondary to weekly, reset as ISO", () => {
  const u = parseCodexUsage({ rate_limit: { primary_window: { used_percent: 12, reset_at: 1_700_000_000 }, secondary_window: { used_percent: 55 } } });
  assert.deepStrictEqual([u.session_pct, u.weekly_pct], [12, 55]);
  assert.strictEqual(u.session_resets_at, new Date(1_700_000_000_000).toISOString());
  assert.strictEqual(u.weekly_resets_at, null);
  assert.strictEqual(parseCodexUsage(null).session_pct, null);
});

function memento() {
  const map = new Map();
  return { get: (k, d) => (map.has(k) ? map.get(k) : d), update: async (k, v) => void map.set(k, v) };
}
function secrets() {
  const map = new Map();
  return { get: async (k) => map.get(k), store: async (k, v) => void map.set(k, v), delete: async (k) => void map.delete(k) };
}

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hbx-"));
  const files = createCodexFiles({ home, backupDir: path.join(home, "bk"), now: () => NOW });
  const calls = { refresh: 0 };
  const api = {
    fetchUsage: async (c) => ({
      usage: { session_pct: codexIdentity.emailOf(c) === "a@x.com" ? 10 : 20, weekly_pct: 1, session_resets_at: null, weekly_resets_at: null }, status: 200,
    }),
    refresh: async () => { calls.refresh++; return { creds: creds("b@x.com", { refresh: "rotated" }) }; },
  };
  const vault = createVault({ secrets: secrets(), state: memento(), indexKey: "codex.index", secretPrefix: "codex." });
  const service = createAccountService({ provider: createCodexProvider({ files, api }), vault, now: () => NOW });
  return { home, files, vault, service, calls, login: (email, opts) => files.writeCreds(creds(email, opts)) };
}

test("codex service: list marks the live account, tags provider and key, shows usage", async () => {
  const { service, login } = setup();
  login("a@x.com");
  const [row] = await service.list();
  assert.deepStrictEqual(
    [row.provider, row.key, row.email, row.active, row.stored, row.session_pct, row.subscription],
    ["codex", "codex:a@x.com", "a@x.com", true, false, 10, "ChatGPT Pro"],
  );
});

test("codex service: save, switch writes auth.json, stashes the one it leaves, backs up", async () => {
  const { home, service, files, vault, login } = setup();
  login("b@x.com");
  await service.saveCurrent();
  login("a@x.com"); // live is A, unsaved
  assert.deepStrictEqual(await service.switchTo("b@x.com"), { changed: true });
  assert.strictEqual(codexIdentity.emailOf(files.readCreds()), "b@x.com");
  assert.ok(await vault.get("a@x.com"));
  assert.ok(fs.readdirSync(path.join(home, "bk", "codex")).length >= 1);
  assert.deepStrictEqual(await service.switchTo("b@x.com"), { changed: false });
});

test("codex service: no login and API-key-only login are reported as no login", async () => {
  const { service, files } = setup();
  await assert.rejects(service.saveCurrent(), (err) => err.code === "no_login" && /No Codex login/.test(err.message));
  files.writeCreds({ OPENAI_API_KEY: "sk-xxx" });
  await assert.rejects(service.saveCurrent(), (err) => err.code === "no_login");
});

test("codex service: an expired STASHED token is refreshed and the rotated token stored; live is not", async () => {
  const { service, vault, login, calls } = setup();
  login("b@x.com", { exp: NOW / 1000 - 100 });
  await service.saveCurrent();
  login("a@x.com", { exp: NOW / 1000 - 100 }); // live and expired: the CLI's job, not ours
  await service.list();
  assert.strictEqual(calls.refresh, 1);
  assert.strictEqual((await vault.get("b@x.com")).creds.tokens.refresh_token, "rotated");
});

test("codex service: a permanent refresh failure flags needs_reauth", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hbx-"));
  const files = createCodexFiles({ home, backupDir: path.join(home, "bk"), now: () => NOW });
  const api = { fetchUsage: async () => ({ usage: {}, status: 200 }), refresh: async () => ({ error: "HTTP 400", permanent: true }) };
  const vault = createVault({ secrets: secrets(), state: memento(), indexKey: "i", secretPrefix: "s." });
  const service = createAccountService({ provider: createCodexProvider({ files, api }), vault, now: () => NOW });
  files.writeCreds(creds("b@x.com", { exp: NOW / 1000 - 100 }));
  await service.saveCurrent();
  files.writeCreds(creds("a@x.com"));
  const rows = await service.list();
  assert.strictEqual(rows.find((r) => r.id === "b@x.com").needs_reauth, true);
});

test("openaiApi: usage sends the account id header; refresh never returns tokens on failure", async () => {
  const seen = {};
  const fetchImpl = async (url, init) => {
    seen.url = url; seen.headers = init.headers;
    if (url.includes("oauth/token")) return { ok: false, status: 400, text: async () => '{"error":"refresh_token_reused"}' };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ rate_limit: { primary_window: { used_percent: 7 } } }) };
  };
  const api = createOpenaiApi({ fetchImpl, now: () => NOW });
  const usage = await api.fetchUsage(creds("a@x.com"));
  assert.strictEqual(usage.usage.session_pct, 7);
  assert.strictEqual(seen.headers["ChatGPT-Account-Id"], "acct-a@x.com");
  const out = await api.refresh(creds("a@x.com"));
  assert.deepStrictEqual(out, { error: "HTTP 400", permanent: true });
  assert.deepStrictEqual(await api.refresh({ tokens: {} }), { error: "no refresh token", permanent: true });
});

test("parseCodexUsage classifies windows by length, so a weekly-only plan is not shown as 5h", () => {
  const weeklyOnly = parseCodexUsage({ rate_limit: { primary_window: { used_percent: 59, limit_window_seconds: 604800, reset_at: 1_700_000_000 }, secondary_window: null } });
  assert.deepStrictEqual([weeklyOnly.session_pct, weeklyOnly.weekly_pct], [null, 59]);
  assert.strictEqual(weeklyOnly.weekly_resets_at, new Date(1_700_000_000_000).toISOString());
  const both = parseCodexUsage({ rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 18000 }, secondary_window: { used_percent: 9, limit_window_seconds: 604800 } } });
  assert.deepStrictEqual([both.session_pct, both.weekly_pct], [5, 9]);
});

test("parseCodexUsage keeps both windows when they fall in one length class", () => {
  const short = { used_percent: 10, limit_window_seconds: 18000, reset_at: 1_700_000_100 };
  const shorter = { used_percent: 20, limit_window_seconds: 3600, reset_at: 1_700_000_200 };
  const both = parseCodexUsage({ rate_limit: { primary_window: short, secondary_window: shorter } });
  assert.strictEqual(both.session_pct, 10);
  assert.strictEqual(both.weekly_pct, 20);

  const long1 = { used_percent: 30, limit_window_seconds: 604800, reset_at: 1_700_000_300 };
  const long2 = { used_percent: 40, limit_window_seconds: 1209600, reset_at: 1_700_000_400 };
  const longs = parseCodexUsage({ rate_limit: { primary_window: long1, secondary_window: long2 } });
  assert.strictEqual(longs.weekly_pct, 30);
  assert.strictEqual(longs.session_pct, 40);
});
