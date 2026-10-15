"use strict";
// Pure: the display choices a user can make, and the presets that set them together.

const PRESETS = [
  { id: "bars", label: "Bars", detail: "Text bars with a coloured dot", values: { view: "tree", usageStyle: "bars", richTooltip: true, labelBadges: false } },
  { id: "rings", label: "Rings", detail: "A ring icon per row that fills to the percent", values: { view: "tree", usageStyle: "rings", richTooltip: true, labelBadges: false } },
  { id: "ringsBadges", label: "Rings + badges", detail: "Rings plus a coloured percent badge on each account", values: { view: "tree", usageStyle: "rings", richTooltip: true, labelBadges: true } },
  { id: "panel", label: "Panel", detail: "Graphical cards with gradient bars (replaces the tree)", values: { view: "panel", usageStyle: "rings", richTooltip: true, labelBadges: false } },
];

// The preset whose values equal the current settings, or null when the user mixed their own.
function currentPreset(current) {
  return PRESETS.find((p) => Object.entries(p.values).every(([k, v]) => current[k] === v)) || null;
}

module.exports = { PRESETS, currentPreset };
