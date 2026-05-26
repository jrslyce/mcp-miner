"use strict";

const crypto = require("crypto");

const CURRENT_SYNC_SCHEMA_VERSION = 1;
const CURRENT_RECEIPT_SCHEMA_VERSION = 2;
const PRIVATE_KEYS = [
  "apiKey",
  "apiKeys",
  "authToken",
  "authTokens",
  "prompt",
  "prompts",
  "assistantReply",
  "assistantReplies",
  "code",
  "sourceCode",
  "terminalOutput",
  "command",
  "commands",
  "filePath",
  "filePaths",
  "path",
  "paths",
  "cwd",
  "repoName",
  "repository",
  "repositoryName",
  "browserContent",
  "appContent",
  "transcript",
  "rawTranscript",
  "token",
  "tokens",
  "idToken",
  "idTokens",
  "deviceToken",
  "deviceTokens",
  "refreshToken",
  "refreshTokens",
  "secret",
  "secrets",
  "openAiAccount",
  "openAIAccount",
  "openaiAccount"
];
const WORK_SCORE_RULES = {
  work_session_start: { baseScore: 2 },
  work_user_prompt: { baseScore: 1 },
  work_file_read: { baseScore: 1 },
  work_search: { baseScore: 2 },
  work_apply_patch: { baseScore: 8, maxScore: 30 },
  work_create_file: { baseScore: 10, maxScore: 28 },
  work_test_pass: { baseScore: 14.4 },
  work_test_fail: { baseScore: 4 },
  work_review: { baseScore: 6 },
  work_write_docs: { baseScore: 6, maxScore: 24 },
  work_commit_or_pr: { baseScore: 18 },
  work_fabrication_artifact: { baseScore: 10 }
};

function hasPrivateKeys(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.entries(value).some(([key, nested]) => {
    if (PRIVATE_KEYS.includes(key)) {
      return true;
    }
    if (Array.isArray(nested)) {
      return nested.some((item) => hasPrivateKeys(item));
    }
    return hasPrivateKeys(nested);
  });
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksumPayload(event) {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    observedFields: event.observedFields || {},
    privacyClass: event.privacyClass,
    schemaVersion: event.schemaVersion,
    sequence: event.sequence,
    source: event.source,
    timestamp: event.timestamp,
    turnId: event.turnId || null
  };
}

function eventChecksum(event) {
  return crypto.createHash("sha256").update(stableJson(checksumPayload(event))).digest("hex");
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function scoreRuleFor(eventType) {
  return WORK_SCORE_RULES[eventType] || null;
}

function scoreForReceipt(receipt) {
  const rule = scoreRuleFor(receipt.eventType);
  if (!rule) {
    fail("event_type", "eventType must be an abstract work event");
  }

  const observed = receipt.observedFields || {};
  const baseScore = Number(rule.baseScore || 0);
  const maxScore = Number(rule.maxScore || baseScore);
  const scoreHint = typeof observed.scoreHint === "number" ? observed.scoreHint : null;
  const score = scoreHint === null ? baseScore : Math.max(0, Math.min(scoreHint, maxScore));
  return roundScore(score);
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateRewardEvent(event, uid) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    fail("invalid_event", "event must be an object");
  }
  if (hasPrivateKeys(event)) {
    fail("private_fields", "event contains private field names");
  }
  if (event.ownerUid && event.ownerUid !== uid) {
    fail("owner_mismatch", "event ownerUid must match authenticated user");
  }
  if (event.schemaVersion !== CURRENT_SYNC_SCHEMA_VERSION) {
    fail("schema_version", "unsupported sync schema version");
  }
  if (typeof event.eventId !== "string" || !/^evt_[a-zA-Z0-9_-]+$/.test(event.eventId)) {
    fail("event_id", "eventId must be a deterministic evt_ identifier");
  }
  if (typeof event.eventType !== "string" || !/^work_[a-z_]+$/.test(event.eventType)) {
    fail("event_type", "eventType must be an abstract work event");
  }
  if (event.privacyClass !== "abstract") {
    fail("privacy_class", "privacyClass must be abstract");
  }
  if (event.source !== "codex_hook") {
    fail("source", "source must be codex_hook");
  }
  if (!Number.isInteger(event.sequence) || event.sequence <= 0) {
    fail("sequence", "sequence must be a positive integer");
  }
  if (typeof event.timestamp !== "string" || event.timestamp.length < 10) {
    fail("timestamp", "timestamp must be an ISO-like string");
  }
  if (!event.observedFields || typeof event.observedFields !== "object" || Array.isArray(event.observedFields)) {
    fail("observed_fields", "observedFields must be an abstract object");
  }
  if (typeof event.signature !== "string" || !event.signature.startsWith("v1.")) {
    fail("signature", "signature must use the v1 placeholder format");
  }
  if (event.checksum !== eventChecksum(event)) {
    fail("checksum", "checksum does not match event payload");
  }

  return true;
}

