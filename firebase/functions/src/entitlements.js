"use strict";

const ENTITLEMENT_SCHEMA_VERSION = 1;
const DEFAULT_MAX_STALENESS_MS = 24 * 60 * 60 * 1000;

const FREE_FEATURES = Object.freeze({
  nearRealTimeSync: false,
  manualRefresh: true,
  deviceManagement: false,
  backupRestore: false,
  advancedDashboard: false,
  premiumCosmetics: false,
  weeklyDigest: false,
  exports: false,
  priorityBetaAccess: false
});

const PRO_FEATURES = Object.freeze({
  nearRealTimeSync: true,
  manualRefresh: true,
  deviceManagement: true,
  backupRestore: true,
  advancedDashboard: true,
  premiumCosmetics: true,
  weeklyDigest: true,
  exports: true,
  priorityBetaAccess: true
});

const PLAN_ENTITLEMENTS = Object.freeze({
  free: Object.freeze({
    plan: "free",
    syncCadenceSeconds: 60,
    maxDevices: 1,
    historyRetentionDays: 7,
    features: FREE_FEATURES
  }),
  pro_monthly: Object.freeze({
    plan: "pro_monthly",
    syncCadenceSeconds: 10,
    maxDevices: 5,
    historyRetentionDays: 365,
    features: PRO_FEATURES
  }),
  pro_annual: Object.freeze({
    plan: "pro_annual",
    syncCadenceSeconds: 10,
    maxDevices: 5,
    historyRetentionDays: 365,
    features: PRO_FEATURES
  })
});

const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const PERIOD_REMAINING_STATUSES = new Set(["canceled"]);
const GRACE_STATUSES = new Set(["past_due"]);

function parseMillis(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isNaN(millis) ? null : millis;
  }
  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? null : millis;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  if (Number.isInteger(value.seconds)) {
    return (value.seconds * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000);
  }
  return null;
}

function isoFrom(value) {
  const millis = parseMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}

function normalizedNow(now) {
  const millis = parseMillis(now) || Date.now();
  return {
    millis,
    iso: new Date(millis).toISOString()
  };
}

function withPlanFields(input, plan, billingStatus, entitlementStatus, accessReason, nowIso) {
  const planFields = PLAN_ENTITLEMENTS[plan] || PLAN_ENTITLEMENTS.free;
  return {
    ownerUid: input && input.ownerUid ? input.ownerUid : null,
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    privacyClass: "abstract",
    plan: planFields.plan,
    billingStatus,
    entitlementStatus,
    accessReason,
    provider: input && input.provider ? input.provider : null,
    providerCustomerId: input && input.providerCustomerId ? input.providerCustomerId : null,
    providerSubscriptionId: input && input.providerSubscriptionId ? input.providerSubscriptionId : null,
    currentPeriodEnd: isoFrom(input && input.currentPeriodEnd),
    cancelAtPeriodEnd: Boolean(input && input.cancelAtPeriodEnd),
    syncCadenceSeconds: planFields.syncCadenceSeconds,
    maxDevices: planFields.maxDevices,
    historyRetentionDays: planFields.historyRetentionDays,
    features: {
      ...planFields.features
    },
    updatedAt: isoFrom(input && input.updatedAt),
    evaluatedAt: nowIso
  };
}

function freeEntitlement(input, reason, nowIso) {
  const billingStatus = input && input.billingStatus ? input.billingStatus : "missing";
  return withPlanFields(input || {}, "free", billingStatus, "free", reason, nowIso);
}

function proEntitlement(input, plan, status, reason, nowIso) {
  return withPlanFields(input, plan, status, "pro", reason, nowIso);
}

function isFresh(input, nowMillis, maxStalenessMs) {
  const updatedAt = parseMillis(input && input.updatedAt);
  return updatedAt !== null && (nowMillis - updatedAt) <= maxStalenessMs;
}

function evaluateEntitlement(input, options = {}) {
  const now = normalizedNow(options.now);
  const maxStalenessMs = Number.isInteger(options.maxStalenessMs)
    ? options.maxStalenessMs
    : DEFAULT_MAX_STALENESS_MS;

  if (!input || typeof input !== "object") {
    return freeEntitlement(null, "missing", now.iso);
  }
  if (!isFresh(input, now.millis, maxStalenessMs)) {
    return freeEntitlement(input, "stale", now.iso);
  }

  const requestedPlan = Object.prototype.hasOwnProperty.call(PLAN_ENTITLEMENTS, input.plan)
    ? input.plan
    : "free";
  const billingStatus = typeof input.billingStatus === "string" ? input.billingStatus : "missing";
  if (requestedPlan === "free") {
    return freeEntitlement({ ...input, billingStatus: billingStatus === "missing" ? "free" : billingStatus }, "free_plan", now.iso);
  }

  const currentPeriodEnd = parseMillis(input.currentPeriodEnd);
  const gracePeriodEnd = parseMillis(input.gracePeriodEnd);

  if (ACTIVE_STATUSES.has(billingStatus)) {
    if (currentPeriodEnd !== null && currentPeriodEnd <= now.millis) {
      return freeEntitlement(input, "period_expired", now.iso);
    }
    return proEntitlement(input, requestedPlan, billingStatus, billingStatus, now.iso);
  }

  if (PERIOD_REMAINING_STATUSES.has(billingStatus)) {
    if (input.cancelAtPeriodEnd === true && currentPeriodEnd !== null && currentPeriodEnd > now.millis) {
      return proEntitlement(input, requestedPlan, billingStatus, "paid_period_remaining", now.iso);
    }
    return freeEntitlement(input, "canceled", now.iso);
  }

  if (GRACE_STATUSES.has(billingStatus)) {
    if (gracePeriodEnd !== null && gracePeriodEnd > now.millis) {
      return proEntitlement(input, requestedPlan, billingStatus, "grace_period", now.iso);
    }
    return freeEntitlement(input, "past_due", now.iso);
  }

  return freeEntitlement(input, billingStatus === "unpaid" ? "unpaid" : "unsupported_status", now.iso);
}

