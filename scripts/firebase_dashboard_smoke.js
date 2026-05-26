"use strict";

const { eventChecksum } = require("../firebase/functions/src/sync");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "demo-mcp-miner";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const HOSTING_HOST = process.env.FIREBASE_HOSTING_EMULATOR_HOST || "127.0.0.1:5000";

async function requestJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed: ${response.status} ${text}`);
  }
  return body;
}

async function requestText(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${text}`);
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

async function verifyEmulatorUser(uid) {
  await firebaseAdmin().auth().updateUser(uid, { emailVerified: true });
}

function callableUrl(name) {
  return `http://${FUNCTIONS_HOST}/${PROJECT_ID}/us-central1/${name}`;
}

function authHeaders(idToken) {
  return {
    authorization: `Bearer ${idToken}`
  };
}

function dashboardEvent(uid) {
  const timestamp = new Date().toISOString();
  const event = {
    ownerUid: uid,
    eventId: `evt_dashboard_${Date.now()}`,
    eventType: "work_dashboard_smoke",
    schemaVersion: 1,
    sequence: 1,
    timestamp,
    sessionId: "session_dashboard_smoke",
    turnId: "turn_dashboard_smoke",
    observedFields: {
      score: 12.5,
      category: "dashboard_smoke"
    },
    privacyClass: "abstract",
    source: "codex_hook",
    signature: "v1.local-dashboard-smoke"
  };
  event.checksum = eventChecksum(event);
  return event;
}

async function main() {
  const email = `dashboard-${Date.now()}@mcp-miner.local`;
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
  const auth = await requestJson(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });

  const event = dashboardEvent(auth.localId);
  const syncResult = await requestJson(callableUrl("syncRewardEvents"), {
    method: "POST",
    headers: authHeaders(auth.idToken),
    body: JSON.stringify({ data: { events: [event] } })
  });
  if (!syncResult.result || !Array.isArray(syncResult.result.accepted) || syncResult.result.accepted[0] !== event.eventId) {
    throw new Error(`dashboard sync smoke did not accept event: ${JSON.stringify(syncResult)}`);
  }

  const stateResult = await requestJson(callableUrl("getSyncState"), {
    method: "POST",
    headers: authHeaders(auth.idToken),
    body: JSON.stringify({ data: {} })
  });
  if (!stateResult.result || !stateResult.result.state || stateResult.result.state.eventCount < 1) {
    throw new Error(`dashboard sync state missing reduced event: ${JSON.stringify(stateResult)}`);
  }

  const indexHtml = await requestText(`http://${HOSTING_HOST}/`);
  const dashboardJs = await requestText(`http://${HOSTING_HOST}/auth.js`);
  const requiredPanels = ["status", "inventory", "orders", "asteroid", "asteroid-atlas", "upgrades", "store", "reports", "sync-privacy", "billing", "linked-devices"];
  const missingPanels = requiredPanels.filter((panel) => !indexHtml.includes(`data-panel="${panel}"`));
  if (missingPanels.length) {
    throw new Error(`dashboard hosting response missing panels: ${missingPanels.join(", ")}`);
  }
  if (!dashboardJs.includes("getSyncState") || !dashboardJs.includes("DEMO_DASHBOARD") || !dashboardJs.includes("ASTEROID_CLASSES") || !dashboardJs.includes("createCheckoutSession") || !dashboardJs.includes("revokeSyncDevice")) {
    throw new Error("dashboard module missing Firebase sync or demo-mode support");
  }

  console.log(JSON.stringify({
    ok: true,
    projectId: PROJECT_ID,
    uid: auth.localId,
    accepted: syncResult.result.accepted.length,
    eventCount: stateResult.result.state.eventCount,
    hostingPanels: requiredPanels
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
