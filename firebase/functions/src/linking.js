"use strict";

const crypto = require("crypto");

const LINK_SESSION_TTL_MS = 10 * 60 * 1000;
const DEVICE_TOKEN_PREFIX = "mcpd_";
const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LINK_SESSION_ID_PATTERN = /^link_[A-Za-z0-9_-]{20,80}$/;
const DEVICE_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const DEFAULT_DASHBOARD_URL = "https://mcp-miner.web.app";
const ALLOWED_DASHBOARD_HOSTS = new Set([
  "mcp-miner.web.app",
  "mcp-miner.firebaseapp.com",
  "mcpminer.net",
  "www.mcpminer.net"
]);
const LOCAL_DASHBOARD_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0"
]);

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

function normalizeLinkSessionId(value) {
  const sessionId = String(value || "").trim();
  return LINK_SESSION_ID_PATTERN.test(sessionId) ? sessionId : "";
}

function normalizeDeviceSecret(value) {
  const secret = String(value || "").trim();
  return DEVICE_SECRET_PATTERN.test(secret) ? secret : "";
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

function truthyEnv(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").toLowerCase());
}

function localDashboardUrlsAllowed() {
  return truthyEnv("MCP_MINER_ALLOW_LOCAL_DASHBOARD_URLS") ||
    truthyEnv("FUNCTIONS_EMULATOR") ||
    Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

function sanitizeDashboardUrl(value, configured = DEFAULT_DASHBOARD_URL) {
  const raw = String(value || configured || DEFAULT_DASHBOARD_URL).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new Error("dashboardUrl must be a valid MCP Miner URL.");
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("dashboardUrl must use http or https.");
  }
  const localDashboardHost = LOCAL_DASHBOARD_HOSTS.has(parsed.hostname);
  if (!ALLOWED_DASHBOARD_HOSTS.has(parsed.hostname) && !(localDashboardHost && localDashboardUrlsAllowed())) {
    throw new Error("dashboardUrl host is not allowed for MCP Miner links.");
  }
  if (parsed.protocol !== "https:" && !localDashboardHost) {
    throw new Error("dashboardUrl must use https outside localhost.");
  }

  return parsed.origin;
}

function newLinkSession({ now = new Date(), dashboardUrl = "https://mcp-miner.web.app", deviceName = "Codex" } = {}) {
  const sessionId = `link_${randomToken(18)}`;
  const deviceSecret = randomToken(32);
  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_SESSION_TTL_MS).toISOString();
  const cleanDashboardUrl = sanitizeDashboardUrl(dashboardUrl);
  return {
    session: {
      sessionId,
      code,
      deviceSecretHash: secretHash(deviceSecret),
      status: "pending",
      privacyClass: "abstract",
      deviceName: String(deviceName || "Codex").replace(/[\r\n\t]+/g, " ").trim().slice(0, 80) || "Codex",
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

function requirePendingSession(session, now = new Date()) {
  const validation = validateLinkSession(session, now);
  if (!validation.ok) {
    return validation;
  }
  return session.status === "pending" ? { ok: true } : { ok: false, reason: `already_${session.status}` };
}

function hasDeviceScope(tokenData, requiredScope) {
  if (!requiredScope) {
    return true;
  }
  const scopes = Array.isArray(tokenData && tokenData.scopes) ? tokenData.scopes : [];
  return scopes.includes(requiredScope);
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
  ALLOWED_DASHBOARD_HOSTS,
  DEFAULT_DASHBOARD_URL,
  DEVICE_TOKEN_PREFIX,
  DEVICE_SECRET_PATTERN,
  LOCAL_DASHBOARD_HOSTS,
  LINK_SESSION_TTL_MS,
  LINK_SESSION_ID_PATTERN,
  deviceTokenHash,
  generateLinkCode,
  hasDeviceScope,
  newDeviceToken,
  newLinkSession,
  normalizeDeviceSecret,
  normalizeLinkCode,
  normalizeLinkSessionId,
  publicLinkSession,
  requirePendingSession,
  sanitizeDashboardUrl,
  secretHash,
  validateLinkSession
};
