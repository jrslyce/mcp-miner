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

async function linkDevice(idToken, label) {
  const link = await callFunction("createLinkSession", null, {
    dashboardUrl: "http://127.0.0.1:5000",
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

function backupPayload(overrides = {}) {
  return {
    profile: {
      display_name: "Emulator Miner",
      miner_name: "Emulator",
      suit_style: "cozy sci-fi asteroid miner",
      customization_unlocks: ["suit_patch_basic"]
    },
    progress: {
      space_bucks: 777,
      suit_condition: 91,
      current_asteroid_class_id: "asteroid_starter_rubble",
      asteroid_progress: {
        asteroid_class_id: "asteroid_starter_rubble",
        mined: 222
      }
    },
    inventory: {
      mat_chonks: 222,
      mat_element_fe: 8
    },
    orders: {
      orders: [],
      completed_orders: []
    },
    upgrades: {
      upgrades: {}
    },
    base: {
      base_modules: {}
    },
    cosmetics: {
      customization_unlocks: ["suit_patch_basic"]
    },
    settings: {
      report_mode: "meaningful_turns_only",
      cloud_sync: true
    },
    syncMetadata: {
      last_pushed_sequence: 4,
      sync_mode: "near_real_time",
      sync_cadence_seconds: 10
    },
    ...overrides
  };
}

function errorReason(response) {
  return response && response.error && response.error.details
    ? response.error.details.reason
    : null;
}

async function main() {
  const freeUser = await signUp("backup-free");
  const freeDevice = await linkDevice(freeUser.idToken, "Free Backup Device");
  const freeDenied = await callFunction("createCloudBackup", freeDevice.result.deviceToken, {
    backup: backupPayload(),
    localUpdatedAt: "2026-05-26T00:00:00.000Z"
  }, false);

  const proUser = await signUp("backup-pro");
  await setEntitlement(proUser.localId, "pro_monthly");
  const proDeviceA = await linkDevice(proUser.idToken, "Pro Backup Device A");
  const proDeviceB = await linkDevice(proUser.idToken, "Pro Backup Device B");
  const created = await callFunction("createCloudBackup", proDeviceA.result.deviceToken, {
    backup: backupPayload(),
    localUpdatedAt: "2026-05-26T00:00:10.000Z"
  });
  const status = await callFunction("getCloudBackupStatus", proDeviceB.result.deviceToken, {});
  const missingConfirm = await callFunction("restoreCloudBackup", proDeviceB.result.deviceToken, {
    localUpdatedAt: "2026-05-26T00:00:00.000Z"
  }, false);
  const restored = await callFunction("restoreCloudBackup", proDeviceB.result.deviceToken, {
    confirm: true,
    localUpdatedAt: "2026-05-26T00:00:20.000Z"
  });
  const invalid = await callFunction("createCloudBackup", proDeviceA.result.deviceToken, {
    backup: backupPayload({
      profile: {
        avatar_concept_prompt: "private prompt"
      }
    }),
    localUpdatedAt: "2026-05-26T00:00:30.000Z"
  }, false);

  const backupDoc = await firestore().doc(`players/${proUser.localId}/cloudBackups/current`).get();
  await firestore().doc(`players/${proUser.localId}/cloudBackups/current`).set({
    payload: {
      schemaVersion: 1,
      privacyClass: "abstract",
      sections: {
        profile: {
          avatar_concept_prompt: "corrupt private prompt"
        }
      }
    },
    checksum: "bogus"
  }, { merge: true });
  const corruptRestore = await callFunction("restoreCloudBackup", proDeviceB.result.deviceToken, {
    confirm: true,
    localUpdatedAt: "2026-05-26T00:00:40.000Z"
  }, false);
  if (errorReason(freeDenied) !== "plan_limit_backup_restore") {
    throw new Error("Free backup creation was not denied with plan_limit_backup_restore");
  }
  if (!created.result || !created.result.backup || created.result.backup.byteSize <= 0 || created.result.backup.checksum.length !== 64) {
    throw new Error("Pro backup was not created with metadata");
  }
  if (!status.result || status.result.eligible !== true || !status.result.backup) {
    throw new Error("Backup status did not return Pro eligibility and backup metadata");
  }
  if (!missingConfirm.error || missingConfirm.error.status !== "FAILED_PRECONDITION") {
    throw new Error("Restore without explicit confirmation was not blocked");
  }
  if (!restored.result || restored.result.payload.sections.progress.space_bucks !== 777 || restored.result.conflict.deviceRelation !== "different_device") {
    throw new Error("Confirmed restore did not return the backup payload and cross-device conflict metadata");
  }
  if (!invalid.error || invalid.error.status !== "INVALID_ARGUMENT") {
    throw new Error("Private backup fields were not rejected");
  }
  if (!backupDoc.exists || backupDoc.data().payload.sections.profile.avatar_concept_prompt) {
    throw new Error("Stored backup was missing or contained forbidden prompt data");
  }
  if (!corruptRestore.error || corruptRestore.error.status !== "DATA_LOSS" || errorReason(corruptRestore) !== "backup_validation_failed") {
    throw new Error("Corrupt stored backup was not blocked during restore");
  }

  console.log(JSON.stringify({
    ok: true,
    freeDenied: errorReason(freeDenied),
    backupByteSize: created.result.backup.byteSize,
    backupChecksum: created.result.backup.checksum,
    restoreConflict: restored.result.conflict,
    invalidStatus: invalid.error.status,
    corruptRestore: corruptRestore.error.status
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
