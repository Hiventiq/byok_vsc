"use strict";
// The Claude CLI's own login: ~/.claude/.credentials.json (or the OS keychain on macOS) and ~/.claude.json.
const path = require("node:path");
const { readJson, writeJsonAtomic, backupFile, backupData } = require("./jsonFile");

function createClaudeFiles({ home, backupDir, keychain = null, now = Date.now }) {
  const credsPath = path.join(home, ".claude", ".credentials.json");
  const configPath = path.join(home, ".claude.json");
  const held = () => (keychain ? keychain.read() : null);

  return {
    credsPath,
    configPath,
    // The login is wherever the CLI put it: the keychain first, else the file.
    // A missing or corrupt source reads as "not signed in".
    readCreds() {
      const fromKeychain = held();
      if (fromKeychain) return fromKeychain;
      try {
        return readJson(credsPath);
      } catch {
        return null;
      }
    },
    // A login goes back where the current one lives, so the CLI finds it on its next start.
    writeCreds(data) {
      if (held()) keychain.write(data);
      else writeJsonAtomic(credsPath, data);
    },
    // A corrupt config throws, so a patch can never overwrite what it could not read.
    readConfig: () => readJson(configPath),
    writeConfig: (data) => writeJsonAtomic(configPath, data),
    backup() {
      const copies = [credsPath, configPath].map((file) => backupFile(file, backupDir, now()));
      const fromKeychain = held();
      if (fromKeychain) copies.push(backupData(JSON.stringify(fromKeychain), backupDir, "credentials.keychain", now()));
      return copies;
    },
  };
}

module.exports = { createClaudeFiles };
