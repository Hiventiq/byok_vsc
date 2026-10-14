"use strict";
const test = require("node:test");
const assert = require("node:assert");
const labels = require("../src/core/labels");

const a = { id: "a@x.com", email: "a@x.com", active: true, subscription: "max", session_pct: 42.4, weekly_pct: 18, stored: true };

test("statusText", () => {
  assert.strictEqual(labels.statusText(a), "$(account) a@x.com · 5h 42% · wk 18%");
  assert.match(labels.statusText(null), /no login/);
  assert.match(labels.statusText({ ...a, needs_reauth: true }), /sign in again/);
});

test("usageLines show bars and reset countdown", () => {
  const now = Date.parse("2026-10-14T00:00:00Z");
  const lines = labels.usageLines({ ...a, session_resets_at: "2026-10-14T01:30:00Z" }, now);
  assert.match(lines[0], /█+░+\s+42%\s+resets in 1h 30m/);
  assert.match(lines[1], /18%/);
});

test("usageLines explain missing usage and dead logins", () => {
  assert.match(labels.usageLines({ ...a, session_pct: null, weekly_pct: null, usage_error: "HTTP 429" }, 0)[0], /HTTP 429/);
  assert.match(labels.usageLines({ ...a, needs_reauth: true }, 0)[0], /claude login/);
});

test("severity and rowDescription", () => {
  assert.strictEqual(labels.severity(a, 80), "ok");
  assert.strictEqual(labels.severity({ ...a, weekly_pct: 85 }, 80), "warn");
  assert.strictEqual(labels.severity({ ...a, needs_reauth: true }, 80), "critical");
  assert.strictEqual(labels.rowDescription({ ...a, stored: false }), "● active · max · not saved");
});

test("tooltipText lists every account", () => {
  const text = labels.tooltipText([a, { ...a, id: "b", email: "b@x.com", active: false }], 0);
  assert.match(text, /● a@x.com/);
  assert.match(text, / {2}b@x.com/);
});

test("aliases: matched case-insensitively, blanks ignored, email still shown beside the alias", () => {
  const accounts = [{ ...a, email: "A@X.com" }, { ...a, id: "b", email: "b@x.com", active: false }];
  const named = labels.withAliases(accounts, { "a@x.com": " Work ", "b@x.com": "  ", bad: 5 });
  assert.deepStrictEqual(named.map((n) => n.name), ["Work", ""]);
  assert.strictEqual(labels.displayName(named[0]), "Work");
  assert.strictEqual(labels.displayName(named[1]), "b@x.com");
  assert.match(labels.statusText(named[0]), /^\$\(account\) Work · 5h/);
  assert.match(labels.rowDescription(named[0]), /A@X.com/);
  assert.match(labels.tooltipText(named, 0), /● Work \(A@X.com\)/);
  assert.deepStrictEqual(labels.withAliases(accounts, undefined).map((n) => n.name), ["", ""]);
});

test("a one-window account shows only that window", () => {
  const weeklyOnly = { ...a, session_pct: null, weekly_pct: 59 };
  assert.strictEqual(labels.statusText(weeklyOnly), "$(account) a@x.com · wk 59%");
  const lines = labels.usageLines(weeklyOnly, 0);
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^week/);
  assert.match(labels.statusText({ ...a, session_pct: null, weekly_pct: null }), /5h \? · wk \?/);
});

test("codex accounts get their own icon and login command", () => {
  const codex = { id: "codex", label: "Codex" };
  assert.match(labels.statusText({ ...a, provider: "codex" }, codex), /^\$\(terminal\)/);
  assert.match(labels.statusText(null, codex), /Codex: no login/);
  assert.match(labels.usageLines({ ...a, provider: "codex", needs_reauth: true }, 0)[0], /codex login/);
  assert.match(labels.tooltipText([], 0, codex), /codex login/);
});
