"use strict";
// The Codex CLI's own credential file: $CODEX_HOME/auth.json (default ~/.codex/auth.json).
const path = require("node:path");
const { readJson, writeJsonAtomic, backupFile } = require("./jsonFile");

function createCodexFiles({ home, codexHome, backupDir, now = Date.now }) {
  const credsPath = path.join(codexHome || path.join(home, ".codex"), "auth.json");

  return {
    credsPath,
    // A missing or corrupt credential file reads as "not signed in".
    readCreds() {
      try {
        return readJson(credsPath);
      } catch {
        return null;
      }
    },
    writeCreds: (data) => writeJsonAtomic(credsPath, data),
    backup: () => [backupFile(credsPath, path.join(backupDir, "codex"), now())],
  };
}

module.exports = { createCodexFiles };
