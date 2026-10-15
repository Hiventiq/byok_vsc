"use strict";
// Optional coloured percent badge (two characters at most, a VS Code limit) beside each account.
const vscode = require("vscode");
const { level, worstUsed } = require("../core/usage");

const SCHEME = "hiventiq-byok";
const COLOR = { ok: "charts.green", warn: "charts.yellow", critical: "charts.red" };

const uriFor = (account) => vscode.Uri.from({ scheme: SCHEME, path: `/${encodeURIComponent(`${account.provider}:${account.id}`)}` });

class AccountDecorations {
  constructor() {
    this.byUri = new Map();
    this._changed = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this._changed.event;
  }

  uriFor(account) {
    return uriFor(account);
  }

  update(groups, warnAt) {
    this.byUri.clear();
    for (const account of groups.flatMap((g) => g.accounts)) {
      const used = worstUsed(account);
      if (used == null) continue;
      this.byUri.set(uriFor(account).toString(), { used, lvl: level(used, warnAt) });
    }
    this._changed.fire(undefined);
  }

  provideFileDecoration(uri) {
    const hit = this.byUri.get(uri.toString());
    if (!hit) return undefined;
    const badge = hit.used >= 100 ? "!!" : String(Math.round(hit.used));
    return new vscode.FileDecoration(badge, `${Math.round(hit.used)}% used`, new vscode.ThemeColor(COLOR[hit.lvl]));
  }
}

module.exports = { AccountDecorations };
