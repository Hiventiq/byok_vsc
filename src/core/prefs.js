"use strict";
// Pure: the user's account preferences (display order and short names), kept per email.

const norm = (email) => String(email || "").trim().toLowerCase();

// Accounts sorted by the saved order; accounts not in it keep their own order, after the listed ones.
function orderAccounts(accounts, order) {
  const rank = new Map((order || []).map((key, i) => [norm(key), i]));
  const keyOf = (a) => norm(a.key || a.email);
  const at = (a) => (rank.has(keyOf(a)) ? rank.get(keyOf(a)) : Number.MAX_SAFE_INTEGER);
  return accounts
    .map((account, i) => ({ account, i }))
    .sort((x, y) => at(x.account) - at(y.account) || x.i - y.i)
    .map((x) => x.account);
}

// The email list with one entry moved up (-1) or down (+1); unchanged at either end.
function moveEmail(emails, email, delta) {
  const list = emails.map(norm);
  const from = list.indexOf(norm(email));
  const to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) return list;
  [list[from], list[to]] = [list[to], list[from]];
  return list;
}

// The names map with one name set; a blank name removes it.
function withName(names, email, name) {
  const next = { ...names };
  const clean = String(name || "").trim();
  if (clean) next[norm(email)] = clean;
  else delete next[norm(email)];
  return next;
}

module.exports = { orderAccounts, moveEmail, withName };
