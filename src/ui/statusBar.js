"use strict";
// One always-visible status bar item per provider.
const vscode = require("vscode");
const labels = require("../core/labels");
const { statusTooltipMarkdown } = require("../core/richViews");

const BACKGROUND = {
  warn: "statusBarItem.warningBackground",
  critical: "statusBarItem.errorBackground",
};

// `alwaysShow` keeps the item up with no accounts (Claude); otherwise it appears once there is one.
function createStatusBar({ provider, priority, alwaysShow, richTooltip = () => true }) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
  item.command = { command: "hiventiqByok.switch", title: "Switch account", arguments: [{ providerId: provider.id }] };
  item.text = `$(sync~spin) ${provider.label}`;
  if (alwaysShow) item.show();

  return {
    item,
    render(accounts, warnAt) {
      if (!accounts.length && !alwaysShow) return item.hide();
      item.show();
      const active = labels.activeOf(accounts);
      item.text = labels.statusText(active, provider);
      item.tooltip = richTooltip()
        ? new vscode.MarkdownString(statusTooltipMarkdown(accounts, Date.now(), warnAt, provider))
        : labels.tooltipText(accounts, Date.now(), provider);
      const color = BACKGROUND[labels.severity(active, warnAt)];
      item.backgroundColor = color ? new vscode.ThemeColor(color) : undefined;
    },
    renderError(message) {
      item.show();
      item.text = `$(warning) ${provider.label} accounts`;
      item.tooltip = message;
      item.backgroundColor = new vscode.ThemeColor(BACKGROUND.critical);
    },
  };
}

module.exports = { createStatusBar };
