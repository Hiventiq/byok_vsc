"use strict";
// HTTP only: the three unofficial Anthropic endpoints Claude Code itself uses.
// The same endpoints are called by the Hiventiq byok library (Python): _fetch_claude_usage,
// _claude_account_from_api and _refresh_claude_token in its cli_providers.py. If Anthropic
// changes an endpoint or a response shape, change both.
const { parseUsage } = require("../core/usageParse");
const { oauthOf, withRefreshed } = require("../core/identity");
const result = require("../core/httpResult");

const BASE = "https://api.anthropic.com";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"; // Claude Code's public OAuth client id
const TIMEOUT_MS = 20000;
const BETA = "claude-code-20250219,oauth-2025-04-20";

function bearerHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "anthropic-beta": BETA,
    "anthropic-version": "2023-06-01",
    "User-Agent": "claude-code/2.0",
  };
}

function createAnthropicApi({ fetchImpl = fetch, now = Date.now } = {}) {
  const get = (url, token) =>
    fetchImpl(url, { headers: bearerHeaders(token), signal: AbortSignal.timeout(TIMEOUT_MS) });

  return {
    async fetchProfile(token) {
      try {
        const res = await get(`${BASE}/api/oauth/profile`, token);
        if (!res.ok) return { email: "", status: res.status };
        const account = ((await res.json()).account) || {};
        return { email: account.email_address || account.email || "", status: 200 };
      } catch {
        return { email: "", status: 0 };
      }
    },

    async fetchUsage(token) {
      try {
        const res = await get(`${BASE}/api/oauth/usage`, token);
        if (!res.ok) return result.usageHttpError(res.status, res.headers.get("retry-after"));
        return { usage: parseUsage(await res.json()), status: 200 };
      } catch {
        return result.usageNetworkError();
      }
    },

    // Never log or return the tokens in an error; only the outcome class.
    async refresh(creds) {
      const refreshToken = oauthOf(creds).refreshToken;
      if (!refreshToken) return result.refreshMissingToken();
      try {
        const res = await fetchImpl(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLIENT_ID,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return result.refreshHttpError(res.status, [400, 401, 403].includes(res.status));
        return { creds: withRefreshed(creds, await res.json(), now()) };
      } catch {
        return result.refreshNetworkError();
      }
    },
  };
}

module.exports = { createAnthropicApi };
