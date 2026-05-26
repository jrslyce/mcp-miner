"use strict";

const crypto = require("crypto");
const {
  buildEntitlementProjection,
  evaluateEntitlement,
  publicEntitlement
} = require("./entitlements");
const {
  billingFromSubscription
} = require("./stripe_webhooks");

const SUPPORT_AUDIT_COLLECTION = "supportAuditLogs";
const SUPPORT_ACTOR_PATTERN = /^(support|admin|release):[A-Za-z0-9_.@-]{2,120}$/;

const BILLING_FIELDS = Object.freeze([
  "ownerUid",
  "schemaVersion",
  "privacyClass",
  "plan",
  "billingStatus",
  "provider",
  "providerCustomerId",
  "providerSubscriptionId",
  "providerTransactionId",
  "providerRenewalState",
  "providerWalletReference",
  "providerEnvironment",
  "providerBetaOnly",
  "currentPeriodEnd",
  "cancelAtPeriodEnd",
  "syncCadenceSeconds",
  "maxDevices",
  "historyRetentionDays",
  "updatedAt",
  "gracePeriodEnd",
  "supportMarkedStaleAt",
  "supportReconciledAt"
]);
const DEVICE_FIELDS = Object.freeze([
  "ownerUid",
  "deviceId",
  "deviceName",
  "status",
  "privacyClass",
  "scopes",
  "createdAt",
  "updatedAt",
  "lastUsedAt",
  "revokedAt",
  "revokedBy"
]);
const SYNC_FIELDS = Object.freeze([
  "ownerUid",
  "clientId",
  "deviceId",
  "schemaVersion",
  "privacyClass",
  "lastLocalEventId",
  "lastCloudEventId",
  "lastPulledAt",
  "lastPushedAt",
  "lastAcceptedBatchAt",
  "conflictState",
  "updatedAt"
]);

function supportError(code, message, reason = code) {
  const error = new Error(message);
  error.code = code;
  error.reason = reason;
  return error;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cleanUid(uid) {
  const value = String(uid || "").trim();
  if (!/^[A-Za-z0-9:_-]{3,160}$/.test(value)) {
    throw supportError("invalid-argument", "A valid Firebase Auth UID is required.", "invalid_uid");
  }
  return value;
}

function cleanDeviceId(deviceId) {
  const value = String(deviceId || "").trim();
  if (!/^device_[a-f0-9]{8,64}$/.test(value)) {
    throw supportError("invalid-argument", "A valid MCP Miner device ID is required.", "invalid_device_id");
  }
  return value;
}

function requireSupportActor(actor) {
  const value = String(actor || "").trim();
  if (!SUPPORT_ACTOR_PATTERN.test(value)) {
    throw supportError(
      "permission-denied",
      "Support tooling requires an explicit support actor such as support:jared.",
      "missing_support_actor"
    );
  }
  return value;
}

function safeString(value, fallback = null, maxLength = 240) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const clean = String(value).replace(/[\r\n\t]+/g, " ").trim();
  return clean ? clean.slice(0, maxLength) : fallback;
}

function pickFields(input, fields) {
  const data = input && typeof input === "object" ? input : {};
  return fields.reduce((picked, field) => {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      picked[field] = clone(data[field]);
    }
    return picked;
  }, {});
}

function sanitizeAuditDetails(details = {}) {
  return Object.entries(details || {}).reduce((safe, [key, value]) => {
    if (isSecretAuditKey(key)) {
      return safe;
    }
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      safe[key] = value;
    }
    return safe;
  }, {});
}

function isSecretAuditKey(key) {
  const lower = String(key || "").toLowerCase();
  return lower.includes("secret") ||
    lower.includes("tokenhash") ||
    lower === "token" ||
    lower === "devicetoken" ||
    lower.endsWith("hash") ||
    lower === "raw" ||
    lower === "payload" ||
    lower.includes("rawpayload") ||
    lower.includes("prompt") ||
    lower === "code" ||
    lower.includes("sourcecode") ||
    lower.includes("terminaloutput") ||
    lower.includes("command") ||
    lower.includes("filepath") ||
    lower === "path" ||
    lower.includes("transcript");
}

