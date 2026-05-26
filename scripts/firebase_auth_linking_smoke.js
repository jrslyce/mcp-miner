"use strict";

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

async function patchDoc(path, token, fields, expectedStatus = 200) {
  return requestJson(documentUrl(path), {
    method: "PATCH",
    headers: token ? authHeaders(token) : {},
    body: JSON.stringify({ fields })
  }, expectedStatus);
}

async function main() {
  const auth = await signUp("link");
  const now = new Date().toISOString();

  await requestJson(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=fake-api-key`, {
    method: "POST",
    body: JSON.stringify({ idToken: auth.idToken })
  });

  await patchDoc(`players/${auth.localId}`, auth.idToken, {
    ownerUid: stringField(auth.localId),
    schemaVersion: intField(1),
    createdAt: stringField(now),
    updatedAt: stringField(now),
    privacyClass: stringField("abstract"),
    displayName: stringField("Local Prospector"),
    minerName: stringField("Prospector"),
    cloudSyncEnabled: boolField(true),
    accountLinkedAt: stringField(now)
  });

  await patchDoc(`players/${auth.localId}/profile/current`, auth.idToken, {
    ownerUid: stringField(auth.localId),
    schemaVersion: intField(1),
    updatedAt: stringField(now),
    privacyClass: stringField("abstract"),
    displayName: stringField("Local Prospector"),
    minerName: stringField("Prospector")
  });

  await patchDoc(`players/${auth.localId}/settings/current`, auth.idToken, {
    ownerUid: stringField(auth.localId),
    schemaVersion: intField(1),
    updatedAt: stringField(now),
    privacyClass: stringField("abstract"),
    reportMode: stringField("meaningful_turns_only"),
    cloudSyncEnabled: boolField(true)
  });

  await patchDoc(`players/${auth.localId}/profile/current`, null, {
    ownerUid: stringField(auth.localId),
    schemaVersion: intField(1),
    updatedAt: stringField(now),
    privacyClass: stringField("abstract")
  }, 403);

  console.log(JSON.stringify({
    ok: true,
    projectId: PROJECT_ID,
    uid: auth.localId,
    cases: [
      "auth_emulator_sign_up",
      "auth_emulator_token_lookup",
      "linked_profile_created",
      "linked_settings_created",
      "signed_out_write_denied"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
