"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { orderAccounts, moveEmail, withName } = require("../src/core/prefs");
const { createPrefsStore } = require("../src/data/prefsStore");

const acct = (email) => ({ email });

test("orderAccounts follows the saved order, unlisted accounts last in their own order", () => {
  const list = [acct("c@x.com"), acct("a@x.com"), acct("b@x.com"), acct("d@x.com")];
  const out = orderAccounts(list, ["B@x.com", "a@x.com"]).map((a) => a.email);
  assert.deepStrictEqual(out, ["b@x.com", "a@x.com", "c@x.com", "d@x.com"]);
  assert.deepStrictEqual(orderAccounts(list, undefined).map((a) => a.email), list.map((a) => a.email));
});

test("moveEmail swaps with a neighbour and stops at the ends", () => {
  const emails = ["a@x.com", "b@x.com", "c@x.com"];
  assert.deepStrictEqual(moveEmail(emails, "b@x.com", -1), ["b@x.com", "a@x.com", "c@x.com"]);
  assert.deepStrictEqual(moveEmail(emails, "B@x.com", 1), ["a@x.com", "c@x.com", "b@x.com"]);
  assert.deepStrictEqual(moveEmail(emails, "a@x.com", -1), emails);
  assert.deepStrictEqual(moveEmail(emails, "c@x.com", 1), emails);
  assert.deepStrictEqual(moveEmail(emails, "zzz@x.com", 1), emails);
});

test("withName sets, trims, and clears a name without mutating the input", () => {
  const before = { "a@x.com": "Old" };
  assert.deepStrictEqual(withName(before, "A@x.com", " New "), { "a@x.com": "New" });
  assert.deepStrictEqual(withName(before, "a@x.com", "  "), {});
  assert.deepStrictEqual(before, { "a@x.com": "Old" });
});

test("prefsStore round-trips and reports whether anything was saved", async () => {
  const map = new Map();
  const store = createPrefsStore({ get: (k) => map.get(k), update: async (k, v) => void map.set(k, v) });
  assert.strictEqual(store.exists(), false);
  assert.deepStrictEqual(store.get(), { order: [], names: {} });
  await store.save({ order: ["a@x.com"], names: { "a@x.com": "A" } });
  assert.strictEqual(store.exists(), true);
  assert.deepStrictEqual(store.get().order, ["a@x.com"]);
});
