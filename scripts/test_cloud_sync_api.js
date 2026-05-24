"use strict";

const assert = require("assert");
const {
  CURRENT_SYNC_SCHEMA_VERSION,
  eventChecksum,
  hasPrivateKeys,
  prepareSyncBatch,
  reduceCloudState,
  validateRewardEvent
} = require("../firebase/functions/src/sync");

let checks = 0;
function check(message, fn) {
  assert.ok(fn(), message);
  checks += 1;
}

function event(overrides = {}) {
  const base = {
    eventId: "evt_sync_1",
    eventType: "work_apply_patch",
    schemaVersion: CURRENT_SYNC_SCHEMA_VERSION,
    sequence: 1,
    timestamp: "2026-05-24T00:00:00Z",
    turnId: "turn_sync",
    observedFields: {
      changedLines: 12,
      filesTouchedCount: 2,
      score: 8.5
    },
    privacyClass: "abstract",
    source: "codex_hook",
    signature: "v1.local-placeholder"
  };
  const next = {
    ...base,
    ...overrides,
    observedFields: {
      ...base.observedFields,
      ...(overrides.observedFields || {})
    }
  };
  next.checksum = eventChecksum(next);
  return next;
}

const valid = event();

check("valid reward events should pass privacy and checksum validation", () => {
  validateRewardEvent(valid, "firebase_uid_123");
  return true;
});

check("private fields should be detected recursively", () => {
  return hasPrivateKeys({ observedFields: { prompt: "do not sync" } }) === true;
});

check("valid sync batches should accept new monotonic events", () => {
  const batch = prepareSyncBatch({
    uid: "firebase_uid_123",
    events: [valid],
    lastSequence: 0,
    receivedAt: "2026-05-24T00:00:01Z"
  });
  return batch.accepted.length === 1 &&
    batch.duplicates.length === 0 &&
    batch.rejected.length === 0 &&
    batch.lastSequence === 1;
});

check("duplicate events should be idempotent", () => {
  const batch = prepareSyncBatch({
    uid: "firebase_uid_123",
    events: [valid],
    existingEventIds: [valid.eventId],
    lastSequence: 1
  });
  return batch.accepted.length === 0 &&
    batch.duplicates[0].eventId === valid.eventId;
});

check("stale non-duplicate events should be rejected", () => {
  const stale = event({ eventId: "evt_sync_stale", sequence: 1 });
  const batch = prepareSyncBatch({
    uid: "firebase_uid_123",
    events: [stale],
    lastSequence: 2
  });
  return batch.accepted.length === 0 &&
    batch.rejected[0].reason === "stale_sequence";
});

check("events with private payload fields should be rejected", () => {
  const privateEvent = event({
    eventId: "evt_sync_private",
    sequence: 2,
    observedFields: {
      prompt: "please do not store me"
    }
  });
  privateEvent.checksum = eventChecksum(privateEvent);
  const batch = prepareSyncBatch({
    uid: "firebase_uid_123",
    events: [privateEvent],
    lastSequence: 1
  });
  return batch.accepted.length === 0 &&
    batch.rejected[0].reason === "private_fields";
});

check("bad checksums should be rejected", () => {
  const bad = {
    ...event({ eventId: "evt_sync_bad_checksum", sequence: 3 }),
    checksum: "bad"
  };
  const batch = prepareSyncBatch({
    uid: "firebase_uid_123",
    events: [bad],
    lastSequence: 2
  });
  return batch.rejected[0].reason === "checksum";
});

check("accepted events should reduce into abstract cloud state", () => {
  const reduced = reduceCloudState({
    ownerUid: "firebase_uid_123",
    eventCount: 0,
    workScoreTotal: 0,
    workEvents: {}
  }, valid, "2026-05-24T00:00:01Z");
  return reduced.eventCount === 1 &&
    reduced.workScoreTotal === 8.5 &&
    reduced.workEvents.work_apply_patch === 1 &&
    reduced.lastEventId === valid.eventId &&
    reduced.lastSequence === valid.sequence;
});

console.log(JSON.stringify({
  ok: true,
  checks,
  checksum: valid.checksum.slice(0, 12)
}, null, 2));
