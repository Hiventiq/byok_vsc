"use strict";
// Pure: a short, stable, filesystem-safe tag for an arbitrary string.
const { createHash } = require("node:crypto");

function shortHash(value, length = 6) {
  return value ? createHash("sha1").update(String(value)).digest("hex").slice(0, length) : "";
}

module.exports = { shortHash };
