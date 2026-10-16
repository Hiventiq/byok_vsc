"use strict";
// Pure rules for the shared local account store (byok REQ-BYOK-SHR-001): the folder both the
// Hiventiq byok library and this extension read and write so each shows every saved login and
// only one of them refreshes a token at a time. Mirrored in Python by byok's shared_accounts.py;
// the folder layout, the record shape and these rules must change together.
//
// Layout: <dir>/heartbeat.json and <dir>/<provider>/<file name>.json, one file per saved login.

const path = require("node:path");

const HEARTBEAT_FILE = "heartbeat.json";
const HEARTBEAT_FRESH_MS = 10 * 60 * 1000; // the IDE is the refresher while its heartbeat is this fresh
const OWNER_IDE = "vscode";

// %LOCALAPPDATA%\Hiventiq\byok\accounts on Windows, ~/.local/share/hiventiq/byok/accounts elsewhere.
function defaultDir(env, platform, home) {
  if (platform === "win32" && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "Hiventiq", "byok", "accounts");
  return path.join(home, ".local", "share", "hiventiq", "byok", "accounts");
}

// A vault id (an email, or `email#shortid`) as a safe file name, without the extension.
function fileNameFor(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9@._+-]/g, "_");
}

// The record written for one saved login. `creds` is the CLI's own credential file content.
function accountRecord({ provider, id, email, subscription, creds, snapshot, discriminator }, nowMs, owner = OWNER_IDE) {
  return {
    version: 1, provider, id, account: email, subscription: subscription || "",
    creds, snapshot: snapshot || null, discriminator: discriminator || "",
    updated_at: nowMs, updated_by: owner,
  };
}

// The record left when a login is removed: the other tool drops its copy when that copy's
// token is no newer than `expiresAt` (a later sign-in revives the account).
function tombstone({ provider, id, email, expiresAt }, nowMs, owner = OWNER_IDE) {
  return { version: 1, provider, id, account: email, deleted: true, expires_at: expiresAt ?? null, updated_at: nowMs, updated_by: owner };
}

function isRecord(value) {
  if (!value || typeof value !== "object" || value.version !== 1) return false;
  if (typeof value.account !== "string" || typeof value.id !== "string") return false;
  if (value.deleted) return true;
  return Boolean(value.creds) && typeof value.creds === "object";
}

const isTombstone = (record) => Boolean(record.deleted);

// Whether a tombstone applies to a local copy: it does unless the local token expires later
// than the one that was deleted.
function tombstoneCovers(record, localExpiresAt) {
  if (typeof record.expires_at !== "number") return true;
  return typeof localExpiresAt !== "number" || localExpiresAt <= record.expires_at;
}

// Whether the file's credential is a later rotation than the local one: a later access-token
// expiry wins; equal expiries mean the same token, so there is nothing to take.
function fileIsNewer(fileCreds, localCreds, expiresAtOf) {
  const theirs = expiresAtOf(fileCreds);
  const mine = expiresAtOf(localCreds);
  if (typeof theirs !== "number") return false;
  return typeof mine !== "number" || theirs > mine;
}

// The record with a usage reading attached, so the other tool can show it without a call
// of its own (the usage endpoint rate-limits per access token, which both now share).
function withUsage(record, usage, nowMs, owner = OWNER_IDE) {
  return { ...record, usage, usage_at: nowMs, usage_by: owner };
}

// The reading in a record when it is younger than `maxAgeMs` (null when none or too old).
function freshUsage(record, nowMs, maxAgeMs) {
  if (!record || !record.usage || typeof record.usage_at !== "number") return null;
  const age = nowMs - record.usage_at;
  return age >= 0 && age < maxAgeMs ? { usage: record.usage, at: record.usage_at } : null;
}

function heartbeat(nowMs, pid, owner = OWNER_IDE) {
  return { owner, at: nowMs, pid };
}

// Whether a heartbeat says another refresher is alive. This extension is always the refresher
// while it runs (it writes the heartbeat); byok defers to it with this same rule.
function heartbeatIsFresh(hb, nowMs, freshMs = HEARTBEAT_FRESH_MS) {
  return Boolean(hb) && typeof hb.at === "number" && nowMs - hb.at < freshMs && nowMs >= hb.at - freshMs;
}

module.exports = {
  HEARTBEAT_FILE, HEARTBEAT_FRESH_MS, OWNER_IDE,
  defaultDir, fileNameFor, accountRecord, tombstone, isRecord, isTombstone, tombstoneCovers, fileIsNewer,
  withUsage, freshUsage, heartbeat, heartbeatIsFresh,
};
