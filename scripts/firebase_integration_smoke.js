"use strict";

const { eventChecksum } = require("../firebase/functions/src/sync");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "demo-mcp-miner";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const HOSTING_HOST = process.env.FIREBASE_HOSTING_EMULATOR_HOST || "127.0.0.1:5000";

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

async function requestText(url, expectedStatus = 200) {
  const response = await fetch(url);
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`GET ${url} expected ${expectedStatus}, got ${response.status}: ${text}`);
  }
  return text;
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

function authHeaders(idToken) {
  if (!idToken) {
    return {};
  }
  return idToken.startsWith("mcpd_")
    ? { "x-mcp-miner-device-token": idToken }
    : { authorization: `Bearer ${idToken}` };
}

function callableUrl(name) {
  return `http://${FUNCTIONS_HOST}/${PROJECT_ID}/us-central1/${name}`;
}

function documentUrl(path) {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
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

async function signUp(label) {
  const email = `${label}-${Date.now()}-${Math.round(Math.random() * 10000)}@mcp-miner.local`;
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

async function patchDoc(path, idToken, fields, expectedStatus = 200) {
  return requestJson(documentUrl(path), {
    method: "PATCH",
    headers: authHeaders(idToken),
    body: JSON.stringify({ fields })
  }, expectedStatus);
}

async function getDoc(path, idToken, expectedStatus = 200) {
  return requestJson(documentUrl(path), {
    method: "GET",
    headers: authHeaders(idToken)
  }, expectedStatus);
}

async function callFunction(name, idToken, data, expectedStatus = 200) {
  return requestJson(callableUrl(name), {
    method: "POST",
    headers: authHeaders(idToken),
    body: JSON.stringify({ data })
  }, expectedStatus);
}

function syncEvent(uid, overrides = {}) {
  const timestamp = new Date().toISOString();
  const event = {
    ownerUid: uid,
    eventId: `evt_integration_${Date.now()}_${Math.round(Math.random() * 10000)}`,
    eventType: "work_integration_smoke",
    schemaVersion: 1,
    sequence: overrides.sequence || 1,
    timestamp,
    sessionId: "session_integration_smoke",
    turnId: "turn_integration_smoke",
    observedFields: {
      score: 17.5,
      category: "integration_smoke",
      ...(overrides.observedFields || {})
    },
    privacyClass: "abstract",
    source: "codex_hook",
    signature: "v1.local-integration-smoke"
  };
  event.checksum = eventChecksum(event);
  return event;
}

async function main() {
  const owner = await signUp("integration-owner");
  const other = await signUp("integration-other");
  const now = new Date().toISOString();

  await patchDoc(`players/${owner.localId}/profile/current`, owner.idToken, {
    ownerUid: stringField(owner.localId),
    schemaVersion: intField(1),
    updatedAt: stringField(now),
    privacyClass: stringField("abstract"),
    displayName: stringField("Integration Prospector"),
    minerName: stringField("Smoke Miner")
  });
  await patchDoc(`players/${owner.localId}/settings/current`, owner.idToken, {
    ownerUid: stringField(owner.localId),
    schemaVersion: intField(1),
    updatedAt: stringField(now),
    privacyClass: stringField("abstract"),
    reportMode: stringField("meaningful_turns_only"),
    cloudSyncEnabled: boolField(true)
  });
  await patchDoc(`players/${owner.localId}/profile/current`, null, {
    ownerUid: stringField(owner.localId),
    schemaVersion: intField(1),
    privacyClass: stringField("abstract")
  }, 403);
  await getDoc(`players/${owner.localId}/profile/current`, other.idToken, 403);

  const link = await callFunction("createLinkSession", null, {
    dashboardUrl: `http://${HOSTING_HOST}`,
    deviceName: "Integration Codex"
  });
  const approved = await callFunction("approveLinkSession", owner.idToken, {
    sessionId: link.result.session.sessionId,
    code: link.result.session.code
  });
  const exchanged = await callFunction("exchangeLinkSession", null, {
    sessionId: link.result.session.sessionId,
    deviceSecret: link.result.deviceSecret
  });
  if (!approved.result || approved.result.session.status !== "approved") {
    throw new Error("device link session was not approved");
  }
  if (!exchanged.result || !exchanged.result.deviceToken || !exchanged.result.deviceToken.startsWith("mcpd_")) {
    throw new Error("device link session did not return a device token");
  }

  await callFunction("getSyncState", null, {}, 401);
  const acceptedEvent = syncEvent(owner.localId, { sequence: 1 });
  const sync = await callFunction("syncRewardEvents", owner.idToken, { events: [acceptedEvent] });
  const duplicate = await callFunction("syncRewardEvents", owner.idToken, { events: [acceptedEvent] });
  await firestore().doc(`players/${owner.localId}/syncMetadata/default`).set({
    lastAcceptedBatchAt: new Date(Date.now() - 61 * 1000).toISOString()
  }, { merge: true });
  const deviceEvent = syncEvent(owner.localId, { sequence: 2 });
  const deviceSync = await callFunction("syncRewardEvents", exchanged.result.deviceToken, { events: [deviceEvent] });
  const privateEvent = syncEvent(owner.localId, {
    sequence: 3,
    observedFields: {
      prompt: "private"
    }
  });
  privateEvent.checksum = eventChecksum(privateEvent);
  const rejected = await callFunction("syncRewardEvents", owner.idToken, { events: [privateEvent] });
  const state = await callFunction("getSyncState", owner.idToken, {});
  const analytics = await callFunction("getDashboardAnalytics", owner.idToken, {});
  await getDoc(`players/${owner.localId}/gameState/current`, owner.idToken);

  const indexHtml = await requestText(`http://${HOSTING_HOST}/`);
  const dashboardJs = await requestText(`http://${HOSTING_HOST}/auth.js`);
  const planCatalog = JSON.parse(await requestText(`http://${HOSTING_HOST}/subscription-plans.json`));
  const requiredPanels = ["status", "analytics", "inventory", "orders", "asteroid", "upgrades", "store", "reports", "device-link", "linked-devices", "sync-privacy"];
  const missingPanels = requiredPanels.filter((panel) => !indexHtml.includes(`data-panel="${panel}"`));
  if (missingPanels.length) {
    throw new Error(`dashboard hosting response missing panels: ${missingPanels.join(", ")}`);
  }
  if (!dashboardJs.includes("DEMO_DASHBOARD") || !dashboardJs.includes("getSyncState") || !dashboardJs.includes("getDashboardAnalytics") || !dashboardJs.includes("exportDashboardHistory") || !dashboardJs.includes("connectFunctionsEmulator") || !dashboardJs.includes("renameSyncDevice") || !dashboardJs.includes("syncCadenceModel")) {
    throw new Error("dashboard module missing demo/offline or Functions integration support");
  }
  if (!indexHtml.includes("id=\"sync-cadence\"") || !indexHtml.includes("id=\"sync-next-refresh\"")) {
    throw new Error("dashboard hosting response missing cadence refresh fields");
  }
  if (!indexHtml.includes("id=\"plan-cards\"") || planCatalog.plans.length !== 3) {
    throw new Error("dashboard hosting response missing subscription plan cards/catalog");
  }

  if (!sync.result || sync.result.accepted[0] !== acceptedEvent.eventId) {
    throw new Error("valid sync event was not accepted");
  }
  if (!duplicate.result || duplicate.result.duplicates.length !== 1) {
    throw new Error("duplicate sync event was not idempotent");
  }
  if (!deviceSync.result || deviceSync.result.accepted[0] !== deviceEvent.eventId) {
    throw new Error("device-token sync event was not accepted");
  }
  if (!rejected.result || rejected.result.rejected[0].reason !== "private_fields") {
    throw new Error("private sync event was not rejected");
  }
  if (!state.result || !state.result.state || state.result.state.eventCount < 2) {
    throw new Error("dashboard sync state read did not include reduced state");
  }
  if (!analytics.result || !analytics.result.trends || analytics.result.history.length < 2) {
    throw new Error("dashboard analytics read did not include abstract history");
  }

  console.log(JSON.stringify({
    ok: true,
    projectId: PROJECT_ID,
    ownerUid: owner.localId,
    cases: [
      "auth_emulator_sign_up",
      "owner_profile_created",
      "signed_out_profile_write_denied",
      "cross_user_profile_read_denied",
      "device_link_session_created",
      "device_link_session_approved",
      "device_link_session_exchanged",
      "no_auth_sync_state_denied",
      "valid_sync_accepted",
      "device_token_sync_accepted",
      "duplicate_sync_idempotent",
      "private_sync_rejected",
      "dashboard_state_read",
      "dashboard_analytics_read",
      "hosting_dashboard_served"
    ],
    accepted: sync.result.accepted.length + deviceSync.result.accepted.length,
    duplicateCount: duplicate.result.duplicates.length,
    rejectedReason: rejected.result.rejected[0].reason,
    hostingPanels: requiredPanels
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
