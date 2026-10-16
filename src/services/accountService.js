"use strict";
// Business logic for one provider: save the live login, list accounts with usage, switch.
// Rules ported from byok: only refresh STASHED tokens (the CLI owns the live one's
// rotation), and stash the live login before switching away from it.

const { shortHash } = require("../core/hash");
const sharedRules = require("../core/sharedAccounts");

const DEFAULT_USAGE_TTL_MS = 2 * 60 * 1000; // how long a usage reading is reused; the host passes its poll interval
const RENEW_AHEAD_MS = 60 * 60 * 1000; // renew a stashed token this long before it expires
const DEFAULT_BACKOFF_MS = 60 * 1000; // used when a 429 carries no Retry-After

function createAccountService({ provider, vault, now = Date.now, usageTtlMs = () => DEFAULT_USAGE_TTL_MS, shared = null }) {
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
    const record = {
      email: live.email, creds: live.creds, snapshot: live.snapshot, discriminator: live.discriminator,
      subscription: provider.subscriptionOf(live.creds),
    };
    await vault.put(live.id, record);
    publish(live.id, record);
    return { id: live.id, email: live.email };
  }

  // The shared local store (byok REQ-BYOK-SHR-001): every saved or rotated login is written
  // there so the byok library shows it and never refreshes a token this extension just rotated.
  // A failed write never breaks the operation that caused it.
  function publish(id, record) {
    if (!shared) return;
    try {
      shared.write(provider.id, sharedRules.accountRecord({ provider: provider.id, id, ...record }, now()));
    } catch { /* the vault copy is still correct; the next write tries again */ }
  }

  // Take every login from the shared folder that this vault lacks or holds an older rotation of.
  async function importShared() {
    if (!shared) return;
    for (const file of shared.readAll(provider.id)) {
      const mine = vault.has(file.id) ? await vault.get(file.id) : null;
      if (sharedRules.isTombstone(file)) {
        if (mine && sharedRules.tombstoneCovers(file, provider.expiresAtOf(mine.creds))) await vault.remove(file.id);
        continue;
      }
      if (mine && !sharedRules.fileIsNewer(file.creds, mine.creds, provider.expiresAtOf)) continue;
      await vault.put(file.id, {
        email: file.account, creds: file.creds, snapshot: file.snapshot, discriminator: file.discriminator,
        subscription: file.subscription,
      });
      dead.delete(file.id);
    }
  }

  // The CLI rotates the live tokens itself; keep the stash in step with them.
  async function syncLive(live) {
    if (!live || !live.email || !vault.has(live.id)) return;
    const stored = await vault.get(live.id);
    if (stored && JSON.stringify(stored.creds) !== JSON.stringify(live.creds)) {
      await stash(live);
    }
  }

  // Renewal rules, ported from byok (cli_renewal.py): renew a stashed token an hour BEFORE it
  // expires, one refresh per account at a time (the refresh token is single-use), write the
  // rotated token before anything else uses it, remember a rotation that could not be written
  // instead of spending the vendor's one-shot token twice, and make no more calls on a dead chain
  // until its stored credentials change.
  const refreshing = new Map();
  const pending = new Map(); // id -> rotated creds not yet written
  const dead = new Map(); // id -> refresh-token fingerprint the vendor rejected for good

  const fingerprint = (creds) => shortHash(provider.refreshTokenOf(creds), 12);

  async function persist(id, record, creds) {
    try {
      await vault.put(id, { ...record, creds });
      pending.delete(id);
      publish(id, { ...record, creds });
    } catch {
      pending.set(id, creds); // keep it in memory; the next attempt writes it
    }
  }

  async function refreshStored(id) {
    const record = await vault.get(id);
    if (!record) return { needsReauth: true, error: "stored credentials missing" };
    if (pending.has(id)) {
      await persist(id, record, pending.get(id));
      return { creds: pending.has(id) ? pending.get(id) : (await vault.get(id)).creds };
    }
    if (dead.get(id) === fingerprint(record.creds)) return { creds: record.creds, needsReauth: true, error: "sign-in expired" };
    const out = await provider.refresh(record.creds);
    if (!out.creds) {
      if (out.permanent) dead.set(id, fingerprint(record.creds));
      return { creds: record.creds, needsReauth: out.permanent, error: out.error };
    }
    dead.delete(id);
    await persist(id, record, out.creds);
    return { creds: out.creds };
  }

  function refreshOnce(id) {
    if (!refreshing.has(id)) {
      refreshing.set(id, refreshStored(id).finally(() => refreshing.delete(id)));
    }
    return refreshing.get(id);
  }

  // A stashed login whose refresh token equals the live one is the CLI's chain: never refresh it.
  const sharesLive = (record, live) => Boolean(live) && fingerprint(record.creds) === fingerprint(live.creds)
    && fingerprint(live.creds) !== "";

  async function usableCreds(id, record, live) {
    if ((live && live.id === id) || sharesLive(record, live)) return { creds: record.creds };
    if (!provider.isExpired(record.creds, now() + RENEW_AHEAD_MS)) return { creds: record.creds };
    return refreshOnce(id);
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
  // The other tool's reading from the shared folder: fresh enough to stand in for a call, or
  // any age as a stale fallback. Null when there is none.
  function sharedReading(id, maxAgeMs) {
    if (!shared) return null;
    try {
      const found = sharedRules.freshUsage(shared.read(provider.id, id), now(), maxAgeMs);
      return found ? { at: found.at, value: { usage: found.usage, status: 200 } } : null;
    } catch { return null; }
  }

  function shareReading(id, usage) {
    if (!shared) return;
    try { shared.writeUsage(provider.id, id, usage, now()); } catch { /* best effort */ }
  }

  async function usageFor(id, creds, force) {
    const hit = usageCache.get(id);
    if (!force && hit && now() - hit.at < usageTtlMs()) return hit.value;
    const theirs = sharedReading(id, usageTtlMs());
    if (!force && theirs) {
      usageCache.set(id, theirs);
      return theirs.value;
    }
    if (now() < (blockedUntil.get(id) || 0)) {
      const last = hit || sharedReading(id, Infinity);
      return last ? withStale(last, "rate limited") : { usage_error: "rate limited, retrying later", status: 429 };
    }
    const value = await provider.fetchUsage(creds);
    if (value.usage) {
      usageCache.set(id, { at: now(), value });
      shareReading(id, value.usage);
      return value;
    }
    if (value.status === 429) blockedUntil.set(id, now() + (value.retryAfterMs || DEFAULT_BACKOFF_MS));
    const last = hit || (value.status !== 401 ? sharedReading(id, Infinity) : null);
    return last && value.status !== 401 ? withStale(last, value.usage_error) : value;
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
    const ready = await usableCreds(meta.id, record, live);
    if (ready.needsReauth) return { ...base, needs_reauth: true, usage_error: ready.error };
    let result = await usageFor(meta.id, active ? live.creds : ready.creds, force);
    if (result.status === 401 && !active) result = await retryAfterRefresh(meta.id, result);
    return { ...base, ...usageFields(result), needs_reauth: result.status === 401 };
  }

  // A stashed token the server rejects although its clock says valid (revoked or rotated
  // elsewhere): refresh it once and ask again before calling the account signed out.
  async function retryAfterRefresh(id, rejected) {
    const out = await refreshOnce(id);
    if (out.error) return out.needsReauth ? rejected : { ...rejected, status: 0, usage_error: out.error };
    return usageFor(id, out.creds, true);
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
      if (shared) { try { shared.heartbeat(); } catch { /* best effort */ } }
      await importShared();
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
      const record = await vault.get(id);
      await vault.remove(id);
      if (shared && record) {
        try {
          shared.write(provider.id, sharedRules.tombstone({
            provider: provider.id, id, email: record.email, expiresAt: provider.expiresAtOf(record.creds),
          }, now()));
        } catch { /* best effort */ }
      }
      usageCache.delete(id);
    },
  };
}

module.exports = { createAccountService };
