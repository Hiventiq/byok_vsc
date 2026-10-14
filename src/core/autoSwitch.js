"use strict";
// Pure auto-switch decision: which account (if any) to move to right now.
const { worstUsed, isNum } = require("./usage");

function inCooldown(lastSwitchAt, nowMs, cooldownMs) {
  return isNum(lastSwitchAt) && nowMs - lastSwitchAt < cooldownMs;
}

function isCandidate(account, threshold) {
  const used = worstUsed(account);
  return !account.active && !account.needs_reauth && account.stored !== false
    && used !== null && used < threshold;
}

function rank(account, order) {
  const at = order.indexOf(account.key || account.id);
  return [at === -1 ? Number.MAX_SAFE_INTEGER : at, worstUsed(account)];
}

function byRank(order) {
  return (a, b) => {
    const [ai, au] = rank(a, order);
    const [bi, bu] = rank(b, order);
    return ai - bi || au - bu;
  };
}

// Returns the id to switch to, or null. Only moves off an active account at/over the threshold.
function decideSwitch({ accounts, threshold, order = [], lastSwitchAt, nowMs, cooldownMs }) {
  const active = accounts.find((a) => a.active);
  if (!active || inCooldown(lastSwitchAt, nowMs, cooldownMs)) return null;
  const used = worstUsed(active);
  if (used === null || used < threshold) return null;
  const best = accounts.filter((a) => isCandidate(a, threshold)).sort(byRank(order))[0];
  return best ? best.id : null;
}

module.exports = { decideSwitch };
