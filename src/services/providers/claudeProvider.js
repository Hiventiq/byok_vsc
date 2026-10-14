"use strict";
// Claude Code as an account provider: ~/.claude files, Anthropic usage and refresh.
const identity = require("../../core/identity");

function createClaudeProvider({ files, api }) {
  return {
    id: "claude-code",
    label: "Claude",
    keyPrefix: "", // legacy: Claude preferences and vault ids are the bare email
    loginHint: "Run `claude login` first.",
    reloadNote: "Open Claude conversations keep the old login until a new session starts.",
    files,
    accessToken: identity.accessToken,
    subscriptionOf: identity.subscriptionOf,
    isExpired: identity.isExpired,

    async liveIdentity(creds) {
      const snapshot = identity.snapshotFromConfig(files.readConfig());
      const email = identity.emailOfSnapshot(snapshot)
        || identity.normalizeEmail((await api.fetchProfile(identity.accessToken(creds))).email);
      return { email, snapshot };
    },

    // Two logins can share an email (e.g. personal and an organization). Both ids together tell
    // them apart: a different organization OR a different account under the same email splits them.
    discriminatorOf: ({ snapshot }) => (
      snapshot ? [snapshot.organizationUuid, snapshot.accountUuid].filter(Boolean).join(":") : ""
    ),
    detailOf: ({ snapshot }) => (snapshot && snapshot.organizationName) || "",

    fetchUsage: (creds) => api.fetchUsage(identity.accessToken(creds)),
    refresh: (creds) => api.refresh(creds),

    applyIdentity(snapshot) {
      const config = files.readConfig();
      if (config) files.writeConfig(identity.patchedConfig(config, snapshot));
    },
  };
}

module.exports = { createClaudeProvider };
