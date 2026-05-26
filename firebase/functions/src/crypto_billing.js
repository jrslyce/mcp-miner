"use strict";

const crypto = require("crypto");
const {
  buildEntitlementProjection
} = require("./entitlements");

const CRYPTO_PROVIDER_ID = "crypto_wallet";
const CRYPTO_PLAN_ENV = Object.freeze({
  pro_monthly: "CRYPTO_PRO_MONTHLY_PLAN_ID",
  pro_annual: "CRYPTO_PRO_ANNUAL_PLAN_ID"
});
const HANDLED_CRYPTO_EVENTS = Object.freeze([
  "crypto.subscription.active",
  "crypto.subscription.renewed",
  "crypto.subscription.payment_failed",
  "crypto.subscription.canceled",
  "crypto.subscription.wallet_disconnected",
  "crypto.subscription.refunded",
  "crypto.subscription.chargeback"
]);
const GRACE_PERIOD_DAYS = 3;

function boolEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

function cryptoProviderLaunchState(env = process.env) {
  const enabled = boolEnv(env.CRYPTO_BILLING_ENABLED);
  const approved = boolEnv(env.CRYPTO_PROVIDER_APPROVED);
  const productionMode = String(env.CRYPTO_PROVIDER_LAUNCH_MODE || "").toLowerCase() === "production";
  if (!enabled) {
    return {
      provider: CRYPTO_PROVIDER_ID,
      launchBlocked: true,
      betaOnly: true,
      reason: "crypto_provider_disabled",
      stripePrimary: true
    };
  }
  if (!approved) {
    return {
      provider: CRYPTO_PROVIDER_ID,
      launchBlocked: true,
      betaOnly: true,
      reason: "crypto_provider_not_approved",
      stripePrimary: true
    };
  }
  return {
    provider: CRYPTO_PROVIDER_ID,
    launchBlocked: false,
    betaOnly: !productionMode,
    reason: productionMode ? "approved" : "beta_only",
    stripePrimary: true
  };
}

function parseMillis(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? (value < 100000000000 ? value * 1000 : value) : null;
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

function isoFromProviderTime(value) {
  const millis = parseMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}

function plusDaysIso(now, days) {
  return new Date((parseMillis(now) || Date.now()) + (days * 24 * 60 * 60 * 1000)).toISOString();
}

function planFromCryptoPlanId(planId, env = process.env) {
  if (!planId) {
    return null;
  }
  return Object.entries(CRYPTO_PLAN_ENV).find(([, envKey]) => env[envKey] === planId)?.[0] || null;
}

function uidFromCryptoObject(object) {
  return object &&
    object.metadata &&
    typeof object.metadata.firebaseUid === "string" &&
    object.metadata.firebaseUid.trim()
    ? object.metadata.firebaseUid.trim()
    : null;
}

function eventBillingStatus(eventType, object = {}) {
  if (eventType === "crypto.subscription.renewed" || eventType === "crypto.subscription.active") {
    return "active";
  }
  if (eventType === "crypto.subscription.payment_failed") {
    return "past_due";
  }
  if (eventType === "crypto.subscription.wallet_disconnected" || eventType === "crypto.subscription.canceled") {
    return "canceled";
  }
  if (eventType === "crypto.subscription.refunded" || eventType === "crypto.subscription.chargeback") {
    return "unpaid";
  }
  const status = String(object.status || "").toLowerCase();
  if (["active", "trialing", "past_due", "canceled", "unpaid"].includes(status)) {
    return status;
  }
  return "missing";
}

function renewalStateForEvent(eventType, object = {}) {
  if (object.renewalState) {
    return String(object.renewalState).slice(0, 80);
  }
  if (eventType === "crypto.subscription.renewed") {
    return "renewed";
  }
  if (eventType === "crypto.subscription.payment_failed") {
    return "failed";
  }
  if (eventType === "crypto.subscription.wallet_disconnected") {
    return "wallet_disconnected";
  }
  if (eventType === "crypto.subscription.refunded") {
    return "refunded";
  }
  if (eventType === "crypto.subscription.chargeback") {
    return "chargeback";
  }
  return eventBillingStatus(eventType, object);
}

function normalizeCryptoSubscriptionEvent(event, {
  env = process.env,
  now = new Date().toISOString()
} = {}) {
  const launch = cryptoProviderLaunchState(env);
  if (launch.launchBlocked) {
    return {
      action: "blocked",
      provider: CRYPTO_PROVIDER_ID,
      reason: launch.reason,
      betaOnly: launch.betaOnly,
      stripePrimary: true
    };
  }
  if (!event || !HANDLED_CRYPTO_EVENTS.includes(event.type)) {
    return {
      action: "ignored",
      provider: CRYPTO_PROVIDER_ID,
      reason: "unhandled_event_type",
      betaOnly: launch.betaOnly
    };
  }

  const object = event.data && event.data.object ? event.data.object : {};
  const uid = uidFromCryptoObject(object);
  const plan = planFromCryptoPlanId(object.planId || object.priceId, env);
  if (!uid) {
    return { action: "ignored", provider: CRYPTO_PROVIDER_ID, reason: "missing_uid_metadata", betaOnly: launch.betaOnly };
  }
  if (!plan) {
    return { action: "ignored", provider: CRYPTO_PROVIDER_ID, reason: "unknown_plan_id", uid, betaOnly: launch.betaOnly };
  }

  const billingStatus = eventBillingStatus(event.type, object);
  const currentPeriodEnd = isoFromProviderTime(object.currentPeriodEnd || object.current_period_end);
  const billing = {
    ownerUid: uid,
    schemaVersion: 1,
    privacyClass: "abstract",
    plan,
    billingStatus,
    provider: CRYPTO_PROVIDER_ID,
    providerCustomerId: object.walletReference || object.customerId || object.customer || null,
    providerSubscriptionId: object.subscriptionId || object.id || null,
    providerTransactionId: object.transactionId || object.txId || null,
    providerRenewalState: renewalStateForEvent(event.type, object),
    providerWalletReference: object.walletReference || null,
    providerEnvironment: launch.betaOnly ? "beta" : "production",
    providerBetaOnly: launch.betaOnly,
    currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(object.cancelAtPeriodEnd || object.cancel_at_period_end),
    syncCadenceSeconds: 10,
    maxDevices: 5,
    historyRetentionDays: 365,
    features: {},
    updatedAt: now
  };
  if (billingStatus === "past_due") {
    billing.gracePeriodEnd = plusDaysIso(now, GRACE_PERIOD_DAYS);
  }
  return {
    action: "project",
    provider: CRYPTO_PROVIDER_ID,
    uid,
    plan,
    billing,
    betaOnly: launch.betaOnly,
    stripePrimary: true
  };
}

function bodyBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) {
    return rawBody;
  }
  return Buffer.from(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody || {}));
}