function buildEntitlementProjection({ uid, billing, now = new Date().toISOString() }) {
  const source = {
    ...(billing || {}),
    ownerUid: uid,
    updatedAt: billing && billing.updatedAt ? billing.updatedAt : now
  };
  return evaluateEntitlement(source, { now });
}

function normalizedEntitlement(entitlement, options = {}) {
  return entitlement && typeof entitlement === "object" && typeof entitlement.entitlementStatus === "string"
    ? entitlement
    : evaluateEntitlement(entitlement, options);
}

function publicEntitlement(entitlement) {
  const evaluated = normalizedEntitlement(entitlement);
  return {
    plan: evaluated.plan,
    entitlementStatus: evaluated.entitlementStatus,
    accessReason: evaluated.accessReason,
    syncCadenceSeconds: evaluated.syncCadenceSeconds,
    maxDevices: evaluated.maxDevices,
    historyRetentionDays: evaluated.historyRetentionDays,
    features: {
      ...(evaluated.features || {})
    }
  };
}

function sortActiveDevices(activeDevices = []) {
  return [...activeDevices]
    .filter((device) => device && typeof device === "object" && device.status !== "revoked")
    .sort((left, right) => {
      const leftTime = parseMillis(left.createdAt) || 0;
      const rightTime = parseMillis(right.createdAt) || 0;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return String(left.deviceId || "").localeCompare(String(right.deviceId || ""));
    });
}

function deviceLimitDecision({ entitlement, activeDevices = [], deviceId = null, creatingNew = false }) {
  const evaluated = normalizedEntitlement(entitlement);
  const maxDevices = Number(evaluated.maxDevices || 0);
  const devices = sortActiveDevices(activeDevices);

  if (creatingNew && devices.length >= maxDevices) {
    return {
      ok: false,
      reason: "plan_limit_device_count",
      maxDevices,
      activeDevices: devices.length
    };
  }

  if (deviceId) {
    const rank = devices.findIndex((device) => device.deviceId === deviceId);
    if (rank >= maxDevices || (rank === -1 && devices.length >= maxDevices)) {
      return {
        ok: false,
        reason: "plan_limit_device_count",
        maxDevices,
        activeDevices: devices.length,
        deviceId
      };
    }
  }

  return {
    ok: true,
    maxDevices,
    activeDevices: devices.length
  };
}

function syncCadenceStatus({ entitlement, lastAcceptedBatchAt = null, now = new Date().toISOString() }) {
  const evaluated = normalizedEntitlement(entitlement, { now });
  const cadenceSeconds = Math.max(0, Number(evaluated.syncCadenceSeconds || 0));
  const lastMillis = parseMillis(lastAcceptedBatchAt);
  const nowMillis = parseMillis(now) || Date.now();
  const mode = evaluated.features && evaluated.features.nearRealTimeSync ? "near_real_time" : "batch";
  if (lastMillis === null || cadenceSeconds <= 0) {
    return {
      cadenceSeconds,
      mode,
      nextEligibleSyncAt: null,
      retryAfterSeconds: 0,
      canAcceptNow: true
    };
  }

  const cadenceMs = cadenceSeconds * 1000;
  const nextEligibleMillis = lastMillis + cadenceMs;
  const retryAfterSeconds = nextEligibleMillis > nowMillis ? Math.ceil((nextEligibleMillis - nowMillis) / 1000) : 0;
  return {
    cadenceSeconds,
    mode,
    nextEligibleSyncAt: new Date(nextEligibleMillis).toISOString(),
    retryAfterSeconds,
    canAcceptNow: retryAfterSeconds <= 0
  };
}

function syncCadenceDecision({ entitlement, lastAcceptedBatchAt = null, now = new Date().toISOString(), acceptedCount = 1 }) {
  const status = syncCadenceStatus({ entitlement, lastAcceptedBatchAt, now });
  if (Number(acceptedCount || 0) <= 0 || status.cadenceSeconds <= 0) {
    return { ok: true, ...status };
  }

  if (!status.canAcceptNow) {
    return {
      ok: false,
      reason: "plan_limit_sync_cadence",
      ...status
    };
  }

  return { ok: true, ...status };
}

module.exports = {
  DEFAULT_MAX_STALENESS_MS,
  ENTITLEMENT_SCHEMA_VERSION,
  PLAN_ENTITLEMENTS,
  buildEntitlementProjection,
  deviceLimitDecision,
  evaluateEntitlement,
  normalizedEntitlement,
  parseMillis,
  publicEntitlement,
  sortActiveDevices,
  syncCadenceStatus,
  syncCadenceDecision
};
