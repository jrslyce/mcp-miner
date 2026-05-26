"use strict";

const crypto = require("crypto");

const LINK_SESSION_TTL_MS = 10 * 60 * 1000;
const DEVICE_TOKEN_PREFIX = "mcpd_";
const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function base64url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomToken(byteLength = 32, randomBytes = crypto.randomBytes) {
  return base64url(randomBytes(byteLength));
}

function generateLinkCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes).map((byte) => LINK_CODE_ALPHABET[byte % LINK_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

function normalizeLinkCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function secretHash(secret) {
  return sha256(`mcp-miner-link-secret:${secret}`);
}

function deviceTokenHash(token) {
  return sha256(`mcp-miner-device-token:${token}`);
}

function newLinkSession({ now = new Date(), dashboardUrl = "https://mcp-miner.web.app", deviceName = "Codex" } = {}) {
  const sessionId = `link_${randomToken(18)}`;
  const deviceSecret = randomToken(32);
  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_SESSION_TTL_MS).toISOString();
  const cleanDashboardUrl = String(dashboardUrl || "https://mcp-miner.web.app").replace(/\/+$/g, "");
  return {
    session: {
      sessionId,
      code,
      deviceSecretHash: secretHash(deviceSecret),
      status: "pending",
      privacyClass: "abstract",
      deviceName: String(deviceName || "Codex").slice(0, 80),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt
    },
    deviceSecret,
    linkUrl: `${cleanDashboardUrl}/?linkCode=${encodeURIComponent(code)}&sessionId=${encodeURIComponent(sessionId)}`
  };
}

function newDeviceToken(randomBytes = crypto.randomBytes) {
  return `${DEVICE_TOKEN_PREFIX}${randomToken(32, randomBytes)}`;
}

function validateLinkSession(session, now = new Date()) {
  if (!session || typeof session !== "object") {
    return { ok: false, reason: "not_found" };
  }
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (session.status === "rejected") {
    return { ok: false, reason: "rejected" };
  }
  if (session.status === "exchanged") {
    return { ok: false, reason: "already_exchanged" };
  }
  return { ok: true };
}

function publicLinkSession(session) {
  return {
    sessionId: session.sessionId,
    code: session.code,
    status: session.status,
    deviceName: session.deviceName || "Codex",
    expiresAt: session.expiresAt,
    approvedAt: session.approvedAt || null,
    exchangedAt: session.exchangedAt || null,
    privacyClass: "abstract"
  };
}

module.exports = {
  DEVICE_TOKEN_PREFIX,
  LINK_SESSION_TTL_MS,
  deviceTokenHash,
  generateLinkCode,
  newDeviceToken,
  newLinkSession,
  normalizeLinkCode,
  publicLinkSession,
  secretHash,
  validateLinkSession
};
