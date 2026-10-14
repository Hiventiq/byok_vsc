"use strict";
// Pure: the result objects the HTTP clients return, so each outcome has one shape in one place.
// Never put a token or a response body in any of these: only the outcome class.

// "Retry-After" in seconds -> milliseconds; 0 when absent, zero, negative or not a number.
function retryAfterMs(headerValue) {
  const seconds = Number(headerValue);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function usageHttpError(status, retryAfterHeader) {
  return { usage_error: `HTTP ${status}`, status, retryAfterMs: retryAfterMs(retryAfterHeader) };
}

function usageNetworkError() {
  return { usage_error: "network error", status: 0 };
}

function usageMissingToken() {
  return { usage_error: "no access token", status: 0 };
}

function refreshHttpError(status, permanent) {
  return { error: `HTTP ${status}`, permanent };
}

function refreshNetworkError() {
  return { error: "network error", permanent: false };
}

function refreshMissingToken() {
  return { error: "no refresh token", permanent: true };
}

module.exports = {
  retryAfterMs, usageHttpError, usageNetworkError, usageMissingToken,
  refreshHttpError, refreshNetworkError, refreshMissingToken,
};
