"use strict";
// Pure: the colour of a usage level as hex, for SVG and HTML (the tree uses theme colours instead).

const COLORS = Object.freeze({ ok: "#3fb950", warn: "#d29922", critical: "#f85149", unknown: "#8b8b8b" });
const TRACK = "#3a3a3a";

const colorOf = (level) => COLORS[level] || COLORS.unknown;

module.exports = { COLORS, TRACK, colorOf };
