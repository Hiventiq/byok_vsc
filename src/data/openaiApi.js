"use strict";
// HTTP only: the two OpenAI/ChatGPT endpoints the Codex CLI itself uses.
// The same endpoints are called by the Hiventiq byok library (Python): _fetch_codex_usage and
// _refresh_codex_token in its cli_providers.py. If OpenAI changes an endpoint or a response
// shape, change both.
const { parseCodexUsage } = require("../core/usageParse");
const codexIdentity = require("../core/codexIdentity");
const result = require("../core/httpResult");

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"; // Codex CLI's public OAuth client id
const TIMEOUT_MS = 20000;
const PERMANENT_REFRESH_ERRORS = ["refresh_token_reused", "refresh_token_expired", "refresh_token_invalidated", "invalid_grant"];

function usageHeaders(creds) {
  const headers = {
    Authorization: `Bearer ${codexIdentity.accessToken(creds)}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const accountId = codexIdentity.accountIdOf(creds);
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  return headers;
}

function createOpenaiApi({ fetchImpl = fetch, now = Date.now } = {}) {
  return {
    async fetchUsage(creds) {
      if (!codexIdentity.accessToken(creds)) return result.usageMissingToken();
      try {
        const res = await fetchImpl(USAGE_URL, { headers: usageHeaders(creds), signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return result.usageHttpError(res.status, res.headers.get("retry-after"));
        return { usage: parseCodexUsage(await res.json()), status: 200 };
      } catch {
        return result.usageNetworkError();
      }
    },

    // Refresh tokens are single-use: the caller must store the returned creds immediately.
    // Never return or log the tokens or the response body; only the outcome class.
    async refresh(creds) {
      const refreshToken = (creds.tokens || {}).refresh_token;
      if (!refreshToken) return result.refreshMissingToken();
      try {
        const res = await fetchImpl(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: refreshToken }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return result.refreshHttpError(res.status, PERMANENT_REFRESH_ERRORS.some((code) => text.includes(code)));
        }
        return { creds: codexIdentity.withRefreshed(creds, await res.json(), now()) };
      } catch {
        return result.refreshNetworkError();
      }
    },
  };
}

module.exports = { createOpenaiApi };
