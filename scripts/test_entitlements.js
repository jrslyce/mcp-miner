"use strict";

const assert = require("assert");
const {
  buildEntitlementProjection,
  evaluateEntitlement
} = require("../firebase/functions/src/entitlements");

let checks = 0;
function check(message, fn) {
  assert.ok(fn(), message);
  checks += 1;
}

const NOW = "2026-05-24T00:00:00.000Z";
const FUTURE = "2026-06-24T00:00:00.000Z";
const PAST = "2026-05-20T00:00:00.000Z";

function doc(overrides = {}) {
  return {
    ownerUid: "firebase_uid_123",
    schemaVersion: 1,
    privacyClass: "abstract",
    plan: "pro_monthly",
    billingStatus: "active",
    provider: "stripe",
    providerCustomerId: "cus_test_123",
    providerSubscriptionId: "sub_test_123",
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
    syncCadenceSeconds: 10,
    maxDevices: 5,
    historyRetentionDays: 365,
    features: {},
    updatedAt: NOW,
    ...overrides
  };
}

check("missing entitlement docs should default to Free", () => {
  const result = evaluateEntitlement(null, { now: NOW });
  return result.plan === "free" &&
    result.maxDevices === 1 &&
    result.accessReason === "missing";
});

check("Free docs should evaluate to Free limits", () => {
  const result = evaluateEntitlement(doc({
    plan: "free",
    billingStatus: "free",
    provider: null,
    providerCustomerId: null,
    providerSubscriptionId: null
  }), { now: NOW });
  return result.plan === "free" &&
    result.syncCadenceSeconds === 60 &&
    result.historyRetentionDays === 7;
});

check("active Pro monthly should evaluate to Pro limits", () => {
  const result = evaluateEntitlement(doc(), { now: NOW });
  return result.plan === "pro_monthly" &&
    result.maxDevices === 5 &&
    result.features.exports === true;
});

check("active Pro annual should evaluate to Pro limits", () => {
  const result = evaluateEntitlement(doc({ plan: "pro_annual" }), { now: NOW });
  return result.plan === "pro_annual" &&
    result.syncCadenceSeconds === 10 &&
    result.historyRetentionDays === 365;
});

check("trialing subscriptions should evaluate to Pro", () => {
  const result = evaluateEntitlement(doc({ billingStatus: "trialing" }), { now: NOW });
  return result.entitlementStatus === "pro" &&
    result.accessReason === "trialing";
});

check("past_due subscriptions should keep Pro during grace", () => {
  const result = evaluateEntitlement(doc({
    billingStatus: "past_due",
    gracePeriodEnd: "2026-05-25T00:00:00.000Z"
  }), { now: NOW });
  return result.entitlementStatus === "pro" &&
    result.accessReason === "grace_period";
});

check("past_due subscriptions should fall back to Free after grace", () => {
  const result = evaluateEntitlement(doc({
    billingStatus: "past_due",
    gracePeriodEnd: PAST
  }), { now: NOW });
  return result.plan === "free" &&
    result.accessReason === "past_due";
});

check("canceled subscriptions should keep Pro through paid period", () => {
  const result = evaluateEntitlement(doc({
    billingStatus: "canceled",
    cancelAtPeriodEnd: true,
    currentPeriodEnd: FUTURE
  }), { now: NOW });
  return result.entitlementStatus === "pro" &&
    result.accessReason === "paid_period_remaining";
});

check("canceled subscriptions should fall back to Free after paid period", () => {
  const result = evaluateEntitlement(doc({
    billingStatus: "canceled",
    cancelAtPeriodEnd: true,
    currentPeriodEnd: PAST
  }), { now: NOW });
  return result.plan === "free" &&
    result.accessReason === "canceled";
});

check("unpaid subscriptions should fall back to Free", () => {
  const result = evaluateEntitlement(doc({ billingStatus: "unpaid" }), { now: NOW });
  return result.plan === "free" &&
    result.accessReason === "unpaid";
});

check("stale entitlement projections should fall back to Free", () => {
  const result = evaluateEntitlement(doc({
    updatedAt: "2026-05-20T00:00:00.000Z"
  }), { now: NOW });
  return result.plan === "free" &&
    result.accessReason === "stale";
});

check("buildEntitlementProjection should normalize provider billing into one object", () => {
  const result = buildEntitlementProjection({
    uid: "firebase_uid_123",
    now: NOW,
    billing: doc({ updatedAt: NOW })
  });
  return result.ownerUid === "firebase_uid_123" &&
    result.provider === "stripe" &&
    result.providerCustomerId === "cus_test_123" &&
    result.maxDevices === 5;
});

console.log(JSON.stringify({
  ok: true,
  checks
}, null, 2));
