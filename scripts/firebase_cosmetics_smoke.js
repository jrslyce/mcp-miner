"use strict";

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

function errorReason(response) {
  return response && response.error && response.error.details
    ? response.error.details.reason
    : null;
}

async function main() {
  const freeUser = await signUp("cosmetics-free");
  const proUser = await signUp("cosmetics-pro");
  const otherUser = await signUp("cosmetics-other");
  await setEntitlement(freeUser.localId, "free");
  await setEntitlement(proUser.localId, "pro_monthly");

  await firestore().doc(`players/${freeUser.localId}/profile/current`).set({
    ownerUid: freeUser.localId,
    schemaVersion: 1,
    privacyClass: "abstract",
    customizationUnlocks: ["suit_trim_teal", "survey_badge_gold"],
    updatedAt: new Date().toISOString()
  }, { merge: true });
  await firestore().doc(`players/${freeUser.localId}/cosmetics/current`).set({
    ownerUid: freeUser.localId,
    schemaVersion: 1,
    privacyClass: "abstract",
    retainedCosmeticIds: ["profile_badge_founder_legacy"],
    updatedAt: new Date().toISOString(),
    noProgressionEffects: true
  }, { merge: true });

  const freeCatalog = await callFunction("getCosmeticCatalog", freeUser.idToken, {});
  const freeProApply = await callFunction("applyCosmeticSelection", freeUser.idToken, {
    category: "portal_theme",
    cosmeticId: "portal_theme_nebula",
    ownedCosmeticIds: ["portal_theme_nebula"]
  }, false);
  const freeUnlockApply = await callFunction("applyCosmeticSelection", freeUser.idToken, {
    category: "suit_trim",
    cosmeticId: "suit_trim_teal"
  });
  const retiredApply = await callFunction("applyCosmeticSelection", freeUser.idToken, {
    category: "profile_badge",
    cosmeticId: "profile_badge_founder_legacy"
  });

  const proApply = await callFunction("applyCosmeticSelection", proUser.idToken, {
    category: "portal_theme",
    cosmeticId: "portal_theme_nebula"
  });
  const crossUserApply = await callFunction("applyCosmeticSelection", proUser.idToken, {
    uid: otherUser.localId,
    category: "portal_theme",
    cosmeticId: "portal_theme_nebula"
  }, false);

  await setEntitlement(proUser.localId, "free");
  const downgradedCatalog = await callFunction("getCosmeticCatalog", proUser.idToken, {});
  const downgradedApply = await callFunction("applyCosmeticSelection", proUser.idToken, {
    category: "portal_theme",
    cosmeticId: "portal_theme_nebula"
  }, false);

  if (!freeCatalog.result || freeCatalog.result.cosmetics.items.find((item) => item.id === "portal_theme_nebula").lockedReason !== "plan_limit_premium_cosmetic") {
    throw new Error("Free catalog did not lock Pro included cosmetics");
  }
  if (!freeProApply.error || errorReason(freeProApply) !== "plan_limit_premium_cosmetic") {
    throw new Error("Forged Free Pro cosmetic apply was not denied");
  }
  if (!freeUnlockApply.result || freeUnlockApply.result.cosmetics.applied.active.suit_trim !== "suit_trim_teal") {
    throw new Error("Earned unlockable cosmetic was not retained and applied");
  }
  if (!retiredApply.result || retiredApply.result.cosmetics.applied.active.profile_badge !== "profile_badge_founder_legacy") {
    throw new Error("Retired retained cosmetic was not applied");
  }
  if (!proApply.result || proApply.result.cosmetics.applied.active.portal_theme !== "portal_theme_nebula") {
    throw new Error("Pro included cosmetic was not applied for active Pro");
  }
  if (!crossUserApply.error || crossUserApply.error.status !== "PERMISSION_DENIED") {
    throw new Error("Cross-user cosmetic apply was not denied");
  }
  if (!downgradedCatalog.result || downgradedCatalog.result.cosmetics.applied.active.portal_theme !== "portal_theme_standard" || downgradedCatalog.result.cosmetics.applied.inactive.portal_theme !== "portal_theme_nebula") {
    throw new Error("Downgraded Pro cosmetic did not fall back to the Free active theme");
  }
  if (!downgradedApply.error || errorReason(downgradedApply) !== "plan_limit_premium_cosmetic") {
    throw new Error("Downgraded Pro cosmetic apply was not denied");
  }

  console.log(JSON.stringify({
    ok: true,
    freeProDenied: errorReason(freeProApply),
    freeUnlockApplied: freeUnlockApply.result.cosmetics.applied.active.suit_trim,
    proApplied: proApply.result.cosmetics.applied.requested.portal_theme,
    downgradedActive: downgradedCatalog.result.cosmetics.applied.active.portal_theme
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
