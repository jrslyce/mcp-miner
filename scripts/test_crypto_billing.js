"use strict";

const assert = require("assert");
const {
  cryptoProviderLaunchState,
  cryptoWebhookSignature,
  handleCryptoWebhookEvent,
  normalizeCryptoSubscriptionEvent,
  verifyCryptoWebhookSignature
} = require("../firebase/functions/src/crypto_billing");
const {
  supportBillingProjection
} = require("../firebase/functions/src/support_tools");

const uid = "firebase_uid_crypto";
const now = "2026-05-26T00:00:00.000Z";
const env = {
  CRYPTO_BILLING_ENABLED: "true",
  CRYPTO_PROVIDER_APPROVED: "true",
  CRYPTO_PROVIDER_LAUNCH_MODE: "beta",
  CRYPTO_PRO_MONTHLY_PLAN_ID: "crypto_plan_monthly",
  CRYPTO_PRO_ANNUAL_PLAN_ID: "crypto_plan_annual"
};

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function fakeSnapshot(path, value, store) {
  return {
    id: path.split("/").pop(),
    ref: fakeRef(path, store),
    exists: store.has(path),
    data: () => clone(value)
  };
}

function fakeRef(path, store) {
  return {
    path,
    async get() {
      return fakeSnapshot(path, store.get(path), store);
    },
    async set(data, options = {}) {
      store.set(path, options.merge ? { ...(store.get(path) || {}), ...clone(data) } : clone(data));
    }
  };
}

function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  return {
    store,
    doc(path) {
      return fakeRef(path, store);
    },
    async runTransaction(fn) {
      const transaction = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data, options = {}) {
          store.set(ref.path, options.merge ? { ...(store.get(ref.path) || {}), ...clone(data) } : clone(data));
        }
      };
      return fn(transaction);
    }
  };
}

function cryptoEvent(type, overrides = {}, id = `crypto_evt_${type.replace(/[^a-z0-9]+/g, "_")}`) {
  return {
    id,
    type,
    data: {
      object: {
        id: "crypto_sub_123",
        walletReference: "wallet_ref_abstract",
        planId: "crypto_plan_monthly",
        currentPeriodEnd: 1782172800,
        cancelAtPeriodEnd: false,
        transactionId: "tx_abstract_123",
        metadata: {
          firebaseUid: uid
        },
        ...overrides
      }
    }
  };
}

function auditDocs(db) {
  return [...db.store.entries()]
    .filter(([path]) => path.startsWith("billingWebhookEvents/"))
    .map(([, data]) => data);
}

let checks = 0;
async function check(message, fn) {
  assert.ok(await fn(), message);
  checks += 1;
}

