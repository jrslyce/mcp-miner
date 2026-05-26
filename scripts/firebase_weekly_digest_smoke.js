"use strict";

const { eventChecksum } = require("../firebase/functions/src/sync");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "demo-mcp-miner";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";

async function requestJson(url, options, expectedOk = true) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (expectedOk && !response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed: ${response.status} ${text}`);
  }
  if (!expectedOk && response.ok && !body.error) {
    throw new Error(`${options.method || "GET"} ${url} unexpectedly succeeded: ${text}`);
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

function firestore() {
  return firebaseAdmin().firestore();
}

async function verifyEmulatorUser(uid) {
  await firebaseAdmin().auth().updateUser(uid, { emailVerified: true });
}

async function signUp(label) {
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@mcp-miner.local`;
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
  return requestJson(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });
}

async function callFunction(name, idToken, data, expectedOk = true) {
  return requestJson(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/us-central1/${name}`, {
    method: "POST",
    headers: idToken ? { authorization: `Bearer ${idToken}` } : {},
    body: JSON.stringify({ data })
  }, expectedOk);
}

async function setEntitlement(uid, plan) {
  const now = new Date().toISOString();
  const isPro = plan !== "free";
  await firestore().doc(`players/${uid}/entitlements/current`).set({
    ownerUid: uid,
    schemaVersion: 1,
    privacyClass: "abstract",
    plan,
    billingStatus: isPro ? "active" : "free",
    provider: isPro ? "stripe" : null,
    providerCustomerId: isPro ? `cus_${uid.slice(0, 8)}` : null,
    providerSubscriptionId: isPro ? `sub_${uid.slice(0, 8)}` : null,
    currentPeriodEnd: isPro ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
    cancelAtPeriodEnd: false,
    updatedAt: now
  }, { merge: true });
}

function syncEvent(uid, index, overrides = {}) {
  const event = {
    ownerUid: uid,
    eventId: `evt_digest_${index}_${Date.now()}`,
    eventType: overrides.eventType || "work_apply_patch",
    schemaVersion: 1,
    sequence: index,
    timestamp: overrides.timestamp || new Date().toISOString(),
    turnId: `turn_digest_${index}`,
    observedFields: {
      score: overrides.score || 10,
      category: overrides.category || "implementation",
      ...(overrides.observedFields || {})
    },
    privacyClass: "abstract",
    source: "codex_hook",
    signature: "v1.digest-smoke"
  };
  event.checksum = eventChecksum(event);
  return event;
}

async function main() {
  const freeUser = await signUp("digest-free");
  const proUser = await signUp("digest-pro");
  await setEntitlement(freeUser.localId, "free");
  await setEntitlement(proUser.localId, "pro_monthly");

  const freeDigest = await callFunction("getWeeklyDigest", freeUser.idToken, {});
  if (!freeDigest.result || freeDigest.result.weeklyDigest.status !== "locked") {
    throw new Error("Free user weekly digest was not locked");
  }

  await firestore().doc(`players/${proUser.localId}/settings/current`).set({
    ownerUid: proUser.localId,
    schemaVersion: 1,
    privacyClass: "abstract",
    weeklyDigestEnabled: true,
    betaFeaturesEnabled: true,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  await callFunction("syncRewardEvents", proUser.idToken, {
    events: [
      syncEvent(proUser.localId, 1),
      syncEvent(proUser.localId, 2, {
        category: "validation",
        score: 6
      })
    ]
  });
  await firestore().doc(`players/${proUser.localId}/rewardEvents/evt_digest_private_admin`).set({
    ownerUid: proUser.localId,
    eventId: "evt_digest_private_admin",
    eventType: "work_apply_patch",
    schemaVersion: 1,
    sequence: 99,
    timestamp: new Date().toISOString(),
    privacyClass: "abstract",
    source: "codex_hook",
    observedFields: {
      score: 1,
      category: "implementation",
      prompt: "private text must not leak"
    }
  }, { merge: true });
  await firestore().doc(`players/${proUser.localId}/gameState/current`).set({
    ownerUid: proUser.localId,
    schemaVersion: 1,
    privacyClass: "abstract",
    spaceBucks: 640,
    asteroidProgress: {
      mined: 520
    }
  }, { merge: true });
  await firestore().doc(`players/${proUser.localId}/inventory/current`).set({
    items: [
      { materialId: "mat_chonks", quantity: 144 },
      { materialId: "mat_iron", quantity: 4, totalSpaceBucks: 24 },
      { materialId: "mat_quartz", quantity: 2, totalSpaceBucks: 50 }
    ]
  }, { merge: true });
  await firestore().doc(`players/${proUser.localId}/orders/order_ready`).set({
    orderId: "order_ready",
    canFulfill: true,
    rewardSpaceBucks: 220
  }, { merge: true });
  await firestore().doc(`players/${proUser.localId}/base/current`).set({
    ownerUid: proUser.localId,
    privacyClass: "abstract",
    moduleCount: 2,
    droneLevel: 1,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  await firestore().doc(`players/${proUser.localId}/cosmetics/current`).set({
    ownerUid: proUser.localId,
    schemaVersion: 1,
    privacyClass: "abstract",
    applied: {
      portal_theme: "portal_theme_nebula"
    },
    updatedAt: new Date().toISOString(),
    noProgressionEffects: true
  }, { merge: true });

  const proDigest = await callFunction("getWeeklyDigest", proUser.idToken, {});
  const serializedDigest = JSON.stringify(proDigest.result.weeklyDigest);
  if (!proDigest.result || proDigest.result.weeklyDigest.status !== "ready") {
    throw new Error("Pro user weekly digest was not ready");
  }
  if (proDigest.result.weeklyDigest.summary.events.eventCount < 2 || proDigest.result.weeklyDigest.summary.chonks.mined !== 144) {
    throw new Error("Pro weekly digest did not aggregate events and Chonks");
  }
  if (!proDigest.result.weeklyDigest.preferences.effectiveBetaAccess) {
    throw new Error("Pro weekly digest did not expose beta opt-in access");
  }
  if (serializedDigest.includes("prompt") || serializedDigest.includes("private text")) {
    throw new Error("Weekly digest leaked a private observed field");
  }

  await firestore().doc(`players/${proUser.localId}/settings/current`).set({
    weeklyDigestEnabled: false,
    betaFeaturesEnabled: false,
    updatedAt: new Date().toISOString()
  }, { merge: true });
  const disabledDigest = await callFunction("getWeeklyDigest", proUser.idToken, {});
  if (!disabledDigest.result || disabledDigest.result.weeklyDigest.status !== "disabled" || disabledDigest.result.weeklyDigest.preferences.effectiveBetaAccess !== false) {
    throw new Error("Disabled digest or beta preference was not honored");
  }

  console.log(JSON.stringify({
    ok: true,
    freeStatus: freeDigest.result.weeklyDigest.status,
    proStatus: proDigest.result.weeklyDigest.status,
    disabledStatus: disabledDigest.result.weeklyDigest.status,
    eventCount: proDigest.result.weeklyDigest.summary.events.eventCount,
    chonks: proDigest.result.weeklyDigest.summary.chonks.mined
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
