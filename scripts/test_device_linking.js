"use strict";

const assert = require("assert");
const {
  DEVICE_TOKEN_PREFIX,
  deviceTokenHash,
  newDeviceToken,
  newLinkSession,
  normalizeLinkCode,
  publicLinkSession,
  secretHash,
  validateLinkSession
} = require("../firebase/functions/src/linking");

let checks = 0;
function check(message, fn) {
  assert.ok(fn(), message);
  checks += 1;
}

const now = new Date("2026-05-25T12:00:00Z");
const { session, deviceSecret, linkUrl } = newLinkSession({
  now,
  dashboardUrl: "https://mcp-miner.web.app/",
  deviceName: "Codex Test Device"
});

check("link session should create a short code, URL, and private device secret", () => {
  return /^link_/.test(session.sessionId) &&
    /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(session.code) &&
    linkUrl.includes("linkCode=") &&
    linkUrl.includes("sessionId=") &&
    typeof deviceSecret === "string" &&
    deviceSecret.length > 20;
});

check("server-side link session should store only the device secret hash", () => {
  return session.deviceSecretHash === secretHash(deviceSecret) &&
    !JSON.stringify(session).includes(deviceSecret);
});

check("link code normalization should tolerate spacing and lower case", () => {
  return normalizeLinkCode(session.code.toLowerCase().replace("-", " ")) === session.code;
});

check("fresh pending sessions should validate", () => {
  return validateLinkSession(session, new Date("2026-05-25T12:01:00Z")).ok === true;
});

check("expired sessions should be rejected", () => {
  return validateLinkSession(session, new Date("2026-05-25T12:11:00Z")).reason === "expired";
});

check("public link session should not include secret hash", () => {
  return !Object.keys(publicLinkSession(session)).includes("deviceSecretHash");
});

check("device tokens should be prefixed and stored as hashes", () => {
  const token = newDeviceToken();
  return token.startsWith(DEVICE_TOKEN_PREFIX) &&
    deviceTokenHash(token).length === 64 &&
    deviceTokenHash(token) !== token;
});

console.log(JSON.stringify({
  ok: true,
  checks,
  code: session.code
}, null, 2));
