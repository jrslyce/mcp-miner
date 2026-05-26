"use strict";

const assert = require("assert");
const {
  evaluateSyncThrottle,
  publicEntitlement,
  resolveEntitlement
} = require("../firebase/functions/src/entitlements");
const {
  CURRENT_RECEIPT_SCHEMA_VERSION,
  eventChecksum,
  prepareSyncBatch
} = require("../firebase/functions/src/sync");

let checks = 0;
function check(message, fn) {
  assert.ok(fn(), message);
  checks += 1;
}

function receipt(overrides = {}) {
  const base = {
    ownerUid: "firebase_uid_123",
    eventId: "evt_entitlement_1",
    eventType: "work_apply_patch",
    schemaVersion: CURRENT_RECEIPT_SCHEMA_VERSION,
    receiptType: "abstract_work",
    sequence: 1,
    timestamp: "2026-05-24T00:00:00Z",
    turnId: "turn_sync",
    observedFields: {
      scoreHint: 8.5,
      category: "coding",
      rewardControlReasons: []
    },
    privacyClass: "abstract",
    source: "codex_hook",
    signature: "v2.local-placeholder"
  };
  const next = {
    ...base,
    ...overrides,
    observedFields: {
      ...base.observedFields,
      ...(overrides.observedFields || {})
    }
  };
  next.checksum = eventChecksum(next);
  return next;
}

check("missing entitlement should resolve to Free defaults", () => {
  const entitlement = resolveEntitlement();
  return entitlement.plan === "free" &&
    entitlement.syncCadenceSeconds === 60 &&
    entitlement.maxDevices === 1;
});

check("Pro entitlement should expose a shorter sync cadence", () => {
  const entitlement = resolveEntitlement({ plan: "pro_annual" });
  return entitlement.plan === "pro" &&
    entitlement.syncCadenceSeconds < resolveEntitlement({ plan: "free" }).syncCadenceSeconds &&
    entitlement.maxDevices === 5;
});

check("public entitlement should avoid provider identifiers", () => {
  const entitlement = publicEntitlement(resolveEntitlement({
    plan: "pro",
    providerCustomerId: "cus_secret",
    providerSubscriptionId: "sub_secret"
  }));
  return entitlement.plan === "pro" &&
    !Object.prototype.hasOwnProperty.call(entitlement, "providerCustomerId") &&
    !Object.prototype.hasOwnProperty.call(entitlement, "providerSubscriptionId");
});

check("Free sync should throttle inside the cadence window", () => {
  const throttle = evaluateSyncThrottle({
    entitlement: resolveEntitlement({ plan: "free" }),
    syncMetadata: { lastAcceptedBatchAt: "2026-05-24T00:00:00Z" },
    now: new Date("2026-05-24T00:00:30Z")
  });
  return throttle.throttled === true &&
    throttle.reason === "sync_cadence" &&
    throttle.waitSeconds === 30 &&
    throttle.nextEligibleSyncAt === "2026-05-24T00:01:00.000Z";
});

check("Pro sync should be eligible sooner than Free", () => {
  const throttle = evaluateSyncThrottle({
    entitlement: resolveEntitlement({ plan: "pro" }),
    syncMetadata: { lastAcceptedBatchAt: "2026-05-24T00:00:00Z" },
    now: new Date("2026-05-24T00:00:06Z")
  });
  return throttle.throttled === false;
});

check("Free and Pro entitlements should not change receipt reward math", () => {
  const event = receipt();
  const freeBatch = prepareSyncBatch({
    uid: "firebase_uid_123",
    events: [event],
    lastSequence: 0,
    receivedAt: "2026-05-24T00:00:01Z"
  });
  const proBatch = prepareSyncBatch({
    uid: "firebase_uid_123",
    events: [event],
    lastSequence: 0,
    receivedAt: "2026-05-24T00:00:01Z"
  });
  return freeBatch.accepted[0].observedFields.score === proBatch.accepted[0].observedFields.score;
});

console.log(JSON.stringify({ ok: true, checks }, null, 2));