function auditId({ action, targetUid, now }) {
  const hash = crypto
    .createHash("sha256")
    .update(`${targetUid}:${action}:${now}:${crypto.randomUUID()}`)
    .digest("hex")
    .slice(0, 20);
  const millis = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  return `support_${millis}_${hash}`;
}

async function writeSupportAudit({
  db,
  actor,
  targetUid,
  action,
  result,
  reason = null,
  details = {},
  now = new Date().toISOString()
}) {
  const uid = cleanUid(targetUid);
  const supportActor = requireSupportActor(actor);
  const audit = {
    actor: supportActor,
    targetUid: uid,
    action,
    result,
    reason: safeString(reason),
    privacyClass: "abstract",
    details: sanitizeAuditDetails(details),
    createdAt: now
  };
  await db.doc(`${SUPPORT_AUDIT_COLLECTION}/${auditId({ action, targetUid: uid, now })}`).set(audit, { merge: false });
  return audit;
}

async function readDoc(db, path) {
  const snapshot = await db.doc(path).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function readCollection(db, path, limit = 50) {
  const query = typeof db.collection(path).limit === "function" ? db.collection(path).limit(limit) : db.collection(path);
  const snapshot = await query.get();
  return snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data()
  }));
}

function supportBillingProjection(billing) {
  return billing ? pickFields(billing, BILLING_FIELDS) : null;
}

function supportEntitlementProjection(entitlement, now = new Date().toISOString()) {
  const evaluated = entitlement && typeof entitlement === "object" && typeof entitlement.entitlementStatus === "string"
    ? entitlement
    : evaluateEntitlement(entitlement || null, { now });
  return {
    ...publicEntitlement(evaluated),
    billingStatus: evaluated.billingStatus,
    provider: evaluated.provider || null,
    providerCustomerId: evaluated.providerCustomerId || null,
    providerSubscriptionId: evaluated.providerSubscriptionId || null,
    currentPeriodEnd: evaluated.currentPeriodEnd || null,
    cancelAtPeriodEnd: evaluated.cancelAtPeriodEnd === true,
    evaluatedAt: evaluated.evaluatedAt || now
  };
}

function supportDevice(device) {
  return pickFields(device, DEVICE_FIELDS);
}

function supportSyncMetadata(doc) {
  return {
    id: doc.id,
    ...pickFields(doc.data, SYNC_FIELDS)
  };
}

async function buildSupportAccountSummary({ db, uid, now = new Date().toISOString() }) {
  const targetUid = cleanUid(uid);
  const [player, billing, entitlement, devices, syncMetadata] = await Promise.all([
    readDoc(db, `players/${targetUid}`),
    readDoc(db, `players/${targetUid}/billing/current`),
    readDoc(db, `players/${targetUid}/entitlements/current`),
    readCollection(db, `players/${targetUid}/syncDevices`, 50),
    readCollection(db, `players/${targetUid}/syncMetadata`, 50)
  ]);
  return {
    ok: true,
    privacyClass: "abstract",
    uid: targetUid,
    generatedAt: now,
    account: {
      exists: Boolean(player),
      cloudSyncEnabled: player && player.cloudSyncEnabled === true,
      accountLinkedAt: player && player.accountLinkedAt ? player.accountLinkedAt : null,
      updatedAt: player && player.updatedAt ? player.updatedAt : null
    },
    billing: supportBillingProjection(billing),
    entitlement: supportEntitlementProjection(entitlement || billing, now),
    linkedDevices: devices
      .map((doc) => supportDevice(doc.data))
      .sort((left, right) => String(left.deviceId || "").localeCompare(String(right.deviceId || ""))),
    syncMetadata: syncMetadata
      .map(supportSyncMetadata)
      .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")))
  };
}

