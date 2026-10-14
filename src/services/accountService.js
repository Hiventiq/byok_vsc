"use strict";
// Business logic for one provider: save the live login, list accounts with usage, switch.
// Rules ported from byok: only refresh STASHED tokens (the CLI owns the live one's
// rotation), and stash the live login before switching away from it.

const { shortHash } = require("../core/hash");

const USAGE_TTL_MS = 4 * 60 * 1000;
const DEFAULT_BACKOFF_MS = 60 * 1000; // used when a 429 carries no Retry-After

function createAccountService({ provider, vault, now = Date.now }) {
  const { files } = provider;
  const usageCache = new Map();
  const blockedUntil = new Map();

  const keyFor = (email) => `${provider.keyPrefix}${email}`;
  const noLogin = () => Object.assign(new Error(`No ${provider.label} login found. ${provider.loginHint}`), { code: "no_login" });

  const shortId = (discriminator) => shortHash(discriminator);

  // The workspace/organization id of a stored account. Older saved records did not keep it
  // in the index, so it is recomputed from the record itself.
  async function discriminatorOfMeta(meta) {
    if (meta.discriminator !== undefined) return meta.discriminator;
    const record = await vault.get(meta.id);
    return record ? provider.discriminatorOf(record) : "";
  }

  // The vault id for a live login. The bare email, unless that email is already saved for a
  // DIFFERENT workspace/organization: then `email#<short id>`, so two accounts can share an email.
  // An unknown id on either side matches (we cannot tell them apart, so we do not split them).
  async function resolveId(live) {
    if (!live.email) return "";
    const mine = provider.discriminatorOf(live);
    const sameEmail = vault.list().filter((meta) => meta.email === live.email);
    for (const meta of sameEmail) {
      const theirs = await discriminatorOfMeta(meta);
      if (!mine || !theirs || mine === theirs) return meta.id;
    }
    return sameEmail.length ? `${live.email}#${shortId(mine)}` : live.email;
  }

  async function readLive() {
    const creds = files.readCreds();
    if (!provider.accessToken(creds)) return null;
    const { email, snapshot } = await provider.liveIdentity(creds);
    const live = { creds, snapshot, email };
    live.discriminator = provider.discriminatorOf(live);
    live.id = await resolveId(live);
    return live;
  }

  async function stash(live) {
    if (!live.email) {
      throw new Error(`Cannot tell which account is signed in to ${provider.label}; sign in again. ${provider.loginHint}`);
    }
    await vault.put(live.id, {
      email: live.email, creds: live.creds, snapshot: live.snapshot, discriminator: live.discriminator,
      subscription: provider.subscriptionOf(live.creds),
    });
    return { id: live.id, email: live.email };
  }

  // The CLI rotates the live tokens itself; keep the stash in step with them.
  async function syncLive(live) {
    if (!live || !live.email || !vault.has(live.id)) return;
    const stored = await vault.get(live.id);
    if (stored && JSON.stringify(stored.creds) !== JSON.stringify(live.creds)) {
      await stash(live);
    }
  }

  async function usableCreds(record, isActive) {
    if (isActive || !provider.isExpired(record.creds, now())) return { creds: record.creds };
    const out = await provider.refresh(record.creds);
    if (!out.creds) return { creds: record.creds, needsReauth: out.permanent, error: out.error };
    await vault.put(record.email, { ...record, creds: out.creds });
    return { creds: out.creds };
  }

  const usageFields = (result) => ({
    ...(result.usage || {}), usage_error: result.usage_error, stale_at: result.stale_at,
  });

  // Milliseconds until the soonest rate-limit backoff ends, or null when none is active.
  const nextRetryInMs = () => {
    const waits = [...blockedUntil.values()].map((t) => t - now()).filter((ms) => ms > 0);
    return waits.length ? Math.min(...waits) : null;
  };
  const withStale = (hit, reason) => ({ usage: hit.value.usage, status: 200, stale_at: hit.at, usage_error: reason });

  // Cached ~4 min, and after a 429 no call is made until the backoff ends; the last
  // good reading is shown (marked stale) in the meantime, as byok does.
  async function usageFor(id, creds, force) {
    const hit = usageCache.get(id);
    if (!force && hit && now() - hit.at < USAGE_TTL_MS) return hit.value;
    if (now() < (blockedUntil.get(id) || 0)) {
      return hit ? withStale(hit, "rate limited") : { usage_error: "rate limited, retrying later", status: 429 };
    }
    const value = await provider.fetchUsage(creds);
    if (value.usage) {
      usageCache.set(id, { at: now(), value });
      return value;
    }
    if (value.status === 429) blockedUntil.set(id, now() + (value.retryAfterMs || DEFAULT_BACKOFF_MS));
    return hit && value.status !== 401 ? withStale(hit, value.usage_error) : value;
  }

  const baseEntry = (id, email, subscription, stored, active, source) => ({
    id, email, subscription, stored, active, provider: provider.id, key: keyFor(id),
    detail: provider.detailOf(source) || shortId(provider.discriminatorOf(source)),
  });

  async function entryFor(meta, live, force) {
    const record = await vault.get(meta.id);
    const active = Boolean(live && live.id === meta.id);
    const base = baseEntry(meta.id, meta.email, meta.subscription, true, active, record || {});
    if (!record) return { ...base, needs_reauth: true, usage_error: "stored credentials missing" };
    const ready = await usableCreds(record, active);
    if (ready.needsReauth) return { ...base, needs_reauth: true, usage_error: ready.error };
    const result = await usageFor(meta.id, active ? live.creds : ready.creds, force);
    return { ...base, ...usageFields(result), needs_reauth: result.status === 401 };
  }

  async function liveOnlyEntry(live, force) {
    const result = await usageFor(live.id || "live", live.creds, force);
    return {
      ...baseEntry(live.id, live.email || "(unknown account)", provider.subscriptionOf(live.creds), false, true, live),
      needs_reauth: result.status === 401,
      ...usageFields(result),
    };
  }

  // Rows that share an email are flagged so the UI can show what tells them apart.
  function markDuplicates(entries) {
    const counts = new Map();
    for (const e of entries) counts.set(e.email, (counts.get(e.email) || 0) + 1);
    return entries.map((e) => ({ ...e, duplicate: counts.get(e.email) > 1 }));
  }

  return {
    provider,
    nextRetryInMs,

    async list({ force = false } = {}) {
      const live = await readLive();
      await syncLive(live);
      const entries = await Promise.all(vault.list().map((m) => entryFor(m, live, force)));
      const unsaved = live && !vault.has(live.id);
      const all = unsaved ? [await liveOnlyEntry(live, force), ...entries] : entries;
      return markDuplicates(all);
    },

    async saveCurrent() {
      const live = await readLive();
      if (!live) throw noLogin();
      return stash(live);
    },

    async switchTo(id) {
      const target = await vault.get(id);
      if (!target) throw new Error(`No stored account: ${id}`);
      const live = await readLive();
      if (live && live.id === id) return { changed: false };
      if (live) await stash(live); // never lose the login we are leaving (throws if unidentifiable)
      files.backup();
      files.writeCreds(target.creds);
      if (target.snapshot) provider.applyIdentity(target.snapshot);
      usageCache.clear();
      return { changed: true };
    },

    async remove(id) {
      await vault.remove(id);
      usageCache.delete(id);
    },
  };
}

module.exports = { createAccountService };
