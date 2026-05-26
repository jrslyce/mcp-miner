"use strict";

const {
  buildEntitlementProjection
} = require("./entitlements");
const {
  CHECKOUT_PRICE_ENV
} = require("./billing");

const HANDLED_STRIPE_EVENTS = Object.freeze([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed"
]);

const GRACE_PERIOD_DAYS = 3;

function isoFromStripeSeconds(value) {
  return Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}

function plusDaysIso(now, days) {
  return new Date(new Date(now).getTime() + (days * 24 * 60 * 60 * 1000)).toISOString();
}

function planFromPriceId(priceId, env = process.env) {
  if (!priceId) {
    return null;
  }
  return Object.entries(CHECKOUT_PRICE_ENV).find(([, envKey]) => env[envKey] === priceId)?.[0] || null;
}

function subscriptionPriceId(subscription) {
  const item = subscription &&
    subscription.items &&
    Array.isArray(subscription.items.data) &&
    subscription.items.data[0];
  return item && item.price && item.price.id ? item.price.id : null;
}

function uidFromStripeObject(object) {
  return object &&
    object.metadata &&
    typeof object.metadata.firebaseUid === "string" &&
    object.metadata.firebaseUid.trim()
    ? object.metadata.firebaseUid.trim()
    : null;
}

function subscriptionCustomerId(subscription) {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer && subscription.customer.id;
}

function billingStatusForSubscription(subscription, eventType) {
  if (eventType === "customer.subscription.deleted") {
    return "canceled";
  }
  return typeof subscription.status === "string" ? subscription.status : "missing";
}

function billingFromSubscription(subscription, {
  eventType,
  env = process.env,
  now = new Date().toISOString()
} = {}) {
  const priceId = subscriptionPriceId(subscription);
  const plan = planFromPriceId(priceId, env);
  const uid = uidFromStripeObject(subscription);
  if (!uid) {
    return { action: "ignored", reason: "missing_uid_metadata", priceId, plan: null };
  }
  if (!plan) {
    return { action: "ignored", reason: "unknown_price_id", uid, priceId, plan: null };
  }

  const billingStatus = billingStatusForSubscription(subscription, eventType);
  const billing = {
    ownerUid: uid,
    schemaVersion: 1,
    privacyClass: "abstract",
    plan,
    billingStatus,
    provider: "stripe",
    providerCustomerId: subscriptionCustomerId(subscription),
    providerSubscriptionId: subscription.id || null,
    currentPeriodEnd: isoFromStripeSeconds(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    syncCadenceSeconds: plan === "free" ? 60 : 10,
    maxDevices: plan === "free" ? 1 : 5,
    historyRetentionDays: plan === "free" ? 7 : 365,
    features: {},
    updatedAt: now
  };
  if (billingStatus === "past_due") {
    billing.gracePeriodEnd = plusDaysIso(now, GRACE_PERIOD_DAYS);
  }
  return { action: "project", uid, priceId, plan, billing };
}

async function subscriptionForStripeEvent(event, stripe) {
  const object = event && event.data && event.data.object;
  if (!object) {
    return null;
  }
  if (event.type.startsWith("customer.subscription.")) {
    return object;
  }
  if (event.type === "checkout.session.completed" && object.subscription) {
    return stripe.subscriptions.retrieve(typeof object.subscription === "string" ? object.subscription : object.subscription.id);
  }
  if (event.type.startsWith("invoice.") && object.subscription) {
    return stripe.subscriptions.retrieve(typeof object.subscription === "string" ? object.subscription : object.subscription.id);
  }
  return null;
}

async function mapStripeEvent(event, { stripe, env = process.env, now = new Date().toISOString() }) {
  if (!event || !HANDLED_STRIPE_EVENTS.includes(event.type)) {
    return { action: "ignored", reason: "unhandled_event_type" };
  }
  const subscription = await subscriptionForStripeEvent(event, stripe);
  if (!subscription) {
    return { action: "ignored", reason: "missing_subscription" };
  }
  const mapped = billingFromSubscription(subscription, { eventType: event.type, env, now });
  if (mapped.action === "project" && event.type === "invoice.payment_failed") {
    mapped.billing.billingStatus = "past_due";
    mapped.billing.gracePeriodEnd = plusDaysIso(now, GRACE_PERIOD_DAYS);
  }
  if (mapped.action === "project" && event.type === "invoice.payment_succeeded" && mapped.billing.billingStatus === "past_due") {
    mapped.billing.billingStatus = "active";
  }
  return mapped;
}

function verifyStripeWebhookEvent(stripe, rawBody, signature, endpointSecret) {
  if (!endpointSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be configured before Stripe webhooks can be processed.");
  }
  return stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
}

async function handleStripeWebhookEvent({ event, db, stripe, env = process.env, now = new Date().toISOString() }) {
  const mapped = await mapStripeEvent(event, { stripe, env, now });
  const eventRef = db.doc(`billingWebhookEvents/${event.id}`);
  const result = await db.runTransaction(async (transaction) => {
    const eventSnap = await transaction.get(eventRef);
    if (eventSnap.exists) {
      return { ok: true, duplicate: true, action: "duplicate" };
    }

    const audit = {
      provider: "stripe",
      providerEventId: event.id,
      eventType: event.type,
      receivedAt: now,
      processedAt: now,
      status: mapped.action,
      reason: mapped.reason || null,
      uid: mapped.uid || null,
      plan: mapped.plan || null,
      priceId: mapped.priceId || null,
      rawPayloadStorageRef: null
    };
    transaction.set(eventRef, audit, { merge: false });

    if (mapped.action !== "project") {
      return { ok: true, duplicate: false, action: mapped.action, reason: mapped.reason };
    }

    const billingRef = db.doc(`players/${mapped.uid}/billing/current`);
    const entitlementRef = db.doc(`players/${mapped.uid}/entitlements/current`);
    const entitlement = buildEntitlementProjection({
      uid: mapped.uid,
      billing: mapped.billing,
      now
    });
    transaction.set(billingRef, mapped.billing, { merge: true });
    transaction.set(entitlementRef, entitlement, { merge: true });
    return {
      ok: true,
      duplicate: false,
      action: "project",
      uid: mapped.uid,
      plan: mapped.plan,
      billingStatus: mapped.billing.billingStatus,
      provider: mapped.billing.provider,
      providerSubscriptionId: mapped.billing.providerSubscriptionId,
      currentPeriodEnd: mapped.billing.currentPeriodEnd,
      entitlementStatus: entitlement.entitlementStatus,
      accessReason: entitlement.accessReason
    };
  });
  return result;
}

module.exports = {
  GRACE_PERIOD_DAYS,
  HANDLED_STRIPE_EVENTS,
  billingFromSubscription,
  handleStripeWebhookEvent,
  isoFromStripeSeconds,
  mapStripeEvent,
  planFromPriceId,
  plusDaysIso,
  subscriptionForStripeEvent,
  subscriptionPriceId,
  uidFromStripeObject,
  verifyStripeWebhookEvent
};
