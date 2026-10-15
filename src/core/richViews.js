"use strict";
// Pure: the Markdown hover and the webview panel body built from accounts. No vscode, no I/O.
const labels = require("./labels");
const { level, countdown, pctText } = require("./usage");
const { barsSvg, dataUri } = require("./svg");
const { colorOf, COLORS } = require("./usageColors");
const { escapeHtml, escapeMarkdown } = require("./html");

function reset(w, nowMs) {
  const left = countdown(w.resetsAt, nowMs);
  return left ? `resets in ${left}` : "";
}

// Hover for an account row: a picture of every window, then any notes.
function tooltipMarkdown(account, nowMs, warnAt) {
  const head = `**${escapeMarkdown(labels.displayName(account))}**${account.subscription ? ` · ${escapeMarkdown(account.subscription)}` : ""}`;
  const windows = labels.usageWindows(account);
  if (!windows.length) return `${head}\n\n${escapeMarkdown(labels.usageLines(account, nowMs)[0])}`;
  const rows = windows.map((w) => ({
    label: w.label, pct: w.pct, level: level(w.pct, warnAt), pctText: pctText(w.pct), footer: reset(w, nowMs),
  }));
  const stale = account.stale_at ? `\n\n${escapeMarkdown(labels.staleNote(account.stale_at, nowMs))}` : "";
  return `${head}\n\n![usage](${dataUri(barsSvg(rows))})${stale}`;
}

function windowHtml(w, nowMs, warnAt) {
  const lvl = level(w.pct, warnAt);
  const width = Math.min(100, Math.max(0, w.pct));
  const glow = lvl === "ok" ? "" : ` style="box-shadow:0 0 8px ${colorOf(lvl)}88"`;
  return `<div class="win"><div class="top"><span>${escapeHtml(w.label)}</span><b style="color:${colorOf(lvl)}">${pctText(w.pct)}</b></div>`
    + `<div class="track"${glow}><i style="width:${width}%;background:linear-gradient(90deg,${COLORS.ok},${colorOf(lvl)})"></i></div>`
    + `<div class="foot">${escapeHtml(reset(w, nowMs))}</div></div>`;
}

const ACTIONS = [
  ["switch", "⇄", "Switch to this account"], ["rename", "✎", "Rename"],
  ["moveUp", "▲", "Move up"], ["moveDown", "▼", "Move down"], ["remove", "✕", "Remove"],
];

function buttonsHtml(account) {
  if (account.stored === false) return "";
  return ACTIONS.filter(([cmd]) => cmd !== "switch" || !account.active)
    .map(([cmd, glyph, title]) => `<button data-cmd="${cmd}" data-provider="${escapeHtml(account.provider)}" data-id="${escapeHtml(account.id)}" title="${title}">${glyph}</button>`)
    .join("");
}

function cardHtml(account, nowMs, warnAt) {
  const windows = labels.usageWindows(account);
  const body = windows.length
    ? windows.map((w) => windowHtml(w, nowMs, warnAt)).join("")
    : `<div class="foot">${escapeHtml(labels.usageLines(account, nowMs)[0])}</div>`;
  const sub = [account.active ? "● active" : "", account.subscription].filter(Boolean).join(" · ");
  const lvl = labels.severity(account, warnAt);
  return `<div class="card${account.active ? " active" : ""}" style="border-left-color:${colorOf(lvl)}">`
    + `<div class="head"><b>${escapeHtml(labels.displayName(account))}</b><span class="sub">${escapeHtml(sub)}</span><span class="btns">${buttonsHtml(account)}</span></div>${body}</div>`;
}

// groups: [{ provider: { label }, accounts, alwaysShow }]
function panelBody(groups, nowMs, warnAt) {
  const visible = groups.filter((g) => g.accounts.length || g.alwaysShow);
  if (!visible.length) return `<p class="foot">No accounts yet. Use + to save the current login.</p>`;
  return visible.map((g) => `<h3>${escapeHtml(g.provider.label)}</h3>${
    g.accounts.length ? g.accounts.map((a) => cardHtml(a, nowMs, warnAt)).join("") : `<p class="foot">No accounts yet.</p>`}`).join("");
}

module.exports = { tooltipMarkdown, panelBody };
