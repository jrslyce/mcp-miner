"use strict";

const assert = require("assert");
const Stripe = require("../firebase/functions/node_modules/stripe");
const {
  billingFromSubscription,
  handleStripeWebhookEvent,
  mapStripeEvent,
  planFromPriceId,
  verifyStripeWebhookEvent
} = require("../firebase/functions/src/stripe_webhooks");

const env = {
  STRIPE_PRO_MONTHLY_PRICE_ID: "price_monthly",
  STRIPE_PRO_ANNUAL_PRICE_ID: "price_annual"
};
const now = "2026-05-24T00:00:00.000Z";

let checks = 0;
async function check(message, fn) {
  assert.ok(await fn(), message);
  checks += 1;
}

function subscription(overrides = {}) {
  return {
    id: "sub_test_123",
    customer: "cus_test_123",
    status: "active",
    current_period_end: 1782172800,
    cancel_at_period_end: false,
    metadata: {
      firebaseUid: "firebase_uid_123"
    },
    items: {
      data: [
        {
          price: {
            id: "price_monthly"
          }
        }
      ]
    },
    ...overrides
  };
}

function event(type, object, id = `evt_${type.replace(/[^a-z_]/g, "_")}`) {
  return {
    id,
    type,
    data: {
      object
    }
  };
}

function fakeStripe(sub = subscription()) {
  return {
    subscriptions: {
      async retrieve(id) {
        return {
          ...sub,
          id
        };
      }
    }
  };
}

function fakeDb() {
  const store = new Map();
  return {
    store,
    doc(path) {
      return { path };
    },
    async runTransaction(fn) {
      const transaction = {
        async get(ref) {
          return {
            exists: store.has(ref.path),
            data: () => store.get(ref.path)
          };
        },
        set(ref, data) {
          store.set(ref.path, data);
        }
      };
      return fn(transaction);
    }
  };
}

(async () => {
  await check("price IDs should map to internal plans", () => {
    return planFromPriceId("price_monthly", env) === "pro_monthly" &&
      planFromPriceId("price_annual", env) === "pro_annual" &&
      planFromPriceId("price_unknown", env) === null;
  });

  await check("subscription events should build normalized active billing", () => {
    const mapped = billingFromSubscription(subscription(), {
      eventType: "customer.subscription.updated",
      env,
      now
    });
    return mapped.action === "project" &&
      mapped.uid === "firebase_uid_123" &&
      mapped.billing.plan === "pro_monthly" &&
      mapped.billing.billingStatus === "active";
  });

  await check("unknown prices should not grant Pro", () => {
    const mapped = billingFromSubscription(subscription({
      items: { data: [{ price: { id: "price_unknown" } }] }
    }), { eventType: "customer.subscription.updated", env, now });
    return mapped.action === "ignored" &&
      mapped.reason === "unknown_price_id";
  });

  await check("missing uid metadata should not grant Pro", () => {
    const mapped = billingFromSubscription(subscription({ metadata: {} }), {
      eventType: "customer.subscription.updated",
      env,
      now
    });
    return mapped.action === "ignored" &&
      mapped.reason === "missing_uid_metadata";
  });

  await check("invoice payment failures should project grace-period past_due", async () => {
    const mapped = await mapStripeEvent(event("invoice.payment_failed", {
      subscription: "sub_test_123"
    }), {
      stripe: fakeStripe(subscription({ status: "active" })),
      env,
      now
    });
    return mapped.action === "project" &&
      mapped.billing.billingStatus === "past_due" &&
      mapped.billing.gracePeriodEnd === "2026-05-27T00:00:00.000Z";
  });

  await check("checkout completion should retrieve subscription before projecting", async () => {
    const mapped = await mapStripeEvent(event("checkout.session.completed", {
      subscription: "sub_test_checkout",
      metadata: {
        firebaseUid: "firebase_uid_123",
        plan: "pro_monthly"
      }
    }), {
      stripe: fakeStripe(subscription()),
      env,
      now
    });
    return mapped.action === "project" &&
      mapped.billing.providerSubscriptionId === "sub_test_checkout";
  });

  await check("webhook event handling should be idempotent", async () => {
    const db = fakeDb();
    const stripeEvent = event("customer.subscription.updated", subscription(), "evt_repeat");
    const first = await handleStripeWebhookEvent({ event: stripeEvent, db, stripe: fakeStripe(), env, now });
    const second = await handleStripeWebhookEvent({ event: stripeEvent, db, stripe: fakeStripe(), env, now });
    return first.action === "project" &&
      first.entitlementStatus === "pro" &&
      first.accessReason === "active" &&
      first.currentPeriodEnd === "2026-06-23T00:00:00.000Z" &&
      second.duplicate === true &&
      db.store.has("players/firebase_uid_123/billing/current") &&
      db.store.has("players/firebase_uid_123/entitlements/current");
  });

  await check("webhook payment failures should persist grace-period Pro projection", async () => {
    const db = fakeDb();
    const stripeEvent = event("invoice.payment_failed", {
      subscription: "sub_test_123"
    }, "evt_payment_failed_grace");
    const result = await handleStripeWebhookEvent({
      event: stripeEvent,
      db,
      stripe: fakeStripe(subscription({ status: "active" })),
      env,
      now
    });
    const entitlement = db.store.get("players/firebase_uid_123/entitlements/current");
    return result.action === "project" &&
      result.billingStatus === "past_due" &&
      result.entitlementStatus === "pro" &&
      result.accessReason === "grace_period" &&
      entitlement.entitlementStatus === "pro" &&
      entitlement.accessReason === "grace_period";
  });

  await check("signature verification should accept valid Stripe signatures", () => {
    const stripe = new Stripe("sk_test_fake");
    const payload = JSON.stringify(event("customer.subscription.updated", subscription(), "evt_signed"));
    const secret = "whsec_test_secret";
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const verified = verifyStripeWebhookEvent(stripe, Buffer.from(payload), header, secret);
    return verified.id === "evt_signed";
  });

  await check("signature verification should reject invalid Stripe signatures", () => {
    const stripe = new Stripe("sk_test_fake");
    const payload = JSON.stringify(event("customer.subscription.updated", subscription(), "evt_bad_sig"));
    try {
      verifyStripeWebhookEvent(stripe, Buffer.from(payload), "t=1,v1=bad", "whsec_test_secret");
    } catch (_) {
      return true;
    }
    return false;
  });

  console.log(JSON.stringify({
    ok: true,
    checks
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
