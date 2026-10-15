"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseUsage } = require("../src/core/usageParse");
const labels = require("../src/core/labels");
const { ringSvg, barsSvg, dataUri } = require("../src/core/svg");
const { tooltipMarkdown, panelBody } = require("../src/core/richViews");
const { panelPage } = require("../src/core/panelPage");
const { escapeHtml, escapeMarkdown } = require("../src/core/html");
const { PRESETS, currentPreset } = require("../src/core/styles");

const base = { id: "a", email: "a@x.com", provider: "claude-code", active: true, session_pct: 5, weekly_pct: 8 };

test("Fable usage comes from the weekly_scoped limit and is null without access", () => {
  const withFable = parseUsage({
    five_hour: { utilization: 6 }, seven_day: { utilization: 8 },
    limits: [
      { kind: "weekly_all", percent: 8 },
      { kind: "weekly_scoped", percent: 12, resets_at: "2026-10-20T02:00:00Z", scope: { model: { display_name: "Fable" } } },
      { kind: "weekly_scoped", percent: 90, scope: { model: { display_name: "Other" } } },
    ],
  });
  assert.strictEqual(withFable.fable_pct, 12);
  assert.strictEqual(withFable.fable_resets_at, "2026-10-20T02:00:00Z");
  const without = parseUsage({ five_hour: { utilization: 6 }, seven_day: { utilization: 8 } });
  assert.strictEqual(without.fable_pct, null);
  assert.strictEqual(parseUsage({ limits: "bad" }).fable_pct, null);
});

test("a Fable row appears only when the account has the allowance", () => {
  assert.strictEqual(labels.usageLines(base, 0).length, 2);
  const lines = labels.usageLines({ ...base, fable_pct: 12 }, 0);
  assert.strictEqual(lines.length, 3);
  assert.match(lines[2], /^fable\s+▰+▱+\s+12%/);
});

test("ring rows drop the text bar", () => {
  const [row] = labels.usageRows(base, 0, { withBar: false });
  assert.doesNotMatch(row.text, /[▰▱]/);
  assert.strictEqual(row.pct, 5);
});

test("with an alias the email is not shown anywhere", () => {
  const named = { ...base, name: "Work", subscription: "max" };
  assert.doesNotMatch(labels.rowDescription(named), /x\.com/);
  assert.doesNotMatch(labels.tooltipText([named], 0), /x\.com/);
});

test("ring and bar SVGs are valid, coloured by level and encoded as data URIs", () => {
  assert.match(ringSvg(50, "ok"), /stroke="#3fb950".*stroke-dasharray="18\.85/);
  assert.doesNotMatch(ringSvg(0, "ok"), /stroke-dasharray/);
  assert.match(ringSvg(97, "critical"), /#f85149/);
  const svg = barsSvg([{ label: "Weekly", pct: 80, level: "warn", pctText: "80%", footer: "resets in 1h" }]);
  assert.match(svg, /#d29922/);
  assert.match(dataUri(svg), /^data:image\/svg\+xml;base64,/);
});

test("tooltip embeds the picture and escapes the name", () => {
  const md = tooltipMarkdown({ ...base, name: "A*B [x]", fable_pct: 3 }, 0, 80);
  assert.match(md, /^\*\*A\\\*B \\\[x\\\]\*\*/);
  assert.match(md, /!\[usage\]\(data:image\/svg\+xml;base64,/);
  assert.match(tooltipMarkdown({ ...base, needs_reauth: true }, 0, 80), /Needs sign\\-in/);
});

test("panel cards escape text, wire buttons by id, and hide switch on the active account", () => {
  const evil = { ...base, id: 'x"><b>', name: "<script>", stored: true };
  const html = panelBody([{ provider: { label: "Claude" }, accounts: [evil], alwaysShow: true }], 0, 80);
  assert.doesNotMatch(html, /<script>|x"><b>/);
  assert.doesNotMatch(html, /data-cmd="switch"/);
  assert.match(html, /data-cmd="remove"/);
  assert.match(panelBody([{ provider: { label: "Codex" }, accounts: [], alwaysShow: false }], 0, 80), /No accounts yet/);
});

test("panel page sets a nonce-only script policy", () => {
  const page = panelPage("<p>x</p>", "abc");
  assert.match(page, /script-src 'nonce-abc'/);
  assert.match(page, /<script nonce="abc">/);
});

test("escapers and presets", () => {
  assert.strictEqual(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  assert.strictEqual(escapeMarkdown("a_b"), "a\\_b");
  assert.strictEqual(currentPreset(PRESETS[1].values).id, "rings");
  assert.strictEqual(currentPreset({ ...PRESETS[1].values, labelBadges: true }).id, "ringsBadges");
  assert.strictEqual(currentPreset({ view: "tree", usageStyle: "rings", richTooltip: false, labelBadges: false }), null);
});
