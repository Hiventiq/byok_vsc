"use strict";
// Pure: the Codex CLI's ~/.codex/auth.json shape. Dicts in, values out.
// Mirrors the Hiventiq byok library (Python): _codex_identity and _codex_account_id in its
// cli_providers.py. Keep the two in step.
const { decodeJwtPayload } = require("./jwt");
const { normalizeEmail } = require("./identity");

const AUTH_CLAIM = "https://api.openai.com/auth";
const EXPIRY_SKEW_MS = 60 * 1000;

const tokensOf = (creds) => (creds && creds.tokens) || {};
const accessToken = (creds) => tokensOf(creds).access_token || "";
const idClaims = (creds) => decodeJwtPayload(tokensOf(creds).id_token) || {};

const emailOf = (creds) => normalizeEmail(idClaims(creds).email);

function subscriptionOf(creds) {
  const plan = (idClaims(creds)[AUTH_CLAIM] || {}).chatgpt_plan_type || "";
  if (plan) return `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
  return accessToken(creds) ? "ChatGPT account" : "";
}

function accountIdOf(creds) {
  const stored = tokensOf(creds).account_id;
  if (stored) return stored;
  const claims = decodeJwtPayload(accessToken(creds)) || {};
  return (claims[AUTH_CLAIM] || {}).chatgpt_account_id || claims.chatgpt_account_id || "";
}

// The access token is a JWT whose `exp` (seconds) says when it dies; unknown means "not expired".
function isExpired(creds, nowMs) {
  const exp = (decodeJwtPayload(accessToken(creds)) || {}).exp;
  return typeof exp === "number" && exp * 1000 - EXPIRY_SKEW_MS <= nowMs;
}

function withRefreshed(creds, tokenResponse, nowMs) {
  const tokens = { ...tokensOf(creds) };
  for (const key of ["id_token", "access_token", "refresh_token"]) {
    if (tokenResponse[key]) tokens[key] = tokenResponse[key];
  }
  return { ...creds, tokens, last_refresh: new Date(nowMs).toISOString() };
}

module.exports = { accessToken, emailOf, subscriptionOf, accountIdOf, isExpired, withRefreshed };
