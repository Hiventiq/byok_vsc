"use strict";
// Stored accounts: credentials in the OS-encrypted secret store, a token-free index in state.
// The defaults are the original (Claude) names, so existing saved accounts keep working.

// `secrets` is vscode SecretStorage; `state` is a Memento. Both are injected.
function createVault({
  secrets, state, indexKey = "hiventiqByok.accounts", secretPrefix = "hiventiqByok.account.",
}) {
  const index = () => state.get(indexKey, []);
  const secretKey = (id) => `${secretPrefix}${id}`;

  return {
    list: index,
    has: (id) => index().some((a) => a.id === id),

    async get(id) {
      const raw = await secrets.get(secretKey(id));
      return raw ? JSON.parse(raw) : null;
    },

    async put(id, record) {
      await secrets.store(secretKey(id), JSON.stringify(record));
      const meta = {
        id, email: record.email, subscription: record.subscription || "", discriminator: record.discriminator ?? "",
      };
      await state.update(indexKey, [...index().filter((a) => a.id !== id), meta]);
    },

    async remove(id) {
      await secrets.delete(secretKey(id));
      await state.update(indexKey, index().filter((a) => a.id !== id));
    },
  };
}

module.exports = { createVault };
