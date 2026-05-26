"use strict";

const crypto = require("crypto");

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
  if (!expectedOk && response.ok && !body.error && !(body.result && body.result.rejected && body.result.rejected.length)) {
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
  return requestJson(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });
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

function event(overrides = {}) {
  const base = {
    eventId: "evt_emulator_sync_1",
    eventType: "work_apply_patch",
    schemaVersion: 1,
    sequence: 1,
    timestamp: new Date().toISOString(),
    turnId: "turn_emulator_sync",
    observedFields: {
      changedLines: 12,
      filesTouchedCount: 2,
      score: 8.5
    },
    privacyClass: "abstract",
    source: "codex_hook",
    signature: "v1.emulator-placeholder"
  };
  const next = {
    ...base,
    ...overrides,
    observedFields: {
      ...base.observedFields,
      ...(overrides.observedFields || {})
    }
  };
  next.checksum = checksum(next);
  return next;
}

async function callFunction(name, idToken, data, expectedOk = true) {
  return requestJson(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/us-central1/${name}`, {
    method: "POST",
    headers: idToken
      ? (idToken.startsWith("mcpd_")
        ? { "x-mcp-miner-device-token": idToken }
        : { authorization: `Bearer ${idToken}` })
      : {},
    body: JSON.stringify({ data })
}, expectedOk);
}

async function setEntitlement(uid, plan, overrides = {}) {
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
    updatedAt: now,
    ...overrides
  }, { merge: true });
}

async function backdateAcceptedBatch(uid, secondsAgo) {
  await firestore().doc(`players/${uid}/syncMetadata/default`).set({
    lastAcceptedBatchAt: new Date(Date.now() - (secondsAgo * 1000)).toISOString()
  }, { merge: true });
}

async function linkDevice(idToken, label, dashboardUrl = "http://127.0.0.1:5000") {
  const link = await callFunction("createLinkSession", null, {
    dashboardUrl,
    deviceName: label
  });
  await callFunction("approveLinkSession", idToken, {
    sessionId: link.result.session.sessionId,
    code: link.result.session.code
  });
  return callFunction("exchangeLinkSession", null, {
    sessionId: link.result.session.sessionId,
    deviceSecret: link.result.deviceSecret
  });
}

async function createApprovedLink(idToken, label) {
  const link = await callFunction("createLinkSession", null, {
    dashboardUrl: "http://127.0.0.1:5000",
    deviceName: label
  });
  await callFunction("approveLinkSession", idToken, {
    sessionId: link.result.session.sessionId,
    code: link.result.session.code
  });
  return link;
}

function errorReason(response) {
  return response && response.error && response.error.details
    ? response.error.details.reason
    : null;
}

async function main() {
  const auth = await signUp("sync");

  const valid = event();
  const first = await callFunction("syncRewardEvents", auth.idToken, { events: [valid] });
  const duplicate = await callFunction("syncRewardEvents", auth.idToken, { events: [valid] });
  const freeCadence = await callFunction("syncRewardEvents", auth.idToken, {
    events: [event({ eventId: "evt_emulator_sync_free_cadence", sequence: 2 })]
  }, false);
  await backdateAcceptedBatch(auth.localId, 61);
  const link = await callFunction("createLinkSession", null, {
    dashboardUrl: "http://127.0.0.1:5000",
    deviceName: "Sync API Smoke"
  });
  const badDashboard = await callFunction("createLinkSession", null, {
    dashboardUrl: "https://example.com/phish",
    deviceName: "Bad Dashboard"
  }, false);
  await callFunction("approveLinkSession", auth.idToken, {
    sessionId: link.result.session.sessionId,
    code: link.result.session.code
  });
  const exchanged = await callFunction("exchangeLinkSession", null, {
    sessionId: link.result.session.sessionId,
    deviceSecret: link.result.deviceSecret
  });
  const reapprove = await callFunction("approveLinkSession", auth.idToken, {
    sessionId: link.result.session.sessionId,
    code: link.result.session.code
  }, false);
  const rejectExchanged = await callFunction("rejectLinkSession", auth.idToken, {
    sessionId: link.result.session.sessionId,
    code: link.result.session.code
  }, false);
  const deviceEvent = event({
    eventId: "evt_emulator_sync_device",
    sequence: 2
  });
  const deviceSync = await callFunction("syncRewardEvents", exchanged.result.deviceToken, { events: [deviceEvent] });
  const privateEvent = event({
    eventId: "evt_emulator_sync_private",
    sequence: 3,
    observedFields: {
      prompt: "private"
    }
  });
  privateEvent.checksum = checksum(privateEvent);
  const invalid = await callFunction("syncRewardEvents", auth.idToken, { events: [privateEvent] });
  const state = await callFunction("getSyncState", auth.idToken, {});
  const checkoutForOtherUser = await callFunction("createCheckoutSession", auth.idToken, {
    uid: "different_firebase_uid",
    plan: "pro_monthly",
    dashboardUrl: "http://127.0.0.1:5000"
  }, false);
  const checkoutMissingSecret = await callFunction("createCheckoutSession", auth.idToken, {
    plan: "pro_monthly",
    dashboardUrl: "http://127.0.0.1:5000"
  }, false);

  const freeLimitUser = await signUp("free-device-limit");
  const freeLinkA = await createApprovedLink(freeLimitUser.idToken, "Free Device A");
  const freeLinkB = await createApprovedLink(freeLimitUser.idToken, "Free Device B");
  const freeDeviceA = await callFunction("exchangeLinkSession", null, {
    sessionId: freeLinkA.result.session.sessionId,
    deviceSecret: freeLinkA.result.deviceSecret
  });
  const freeDeviceBRejected = await callFunction("exchangeLinkSession", null, {
    sessionId: freeLinkB.result.session.sessionId,
    deviceSecret: freeLinkB.result.deviceSecret
  }, false);

  const proUser = await signUp("pro-devices");
  await setEntitlement(proUser.localId, "pro_monthly");
  const proLinks = [];
  for (let index = 0; index < 6; index += 1) {
    proLinks.push(await createApprovedLink(proUser.idToken, `Pro Device ${index + 1}`));
  }
  const proDevices = [];
  for (let index = 0; index < 5; index += 1) {
    proDevices.push(await callFunction("exchangeLinkSession", null, {
      sessionId: proLinks[index].result.session.sessionId,
      deviceSecret: proLinks[index].result.deviceSecret
    }));
    await firestore().doc(`players/${proUser.localId}/syncDevices/${proDevices[index].result.deviceId}`).set({
      createdAt: `2026-05-24T00:00:0${index + 1}.000Z`
    }, { merge: true });
  }
  const proSixthRejected = await callFunction("exchangeLinkSession", null, {
    sessionId: proLinks[5].result.session.sessionId,
    deviceSecret: proLinks[5].result.deviceSecret
  }, false);
  await setEntitlement(proUser.localId, "free", {
    provider: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: null
  });
  const downgradedFirst = await callFunction("getSyncState", proDevices[0].result.deviceToken, {});
  const downgradedSecond = await callFunction("getSyncState", proDevices[1].result.deviceToken, {}, false);
  const downgradedDevices = await firestore().collection(`players/${proUser.localId}/syncDevices`).where("status", "==", "active").get();
  await setEntitlement(proUser.localId, "pro_monthly");
  await backdateAcceptedBatch(proUser.localId, 11);
  const proSync = await callFunction("syncRewardEvents", proDevices[0].result.deviceToken, {
    events: [event({
      eventId: "evt_emulator_sync_pro_device",
      sequence: 1,
      ownerUid: proUser.localId
    })]
  });

  if (!first.result || first.result.accepted.length !== 1) {
    throw new Error("valid sync did not accept one event");
  }
  if (!duplicate.result || duplicate.result.duplicates.length !== 1) {
    throw new Error("duplicate sync was not idempotent");
  }
  if (!freeCadence.error || freeCadence.error.status !== "RESOURCE_EXHAUSTED" || errorReason(freeCadence) !== "plan_limit_sync_cadence") {
    throw new Error("Free sync cadence was not server-enforced");
  }
  if (!deviceSync.result || deviceSync.result.accepted.length !== 1) {
    throw new Error("device token sync did not accept one event");
  }
  if (!badDashboard.error || badDashboard.error.status !== "INVALID_ARGUMENT") {
    throw new Error("untrusted dashboard URL was not rejected");
  }
  if (!reapprove.error || reapprove.error.status !== "FAILED_PRECONDITION") {
    throw new Error("already-approved/exchanged link session was not protected");
  }
  if (!rejectExchanged.error || rejectExchanged.error.status !== "FAILED_PRECONDITION") {
    throw new Error("exchanged link session rejection was not blocked");
  }
  if (!invalid.result || invalid.result.rejected[0].reason !== "private_fields") {
    throw new Error("private sync event was not rejected");
  }
  if (!state.result || state.result.state.eventCount !== 2) {
    throw new Error("sync state was not reduced");
  }
  if (!checkoutForOtherUser.error || checkoutForOtherUser.error.status !== "PERMISSION_DENIED") {
    throw new Error("checkout UID mismatch was not denied");
  }
  if (!checkoutMissingSecret.error || checkoutMissingSecret.error.status !== "FAILED_PRECONDITION") {
    throw new Error("checkout without Stripe secret did not fail closed");
  }
  if (!freeDeviceA.result || !freeDeviceA.result.deviceToken || errorReason(freeDeviceBRejected) !== "plan_limit_device_count") {
    throw new Error("Free device limit did not reject the second linked Codex device");
  }
  if (proDevices.length !== 5 || errorReason(proSixthRejected) !== "plan_limit_device_count") {
    throw new Error("Pro device limit did not allow five devices and reject the sixth");
  }
  if (!downgradedFirst.result || errorReason(downgradedSecond) !== "plan_limit_device_count" || downgradedDevices.size !== 5) {
    throw new Error("Downgraded Pro devices were not restricted without deleting device metadata");
  }
  if (!proSync.result || proSync.result.accepted.length !== 1 || proSync.result.entitlement.maxDevices !== 5) {
    throw new Error("Pro near-real-time sync was not accepted under configured limits");
  }

  console.log(JSON.stringify({
    ok: true,
    uid: auth.localId,
    accepted: first.result.accepted,
    duplicateCount: duplicate.result.duplicates.length,
    invalidReason: invalid.result.rejected[0].reason,
    eventCount: state.result.state.eventCount,
    deviceTokenAccepted: deviceSync.result.accepted.length,
    billingUidMismatch: checkoutForOtherUser.error.status,
    billingMissingSecret: checkoutMissingSecret.error.status,
    freeSyncCadenceLimit: errorReason(freeCadence),
    freeDeviceLimit: errorReason(freeDeviceBRejected),
    proDeviceLimit: errorReason(proSixthRejected),
    downgradedDeviceLimit: errorReason(downgradedSecond),
    downgradedActiveDevicesKept: downgradedDevices.size,
    proSyncAccepted: proSync.result.accepted.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