function validateSyncReceipt(receipt, uid) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("invalid_event", "receipt must be an object");
  }
  if (hasPrivateKeys(receipt)) {
    fail("private_fields", "receipt contains private field names");
  }
  if (receipt.ownerUid && receipt.ownerUid !== uid) {
    fail("owner_mismatch", "receipt ownerUid must match authenticated user");
  }
  if (receipt.schemaVersion !== CURRENT_RECEIPT_SCHEMA_VERSION) {
    fail("schema_version", "unsupported receipt schema version");
  }
  if (receipt.receiptType !== "abstract_work") {
    fail("receipt_type", "receiptType must be abstract_work");
  }
  if (typeof receipt.eventId !== "string" || !/^evt_[a-zA-Z0-9_-]+$/.test(receipt.eventId)) {
    fail("event_id", "eventId must be a deterministic evt_ identifier");
  }
  if (typeof receipt.eventType !== "string" || !/^work_[a-z_]+$/.test(receipt.eventType)) {
    fail("event_type", "eventType must be an abstract work event");
  }
  if (!scoreRuleFor(receipt.eventType)) {
    fail("event_type", "eventType must be an allowed abstract work event");
  }
  if (receipt.privacyClass !== "abstract") {
    fail("privacy_class", "privacyClass must be abstract");
  }
  if (receipt.source !== "codex_hook") {
    fail("source", "source must be codex_hook");
  }
  if (!Number.isInteger(receipt.sequence) || receipt.sequence <= 0) {
    fail("sequence", "sequence must be a positive integer");
  }
  if (typeof receipt.timestamp !== "string" || receipt.timestamp.length < 10) {
    fail("timestamp", "timestamp must be an ISO-like string");
  }
  if (!receipt.observedFields || typeof receipt.observedFields !== "object" || Array.isArray(receipt.observedFields)) {
    fail("observed_fields", "observedFields must be an abstract object");
  }
  if (Object.prototype.hasOwnProperty.call(receipt.observedFields, "score") && typeof receipt.observedFields.score === "number") {
    fail("client_score", "schema v2 receipts must not provide final score");
  }
  if (typeof receipt.signature !== "string" || !receipt.signature.startsWith("v2.")) {
    fail("signature", "signature must use the v2 receipt placeholder format");
  }
  if (receipt.checksum !== eventChecksum(receipt)) {
    fail("checksum", "checksum does not match receipt payload");
  }

  return true;
}

function publicObservedFields(fields = {}) {
  const allowed = {};
  if (typeof fields.category === "string" && fields.category) {
    allowed.category = fields.category.slice(0, 80);
  }
  if (Array.isArray(fields.rewardControlReasons)) {
    allowed.rewardControlReasons = fields.rewardControlReasons
      .map((reason) => String(reason || "").slice(0, 80))
      .filter(Boolean)
      .slice(0, 8);
  }
  if (typeof fields.scoreHint === "number") {
    allowed.scoreHint = roundScore(fields.scoreHint);
  }
  return allowed;
}

