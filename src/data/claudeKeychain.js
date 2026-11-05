"use strict";
// Claude Code on macOS keeps its login in the login keychain, not in ~/.claude/.credentials.json:
// one generic password (service "Claude Code-credentials", account = the login user name)
// holding the same JSON the file would. Read and written through the `security` tool.
const SERVICE = "Claude Code-credentials";

function quote(s) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function createClaudeKeychain({ platform, user, execFile }) {
  const enabled = platform === "darwin" && Boolean(user);
  const security = (args, input) => execFile("security", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

  // A missing or unreadable entry reads as "not signed in", like a missing file.
  function read() {
    if (!enabled) return null;
    try {
      return JSON.parse(security(["find-generic-password", "-s", SERVICE, "-a", user, "-w"]));
    } catch {
      return null;
    }
  }

  // The secret travels on stdin (the tool's interactive mode), never on a command line where
  // `ps` could show it; the entry is read back so a silent misquote cannot pass as a switch.
  function write(data) {
    const json = JSON.stringify(data);
    security(["-i"], `add-generic-password -U -s ${quote(SERVICE)} -a ${quote(user)} -w ${quote(json)}\n`);
    if (JSON.stringify(read()) !== json) throw new Error("The Claude login was not written to the keychain.");
  }

  return { enabled, service: SERVICE, read, write };
}

module.exports = { createClaudeKeychain };
