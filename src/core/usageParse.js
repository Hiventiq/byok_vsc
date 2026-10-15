"use strict";
// Pure: Anthropic's /api/oauth/usage payload -> the four numbers the UI needs.
// Mirrors the parsing in the Hiventiq byok library (Python): _fetch_claude_usage and
// _fetch_codex_usage in its cli_providers.py. Codex windows are classified by their length
// there too (a plan can return only a weekly window). Keep the two in step.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const scale = (v) => (typeof v === "number" ? v * 100 : v);

function parseUsage(payload) {
  const body = payload || {};
  const legacy = !body.five_hour && "five_hour_utilization" in body;
  const five = legacy
    ? { utilization: scale(body.five_hour_utilization), resets_at: body.five_hour_reset_at }
    : body.five_hour || {};
  const week = legacy
    ? { utilization: scale(body.seven_day_utilization), resets_at: body.seven_day_reset_at }
    : body.seven_day || {};
  return {
    session_pct: num(five.utilization),
    session_resets_at: five.resets_at ?? null,
    weekly_pct: num(week.utilization),
    weekly_resets_at: week.resets_at ?? null,
    ...scopedWeekly(body.limits, "Fable"),
  };
}

// Plans with access to a model carry its own weekly allowance in `limits` as a weekly_scoped entry.
// No entry means no access: both fields stay null and the UI shows no bar.
function scopedWeekly(limits, model) {
  const entry = (Array.isArray(limits) ? limits : []).find(
    (l) => l && l.kind === "weekly_scoped" && l.scope && l.scope.model && l.scope.model.display_name === model,
  );
  const key = model.toLowerCase();
  return { [`${key}_pct`]: entry ? num(entry.percent) : null, [`${key}_resets_at`]: entry ? entry.resets_at ?? null : null };
}

function isoFromUnix(seconds) {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

const DAY_S = 24 * 60 * 60;

// A window is "session" (the short one) when it is at most a day long, else "weekly".
// Without a length, fall back to position: primary is the short window, secondary the long one.
function windowKind(window, position) {
  const seconds = Number(window.limit_window_seconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds <= DAY_S ? "session" : "weekly";
  return position === 0 ? "session" : "weekly";
}

// Codex: ChatGPT's wham/usage. Some plans return only one window (e.g. weekly only).
function parseCodexUsage(payload) {
  const limit = (payload && payload.rate_limit) || {};
  const out = { session_pct: null, session_resets_at: null, weekly_pct: null, weekly_resets_at: null };
  const taken = new Set();
  [limit.primary_window, limit.secondary_window].forEach((window, position) => {
    if (!window || typeof window !== "object") return;
    let kind = windowKind(window, position);
    // Two windows of one length class: keep both, the second takes the other kind (as byok's usage_windows.py).
    if (taken.has(kind)) kind = kind === "session" ? "weekly" : "session";
    taken.add(kind);
    out[`${kind}_pct`] = num(window.used_percent);
    out[`${kind}_resets_at`] = isoFromUnix(window.reset_at);
  });
  return out;
}

module.exports = { parseUsage, parseCodexUsage };
