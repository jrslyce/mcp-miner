"use strict";

const assert = require("assert");
const {
  assertUidMatchesRequest,
  checkoutUrls,
  configuredPriceId,
  createCheckoutSession,
  createCustomerPortalSession,
  normalizeCheckoutPlan,
  pendingBillingProjection
} = require("../firebase/functions/src/billing");
const {
  evaluateEntitlement
} = require("../firebase/functions/src/entitlements");

const tests = [];
function check(message, fn) {
  tests.push([message, fn]);
}

function fakeStripe() {
  const calls = [];
  return {
    calls,
    customers: {
      async create(params) {
        calls.push(["customers.create", params]);
        return { id: "cus_test_new" };
      }
    },
    checkout: {
      sessions: {
        async create(params) {
          calls.push(["checkout.sessions.create", params]);
          return { id: "cs_test_new", url: "https://checkout.stripe.com/c/test" };
        }
      }
    },
    billingPortal: {
      sessions: {
        async create(params) {
          calls.push(["billingPortal.sessions.create", params]);
          return { id: "bps_test_new", url: "https://billing.stripe.com/p/session/test" };
        }
      }
    }
  };
}

function proEntitlement(overrides = {}) {
  return {
    ownerUid: "firebase_uid_123",
    schemaVersion: 1,
    privacyClass: "abstract",
    plan: "pro_monthly",
    billingStatus: "active",
    provider: "stripe",
    providerCustomerId: "cus_test_existing",
    providerSubscriptionId: "sub_test_existing",
    currentPeriodEnd: "2026-06-24T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    syncCadenceSeconds: 10,
    maxDevices: 5,
    historyRetentionDays: 365,
    features: {},
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

check("checkout plan validation should accept only Pro monthly or annual", () => {
  return normalizeCheckoutPlan("pro_monthly") === "pro_monthly" &&
    normalizeCheckoutPlan("pro_annual") === "pro_annual";
});

check("checkout plan validation should reject unknown plans", () => {
  try {
    normalizeCheckoutPlan("free");
  } catch (error) {
    return error.code === "invalid-argument";
  }
  return false;
});

check("price IDs should come from environment config", () => {
  return configuredPriceId("pro_annual", {
    STRIPE_PRO_ANNUAL_PRICE_ID: "price_annual",
    STRIPE_PRO_MONTHLY_PRICE_ID: "price_monthly"
  }) === "price_annual";
});

check("price ID lookup should fail closed when missing", () => {
  try {
    configuredPriceId("pro_monthly", {});
  } catch (error) {
    return error.code === "failed-precondition";
  }
  return false;
});

check("checkout cannot be started for another uid", () => {
  try {
    assertUidMatchesRequest({ uid: "other_uid" }, "firebase_uid_123");
  } catch (error) {
    return error.code === "permission-denied";
  }
  return false;
});

check("checkout URLs should return to the portal without granting entitlements", () => {
  const urls = checkoutUrls("https://mcp-miner.web.app");
  return urls.successUrl.includes("billing=success") &&
    urls.successUrl.includes("{CHECKOUT_SESSION_ID}") &&
    urls.cancelUrl.endsWith("/?billing=cancel");
});

check("pending checkout billing should still evaluate as Free", () => {
  const pending = pendingBillingProjection({
    uid: "firebase_uid_123",
    customerId: "cus_test",
    plan: "pro_monthly",
    now: new Date().toISOString()
  });
  const evaluated = evaluateEntitlement(pending, { now: new Date().toISOString() });
  return pending.billingStatus === "checkout_pending" &&
    evaluated.plan === "free" &&
    evaluated.entitlementStatus === "free";
});

check("new checkout should create customer, session, and metadata binding", async () => {
  const stripe = fakeStripe();
  const result = await createCheckoutSession(stripe, {
    uid: "firebase_uid_123",
    email: "miner@example.com",
    plan: "pro_monthly",
    dashboardUrl: "https://mcp-miner.web.app",
    billing: null,
    entitlement: null,
    env: {
      STRIPE_PRO_MONTHLY_PRICE_ID: "price_monthly"
    },
    now: new Date().toISOString()
  });
  const checkoutCall = stripe.calls.find(([name]) => name === "checkout.sessions.create");
  const customerCall = stripe.calls.find(([name]) => name === "customers.create");
  return result.destination === "checkout" &&
    result.pendingBilling.providerCustomerId === "cus_test_new" &&
    customerCall[1].metadata.firebaseUid === "firebase_uid_123" &&
    checkoutCall[1].client_reference_id === "firebase_uid_123" &&
    checkoutCall[1].subscription_data.metadata.plan === "pro_monthly";
});

check("existing Pro subscriber checkout should return portal instead", async () => {
  const stripe = fakeStripe();
  const result = await createCheckoutSession(stripe, {
    uid: "firebase_uid_123",
    email: "miner@example.com",
    plan: "pro_annual",
    dashboardUrl: "https://mcp-miner.web.app",
    billing: {
      provider: "stripe",
      providerCustomerId: "cus_test_existing"
    },
    entitlement: proEntitlement(),
    env: {
      STRIPE_PRO_ANNUAL_PRICE_ID: "price_annual"
    },
    now: new Date().toISOString()
  });
  return result.destination === "portal" &&
    stripe.calls.some(([name]) => name === "billingPortal.sessions.create") &&
    !stripe.calls.some(([name]) => name === "checkout.sessions.create");
});

check("customer portal should require a Stripe customer", async () => {
  const stripe = fakeStripe();
  try {
    await createCustomerPortalSession(stripe, {
      customerId: null,
      dashboardUrl: "https://mcp-miner.web.app"
    });
  } catch (error) {
    return error.code === "failed-precondition";
  }
  return false;
});

async function main() {
  let checks = 0;
  for (const [message, fn] of tests) {
    const result = await fn();
    assert.ok(result, message);
    checks += 1;
  }

  console.log(JSON.stringify({
    ok: true,
    checks
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
