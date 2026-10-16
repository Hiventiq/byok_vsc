"use strict";
// Composition: one account service per provider, each with its own vault namespace.
// Claude keeps the original vault names so accounts saved before Codex existed still load.
const { createClaudeFiles } = require("../data/claudeFiles");
const { createCodexFiles } = require("../data/codexFiles");
const { createAnthropicApi } = require("../data/anthropicApi");
const { createOpenaiApi } = require("../data/openaiApi");
const { createVault } = require("../data/vault");
const { createAccountService } = require("./accountService");
const { createClaudeProvider } = require("./providers/claudeProvider");
const { createCodexProvider } = require("./providers/codexProvider");

function buildServices({ home, codexHome, backupDir, secrets, state, usageTtlMs, shared = null }) {
  const claude = createClaudeProvider({
    files: createClaudeFiles({ home, backupDir }),
    api: createAnthropicApi(),
  });
  const codex = createCodexProvider({
    files: createCodexFiles({ home, codexHome, backupDir }),
    api: createOpenaiApi(),
  });
  return [
    { alwaysShow: true, service: createAccountService({ provider: claude, usageTtlMs, shared, vault: createVault({ secrets, state }) }) },
    {
      alwaysShow: false,
      service: createAccountService({
        provider: codex,
        usageTtlMs,
        shared,
        vault: createVault({
          secrets, state, indexKey: "hiventiqByok.codex.accounts", secretPrefix: "hiventiqByok.codex.account.",
        }),
      }),
    },
  ];
}

module.exports = { buildServices };
