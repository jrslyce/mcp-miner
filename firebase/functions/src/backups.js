"use strict";

const crypto = require("crypto");

const BACKUP_SCHEMA_VERSION = 1;
const MAX_BACKUP_BYTES = 128 * 1024;
const BACKUP_SECTIONS = Object.freeze([
  "profile",
  "progress",
  "inventory",
  "orders",
  "upgrades",
  "base",
  "cosmetics",
  "settings",
  "syncMetadata"
]);
const FORBIDDEN_KEY_NAMES = new Set([
  "prompt",
  "rawPrompt",
  "raw_prompt",
  "code",
  "command",
  "commands",
  "terminalOutput",
  "terminal_output",
  "filePath",
  "file_path",
  "path",
  "repo",
  "repoName",
  "repo_name",
  "browserContent",
  "browser_content",
  "appContent",
  "app_content",
  "transcript",
  "cwd"
]);
const FORBIDDEN_KEY_TOKENS = [
  "prompt",
  "code",
  "command",
  "terminaloutput",
  "filepath",
  "reponame",
  "browsercontent",
  "appcontent",
  "transcript"
];
const FORBIDDEN_VALUE_PATTERNS = [
  /\/Users\//,
  /terminal output/i,
  /browser content/i,
  /app content/i,
  /raw transcript/i,
  /git@github\.com/i
];

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function assertNoForbiddenBackupData(value, path = "backup") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenBackupData(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, nested]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (FORBIDDEN_KEY_NAMES.has(key) || FORBIDDEN_KEY_TOKENS.some((token) => normalizedKey.includes(token))) {
        throw new Error(`Backup field ${path}.${key} is not allowed.`);
      }
      assertNoForbiddenBackupData(nested, `${path}.${key}`);
    });
    return;
  }
  if (typeof value === "string" && FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`Backup value at ${path} appears to contain private workspace data.`);
  }
}

function sanitizeBackupPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Backup payload must be an object.");
  }
  const sections = {};
  BACKUP_SECTIONS.forEach((section) => {
    if (Object.prototype.hasOwnProperty.call(input, section)) {
      sections[section] = input[section];
    }
  });
  if (!Object.keys(sections).length) {
    throw new Error("Backup payload did not include any supported MCP Miner sections.");
  }
  const payload = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    privacyClass: "abstract",
    sections
  };
  assertNoForbiddenBackupData(payload);
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > MAX_BACKUP_BYTES) {
    throw new Error("Backup payload is too large.");
  }
  return {
    ...payload,
    checksum: checksum(payload),
    byteSize: bytes
  };
}

function backupConflict({ localUpdatedAt = null, cloudUpdatedAt = null, sourceDeviceId = null, targetDeviceId = null }) {
  const local = Date.parse(localUpdatedAt || "");
  const cloud = Date.parse(cloudUpdatedAt || "");
  let freshness = "unknown";
  if (!Number.isNaN(local) && !Number.isNaN(cloud)) {
    if (local > cloud) {
      freshness = "local_newer";
    } else if (cloud > local) {
      freshness = "cloud_newer";
    } else {
      freshness = "same_age";
    }
  }
  return {
    freshness,
    deviceRelation: sourceDeviceId && targetDeviceId && sourceDeviceId !== targetDeviceId ? "different_device" : "same_or_unknown_device"
  };
}

module.exports = {
  BACKUP_SCHEMA_VERSION,
  BACKUP_SECTIONS,
  assertNoForbiddenBackupData,
  backupConflict,
  checksum,
  sanitizeBackupPayload
};
