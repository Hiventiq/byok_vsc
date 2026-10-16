"use strict";
// Pure: the usage poll interval. Anthropic rate-limits the usage endpoint, so there is a floor.
const MIN_POLL_SECONDS = 60;
const DEFAULT_POLL_SECONDS = 120;

// Milliseconds between polls for a user-chosen number of seconds; blank or invalid -> the default.
function pollMs(seconds) {
  const n = Number(seconds);
  return Math.max(MIN_POLL_SECONDS, Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_SECONDS) * 1000;
}

// A reading is reused for slightly less than the interval, so every poll takes a fresh one.
const usageTtlMs = (seconds) => Math.floor(pollMs(seconds) * 0.9);

module.exports = { MIN_POLL_SECONDS, DEFAULT_POLL_SECONDS, pollMs, usageTtlMs };
