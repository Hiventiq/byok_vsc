"use strict";
// Sidebar tree: accounts grouped by provider (flat while only one provider has accounts),
// each with its usage bars as child rows.
const vscode = require("vscode");
const labels = require("../core/labels");
const { level } = require("../core/usage");
const { ringSvg, dataUri } = require("../core/svg");
const { tooltipMarkdown } = require("../core/richViews");

const USAGE_COLOR = { ok: "charts.green", warn: "charts.yellow", critical: "charts.red", unknown: "disabledForeground" };
const ICON = { ok: "pass", warn: "warning", critical: "error", unknown: "circle-outline" };

class AccountsTree {
  // decorations: AccountDecorations, used for the optional percent badge.
  constructor(decorations) {
    this.decorations = decorations;
    this.display = { usageStyle: "bars", richTooltip: true, labelBadges: false };
    this.groups = [];
    this.warnAt = 80;
    this.nowMs = Date.now();
    this._changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._changed.event;
  }

  // groups: [{ provider: { id, label }, accounts, alwaysShow }]
  update(groups, warnAt, display) {
    this.display = display;
    this.groups = groups;
    this.warnAt = warnAt;
    this.nowMs = Date.now();
    this._changed.fire();
  }

  getTreeItem(node) {
    return node.item;
  }

  getChildren(node) {
    if (node) return node.children || [];
    const visible = this.groups.filter((g) => g.accounts.length || g.alwaysShow);
    if (visible.length === 1) return this._accountNodes(visible[0]);
    return visible.map((g) => this._groupNode(g));
  }

  _accountNodes(group) {
    if (!group.accounts.length) {
      return [{ item: new vscode.TreeItem("No accounts yet. Use + to save the current login.") }];
    }
    return group.accounts.map((a) => this._accountNode(a));
  }

  _groupNode(group) {
    const item = new vscode.TreeItem(group.provider.label, vscode.TreeItemCollapsibleState.Expanded);
    item.contextValue = "provider";
    return { item, children: this._accountNodes(group) };
  }

  _accountNode(account) {
    const item = new vscode.TreeItem(labels.displayName(account), vscode.TreeItemCollapsibleState.Expanded);
    item.description = labels.rowDescription(account);
    item.contextValue = account.stored === false ? "unsaved" : "account";
    item.iconPath = new vscode.ThemeIcon(ICON[labels.severity(account, this.warnAt)]);
    item.command = account.active ? undefined : { command: "hiventiqByok.switch", title: "Switch", arguments: [{ account }] };
    if (this.display.labelBadges) item.resourceUri = this.decorations.uriFor(account);
    if (this.display.richTooltip) item.tooltip = new vscode.MarkdownString(tooltipMarkdown(account, this.nowMs, this.warnAt));
    const rings = this.display.usageStyle === "rings";
    const rows = labels.usageRows(account, this.nowMs, { withBar: !rings });
    const children = rows.map((row) => ({ item: this._usageItem(row, rings) }));
    return { item, account, children };
  }

  // Each usage row leads with a ring that fills to the percent, or a coloured dot (green, amber, red).
  _usageItem(row, rings) {
    const item = new vscode.TreeItem(row.text);
    if (row.pct == null) return item;
    const lvl = level(row.pct, this.warnAt);
    item.iconPath = rings
      ? vscode.Uri.parse(dataUri(ringSvg(row.pct, lvl)))
      : new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor(USAGE_COLOR[lvl]));
    return item;
  }
}

module.exports = { AccountsTree };