function cryptoWebhookSignature(rawBody, secret) {
  return `sha256=${crypto.createHmac("sha256", secret).update(bodyBuffer(rawBody)).digest("hex")}`;
}

function verifyCryptoWebhookSignature(rawBody, signature, secret) {
  if (!secret) {
    throw new Error("CRYPTO_WEBHOOK_SECRET must be configured before crypto webhooks can be processed.");
  }
  const expected = cryptoWebhookSignature(rawBody, secret);
  const actual = String(signature || "");
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error("Crypto webhook signature verification failed.");
  }
  return true;
}

async function handleCryptoWebhookEvent({ event, db, env = process.env, now = new Date().toISOString() }) {
  const mapped = normalizeCryptoSubscriptionEvent(event, { env, now });
  const eventId = event && event.id ? event.id : `crypto_missing_${Date.parse(now) || Date.now()}`;
  const eventRef = db.doc(`billingWebhookEvents/${eventId}`);
  return db.runTransaction(async (transaction) => {
    const eventSnap = await transaction.get(eventRef);
    if (eventSnap.exists) {
      return { ok: true, duplicate: true, action: "duplicate" };
    }
    transaction.set(eventRef, {
      provider: CRYPTO_PROVIDER_ID,
      providerEventId: eventId,
      eventType: event && event.type ? event.type : "missing",
      receivedAt: now,
      processedAt: now,
      status: mapped.action,
      reason: mapped.reason || null,
      uid: mapped.uid || null,
      plan: mapped.plan || null,
      providerTransactionId: mapped.billing && mapped.billing.providerTransactionId ? mapped.billing.providerTransactionId : null,
      providerRenewalState: mapped.billing && mapped.billing.providerRenewalState ? mapped.billing.providerRenewalState : null,
      betaOnly: mapped.betaOnly === true,
      rawPayloadStorageRef: null
    }, { merge: false });
    if (mapped.action !== "project") {
      return {
        ok: mapped.action !== "blocked",
        duplicate: false,
        action: mapped.action,
        reason: mapped.reason,
        betaOnly: mapped.betaOnly === true
      };
    }

    const entitlement = buildEntitlementProjection({
      uid: mapped.uid,
      billing: mapped.billing,
      now
    });
    transaction.set(db.doc(`players/${mapped.uid}/billing/current`), mapped.billing, { merge: true });
    transaction.set(db.doc(`players/${mapped.uid}/entitlements/current`), entitlement, { merge: true });
    return {
      ok: true,
      duplicate: false,
      action: "project",
      provider: CRYPTO_PROVIDER_ID,
      uid: mapped.uid,
      plan: mapped.plan,
      billingStatus: mapped.billing.billingStatus,
      entitlementStatus: entitlement.entitlementStatus,
      accessReason: entitlement.accessReason,
      betaOnly: mapped.betaOnly === true
    };
  });
}

module.exports = {
  CRYPTO_PLAN_ENV,
  CRYPTO_PROVIDER_ID,
  GRACE_PERIOD_DAYS,
  HANDLED_CRYPTO_EVENTS,
  cryptoProviderLaunchState,
  cryptoWebhookSignature,
  handleCryptoWebhookEvent,
  normalizeCryptoSubscriptionEvent,
  planFromCryptoPlanId,
  verifyCryptoWebhookSignature
};
