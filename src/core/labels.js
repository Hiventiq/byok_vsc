"use strict";
// Pure display strings for the status bar, tooltip and sidebar rows.
const { bar, pctText, countdown, worstUsed, level } = require("./usage");

function activeOf(accounts) {
  return accounts.find((a) => a.active) || null;
}

// The short name the user chose for an account, else its email.
// When another account shares the email, add what tells them apart (organization or short id).
function displayName(account) {
  if (account.name) return account.name;
  return account.duplicate && account.detail ? `${account.email} (${account.detail})` : account.email;
}

// Each account's alias, looked up by its key (provider-qualified; the email for Claude).
// Case-insensitive; blank or non-string aliases are ignored.
function withAliases(accounts, aliases) {
  const byKey = new Map(
    Object.entries(aliases || {})
      .filter(([, name]) => typeof name === "string" && name.trim())
      .map(([key, name]) => [key.trim().toLowerCase(), name.trim()]),
  );
  return accounts.map((a) => ({ ...a, name: byKey.get(String(a.key || a.email).toLowerCase()) || "" }));
}

const PROVIDER_ICON = { "claude-code": "$(account)", codex: "$(terminal)" };
const LOGIN_COMMAND = { "claude-code": "claude login", codex: "codex login" };

function statusText(account, provider = { id: "claude-code", label: "Claude" }) {
  const icon = PROVIDER_ICON[provider.id] || "$(account)";
  if (!account) return `${icon} ${provider.label}: no login`;
  if (account.needs_reauth) return `$(warning) ${displayName(account)} · sign in again`;
  return `${icon} ${displayName(account)} · ${windowSummary(account)}`;
}

// "5h 42% · wk 18%", leaving out a window the account does not have (some plans have only one).
function windowSummary(account) {
  const hasSession = account.session_pct != null;
  const hasWeekly = account.weekly_pct != null;
  if (!hasSession && !hasWeekly) return `5h ${pctText(null)} · wk ${pctText(null)}`;
  return [hasSession && `5h ${pctText(account.session_pct)}`, hasWeekly && `wk ${pctText(account.weekly_pct)}`]
    .filter(Boolean).join(" · ");
}

function windowLine(name, pct, resetsAt, nowMs) {
  const reset = countdown(resetsAt, nowMs);
  return `${name}  ${bar(pct)}  ${pctText(pct)}${reset ? `  resets in ${reset}` : ""}`;
}

function usageLines(account, nowMs) {
  if (account.needs_reauth) {
    return [`Needs sign-in: run \`${LOGIN_COMMAND[account.provider] || "claude login"}\`, then Save Current Login`];
  }
  if (account.session_pct == null && account.weekly_pct == null) {
    return [`Usage unavailable${account.usage_error ? ` (${account.usage_error})` : ""}`];
  }
  const lines = [
    account.session_pct != null && windowLine("5h  ", account.session_pct, account.session_resets_at, nowMs),
    account.weekly_pct != null && windowLine("week", account.weekly_pct, account.weekly_resets_at, nowMs),
  ].filter(Boolean);
  return account.stale_at ? [...lines, staleNote(account.stale_at, nowMs)] : lines;
}

function staleNote(staleAt, nowMs) {
  return `(last good reading ${Math.max(1, Math.round((nowMs - staleAt) / 60000))}m ago; refresh was rate limited)`;
}

function rowDescription(account) {
  const aliasedEmail = account.name ? account.email : "";
  const parts = [account.active ? "● active" : "", aliasedEmail, account.subscription, account.stored === false ? "not saved" : ""];
  return parts.filter(Boolean).join(" · ");
}

function tooltipText(accounts, nowMs, provider = { id: "claude-code", label: "Claude" }) {
  if (!accounts.length) {
    return `No ${provider.label} accounts. Sign in with \`${LOGIN_COMMAND[provider.id]}\`, then save it.`;
  }
  const rows = accounts.map((a) => [
    `${a.active ? "● " : "  "}${displayName(a)}${a.name ? ` (${a.email})` : ""}`,
    ...usageLines(a, nowMs).map((l) => `    ${l}`),
  ].join("\n"));
  return [`${provider.label}`, ...rows].join("\n\n");
}

function severity(account, warnAt) {
  return account ? (account.needs_reauth ? "critical" : level(worstUsed(account), warnAt)) : "unknown";
}

module.exports = { activeOf, displayName, withAliases, statusText, usageLines, rowDescription, tooltipText, severity };