function sanitizeRewardEvent(event, uid, receivedAt, options = {}) {
  const score = typeof options.score === "number"
    ? options.score
    : (typeof event.observedFields.score === "number" ? event.observedFields.score : 0);
  const observedFields = {
    ...publicObservedFields(event.observedFields || {}),
    score: roundScore(score),
    scoreSource: options.scoreSource || "legacy_client_score",
    serverCalculated: options.serverCalculated === true
  };
  if (options.scoreCapped === true) {
    observedFields.scoreCapped = true;
  }

  return {
    ownerUid: uid,
    eventId: event.eventId,
    eventType: event.eventType,
    timestamp: event.timestamp,
    sessionId: event.sessionId || null,
    turnId: event.turnId || null,
    observedFields,
    privacyClass: "abstract",
    source: "codex_hook",
    schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
    receiptSchemaVersion: event.schemaVersion,
    receiptType: event.receiptType || null,
    sequence: event.sequence,
    checksum: event.checksum,
    signature: event.signature,
    rewardControl: event.rewardControl || null,
    receivedAt,
    reducedAt: receivedAt
  };
}

function sanitizeSyncItem(item, uid, receivedAt) {
  if (item && item.schemaVersion === CURRENT_RECEIPT_SCHEMA_VERSION) {
    validateSyncReceipt(item, uid);
    const score = scoreForReceipt(item);
    const hint = item.observedFields && typeof item.observedFields.scoreHint === "number"
      ? item.observedFields.scoreHint
      : null;
    return sanitizeRewardEvent(item, uid, receivedAt, {
      score,
      scoreSource: "server_receipt_v2",
      serverCalculated: true,
      scoreCapped: hint !== null && hint > score
    });
  }

  validateRewardEvent(item, uid);
  return sanitizeRewardEvent(item, uid, receivedAt);
}

function initialCloudState(uid) {
  return {
    ownerUid: uid,
    schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
    privacyClass: "abstract",
    eventCount: 0,
    workScoreTotal: 0,
    workEvents: {},
    lastEventId: null,
    lastSequence: 0,
    updatedAt: null
  };
}

function reduceCloudState(state, event, reducedAt) {
  const next = {
    ...initialCloudState(state.ownerUid),
    ...state,
    workEvents: {
      ...(state.workEvents || {})
    }
  };
  const score = typeof event.observedFields.score === "number" ? event.observedFields.score : 0;
  next.eventCount = Number(next.eventCount || 0) + 1;
  next.workScoreTotal = Math.round((Number(next.workScoreTotal || 0) + score) * 100) / 100;
  next.workEvents[event.eventType] = Number(next.workEvents[event.eventType] || 0) + 1;
  next.lastEventId = event.eventId;
  next.lastSequence = event.sequence;
  next.updatedAt = reducedAt;
  return next;
}

function prepareSyncBatch({ uid, events, existingEventIds = [], lastSequence = 0, receivedAt = new Date().toISOString() }) {
  if (!uid) {
    fail("unauthenticated", "authenticated uid is required");
  }
  if (!Array.isArray(events) || events.length === 0 || events.length > 50) {
    fail("events", "events must contain 1 to 50 items");
  }

  const existing = new Set(existingEventIds);
  let cursor = Number(lastSequence || 0);
  const accepted = [];
  const duplicates = [];
  const rejected = [];

  for (const event of events) {
    try {
      const sanitized = sanitizeSyncItem(event, uid, receivedAt);
      if (existing.has(event.eventId)) {
        duplicates.push({ eventId: event.eventId, sequence: event.sequence, reason: "duplicate" });
        continue;
      }
      if (event.sequence <= cursor) {
        rejected.push({ eventId: event.eventId, sequence: event.sequence, reason: "stale_sequence" });
        continue;
      }

      existing.add(event.eventId);
      cursor = event.sequence;
      accepted.push(sanitized);
    } catch (error) {
      rejected.push({
        eventId: event && event.eventId ? event.eventId : null,
        sequence: event && event.sequence ? event.sequence : null,
        reason: error.code || "invalid_event"
      });
    }
  }

  return {
    accepted,
    duplicates,
    rejected,
    lastSequence: cursor
  };
}

module.exports = {
  CURRENT_SYNC_SCHEMA_VERSION,
  CURRENT_RECEIPT_SCHEMA_VERSION,
  PRIVATE_KEYS,
  eventChecksum,
  hasPrivateKeys,
  prepareSyncBatch,
  reduceCloudState,
  sanitizeRewardEvent,
  scoreForReceipt,
  stableJson,
  validateRewardEvent,
  validateSyncReceipt
};
