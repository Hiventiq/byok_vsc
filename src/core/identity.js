"use strict";
// Pure: the CLI's identity block and OAuth credential shape. Dicts in, dicts out.
// Mirrors the Hiventiq byok library (Python): cli_identity.py (snapshot, match, patch) and the
// Claude parts of cli_providers.py (credential shape, token refresh). Keep the two in step.

const OAUTH_KEY = "oauthAccount";
const EMAIL_KEY = "emailAddress";
const EXPIRY_SKEW_MS = 60 * 1000;
const DEFAULT_LIFETIME_S = 28800;

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function snapshotFromConfig(config) {
  const block = config && config[OAUTH_KEY];
  if (!block || typeof block !== "object" || !normalizeEmail(block[EMAIL_KEY])) return null;
  return JSON.parse(JSON.stringify(block));
}

function emailOfSnapshot(snapshot) {
  return snapshot ? normalizeEmail(snapshot[EMAIL_KEY]) : "";
}

function patchedConfig(config, snapshot) {
  return { ...config, [OAUTH_KEY]: JSON.parse(JSON.stringify(snapshot)) };
}

function oauthOf(creds) {
  return (creds && creds.claudeAiOauth) || {};
}

function accessToken(creds) {
  return oauthOf(creds).accessToken || "";
}

function subscriptionOf(creds) {
  return oauthOf(creds).subscriptionType || "";
}

function isExpired(creds, nowMs) {
  const expiresAt = oauthOf(creds).expiresAt;
  return typeof expiresAt === "number" && expiresAt - EXPIRY_SKEW_MS <= nowMs;
}

function withRefreshed(creds, tokenResponse, nowMs) {
  const oauth = oauthOf(creds);
  const lifetime = Number(tokenResponse.expires_in || DEFAULT_LIFETIME_S);
  return {
    ...creds,
    claudeAiOauth: {
      ...oauth,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token || oauth.refreshToken,
      expiresAt: Math.round(nowMs + lifetime * 1000),
    },
  };
}

module.exports = {
  normalizeEmail, snapshotFromConfig, emailOfSnapshot, patchedConfig,
  accessToken, subscriptionOf, oauthOf, isExpired, withRefreshed,
};
