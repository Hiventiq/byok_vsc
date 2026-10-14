"use strict";
// Persists account preferences ({ order, names }) in the extension's globalState.
const KEY = "hiventiqByok.prefs";

// `state` is a vscode Memento, injected.
function createPrefsStore(state) {
  return {
    exists: () => state.get(KEY) !== undefined,
    get() {
      const saved = state.get(KEY) || {};
      return { order: saved.order || [], names: saved.names || {} };
    },
    save: (prefs) => state.update(KEY, prefs),
  };
}

module.exports = { createPrefsStore };
