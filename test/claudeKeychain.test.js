"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createClaudeKeychain } = require("../src/data/claudeKeychain");
const { createClaudeFiles } = require("../src/data/claudeFiles");
const { createVault } = require("../src/data/vault");
const { createAccountService } = require("../src/services/accountService");
const { createClaudeProvider } = require("../src/services/providers/claudeProvider");

const NOW = 1_000_000;
const SERVICE = "Claude Code-credentials";
const creds = (token) => ({
  claudeAiOauth: { accessToken: token, refreshToken: `r-${token}`, expiresAt: NOW + 36_000_000, subscriptionType: "max" },
});
const config = (email) => ({ theme: "dark", oauthAccount: { emailAddress: email, organizationName: `org-${email}` } });

// Stands in for the macOS `security` tool: entries keyed by service and account, exit 44 when
// missing, the secret accepted only through the interactive mode on stdin.
function fakeSecurity({ dropWrites = false } = Object.freeze({})) {
  const store = new Map();
  const calls = [];
  const key = (service, account) => `${service}\0${account}`;
  const unquote = (s) => s.replace(/\\(.)/g, "$1");
  const execFile = (cmd, args, opts) => {
    calls.push({ args, input: opts.input });
    assert.strictEqual(cmd, "security");
    if (args[0] === "find-generic-password") {
      const k = key(args[2], args[4]);
      if (!store.has(k)) {
        const err = new Error("could not be found in the keychain");
        err.status = 44;
        throw err;
      }
      return `${store.get(k)}\n`;
    }
    assert.deepStrictEqual(args, ["-i"]);
    const m = /^add-generic-password -U -s "((?:[^"\\]|\\.)*)" -a "((?:[^"\\]|\\.)*)" -w "((?:[^"\\]|\\.)*)"\n$/.exec(opts.input);
    assert.ok(m, "interactive command is well formed");
    if (!dropWrites) store.set(key(unquote(m[1]), unquote(m[2])), unquote(m[3]));
    return "";
  };
  return { store, calls, execFile, seed: (data) => store.set(key(SERVICE, "me"), JSON.stringify(data)) };
}

test("keychain: used only on macOS with a known user; never runs the tool otherwise", () => {
  const sec = fakeSecurity();
  sec.seed(creds("tok1"));
  for (const opts of [{ platform: "win32", user: "me" }, { platform: "linux", user: "me" }, { platform: "darwin", user: "" }]) {
    const kc = createClaudeKeychain({ ...opts, execFile: sec.execFile });
    assert.strictEqual(kc.enabled, false);
    assert.strictEqual(kc.read(), null);
  }
  assert.strictEqual(sec.calls.length, 0);
  assert.strictEqual(createClaudeKeychain({ platform: "darwin", user: "me", execFile: sec.execFile }).enabled, true);
});

test("keychain: reads the entry as JSON; a missing or corrupt entry reads as not signed in", () => {
  const sec = fakeSecurity();
  const kc = createClaudeKeychain({ platform: "darwin", user: "me", execFile: sec.execFile });
  assert.strictEqual(kc.read(), null);
  sec.seed(creds("tok1"));
  assert.deepStrictEqual(kc.read(), creds("tok1"));
  assert.deepStrictEqual(sec.calls.at(-1).args, ["find-generic-password", "-s", SERVICE, "-a", "me", "-w"]);
  sec.store.set(`${SERVICE}\0me`, "{not json");
  assert.strictEqual(kc.read(), null);
});

test("keychain: write sends the secret on stdin, never as an argument, and verifies it landed", () => {
  const sec = fakeSecurity();
  const kc = createClaudeKeychain({ platform: "darwin", user: "me", execFile: sec.execFile });
  const data = creds('to"k\\1');
  kc.write(data);
  assert.deepStrictEqual(kc.read(), data);
  for (const call of sec.calls) assert.ok(!call.args.some((a) => a.includes("to")), "token not on the command line");
  assert.match(sec.calls[0].input, /^add-generic-password -U -s "Claude Code-credentials" -a "me" -w "/);

  const broken = fakeSecurity({ dropWrites: true });
  assert.throws(() => createClaudeKeychain({ platform: "darwin", user: "me", execFile: broken.execFile }).write(data), /not written/);
});

test("claudeFiles: the keychain login wins over the file, writes go back to it, backup copies it", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hbk-"));
  fs.mkdirSync(path.join(home, ".claude"));
  const sec = fakeSecurity();
  const keychain = createClaudeKeychain({ platform: "darwin", user: "me", execFile: sec.execFile });
  const files = createClaudeFiles({ home, backupDir: path.join(home, "bk"), keychain, now: () => NOW });

  files.writeCreds(creds("tok0")); // no keychain entry yet: the file is the login
  assert.strictEqual(files.readCreds().claudeAiOauth.accessToken, "tok0");
  assert.ok(fs.existsSync(files.credsPath));

  sec.seed(creds("tok1"));
  assert.strictEqual(files.readCreds().claudeAiOauth.accessToken, "tok1");
  files.writeCreds(creds("tok2"));
  assert.deepStrictEqual(keychain.read(), creds("tok2"));
  assert.strictEqual(JSON.parse(fs.readFileSync(files.credsPath, "utf8")).claudeAiOauth.accessToken, "tok0"); // file untouched

  const copies = files.backup().filter(Boolean);
  const kept = copies.find((p) => path.basename(p).startsWith("credentials.keychain."));
  assert.ok(kept);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(kept, "utf8")), creds("tok2"));
  assert.strictEqual(fs.statSync(kept).mode & 0o777, 0o600);
});

test("claude service on macOS: save and switch go through the keychain", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hbk-"));
  const sec = fakeSecurity();
  const keychain = createClaudeKeychain({ platform: "darwin", user: "me", execFile: sec.execFile });
  const files = createClaudeFiles({ home, backupDir: path.join(home, "bk"), keychain, now: () => NOW });
  const api = {
    fetchProfile: async () => ({ email: "", status: 200 }),
    fetchUsage: async () => ({ usage: { session_pct: 1, weekly_pct: 1, session_resets_at: null, weekly_resets_at: null }, status: 200 }),
    refresh: async () => ({ creds: creds("refreshed") }),
  };
  const memento = new Map();
  const secretsMap = new Map();
  const vault = createVault({
    secrets: { get: async (k) => secretsMap.get(k), store: async (k, v) => void secretsMap.set(k, v), delete: async (k) => void secretsMap.delete(k) },
    state: { get: (k, d) => (memento.has(k) ? memento.get(k) : d), update: async (k, v) => void memento.set(k, v) },
  });
  const service = createAccountService({ provider: createClaudeProvider({ files, api }), vault, now: () => NOW });
  const login = (token, email) => { sec.seed(creds(token)); files.writeConfig(config(email)); };

  await assert.rejects(service.saveCurrent(), (err) => err.code === "no_login");
  login("tok2", "b@x.com");
  assert.deepStrictEqual(await service.saveCurrent(), { id: "b@x.com", email: "b@x.com" });
  login("tok1", "a@x.com");
  assert.deepStrictEqual(await service.switchTo("b@x.com"), { changed: true });
  assert.strictEqual(keychain.read().claudeAiOauth.accessToken, "tok2");
  assert.strictEqual(files.readConfig().oauthAccount.emailAddress, "b@x.com");
  assert.ok(!fs.existsSync(files.credsPath), "the switch never creates a credentials file beside the keychain");
  assert.strictEqual((await vault.get("a@x.com")).creds.claudeAiOauth.accessToken, "tok1");
});
