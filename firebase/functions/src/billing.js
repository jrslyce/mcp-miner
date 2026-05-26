"use strict";

const Stripe = require("stripe");
const {
  PLAN_ENTITLEMENTS,
  evaluateEntitlement
} = require("./entitlements");

const CHECKOUT_PRICE_ENV = Object.freeze({
  pro_monthly: "STRIPE_PRO_MONTHLY_PRICE_ID",
  pro_annual: "STRIPE_PRO_ANNUAL_PRICE_ID"
});

const BILLING_SOURCE = "mcp_miner_portal";
const VALID_HTTPS_ERROR_CODES = new Set([
  "invalid-argument",
  "failed-precondition",
  "permission-denied",
  "unauthenticated",
  "internal"
]);

function billingError(code, message) {
  const error = new Error(message);
  error.code = VALID_HTTPS_ERROR_CODES.has(code) ? code : "internal";
  return error;
}

function fail(code, message) {
  throw billingError(code, message);
}

function normalizeCheckoutPlan(value) {
  const plan = String(value || "").trim();
  if (Object.prototype.hasOwnProperty.call(CHECKOUT_PRICE_ENV, plan)) {
    return plan;
  }
  fail("invalid-argument", "Choose pro_monthly or pro_annual.");
}

function assertUidMatchesRequest(data, uid) {
  const requestedUid = data && typeof data.uid === "string" ? data.uid.trim() : "";
  if (requestedUid && requestedUid !== uid) {
    fail("permission-denied", "Checkout can only be started for the signed-in user.");
  }
}

function configuredPriceId(plan, env = process.env) {
  const key = CHECKOUT_PRICE_ENV[normalizeCheckoutPlan(plan)];
  const value = env[key];
  if (!value || typeof value !== "string" || !value.trim()) {
    fail("failed-precondition", `${key} must be configured before Stripe checkout can start.`);
  }
  return value.trim();
}

function createStripeClient(env = process.env) {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    fail("failed-precondition", "STRIPE_SECRET_KEY must be configured before Stripe billing can start.");
  }
  return new Stripe(secret.trim());
}

function stripeCustomerIdFromBilling(billing) {
  if (!billing || billing.provider !== "stripe") {
    return null;
  }
  return typeof billing.providerCustomerId === "string" && billing.providerCustomerId.startsWith("cus_")
    ? billing.providerCustomerId
    : null;
}

function isProEntitlement(entitlement) {
  const evaluated = evaluateEntitlement(entitlement || null);
  return evaluated.entitlementStatus === "pro" && String(evaluated.plan || "").startsWith("pro_");
}

function checkoutMetadata(uid, plan) {
  return {
    firebaseUid: uid,
    plan,
    source: BILLING_SOURCE
  };
}

function checkoutUrls(dashboardUrl) {
  return {
    successUrl: `${dashboardUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${dashboardUrl}/?billing=cancel`,
    returnUrl: `${dashboardUrl}/?billing=manage`
  };
}

async function ensureStripeCustomer(stripe, { uid, email, billing }) {
  const existing = stripeCustomerIdFromBilling(billing);
  if (existing) {
    return existing;
  }

  const params = {
    metadata: {
      firebaseUid: uid,
      source: BILLING_SOURCE
    }
  };
  if (email) {
    params.email = email;
  }
  const customer = await stripe.customers.create(params);
  return customer.id;
}

function pendingBillingProjection({ uid, customerId, plan, now }) {
  const planFields = PLAN_ENTITLEMENTS[plan];
  return {
    ownerUid: uid,
    schemaVersion: 1,
    privacyClass: "abstract",
    plan,
    billingStatus: "checkout_pending",
    provider: "stripe",
    providerCustomerId: customerId,
    providerSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    syncCadenceSeconds: planFields.syncCadenceSeconds,
    maxDevices: planFields.maxDevices,
    historyRetentionDays: planFields.historyRetentionDays,
    features: {
      ...planFields.features
    },
    updatedAt: now
  };
}

async function createCustomerPortalSession(stripe, { customerId, dashboardUrl }) {
  if (!customerId) {
    fail("failed-precondition", "No Stripe customer is linked to this MCP Miner account yet.");
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: checkoutUrls(dashboardUrl).returnUrl
  });
  return {
    destination: "portal",
    url: session.url,
    sessionId: session.id || null,
    customerId
  };
}

async function createCheckoutSession(stripe, {
  uid,
  email,
  plan,
  dashboardUrl,
  billing,
  entitlement,
  env = process.env,
  now = new Date().toISOString()
}) {
  const checkoutPlan = normalizeCheckoutPlan(plan);
  const existingCustomerId = stripeCustomerIdFromBilling(billing);
  if (isProEntitlement(entitlement)) {
    return createCustomerPortalSession(stripe, { customerId: existingCustomerId, dashboardUrl });
  }

  const priceId = configuredPriceId(checkoutPlan, env);
  const customerId = await ensureStripeCustomer(stripe, { uid, email, billing });
  const urls = checkoutUrls(dashboardUrl);
  const metadata = checkoutMetadata(uid, checkoutPlan);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: uid,
    line_items: [
      {
        price: priceId,
        quantity: 1
      }
    ],
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    metadata,
    subscription_data: {
      metadata,
      description: checkoutPlan === "pro_annual"
        ? "MCP Miner Pro Annual. Billed yearly for the price of eleven months."
        : "MCP Miner Pro Monthly."
    }
  });

  return {
    destination: "checkout",
    url: session.url,
    sessionId: session.id || null,
    customerId,
    plan: checkoutPlan,
    priceId,
    pendingBilling: pendingBillingProjection({ uid, customerId, plan: checkoutPlan, now })
  };
}

module.exports = {
  BILLING_SOURCE,
  CHECKOUT_PRICE_ENV,
  assertUidMatchesRequest,
  billingError,
  checkoutMetadata,
  checkoutUrls,
  configuredPriceId,
  createCheckoutSession,
  createCustomerPortalSession,
  createStripeClient,
  ensureStripeCustomer,
  isProEntitlement,
  normalizeCheckoutPlan,
  pendingBillingProjection,
  stripeCustomerIdFromBilling
};
