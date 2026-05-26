"use strict";

const assert = require("assert");
const {
  CURRENT_SYNC_SCHEMA_VERSION,
  CURRENT_RECEIPT_SCHEMA_VERSION,
  eventChecksum,
  hasPrivateKeys,
  prepareSyncBatch,
  reduceCloudState,
  scoreForReceipt,
  validateRewardEvent,
  validateSyncReceipt
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

function receipt(overrides = {}) {
  const base = {
    ownerUid: "firebase_uid_123",
    eventId: "evt_receipt_1",
    eventType: "work_apply_patch",
    schemaVersion: CURRENT_RECEIPT_SCHEMA_VERSION,
    receiptType: "abstract_work",
    sequence: 1,
    timestamp: "2026-05-24T00:00:00Z",
    turnId: "turn_sync",
    observedFields: {
      scoreHint: 8.5,
      category: "coding",
      rewardControlReasons: []
    },
    privacyClass: "abstract",
    source: "codex_hook",
    signature: "v2.local-placeholder"
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
const validReceipt = receipt();

check("valid reward events should pass privacy and checksum validation", () => {
  validateRewardEvent(valid, "firebase_uid_123");
  return true;
});

check("valid v2 sync receipts should pass privacy and checksum validation", () => {
  validateSyncReceipt(validReceipt, "firebase_uid_123");
  return true;
});

check("v2 receipt score should be calculated server-side from bounded hints", () => {
  const inflated = receipt({
    eventId: "evt_receipt_inflated",
    observedFields: { scoreHint: 999 }
  });
  return scoreForReceipt(inflated) === 30;
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

check("valid v2 sync batches should store server-calculated abstract scores", () => {
  const batch = prepareSyncBatch({
    uid: "firebase_uid_123",
    events: [validReceipt],
    lastSequence: 0,
    receivedAt: "2026-05-24T00:00:01Z"
  });
  const accepted = batch.accepted[0];
  return batch.accepted.length === 1 &&
    accepted.receiptSchemaVersion === CURRENT_RECEIPT_SCHEMA_VERSION &&
    accepted.observedFields.score === 8.5 &&
    accepted.observedFields.scoreSource === "server_receipt_v2" &&
    accepted.observedFields.serverCalculated === true;
});

check("v2 receipts must not provide final client score fields", () => {
  const fakeScore = receipt({
    eventId: "evt_receipt_fake_score",
    sequence: 2,
    observedFields: {
      score: 999
    }
  });
  fakeScore.checksum = eventChecksum(fakeScore);
  const batch = prepareSyncBatch({
    uid: "firebase_uid_123",
    events: [fakeScore],
    lastSequence: 1
  });
  return batch.accepted.length === 0 &&
    batch.rejected[0].reason === "client_score";
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

check("v2 receipts with token-shaped private fields should be rejected", () => {
  const privateReceipt = receipt({
    eventId: "evt_receipt_private",
    sequence: 3,
    observedFields: {
      deviceToken: "do-not-sync"
    }
  });
  privateReceipt.checksum = eventChecksum(privateReceipt);
  const batch = prepareSyncBatch({
    uid: "firebase_uid_123",
    events: [privateReceipt],
    lastSequence: 2
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
