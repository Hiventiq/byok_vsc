"use strict";
// Pure usage helpers: numbers in, display strings out. No vscode, no I/O.
// worstUsed mirrors pct_left_from_usage in the Hiventiq byok library's auto_switch.py.

const BAR_WIDTH = 10;
const CRITICAL_AT = 95;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function worstUsed(usage) {
  const values = [usage.session_pct, usage.weekly_pct].filter(isNum);
  return values.length ? Math.max(...values) : null;
}

function level(used, warnAt) {
  if (!isNum(used)) return "unknown";
  if (used >= CRITICAL_AT) return "critical";
  return used >= warnAt ? "warn" : "ok";
}

function bar(pct, width = BAR_WIDTH) {
  if (!isNum(pct)) return "▱".repeat(width);
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function pctText(pct) {
  return isNum(pct) ? `${Math.round(pct)}%` : "?";
}

function toMillis(value) {
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function countdown(resetsAt, nowMs) {
  const at = resetsAt == null ? null : toMillis(resetsAt);
  if (at === null) return "";
  const minutes = Math.round((at - nowMs) / 60000);
  if (minutes <= 0) return "now";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days}d ${hours}h`;
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

module.exports = { isNum, worstUsed, level, bar, pctText, countdown };
