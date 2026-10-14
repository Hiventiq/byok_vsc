"use strict";
const test = require("node:test");
const assert = require("node:assert");
const http = require("../src/core/httpResult");

test("retryAfterMs converts seconds and ignores anything unusable", () => {
  assert.strictEqual(http.retryAfterMs("34"), 34000);
  assert.strictEqual(http.retryAfterMs(2), 2000);
  for (const bad of [null, undefined, "", "abc", "0", "-5", NaN]) assert.strictEqual(http.retryAfterMs(bad), 0);
});

test("usage results have one shape per outcome", () => {
  assert.deepStrictEqual(http.usageHttpError(429, "34"), { usage_error: "HTTP 429", status: 429, retryAfterMs: 34000 });
  assert.deepStrictEqual(http.usageHttpError(401, null), { usage_error: "HTTP 401", status: 401, retryAfterMs: 0 });
  assert.deepStrictEqual(http.usageNetworkError(), { usage_error: "network error", status: 0 });
  assert.deepStrictEqual(http.usageMissingToken(), { usage_error: "no access token", status: 0 });
});

test("refresh results have one shape per outcome", () => {
  assert.deepStrictEqual(http.refreshHttpError(400, true), { error: "HTTP 400", permanent: true });
  assert.deepStrictEqual(http.refreshHttpError(500, false), { error: "HTTP 500", permanent: false });
  assert.deepStrictEqual(http.refreshNetworkError(), { error: "network error", permanent: false });
  assert.deepStrictEqual(http.refreshMissingToken(), { error: "no refresh token", permanent: true });
});

test("each call returns a fresh object, so a caller cannot change another's result", () => {
  const first = http.usageNetworkError();
  first.status = 999;
  assert.strictEqual(http.usageNetworkError().status, 0);
});
