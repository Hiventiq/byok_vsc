"use strict";
// Generic JSON file helpers: atomic replace, tolerant read, timestamped backup with pruning.
const fs = require("node:fs");
const path = require("node:path");

const KEEP_BACKUPS = 10;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.hiventiq-tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function stamp(nowMs) {
  return new Date(nowMs).toISOString().replace(/[:.]/g, "-");
}

function pruneBackups(dir, prefix, keep = KEEP_BACKUPS) {
  const names = fs.readdirSync(dir).filter((n) => n.startsWith(`${prefix}.`)).sort();
  for (const old of names.slice(0, Math.max(0, names.length - keep))) {
    fs.rmSync(path.join(dir, old), { force: true });
  }
}

function backupFile(file, dir, nowMs) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(dir, { recursive: true });
  const prefix = path.basename(file).replace(/^\./, "");
  const target = path.join(dir, `${prefix}.${stamp(nowMs)}`);
  fs.copyFileSync(file, target);
  fs.chmodSync(target, 0o600);
  pruneBackups(dir, prefix);
  return target;
}

module.exports = { readJson, writeJsonAtomic, backupFile };
