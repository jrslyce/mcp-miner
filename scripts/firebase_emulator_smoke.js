"use strict";

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "demo-mcp-miner";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";

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

async function main() {
  const email = `smoke-${Date.now()}@mcp-miner.local`;
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

  const documentUrl = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/_emulatorSmoke/${auth.localId}`;
  const firestore = await requestJson(documentUrl, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${auth.idToken}`
    },
    body: JSON.stringify({
      fields: {
        ok: { booleanValue: true },
        privacyClass: { stringValue: "abstract" },
        createdBy: { stringValue: auth.localId }
      }
    })
  });

  const callable = await requestJson(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/us-central1/ping`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${auth.idToken}`
    },
    body: JSON.stringify({ data: { source: "emulator_smoke" } })
  });

  console.log(JSON.stringify({
    ok: true,
    projectId: PROJECT_ID,
    authUid: auth.localId,
    firestoreDocument: firestore.name,
    functionOk: callable.result && callable.result.ok === true,
    privacyClass: callable.result && callable.result.privacyClass
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
