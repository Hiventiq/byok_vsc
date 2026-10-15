"use strict";
// Pure: small SVG pictures of usage, returned as strings or data URIs. No vscode, no I/O.
const { COLORS, TRACK, colorOf } = require("./usageColors");

const clamp = (pct) => Math.min(100, Math.max(0, Number(pct) || 0));

function dataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// A 16px donut that fills clockwise to pct, coloured by level.
function ringSvg(pct, level) {
  const r = 6;
  const circumference = 2 * Math.PI * r;
  const arc = (circumference * clamp(pct)) / 100;
  const fill = arc > 0
    ? `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${colorOf(level)}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 8 8)"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="${r}" fill="none" stroke="${TRACK}" stroke-width="2.4"/>${fill}</svg>`;
}

const BAR_W = 300;
const ROW_H = 40;

function barRow(row, index) {
  const y = index * ROW_H + 4;
  const width = Math.round(((BAR_W - 8) * clamp(row.pct)) / 100);
  const id = `g${index}`;
  const fill = width > 0
    ? `<rect x="4" y="${y + 12}" width="${Math.max(width, 8)}" height="9" rx="4.5" fill="url(#${id})"/>`
    : "";
  return `<linearGradient id="${id}"><stop offset="0" stop-color="${COLORS.ok}"/><stop offset="1" stop-color="${colorOf(row.level)}"/></linearGradient>
<text x="4" y="${y + 8}" font-family="Segoe UI,sans-serif" font-size="12" fill="#9d9d9d">${row.label}</text>
<text x="${BAR_W - 4}" y="${y + 8}" font-family="Segoe UI,sans-serif" font-size="12" font-weight="600" text-anchor="end" fill="${colorOf(row.level)}">${row.pctText}</text>
<rect x="4" y="${y + 12}" width="${BAR_W - 8}" height="9" rx="4.5" fill="${TRACK}"/>${fill}
<text x="4" y="${y + 34}" font-family="Segoe UI,sans-serif" font-size="11" fill="#8b8b8b">${row.footer}</text>`;
}

// rows: [{ label, pct, level, pctText, footer }]; all text is ours (no user input), so no escaping.
function barsSvg(rows) {
  const height = rows.length * ROW_H + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_W}" height="${height}" viewBox="0 0 ${BAR_W} ${height}">${rows.map(barRow).join("")}</svg>`;
}

module.exports = { ringSvg, barsSvg, dataUri };
