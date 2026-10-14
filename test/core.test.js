"use strict";
const test = require("node:test");
const assert = require("node:assert");
const usage = require("../src/core/usage");
const { parseUsage } = require("../src/core/usageParse");
const identity = require("../src/core/identity");
const { decideSwitch } = require("../src/core/autoSwitch");

test("bar and pctText", () => {
  assert.strictEqual(usage.bar(50), "█████░░░░░");
  assert.strictEqual(usage.bar(null), "░░░░░░░░░░");
  assert.strictEqual(usage.bar(250), "██████████");
  assert.strictEqual(usage.pctText(41.6), "42%");
  assert.strictEqual(usage.pctText(undefined), "?");
});

test("level thresholds", () => {
  assert.strictEqual(usage.level(10, 80), "ok");
  assert.strictEqual(usage.level(80, 80), "warn");
  assert.strictEqual(usage.level(96, 80), "critical");
  assert.strictEqual(usage.level(null, 80), "unknown");
});

test("countdown", () => {
  const now = Date.parse("2026-10-14T00:00:00Z");
  assert.strictEqual(usage.countdown("2026-10-14T02:10:00Z", now), "2h 10m");
  assert.strictEqual(usage.countdown("2026-10-16T05:00:00Z", now), "2d 5h");
  assert.strictEqual(usage.countdown("2026-10-13T00:00:00Z", now), "now");
  assert.strictEqual(usage.countdown(null, now), "");
});

test("parseUsage handles current and legacy shapes", () => {
  const cur = parseUsage({ five_hour: { utilization: 12, resets_at: "x" }, seven_day: { utilization: 3 } });
  assert.deepStrictEqual([cur.session_pct, cur.weekly_pct, cur.session_resets_at], [12, 3, "x"]);
  const old = parseUsage({ five_hour_utilization: 0.5, seven_day_utilization: 0.25 });
  assert.deepStrictEqual([old.session_pct, old.weekly_pct], [50, 25]);
  assert.strictEqual(parseUsage(null).session_pct, null);
});

test("identity: snapshot, patch, expiry, refresh", () => {
  const config = { keep: 1, oauthAccount: { emailAddress: " A@X.com ", org: "o" } };
  const snap = identity.snapshotFromConfig(config);
  assert.strictEqual(identity.emailOfSnapshot(snap), "a@x.com");
  assert.strictEqual(identity.snapshotFromConfig({ oauthAccount: {} }), null);
  const patched = identity.patchedConfig({ keep: 1, oauthAccount: { emailAddress: "old" } }, snap);
  assert.strictEqual(patched.keep, 1);
  assert.strictEqual(patched.oauthAccount.org, "o");
  const creds = { claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: 1000 } };
  assert.strictEqual(identity.isExpired(creds, 5000), true);
  const fresh = identity.withRefreshed(creds, { access_token: "b", expires_in: 10 }, 0);
  assert.deepStrictEqual(
    [fresh.claudeAiOauth.accessToken, fresh.claudeAiOauth.refreshToken, fresh.claudeAiOauth.expiresAt],
    ["b", "r", 10000],
  );
});

const acct = (id, session, weekly, extra = {}) => ({ id, session_pct: session, weekly_pct: weekly, stored: true, ...extra });
const base = { threshold: 90, order: [], nowMs: 1e6, cooldownMs: 1000 };

test("autoSwitch: stays put below threshold", () => {
  const accounts = [acct("a", 50, 10, { active: true }), acct("b", 0, 0)];
  assert.strictEqual(decideSwitch({ ...base, accounts }), null);
});

test("autoSwitch: moves to the emptiest candidate, honoring fallback order", () => {
  const accounts = [acct("a", 95, 10, { active: true }), acct("b", 40, 5), acct("c", 10, 1)];
  assert.strictEqual(decideSwitch({ ...base, accounts }), "c");
  assert.strictEqual(decideSwitch({ ...base, accounts, order: ["b"] }), "b");
});

test("autoSwitch: skips full, dead, unknown and unsaved accounts; respects cooldown", () => {
  const accounts = [
    acct("a", 95, 10, { active: true }), acct("full", 91, 0), acct("dead", 0, 0, { needs_reauth: true }),
    acct("unk", null, null), acct("live", 0, 0, { stored: false }),
  ];
  assert.strictEqual(decideSwitch({ ...base, accounts }), null);
  const ok = [...accounts, acct("good", 5, 5)];
  assert.strictEqual(decideSwitch({ ...base, accounts: ok }), "good");
  assert.strictEqual(decideSwitch({ ...base, accounts: ok, lastSwitchAt: base.nowMs - 10 }), null);
});
