"use strict";

const crypto = require("crypto");

const RATE_LIMITS = Object.freeze({
  syncRewardEvents: { limit: 120, windowSeconds: 60 },
  exportDashboardHistory: { limit: 12, windowSeconds: 60 * 60 },
  createCloudBackup: { limit: 12, windowSeconds: 60 * 60 },
  restoreCloudBackup: { limit: 12, windowSeconds: 60 * 60 },
  createCheckoutSession: { limit: 8, windowSeconds: 60 * 60 },
  createCustomerPortalSession: { limit: 12, windowSeconds: 60 * 60 },
  createLinkSession: { limit: 20, windowSeconds: 60 * 60 },
  approveLinkSession: { limit: 30, windowSeconds: 60 * 60 },
  exchangeLinkSession: { limit: 30, windowSeconds: 60 * 60 }
});

function parseMillis(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isNaN(millis) ? null : millis;
  }
  if (typeof value.toDate === "function") {
    return value.toDate().getTime();
  }
  return null;
}

function subjectHash(subject) {
  return crypto.createHash("sha256").update(String(subject || "unknown")).digest("hex");
}

function rateLimitDocId(operation, subject) {
  return `${String(operation || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_")}_${subjectHash(subject).slice(0, 40)}`;
}

function rateLimitDecision({
  state = {},
  limit,
  windowSeconds,
  now = new Date().toISOString()
} = {}) {
  const nowMillis = parseMillis(now) || Date.now();
  const windowMillis = Math.max(1, Number(windowSeconds || 60)) * 1000;
  const max = Math.max(1, Number(limit || 1));
  const startMillis = parseMillis(state.windowStartAt);
  const expired = !startMillis || nowMillis - startMillis >= windowMillis;
  const windowStartAt = expired ? new Date(nowMillis).toISOString() : state.windowStartAt;
  const resetAt = new Date((expired ? nowMillis : startMillis) + windowMillis).toISOString();
  const previousCount = expired ? 0 : Number(state.count || 0);
  const nextCount = previousCount + 1;
  const allowed = nextCount <= max;
  return {
    ok: allowed,
    count: allowed ? nextCount : previousCount,
    attemptedCount: nextCount,
    limit: max,
    windowSeconds: Math.round(windowMillis / 1000),
    windowStartAt,
    resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((parseMillis(resetAt) - nowMillis) / 1000))
  };
}

async function recordRateLimit({ db, operation, subject, subjectType = "unknown", policy, now = new Date().toISOString() }) {
  const limit = policy && policy.limit;
  const windowSeconds = policy && policy.windowSeconds;
  const docId = rateLimitDocId(operation, subject);
  const ref = db.doc(`operationalRateLimits/${docId}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const state = snapshot.exists ? snapshot.data() : {};
    const decision = rateLimitDecision({
      state,
      limit,
      windowSeconds,
      now
    });
    const rejectedCount = Number(state.rejectedCount || 0) + (decision.ok ? 0 : 1);
    transaction.set(ref, {
      operation,
      subjectType,
      subjectHash: subjectHash(subject),
      privacyClass: "abstract",
      windowStartAt: decision.windowStartAt,
      resetAt: decision.resetAt,
      count: decision.count,
      attemptedCount: decision.attemptedCount,
      rejectedCount,
      limit: decision.limit,
      windowSeconds: decision.windowSeconds,
      updatedAt: now,
      lastRejectedAt: decision.ok ? state.lastRejectedAt || null : now
    }, { merge: true });
    return decision;
  });
}

function rateLimitPublicDetails(operation, decision) {
  return {
    reason: "rate_limit_exceeded",
    operation,
    limit: decision.limit,
    windowSeconds: decision.windowSeconds,
    retryAfterSeconds: decision.retryAfterSeconds,
    resetAt: decision.resetAt
  };
}

module.exports = {
  RATE_LIMITS,
  rateLimitDecision,
  rateLimitDocId,
  rateLimitPublicDetails,
  recordRateLimit,
  subjectHash
};
