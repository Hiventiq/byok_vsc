"use strict";
// Thin wiring: the providers' services, the two views, the commands and one poll timer.
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");
const { buildServices } = require("./services/buildServices");
const { decideSwitch } = require("./core/autoSwitch");
const labels = require("./core/labels");
const accountsSetting = require("./core/accountsSetting");
const prefsCore = require("./core/prefs");
const { createPrefsStore } = require("./data/prefsStore");
const { AccountsTree } = require("./ui/accountsTree");
const { createStatusBar } = require("./ui/statusBar");

const settings = () => vscode.workspace.getConfiguration("hiventiqByok");

async function offerReload(note, label) {
  const choice = await vscode.window.showInformationMessage(`Switched to ${label}. ${note}`, "Reload Window");
  if (choice === "Reload Window") await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

// One-time: carry over names/order a user already typed into the old `accounts` JSON setting.
function importLegacySetting(prefs) {
  if (prefs.exists()) return;
  const list = settings().get("accounts");
  const order = accountsSetting.orderFrom(list);
  if (order.length) prefs.save({ order, names: accountsSetting.aliasesFrom(list) });
}

function pickItems(accounts) {
  const several = new Set(accounts.map((a) => a.provider)).size > 1;
  return accounts.filter((a) => a.stored !== false).map((a) => ({
    label: `${a.active ? "$(check) " : ""}${labels.displayName(a)}`,
    description: [several ? a.providerLabel : "", a.name ? a.email : "", a.subscription].filter(Boolean).join(" · "),
    account: a,
  }));
}

function activate(context) {
  const runtimes = buildServices({
    home: os.homedir(),
    codexHome: process.env.CODEX_HOME,
    backupDir: path.join(context.globalStorageUri.fsPath, "backups"),
    secrets: context.secrets,
    state: context.globalState,
  }).map(({ service, alwaysShow }, i) => ({
    service,
    provider: service.provider,
    alwaysShow,
    statusBar: createStatusBar({ provider: service.provider, priority: 100 - i, alwaysShow }),
    accounts: [],
  }));
  const runtimeFor = (providerId) => runtimes.find((r) => r.provider.id === providerId);

  const tree = new AccountsTree();
  const prefs = createPrefsStore(context.globalState);
  const state = { busy: false, lastAutoSwitchAt: {} };
  importLegacySetting(prefs);

  const allAccounts = () => runtimes.flatMap((r) => r.accounts);

  async function listOne(runtime, force, { order, names }) {
    try {
      const listed = await runtime.service.list({ force });
      const tagged = listed.map((a) => ({ ...a, providerLabel: runtime.provider.label }));
      runtime.accounts = labels.withAliases(prefsCore.orderAccounts(tagged, order), names);
      runtime.error = undefined;
    } catch (err) {
      runtime.accounts = [];
      runtime.error = err.message;
    }
  }

  function render() {
    const warnAt = settings().get("warnAtPercent");
    for (const r of runtimes) {
      if (r.error) r.statusBar.renderError(r.error);
      else r.statusBar.render(r.accounts, warnAt);
    }
    tree.update(runtimes.map((r) => ({ provider: r.provider, accounts: r.accounts, alwaysShow: r.alwaysShow })), warnAt);
  }

  async function refresh(force = false) {
    if (state.busy) return;
    state.busy = true;
    try {
      const prefValues = prefs.get();
      await Promise.all(runtimes.map((r) => listOne(r, force, prefValues)));
      render();
      await maybeAutoSwitch();
    } catch (err) {
      // Never let a background refresh reject: show the problem on the status bar instead.
      for (const r of runtimes) r.statusBar.renderError(err.message);
    } finally {
      state.busy = false;
      scheduleRetry();
    }
  }

  // After a rate limit, look again as soon as the soonest Retry-After has passed.
  function scheduleRetry() {
    clearTimeout(state.retryTimer);
    const waits = runtimes.map((r) => r.service.nextRetryInMs()).filter((ms) => ms !== null);
    if (waits.length) state.retryTimer = setTimeout(() => { void refresh(); }, Math.min(...waits) + 1000);
  }

  async function doSwitch(runtime, id, label) {
    try {
      const out = await runtime.service.switchTo(id);
      state.busy = false;
      await refresh(true);
      if (out.changed) await offerReload(runtime.provider.reloadNote, label);
    } catch (err) {
      vscode.window.showErrorMessage(err.message);
    }
  }

  // Auto-switch moves within one provider only; the first provider over its threshold goes first.
  async function maybeAutoSwitch() {
    const cfg = settings();
    if (!cfg.get("autoSwitch.enabled")) return;
    for (const runtime of runtimes) {
      const target = decideSwitch({
        accounts: runtime.accounts,
        threshold: cfg.get("autoSwitch.thresholdPercent"),
        order: prefs.get().order,
        lastSwitchAt: state.lastAutoSwitchAt[runtime.provider.id],
        nowMs: Date.now(),
        cooldownMs: cfg.get("autoSwitch.cooldownMinutes") * 60000,
      });
      if (!target) continue;
      state.lastAutoSwitchAt[runtime.provider.id] = Date.now();
      state.busy = false;
      return doSwitch(runtime, target, target);
    }
  }

  async function switchCommand(arg) {
    if (arg && arg.account) {
      return doSwitch(runtimeFor(arg.account.provider), arg.account.id, labels.displayName(arg.account));
    }
    const pool = arg && arg.providerId ? runtimeFor(arg.providerId).accounts : allAccounts();
    const picked = await vscode.window.showQuickPick(pickItems(pool), { title: "Switch account" });
    if (picked) await doSwitch(runtimeFor(picked.account.provider), picked.account.id, labels.displayName(picked.account));
  }

  // Saves the live login of every provider that has one.
  async function saveCommand() {
    const saved = [];
    const problems = [];
    for (const runtime of runtimes) {
      try {
        saved.push(`${runtime.provider.label}: ${(await runtime.service.saveCurrent()).email}`);
      } catch (err) {
        if (err.code !== "no_login") problems.push(err.message);
      }
    }
    if (saved.length) vscode.window.showInformationMessage(`Saved ${saved.join(", ")}.`);
    if (problems.length) vscode.window.showErrorMessage(problems.join(" "));
    if (!saved.length && !problems.length) {
      vscode.window.showErrorMessage("No Claude or Codex login found. Sign in with `claude login` or `codex login` first.");
    }
    await refresh(true);
  }

  async function removeCommand(node) {
    const account = node && node.account;
    if (!account) return;
    const ok = await vscode.window.showWarningMessage(`Remove ${account.email} (${account.providerLabel}) from saved accounts?`, { modal: true }, "Remove");
    if (ok === "Remove") {
      await runtimeFor(account.provider).service.remove(account.id);
      await refresh(true);
    }
  }

  async function renameCommand(node) {
    const account = node && node.account;
    if (!account) return;
    const value = await vscode.window.showInputBox({
      title: `Short name for ${account.email}`,
      prompt: "Shown in the status bar and sidebar. Leave empty to use the email.",
      value: account.name || "",
    });
    if (value === undefined) return; // cancelled
    const { order, names } = prefs.get();
    await prefs.save({ order, names: prefsCore.withName(names, account.key, value) });
    await refresh();
  }

  // Reorders within the account's own provider; order across providers never matters.
  async function moveCommand(node, delta) {
    const account = node && node.account;
    if (!account) return;
    const keysOf = (list) => list.map((a) => a.key);
    const mine = keysOf(allAccounts().filter((a) => a.provider === account.provider));
    const others = keysOf(allAccounts().filter((a) => a.provider !== account.provider));
    const moved = prefsCore.moveEmail(mine, account.key, delta);
    await prefs.save({ order: [...others, ...moved], names: prefs.get().names });
    await refresh();
  }

  const timer = setInterval(() => { void refresh(); }, Math.max(60, settings().get("pollSeconds")) * 1000);
  context.subscriptions.push(
    ...runtimes.map((r) => r.statusBar.item),
    { dispose: () => { clearInterval(timer); clearTimeout(state.retryTimer); } },
    vscode.window.registerTreeDataProvider("hiventiqByok.accounts", tree),
    vscode.commands.registerCommand("hiventiqByok.switch", switchCommand),
    vscode.commands.registerCommand("hiventiqByok.saveCurrent", saveCommand),
    vscode.commands.registerCommand("hiventiqByok.refresh", () => refresh(true)),
    vscode.commands.registerCommand("hiventiqByok.remove", removeCommand),
    vscode.commands.registerCommand("hiventiqByok.rename", renameCommand),
    vscode.commands.registerCommand("hiventiqByok.moveUp", (node) => moveCommand(node, -1)),
    vscode.commands.registerCommand("hiventiqByok.moveDown", (node) => moveCommand(node, 1)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("hiventiqByok")) void refresh();
    }),
  );
  void refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
