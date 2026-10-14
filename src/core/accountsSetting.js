"use strict";
// Pure: the one `accounts` setting -> display aliases and fallback order.
// Each entry is { email, name? }; list order is the auto-switch fallback order.

const normalize = (email) => String(email || "").trim().toLowerCase();

function validEntries(list) {
  return (Array.isArray(list) ? list : []).filter(
    (entry) => entry && typeof entry === "object" && normalize(entry.email),
  );
}

function aliasesFrom(list) {
  const aliases = {};
  for (const entry of validEntries(list)) {
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (name) aliases[normalize(entry.email)] = name;
  }
  return aliases;
}

function orderFrom(list) {
  return [...new Set(validEntries(list).map((entry) => normalize(entry.email)))];
}

module.exports = { aliasesFrom, orderFrom };
