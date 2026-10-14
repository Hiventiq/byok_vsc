"use strict";
// HTTP only: the two OpenAI/ChatGPT endpoints the Codex CLI itself uses.
const { parseCodexUsage } = require("../core/usageParse");
const codexIdentity = require("../core/codexIdentity");

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
      if (!codexIdentity.accessToken(creds)) return { usage_error: "no access token", status: 0 };
      try {
        const res = await fetchImpl(USAGE_URL, { headers: usageHeaders(creds), signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) {
          const seconds = Number(res.headers.get("retry-after"));
          return {
            usage_error: `HTTP ${res.status}`, status: res.status,
            retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
          };
        }
        return { usage: parseCodexUsage(await res.json()), status: 200 };
      } catch {
        return { usage_error: "network error", status: 0 };
      }
    },

    // Refresh tokens are single-use: the caller must store the returned creds immediately.
    // Never return or log the tokens or the response body; only the outcome class.
    async refresh(creds) {
      const refreshToken = (creds.tokens || {}).refresh_token;
      if (!refreshToken) return { error: "no refresh token", permanent: true };
      try {
        const res = await fetchImpl(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: refreshToken }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { error: `HTTP ${res.status}`, permanent: PERMANENT_REFRESH_ERRORS.some((code) => text.includes(code)) };
        }
        return { creds: codexIdentity.withRefreshed(creds, await res.json(), now()) };
      } catch {
        return { error: "network error", permanent: false };
      }
    },
  };
}

module.exports = { createOpenaiApi };
