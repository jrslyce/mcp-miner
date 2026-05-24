"use strict";

const crypto = require("crypto");

const CURRENT_SYNC_SCHEMA_VERSION = 1;
const PRIVATE_KEYS = [
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
  "rawTranscript"
];

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

function sanitizeRewardEvent(event, uid, receivedAt) {
  return {
    ownerUid: uid,
    eventId: event.eventId,
    eventType: event.eventType,
    timestamp: event.timestamp,
    sessionId: event.sessionId || null,
    turnId: event.turnId || null,
    observedFields: event.observedFields || {},
    privacyClass: "abstract",
    source: "codex_hook",
    schemaVersion: event.schemaVersion,
    sequence: event.sequence,
    checksum: event.checksum,
    signature: event.signature,
    rewardControl: event.rewardControl || null,
    receivedAt,
    reducedAt: receivedAt
  };
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
      validateRewardEvent(event, uid);
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
      accepted.push(sanitizeRewardEvent(event, uid, receivedAt));
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
  PRIVATE_KEYS,
  eventChecksum,
  hasPrivateKeys,
  prepareSyncBatch,
  reduceCloudState,
  sanitizeRewardEvent,
  stableJson,
  validateRewardEvent
};
