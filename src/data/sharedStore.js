"use strict";
// The shared local account folder on disk (see core/sharedAccounts.js). Owner-only on Windows
// (icacls, best effort) and 0700 elsewhere, the same protection as the CLIs' own credential files.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readJson, writeJsonAtomic } = require("./jsonFile");
const shared = require("../core/sharedAccounts");

function restrictToOwner(dir, env, platform) {
  if (platform !== "win32") {
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
    return;
  }
  const user = env.USERNAME;
  const systemRoot = env.SystemRoot || env.SYSTEMROOT;
  if (!user || !systemRoot) return;
  // A fixed path, not a PATH lookup, so a writable directory on PATH cannot supply a fake icacls.
  const icacls = path.join(systemRoot, "System32", "icacls.exe");
  spawnSync(icacls, [dir, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`], { windowsHide: true, timeout: 15000 });
}

function createSharedStore({ dir, now = Date.now, env = process.env, platform = process.platform, pid = process.pid }) {
  let prepared = false;
  function prepare() {
    if (prepared) return;
    const existed = fs.existsSync(dir);
    fs.mkdirSync(dir, { recursive: true });
    if (!existed) restrictToOwner(dir, env, platform);
    prepared = true;
  }
  const fileFor = (providerId, id) => path.join(dir, providerId, `${shared.fileNameFor(id)}.json`);

  return {
    dir,

    // Every readable record for a provider; a missing folder or a corrupt file reads as nothing.
    readAll(providerId) {
      let names;
      try { names = fs.readdirSync(path.join(dir, providerId)); } catch { return []; }
      const records = [];
      for (const name of names.filter((n) => n.endsWith(".json"))) {
        try {
          const record = readJson(path.join(dir, providerId, name));
          if (shared.isRecord(record)) records.push(record);
        } catch { /* skip a corrupt or half-written file */ }
      }
      return records;
    },

    // One record by id, or null.
    read(providerId, id) {
      try {
        const record = readJson(fileFor(providerId, id));
        return shared.isRecord(record) ? record : null;
      } catch { return null; }
    },

    // Attach a usage reading to an existing record; the credential in the file is left as is.
    writeUsage(providerId, id, usage, nowMs) {
      const record = this.read(providerId, id);
      if (!record || shared.isTombstone(record)) return false;
      prepare();
      writeJsonAtomic(fileFor(providerId, id), shared.withUsage(record, usage, nowMs));
      return true;
    },

    write(providerId, record) {
      prepare();
      writeJsonAtomic(fileFor(providerId, record.id), record);
    },

    remove(providerId, id) {
      fs.rmSync(fileFor(providerId, id), { force: true });
    },

    heartbeat() {
      prepare();
      writeJsonAtomic(path.join(dir, shared.HEARTBEAT_FILE), shared.heartbeat(now(), pid));
    },

    readHeartbeat() {
      try { return readJson(path.join(dir, shared.HEARTBEAT_FILE)); } catch { return null; }
    },
  };
}

module.exports = { createSharedStore };
