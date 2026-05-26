#!/usr/bin/env node
"use strict";

const admin = require("../firebase/functions/node_modules/firebase-admin");
const {
  createStripeClient
} = require("../firebase/functions/src/billing");
const {
  forceEntitlementRefresh,
  inspectSupportAccount,
  markBillingProjectionStale,
  reconcileStripeEntitlement,
  requireSupportActor,
  revokeSupportDevice
} = require("../firebase/functions/src/support_tools");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "demo-mcp-miner";

function usage() {
  return [
    "Usage:",
    "  MCP_MINER_SUPPORT_ACTOR=support:name node scripts/subscription_support_admin.js inspect --uid UID",
    "  MCP_MINER_SUPPORT_ACTOR=support:name node scripts/subscription_support_admin.js reconcile-stripe --uid UID",
    "  MCP_MINER_SUPPORT_ACTOR=support:name node scripts/subscription_support_admin.js refresh-entitlement --uid UID",
    "  MCP_MINER_SUPPORT_ACTOR=support:name node scripts/subscription_support_admin.js mark-billing-stale --uid UID --reason REASON",
    "  MCP_MINER_SUPPORT_ACTOR=support:name node scripts/subscription_support_admin.js revoke-device --uid UID --device-id DEVICE_ID"
  ].join("\n");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith("--")) {
      throw new Error(`Unexpected argument: ${key}`);
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    flags[key.slice(2)] = value;
    index += 1;
  }
  return { command, flags };
}

function firebaseDb() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  return admin.firestore();
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const actor = flags.actor || process.env.MCP_MINER_SUPPORT_ACTOR;
  requireSupportActor(actor);
  const uid = flags.uid;
  const db = firebaseDb();
  let result;

  if (command === "inspect") {
    result = await inspectSupportAccount({ db, uid, actor });
  } else if (command === "reconcile-stripe") {
    result = await reconcileStripeEntitlement({
      db,
      stripe: createStripeClient(),
      uid,
      actor
    });
  } else if (command === "refresh-entitlement") {
    result = await forceEntitlementRefresh({ db, uid, actor });
  } else if (command === "mark-billing-stale") {
    result = await markBillingProjectionStale({
      db,
      uid,
      actor,
      reason: flags.reason || "support_requested_refresh"
    });
  } else if (command === "revoke-device") {
    result = await revokeSupportDevice({
      db,
      uid,
      actor,
      deviceId: flags["device-id"]
    });
  } else {
    throw new Error(`Unknown command: ${command || "(missing)"}\n${usage()}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || "internal",
    reason: error.reason || error.code || "support_tool_failed",
    message: error.message
  }, null, 2));
  process.exit(1);
});
