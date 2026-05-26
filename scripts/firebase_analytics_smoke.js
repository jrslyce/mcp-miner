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
    eventId: `evt_analytics_${index}_${Date.now()}`,
    eventType: index % 2 === 0 ? "work_test_pass" : "work_apply_patch",
    schemaVersion: 1,
    sequence: index,
    timestamp: overrides.timestamp || new Date().toISOString(),
    turnId: `turn_analytics_${index}`,
    observedFields: {
      score: overrides.score || (index * 2),
      category: overrides.category || (index % 2 === 0 ? "validation" : "implementation")
    },
    privacyClass: "abstract",
    source: "codex_hook",
    signature: "v1.analytics-smoke"
  };
  event.checksum = eventChecksum(event);
  return event;
}

function errorReason(response) {
  return response && response.error && response.error.details
    ? response.error.details.reason
    : null;
}

async function main() {
  const freeUser = await signUp("analytics-free");
  const otherUser = await signUp("analytics-other");
  const proUser = await signUp("analytics-pro");
  await setEntitlement(proUser.localId, "pro_monthly");

  const freeEvent = syncEvent(freeUser.localId, 1);
  await callFunction("syncRewardEvents", freeUser.idToken, { events: [freeEvent] });
  const freeAnalytics = await callFunction("getDashboardAnalytics", freeUser.idToken, {});
  const freeExport = await callFunction("exportDashboardHistory", freeUser.idToken, { format: "json" }, false);

  const proEvents = [syncEvent(proUser.localId, 1), syncEvent(proUser.localId, 2), syncEvent(proUser.localId, 3)];
  await callFunction("syncRewardEvents", proUser.idToken, { events: proEvents });
  await firestore().doc(`players/${proUser.localId}/inventory/current`).set({
    materialId: "mat_iron",
    quantity: 4,
    totalSpaceBucks: 24
  });
  await firestore().doc(`players/${proUser.localId}/orders/order_ready`).set({
    orderId: "order_ready",
    rewardSpaceBucks: 100,
    canFulfill: true
  });
  const proAnalytics = await callFunction("getDashboardAnalytics", proUser.idToken, {});
  const jsonExport = await callFunction("exportDashboardHistory", proUser.idToken, { format: "json" });
  const csvExport = await callFunction("exportDashboardHistory", proUser.idToken, { format: "csv" });
  const crossUserExport = await callFunction("exportDashboardHistory", proUser.idToken, {
    uid: otherUser.localId,
    format: "json"
  }, false);

  if (!freeAnalytics.result || freeAnalytics.result.retention.limited !== true || freeAnalytics.result.retention.days !== 7) {
    throw new Error("Free analytics did not return limited seven-day history");
  }
  if (!freeExport.error || freeExport.error.status !== "RESOURCE_EXHAUSTED" || errorReason(freeExport) !== "plan_limit_exports") {
    throw new Error("Free export was not denied with plan_limit_exports");
  }
  if (!proAnalytics.result || proAnalytics.result.retention.limited !== false || proAnalytics.result.history.length < 3) {
    throw new Error("Pro analytics did not return extended history");
  }
  if (!proAnalytics.result.trends.eventsByCategory.length || proAnalytics.result.current.materialValue !== 24 || proAnalytics.result.current.orderEfficiency.readyPercent !== 100) {
    throw new Error("Pro analytics did not include category, material value, and order efficiency data");
  }
  if (!jsonExport.result || jsonExport.result.mimeType !== "application/json" || jsonExport.result.content.includes("prompt") || jsonExport.result.content.includes("filePath")) {
    throw new Error("JSON export was missing or leaked private field names");
  }
  if (!csvExport.result || csvExport.result.mimeType !== "text/csv" || !csvExport.result.content.startsWith("eventId,eventType,timestamp")) {
    throw new Error("CSV export did not include the fixed abstract header");
  }
  if (!crossUserExport.error || crossUserExport.error.status !== "PERMISSION_DENIED") {
    throw new Error("Cross-user export was not denied");
  }

  console.log(JSON.stringify({
    ok: true,
    freeHistoryLimited: freeAnalytics.result.retention.limited,
    freeExportDenied: errorReason(freeExport),
    proHistoryEvents: proAnalytics.result.history.length,
    jsonExportBytes: jsonExport.result.content.length,
    csvLines: csvExport.result.content.split("\n").length,
    crossUserExport: crossUserExport.error.status
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
