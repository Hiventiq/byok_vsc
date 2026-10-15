"use strict";
// The graphical alternative to the tree: a webview of cards. Thin; the HTML comes from core.
const crypto = require("node:crypto");
const vscode = require("vscode");
const { panelBody } = require("../core/richViews");
const { panelPage } = require("../core/panelPage");

const COMMANDS = new Set(["switch", "rename", "moveUp", "moveDown", "remove"]);

class AccountsPanel {
  constructor() {
    this.groups = [];
    this.warnAt = 80;
    this.view = undefined;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((m) => this._onMessage(m));
    view.onDidDispose(() => { this.view = undefined; });
    this._render();
  }

  update(groups, warnAt) {
    this.groups = groups;
    this.warnAt = warnAt;
    this._render();
  }

  _render() {
    if (!this.view) return;
    const nonce = crypto.randomBytes(16).toString("hex");
    this.view.webview.html = panelPage(panelBody(this.groups, Date.now(), this.warnAt), nonce);
  }

  // Buttons carry only a command name and an account id; the account is looked up here, never trusted.
  _onMessage({ cmd, provider, id } = {}) {
    if (!COMMANDS.has(cmd)) return;
    const account = this.groups.flatMap((g) => g.accounts).find((a) => a.provider === provider && a.id === id);
    if (account) void vscode.commands.executeCommand(`hiventiqByok.${cmd}`, { account });
  }
}

module.exports = { AccountsPanel };