(async () => {
  await check("crypto provider should be blocked by default and keep Stripe primary", () => {
    const launch = cryptoProviderLaunchState({});
    const mapped = normalizeCryptoSubscriptionEvent(cryptoEvent("crypto.subscription.active"), { env: {}, now });
    return launch.launchBlocked === true &&
      launch.reason === "crypto_provider_disabled" &&
      launch.stripePrimary === true &&
      mapped.action === "blocked";
  });

  await check("crypto webhook signatures should verify with HMAC and reject invalid signatures", () => {
    const payload = JSON.stringify(cryptoEvent("crypto.subscription.active"));
    const secret = "crypto_webhook_secret";
    const signature = cryptoWebhookSignature(payload, secret);
    assert.strictEqual(verifyCryptoWebhookSignature(payload, signature, secret), true);
    assert.throws(() => verifyCryptoWebhookSignature(payload, "sha256=bad", secret), /signature verification failed/);
    return true;
  });

  await check("disabled crypto webhooks should audit blocked events without granting Pro", async () => {
    const db = fakeDb();
    const result = await handleCryptoWebhookEvent({
      db,
      event: cryptoEvent("crypto.subscription.active", {}, "crypto_evt_blocked"),
      env: {},
      now
    });
    return result.ok === false &&
      result.action === "blocked" &&
      !db.store.has(`players/${uid}/entitlements/current`) &&
      auditDocs(db).some((audit) => audit.status === "blocked" && audit.reason === "crypto_provider_disabled");
  });

  await check("approved beta crypto subscriptions should normalize into the shared entitlement projection", async () => {
    const db = fakeDb();
    const result = await handleCryptoWebhookEvent({
      db,
      event: cryptoEvent("crypto.subscription.active", {}, "crypto_evt_active"),
      env,
      now
    });
    const entitlement = db.store.get(`players/${uid}/entitlements/current`);
    const billing = supportBillingProjection(db.store.get(`players/${uid}/billing/current`));
    const serialized = JSON.stringify(billing);
    return result.ok === true &&
      result.action === "project" &&
      result.betaOnly === true &&
      entitlement.entitlementStatus === "pro" &&
      entitlement.syncCadenceSeconds === 10 &&
      entitlement.maxDevices === 5 &&
      billing.provider === "crypto_wallet" &&
      billing.providerTransactionId === "tx_abstract_123" &&
      billing.providerRenewalState === "active" &&
      billing.providerWalletReference === "wallet_ref_abstract" &&
      !serialized.includes("crypto_webhook_secret");
  });

  await check("crypto payment failures should map to past_due grace without changing the entitlement contract", async () => {
    const db = fakeDb();
    const result = await handleCryptoWebhookEvent({
      db,
      event: cryptoEvent("crypto.subscription.payment_failed", {}, "crypto_evt_failed"),
      env,
      now
    });
    const billing = db.store.get(`players/${uid}/billing/current`);
    const entitlement = db.store.get(`players/${uid}/entitlements/current`);
    return result.billingStatus === "past_due" &&
      billing.gracePeriodEnd === "2026-05-29T00:00:00.000Z" &&
      entitlement.entitlementStatus === "pro" &&
      entitlement.accessReason === "grace_period";
  });

  await check("crypto cancellations and wallet disconnects should revoke effective Pro when no paid period remains", async () => {
    const db = fakeDb();
    const canceled = await handleCryptoWebhookEvent({
      db,
      event: cryptoEvent("crypto.subscription.canceled", { cancelAtPeriodEnd: false }, "crypto_evt_canceled"),
      env,
      now
    });
    const disconnected = await handleCryptoWebhookEvent({
      db,
      event: cryptoEvent("crypto.subscription.wallet_disconnected", { id: "crypto_sub_456" }, "crypto_evt_wallet_disconnected"),
      env,
      now
    });
    const entitlement = db.store.get(`players/${uid}/entitlements/current`);
    return canceled.billingStatus === "canceled" &&
      disconnected.billingStatus === "canceled" &&
      entitlement.entitlementStatus === "free" &&
      entitlement.accessReason === "canceled";
  });

  await check("crypto refunds and chargeback-equivalent events should fall back to Free", async () => {
    const db = fakeDb();
    const result = await handleCryptoWebhookEvent({
      db,
      event: cryptoEvent("crypto.subscription.chargeback", {}, "crypto_evt_chargeback"),
      env,
      now
    });
    const entitlement = db.store.get(`players/${uid}/entitlements/current`);
    return result.billingStatus === "unpaid" &&
      entitlement.entitlementStatus === "free" &&
      entitlement.accessReason === "unpaid";
  });

  await check("crypto webhook event handling should be idempotent", async () => {
    const db = fakeDb();
    const event = cryptoEvent("crypto.subscription.renewed", {}, "crypto_evt_repeat");
    const first = await handleCryptoWebhookEvent({ db, event, env, now });
    const second = await handleCryptoWebhookEvent({ db, event, env, now });
    return first.action === "project" &&
      first.entitlementStatus === "pro" &&
      second.duplicate === true &&
      auditDocs(db).filter((audit) => audit.providerEventId === "crypto_evt_repeat").length === 1;
  });

  await check("unknown crypto plan IDs should not grant Pro", async () => {
    const db = fakeDb();
    const result = await handleCryptoWebhookEvent({
      db,
      event: cryptoEvent("crypto.subscription.active", { planId: "unknown_crypto_plan" }, "crypto_evt_unknown_plan"),
      env,
      now
    });
    return result.action === "ignored" &&
      result.reason === "unknown_plan_id" &&
      !db.store.has(`players/${uid}/entitlements/current`);
  });

  await check("production mode can be represented without making crypto the primary path", () => {
    const launch = cryptoProviderLaunchState({
      ...env,
      CRYPTO_PROVIDER_LAUNCH_MODE: "production"
    });
    return launch.launchBlocked === false &&
      launch.betaOnly === false &&
      launch.stripePrimary === true;
  });

  console.log(JSON.stringify({
    ok: true,
    checks
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
