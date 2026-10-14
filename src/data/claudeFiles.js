"use strict";
// The Claude CLI's own files: ~/.claude/.credentials.json and ~/.claude.json.
const path = require("node:path");
const { readJson, writeJsonAtomic, backupFile } = require("./jsonFile");

function createClaudeFiles({ home, backupDir, now = Date.now }) {
  const credsPath = path.join(home, ".claude", ".credentials.json");
  const configPath = path.join(home, ".claude.json");

  return {
    credsPath,
    configPath,
    // A missing or corrupt credential file reads as "not signed in".
    readCreds() {
      try {
        return readJson(credsPath);
      } catch {
        return null;
      }
    },
    writeCreds: (data) => writeJsonAtomic(credsPath, data),
    // A corrupt config throws, so a patch can never overwrite what it could not read.
    readConfig: () => readJson(configPath),
    writeConfig: (data) => writeJsonAtomic(configPath, data),
    backup() {
      return [credsPath, configPath].map((file) => backupFile(file, backupDir, now()));
    },
  };
}

module.exports = { createClaudeFiles };
