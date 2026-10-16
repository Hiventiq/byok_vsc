"use strict";
// Codex CLI as an account provider: ~/.codex/auth.json, ChatGPT usage and OpenAI refresh.
const codexIdentity = require("../../core/codexIdentity");

function createCodexProvider({ files, api }) {
  return {
    id: "codex",
    label: "Codex",
    keyPrefix: "codex:",
    loginHint: "Run `codex login` first.",
    reloadNote: "Restart any open Codex session to use the new login.",
    files,
    accessToken: codexIdentity.accessToken,
    subscriptionOf: codexIdentity.subscriptionOf,
    isExpired: codexIdentity.isExpired,
    expiresAtOf: codexIdentity.expiresAtOf,
    refreshTokenOf: (creds) => ((creds && creds.tokens) || {}).refresh_token || "",

    // The email is inside the id_token; Codex has no separate identity file to patch.
    liveIdentity: async (creds) => ({ email: codexIdentity.emailOf(creds), snapshot: null }),

    // A ChatGPT login can have several workspaces under one email; the account id tells them apart.
    discriminatorOf: ({ creds }) => (creds ? codexIdentity.accountIdOf(creds) : ""),
    detailOf: () => "",

    fetchUsage: (creds) => api.fetchUsage(creds),
    refresh: (creds) => api.refresh(creds),
    applyIdentity() {},
  };
}

module.exports = { createCodexProvider };
