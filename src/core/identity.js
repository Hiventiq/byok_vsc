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

// The config's oauthAccount block describes the live login only while its email is the one
// the token resolves to. After a switch to an account saved without a snapshot the block
// still names the previous account; trusting it then files one account's token under
// another's name (seen 2026-10-17: a byok row and this vault disagreed on whose token the
// live file held, and both tools spent each other's single-use refresh tokens).
function snapshotFor(snapshot, email) {
  return snapshot && emailOfSnapshot(snapshot) === normalizeEmail(email) ? snapshot : null;
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
  normalizeEmail, snapshotFromConfig, emailOfSnapshot, snapshotFor, patchedConfig,
  accessToken, subscriptionOf, oauthOf, isExpired, withRefreshed,
};
