"use strict";

const crypto = require("crypto");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "demo-mcp-miner";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

async function requestJson(url, options, expectedStatus = 200) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`${options.method || "GET"} ${url} expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  return body;
}

function firebaseAdmin() {
  const admin = require("../firebase/functions/node_modules/firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  return admin;
}

async function verifyEmulatorUser(uid) {
  await firebaseAdmin().auth().updateUser(uid, { emailVerified: true });
}

async function signIn(email, password) {
  return requestJson(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });
}

async function signUp(label) {
  const email = `${label}-${Date.now()}@mcp-miner.local`;
  const password = "local-emulator-only";
  const created = await requestJson(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });
  await verifyEmulatorUser(created.localId);
  return signIn(email, password);
}

function documentUrl(path) {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
}

function authHeaders(idToken) {
  return {
    authorization: `Bearer ${idToken}`
  };
}

function stringField(value) {
  return { stringValue: value };
}

function boolField(value) {
  return { booleanValue: value };
}

function intField(value) {
  return { integerValue: String(value) };
}

function mapField(fields) {
  return { mapValue: { fields } };
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(event) {
  return crypto.createHash("sha256").update(stableJson({
    eventId: event.eventId,
    eventType: event.eventType,
    observedFields: event.observedFields || {},
    privacyClass: event.privacyClass,
    schemaVersion: event.schemaVersion,
    sequence: event.sequence,
    source: event.source,
    timestamp: event.timestamp,
    turnId: event.turnId || null
  })).digest("hex");
}

async function patchDoc(path, token, fields, expectedStatus = 200) {
  return requestJson(documentUrl(path), {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ fields })
  }, expectedStatus);
}

async function getDoc(path, token, expectedStatus = 200) {
  return requestJson(documentUrl(path), {
    method: "GET",
    headers: authHeaders(token)
  }, expectedStatus);
}

async function main() {
  const owner = await signUp("owner");
  const other = await signUp("other");
  const now = new Date().toISOString();

  const profileFields = {
    ownerUid: stringField(owner.localId),
    schemaVersion: intField(1),
    updatedAt: stringField(now),
    privacyClass: stringField("abstract"),
    displayName: stringField("Local Prospector"),
    minerName: stringField("Prospector")
  };

  await patchDoc(`players/${owner.localId}/profile/current`, owner.idToken, profileFields);
  await patchDoc(`players/${owner.localId}/profile/current`, other.idToken, {
    ...profileFields,
    ownerUid: stringField(other.localId)
  }, 403);
  await patchDoc(`players/${owner.localId}/settings/current`, owner.idToken, {
    ownerUid: stringField(owner.localId),
    schemaVersion: intField(1),
    updatedAt: stringField(now),
    privacyClass: stringField("abstract"),
    reportMode: stringField("meaningful_turns_only"),
    cloudSyncEnabled: boolField(true),
    weeklyDigestEnabled: boolField(false),
    betaFeaturesEnabled: boolField(true)
  });

  const rewardEvent = {
    eventId: "evt_rules_smoke",
    eventType: "work_apply_patch",
    schemaVersion: 1,
    sequence: 1,
    timestamp: now,
    turnId: "turn_rules_smoke",
    privacyClass: "abstract",
    source: "codex_hook",
    signature: "v1.rules-smoke",
    observedFields: {
      changedLines: 12,
      filesTouchedCount: 2
    }
  };
  rewardEvent.checksum = checksum(rewardEvent);
  const rewardFields = {
    ownerUid: stringField(owner.localId),
    eventId: stringField(rewardEvent.eventId),
    eventType: stringField(rewardEvent.eventType),
    schemaVersion: intField(rewardEvent.schemaVersion),
    sequence: intField(rewardEvent.sequence),
    timestamp: stringField(rewardEvent.timestamp),
    turnId: stringField(rewardEvent.turnId),
    privacyClass: stringField(rewardEvent.privacyClass),
    source: stringField(rewardEvent.source),
    signature: stringField(rewardEvent.signature),
    checksum: stringField(rewardEvent.checksum),
    observedFields: mapField({
      changedLines: intField(12),
      filesTouchedCount: intField(2)
    })
  };
  await patchDoc(`players/${owner.localId}/rewardEvents/evt_rules_smoke`, owner.idToken, rewardFields);

  await patchDoc(`players/${owner.localId}/rewardEvents/evt_rules_private`, owner.idToken, {
    ...rewardFields,
    eventId: stringField("evt_rules_private"),
    prompt: stringField("this must not sync")
  }, 403);

  await patchDoc(`players/${owner.localId}/gameState/current`, owner.idToken, {
    ownerUid: stringField(owner.localId),
    privacyClass: stringField("abstract"),
    spaceBucks: intField(999999)
  }, 403);

  const entitlementFields = {
    ownerUid: stringField(owner.localId),
    schemaVersion: intField(1),
    privacyClass: stringField("abstract"),
    plan: stringField("pro_monthly"),
    billingStatus: stringField("active"),
    provider: stringField("stripe"),
    providerCustomerId: stringField("cus_rules_smoke"),
    providerSubscriptionId: stringField("sub_rules_smoke"),
    currentPeriodEnd: stringField(now),
    cancelAtPeriodEnd: boolField(false),
    syncCadenceSeconds: intField(10),
    maxDevices: intField(5),
    historyRetentionDays: intField(365),
    features: mapField({
      nearRealTimeSync: boolField(true),
      manualRefresh: boolField(true),
      deviceManagement: boolField(true),
      backupRestore: boolField(true),
      advancedDashboard: boolField(true),
      premiumCosmetics: boolField(true),
      weeklyDigest: boolField(true),
      exports: boolField(true),
      priorityBetaAccess: boolField(true)
    }),
    updatedAt: stringField(now)
  };
  const adminDb = firebaseAdmin().firestore();
  await adminDb.doc(`players/${owner.localId}/billing/current`).set({
    ownerUid: owner.localId,
    schemaVersion: 1,
    privacyClass: "abstract",
    plan: "pro_monthly",
    billingStatus: "active",
    provider: "stripe",
    providerCustomerId: "cus_rules_smoke",
    providerSubscriptionId: "sub_rules_smoke",
    currentPeriodEnd: now,
    cancelAtPeriodEnd: false,
    syncCadenceSeconds: 10,
    maxDevices: 5,
    historyRetentionDays: 365,
    features: {
      nearRealTimeSync: true,
      manualRefresh: true,
      deviceManagement: true,
      backupRestore: true,
      advancedDashboard: true,
      premiumCosmetics: true,
      weeklyDigest: true,
      exports: true,
      priorityBetaAccess: true
    },
    updatedAt: now
  });
  await adminDb.doc(`players/${owner.localId}/entitlements/current`).set({
    ownerUid: owner.localId,
    schemaVersion: 1,
    privacyClass: "abstract",
    plan: "pro_monthly",
    billingStatus: "active",
    provider: "stripe",
    providerCustomerId: "cus_rules_smoke",
    providerSubscriptionId: "sub_rules_smoke",
    currentPeriodEnd: now,
    cancelAtPeriodEnd: false,
    syncCadenceSeconds: 10,
    maxDevices: 5,
    historyRetentionDays: 365,
    features: {
      nearRealTimeSync: true,
      manualRefresh: true,
      deviceManagement: true,
      backupRestore: true,
      advancedDashboard: true,
      premiumCosmetics: true,
      weeklyDigest: true,
      exports: true,
      priorityBetaAccess: true
    },
    updatedAt: now
  });
  await adminDb.doc(`players/${owner.localId}/cosmetics/current`).set({
    ownerUid: owner.localId,
    schemaVersion: 1,
    privacyClass: "abstract",
    applied: {
      suit_trim: "suit_trim_aurora",
      portal_theme: "portal_theme_nebula"
    },
    ownedCosmeticIds: [],
    retainedCosmeticIds: [],
    updatedAt: now,
    noProgressionEffects: true
  });
  await getDoc(`players/${owner.localId}/entitlements/current`, owner.idToken);
  await getDoc(`players/${owner.localId}/billing/current`, owner.idToken);
  await getDoc(`players/${owner.localId}/cosmetics/current`, owner.idToken);
  await patchDoc(`players/${owner.localId}/entitlements/current`, owner.idToken, entitlementFields, 403);
  await patchDoc(`players/${owner.localId}/billing/current`, owner.idToken, entitlementFields, 403);
  await patchDoc(`players/${owner.localId}/cosmetics/current`, owner.idToken, {
    ownerUid: stringField(owner.localId),
    schemaVersion: intField(1),
    privacyClass: stringField("abstract"),
    applied: mapField({
      portal_theme: stringField("portal_theme_prism_beta")
    }),
    noProgressionEffects: boolField(true)
  }, 403);

  console.log(JSON.stringify({
    ok: true,
    projectId: PROJECT_ID,
    ownerUid: owner.localId,
    cases: [
      "owner_profile_allow",
      "owner_settings_digest_beta_allow",
      "cross_user_profile_deny",
      "abstract_reward_event_allow",
      "private_reward_event_deny",
      "aggregate_game_state_write_deny",
      "admin_entitlement_projection_read_allow",
      "client_entitlement_write_deny",
      "client_billing_write_deny",
      "server_cosmetics_read_allow",
      "client_cosmetics_write_deny"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
