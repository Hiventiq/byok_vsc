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

const DEFAULT_PROVIDER = Object.freeze({ id: "claude-code", label: "Claude" });

function statusText(account, provider = DEFAULT_PROVIDER) {
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

// The usage windows an account has, in display order. `fable` is the Claude Fable weekly allowance
// and appears only for plans that have it (see usageParse.scopedWeekly).
const WINDOWS = [
  { key: "session", short: "5h  ", label: "5-hour window" },
  { key: "weekly", short: "week", label: "Weekly window" },
  { key: "fable", short: "fable", label: "Fable weekly" },
];

function usageWindows(account) {
  if (account.needs_reauth) return [];
  return WINDOWS
    .filter((w) => account[`${w.key}_pct`] != null)
    .map((w) => ({ ...w, pct: account[`${w.key}_pct`], resetsAt: account[`${w.key}_resets_at`] }));
}

function windowLine(w, nowMs, withBar) {
  const reset = countdown(w.resetsAt, nowMs);
  return `${w.short}  ${withBar ? `${bar(w.pct)}  ` : ""}${pctText(w.pct)}${reset ? `  resets in ${reset}` : ""}`;
}

// Rows for the sidebar: the text plus the used percent (null for a note), so the view can colour it.
// withBar:false drops the text bar when a ring icon already draws it.
function usageRows(account, nowMs, { withBar = true } = {}) {
  if (account.needs_reauth) {
    const why = account.usage_error ? ` (${account.usage_error})` : "";
    return [{ text: `Needs sign-in${why}: run \`${LOGIN_COMMAND[account.provider] || "claude login"}\`, then Save Current Login`, pct: null }];
  }
  const windows = usageWindows(account);
  if (!windows.length) {
    return [{ text: `Usage unavailable${account.usage_error ? ` (${account.usage_error})` : ""}`, pct: null }];
  }
  const rows = windows.map((w) => ({ text: windowLine(w, nowMs, withBar), pct: w.pct }));
  return account.stale_at ? [...rows, { text: staleNote(account.stale_at, nowMs), pct: null }] : rows;
}

function usageLines(account, nowMs) {
  return usageRows(account, nowMs).map((r) => r.text);
}

function staleNote(staleAt, nowMs) {
  return `(last good reading ${Math.max(1, Math.round((nowMs - staleAt) / 60000))}m ago; refresh was rate limited)`;
}

function rowDescription(account) {
  // With an alias the label is the alias and the email stays out of the row; without one the label is the email.
  const parts = [account.active ? "● active" : "", account.subscription, account.stored === false ? "not saved" : ""];
  return parts.filter(Boolean).join(" · ");
}

function tooltipText(accounts, nowMs, provider = DEFAULT_PROVIDER) {
  if (!accounts.length) {
    return `No ${provider.label} accounts. Sign in with \`${LOGIN_COMMAND[provider.id]}\`, then save it.`;
  }
  const rows = accounts.map((a) => [
    `${a.active ? "● " : "  "}${displayName(a)}`,
    ...usageLines(a, nowMs).map((l) => `    ${l}`),
  ].join("\n"));
  return [`${provider.label}`, ...rows].join("\n\n");
}

function severity(account, warnAt) {
  return account ? (account.needs_reauth ? "critical" : level(worstUsed(account), warnAt)) : "unknown";
}

module.exports = { activeOf, displayName, withAliases, statusText, usageWindows, usageRows, usageLines, staleNote, rowDescription, tooltipText, severity };
