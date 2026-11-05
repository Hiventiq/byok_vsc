"use strict";
// Claude Code as an account provider: ~/.claude files, Anthropic usage and refresh.
const identity = require("../../core/identity");

const PROFILE_TTL_MS = 5 * 60 * 1000; // the profile of one token is asked for at most this often

function createClaudeProvider({ files, api, now = Date.now }) {
  const profiles = new Map(); // access token -> { email, at }

  async function profileEmail(token) {
    if (!token) return "";
    const hit = profiles.get(token);
    if (hit && now() - hit.at < PROFILE_TTL_MS) return hit.email;
    const email = identity.normalizeEmail((await api.fetchProfile(token)).email);
    if (email) profiles.set(token, { email, at: now() });
    return email;
  }

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
    expiresAtOf: (creds) => { const at = identity.oauthOf(creds).expiresAt; return typeof at === "number" ? at : null; },
    refreshTokenOf: (creds) => identity.oauthOf(creds).refreshToken || "",

    // The token says whose login this is (the profile endpoint, as the byok library does);
    // the config's oauthAccount is only a fallback when the vendor cannot be asked, and its
    // snapshot rides along only when it names that same account.
    async liveIdentity(creds) {
      const snapshot = identity.snapshotFromConfig(files.readConfig());
      const email = (await profileEmail(identity.accessToken(creds)))
        || identity.emailOfSnapshot(snapshot);
      return { email, snapshot: identity.snapshotFor(snapshot, email) };
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
