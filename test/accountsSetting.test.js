"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { aliasesFrom, orderFrom } = require("../src/core/accountsSetting");

const list = [
  { email: " Main@X.com ", name: " Main " },
  { email: "will@x.com" },
  { email: "bill@x.com", name: "  " },
  { email: "MAIN@x.com", name: "dupe" },
  { name: "no email" },
  null,
  "not an object",
];

test("order follows the list, normalized, de-duplicated, skipping bad entries", () => {
  assert.deepStrictEqual(orderFrom(list), ["main@x.com", "will@x.com", "bill@x.com"]);
});

test("aliases come from non-blank names, keyed by normalized email", () => {
  assert.deepStrictEqual(aliasesFrom(list), { "main@x.com": "dupe" });
  assert.deepStrictEqual(aliasesFrom([{ email: "A@x.com", name: " Work " }]), { "a@x.com": "Work" });
});

test("a missing or malformed setting yields nothing", () => {
  for (const bad of [undefined, null, {}, "x", 5]) {
    assert.deepStrictEqual(orderFrom(bad), []);
    assert.deepStrictEqual(aliasesFrom(bad), {});
  }
});
