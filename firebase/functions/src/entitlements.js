"use strict";

const DEFAULT_PLAN = "free";
const PLAN_LIMITS = {
  free: {
    plan: "free",
    displayName: "Free",
    syncCadenceSeconds: 60,
    maxDevices: 1,
    historyRetentionDays: 14
  },
  pro: {
    plan: "pro",
    displayName: "Pro",
    syncCadenceSeconds: 5,
    maxDevices: 5,
    historyRetentionDays: 365
  }
};

function normalizedPlan(value) {
  const raw = String(value || DEFAULT_PLAN).toLowerCase();
  if (["pro", "pro_monthly", "pro_annual", "paid"].includes(raw)) {
    return "pro";
  }
  return DEFAULT_PLAN;
}

function numberOrDefault(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function resolveEntitlement(data = {}) {
  const plan = normalizedPlan(data.plan);
  const defaults = PLAN_LIMITS[plan] || PLAN_LIMITS[DEFAULT_PLAN];
  return {
    ...defaults,
    plan,
    billingStatus: data.billingStatus || (plan === "free" ? "free" : "active"),
    provider: data.provider || null,
    syncCadenceSeconds: Math.max(0, numberOrDefault(data.syncCadenceSeconds, defaults.syncCadenceSeconds)),
    maxDevices: Math.max(1, Math.floor(numberOrDefault(data.maxDevices, defaults.maxDevices))),
    historyRetentionDays: Math.max(1, Math.floor(numberOrDefault(data.historyRetentionDays, defaults.historyRetentionDays)))
  };
}

function publicEntitlement(entitlement) {
  return {
    plan: entitlement.plan,
    displayName: entitlement.displayName,
    billingStatus: entitlement.billingStatus,
    syncCadenceSeconds: entitlement.syncCadenceSeconds,
    maxDevices: entitlement.maxDevices,
    historyRetentionDays: entitlement.historyRetentionDays
  };
}

function parseTime(value) {
  const millis = Date.parse(String(value || ""));
  return Number.isFinite(millis) ? millis : null;
}

function evaluateSyncThrottle({ entitlement, syncMetadata = {}, now = new Date() }) {
  const cadenceMs = Math.max(0, Number(entitlement.syncCadenceSeconds || 0)) * 1000;
  const lastAcceptedAt = parseTime(syncMetadata.lastAcceptedBatchAt || syncMetadata.lastSuccessAt);
  if (!lastAcceptedAt || cadenceMs <= 0) {
    return {
      throttled: false,
      nextEligibleSyncAt: now.toISOString(),
      waitSeconds: 0
    };
  }

  const nextEligibleMs = lastAcceptedAt + cadenceMs;
  const nowMs = now.getTime();
  if (nowMs >= nextEligibleMs) {
    return {
      throttled: false,
      nextEligibleSyncAt: new Date(nextEligibleMs).toISOString(),
      waitSeconds: 0
    };
  }

  return {
    throttled: true,
    reason: "sync_cadence",
    nextEligibleSyncAt: new Date(nextEligibleMs).toISOString(),
    waitSeconds: Math.ceil((nextEligibleMs - nowMs) / 1000)
  };
}

module.exports = {
  DEFAULT_PLAN,
  PLAN_LIMITS,
  evaluateSyncThrottle,
  publicEntitlement,
  resolveEntitlement
};