async function inspectSupportAccount({ db, uid, actor, now = new Date().toISOString() }) {
  const summary = await buildSupportAccountSummary({ db, uid, now });
  const audit = await writeSupportAudit({
    db,
    actor,
    targetUid: summary.uid,
    action: "inspect_account",
    result: "ok",
    details: {
      hasBilling: Boolean(summary.billing),
      entitlementStatus: summary.entitlement.entitlementStatus,
      deviceCount: summary.linkedDevices.length
    },
    now
  });
  return {
    ...summary,
    audit: {
      action: audit.action,
      result: audit.result,
      createdAt: audit.createdAt
    }
  };
}

function subscriptionCustomerId(subscription) {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription && subscription.customer && subscription.customer.id;
}

function subscriptionRank(subscription) {
  const status = subscription && subscription.status;
  const ranks = {
    active: 0,
    trialing: 1,
    past_due: 2,
    canceled: 3,
    unpaid: 4
  };
  return Object.prototype.hasOwnProperty.call(ranks, status) ? ranks[status] : 10;
}

function chooseStripeSubscription(subscriptions) {
  const data = subscriptions && Array.isArray(subscriptions.data) ? subscriptions.data : [];
  return [...data].sort((left, right) => {
    const rankDelta = subscriptionRank(left) - subscriptionRank(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return Number(right.current_period_end || 0) - Number(left.current_period_end || 0);
  })[0] || null;
}

async function loadStripeSubscription(stripe, billing) {
  if (billing && billing.providerSubscriptionId) {
    return stripe.subscriptions.retrieve(billing.providerSubscriptionId);
  }
  if (billing && billing.providerCustomerId && stripe.subscriptions && typeof stripe.subscriptions.list === "function") {
    const listed = await stripe.subscriptions.list({
      customer: billing.providerCustomerId,
      status: "all",
      limit: 10
    });
    return chooseStripeSubscription(listed);
  }
  return null;
}

async function reconcileStripeEntitlement({
  db,
  stripe,
  uid,
  actor,
  env = process.env,
  now = new Date().toISOString()
}) {
  const targetUid = cleanUid(uid);
  const supportActor = requireSupportActor(actor);
  const billing = await readDoc(db, `players/${targetUid}/billing/current`);
  if (!billing || billing.provider !== "stripe" || !billing.providerCustomerId) {
    await writeSupportAudit({
      db,
      actor: supportActor,
      targetUid,
      action: "reconcile_stripe_entitlement",
      result: "failed",
      reason: "missing_stripe_customer",
      now
    });
    throw supportError("failed-precondition", "No Stripe customer projection exists for this account.", "missing_stripe_customer");
  }

  const subscription = await loadStripeSubscription(stripe, billing);
  if (!subscription) {
    await writeSupportAudit({
      db,
      actor: supportActor,
      targetUid,
      action: "reconcile_stripe_entitlement",
      result: "failed",
      reason: "missing_subscription",
      details: { providerCustomerId: billing.providerCustomerId },
      now
    });
    throw supportError("failed-precondition", "No Stripe subscription evidence was found for this account.", "missing_subscription");
  }

  const customerId = subscriptionCustomerId(subscription);
  if (customerId !== billing.providerCustomerId) {
    await writeSupportAudit({
      db,
      actor: supportActor,
      targetUid,
      action: "reconcile_stripe_entitlement",
      result: "denied",
      reason: "customer_mismatch",
      now
    });
    throw supportError("permission-denied", "Stripe subscription customer does not match the account projection.", "customer_mismatch");
  }

  const mapped = billingFromSubscription(subscription, {
    eventType: "customer.subscription.updated",
    env,
    now
  });
  if (mapped.action !== "project") {
    await writeSupportAudit({
      db,
      actor: supportActor,
      targetUid,
      action: "reconcile_stripe_entitlement",
      result: "ignored",
      reason: mapped.reason || "unprojectable_subscription",
      details: { providerCustomerId: billing.providerCustomerId },
      now
    });
    return {
      ok: false,
      privacyClass: "abstract",
      action: "ignored",
      reason: mapped.reason || "unprojectable_subscription"
    };
  }
  if (mapped.uid !== targetUid) {
    await writeSupportAudit({
      db,
      actor: supportActor,
      targetUid,
      action: "reconcile_stripe_entitlement",
      result: "denied",
      reason: "uid_mismatch",
      now
    });
    throw supportError("permission-denied", "Stripe subscription metadata belongs to another Firebase UID.", "uid_mismatch");
  }

  const nextBilling = {
    ...mapped.billing,
    supportReconciledAt: now
  };
  const nextEntitlement = buildEntitlementProjection({
    uid: targetUid,
    billing: nextBilling,
    now
  });
  await db.runTransaction(async (transaction) => {
    transaction.set(db.doc(`players/${targetUid}/billing/current`), nextBilling, { merge: true });
    transaction.set(db.doc(`players/${targetUid}/entitlements/current`), nextEntitlement, { merge: true });
  });
  const audit = await writeSupportAudit({
    db,
    actor: supportActor,
    targetUid,
    action: "reconcile_stripe_entitlement",
    result: "ok",
    details: {
      plan: nextBilling.plan,
      billingStatus: nextBilling.billingStatus,
      entitlementStatus: nextEntitlement.entitlementStatus,
      providerCustomerId: nextBilling.providerCustomerId,
      providerSubscriptionId: nextBilling.providerSubscriptionId
    },
    now
  });
  return {
    ok: true,
    privacyClass: "abstract",
    billing: supportBillingProjection(nextBilling),
    entitlement: supportEntitlementProjection(nextEntitlement, now),
    audit: {
      action: audit.action,
      result: audit.result,
      createdAt: audit.createdAt
    }
  };
}

async function forceEntitlementRefresh({ db, uid, actor, now = new Date().toISOString() }) {
  const targetUid = cleanUid(uid);
  const supportActor = requireSupportActor(actor);
  const billing = await readDoc(db, `players/${targetUid}/billing/current`);
  if (!billing) {
    await writeSupportAudit({
      db,
      actor: supportActor,
      targetUid,
      action: "force_entitlement_refresh",
      result: "failed",
      reason: "missing_billing_projection",
      now
    });
    throw supportError("failed-precondition", "No billing projection exists for this account.", "missing_billing_projection");
  }
  const entitlement = buildEntitlementProjection({ uid: targetUid, billing, now });
  await db.doc(`players/${targetUid}/entitlements/current`).set(entitlement, { merge: true });
  const audit = await writeSupportAudit({
    db,
    actor: supportActor,
    targetUid,
    action: "force_entitlement_refresh",
    result: "ok",
    details: {
      plan: entitlement.plan,
      billingStatus: entitlement.billingStatus,
      entitlementStatus: entitlement.entitlementStatus
    },
    now
  });
  return {
    ok: true,
    privacyClass: "abstract",
    entitlement: supportEntitlementProjection(entitlement, now),
    audit: {
      action: audit.action,
      result: audit.result,
      createdAt: audit.createdAt
    }
  };
}

async function markBillingProjectionStale({
  db,
  uid,
  actor,
  reason = "support_requested_refresh",
  now = new Date().toISOString()
}) {
  const targetUid = cleanUid(uid);
  const supportActor = requireSupportActor(actor);
  const billing = await readDoc(db, `players/${targetUid}/billing/current`);
  if (!billing) {
    await writeSupportAudit({
      db,
      actor: supportActor,
      targetUid,
      action: "mark_billing_projection_stale",
      result: "failed",
      reason: "missing_billing_projection",
      now
    });
    throw supportError("failed-precondition", "No billing projection exists for this account.", "missing_billing_projection");
  }
  const staleBilling = {
    ...billing,
    updatedAt: "1970-01-01T00:00:00.000Z",
    supportMarkedStaleAt: now
  };
  const staleEntitlement = buildEntitlementProjection({ uid: targetUid, billing: staleBilling, now });
  await db.runTransaction(async (transaction) => {
    transaction.set(db.doc(`players/${targetUid}/billing/current`), staleBilling, { merge: true });
    transaction.set(db.doc(`players/${targetUid}/entitlements/current`), staleEntitlement, { merge: true });
  });
  const audit = await writeSupportAudit({
    db,
    actor: supportActor,
    targetUid,
    action: "mark_billing_projection_stale",
    result: "ok",
    reason: safeString(reason, "support_requested_refresh", 120),
    details: {
      priorBillingStatus: billing.billingStatus || null,
      nextEntitlementStatus: staleEntitlement.entitlementStatus
    },
    now
  });
  return {
    ok: true,
    privacyClass: "abstract",
    billing: supportBillingProjection(staleBilling),
    entitlement: supportEntitlementProjection(staleEntitlement, now),
    audit: {
      action: audit.action,
      result: audit.result,
      createdAt: audit.createdAt
    }
  };
}

async function revokeSupportDevice({ db, uid, deviceId, actor, now = new Date().toISOString() }) {
  const targetUid = cleanUid(uid);
  const targetDeviceId = cleanDeviceId(deviceId);
  const supportActor = requireSupportActor(actor);
  const result = await db.runTransaction(async (transaction) => {
    const deviceRef = db.doc(`players/${targetUid}/syncDevices/${targetDeviceId}`);
    const deviceSnap = await transaction.get(deviceRef);
    if (!deviceSnap.exists) {
      throw supportError("not-found", "Linked Codex device not found.", "device_not_found");
    }
    const device = deviceSnap.data() || {};
    if (device.ownerUid && device.ownerUid !== targetUid) {
      throw supportError("permission-denied", "Linked Codex device belongs to another account.", "owner_mismatch");
    }
    const tokenSnap = await transaction.get(db.collection("deviceTokens").where("uid", "==", targetUid));
    const matchingTokens = tokenSnap.docs.filter((docSnap) => {
      const token = docSnap.data() || {};
      return token.deviceId === targetDeviceId;
    });
    const revocation = {
      status: "revoked",
      updatedAt: now,
      revokedAt: now,
      revokedBy: "support"
    };
    transaction.set(deviceRef, revocation, { merge: true });
    matchingTokens.forEach((docSnap) => {
      transaction.set(docSnap.ref, revocation, { merge: true });
    });
    return {
      deviceName: device.deviceName || "Codex device",
      tokenCount: matchingTokens.length
    };
  });
  const audit = await writeSupportAudit({
    db,
    actor: supportActor,
    targetUid,
    action: "revoke_device",
    result: "ok",
    details: {
      deviceId: targetDeviceId,
      tokenCount: result.tokenCount
    },
    now
  });
  return {
    ok: true,
    privacyClass: "abstract",
    deviceId: targetDeviceId,
    deviceName: result.deviceName,
    status: "revoked",
    revokedTokenCount: result.tokenCount,
    audit: {
      action: audit.action,
      result: audit.result,
      createdAt: audit.createdAt
    }
  };
}

module.exports = {
  SUPPORT_AUDIT_COLLECTION,
  buildSupportAccountSummary,
  chooseStripeSubscription,
  forceEntitlementRefresh,
  inspectSupportAccount,
  markBillingProjectionStale,
  reconcileStripeEntitlement,
  requireSupportActor,
  revokeSupportDevice,
  sanitizeAuditDetails,
  supportBillingProjection,
  supportDevice,
  supportEntitlementProjection,
  supportSyncMetadata,
  writeSupportAudit
};
