"use strict";
// Sidebar tree: accounts grouped by provider (flat while only one provider has accounts),
// each with its usage bars as child rows.
const vscode = require("vscode");
const labels = require("../core/labels");

const ICON = { ok: "pass", warn: "warning", critical: "error", unknown: "circle-outline" };

class AccountsTree {
  constructor() {
    this.groups = [];
    this.warnAt = 80;
    this.nowMs = Date.now();
    this._changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._changed.event;
  }

  // groups: [{ provider: { id, label }, accounts, alwaysShow }]
  update(groups, warnAt) {
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
    const children = labels.usageLines(account, this.nowMs).map((line) => ({ item: new vscode.TreeItem(line) }));
    return { item, account, children };
  }
}

module.exports = { AccountsTree };
