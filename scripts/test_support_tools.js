"use strict";

const assert = require("assert");
const {
  forceEntitlementRefresh,
  inspectSupportAccount,
  markBillingProjectionStale,
  reconcileStripeEntitlement,
  requireSupportActor,
  revokeSupportDevice,
  sanitizeAuditDetails
} = require("../firebase/functions/src/support_tools");

const env = {
  STRIPE_PRO_MONTHLY_PRICE_ID: "price_monthly",
  STRIPE_PRO_ANNUAL_PRICE_ID: "price_annual"
};
const now = "2026-05-26T00:00:00.000Z";
const actor = "support:jared";
const uid = "firebase_uid_123";

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

function fakeQuery(store, collectionPath, filters = [], max = null) {
  return {
    path: collectionPath,
    where(field, op, value) {
      return fakeQuery(store, collectionPath, [...filters, { field, op, value }], max);
    },
    limit(value) {
      return fakeQuery(store, collectionPath, filters, value);
    },
    async get() {
      const prefix = `${collectionPath}/`;
      const docs = [...store.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .filter(([, data]) => filters.every((filter) => {
          return filter.op === "==" && data && data[filter.field] === filter.value;
        }))
        .slice(0, max || undefined)
        .map(([path, data]) => fakeSnapshot(path, data, store));
      return { docs };
    }
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
    collection(path) {
      return fakeQuery(store, path);
    },
    async runTransaction(fn) {
      const transaction = {
        async get(refOrQuery) {
          return refOrQuery.get();
        },
        set(ref, data, options = {}) {
          store.set(ref.path, options.merge ? { ...(store.get(ref.path) || {}), ...clone(data) } : clone(data));
        }
      };
      return fn(transaction);
    }
  };
}

function billing(overrides = {}) {
  return {
    ownerUid: uid,
    schemaVersion: 1,
    privacyClass: "abstract",
    plan: "pro_monthly",
    billingStatus: "checkout_pending",
    provider: "stripe",
    providerCustomerId: "cus_test_123",
    providerSubscriptionId: "sub_test_123",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    updatedAt: now,
    ...overrides
  };
}

function subscription(overrides = {}) {
  return {
    id: "sub_test_123",
    customer: "cus_test_123",
    status: "active",
    current_period_end: 1782172800,
    cancel_at_period_end: false,
    metadata: {
      firebaseUid: uid
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

function fakeStripe(sub, listed = []) {
  return {
    subscriptions: {
      async retrieve(id) {
        return {
          ...(sub || subscription()),
          id
        };
      },
      async list() {
        return {
          data: listed
        };
      }
    }
  };
}

function accountSeed(overrides = {}) {
  return {
    [`players/${uid}`]: {
      ownerUid: uid,
      privacyClass: "abstract",
      cloudSyncEnabled: true,
      accountLinkedAt: "2026-05-25T00:00:00.000Z",
      displayName: "Private-ish player name"
    },
    [`players/${uid}/billing/current`]: billing(overrides.billing),
    [`players/${uid}/entitlements/current`]: {
      ownerUid: uid,
      privacyClass: "abstract",
      plan: "free",
      billingStatus: "checkout_pending",
      entitlementStatus: "free",
      accessReason: "checkout_pending",
      updatedAt: now
    },
    [`players/${uid}/syncDevices/device_aaaaaaaaaaaaaaaaaaaa`]: {
      ownerUid: uid,
      deviceId: "device_aaaaaaaaaaaaaaaaaaaa",
      deviceName: "Desk Codex",
      status: "active",
      privacyClass: "abstract",
      scopes: ["sync:read", "sync:write"],
      createdAt: now,
      updatedAt: now,
      tokenHash: "do_not_show",
      deviceSecretHash: "do_not_show",
      prompt: "do_not_show"
    },
    [`players/${uid}/syncMetadata/default`]: {
      ownerUid: uid,
      clientId: "default",
      privacyClass: "abstract",
      lastAcceptedBatchAt: "2026-05-25T23:59:00.000Z",
      command: "do_not_show"
    },
    "deviceTokens/token_hash_private": {
      uid,
      deviceId: "device_aaaaaaaaaaaaaaaaaaaa",
      status: "active",
      tokenHash: "do_not_show"
    },
    ...(overrides.seed || {})
  };
}

function auditDocs(db) {
  return [...db.store.entries()]
    .filter(([path]) => path.startsWith("supportAuditLogs/"))
    .map(([, data]) => data);
}

let checks = 0;
async function check(message, fn) {
  assert.ok(await fn(), message);
  checks += 1;
}

(async () => {
  await check("support actor validation should reject non-admin callers", () => {
    try {
      requireSupportActor("");
    } catch (error) {
      return error.code === "permission-denied" && error.reason === "missing_support_actor";
    }
    return false;
  });

  await check("audit details should redact secret and private keys", () => {
    const safe = sanitizeAuditDetails({
      tokenHash: "secret",
      deviceSecretHash: "secret",
      rawPayload: "secret",
      providerCustomerId: "cus_test_123",
      tokenCount: 1
    });
    return safe.providerCustomerId === "cus_test_123" &&
      safe.tokenCount === 1 &&
      !("tokenHash" in safe) &&
      !("rawPayload" in safe);
  });

  await check("account inspection should return support-safe billing, devices, and sync metadata", async () => {
    const db = fakeDb(accountSeed());
    const summary = await inspectSupportAccount({ db, uid, actor, now });
    const serialized = JSON.stringify(summary);
    return summary.billing.providerCustomerId === "cus_test_123" &&
      summary.billing.providerSubscriptionId === "sub_test_123" &&
      summary.linkedDevices[0].deviceId === "device_aaaaaaaaaaaaaaaaaaaa" &&
      summary.syncMetadata[0].lastAcceptedBatchAt === "2026-05-25T23:59:00.000Z" &&
      auditDocs(db).some((audit) => audit.action === "inspect_account" && audit.actor === actor) &&
      !serialized.includes("do_not_show") &&
      !serialized.includes("Private-ish player name");
  });

  await check("Stripe reconciliation should project active subscriptions from provider evidence", async () => {
    const db = fakeDb(accountSeed());
    const result = await reconcileStripeEntitlement({
      db,
      stripe: fakeStripe(subscription({ status: "active" })),
      uid,
      actor,
      env,
      now
    });
    const entitlement = db.store.get(`players/${uid}/entitlements/current`);
    return result.ok === true &&
      result.entitlement.entitlementStatus === "pro" &&
      entitlement.entitlementStatus === "pro" &&
      entitlement.accessReason === "active" &&
      auditDocs(db).some((audit) => audit.action === "reconcile_stripe_entitlement" && audit.result === "ok");
  });

  await check("Stripe reconciliation should project canceled subscriptions back to Free", async () => {
    const db = fakeDb(accountSeed());
    const result = await reconcileStripeEntitlement({
      db,
      stripe: fakeStripe(subscription({ status: "canceled", cancel_at_period_end: false })),
      uid,
      actor,
      env,
      now
    });
    return result.ok === true &&
      result.billing.billingStatus === "canceled" &&
      result.entitlement.entitlementStatus === "free" &&
      result.entitlement.accessReason === "canceled";
  });

  await check("Stripe reconciliation should keep past_due subscriptions inside grace", async () => {
    const db = fakeDb(accountSeed());
    const result = await reconcileStripeEntitlement({
      db,
      stripe: fakeStripe(subscription({ status: "past_due" })),
      uid,
      actor,
      env,
      now
    });
    const billingDoc = db.store.get(`players/${uid}/billing/current`);
    return result.ok === true &&
      result.billing.billingStatus === "past_due" &&
      billingDoc.gracePeriodEnd === "2026-05-29T00:00:00.000Z" &&
      result.entitlement.entitlementStatus === "pro" &&
      result.entitlement.accessReason === "grace_period";
  });

  await check("Stripe reconciliation should fail when the account has no Stripe customer", async () => {
    const db = fakeDb(accountSeed({ billing: { providerCustomerId: null, providerSubscriptionId: null } }));
    try {
      await reconcileStripeEntitlement({
        db,
        stripe: fakeStripe(subscription()),
        uid,
        actor,
        env,
        now
      });
    } catch (error) {
      return error.reason === "missing_stripe_customer" &&
        auditDocs(db).some((audit) => audit.result === "failed" && audit.reason === "missing_stripe_customer");
    }
    return false;
  });

  await check("Stripe reconciliation should ignore unknown price IDs without granting Pro", async () => {
    const db = fakeDb(accountSeed());
    const result = await reconcileStripeEntitlement({
      db,
      stripe: fakeStripe(subscription({
        items: { data: [{ price: { id: "price_unknown" } }] }
      })),
      uid,
      actor,
      env,
      now
    });
    const entitlement = db.store.get(`players/${uid}/entitlements/current`);
    return result.ok === false &&
      result.reason === "unknown_price_id" &&
      entitlement.entitlementStatus === "free" &&
      auditDocs(db).some((audit) => audit.result === "ignored" && audit.reason === "unknown_price_id");
  });

  await check("force entitlement refresh should recalculate from billing without manual grants", async () => {
    const db = fakeDb(accountSeed({ billing: { billingStatus: "active", updatedAt: "1970-01-01T00:00:00.000Z" } }));
    const result = await forceEntitlementRefresh({ db, uid, actor, now });
    return result.entitlement.entitlementStatus === "free" &&
      result.entitlement.accessReason === "stale" &&
      auditDocs(db).some((audit) => audit.action === "force_entitlement_refresh" && audit.result === "ok");
  });

  await check("marking billing stale should remove effective paid access and audit the action", async () => {
    const db = fakeDb(accountSeed({ billing: { billingStatus: "active" } }));
    const result = await markBillingProjectionStale({
      db,
      uid,
      actor,
      reason: "checkout succeeded but webhook missing",
      now
    });
    return result.billing.updatedAt === "1970-01-01T00:00:00.000Z" &&
      result.entitlement.entitlementStatus === "free" &&
      auditDocs(db).some((audit) => audit.action === "mark_billing_projection_stale" && audit.reason === "checkout succeeded but webhook missing");
  });

  await check("support device revocation should revoke metadata and matching token records", async () => {
    const db = fakeDb(accountSeed());
    const result = await revokeSupportDevice({
      db,
      uid,
      actor,
      deviceId: "device_aaaaaaaaaaaaaaaaaaaa",
      now
    });
    const device = db.store.get(`players/${uid}/syncDevices/device_aaaaaaaaaaaaaaaaaaaa`);
    const token = db.store.get("deviceTokens/token_hash_private");
    return result.revokedTokenCount === 1 &&
      device.status === "revoked" &&
      device.revokedBy === "support" &&
      token.status === "revoked" &&
      auditDocs(db).some((audit) => audit.action === "revoke_device" && audit.details.tokenCount === 1);
  });

  console.log(JSON.stringify({
    ok: true,
    checks
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
