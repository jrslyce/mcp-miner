"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.ping = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "MCP Miner sync endpoints require Firebase Auth.");
  }

  logger.info("mcp_miner_ping", {
    privacyClass: "abstract",
    uidPresent: true,
    emulator: process.env.FUNCTIONS_EMULATOR === "true"
  });

  return {
    ok: true,
    service: "mcp-miner",
    privacyClass: "abstract",
    uid: request.auth.uid
  };
});
